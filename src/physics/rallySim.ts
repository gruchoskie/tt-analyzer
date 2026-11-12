import type { Point2, Point3 } from '../core/types';
import { GRAVITY_M_S2 } from './constants';
import type { PinholeCamera } from './pinhole';

/**
 * Simulador simples de troca de bola (só para testes): gravidade, quiques com
 * restituição e raquetadas que lançam a bola para um ponto alvo da mesa.
 */

export interface SimSegment {
  /** Onde a bola deve quicar (mesa, m). */
  to: Point2;
  /** Tempo de voo até o quique (s). */
  flight: number;
  /** true = começa com raquetada; false = sai direto do quique anterior (2º quique do saque). */
  hit: boolean;
}

export interface SimResult {
  /** Posição da bola a cada quadro. */
  frames: { t: number; p: Point3 }[];
  bounces: { t: number; p: Point2 }[];
  hits: { t: number; p: Point3 }[];
}

export function simulateRally(opts: {
  fps: number;
  /** Onde a bola é sacada (3D, m). */
  start: Point3;
  segments: SimSegment[];
  /** Tempo de voo depois do quique até a raquetada seguinte (s). */
  afterBounce?: number;
  restitution?: number;
}): SimResult {
  const g = GRAVITY_M_S2;
  const e = opts.restitution ?? 0.88;
  const after = opts.afterBounce ?? 0.28;
  const events: { t: number; p: Point3; v: Point3 }[] = [];
  const bounces: { t: number; p: Point2 }[] = [];
  const hits: { t: number; p: Point3 }[] = [];
  // trechos balísticos: [t0, p0, v0, t1]
  const arcs: { t0: number; p0: Point3; v0: Point3; t1: number }[] = [];
  let t = 0;
  let p = opts.start;
  let vAfterBounce: Point3 | null = null;
  for (const seg of opts.segments) {
    if (seg.hit && vAfterBounce) {
      // a bola sobe depois do quique e é rebatida `after` s depois
      const v = vAfterBounce;
      arcs.push({ t0: t, p0: p, v0: v, t1: t + after });
      p = { x: p.x + v.x * after, y: p.y + v.y * after, z: p.z + v.z * after - (g * after * after) / 2 };
      t += after;
      hits.push({ t, p });
    } else if (seg.hit) hits.push({ t, p });
    const T = seg.flight;
    const v0 = { x: (seg.to.x - p.x) / T, y: (seg.to.y - p.y) / T, z: (0 - p.z) / T + (g * T) / 2 };
    arcs.push({ t0: t, p0: p, v0, t1: t + T });
    t += T;
    p = { x: seg.to.x, y: seg.to.y, z: 0 };
    const vz = v0.z - g * T;
    vAfterBounce = { x: v0.x * 0.95, y: v0.y * 0.95, z: -vz * e };
    bounces.push({ t, p: seg.to });
    events.push({ t, p, v: vAfterBounce });
  }
  // voo final depois do último quique
  if (vAfterBounce) arcs.push({ t0: t, p0: p, v0: vAfterBounce, t1: t + after });
  const end = arcs[arcs.length - 1].t1;
  const frames: { t: number; p: Point3 }[] = [];
  for (let k = 0; k * (1 / opts.fps) <= end; k++) {
    const tk = k / opts.fps;
    const a = arcs.find((r) => tk >= r.t0 && tk < r.t1) ?? arcs[arcs.length - 1];
    const d = tk - a.t0;
    frames.push({ t: tk, p: { x: a.p0.x + a.v0.x * d, y: a.p0.y + a.v0.y * d, z: a.p0.z + a.v0.z * d - (g * d * d) / 2 } });
  }
  return { frames, bounces, hits };
}

/** Observações 2D (px) com ruído, como o rastreador entregaria. */
export function observe(
  sim: SimResult,
  cam: PinholeCamera,
  opts: { noisePx?: number; dropRate?: number; seed?: number; radiusM?: number } = {},
): { t: number; frameIndex: number; x: number; y: number }[] {
  let seed = opts.seed ?? 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = opts.noisePx ?? 0.5;
  const r = opts.radiusM ?? 0.02;
  const out: { t: number; frameIndex: number; x: number; y: number }[] = [];
  sim.frames.forEach((f, i) => {
    if (rnd() < (opts.dropRate ?? 0)) return;
    // o centro da bola fica 2 cm acima do ponto de contato no quique
    const q = cam.project({ x: f.p.x, y: f.p.y, z: f.p.z + r });
    out.push({ t: f.t * 1000, frameIndex: i, x: q.x + (rnd() - 0.5) * 2 * noise, y: q.y + (rnd() - 0.5) * 2 * noise });
  });
  return out;
}
