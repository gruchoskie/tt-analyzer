import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { listVideoInputs, type CameraInfo, type VideoInputDevice } from '../camera/CameraSource';
import { checkCameraSupport, describeCameraError, MIC_DENIED_NOTICE, type CameraErrorInfo } from '../camera/errors';
import { LocalCameraSource } from '../camera/LocalCameraSource';
import { SessionRecorder } from '../camera/SessionRecorder';
import { ScreenWakeLock } from '../camera/wakeLock';
import { DeviceClock } from '../core/clock';
import { getLocalCameraId, newSessionId } from '../core/ids';
import type { SessionId } from '../core/types';
import { formatBytes, formatDuration } from '../physics/units';
import { getStore, requestPersistentStorage } from '../storage/storeSingleton';
import type { SessionCamera, SessionRecord } from '../storage/types';
import { imageToTable, rescaleCalibration } from '../calibration/calibrate';
import { loadCurrentCalibration, saveCurrentCalibration } from '../calibration/store';
import { isOnTable, tableSide } from '../calibration/table';
import type { TableCalibration } from '../calibration/types';
import { elementToVideo } from '../calibration/viewport';
import { CalibrationEditor } from './CalibrationEditor';
import { ErrorPanel } from './ErrorPanel';
import { TableOverlay, type OverlayMarker } from './TableOverlay';
import { useVideoBox } from './useVideoBox';
import { TrackOverlay, type TrackOverlayHandle } from './TrackOverlay';
import { useBallTracking } from './useBallTracking';
import type { BallColor } from '../tracking/classicDetector';
import { sampleBall, type BallProfile } from '../tracking/ballProfile';
import { grabFrame } from './frameGrab';
import { usePref } from './prefs';
import { useBounces } from './useBounces';
import { BounceMap } from './BounceMap';
import { BounceOverlay } from './BounceOverlay';
import { LiveAudioOnsets } from '../camera/liveAudio';
import { localNowMs } from '../core/clock';
import { LoadGovernor } from '../core/loadGovernor';
import { navigate } from './route';
import { usePose } from './usePose';
import { PoseOverlay } from './PoseOverlay';
import { StrokePanel } from './StrokePanel';
import { RallyPanel } from './RallyPanel';
import { useRallies } from './useRallies';
import { buildAnalysis } from '../report/analysis';
import { hub } from '../net/hub';
import { cameraLink } from '../net/cameraLink';
import { buildStrokes } from '../pose/strokes';
import type { Hand } from '../pose/types';

interface RecState {
  sessionId: SessionId;
  startedAtLocal: number;
  fpsSamples: number[];
}

