import { useEffect, useMemo, useRef, useState } from 'react';
import { rescaleCalibration } from '../calibration/calibrate';
import type { TableCalibration } from '../calibration/types';
import { extensionForMime } from '../camera/mime';
import { formatBytes, formatDuration } from '../physics/units';
import { getStore } from '../storage/storeSingleton';
import type { SessionRecord } from '../storage/types';
import { CalibrationEditor } from './CalibrationEditor';
import { navigate } from './route';
import { TableOverlay } from './TableOverlay';
import { useVideoBox } from './useVideoBox';
import { usePref } from './prefs';
import { TrackOverlay, type TrackOverlayHandle } from './TrackOverlay';
import { useBallTracking } from './useBallTracking';
import { makeTimestamp } from '../core/clock';
import type { BallColor } from '../tracking/classicDetector';
import type { BallProfile } from '../tracking/ballProfile';
import { useBounces } from './useBounces';
import { BounceMap } from './BounceMap';
import { BounceOverlay } from './BounceOverlay';
import { ShotList } from './ShotList';
import { usePose } from './usePose';
import { PoseOverlay } from './PoseOverlay';
import { StrokePanel } from './StrokePanel';
import { buildStrokes } from '../pose/strokes';
import type { Hand } from '../pose/types';
import { decodeRecordingOnsets } from '../physics/playbackAudio';

