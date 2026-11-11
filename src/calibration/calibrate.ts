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
export function orderCorners(pts: Point2[]): Quad {
  if (pts.length !== 4) throw new RangeError('São necessários 4 cantos');
  const byY = [...pts].sort((a, b) => b.y - a.y);
  const near = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const far = byY.slice(2).sort((a, b) => a.x - b.x);
  return [near[0], near[1], far[1], far[0]];
}

export interface CalibrationCheck {
  ok: boolean;
  /** Problemas que impedem salvar. */
  errors: string[];
  /** Avisos (dá para salvar, mas a precisão pode cair). */
  warnings: string[];
}

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

  const nearW = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  const farW = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
  if (farW > nearW * 1.05) warnings.push('O lado "longe" parece maior que o "perto". Confira se a ordem dos cantos está certa.');
  if (c[0].y < c[3].y || c[1].y < c[2].y)
    warnings.push('Os cantos "perto" deveriam estar mais embaixo na imagem que os "longe". Confira a ordem.');

  const margin = 2;
  if (c.some((p) => p.x < -margin || p.y < -margin || p.x > imageWidth + margin || p.y > imageHeight + margin))
    errors.push('Um dos cantos está fora da imagem. A mesa inteira precisa aparecer.');
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
  return { ...createCalibration(cal.cameraId, corners, width, height, cal.createdAt), netPostsPx: cal.netPostsPx };
}
