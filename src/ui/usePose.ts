import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { applyHomography } from '../calibration/homography';
import type { TableCalibration } from '../calibration/types';
import { PoseEngine, type DetectedPose } from '../pose/PoseEngine';
import { sideFromFeet } from '../pose/strokes';
import { SwingDetector, type Swing } from '../pose/swing';
import { LM, type Hand, type PlayerSide } from '../pose/types';

export type PoseStatus = 'desligada' | 'carregando' | 'ok' | 'erro';

export interface LivePose extends DetectedPose {
  side: PlayerSide;
}

/** Engine compartilhado (carregar o modelo de novo a cada tela é lento). */
let enginePromise: Promise<PoseEngine> | null = null;
function getEngine(): Promise<PoseEngine> {
  if (!enginePromise) enginePromise = PoseEngine.create().catch((e) => {
    enginePromise = null;
    throw e;
  });
  return enginePromise;
}

/**
 * Pose dos jogadores (Fase 6). Roda na thread principal, no máximo ~15 vezes
 * por segundo e menos se o aparelho estiver lento, para não roubar tempo do
 * rastreio da bola. Cada pessoa vira "perto" ou "longe" pelos pés na mesa
 * (com calibração) ou pelo tamanho na imagem (sem).
 */
export function usePose(opts: {
  videoRef: RefObject<HTMLVideoElement>;
  enabled: boolean;
  calibration: TableCalibration | null;
  /** Relógio dos quiques (ms). */
  clockMs: () => number;
  hand: Hand | 'auto';
}) {
  const { videoRef, enabled, calibration, hand } = opts;
  const clockRef = useRef(opts.clockMs);
  clockRef.current = opts.clockMs;
  const calRef = useRef(calibration);
  calRef.current = calibration;
  const [status, setStatus] = useState<PoseStatus>('desligada');
  const [error, setError] = useState<string | null>(null);
  const [poses, setPoses] = useState<LivePose[]>([]);
  const [swings, setSwings] = useState<{ side: PlayerSide; swing: Swing }[]>([]);
  const [perf, setPerf] = useState({ ms: 0, fps: 0, delegate: '' });
  const detRef = useRef<Record<PlayerSide, SwingDetector>>({ perto: new SwingDetector(hand), longe: new SwingDetector(hand) });
  const [racketHand, setRacketHand] = useState<Record<PlayerSide, Hand>>({ perto: 'direita', longe: 'direita' });

  useEffect(() => {
    detRef.current.perto.setHand(hand);
    detRef.current.longe.setHand(hand);
  }, [hand]);

  const reset = useCallback(() => {
    detRef.current = { perto: new SwingDetector(hand), longe: new SwingDetector(hand) };
    setSwings([]);
  }, [hand]);

  const flush = useCallback(() => {
    const got = (['perto', 'longe'] as const).flatMap((side) => detRef.current[side].flush().map((swing) => ({ side, swing })));
    if (got.length) setSwings((s) => [...s, ...got]);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) {
      setStatus('desligada');
      setPoses([]);
      return;
    }
    let stop = false;
    let engine: PoseEngine | null = null;
    let handle = 0;
    let lastRun = 0;
    let avgMs = 30;
    let runs = 0;
    let runsT0 = performance.now();
    setStatus('carregando');
    setError(null);

    const assign = (list: DetectedPose[]): LivePose[] => {
      const cal = calRef.current;
      const w = video.videoWidth, h = video.videoHeight;
      const feet = (p: DetectedPose) => {
        const a = p.image[LM.leftAnkle], b = p.image[LM.rightAnkle];
        return { x: ((a.x + b.x) / 2) * w, y: ((a.y + b.y) / 2) * h };
      };
      const size = (p: DetectedPose) => Math.max(...p.image.map((l) => l.y)) - Math.min(...p.image.map((l) => l.y));
      let out: LivePose[];
      if (cal && cal.imageWidth === w && cal.imageHeight === h) out = list.map((p) => ({ ...p, side: sideFromFeet(applyHomography(cal.homography, feet(p)).y) }));
      else {
        const order = [...list].sort((a, b) => size(b) - size(a));
        out = order.map((p, i) => ({ ...p, side: i === 0 ? 'perto' : 'longe' }));
      }
      // uma pessoa por lado (a maior)
      const best: Partial<Record<PlayerSide, LivePose>> = {};
      for (const p of out) if (!best[p.side] || size(p) > size(best[p.side]!)) best[p.side] = p;
      return Object.values(best) as LivePose[];
    };

    const tick = () => {
      if (stop) return;
      schedule();
      const now = performance.now();
      if (!engine || video.readyState < 2 || video.videoWidth === 0) return;
      if (now - lastRun < Math.max(66, 2.5 * avgMs)) return;
      lastRun = now;
      const t = clockRef.current();
      let found: DetectedPose[];
      try {
        found = engine.detect(video);
      } catch (e) {
        setError(`Pose: ${(e as Error).message}`);
        return;
      }
      const ms = performance.now() - now;
      avgMs = 0.8 * avgMs + 0.2 * ms;
      runs++;
      const live = assign(found);
      setPoses(live);
      const got: { side: PlayerSide; swing: Swing }[] = [];
      for (const p of live) if (p.world.length >= 33) for (const swing of detRef.current[p.side].push({ t, world: p.world })) got.push({ side: p.side, swing });
      if (got.length) setSwings((s) => [...s, ...got]);
      if (now - runsT0 > 1000) {
        setPerf({ ms: avgMs, fps: (runs * 1000) / (now - runsT0), delegate: engine.delegate });
        setRacketHand({ perto: detRef.current.perto.racketHand(), longe: detRef.current.longe.racketHand() });
        runs = 0;
        runsT0 = now;
      }
    };
    const schedule = () => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      handle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };

    getEngine()
      .then((e) => {
        if (stop) return;
        engine = e;
        setStatus('ok');
        schedule();
      })
      .catch((e) => {
        if (stop) return;
        setStatus('erro');
        setError(`Não foi possível carregar a pose (MediaPipe): ${(e as Error).message}`);
      });
    return () => {
      stop = true;
      const v = video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(handle);
    };
  }, [enabled, videoRef]);

  return { status, error, poses, swings, perf, racketHand, reset, flush };
}
