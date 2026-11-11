/** Copia o quadro atual do <video> para RGBA, opcionalmente reduzido para `maxWidth`. */
export function grabFrame(video: HTMLVideoElement, maxWidth = Infinity): { rgba: Uint8ClampedArray; width: number; height: number; scale: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height, scale };
}
