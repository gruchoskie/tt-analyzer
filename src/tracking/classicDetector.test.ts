import { describe, expect, it } from 'vitest';
import { ClassicDetector, connectedComponents, isBallColor, scoreBlobs, DEFAULT_DETECTOR_OPTIONS } from './classicDetector';
import { renderScene } from './synthetic';

const W = 320;
const H = 180;
const WHITE: [number, number, number] = [240, 240, 235];
const ORANGE: [number, number, number] = [250, 140, 40];

describe('cor da bola', () => {
  it('branca e laranja', () => {
    expect(isBallColor(240, 240, 235, 'branca')).toBe(true);
    expect(isBallColor(250, 140, 40, 'laranja')).toBe(true);
    expect(isBallColor(250, 140, 40, 'branca')).toBe(false);
    expect(isBallColor(240, 240, 235, 'laranja')).toBe(false);
    expect(isBallColor(30, 90, 60, 'auto')).toBe(false); // mesa verde
    expect(isBallColor(30, 60, 140, 'auto')).toBe(false); // mesa azul
    expect(isBallColor(200, 40, 40, 'auto')).toBe(false); // vermelho (borracha)
  });
});

describe('componentes conexos', () => {
  it('separa blobs e mede área/centro', () => {
    const m = new Uint8Array(10 * 5);
    // blob 2x2 em (1,1) e blob 3x1 em (6,3)
    [11, 12, 21, 22, 36, 37, 38].forEach((i) => (m[i] = 1));
    const blobs = connectedComponents(m, 10, 5);
    expect(blobs).toHaveLength(2);
    expect(blobs[0]).toMatchObject({ area: 4, minX: 1, maxX: 2 });
    expect(blobs[1].sx / blobs[1].area).toBe(7);
  });

  it('filtros de forma: disco passa, linha fina não', () => {
    const disc = { area: 13, sx: 13 * 5, sy: 13 * 5, minX: 3, maxX: 7, minY: 3, maxY: 7 };
    const line = { area: 12, sx: 0, sy: 0, minX: 0, maxX: 11, minY: 0, maxY: 0 };
    const c = scoreBlobs([disc, line], DEFAULT_DETECTOR_OPTIONS);
    expect(c).toHaveLength(1);
    expect(c[0].x).toBe(5);
  });
});

describe('detector clássico em quadros sintéticos', () => {
  function run(color: [number, number, number], withPlayer: boolean) {
    const det = new ClassicDetector();
    const errors: number[] = [];
    let found = 0;
    const N = 28; // a bola sai da imagem depois disso
    for (let i = 0; i < N; i++) {
      const bx = 40 + i * 8;
      const by = 120 - i * 5 + 0.25 * i * i;
      const frame = renderScene({
        width: W,
        height: H,
        ball: { x: bx, y: by, r: 2.5, color },
        player: withPlayer ? { x: 10 + i * 3, y: 20, w: 40, h: 60, color: WHITE } : null,
        noise: 6,
        seed: i + 1,
      });
      const c = det.detect(frame, W, H);
      if (i < 2) {
        expect(c).toHaveLength(0); // precisa de 2 quadros anteriores
        continue;
      }
      if (c.length) {
        found++;
        errors.push(Math.hypot(c[0].x - bx, c[0].y - by));
      }
    }
    return { rate: found / (N - 2), meanErr: errors.reduce((a, b) => a + b, 0) / errors.length };
  }

  it('acha bola branca em movimento com erro sub-pixel', () => {
    const r = run(WHITE, false);
    expect(r.rate).toBe(1);
    expect(r.meanErr).toBeLessThan(0.5);
  });

  it('acha bola laranja', () => {
    const r = run(ORANGE, false);
    expect(r.rate).toBe(1);
  });

  it('ignora o "jogador" de camisa branca (grande demais)', () => {
    const r = run(WHITE, true);
    expect(r.rate).toBeGreaterThan(0.9);
    expect(r.meanErr).toBeLessThan(0.5);
  });

  it('não detecta nada parado', () => {
    const det = new ClassicDetector();
    const still = renderScene({ width: W, height: H, ball: { x: 100, y: 100, r: 3, color: WHITE }, noise: 4 });
    for (let i = 0; i < 5; i++) expect(det.detect(still, W, H)).toHaveLength(0);
  });

  it('respeita a ROI', () => {
    const det = new ClassicDetector({ ...DEFAULT_DETECTOR_OPTIONS, roi: { x0: 200, y0: 0, x1: 320, y1: 180 } });
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      const frame = renderScene({ width: W, height: H, ball: { x: 50 + i * 6, y: 90, r: 3, color: WHITE } });
      hits += det.detect(frame, W, H).length;
    }
    expect(hits).toBe(0);
  });

  it('descarta quadro com mudança global (luz piscou)', () => {
    const det = new ClassicDetector();
    det.detect(renderScene({ width: W, height: H, background: [20, 20, 20] }), W, H);
    det.detect(renderScene({ width: W, height: H, background: [20, 20, 20] }), W, H);
    const c = det.detect(renderScene({ width: W, height: H, background: [230, 230, 230] }), W, H);
    expect(c).toHaveLength(0);
    expect(det.lastRejectedGlobal).toBe(true);
  });
});
