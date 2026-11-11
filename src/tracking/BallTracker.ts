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
  /** Deslocamento mínimo entre as 2 primeiras detecções (a bola se mexe; reflexos parados não). */
  minInitMovePx: number;
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
  /** Candidatos do quadro anterior enquanto não há rastro. */
  private tentative: { ms: number; cands: TrackCandidate[] } | null = null;
  private trail: TrackPoint[] = [];
  private window: ('m' | 'p' | 'n')[] = [];
  private totalMeasured = 0;
  private totalPredicted = 0;
  private processed = 0;
  private radius = 4;

  constructor(readonly opts: TrackerOptions = DEFAULT_TRACKER_OPTIONS) {}

  reset(): void {
    this.kf = null;
    this.tentative = null;
    this.trail = [];
    this.window = [];
    this.missing = 0;
    this.totalMeasured = this.totalPredicted = this.processed = 0;
  }

  get state(): TrackState {
    if (this.kf) return this.missing > 0 ? 'coasting' : 'tracking';
    return this.tentative ? 'tentative' : 'lost';
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
      // Sem rastro: tenta iniciar com um par de detecções em quadros seguidos,
      // com movimento plausível; escolhe o par de maior pontuação.
      const good = candidates.filter((c) => c.score >= this.opts.minInitScore);
      const t = this.tentative;
      let pair: { a: TrackCandidate; b: TrackCandidate } | null = null;
      if (t && hubMs - t.ms > 0 && hubMs - t.ms <= 100) {
        let bestScore = -1;
        for (const a of t.cands)
          for (const b of good) {
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d < this.opts.minInitMovePx || d > this.opts.maxInitJumpPx) continue;
            const sc = a.score * b.score;
            if (sc > bestScore) {
              bestScore = sc;
              pair = { a, b };
            }
          }
      }
      if (pair && t) {
        const { a, b } = pair;
        const dt = (hubMs - t.ms) / 1000;
        this.kf = new Kalman2D(b.x, b.y, this.opts.kalman, (b.x - a.x) / dt, (b.y - a.y) / dt);
        this.lastMs = hubMs;
        this.missing = 0;
        this.radius = b.radius;
        this.tentative = null;
        this.trail = []; // novo rastro: não liga com o anterior
        detection = b;
        // a detecção anterior também entra no rastro
        this.pushPoint({ frameIndex: frameIndex - 1, hubMs: t.ms, x: a.x, y: a.y, kind: 'measured', radius: a.radius });
        point = this.makePoint(frameIndex, hubMs, 'measured');
      } else {
        this.tentative = good.length ? { ms: hubMs, cands: good } : null;
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

  private makePoint(frameIndex: number, hubMs: number, kind: TrackPoint['kind']): TrackPoint {
    const p = this.kf!.position;
    return { frameIndex, hubMs, x: p.x, y: p.y, kind, radius: this.radius };
  }

  private pushPoint(p: TrackPoint): void {
    this.trail.push(p);
  }
}
