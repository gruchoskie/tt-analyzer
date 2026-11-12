import { videoToElement } from '../calibration/viewport';
import { SKELETON } from '../pose/types';
import type { LivePose } from './usePose';
import type { VideoBox } from './useVideoBox';

/** Esqueleto dos jogadores sobre o vídeo (perto em ciano, longe em lilás). */
export function PoseOverlay({ box, poses }: { box: VideoBox | null; poses: LivePose[] }) {
  if (!box || !poses.length) return null;
  return (
    <svg className="table-overlay" style={{ left: box.left, top: box.top, width: box.elW, height: box.elH }} width={box.elW} height={box.elH} aria-hidden>
      {poses.map((p) => {
        const pt = (i: number) => videoToElement(box.t, { x: p.image[i].x * box.videoW, y: p.image[i].y * box.videoH });
        const vis = (i: number) => (p.image[i].visibility ?? 1) > 0.4;
        return (
          <g key={p.side} className={`pose ${p.side}`}>
            {SKELETON.filter(([a, b]) => vis(a) && vis(b)).map(([a, b]) => {
              const A = pt(a), B = pt(b);
              return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />;
            })}
            {[15, 16].filter(vis).map((i) => {
              const P = pt(i);
              return <circle key={i} cx={P.x} cy={P.y} r={5} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}
