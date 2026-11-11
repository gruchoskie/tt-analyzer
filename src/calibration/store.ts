import type { CameraId } from '../core/types';
import type { TableCalibration } from './types';

/**
 * Calibração "atual" de cada câmera deste aparelho (o tripé costuma ficar no
 * mesmo lugar entre gravações). Ao gravar, uma cópia vai para a sessão.
 */
const key = (cameraId: CameraId) => `tt.calibration.${cameraId}`;

export function isValidCalibration(v: unknown): v is TableCalibration {
  const c = v as TableCalibration;
  return (
    !!c &&
    typeof c.cameraId === 'string' &&
    c.imageWidth > 0 &&
    c.imageHeight > 0 &&
    Array.isArray(c.cornersPx) &&
    c.cornersPx.length === 4 &&
    c.cornersPx.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) &&
    Array.isArray(c.homography) &&
    c.homography.length === 9 &&
    c.homography.every(Number.isFinite)
  );
}

export function loadCurrentCalibration(cameraId: CameraId): TableCalibration | null {
  try {
    const raw = localStorage.getItem(key(cameraId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return isValidCalibration(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrentCalibration(cal: TableCalibration): void {
  try {
    localStorage.setItem(key(cal.cameraId), JSON.stringify(cal));
  } catch {
    /* sem espaço / modo privado: segue só em memória */
  }
}

export function clearCurrentCalibration(cameraId: CameraId): void {
  try {
    localStorage.removeItem(key(cameraId));
  } catch {
    /* ignora */
  }
}
