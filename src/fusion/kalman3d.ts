import type { Point3 } from '../core/types';
import { GRAVITY_M_S2 } from '../physics/constants';

/**
 * Kalman 3D da bola: posição e velocidade, com a gravidade como entrada
 * conhecida. Os eixos são independentes (modelo de aceleração branca), então
 * são 3 filtros de 2 estados. Um salto grande na medida (quique, raquetada)
 * reinicia o filtro em vez de "puxar" a trajetória.
 */
interface Axis {
  x: number;
  v: number;
  P: [number, number, number, number];
}

export interface Kalman3DOptions {
  /** Aceleração não modelada (arrasto, efeito), m/s². */
  accelNoise: number;
  /** Ruído da medida (m). */
  measNoise: number;
  /** Inovação (em desvios) que indica quebra da trajetória. */
  gateSigma: number;
}

export const DEFAULT_KALMAN3D: Kalman3DOptions = { accelNoise: 10, measNoise: 0.015, gateSigma: 6 };

export class Kalman3D {
  private readonly o: Kalman3DOptions;
  private axes: Axis[] | null = null;
  private t = 0;
  private last: { t: number; p: Point3 } | null = null;
  private misses = 0;

  constructor(opts: Partial<Kalman3DOptions> = {}) {
    this.o = { ...DEFAULT_KALMAN3D, ...opts };
  }

  get initialized(): boolean {
    return !!this.axes;
  }

  reset(): void {
    this.axes = null;
    this.last = null;
    this.misses = 0;
  }

  /** Nova medida (ms, m). Devolve a estimada e se a trajetória quebrou aqui. */
  update(tMs: number, z: Point3, measNoise = this.o.measNoise): { p: Point3; v: Point3; broke: boolean } {
    const zs = [z.x, z.y, z.z];
    if (!this.axes || !this.last || tMs - this.t > 150) {
      const prev = this.last && tMs - this.last.t < 150 && tMs > this.last.t ? this.last : null;
      this.axes = zs.map((x, i) => ({
        x,
        v: prev ? (x - [prev.p.x, prev.p.y, prev.p.z][i]) / ((tMs - prev.t) / 1000) : 0,
        P: [measNoise ** 2, 0, 0, prev ? 2 * (measNoise / ((tMs - prev.t) / 1000)) ** 2 : 100],
      }));
      this.t = tMs;
      this.last = { t: tMs, p: z };
      return { ...this.state(), broke: false };
    }
    const dt = (tMs - this.t) / 1000;
    const q = this.o.accelNoise ** 2;
    const r = measNoise ** 2;
    // predição
    const pred = this.axes.map((a, i) => {
      const acc = i === 2 ? -GRAVITY_M_S2 : 0;
      const x = a.x + a.v * dt + 0.5 * acc * dt * dt;
      const v = a.v + acc * dt;
      const [p00, p01, p10, p11] = a.P;
      const P: [number, number, number, number] = [
        p00 + dt * (p10 + p01) + dt * dt * p11 + (q * dt ** 4) / 4,
        p01 + dt * p11 + (q * dt ** 3) / 2,
        p10 + dt * p11 + (q * dt ** 3) / 2,
        p11 + q * dt * dt,
      ];
      return { x, v, P };
    });
    // portão: inovação normalizada
    const nis = pred.reduce((s, a, i) => s + (zs[i] - a.x) ** 2 / (a.P[0] + r), 0);
    if (Math.sqrt(nis) > this.o.gateSigma) {
      this.misses++;
      // quique/raquetada: recomeça a partir das duas últimas medidas
      this.axes = null;
      const out = this.update(tMs, z, measNoise);
      return { ...out, broke: true };
    }
    this.misses = 0;
    this.axes = pred.map((a, i) => {
      const S = a.P[0] + r;
      const k0 = a.P[0] / S, k1 = a.P[2] / S;
      const y = zs[i] - a.x;
      return {
        x: a.x + k0 * y,
        v: a.v + k1 * y,
        P: [(1 - k0) * a.P[0], (1 - k0) * a.P[1], a.P[2] - k1 * a.P[0], a.P[3] - k1 * a.P[1]] as [number, number, number, number],
      };
    });
    this.t = tMs;
    this.last = { t: tMs, p: z };
    return { ...this.state(), broke: false };
  }

  state(): { p: Point3; v: Point3 } {
    const a = this.axes!;
    return { p: { x: a[0].x, y: a[1].x, z: a[2].x }, v: { x: a[0].v, y: a[1].v, z: a[2].v } };
  }
}
