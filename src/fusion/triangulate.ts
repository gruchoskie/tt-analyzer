import type { Point2, Point3 } from '../core/types';
import { leastSquares } from '../physics/ballistic';
import { projectP } from './geom3d';

/**
 * Triangulação da bola com 2+ câmeras calibradas em 3D (Fase 9).
 * DLT por mínimos quadrados (linhas divididas pela profundidade, em px) e,
 * com 3+ câmeras, RANSAC sobre pares para descartar uma detecção errada.
 */

export interface View {
  cameraId: string;
  P: number[];
  x: number;
  y: number;
}

export interface Triangulated {
  p: Point3;
  /** Câmeras que concordam (inliers). */
  cameras: string[];
  /** Câmeras descartadas como detecção ruim. */
  rejected: string[];
  /** Erro de reprojeção médio dos inliers (px). */
  rmsPx: number;
}

export function triangulateDLT(views: View[]): Point3 | null {
  if (views.length < 2) return null;
  let w = views.map(() => 1);
  let X: number[] | null = null;
  for (let it = 0; it < 3; it++) {
    const A: number[][] = [];
    const b: number[] = [];
    views.forEach((v, k) => {
      for (const [row, u] of [[0, v.x], [1, v.y]] as const) {
        const q = [0, 1, 2, 3].map((c) => (v.P[row * 4 + c] - u * v.P[8 + c]) / w[k]);
        A.push([q[0], q[1], q[2]]);
        b.push(-q[3]);
      }
    });
    try {
      X = leastSquares(A, b).x;
    } catch {
      return null;
    }
    const p = { x: X[0], y: X[1], z: X[2] };
    w = views.map((v) => Math.max(1e-3, Math.abs(projectP(v.P, p).w)));
  }
  if (!X || X.some((v) => !Number.isFinite(v))) return null;
  return { x: X[0], y: X[1], z: X[2] };
}

export function reprojErr(v: View, p: Point3): number {
  const q = projectP(v.P, p);
  // ponto atrás da câmera: erro infinito
  if (q.w <= 0) return Infinity;
  return Math.hypot(q.x - v.x, q.y - v.y);
}

export function triangulate(views: View[], thresholdPx = 8): Triangulated | null {
  if (views.length < 2) return null;
  let best: { p: Point3; inl: View[] } | null = null;
  if (views.length === 2) {
    const p = triangulateDLT(views);
    if (p) best = { p, inl: views };
  } else {
    for (let i = 0; i < views.length; i++)
      for (let j = i + 1; j < views.length; j++) {
        const p = triangulateDLT([views[i], views[j]]);
        if (!p) continue;
        const inl = views.filter((v) => reprojErr(v, p) <= thresholdPx);
        if (inl.length < 2) continue;
        const score = inl.length * 1000 - inl.reduce((a, v) => a + reprojErr(v, p), 0);
        const bs = best ? best.inl.length * 1000 - best.inl.reduce((a, v) => a + reprojErr(v, best!.p), 0) : -Infinity;
        if (score > bs) best = { p, inl };
      }
    if (best) {
      const p = triangulateDLT(best.inl);
      if (p) best = { p, inl: best.inl };
    }
  }
  if (!best) return null;
  const errs = best.inl.map((v) => reprojErr(v, best!.p));
  return {
    p: best.p,
    cameras: best.inl.map((v) => v.cameraId),
    rejected: views.filter((v) => !best!.inl.includes(v)).map((v) => v.cameraId),
    rmsPx: Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length),
  };
}

/** Posição 2D interpolada no instante t (ms), se houver detecções dos dois lados a até maxGapMs. */
export function interpolateTrack(track: { t: number; x: number; y: number }[], t: number, maxGapMs = 40): Point2 | null {
  if (!track.length) return null;
  let lo = 0, hi = track.length - 1;
  if (t < track[0].t || t > track[hi].t) {
    const e = t < track[0].t ? track[0] : track[hi];
    return Math.abs(e.t - t) <= 2 ? { x: e.x, y: e.y } : null;
  }
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (track[m].t <= t) lo = m;
    else hi = m;
  }
  const a = track[lo], b = track[hi];
  if (b.t - a.t > maxGapMs) return null;
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
