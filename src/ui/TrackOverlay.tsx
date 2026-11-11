import { forwardRef, useImperativeHandle, useRef } from 'react';
import { videoToElement } from '../calibration/viewport';
import type { FrameResult } from '../tracking/protocol';
import type { VideoBox } from './useVideoBox';

export interface TrackOverlayHandle {
  draw(result: FrameResult | null, opts?: { showCandidates?: boolean }): void;
}

/**
 * Rastro da bola sobre o vídeo, desenhado direto no canvas a cada resultado
 * (sem re-render do React a 60 fps).
 */
export const TrackOverlay = forwardRef<TrackOverlayHandle, { box: VideoBox | null }>(function TrackOverlay({ box }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef(box);
  boxRef.current = box;

  useImperativeHandle(ref, () => ({
    draw(result, opts) {
      const c = canvasRef.current;
      const b = boxRef.current;
      if (!c || !b) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(b.elW * dpr);
      const H = Math.round(b.elH * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, b.elW, b.elH);
      if (!result) return;
      const toEl = (x: number, y: number) => videoToElement(b.t, { x, y });

      if (opts?.showCandidates) {
        ctx.strokeStyle = 'rgba(80, 200, 255, 0.9)';
        ctx.lineWidth = 1;
        for (const cd of result.candidates) {
          const p = toEl(cd.x, cd.y);
          const r = Math.max(5, cd.radius * b.t.scale + 3);
          ctx.strokeRect(p.x - r, p.y - r, 2 * r, 2 * r);
        }
      }

      const trail = result.trail;
      if (trail.length) {
        const t1 = trail[trail.length - 1].hubMs;
        const span = Math.max(1, t1 - trail[0].hubMs);
        ctx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const p = trail[i];
          const age = (t1 - p.hubMs) / span;
          const pa = toEl(a.x, a.y);
          const pb = toEl(p.x, p.y);
          ctx.strokeStyle = p.kind === 'measured' ? `rgba(255, 176, 32, ${1 - age * 0.85})` : `rgba(120, 180, 255, ${1 - age * 0.85})`;
          ctx.lineWidth = 4 - age * 2.5;
          ctx.setLineDash(p.kind === 'predicted' ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      if (result.point) {
        const p = toEl(result.point.x, result.point.y);
        const r = Math.max(6, result.point.radius * b.t.scale + 4);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = result.point.kind === 'measured' ? '#ffb020' : '#78b4ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  }));

  if (!box) return null;
  return (
    <canvas
      ref={canvasRef}
      className="table-overlay"
      style={{ left: box.left, top: box.top, width: box.elW, height: box.elH }}
      aria-hidden
    />
  );
});
