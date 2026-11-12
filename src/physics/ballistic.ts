import type { Point2, Point3 } from '../core/types';
import { solveLinear } from '../calibration/linalg';
import { GRAVITY_M_S2 } from './constants';

/**
 * Trajetória balística a partir de 1 câmera.
 *
 * Com a câmera estimada pela calibração (matriz P), cada posição da bola na
 * imagem diz em que raio 3D ela está, mas não a que distância. Entre duas
 * batidas, porém, a bola segue (quase) uma parábola: p(τ) = p0 + v0·τ − g·τ²/2·ẑ.
 * São só 6 incógnitas, e cada quadro dá 2 equações lineares nelas; o quique,
 * que fica no plano da mesa (onde a homografia é exata), amarra o fim.
 *
 * Ignora o arrasto do ar: a bola real perde velocidade no voo, então a
 * velocidade média sai boa e a de saída sai um pouco baixa.
 */

export interface BallisticFit {
  /** Instante de referência (ms) de p0/v0. */
  tRef: number;
  p0: Point3;
  /** m/s */
  v0: Point3;
  /** Erro médio de reprojeção (px). */
  rmsPx: number;
  /** Covariância 6×6 de [p0, v0] (m, m/s). */
  cov: number[][];
  n: number;
}

export interface FitPoint {
  t: number;
  x: number;
  y: number;
}

export function positionAt(fit: Pick<BallisticFit, 'tRef' | 'p0' | 'v0'>, t: number): Point3 {
  const s = (t - fit.tRef) / 1000;
  return {
    x: fit.p0.x + fit.v0.x * s,
    y: fit.p0.y + fit.v0.y * s,
    z: fit.p0.z + fit.v0.z * s - (GRAVITY_M_S2 * s * s) / 2,
  };
}

export function velocityAt(fit: Pick<BallisticFit, 'tRef' | 'v0'>, t: number): Point3 {
  const s = (t - fit.tRef) / 1000;
  return { x: fit.v0.x, y: fit.v0.y, z: fit.v0.z - GRAVITY_M_S2 * s };
}

export function project(P: number[], p: Point3): Point2 & { w: number } {
  const w = P[8] * p.x + P[9] * p.y + P[10] * p.z + P[11];
  return { x: (P[0] * p.x + P[1] * p.y + P[2] * p.z + P[3]) / w, y: (P[4] * p.x + P[5] * p.y + P[6] * p.z + P[7]) / w, w };
}

/** Mínimos quadrados: devolve x e (AᵀA)⁻¹. */
export function leastSquares(A: number[][], b: number[]): { x: number[]; inv: number[][] } {
  const n = A[0].length;
  const N = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const r = new Array<number>(n).fill(0);
  for (let k = 0; k < A.length; k++) {
    const a = A[k];
    for (let i = 0; i < n; i++) {
      r[i] += a[i] * b[k];
      for (let j = 0; j < n; j++) N[i][j] += a[i] * a[j];
    }
  }
  const x = solveLinear(N, r);
  const inv = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let c = 0; c < n; c++) {
    const e = new Array<number>(n).fill(0);
    e[c] = 1;
    const col = solveLinear(N, e);
    for (let i = 0; i < n; i++) inv[i][c] = col[i];
  }
  return { x, inv };
}

/**
 * Ajusta a parábola aos pontos da imagem.
 * `end` (opcional) amarra a posição num instante (ex.: centro da bola no quique),
 * com incerteza `endSigmaM`.
 */
export function fitBallistic(
  pts: FitPoint[],
  P: number[],
  tRef: number,
  end?: { t: number; p: Point3; sigmaM?: number },
  sigmaPx = 1,
): BallisticFit | null {
  if (pts.length < (end ? 3 : 4)) return null;
  const g = GRAVITY_M_S2;
  let depth = pts.map(() => 1);
  let sol: { x: number[]; inv: number[][] } | null = null;
  // 3 passadas: na 1ª o peso de cada linha não está em px; depois divide pela profundidade
  for (let it = 0; it < 3; it++) {
    const A: number[][] = [];
    const b: number[] = [];
    pts.forEach((p, k) => {
      const s = (p.t - tRef) / 1000;
      const w = depth[k] * sigmaPx;
      for (const [row, u] of [[0, p.x], [1, p.y]] as const) {
        const q = [0, 1, 2, 3].map((c) => P[row * 4 + c] - u * P[8 + c]);
        A.push([q[0], q[1], q[2], q[0] * s, q[1] * s, q[2] * s].map((v) => v / w));
        b.push((-q[3] + (q[2] * g * s * s) / 2) / w);
      }
    });
    if (end) {
      const s = (end.t - tRef) / 1000;
      const sg = end.sigmaM ?? 0.02;
      A.push([1, 0, 0, s, 0, 0].map((v) => v / sg), [0, 1, 0, 0, s, 0].map((v) => v / sg), [0, 0, 1, 0, 0, s].map((v) => v / sg));
      b.push(end.p.x / sg, end.p.y / sg, (end.p.z + (g * s * s) / 2) / sg);
    }
    try {
      sol = leastSquares(A, b);
    } catch {
      return null;
    }
    const f = { tRef, p0: { x: sol.x[0], y: sol.x[1], z: sol.x[2] }, v0: { x: sol.x[3], y: sol.x[4], z: sol.x[5] } };
    depth = pts.map((p) => Math.max(1e-3, Math.abs(project(P, positionAt(f, p.t)).w)));
  }
  if (!sol) return null;
  const fit = { tRef, p0: { x: sol.x[0], y: sol.x[1], z: sol.x[2] }, v0: { x: sol.x[3], y: sol.x[4], z: sol.x[5] } };
  let se = 0;
  for (const p of pts) {
    const q = project(P, positionAt(fit, p.t));
    se += (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  }
  const rmsPx = Math.sqrt(se / pts.length);
  // incerteza: escala pelo resíduo real (no mínimo o ruído nominal)
  const k2 = Math.max(1, (rmsPx / sigmaPx) ** 2);
  const cov = sol.inv.map((r) => r.map((v) => v * k2));
  if (!Number.isFinite(rmsPx) || [...sol.x].some((v) => !Number.isFinite(v))) return null;
  return { ...fit, rmsPx, cov, n: pts.length };
}
