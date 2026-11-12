import type { Point2, Point3 } from '../core/types';

/** Matriz 3×3 em linhas. */
export type M3 = number[];

export const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
export const sub3 = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const len3 = (a: Point3) => Math.hypot(a.x, a.y, a.z);

/** Rotação a partir do vetor de Rodrigues (eixo × ângulo). */
export function rodrigues(r: number[]): M3 {
  const th = norm3(r);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [kx, ky, kz] = r.map((v) => v / th);
  const c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [
    c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s,
    ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s,
    kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v,
  ];
}

/** Vetor de Rodrigues de uma rotação. */
export function rodriguesInv(R: M3): number[] {
  const tr = R[0] + R[4] + R[8];
  const th = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  if (th < 1e-9) return [0, 0, 0];
  if (Math.PI - th < 1e-6) {
    // 180°: eixo pela diagonal
    const x = Math.sqrt(Math.max(0, (R[0] + 1) / 2)), y = Math.sqrt(Math.max(0, (R[4] + 1) / 2)), z = Math.sqrt(Math.max(0, (R[8] + 1) / 2));
    const k = [x, R[1] >= 0 ? y : -y, R[2] >= 0 ? z : -z];
    return k.map((v) => v * th);
  }
  const k = [R[7] - R[5], R[2] - R[6], R[3] - R[1]].map((v) => v / (2 * Math.sin(th)));
  return k.map((v) => v * th);
}

/** Ortonormaliza (Gram-Schmidt nas colunas) mantendo a orientação. */
export function orthonormalize(R: M3): M3 {
  const c0 = [R[0], R[3], R[6]], c1 = [R[1], R[4], R[7]];
  const n0 = norm3(c0);
  const e0 = c0.map((v) => v / n0);
  const p = dot3(c1, e0);
  const u1 = c1.map((v, i) => v - p * e0[i]);
  const n1 = norm3(u1);
  const e1 = u1.map((v) => v / n1);
  const e2 = cross3(e0, e1);
  return [e0[0], e1[0], e2[0], e0[1], e1[1], e2[1], e0[2], e1[2], e2[2]];
}

/** Matriz de projeção 3×4 (linhas) = K [R | t]. */
export function projectionMatrix(f: number, cx: number, cy: number, R: M3, t: number[]): number[] {
  const P: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let c = 0; c < 4; c++) {
      const rc = c < 3 ? R[row * 3 + c] : t[row];
      const r2 = c < 3 ? R[6 + c] : t[2];
      P.push(row === 0 ? f * rc + cx * r2 : row === 1 ? f * rc + cy * r2 : rc);
    }
  return P;
}

export function projectP(P: number[], p: Point3): Point2 & { w: number } {
  const w = P[8] * p.x + P[9] * p.y + P[10] * p.z + P[11];
  return { x: (P[0] * p.x + P[1] * p.y + P[2] * p.z + P[3]) / w, y: (P[4] * p.x + P[5] * p.y + P[6] * p.z + P[7]) / w, w };
}
