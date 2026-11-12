import type { CameraId, Point2 } from '../core/types';
import { applyHomography, computeHomography, invertHomography } from './homography';
import type { Mat3 } from './linalg';
import { TABLE_CORNERS_M } from './table';
import type { TableCalibration } from './types';

export type Quad = [Point2, Point2, Point2, Point2];

/** Área com sinal (fórmula do laço); positiva = sentido anti-horário em eixos com y para cima. */
export function signedArea(pts: Point2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Ordena 4 toques em qualquer ordem como: perto-esquerda, perto-direita,
 * longe-direita, longe-esquerda (imagem com y para baixo: "perto" = mais embaixo).
 */
/**
 * Quanto 4 cantos (em ordem cíclica, começando por "perto-esquerda") são
 * consistentes com a mesa real (1,525 x 2,74 m) vista por uma câmera comum
 * (pixels quadrados, centro óptico no meio da imagem). Procura a distância
 * focal que deixa as duas direções da mesa perpendiculares e na mesma
 * escala; devolve o resíduo mínimo (0 = perfeito).
 */
export function rectangleResidual(q: Quad, imageWidth: number, imageHeight: number): number {
  return focalSearch(q, imageWidth, imageHeight).residual;
}

function focalSearch(q: Quad, imageWidth: number, imageHeight: number): { residual: number; f: number; H: Mat3 } {
  const cx = imageWidth / 2, cy = imageHeight / 2;
  const H = computeHomography(TABLE_CORNERS_M, q.map((p) => ({ x: p.x - cx, y: p.y - cy })));
  let best = Infinity, bestF = NaN;
  const D = Math.max(imageWidth, imageHeight);
  for (let k = 0; k <= 160; k++) {
    const f = D * 0.25 * Math.pow(24, k / 160); // 0,25D .. 6D
    const r1 = [H[0] / f, H[3] / f, H[6]];
    const r2 = [H[1] / f, H[4] / f, H[7]];
    const n1 = Math.hypot(r1[0], r1[1], r1[2]), n2 = Math.hypot(r2[0], r2[1], r2[2]);
    const cos = Math.abs(r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]) / (n1 * n2);
    const ratio = Math.abs(n1 - n2) / Math.max(n1, n2);
    if (cos + ratio < best) {
      best = cos + ratio;
      bestF = f;
    }
  }
  return { residual: best, f: bestF, H };
}

/**
 * Posição aproximada da câmera (m, no referencial da mesa, z = altura acima
 * do tampo) a partir dos 4 cantos, supondo pixels quadrados e centro óptico
 * no meio da imagem. Serve para correções finas (ex.: a bola tem 2 cm de raio);
 * a calibração 3D de verdade vem na Fase 9.
 */
export interface CameraEstimate {
  f: number;
  /** Centro óptico (m, referencial da mesa; z = altura acima do tampo). */
  position: Point2 & { z: number };
  /** Matriz de projeção 3×4 (linhas) mesa (m, z para cima) → pixels. */
  P: number[];
  /** Rotação mesa → câmera (linhas; colunas = eixos da mesa vistos pela câmera) e translação. */
  R: number[];
  t: number[];
}

export function estimateCamera(corners: Quad, imageWidth: number, imageHeight: number): CameraEstimate | null {
  let fs;
  try {
    fs = focalSearch(corners, imageWidth, imageHeight);
  } catch {
    return null;
  }
  const { f, H } = fs;
  if (!Number.isFinite(f)) return null;
  // M = K^-1 H = [r1 r2 t] / λ
  const m = (r: number, c: number) => (r < 2 ? H[r * 3 + c] / f : H[r * 3 + c]);
  const col = (c: number) => [m(0, c), m(1, c), m(2, c)];
  const m1 = col(0), m2 = col(1), m3 = col(2);
  let lam = 2 / (Math.hypot(m1[0], m1[1], m1[2]) + Math.hypot(m2[0], m2[1], m2[2]));
  if (m3[2] * lam < 0) lam = -lam; // mesa na frente da câmera
  const r1 = m1.map((v) => v * lam), r2 = m2.map((v) => v * lam), t = m3.map((v) => v * lam);
  let r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  // C = -R^T t, com R = [r1 r2 r3] (colunas)
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // z da mesa aponta para cima, onde está a câmera
  if (dot(r3, t) > 0) r3 = r3.map((v) => -v);
  const C = { x: -dot(r1, t), y: -dot(r2, t), z: -dot(r3, t) };
  if (!Number.isFinite(C.x + C.y + C.z)) return null;
  const cx = imageWidth / 2, cy = imageHeight / 2;
  const P: number[] = [];
  for (const [row, off] of [[0, cx], [1, cy], [2, 0]] as const) {
    for (let c = 0; c < 4; c++) {
      const R = [r1, r2, r3, t][c];
      P.push(row < 2 ? f * R[row] + off * R[2] : R[2]);
    }
  }
  const R = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  return { f, position: { x: C.x, y: C.y, z: C.z }, P, R, t };
}

/**
 * Ordena 4 cantos da mesa em [perto-esq, perto-dir, longe-dir, longe-esq]
 * para qualquer ângulo de câmera (atrás, diagonal ou lateral):
 *  - qual par de lados é a cabeceira (1,525 m) e qual é a lateral (2,74 m)
 *    sai da geometria da perspectiva (rectangleResidual);
 *  - "perto" é a cabeceira mais baixa na imagem (mais perto da câmera);
 *  - esquerda/direita vêm da orientação (câmera acima do tampo).
 */
