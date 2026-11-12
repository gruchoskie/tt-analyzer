import { LM, type Hand, type Landmark, type PoseFrame } from './types';

/**
 * Golpes a partir da pose (pontos 3D do MediaPipe, em metros, centrados no quadril).
 *
 * - Velocidade do pulso e do cotovelo ("braço") relativa ao quadril: o
 *   deslocamento do corpo inteiro não entra. É uma ESTIMATIVA: o MediaPipe
 *   chuta a profundidade a partir de 1 imagem.
 * - Golpe = pico da velocidade do pulso da mão da raquete acima de ~3 m/s.
 * - Forehand x backhand: no pico, de que lado do corpo está o pulso (eixo dos
 *   ombros) e para onde ele se move. O forehand de um destro acontece do lado
 *   direito e vai para a esquerda; o backhand cruza o corpo e vai para fora.
 */

export interface Swing {
  /** Instante do pico (ms). */
  t: number;
  hand: Hand;
  /** Pico de velocidade do pulso e do cotovelo (m/s). */
  wristMps: number;
  armMps: number;
  type: 'forehand' | 'backhand';
  /** 0..1 */
  confidence: number;
}

export interface SwingOptions {
  minWristMps: number;
  /** Meia-janela do máximo local (ms). */
  peakWindowMs: number;
  minGapMs: number;
  /** Visibilidade mínima dos pontos usados. */
  minVisibility: number;
}

export const DEFAULT_SWING_OPTIONS: SwingOptions = { minWristMps: 3, peakWindowMs: 180, minGapMs: 350, minVisibility: 0.4 };

interface Sample {
  t: number;
  wrist: [Landmark, Landmark];
  elbow: [Landmark, Landmark];
  shoulders: [Landmark, Landmark];
  ok: [boolean, boolean];
}

const sub = (a: Landmark, b: Landmark) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a: { x: number; y: number; z: number }) => Math.hypot(a.x, a.y, a.z);
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 0 = esquerda, 1 = direita. */
const idx = (h: Hand) => (h === 'esquerda' ? 0 : 1);

export class SwingDetector {
  private readonly opts: SwingOptions;
  private samples: Sample[] = [];
  /** Velocidades (m/s) por mão, alinhadas a samples (NaN = sem dado). */
  private speeds: { wrist: [number, number]; elbow: [number, number] }[] = [];
  private next = 1;
  private lastSwingT = -Infinity;
  /** Soma dos picos por mão (para descobrir a mão da raquete). */
  private readonly handScore: [number, number] = [0, 0];
  readonly swings: Swing[] = [];

  constructor(
    /** Mão da raquete; 'auto' = a que faz os picos mais fortes. */
    private hand: Hand | 'auto' = 'auto',
    opts: Partial<SwingOptions> = {},
  ) {
    this.opts = { ...DEFAULT_SWING_OPTIONS, ...opts };
  }

  setHand(h: Hand | 'auto'): void {
    this.hand = h;
  }

  /** Mão da raquete em uso (a escolhida ou a detectada). */
  racketHand(): Hand {
    if (this.hand !== 'auto') return this.hand;
    return this.handScore[0] > this.handScore[1] * 1.2 ? 'esquerda' : 'direita';
  }