export function PlayerScreen({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<SessionRecord | null | undefined>(undefined);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [calibrating, setCalibrating] = useState(false);
  const [showTable, setShowTable] = usePref<boolean>('showTable', true);
  const box = useVideoBox(videoRef, url);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await (await getStore()).get(id);
      if (!alive) return;
      setSession(s ?? null);
      setName(s?.name ?? '');
      setCameraId(s?.cameras[0]?.cameraId ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const cam = session?.cameras.find((c) => c.cameraId === cameraId);
  const storedCal = cam && session ? (session.calibrations[cam.cameraId] ?? null) : null;
  const activeCal = useMemo(
    () => (storedCal && box ? rescaleCalibration(storedCal, box.videoW, box.videoH) : null),
    [storedCal, box],
  );

  const startCalibration = () => {
    videoRef.current?.pause();
    setCalibrating(true);
  };

  // Fase 3: rastreio da bola durante a reprodução.
  const [tracking, setTracking] = usePref<boolean>('tracking', true);
  const [ballColor] = usePref<BallColor>('ballColor', 'auto');
  const [analysisWidth] = usePref<number>('analysisWidth', 640);
  const [debug] = usePref<boolean>('debug', false);
  const [ballProfile] = usePref<BallProfile | null>('ballProfile', null);
  const trackOverlayRef = useRef<TrackOverlayHandle>(null);
  // Fase 4: quiques (precisa de calibração) e tocs da trilha de áudio.
  const bounce = useBounces(activeCal, tracking && !calibrating);
  const [audioState, setAudioState] = useState<'sem' | 'lendo' | 'ok' | 'falhou'>('sem');
  const { pipelineRef, snapshot: track, error: trackError } = useBallTracking({
    videoRef,
    overlayRef: trackOverlayRef,
    enabled: tracking && !!url && !calibrating,
    cameraId: cam?.cameraId ?? 'cam',
    calibration: activeCal,
    ballColor,
    analysisWidth,
    showCandidates: debug,
    profile: ballProfile,
    onResult: bounce.onResult,
  });

  const { reset: resetBounces, flush: flushBounces, addOnsets } = bounce;
  // Fase 6: pose dos jogadores.
  const [showPose, setShowPose] = usePref<boolean>('showPose', false);
  const [racketHand] = usePref<Hand | 'auto'>('racketHand', 'auto');
  const pose = usePose({
    videoRef,
    enabled: showPose && !!url && !calibrating,
    calibration: activeCal,
    clockMs: () => (videoRef.current?.currentTime ?? 0) * 1000,
    hand: racketHand,
  });
  const strokes = useMemo(() => buildStrokes(pose.swings, bounce.bounces), [pose.swings, bounce.bounces]);
  const { reset: resetPose, flush: flushPose } = pose;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !showPose) return;
    const onSeek = () => resetPose();
    const onEnded = () => flushPose();
    v.addEventListener('seeking', onSeek);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('seeking', onSeek);
      v.removeEventListener('ended', onEnded);
    };
  }, [showPose, url, resetPose, flushPose]);

  // Envia cada quadro exibido para análise (tempo = tempo do vídeo).
  useEffect(() => {
    const v = videoRef.current as
      | (HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number; presentedFrames: number }) => void) => number;
          cancelVideoFrameCallback?: (id: number) => void;
        })
      | null;
    if (!v || !tracking || !url || calibrating) return;
    let handle = 0;
    let raf = 0;
    let last = -1;
    const sessionId = session?.id ?? null;
    const send = (mediaTime: number, frameIndex: number) =>
      pipelineRef.current?.submit({ frameIndex, timestamp: makeTimestamp(mediaTime * 1000), sessionId });
    if (typeof v.requestVideoFrameCallback === 'function') {
      const tick = (_now: number, m: { mediaTime: number; presentedFrames: number }) => {
        send(m.mediaTime, m.presentedFrames);
        handle = v.requestVideoFrameCallback!(tick);
      };
      handle = v.requestVideoFrameCallback(tick);
    } else {
      let i = 0;
      const tick = () => {
        if (!v.paused && v.currentTime !== last) {
          last = v.currentTime;
          send(v.currentTime, i++);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    // pular no vídeo recomeça o rastro e o mapa de quiques
    const onSeek = () => {
      pipelineRef.current?.reset();
      resetBounces();
    };
    const onEnded = () => flushBounces();
    v.addEventListener('seeking', onSeek);
    v.addEventListener('ended', onEnded);
    return () => {
      v.cancelVideoFrameCallback?.(handle);
      cancelAnimationFrame(raf);
      v.removeEventListener('seeking', onSeek);
      v.removeEventListener('ended', onEnded);
    };
  }, [tracking, url, calibrating, pipelineRef, session?.id, resetBounces, flushBounces]);

  const saveCalibration = async (cal: TableCalibration) => {
    if (!session) return;
    const calibrations = { ...session.calibrations, [cal.cameraId]: cal };
    await (await getStore()).update(session.id, { calibrations });
    setSession({ ...session, calibrations });
    setCalibrating(false);
    setShowTable(true);
  };

  useEffect(() => {
    if (!session || !cam) return;
    let objectUrl: string | null = null;
    let alive = true;
    void (async () => {
      const blob = await (await getStore()).getVideo(session.id, cam.cameraId, cam.mimeType);
      if (!alive) return;
      if (!blob) {
        setError('O vídeo desta sessão não foi encontrado.');
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      if (cam.hasAudio) {
        setAudioState('lendo');
        const a = await decodeRecordingOnsets(blob);
        if (!alive) return;
        if (a) {
          addOnsets(a.onsets, a.durationMs, true);
          setAudioState('ok');
        } else setAudioState('falhou');
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, cam]);

  // Vídeos webm gravados pelo Chrome não têm duração no cabeçalho: força o cálculo.
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || Number.isFinite(v.duration)) return;
    const reset = () => {
      v.removeEventListener('durationchange', reset);
      v.currentTime = 0;
    };
    v.addEventListener('durationchange', reset);
    v.currentTime = 1e7;
  };

  const saveName = async () => {
    if (!session || name === session.name) return;
    await (await getStore()).rename(session.id, name);
    setSession({ ...session, name: name.trim() || 'Sessão sem nome' });
  };

  if (session === undefined) return <div className="page muted">Carregando…</div>;
  if (session === null)
    return (
      <div className="page">
        <p>Sessão não encontrada.</p>
        <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
          ← Sessões
        </button>
      </div>
    );

  return (
    <div className="page player">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'sessions' })}>
          ← Sessões
        </button>
        <input
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Nome da sessão"
        />
      </header>

      {session.cameras.length > 1 && (
        <div className="row">
          {session.cameras.map((c) => (
            <button key={c.cameraId} className={`btn ${c.cameraId === cameraId ? 'btn-primary' : ''}`} onClick={() => setCameraId(c.cameraId)}>
              {c.label || c.cameraId}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p className="error-text">{error}</p>
      ) : (
        <div className="player-stage">
          <video
            ref={videoRef}
            className="player-video"
            src={url ?? undefined}
            controls={!calibrating}
            playsInline
            onLoadedMetadata={onLoadedMetadata}
          />
          {!calibrating && showTable && <TableOverlay box={box} calibration={activeCal} />}
          {!calibrating && tracking && <TrackOverlay ref={trackOverlayRef} box={box} />}
          {!calibrating && showPose && <PoseOverlay box={box} poses={pose.poses} />}
          {!calibrating && bounce.active && (
            <BounceOverlay box={box} bounces={bounce.bounces} clockMs={() => (videoRef.current?.currentTime ?? 0) * 1000} />
          )}
          {calibrating && cam && (
            <CalibrationEditor
              videoRef={videoRef}
              box={box}
              cameraId={cam.cameraId}
              initial={storedCal}
              onSave={saveCalibration}
              onCancel={() => setCalibrating(false)}
            />
          )}
        </div>
      )}

      {cam && (
        <dl className="facts">
          <div>
            <dt>Data</dt>
            <dd>{new Date(session.createdAt).toLocaleString('pt-BR')}</dd>
          </div>
          <div>
            <dt>Duração</dt>
            <dd>{formatDuration(cam.durationMs)}</dd>
          </div>
          <div>
            <dt>Resolução</dt>
            <dd>
              {cam.width}×{cam.height}
            </dd>
          </div>
          <div>
            <dt>fps medido</dt>
            <dd>{cam.measuredFps.toFixed(1)}</dd>
          </div>
          <div>
            <dt>Tamanho</dt>
            <dd>{formatBytes(cam.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Áudio</dt>
            <dd>{cam.hasAudio ? 'Sim' : 'Não'}</dd>
          </div>
          <div>
            <dt>Modo</dt>
            <dd>{session.mode === '2d' ? '2D (1 câmera)' : `3D (${session.cameras.length} câmeras)`}</dd>
          </div>
          <div>
            <dt>Calibração</dt>
            <dd>{activeCal ? 'Feita' : storedCal ? 'Resolução diferente' : 'Não feita'}</dd>
          </div>
        </dl>
      )}

      {tracking && track && !calibrating && (
        <p className="small track-line">
          Bola detectada em {(100 * (track.last?.stats.trackedRate ?? 0)).toFixed(0)}% dos quadros rastreados ·{' '}
          {track.pipeline.analysisFps.toFixed(0)} fps de análise · {track.pipeline.workMs.toFixed(1)} ms/quadro
          {track.pipeline.dropped > 0 && ` · ${track.pipeline.dropped} quadros descartados`}
          {!activeCal && ' · calibre a mesa para limitar a busca à região do jogo'}
        </p>
      )}
      {trackError && <p className="error-text small">Rastreio: {trackError}</p>}

      {tracking && !calibrating && url && (
        <section className="bounce-section">
          <h3>Quiques</h3>
          {activeCal ? (
            <>
              <BounceMap bounces={bounce.bounces} audio={bounce.audio} onReset={bounce.reset} />
              <ShotList bounces={bounce.bounces} />
              <p className="small muted">
                *Velocidade é uma estimativa: com 1 câmera a altura da bola no ar vem de uma câmera aproximada (tirada dos cantos da
                mesa) e de uma parábola ajustada entre a batida e o quique. A margem (±) soma o ruído do rastro, o erro da câmera (~5%)
                e o instante do quique. É a velocidade média da jogada; a de saída da raquete é um pouco maior (o ar freia a bola). Em
                30 fps a margem é maior.
              </p>
              <p className="small muted">
                Os quiques aparecem enquanto o vídeo toca (a análise acompanha a reprodução; pular no vídeo recomeça o mapa).
                Posição na mesa com erro típico de 3 a 8 cm (1 câmera, 2D).
                {audioState === 'ok' && ' O som da gravação confirma os quiques ("toc" a até 60 ms).'}
                {audioState === 'lendo' && ' Lendo o áudio da gravação…'}
                {audioState === 'falhou' && ' Não consegui ler o áudio desta gravação: quiques só pela imagem.'}
                {' '}Direção (cruzada, paralela, meio) pela posição lateral de onde a bola veio e de onde quicou.
              </p>
            </>
          ) : (
            <p className="small muted">Calibre a mesa para ver os quiques e o mapa de calor.</p>
          )}
        </section>
      )}
      {showPose && !calibrating && url && (
        <section className="bounce-section">
          <h3>Golpes (pose)</h3>
          <StrokePanel strokes={strokes} status={pose.status} error={pose.error} onReset={pose.reset} inferMs={pose.perf.ms} />
          <p className="small muted">
            *Estimativas. A pose (MediaPipe) chuta a profundidade a partir de uma imagem, então a velocidade do pulso e do braço é
            aproximada e relativa ao quadril. Forehand ou backhand sai do lado do corpo em que o pulso está no pico do golpe; o saque
            vem da bola. O <strong>índice de potência</strong> (0–100) combina a velocidade da bola (60%) e a do pulso (40%): serve para
            comparar golpes, não é força. Com a câmera atrás da mesa, o jogador de perto aparece de costas e o de longe, pequeno.
          </p>
        </section>
      )}
      {session.status === 'interrupted' && (
        <p className="muted small">Esta gravação foi interrompida (app fechado ou bateria). O que foi salvo até ali está disponível.</p>
      )}

      {url && cam && !calibrating && (
        <div className="row">
          <button className={`btn ${activeCal ? '' : 'btn-primary'}`} onClick={startCalibration}>
            {activeCal ? 'Ajustar calibração da mesa' : 'Calibrar mesa'}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
            <span>Rastrear a bola</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showPose} onChange={(e) => setShowPose(e.target.checked)} />
            <span>Pose e golpes</span>
          </label>
          {activeCal && (
            <label className="toggle">
              <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} />
              <span>Mostrar mesa</span>
            </label>
          )}
          <a className="btn" href={url} download={`${session.name.replace(/[^\w\- ]+/g, '_')}.${extensionForMime(cam.mimeType)}`}>
            Baixar vídeo
          </a>
        </div>
      )}
    </div>
  );
}
