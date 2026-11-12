import type { Point2, Point3 } from '../core/types';
import { estimateCamera, type Quad } from '../calibration/calibrate';
import { NET_POSTS_M, TABLE_CORNERS_M } from '../calibration/table';
import { NET_HEIGHT_M } from '../physics/constants';
import { leastSquares } from '../physics/ballistic';
import { orthonormalize, projectionMatrix, projectP, rodrigues, rodriguesInv } from './geom3d';

/**
 * Calibração 3D de uma câmera (Fase 9): pose (rotação e posição) e distância
 * focal a partir de pontos 3D conhecidos — os 4 cantos da mesa (z = 0) e o
 * topo dos 2 postes da rede (z = 15,25 cm). Começa pela decomposição da
 * homografia da mesa e refina tudo junto por Levenberg-Marquardt minimizando
 * o erro de reprojeção (em px). Supõe pixels quadrados e centro óptico no
 * meio da imagem (vale para câmeras de celular).
 */

export interface CameraModel {
  width: number;
  height: number;
  f: number;
  cx: number;
  cy: number;
  /** mesa → câmera (linhas) */
  R: number[];
  t: number[];
  /** K[R|t] */
  P: number[];
  /** Centro óptico na mesa (m). */
  position: Point3;
  /** Erro de reprojeção médio (RMS) e máximo (px). */
  rmsPx: number;
  maxPx: number;
  /** Pontos usados (6 com os postes da rede). */
  points: number;
}

export interface PoseInput {
  width: number;
  height: number;
  corners: Quad;
  /** Topo dos postes da rede (esquerdo, direito), se marcados. */
  netPosts?: [Point2, Point2] | null;
}

/** Pontos 3D de referência correspondentes à entrada. */
export function referencePoints(withPosts: boolean): Point3[] {
  const pts: Point3[] = TABLE_CORNERS_M.map((p) => ({ x: p.x, y: p.y, z: 0 }));
  if (withPosts) for (const p of NET_POSTS_M) pts.push({ x: p.x, y: p.y, z: NET_HEIGHT_M });
  return pts;
}

function build(params: number[], width: number, height: number) {
  const [f, r0, r1, r2, t0, t1, t2] = params;
  const R = rodrigues([r0, r1, r2]);
  const t = [t0, t1, t2];
  return { f, R, t, P: projectionMatrix(f, width / 2, height / 2, R, t) };
}

function residuals(params: number[], world: Point3[], img: Point2[], width: number, height: number): number[] {
  const { P } = build(params, width, height);
  const r: number[] = [];
  world.forEach((w, i) => {
    const q = projectP(P, w);
    r.push(q.x - img[i].x, q.y - img[i].y);
  });
  return r;
}

export function calibrateCamera3D(input: PoseInput): CameraModel | null {
  const { width, height } = input;
  const est = estimateCamera(input.corners, width, height);
  if (!est) return null;
  const world = referencePoints(!!input.netPosts);
  const img: Point2[] = [...input.corners, ...(input.netPosts ? orderPosts(input.corners, input.netPosts) : [])];
  let params = [est.f, ...rodriguesInv(orthonormalize(est.R)), ...est.t];
  let r = residuals(params, world, img, width, height);
  let cost = r.reduce((a, v) => a + v * v, 0);
  let lambda = 1e-3;
  for (let it = 0; it < 60; it++) {
    // jacobiano numérico (7 parâmetros)
    const J: number[][] = r.map(() => new Array(7).fill(0));
    for (let k = 0; k < 7; k++) {
      const h = k === 0 ? Math.max(1e-3, params[0] * 1e-6) : 1e-6;
      const p2 = [...params];
      p2[k] += h;
      const r2 = residuals(p2, world, img, width, height);
      for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / h;
    }
    // (JᵀJ + λ diag) δ = −Jᵀr, como mínimos quadrados aumentados
    const A = J.map((row) => [...row]);
    const b = r.map((v) => -v);
    const diag = new Array(7).fill(0);
    for (const row of J) for (let k = 0; k < 7; k++) diag[k] += row[k] * row[k];
    for (let k = 0; k < 7; k++) {
      const e = new Array(7).fill(0);
      e[k] = Math.sqrt(lambda * Math.max(diag[k], 1e-9));
      A.push(e);
      b.push(0);
    }
    let step: number[];
    try {
      step = leastSquares(A, b).x;
    } catch {
      break;
    }
    const cand = params.map((v, k) => v + step[k]);
    const rc = residuals(cand, world, img, width, height);
    const cc = rc.reduce((a, v) => a + v * v, 0);
    if (cc < cost) {
      params = cand;
      r = rc;
      const done = cost - cc < 1e-10 * (1 + cost);
      cost = cc;
      lambda = Math.max(1e-9, lambda / 3);
      if (done) break;
    } else lambda *= 4;
    if (lambda > 1e8) break;
  }
  const { f, R, t, P } = build(params, width, height);
  // centro: C = −Rᵀ t
  const position = {
    x: -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
    y: -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
    z: -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]),
  };
  const errs: number[] = [];
  for (let i = 0; i < r.length; i += 2) errs.push(Math.hypot(r[i], r[i + 1]));
  const rmsPx = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  if (!Number.isFinite(rmsPx) || !(f > 0) || position.z <= 0) return null;
  return { width, height, f, cx: width / 2, cy: height / 2, R, t, P, position, rmsPx, maxPx: Math.max(...errs), points: world.length };
}

/** Avalia a calibração: alto = provável erro ao marcar os pontos. */
export function reprojectionQuality(m: CameraModel): 'boa' | 'aceitável' | 'alta' {
  const s = Math.max(m.width, m.height) / 1280;
  if (m.maxPx <= 4 * s) return 'boa';
  if (m.maxPx <= 10 * s) return 'aceitável';
  return 'alta';
}

/**
 * Gira os rótulos dos cantos em k × 90° (ordem cíclica). No modo 3D todas as
 * câmeras precisam usar o mesmo "perto" (o lado do hub); uma câmera do outro
 * lado da mesa gira 2 vezes, uma lateral 1 ou 3.
 */
export function rotateCorners(q: Quad, k: number): Quad {
  const n = ((k % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + n) % 4]) as Quad;
}

/** Postes da rede em qualquer ordem → [lado x = 0, lado x = 1,525] pela distância às laterais da mesa na imagem. */
export function orderPosts(corners: Quad, posts: [Point2, Point2]): [Point2, Point2] {
  const mid = (a: Point2, b: Point2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const left = mid(corners[0], corners[3]), right = mid(corners[1], corners[2]);
  const d = (p: Point2, q: Point2) => Math.hypot(p.x - q.x, p.y - q.y);
  const keep = d(posts[0], left) + d(posts[1], right);
  const swap = d(posts[1], left) + d(posts[0], right);
  return keep <= swap ? posts : [posts[1], posts[0]];
}
