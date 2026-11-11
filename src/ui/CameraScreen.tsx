import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ErrorPanel } from './ErrorPanel';
import { usePref } from './prefs';
import { navigate } from './route';

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
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [wakeActive, setWakeActive] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  const [showSettings, setShowSettings] = useState(false);
  const [lastFrameHubMs, setLastFrameHubMs] = useState(0);
  const lastFrameRef = useRef(0);

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
  }, [cameraId, deviceId, setDeviceId]);

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

  const startRecording = useCallback(async () => {
    const src = sourceRef.current;
    const stream = src?.getStream();
    if (!src || !stream || recRef.current) return;
    void requestPersistentStorage();
    const store = await getStore();
    const sessionId = newSessionId();
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
      name: sessionName(new Date(now)),
      createdAt: now,
      updatedAt: now,
      status: 'recording',
      mode: '2d',
      role: 'standalone',
      hubCameraId: cameraId,
      cameras: [cam],
      calibrations: {},
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
    setElapsed(0);
    setBytes(0);
    setRecording(true);
  }, [cameraId]);

  const stopRecording = useCallback(async () => {
    const rec = recRef.current;
    const src = sourceRef.current;
    if (!rec) return;
    recRef.current = null;
    setRecording(false);
    setSaving(true);
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
  useEffect(() => () => void (recRef.current && stopRecording()), [stopRecording]);

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
      <video ref={videoRef} className="camera-video" playsInline muted autoPlay />

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

      {!error && (
        <div className="hud-top">
          <span className={`badge fps-${fpsClass}`} title="fps realmente entregue pela câmera">
            {fps > 0 ? `${fps.toFixed(0)} fps` : '— fps'}
          </span>
          {info && info.width > 0 && <span className="badge">{info.height}p</span>}
          <span className="badge" title="Com 1 celular a análise é feita no plano da mesa (2D)">
            1 câmera · 2D
          </span>
          {recording && (
            <span className="badge rec">
              <span className="rec-dot" /> {formatDuration(elapsed)} · {formatBytes(bytes)}
            </span>
          )}
          {!wakeActive && ScreenWakeLock.supported && <span className="badge warn">Tela pode apagar</span>}
        </div>
      )}

      {portrait && !error && <div className="banner">Gire o celular para a horizontal e prenda no tripé atrás da mesa.</div>}
      {notice && (
        <button className="banner banner-info" onClick={() => setNotice(null)}>
          {notice} <span className="muted">(toque para fechar)</span>
        </button>
      )}

      {debug && info && (
        <div className="debug-panel">
          <div>câmera: {info.cameraId}</div>
          <div>
            resolução: {info.width}×{info.height}
          </div>
          <div>fps medido: {info.measuredFps.toFixed(1)}</div>
          <div>fps anunciado: {info.reportedFps?.toFixed(1) ?? '—'}</div>
          <div>fps máx. da câmera: {info.maxFps?.toFixed(0) ?? '—'}</div>
          <div>maior intervalo: {info.maxGapMs.toFixed(0)} ms</div>
          <div>relógio de quadros: {info.frameClock === 'video-frame-callback' ? 'rVFC' : 'rAF (aprox.)'}</div>
          <div>último quadro (hub): {lastFrameHubMs ? (lastFrameHubMs % 100000).toFixed(1) : '—'} ms</div>
          <div>deslocamento p/ hub: {clockRef.current.getOffset().offsetMs.toFixed(1)} ms</div>
          <div>áudio: {info.hasAudio ? 'sim' : 'não'}</div>
          <div>wake lock: {wakeActive ? 'ativo' : 'inativo'}</div>
          <div>fps de análise: — (Fase 3)</div>
        </div>
      )}

      <div className="controls">
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
          onClick={recording ? stopRecording : startRecording}
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
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            <span>Modo debug</span>
          </label>
          <div className="row">
            <button className="btn" onClick={goFullscreen}>
              Tela cheia
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