function sessionName(d: Date): string {
  return `Treino ${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function CameraScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceRef = useRef<LocalCameraSource | null>(null);
  const recorderRef = useRef(new SessionRecorder());
  const wakeRef = useRef(new ScreenWakeLock());
  const clockRef = useRef(new DeviceClock());
  const recRef = useRef<RecState | null>(null);
  const cameraId = useRef(getLocalCameraId()).current;

  const [deviceId, setDeviceId] = usePref<string>('deviceId', '');
  const [debug, setDebug] = usePref<boolean>('debug', false);
  const [devices, setDevices] = useState<VideoInputDevice[]>([]);
  const [error, setError] = useState<CameraErrorInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [starting, setStarting] = useState(true);
  const [recording, setRecording] = useState(false);
  // Economia automática: se a tela começa a travar, pausa a pose e analisa menos quadros.
  const [load, setLoad] = useState(0);
  const skipRef = useRef(1);
  skipRef.current = load >= 3 ? 3 : load >= 2 ? 2 : 1;
  useEffect(() => {
    const g = new LoadGovernor();
    let raf = 0;
    const tick = (t: number) => {
      const lv = g.frame(t);
      if (lv !== null) setLoad(lv);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [wakeActive, setWakeActive] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [showSettings, setShowSettings] = useState(false);
  const [lastFrameHubMs, setLastFrameHubMs] = useState(0);
  const lastFrameRef = useRef(0);
  const [calibration, setCalibration] = useState<TableCalibration | null>(() => loadCurrentCalibration(cameraId));
  const [calibrating, setCalibrating] = useState(false);
  const [showTable, setShowTable] = usePref<boolean>('showTable', true);
  const [probe, setProbe] = useState<OverlayMarker | null>(null);
  const box = useVideoBox(videoRef);
  // Calibração adaptada à resolução atual (null se a proporção mudou, ex.: celular girado).
  const activeCal = useMemo(
    () => (calibration && box ? rescaleCalibration(calibration, box.videoW, box.videoH) : null),
    [calibration, box],
  );
  const calMismatch = !!calibration && !!box && !activeCal;

  // Fase 3: rastreio da bola num Worker.
  const [tracking, setTracking] = usePref<boolean>('tracking', true);
  const [ballColor, setBallColor] = usePref<BallColor>('ballColor', 'auto');
  const [analysisWidth, setAnalysisWidth] = usePref<number>('analysisWidth', 640);
  const trackOverlayRef = useRef<TrackOverlayHandle>(null);
  const [ballProfile, setBallProfile] = usePref<BallProfile | null>('ballProfile', null);
  const [pickingBall, setPickingBall] = useState(false);
  const [showBounces, setShowBounces] = usePref<boolean>('showBounces', true);
  const bounce = useBounces(activeCal, tracking && showBounces);
  // Fase 9: este celular como hub (com câmeras remotas) ou como câmera de um hub.
  const hubSnap = useSyncExternalStore(hub.subscribe, hub.snapshot);
  const linkSnap = useSyncExternalStore(cameraLink.subscribe, cameraLink.snapshot);
  const isHub = hubSnap.cams.length > 0;
  const isRemote = linkSnap.state === 'conectado';
  const multiOn = isHub || isRemote;
  // Fase 7: rallies e placar estimado.
  const [showRallies, setShowRallies] = usePref<boolean>('showRallies', true);
  const rally = useRallies(bounce.bounces, bounce.active && showRallies);
  // Fase 6: pose dos jogadores (MediaPipe).
  const [showPose, setShowPose] = usePref<boolean>('showPose', false);
  const [racketHand, setRacketHand] = usePref<Hand | 'auto'>('racketHand', 'auto');
  const pose = usePose({
    videoRef,
    // durante a gravação a pose fica pausada (é o que mais pesa no celular); na reprodução ela roda
    enabled: showPose && !recording && load < 1 && !error && !calibrating && !pickingBall,
    calibration: activeCal,
    clockMs: () => localNowMs() + clockRef.current.getOffset().offsetMs,
    hand: racketHand,
  });
  const strokes = useMemo(() => buildStrokes(pose.swings, bounce.bounces), [pose.swings, bounce.bounces]);
  // Fase 8: o que foi analisado ao vivo vai para o relatório ao parar a gravação.
  const liveRef = useRef({ bounces: bounce.bounces, swings: pose.swings, rallies: rally.rallies, winners: rally.winners, manual: rally.manual });
  liveRef.current = { bounces: bounce.bounces, swings: pose.swings, ...rally.withLive(), manual: rally.manual };
  const trackRef = useRef<typeof track>(null);
  const { pipelineRef, snapshot: track, error: trackError } = useBallTracking({
    videoRef,
    overlayRef: trackOverlayRef,
    enabled: tracking && !error && !calibrating && !pickingBall,
    cameraId,
    calibration: activeCal,
    ballColor,
    analysisWidth,
    showCandidates: debug,
    profile: ballProfile,
    onResult: (r) => {
      if (cameraLink.connected && r.state === 'tracking' && r.detection) cameraLink.detection(r.meta.timestamp.hubMs, r.detection.x, r.detection.y);
      if (hub.active) {
        if (r.state === 'tracking' && r.detection) hub.ingestLocal(r.meta.timestamp.hubMs, r.detection.x, r.detection.y);
        else hub.heartbeatLocal(r.meta.timestamp.hubMs);
      }
      bounce.onResult(r);
      if (showRallies) rally.onFrame(r);
    },
  });

  // Fase 9: relógio da câmera acompanha o do hub; calibração e estatísticas vão para o hub.
  useEffect(() => {
    if (!isRemote) {
      clockRef.current.setOffset(0, 0);
      return;
    }
    const id = window.setInterval(() => {
      const o = cameraLink.offset();
      if (o) clockRef.current.setOffset(o.offsetMs, o.uncertaintyMs);
      const i = sourceRef.current?.getInfo();
      if (i)
        cameraLink.stats({
          fps: i.measuredFps,
          analysisFps: trackRef.current?.pipeline.analysisFps ?? 0,
          detRate: trackRef.current?.last?.stats.detectionRate ?? 0,
          width: i.width,
          height: i.height,
        });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRemote]);
  useEffect(() => {
    if (isRemote) cameraLink.sendCalibration(activeCal);
  }, [isRemote, activeCal]);
  useEffect(() => {
    if (isHub) hub.setLocal(cameraId, activeCal);
  }, [isHub, activeCal, cameraId]);

  trackRef.current = track;

  // Avisos informativos somem sozinhos.
  useEffect(() => {
    if (!notice || pickingBall) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice, pickingBall]);

  // Áudio ao vivo: os "tocs" confirmam os quiques.
  const { addOnsets, audioOff } = bounce;
  useEffect(() => {
    const stream = sourceRef.current?.getStream();
    if (!(bounce.active || multiOn) || !info?.hasAudio || !stream || !LiveAudioOnsets.supported()) return;
    const live = new LiveAudioOnsets((times, until) => {
      const offset = clockRef.current.getOffset().offsetMs;
      const hubTimes = times.map((t) => t + offset);
      if (bounce.active) addOnsets(hubTimes, until + offset);
      // Fase 9: tocs e palmas refinam a sincronia entre celulares
      if (cameraLink.connected) cameraLink.onsets(hubTimes);
      if (hub.active) hub.addLocalOnsets(hubTimes);
    });
    void live.start(stream).catch(() => undefined);
    return () => {
      live.stop();
      audioOff();
    };
  }, [bounce.active, multiOn, info?.hasAudio, info?.cameraId, deviceId, addOnsets, audioOff]);

  // "Escolher bola": toque na bola parada para o app aprender a cor dela.
  const onPickTap = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !box) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = elementToVideo(box.t, { x: e.clientX - r.left, y: e.clientY - r.top });
    const f = grabFrame(v);
    if (!f) return;
    const w = f.width;
    const prof = sampleBall(f.rgba, w, f.height, px.x, px.y, Math.max(10, w * 0.02), Math.max(20, w * 0.05));
    if (!prof) {
      setNotice('Não achei a bola nesse ponto. Segure a bola parada, destacada do fundo, e toque bem em cima dela.');
      return;
    }
    setBallProfile(prof);
    setPickingBall(false);
    setNotice('Bola escolhida! O rastreio agora só procura essa cor e ignora o resto.');
  };

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setNotice(null);
    setStarting(true);
    const unsupported = checkCameraSupport({
      isSecureContext: window.isSecureContext,
      hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
      hasMediaRecorder: typeof MediaRecorder !== 'undefined',
    });
    if (unsupported) {
      setError(unsupported);
      setStarting(false);
      return;
    }
    sourceRef.current?.stop();
    const src = new LocalCameraSource(cameraId, video, clockRef.current);
    sourceRef.current = src;
    src.onFrame((f) => {
      lastFrameRef.current = f.timestamp.hubMs;
      if (skipRef.current > 1 && f.frameIndex % skipRef.current) return;
      pipelineRef.current?.submit(f);
    });
    try {
      const { audioDenied } = await src.start({ audio: true, deviceId: deviceId || undefined });
      if (audioDenied) setNotice(MIC_DENIED_NOTICE);
      setDevices(await listVideoInputs().catch(() => []));
    } catch (err) {
      // Câmera salva pode ter sumido: tenta a padrão antes de desistir.
      if (deviceId && (err as { name?: string }).name === 'OverconstrainedError') {
        setDeviceId('');
        return;
      }
      setError(describeCameraError(err));
    } finally {
      setStarting(false);
    }
  }, [cameraId, deviceId, setDeviceId, pipelineRef]);

  // Abre a câmera ao entrar e quando a câmera escolhida muda.
  useEffect(() => {
    void startCamera();
    return () => {
      sourceRef.current?.stop();
    };
  }, [startCamera]);

  // Tela sempre ligada nesta tela.
  useEffect(() => {
    const wl = wakeRef.current;
    wl.onChange = setWakeActive;
    void wl.enable();
    return () => {
      void wl.disable();
    };
  }, []);

  // Atualiza o painel (fps etc.) 4x por segundo.
  useEffect(() => {
    const id = window.setInterval(() => {
      const src = sourceRef.current;
      if (!src || src.status !== 'live') return;
      const i = src.getInfo();
      setInfo(i);
      setLastFrameHubMs(lastFrameRef.current);
      const rec = recRef.current;
      if (rec) {
        if (i.measuredFps > 0) rec.fpsSamples.push(i.measuredFps);
        setElapsed(performance.now() - rec.startedAtLocal);
        setBytes(recorderRef.current.bytesSaved);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const startRecording = useCallback(async (fromHub?: { sessionId: string; name: string }) => {
    const src = sourceRef.current;
    const stream = src?.getStream();
    if (!src || !stream || recRef.current) return;
    void requestPersistentStorage();
    const store = await getStore();
    const sessionId = fromHub?.sessionId ?? newSessionId();
    const i = src.getInfo();
    const startTs = clockRef.current.stamp();
    const cam: SessionCamera = {
      cameraId,
      label: i.label,
      width: i.width,
      height: i.height,
      measuredFps: i.measuredFps,
      reportedFps: i.reportedFps,
      mimeType: '',
      hasAudio: i.hasAudio,
      durationMs: 0,
      sizeBytes: 0,
      chunkCount: 0,
      clockOffsetMs: startTs.offsetMs,
      startedAtHubMs: startTs.hubMs,
    };
    const now = Date.now();
    const rec: SessionRecord = {
      id: sessionId,
      name: fromHub?.name ?? sessionName(new Date(now)),
      createdAt: now,
      updatedAt: now,
      status: 'recording',
      mode: hub.active && hub.fusion.mode(localNowMs()) === '3d' ? '3d' : '2d',
      role: hub.active ? 'hub' : fromHub ? 'camera' : 'standalone',
      hubCameraId: cameraId,
      cameras: [cam],
      calibrations: activeCal ? { [cameraId]: activeCal } : {},
    };
    await store.create(rec);
    const recorder = recorderRef.current;
    recorder.onError = () => setNotice('Falha ao salvar parte do vídeo. O armazenamento do aparelho pode estar cheio.');
    try {
      const mimeType = recorder.start(stream, { saveChunk: (seq, blob) => store.appendChunk(sessionId, cameraId, seq, blob) }, i.measuredFps);
      await store.upsertCamera(sessionId, { ...cam, mimeType });
    } catch (err) {
      await store.delete(sessionId);
      setNotice(`Não foi possível iniciar a gravação: ${(err as Error).message ?? err}`);
      return;
    }
    src.setSession(sessionId);
    recRef.current = { sessionId, startedAtLocal: performance.now(), fpsSamples: [] };
    // Fase 9: o hub manda as câmeras gravarem junto (mesma sessão)
    if (hub.active) hub.startRecording(sessionId, rec.name);
    setElapsed(0);
    setBytes(0);
    setRecording(true);
  }, [cameraId, activeCal]);

  const stopRecording = useCallback(async () => {
    const rec = recRef.current;
    const src = sourceRef.current;
    if (!rec) return;
    recRef.current = null;
    setRecording(false);
    setSaving(true);
    if (hub.active) hub.stopRecording(rec.sessionId, '');
    try {
      const result = await recorderRef.current.stop();
      src?.setSession(null);
      const store = await getStore();
      const s = await store.get(rec.sessionId);
      const cam = s?.cameras.find((c) => c.cameraId === cameraId);
      const avgFps = rec.fpsSamples.length ? rec.fpsSamples.reduce((a, b) => a + b, 0) / rec.fpsSamples.length : cam?.measuredFps ?? 0;
      if (cam) {
        await store.upsertCamera(rec.sessionId, {
          ...cam,
          mimeType: result.mimeType,
          durationMs: result.durationMs,
          sizeBytes: result.sizeBytes,
          chunkCount: result.chunkCount,
          measuredFps: Math.round(avgFps * 10) / 10,
        });
      }
      await store.update(rec.sessionId, { status: 'complete' });
      // Fase 9: a câmera manda o vídeo para o hub
      if (cameraLink.connected) void cameraLink.sendVideo(rec.sessionId);
      const live = liveRef.current;
      if (cam && live.bounces.some((b) => b.t >= cam.startedAtHubMs)) {
        await store.saveAnalysis(
          buildAnalysis({
            sessionId: rec.sessionId,
            cameraId,
            source: 'ao-vivo',
            offsetMs: cam.startedAtHubMs,
            coveredFromMs: cam.startedAtHubMs,
            coveredToMs: cam.startedAtHubMs + result.durationMs,
            ...live,
          }),
        );
      }
      setNotice(
        result.failedChunks > 0
          ? `Sessão salva com falhas (${result.failedChunks} s perdidos). Verifique o espaço livre.`
          : `Sessão salva: ${formatDuration(result.durationMs)}, ${formatBytes(result.sizeBytes)}.`,
      );
    } catch (err) {
      setNotice(`Erro ao finalizar a gravação: ${(err as Error).message ?? err}`);
    } finally {
      setSaving(false);
    }
  }, [cameraId]);

  // Se o app for para segundo plano gravando, finaliza para não perder o vídeo.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'hidden' && recRef.current) void stopRecording();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [stopRecording]);

  // Ao sair da tela gravando, salva.
  // Fase 9: comandos de gravação do hub.
  useEffect(() => {
    cameraLink.onRec = (m) => {
      if (m.on) void startRecording({ sessionId: m.sessionId, name: m.name });
      else if (recRef.current?.sessionId === m.sessionId) void stopRecording();
    };
    return () => {
      cameraLink.onRec = null;
    };
  }, [startRecording, stopRecording]);

  useEffect(() => () => void (recRef.current && stopRecording()), [stopRecording]);

  const saveCalibration = (cal: TableCalibration) => {
    saveCurrentCalibration(cal);
    setCalibration(cal);
    setCalibrating(false);
    setShowTable(true);
    setNotice('Mesa calibrada. A grade verde deve coincidir com as linhas da mesa.');
  };

  // Modo debug: tocar na imagem mostra a posição em metros na mesa.
  const onVideoTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!debug || !activeCal || !box || calibrating) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = elementToVideo(box.t, { x: e.clientX - r.left, y: e.clientY - r.top });
    const m = imageToTable(activeCal, px);
    const where = isOnTable(m) ? `lado ${tableSide(m)}` : 'fora da mesa';
    setProbe({ px, label: `x ${m.x.toFixed(2).replace('.', ',')} m · y ${m.y.toFixed(2).replace('.', ',')} m · ${where}` });
  };

  const goFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      /* nem todo navegador permite */
    }
  };

  const fps = info?.measuredFps ?? 0;
  const fpsClass = fps >= 50 ? 'good' : fps >= 25 ? 'ok' : 'bad';

  return (
    <div className="camera-screen">
      <video ref={videoRef} className="camera-video" playsInline muted autoPlay onClick={onVideoTap} />
      {!calibrating && (showTable || probe) && (
        <TableOverlay box={box} calibration={showTable ? activeCal : null} markers={debug && probe ? [probe] : []} />
      )}
      {!calibrating && tracking && !pickingBall && <TrackOverlay ref={trackOverlayRef} box={box} />}
      {!calibrating && !pickingBall && bounce.active && (
        <BounceOverlay box={box} bounces={bounce.bounces} clockMs={() => localNowMs() + clockRef.current.getOffset().offsetMs} />
      )}
      {!calibrating && !pickingBall && showPose && <PoseOverlay box={box} poses={pose.poses} />}
      {!calibrating && !pickingBall && !showSettings && ((tracking && showBounces) || showPose) && (
        <div className="bounce-panel">
          {tracking && showBounces &&
            (activeCal ? (
              <BounceMap compact bounces={bounce.bounces} audio={bounce.audio} onReset={bounce.reset} />
            ) : (
              <span className="small">Calibre a mesa (botão Mesa) para ver os quiques e o mapa de calor.</span>
            ))}
          {tracking && showBounces && showRallies && activeCal && (
            <RallyPanel compact r={rally} nowMs={() => localNowMs() + clockRef.current.getOffset().offsetMs} />
          )}
          {showPose && <StrokePanel compact strokes={strokes} status={pose.status} error={pose.error} onReset={pose.reset} inferMs={pose.perf.ms} />}
          {showPose && (recording || load >= 1) && (
            <span className="small warn-text">
              {recording
                ? 'Pose pausada durante a gravação para não travar. Abra a gravação e ligue "Pose e golpes" para analisar os golpes.'
                : 'Pose pausada: o celular está sobrecarregado.'}
            </span>
          )}
        </div>
      )}
      {pickingBall && (
        <>
          <div className="pick-layer" onPointerDown={onPickTap} />
          <div className="pick-hint">
            <span>
              Segure a bola <strong>parada</strong> sobre a mesa e <strong>toque nela</strong>.
            </span>
            {notice && <span className="warn-text small">{notice}</span>}
            <div className="row" style={{ justifyContent: 'center' }}>
              <button
                className="btn"
                onClick={() => {
                  setPickingBall(false);
                  setNotice(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
      {calibrating && (
        <CalibrationEditor
          videoRef={videoRef}
          box={box}
          cameraId={cameraId}
          initial={calibration}
          onSave={saveCalibration}
          onCancel={() => setCalibrating(false)}
        />
      )}

      {error && (
        <div className="overlay-center">
          <ErrorPanel error={error} onRetry={startCamera}>
            <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
              Ver sessões salvas
            </button>
          </ErrorPanel>
        </div>
      )}

      {starting && !error && <div className="overlay-center muted">Abrindo a câmera…</div>}

      {!error && !calibrating && !pickingBall && (
        <div className="hud-top">
          <span className={`badge fps-${fpsClass}`} title="fps realmente entregue pela câmera">
            {fps > 0 ? `${fps.toFixed(0)} fps` : '— fps'}
          </span>
          {info && info.width > 0 && <span className="badge">{info.height}p</span>}
          <button className="badge badge-btn" title="Vários celulares (3D)" onClick={() => !recording && navigate({ name: 'multicam' })}>
            {isHub
              ? `${1 + hubSnap.cams.filter((c) => c.state === 'conectado').length} câmeras · ${hubSnap.mode.toUpperCase()}`
              : isRemote
                ? `câmera do hub · ±${(linkSnap.clock?.uncertaintyMs ?? 0).toFixed(0)} ms`
                : '1 câmera · 2D'}
          </button>
          {tracking && track && <TrackBadge track={track} />}
          {recording && (
            <span className="badge rec">
              <span className="rec-dot" /> {formatDuration(elapsed)} · {formatBytes(bytes)}
            </span>
          )}
          {!wakeActive && ScreenWakeLock.supported && <span className="badge warn">Tela pode apagar</span>}
          {!calibrating && !activeCal && !error && !starting && (
            <span className="badge warn">{calMismatch ? 'Calibração não vale nesta orientação' : 'Mesa não calibrada'}</span>
          )}
        </div>
      )}

      {portrait && !error && !calibrating && <div className="banner">Gire o celular para a horizontal e prenda no tripé vendo a mesa inteira.</div>}
      {trackError && !calibrating && <div className="banner">Rastreio: {trackError}</div>}
      {notice && !calibrating && !pickingBall && (
        <button className="banner banner-info" onClick={() => setNotice(null)}>
          {notice} <span className="muted">(toque para fechar)</span>
        </button>
      )}

      {debug && info && !calibrating && (
        <div className="debug-panel">
          <div>câmera: {info.cameraId}</div>
          <div>
            resolução: {info.width}×{info.height}
          </div>
          <div>fps medido: {info.measuredFps.toFixed(1)}</div>
          <div>economia: nível {load}{load ? ` (${load >= 1 ? "pose pausada" : ""}${load >= 2 ? `, rastreio 1 a cada ${skipRef.current} quadros` : ""})` : " (tudo ligado)"}</div>
          <div>fps anunciado: {info.reportedFps?.toFixed(1) ?? '—'}</div>
          <div>fps máx. da câmera: {info.maxFps?.toFixed(0) ?? '—'}</div>
          <div>maior intervalo: {info.maxGapMs.toFixed(0)} ms</div>
          <div>relógio de quadros: {info.frameClock === 'video-frame-callback' ? 'rVFC' : 'rAF (aprox.)'}</div>
          <div>último quadro (hub): {lastFrameHubMs ? (lastFrameHubMs % 100000).toFixed(1) : '—'} ms</div>
          <div>deslocamento p/ hub: {clockRef.current.getOffset().offsetMs.toFixed(1)} ms</div>
          <div>áudio: {info.hasAudio ? 'sim' : 'não'}</div>
          <div>wake lock: {wakeActive ? 'ativo' : 'inativo'}</div>
          <div>mesa: {activeCal ? 'calibrada (tamanho da bola e região do jogo ativos)' : 'não calibrada'}</div>
          <div>bola escolhida: {ballProfile ? 'sim' : 'não (filtro genérico)'}</div>
          {tracking && track ? (
            <>
              <div>
                fps de análise: {track.pipeline.analysisFps.toFixed(1)} ({track.pipeline.analysisW}×{track.pipeline.analysisH},{' '}
                {track.pipeline.mode === 'bitmap' ? 'OffscreenCanvas' : 'canvas'})
              </div>
              <div>
                processamento: {track.pipeline.workMs.toFixed(1)} ms/quadro · latência {track.pipeline.latencyMs.toFixed(0)} ms
              </div>
              <div>
                descartados: {track.pipeline.dropped} de {track.pipeline.submitted + track.pipeline.dropped}
              </div>
              <div>
                candidatos: {track.last?.candidates.length ?? 0} · máscara: {track.last?.maskPixels ?? 0} px
                {track.last?.rejectedGlobal ? ' (quadro ignorado: mudança global)' : ''}
              </div>
              <div>
                rastro: {track.last?.state ?? '—'} · detecção {(100 * (track.last?.stats.detectionRate ?? 0)).toFixed(0)}% dos
                quadros
              </div>
            </>
          ) : (
            <div>rastreio: desligado</div>
          )}
          {showPose && (
            <div>
              pose: {pose.status} · {pose.perf.fps.toFixed(1)} fps · {pose.perf.ms.toFixed(0)} ms ({pose.perf.delegate || '—'}) · mão da raquete
              perto {pose.racketHand.perto}
            </div>
          )}
          {activeCal && <div>toque na imagem: posição em metros</div>}
        </div>
      )}

      {!calibrating && !pickingBall && (
      <div className="controls">
        <button
          className={`icon-btn ${ballProfile ? '' : 'attention'}`}
          onClick={() => {
            setShowSettings(false);
            setNotice(null);
            setPickingBall(true);
          }}
          disabled={recording || saving || !!error || starting}
          aria-label="Escolher bola"
        >
          <span aria-hidden>{ballProfile ? <span className="swatch" style={{ background: `rgb(${ballProfile.r},${ballProfile.g},${ballProfile.b})` }} /> : '◎'}</span>
          <small>Bola</small>
        </button>

        <button
          className={`icon-btn ${activeCal ? '' : 'attention'}`}
          onClick={() => {
            setShowSettings(false);
            setProbe(null);
            setCalibrating(true);
          }}
          disabled={recording || saving || !!error || starting}
          aria-label="Calibrar mesa"
        >
          <span aria-hidden>⌗</span>
          <small>Mesa</small>
        </button>

        <button
          className="icon-btn"
          onClick={() => navigate({ name: 'sessions' })}
          disabled={recording || saving}
          aria-label="Sessões salvas"
        >
          <span aria-hidden>▤</span>
          <small>Sessões</small>
        </button>

        <button
          className={`rec-btn ${recording ? 'is-recording' : ''}`}
          onClick={recording ? () => void stopRecording() : () => void startRecording()}
          disabled={!!error || starting || saving}
          aria-label={recording ? 'Parar gravação' : 'Gravar'}
        >
          <span className="rec-btn-inner" />
        </button>
        <small className="rec-label">{saving ? 'Salvando…' : recording ? 'Parar' : 'Gravar'}</small>

        <button className="icon-btn" onClick={() => setShowSettings((v) => !v)} disabled={recording || saving} aria-label="Ajustes">
          <span aria-hidden>⚙</span>
          <small>Ajustes</small>
        </button>
      </div>
      )}

      {showSettings && (
        <div className="sheet" role="dialog" aria-label="Ajustes">
          <h3>Ajustes</h3>
          <label className="field">
            <span>Câmera</span>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Traseira (padrão)</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} />
            <span>Mostrar mesa e grade</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
            <span>Rastrear a bola</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showBounces} onChange={(e) => setShowBounces(e.target.checked)} />
            <span>Quiques e mapa de calor</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showRallies} onChange={(e) => setShowRallies(e.target.checked)} />
            <span>Rallies e placar estimado</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showPose} onChange={(e) => setShowPose(e.target.checked)} />
            <span>Pose do jogador e golpes (baixa ~15 MB na 1ª vez)</span>
          </label>
          {showPose && (
            <label className="field">
              <span>Mão da raquete</span>
              <select value={racketHand} onChange={(e) => setRacketHand(e.target.value as Hand | 'auto')}>
                <option value="auto">Automática (a mão mais rápida)</option>
                <option value="direita">Destro</option>
                <option value="esquerda">Canhoto</option>
              </select>
            </label>
          )}
          <div className="field">
            <span>Bola escolhida</span>
            {ballProfile ? (
              <div className="row">
                <span className="swatch" style={{ background: `rgb(${ballProfile.r},${ballProfile.g},${ballProfile.b})` }} />
                <span className="small muted">O rastreio só procura essa cor.</span>
                <button className="btn" onClick={() => setBallProfile(null)}>
                  Esquecer
                </button>
              </div>
            ) : (
              <span className="small muted">Nenhuma. Toque em "Bola" para escolher (recomendado).</span>
            )}
          </div>
          <label className="field">
            <span>Cor da bola (sem bola escolhida)</span>
            <select value={ballColor} onChange={(e) => setBallColor(e.target.value as BallColor)}>
              <option value="auto">Automática (branca ou laranja)</option>
              <option value="branca">Branca</option>
              <option value="laranja">Laranja</option>
            </select>
          </label>
          <label className="field">
            <span>Resolução da análise</span>
            <select value={analysisWidth} onChange={(e) => setAnalysisWidth(Number(e.target.value))}>
              <option value={480}>Leve (480 px): celulares mais simples</option>
              <option value={640}>Normal (640 px)</option>
              <option value={960}>Detalhada (960 px): bola longe da câmera</option>
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            <span>Modo debug</span>
          </label>
          <div className="row">
            <button className="btn" onClick={goFullscreen}>
              Tela cheia
            </button>
            <button className="btn" onClick={() => navigate({ name: 'multicam' })}>
              Vários celulares (3D)
            </button>
            <button className="btn" onClick={() => navigate({ name: 'about' })}>
              Sobre e limitações
            </button>
            <button className="btn btn-primary" onClick={() => setShowSettings(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Selo da taxa de detecção: % dos quadros com bola encontrada enquanto há rastro. */
function TrackBadge({ track }: { track: { last: import('../tracking/protocol').FrameResult | null } }) {
  const last = track.last;
  if (!last || last.stats.totalMeasured === 0) return <span className="badge muted">Bola: procurando</span>;
  const rate = last.stats.trackedRate;
  const cls = rate >= 0.8 ? 'fps-good' : rate >= 0.5 ? 'fps-ok' : 'fps-bad';
  const live = last.state === 'tracking' || last.state === 'coasting';
  return (
    <span className={`badge ${cls}`} title="Quadros com a bola detectada enquanto ela estava sendo rastreada">
      Bola {(rate * 100).toFixed(0)}%{live ? '' : ' · sem bola'}
    </span>
  );
}
