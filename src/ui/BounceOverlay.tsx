import { useEffect, useState } from 'react';
import { videoToElement } from '../calibration/viewport';
import type { BounceEvent } from '../physics/bounce';
import type { VideoBox } from './useVideoBox';

/** Marca na imagem os quiques recentes (somem em ~2 s). */
export function BounceOverlay({ box, bounces, clockMs }: { box: VideoBox | null; bounces: BounceEvent[]; clockMs: () => number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  if (!box) return null;
  const now = clockMs();
  const recent = bounces.slice(-6).filter((b) => now - b.t < 2000 && now >= b.t - 500);
  return (
    <svg className="table-overlay" style={{ left: box.left, top: box.top, width: box.elW, height: box.elH }} width={box.elW} height={box.elH} aria-hidden>
      {recent.map((b, i) => {
        const p = videoToElement(box.t, b.image);
        const age = Math.max(0, now - b.t) / 2000;
        return (
          <g key={`${b.t}-${i}`} opacity={1 - age}>
            <circle cx={p.x} cy={p.y} r={10 + 14 * age} className={`bounce-ring ${b.audio === 'confirmado' ? 'ok' : ''}`} />
            {b.shot.direction && (
              <text x={p.x} y={p.y - 18} className="bounce-tag">
                {b.shot.direction}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
