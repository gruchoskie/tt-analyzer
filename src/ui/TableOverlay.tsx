import { useEffect, useRef } from 'react';
import { tableToImageMatrix } from '../calibration/calibrate';
import { applyHomography } from '../calibration/homography';
import type { Mat3 } from '../calibration/linalg';
import { tableSegments, type Segment } from '../calibration/table';
import type { TableCalibration } from '../calibration/types';
import { videoToElement } from '../calibration/viewport';
import type { Point2 } from '../core/types';
import type { VideoBox } from './useVideoBox';

const STYLE: Record<Segment['kind'], { color: string; width: number }> = {
  grid: { color: 'rgba(255,255,255,0.28)', width: 1 },
  center: { color: 'rgba(255,255,255,0.6)', width: 1.5 },
  net: { color: '#ffb020', width: 3 },
  border: { color: '#2fbf71', width: 3 },
};

const SEGMENTS = tableSegments(0.25);

export interface OverlayMarker {
  /** Ponto em pixels do vídeo. */
  px: Point2;
  label?: string;
}

/** Desenha a mesa calibrada (bordas, rede, linha central e grade) sobre o vídeo. */
export function TableOverlay({
  box,
  calibration,
  markers = [],
}: {
  box: VideoBox | null;
  calibration: TableCalibration | null;
  markers?: OverlayMarker[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !box) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.elW * dpr);
    c.height = Math.round(box.elH * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.elW, box.elH);
    if (calibration) {
      let H: Mat3;
      try {
        H = tableToImageMatrix(calibration);
      } catch {
        return;
      }
      const toEl = (p: Point2) => videoToElement(box.t, applyHomography(H, p));
      ctx.lineCap = 'round';
      for (const s of SEGMENTS) {
        const a = toEl(s.a);
        const b = toEl(s.b);
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
        ctx.strokeStyle = STYLE[s.kind].color;
        ctx.lineWidth = STYLE[s.kind].width;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (const m of markers) {
      const p = videoToElement(box.t, m.px);
      ctx.fillStyle = '#ffb020';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.font = '600 14px system-ui, sans-serif';
        const w = ctx.measureText(m.label).width + 12;
        const lx = Math.min(Math.max(p.x - w / 2, 4), box.elW - w - 4);
        const ly = p.y - 36 < 4 ? p.y + 14 : p.y - 36;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(lx, ly, w, 24);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.label, lx + 6, ly + 17);
      }
    }
  }, [box, calibration, markers]);

  if (!box) return null;
  return (
    <canvas
      ref={canvasRef}
      className="table-overlay"
      style={{ left: box.left, top: box.top, width: box.elW, height: box.elH }}
      aria-hidden
    />
  );
}
