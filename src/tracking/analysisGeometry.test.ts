import { describe, expect, it } from 'vitest';
import { analysisSize, roiFromTable, scaleRect } from './analysisGeometry';

describe('geometria da análise', () => {
  it('reduz 720p para 640x360 e não amplia', () => {
    expect(analysisSize({ width: 1280, height: 720 }, 640)).toEqual({ width: 640, height: 360 });
    expect(analysisSize({ width: 1920, height: 1080 }, 480)).toEqual({ width: 480, height: 270 });
    expect(analysisSize({ width: 320, height: 240 }, 640)).toEqual({ width: 320, height: 240 });
  });

  it('ROI cobre a mesa e o espaço acima, dentro da imagem', () => {
    const corners = [
      { x: 240, y: 650 },
      { x: 1040, y: 650 },
      { x: 820, y: 260 },
      { x: 460, y: 260 },
    ];
    const r = roiFromTable(corners, { width: 1280, height: 720 });
    expect(r.x0).toBe(0); // 240 - 240
    expect(r.x1).toBe(1280);
    expect(r.y0).toBe(0); // 260 - 468 → limitado a 0
    expect(r.y1).toBeCloseTo(708.5);
    expect(scaleRect(r, 0.5, 0.5).y1).toBeCloseTo(354.25);
  });
});
