import type { Point2 } from '../core/types';

export interface Size {
  width: number;
  height: number;
}

/** Resolução de análise: largura alvo (sem aumentar), mantendo a proporção e com dimensões pares. */
export function analysisSize(video: Size, targetWidth: number): Size {
  const w = Math.min(video.width, targetWidth);
  const s = w / video.width;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(video.width * s), height: even(video.height * s) };
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Região de interesse a partir dos cantos da mesa (px do vídeo): a mesa,
 * folga lateral, e bastante espaço acima (a bola voa sobre a mesa).
 */
export function roiFromTable(corners: Point2[], video: Size): Rect {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    x0: Math.max(0, minX - 0.3 * w),
    x1: Math.min(video.width, maxX + 0.3 * w),
    y0: Math.max(0, minY - 1.2 * h),
    y1: Math.min(video.height, maxY + 0.15 * h),
  };
}

export function scaleRect(r: Rect, sx: number, sy: number): Rect {
  return { x0: r.x0 * sx, y0: r.y0 * sy, x1: r.x1 * sx, y1: r.y1 * sy };
}
