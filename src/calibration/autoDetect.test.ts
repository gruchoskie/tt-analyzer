import { describe, expect, it } from 'vitest';
import type { Point2 } from '../core/types';
import { detectTable, isTableDetection, rgbToHsv } from './autoDetect';

const W = 320;
const H = 180;
const CORNERS: Point2[] = [
  { x: 60, y: 160 },
  { x: 260, y: 160 },
  { x: 205, y: 65 },
  { x: 115, y: 65 },
];

function inside(q: Point2[], x: number, y: number) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s = Math.sign(c);
    if (!s) continue;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function scene(opts: { table: [number, number, number]; player?: boolean; noise?: number }) {
  const d = new Uint8ClampedArray(W * H * 4);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: [number, number, number] = [60, 55, 50]; // chão/parede
      if (inside(CORNERS, x + 0.5, y + 0.5)) {
        c = opts.table;
        // linha central e bordas brancas, rede
        if (Math.abs(x - 160) < 1 || Math.abs(y - 105) < 1.5) c = [235, 235, 235];
      }
      if (opts.player && x > 250 && x < 300 && y > 20 && y < 120) c = [30, 40, 150]; // camisa azul fora da mesa
      const j = (y * W + x) * 4;
      const n = (opts.noise ?? 0) * rnd();
      d[j] = c[0] + n;
      d[j + 1] = c[1] + n;
      d[j + 2] = c[2] + n;
      d[j + 3] = 255;
    }
  return d;
}

function maxCornerErr(found: Point2[]) {
  return Math.max(...found.map((p, i) => Math.hypot(p.x - CORNERS[i].x, p.y - CORNERS[i].y)));
}

describe('detecção automática da mesa', () => {
  it('HSV', () => {
    expect(rgbToHsv(0, 0, 255)[0]).toBeCloseTo(240);
    expect(rgbToHsv(0, 255, 0)[0]).toBeCloseTo(120);
  });

  it('acha os 4 cantos de mesa azul com linhas brancas e rede', () => {
    const r = detectTable(scene({ table: [20, 60, 140], noise: 8 }), W, H);
    expect(isTableDetection(r)).toBe(true);
    if (!isTableDetection(r)) return;
    expect(maxCornerErr(r.corners)).toBeLessThan(3);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('mesa verde', () => {
    const r = detectTable(scene({ table: [25, 100, 60], noise: 8 }), W, H);
    expect(isTableDetection(r) && maxCornerErr(r.corners)).toBeLessThan(3);
  });

  it('ignora outra região azul menor (camisa) ao lado', () => {
    const r = detectTable(scene({ table: [20, 60, 140], player: true, noise: 6 }), W, H);
    expect(isTableDetection(r) && maxCornerErr(r.corners)).toBeLessThan(3);
  });

  it('falha com mensagem quando não há mesa', () => {
    const d = new Uint8ClampedArray(W * H * 4).fill(90);
    const r = detectTable(d, W, H);
    expect(isTableDetection(r)).toBe(false);
    expect((r as { reason: string }).reason).toBe('sem-cor');
  });
});
