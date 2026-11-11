import type { Point2 } from '../core/types';

/** Como um vídeo com object-fit: contain é encaixado no elemento. */
export interface ContainTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function containTransform(videoW: number, videoH: number, elW: number, elH: number): ContainTransform {
  if (videoW <= 0 || videoH <= 0 || elW <= 0 || elH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(elW / videoW, elH / videoH);
  return { scale, offsetX: (elW - videoW * scale) / 2, offsetY: (elH - videoH * scale) / 2 };
}

export function videoToElement(t: ContainTransform, p: Point2): Point2 {
  return { x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY };
}

export function elementToVideo(t: ContainTransform, p: Point2): Point2 {
  return { x: (p.x - t.offsetX) / t.scale, y: (p.y - t.offsetY) / t.scale };
}
