import { GATE_CHI2_99, Kalman2D, type KalmanOptions } from './kalman';

/** Candidato já convertido para px do vídeo original. */
export interface TrackCandidate {
  x: number;
  y: number;
  radius: number;
  score: number;
}

export interface TrackPoint {
  frameIndex: number;
  hubMs: number;
  x: number;
  y: number;
  /** measured = houve detecção (posição filtrada); predicted = falha preenchida pelo Kalman. */
  kind: 'measured' | 'predicted';
  radius: number;
}

export type TrackState = 'lost' | 'tentative' | 'tracking' | 'coasting';

export interface TrackerOptions {
  kalman: KalmanOptions;
  /** Quadros seguidos sem detecção antes de desistir do rastro. */
  maxMissing: number;
  gateChi2: number;
  /** Raio mínimo do gate em px (evita gate minúsculo com o filtro "confiante"). */
  minGatePx: number;
  /** Salto máximo entre as 2 primeiras detecções para iniciar um rastro (px). */
  maxInitJumpPx: number;
  /** Deslocamento mínimo entre as primeiras detecções (a bola se mexe; reflexos parados não). */
  minInitMovePx: number;
  /** Detecções seguidas e coerentes exigidas para iniciar um rastro (2 ou 3). */
  initFrames: 2 | 3;
  /** Velocidade máxima plausível (px/s); acima disso a associação é recusada. */
  maxSpeedPx: number;
  minInitScore: number;
  /** Duração do rastro desenhado (ms). */
  trailMs: number;
  /** Janela da taxa de detecção (quadros). */
  statsWindow: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  kalman: { model: 'cv', processNoise: 6000, measNoise: 2, initialVelStd: 1500 },
  maxMissing: 6,
  gateChi2: GATE_CHI2_99,
  minGatePx: 12,
  maxInitJumpPx: 120,
  minInitMovePx: 1.5,
  initFrames: 3,
  maxSpeedPx: 12000,
  minInitScore: 0.3,
  trailMs: 700,
  statsWindow: 120,
};

export interface TrackStep {
  state: TrackState;
  /** Candidato associado neste quadro (null se nenhum). */
  detection: TrackCandidate | null;
  /** Ponto do rastro neste quadro (null se perdido). */
  point: TrackPoint | null;
}

export interface TrackerStats {
  framesProcessed: number;
  /** Quadros com bola detectada / quadros processados (janela). */
  detectionRate: number;
  /** Detectados / (detectados + preenchidos) enquanto havia rastro: qualidade do rastreio. */
  trackedRate: number;
  /** Totais desde o início/reset. */
  totalMeasured: number;
  totalPredicted: number;
}

/** Associa as detecções de cada quadro a um rastro suavizado por Kalman. */
export class BallTracker {
  private kf: Kalman2D | null = null;
  private lastMs = 0;
  private missing = 0;
  /** Candidatos dos quadros anteriores enquanto não há rastro (mais recente por último). */
  private history: { ms: number; frameIndex: number; cands: TrackCandidate[] }[] = [];
  private trail: TrackPoint[] = [];
  private window: ('m' | 'p' | 'n')[] = [];
  private totalMeasured = 0;
  private totalPredicted = 0;
  private processed = 0;
  private radius = 4;

  constructor(readonly opts: TrackerOptions = DEFAULT_TRACKER_OPTIONS) {}

  reset(): void {
    this.kf = null;
    this.history = [];
    this.trail = [];
    this.window = [];
    this.missing = 0;
    this.totalMeasured = this.totalPredicted = this.processed = 0;
  }

  get state(): TrackState {
    if (this.kf) return this.missing > 0 ? 'coasting' : 'tracking';
    return this.history.length ? 'tentative' : 'lost';
  }

  getTrail(): readonly TrackPoint[] {
    return this.trail;
  }

  getStats(): TrackerStats {
    const w = this.window;
    const m = w.filter((v) => v === 'm').length;
    const p = w.filter((v) => v === 'p').length;
    return {
      framesProcessed: this.processed,
      detectionRate: w.length ? m / w.length : 0,
      trackedRate: m + p ? m / (m + p) : 0,
      totalMeasured: this.totalMeasured,
      totalPredicted: this.totalPredicted,
    };
  }