export function orderCorners(pts: Point2[], imageWidth?: number, imageHeight?: number): Quad {
  if (pts.length !== 4) throw new RangeError('São necessários 4 cantos');
  const mx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const my = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  // ordem cíclica com área negativa (no sentido da vista de trás, y para baixo)
  let cyc = [...pts].sort((a, b) => Math.atan2(b.y - my, b.x - mx) - Math.atan2(a.y - my, a.x - mx));
  if (signedArea(cyc) > 0) cyc = cyc.reverse();
  const W = imageWidth ?? Math.max(...pts.map((p) => p.x)) + Math.min(...pts.map((p) => p.x));
  const Hh = imageHeight ?? Math.max(...pts.map((p) => p.y)) + Math.min(...pts.map((p) => p.y));
  // rotações cíclicas: k e k+2 dão o mesmo par de cabeceiras
  const rot = (k: number) => [0, 1, 2, 3].map((i) => cyc[(i + k) % 4]) as Quad;
  const mid = (a: Point2, b: Point2) => (a.y + b.y) / 2;
  const candidates = [0, 1].map((k) => {
    const q = rot(k);
    // perto = a cabeceira (lado 0→1 ou 2→3) mais baixa na imagem
    const q2 = mid(q[0], q[1]) >= mid(q[2], q[3]) ? q : rot(k + 2);
    let res = Infinity;
    try {
      res = rectangleResidual(q2, W, Hh);
    } catch {
      /* degenerado */
    }
    return { q: q2, res };
  });
  let pick = candidates[0].res <= candidates[1].res ? candidates[0] : candidates[1];
  const other = pick === candidates[0] ? candidates[1] : candidates[0];
  if (!Number.isFinite(pick.res) || other.res < pick.res * 1.15) {
    // ambíguo (quase de cima): a cabeceira é o par de lados mais curto
    const len = (q: Quad) => Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) + Math.hypot(q[3].x - q[2].x, q[3].y - q[2].y);
    pick = len(candidates[0].q) <= len(candidates[1].q) ? candidates[0] : candidates[1];
  }
  return pick.q;
}

export interface CalibrationCheck {
  ok: boolean;
  /** Problemas que impedem salvar. */
  errors: string[];
  /** Avisos (dá para salvar, mas a precisão pode cair). */
  warnings: string[];
}

/** Quanto um canto pode ficar fora da imagem (fração da largura/altura). */
export const OUTSIDE_MARGIN = 0.2;

/** Verifica se os 4 cantos marcados formam uma mesa plausível. */
export function checkCorners(c: Quad, imageWidth: number, imageHeight: number): CalibrationCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isConvexQuad(c)) {
    errors.push('Os cantos não formam um quadrilátero válido. Marque na ordem indicada.');
    return { ok: false, errors, warnings };
  }
  const areaFrac = Math.abs(signedArea(c)) / (imageWidth * imageHeight);
  if (areaFrac < 0.01) errors.push('A mesa está muito pequena na imagem. Aproxime a câmera.');
  else if (areaFrac < 0.05) warnings.push('A mesa ocupa pouco da imagem: a precisão será menor. Se puder, aproxime a câmera.');

  // câmera acima do tampo: a ordem perto-esq → perto-dir → longe-dir → longe-esq tem área negativa (y para baixo)
  if (signedArea(c) > 0) warnings.push('A ordem dos cantos parece espelhada (esquerda/direita trocadas). Confira.');

  // Um canto pode ficar um pouco fora do quadro (estimado pelas bordas da
  // mesa); longe demais, a extrapolação deixa de ser confiável.
  const out = (p: Point2, m: number) => p.x < -m * imageWidth || p.y < -m * imageHeight || p.x > imageWidth * (1 + m) || p.y > imageHeight * (1 + m);
  if (c.some((p) => out(p, OUTSIDE_MARGIN))) errors.push('Um dos cantos está longe demais, fora da imagem. Afaste ou levante o celular para a mesa aparecer.');
  else if (c.some((p) => out(p, 0.005)))
    warnings.push('Um canto ficou fora da imagem e foi estimado pelas bordas da mesa. Funciona, mas enquadrar a mesa inteira dá mais precisão.');
  return { ok: errors.length === 0, errors, warnings };
}

/** Cria a calibração a partir dos cantos em pixels (na resolução da imagem informada). */
export function createCalibration(
  cameraId: CameraId,
  cornersPx: Quad,
  imageWidth: number,
  imageHeight: number,
  now = Date.now(),
): TableCalibration {
  const homography = computeHomography(cornersPx, TABLE_CORNERS_M);
  return { cameraId, imageWidth, imageHeight, cornersPx, homography, createdAt: now };
}

/** Imagem (px) -> mesa (m). */
export function imageToTable(cal: TableCalibration, p: Point2): Point2 {
  return applyHomography(cal.homography, p);
}

/** Mesa (m) -> imagem (px). */
export function tableToImageMatrix(cal: TableCalibration): Mat3 {
  return invertHomography(cal.homography);
}

/**
 * Adapta a calibração para outra resolução da mesma câmera (mesma proporção).
 * Retorna null se a proporção mudou (é preciso calibrar de novo).
 */
export function rescaleCalibration(cal: TableCalibration, width: number, height: number): TableCalibration | null {
  if (cal.imageWidth === width && cal.imageHeight === height) return cal;
  const a0 = cal.imageWidth / cal.imageHeight;
  const a1 = width / height;
  if (Math.abs(a0 - a1) / a0 > 0.01) return null;
  const sx = width / cal.imageWidth;
  const sy = height / cal.imageHeight;
  const corners = cal.cornersPx.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
  const posts = cal.netPostsPx?.map((p) => ({ x: p.x * sx, y: p.y * sy })) as [Point2, Point2] | undefined;
  return { ...createCalibration(cal.cameraId, corners, width, height, cal.createdAt), ...(posts ? { netPostsPx: posts } : {}) };
}
