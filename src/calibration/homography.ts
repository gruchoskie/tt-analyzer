import type { Point2 } from '../core/types';
import { mat3Inverse, mat3Mul, mat3NormalizeH, solveLinear, type Mat3 } from './linalg';

/**
 * Homografia H (3x3, ordem de linhas) que leva pontos `src` em pontos `dst`:
 * [x' y' w]^T = H [x y 1]^T. Usa DLT com normalização de Hartley e
 * mínimos quadrados quando há mais de 4 correspondências.
 */
export function computeHomography(src: Point2[], dst: Point2[]): Mat3 {
  if (src.length !== dst.length) throw new RangeError('Listas de pontos com tamanhos diferentes');
  if (src.length < 4) throw new RangeError('São necessários pelo menos 4 pontos');

  const Ts = normalization(src);
  const Td = normalization(dst);
  const s = src.map((p) => applyHomography(Ts, p));
  const d = dst.map((p) => applyHomography(Td, p));

  // Fixando h33 = 1: 2 equações por ponto, 8 incógnitas.
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const { x, y } = s[i];
    const { x: u, y: v } = d[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  // Equações normais (AᵀA h = Aᵀb): exato com 4 pontos, mínimos quadrados com mais.
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < 8; i++) {
      Atb[i] += rows[r][i] * rhs[r];
      for (let j = 0; j < 8; j++) AtA[i][j] += rows[r][i] * rows[r][j];
    }
  }
  let h: number[];
  try {
    h = solveLinear(AtA, Atb);
  } catch {
    throw new Error('Pontos degenerados (3 ou mais alinhados)');
  }
  const Hn: Mat3 = [...h, 1];
  // Desfaz a normalização: H = Td⁻¹ · Hn · Ts
  return mat3NormalizeH(mat3Mul(mat3Mul(mat3Inverse(Td), Hn), Ts));
}

/** Transformação de similaridade que centraliza os pontos e deixa a distância média = √2. */
function normalization(pts: Point2[]): Mat3 {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const meanDist = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
  if (meanDist < 1e-12) throw new Error('Pontos coincidentes');
  const s = Math.SQRT2 / meanDist;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

export function applyHomography(H: Mat3, p: Point2): Point2 {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function invertHomography(H: Mat3): Mat3 {
  return mat3NormalizeH(mat3Inverse(H));
}

/** Erro médio (na unidade de `dst`) ao levar `src` por H. */
export function reprojectionError(H: Mat3, src: Point2[], dst: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const q = applyHomography(H, src[i]);
    sum += Math.hypot(q.x - dst[i].x, q.y - dst[i].y);
  }
  return sum / src.length;
}