  step(hubMs: number, frameIndex: number, candidates: TrackCandidate[]): TrackStep {
    this.processed++;
    let detection: TrackCandidate | null = null;
    let point: TrackPoint | null = null;

    if (this.kf) {
      const dt = Math.min(0.2, Math.max(0, (hubMs - this.lastMs) / 1000));
      this.kf.predict(dt);
      const pred = this.kf.position;
      let best: TrackCandidate | null = null;
      let bestCost = Infinity;
      for (const c of candidates) {
        const d2 = this.kf.mahalanobis2(c.x, c.y);
        const inGate = d2 <= this.opts.gateChi2 || Math.hypot(c.x - pred.x, c.y - pred.y) <= this.opts.minGatePx;
        if (!inGate) continue;
        // fisicamente impossível desde a última posição conhecida?
        const last = this.trail[this.trail.length - 1];
        if (last && dt > 0 && Math.hypot(c.x - last.x, c.y - last.y) / Math.max(dt, (hubMs - last.hubMs) / 1000) > this.opts.maxSpeedPx)
          continue;
        const cost = d2 * (1.5 - c.score);
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
      if (best) {
        this.kf.update(best.x, best.y);
        this.missing = 0;
        this.radius = 0.7 * this.radius + 0.3 * best.radius;
        detection = best;
        point = this.makePoint(frameIndex, hubMs, 'measured');
      } else if (++this.missing <= this.opts.maxMissing) {
        point = this.makePoint(frameIndex, hubMs, 'predicted');
      } else {
        this.kf = null;
        this.missing = 0;
      }
      this.lastMs = hubMs;
    }

    if (!this.kf && !point) {
      // Sem rastro: tenta iniciar com detecções em quadros seguidos que formem
      // um movimento plausível (velocidade e direção coerentes).
      const good = candidates.filter((c) => c.score >= this.opts.minInitScore);
      const init = this.findInit(hubMs, good);
      if (init) {
        const { seq } = init;
        const b = seq[seq.length - 1];
        const a = seq[seq.length - 2];
        const dt = (hubMs - init.prevMs) / 1000;
        this.kf = new Kalman2D(b.x, b.y, this.opts.kalman, (b.x - a.x) / dt, (b.y - a.y) / dt);
        this.lastMs = hubMs;
        this.missing = 0;
        this.radius = b.radius;
        this.trail = []; // novo rastro: não liga com o anterior
        // as detecções anteriores também entram no rastro
        init.past.forEach((p) => this.pushPoint(p));
        this.history = [];
        detection = b;
        point = this.makePoint(frameIndex, hubMs, 'measured');
      } else {
        this.history.push({ ms: hubMs, frameIndex, cands: good });
        if (this.history.length > this.opts.initFrames - 1) this.history.shift();
        if (!good.length) this.history = [];
      }
    }

    if (point) this.pushPoint(point);
    const mark = point?.kind === 'measured' ? 'm' : point ? 'p' : 'n';
    if (mark === 'm') this.totalMeasured++;
    if (mark === 'p') this.totalPredicted++;
    this.window.push(mark);
    if (this.window.length > this.opts.statsWindow) this.window.shift();
    const cutoff = hubMs - this.opts.trailMs;
    while (this.trail.length && this.trail[0].hubMs < cutoff) this.trail.shift();
    return { state: this.state, detection, point };
  }

  /** Procura a melhor sequência de `initFrames` detecções coerentes terminando agora. */
  private findInit(
    hubMs: number,
    current: TrackCandidate[],
  ): { seq: TrackCandidate[]; prevMs: number; past: TrackPoint[] } | null {
    const need = this.opts.initFrames - 1;
    const h = this.history;
    if (h.length < need || !current.length) return null;
    const frames = h.slice(-need);
    // quadros precisam ser seguidos (sem buracos longos)
    let prev = hubMs;
    for (let i = frames.length - 1; i >= 0; i--) {
      const gap = prev - frames[i].ms;
      if (gap <= 0 || gap > 100) return null;
      prev = frames[i].ms;
    }
    const times = [...frames.map((f) => f.ms), hubMs];
    const lists = [...frames.map((f) => f.cands), current];
    let best: TrackCandidate[] | null = null;
    let bestScore = -1;
    const speedOk = (a: TrackCandidate, b: TrackCandidate, dtMs: number) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      return d >= this.opts.minInitMovePx && d <= this.opts.maxInitJumpPx && d / (dtMs / 1000) <= this.opts.maxSpeedPx;
    };
    const walk = (k: number, seq: TrackCandidate[], score: number) => {
      if (k === lists.length) {
        if (score > bestScore) {
          bestScore = score;
          best = seq;
        }
        return;
      }
      for (const c of lists[k]) {
        if (k > 0 && !speedOk(seq[k - 1], c, times[k] - times[k - 1])) continue;
        if (k > 1) {
          // previsão linear a partir dos 2 anteriores
          const a = seq[k - 2], b = seq[k - 1];
          const r = (times[k] - times[k - 1]) / (times[k - 1] - times[k - 2]);
          const px = b.x + (b.x - a.x) * r, py = b.y + (b.y - a.y) * r;
          const tol = Math.max(4 * c.radius, 0.5 * Math.hypot(b.x - a.x, b.y - a.y), 6);
          if (Math.hypot(c.x - px, c.y - py) > tol) continue;
        }
        walk(k + 1, [...seq, c], score * c.score);
      }
    };
    walk(0, [], 1);
    if (!best) return null;
    const seq: TrackCandidate[] = best;
    const past: TrackPoint[] = seq.slice(0, -1).map((c, i) => ({
      frameIndex: frames[i].frameIndex,
      hubMs: frames[i].ms,
      x: c.x,
      y: c.y,
      kind: 'measured',
      radius: c.radius,
    }));
    return { seq, prevMs: times[times.length - 2], past };
  }

  private makePoint(frameIndex: number, hubMs: number, kind: TrackPoint['kind']): TrackPoint {
    const p = this.kf!.position;
    return { frameIndex, hubMs, x: p.x, y: p.y, kind, radius: this.radius };
  }

  private pushPoint(p: TrackPoint): void {
    this.trail.push(p);
  }
}