  push(f: Pick<PoseFrame, 't' | 'world'>): Swing[] {
    const w = f.world;
    if (w.length < 33) return [];
    const last = this.samples[this.samples.length - 1];
    if (last && f.t <= last.t) return [];
    if (last && f.t - last.t > 400) this.reset();
    const vis = (i: number) => (w[i].visibility ?? 1) >= this.opts.minVisibility;
    const s: Sample = {
      t: f.t,
      wrist: [w[LM.leftWrist], w[LM.rightWrist]],
      elbow: [w[LM.leftElbow], w[LM.rightElbow]],
      shoulders: [w[LM.leftShoulder], w[LM.rightShoulder]],
      ok: [vis(LM.leftWrist) && vis(LM.leftElbow), vis(LM.rightWrist) && vis(LM.rightElbow)],
    };
    this.samples.push(s);
    this.speeds.push({ wrist: [NaN, NaN], elbow: [NaN, NaN] });
    const n = this.samples.length;
    // velocidade centrada no quadro anterior (diferença entre vizinhos)
    if (n >= 3) {
      const a = this.samples[n - 3], c = this.samples[n - 1];
      const dt = (c.t - a.t) / 1000;
      const sp = this.speeds[n - 2];
      for (const h of [0, 1] as const) {
        if (!a.ok[h] || !c.ok[h] || !this.samples[n - 2].ok[h]) continue;
        sp.wrist[h] = norm(sub(c.wrist[h], a.wrist[h])) / dt;
        sp.elbow[h] = norm(sub(c.elbow[h], a.elbow[h])) / dt;
      }
    }
    // descarta o que é velho
    while (this.samples.length > 2 && this.samples[0].t < f.t - 2000) {
      this.samples.shift();
      this.speeds.shift();
      this.next = Math.max(1, this.next - 1);
    }
    return this.evaluate(false);
  }

  flush(): Swing[] {
    const out = this.evaluate(true);
    this.reset();
    return out;
  }

  private reset(): void {
    this.samples = [];
    this.speeds = [];
    this.next = 1;
  }

  private evaluate(final: boolean): Swing[] {
    const out: Swing[] = [];
    const W = this.opts.peakWindowMs;
    const lastT = this.samples.length ? this.samples[this.samples.length - 1].t : -Infinity;
    // o último índice com velocidade é n-2
    while (this.next < this.samples.length - 1) {
      const i = this.next;
      const t = this.samples[i].t;
      if (!final && lastT - t < W) break;
      this.next++;
      for (const h of [0, 1] as const) {
        const v = this.speeds[i].wrist[h];
        if (!(v >= this.opts.minWristMps)) continue;
        let isMax = true;
        for (let j = 0; j < this.speeds.length && isMax; j++) {
          if (j === i || Math.abs(this.samples[j].t - t) > W) continue;
          const u = this.speeds[j].wrist[h];
          if (u > v || (u === v && j < i)) isMax = false;
        }
        if (!isMax) continue;
        this.handScore[h] += v;
        const hand = this.racketHand();
        if (idx(hand) !== h) continue;
        if (t - this.lastSwingT < this.opts.minGapMs) continue;
        const sw = this.classify(i, h, hand);
        this.lastSwingT = t;
        this.swings.push(sw);
        out.push(sw);
      }
    }
    return out;
  }

  private classify(i: number, h: 0 | 1, hand: Hand): Swing {
    const s = this.samples[i];
    const a = this.samples[Math.max(0, i - 1)], c = this.samples[Math.min(this.samples.length - 1, i + 1)];
    // eixo lateral do corpo, apontando para o lado da mão da raquete
    let lat = sub(s.shoulders[1], s.shoulders[0]);
    const ln = norm(lat) || 1;
    lat = { x: lat.x / ln, y: lat.y / ln, z: lat.z / ln };
    if (hand === 'esquerda') lat = { x: -lat.x, y: -lat.y, z: -lat.z };
    const mid = { x: (s.shoulders[0].x + s.shoulders[1].x) / 2, y: (s.shoulders[0].y + s.shoulders[1].y) / 2, z: (s.shoulders[0].z + s.shoulders[1].z) / 2 };
    const offset = dot(sub(s.wrist[h], mid), lat); // m, + = lado da raquete
    const dt = (c.t - a.t) / 1000 || 1;
    const vel = sub(c.wrist[h], a.wrist[h]);
    const vLat = dot(vel, lat) / dt; // m/s, + = indo para o lado da raquete
    const vPeak = this.speeds[i].wrist[h];
    const score = offset / 0.2 - vLat / Math.max(vPeak, 1);
    return {
      t: s.t,
      hand,
      wristMps: vPeak,
      armMps: Number.isFinite(this.speeds[i].elbow[h]) ? this.speeds[i].elbow[h] : 0,
      type: score >= 0 ? 'forehand' : 'backhand',
      confidence: Math.min(1, Math.abs(score) / 1.5),
    };
  }
}
