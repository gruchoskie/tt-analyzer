import { describe, expect, it } from 'vitest';
import { ClassicDetector, connectedComponents, isBallColor, scoreBlobs, DEFAULT_DETECTOR_OPTIONS } from './classicDetector';
import { renderScene } from './synthetic';
import { sampleBall } from './ballProfile';

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

  it('fundo claro com luz LED piscando em faixas: acha só a bola', () => {
    const det = new ClassicDetector();
    let found = 0, wrong = 0;
    for (let i = 0; i < 24; i++) {
      const bx = 40 + i * 9, by = 90;
      const f = renderScene({ width: W, height: H, background: [180, 182, 184], ball: { x: bx, y: by, r: 3, color: WHITE }, noise: 4, seed: i + 1 });
      // faixas que andam a cada quadro (obturador linha a linha + LED a 100/120 Hz)
      for (let y = 0; y < H; y++) {
        const off = 28 * Math.sin(y / 11 + i * 1.7);
        for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) f[(y * W + x) * 4 + k] += off;
      }
      const c = det.detect(f, W, H);
      if (i < 2) continue;
      if (c.some((q) => Math.hypot(q.x - bx, q.y - by) < 3)) found++;
      wrong += c.filter((q) => Math.hypot(q.x - bx, q.y - by) >= 6).length;
    }
    expect(found).toBeGreaterThanOrEqual(18);
    expect(wrong).toBeLessThanOrEqual(2);
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

  it('mudança global de luz (luz piscou) não vira candidato', () => {
    const det = new ClassicDetector();
    det.detect(renderScene({ width: W, height: H, background: [20, 20, 20] }), W, H);
    det.detect(renderScene({ width: W, height: H, background: [20, 20, 20] }), W, H);
    const c = det.detect(renderScene({ width: W, height: H, background: [230, 230, 230] }), W, H);
    expect(c).toHaveLength(0);
  });
});

describe('detector com conhecimento da calibração e da bola escolhida', () => {
  // prior simples: região do jogo = imagem toda, bola com raio ~2,5 px
  const prior = {
    spanMin: new Int16Array(H).fill(0),
    spanMax: new Int16Array(H).fill(W),
    rMin: new Float32Array(H).fill(1.2),
    rMax: new Float32Array(H).fill(4.5),
    rTypical: new Float32Array(H).fill(2.5),
  };

  function runWith(opts: Partial<import('./classicDetector').DetectorOptions>, distractor: [number, number, number]) {
    const det = new ClassicDetector({ ...DEFAULT_DETECTOR_OPTIONS, ...opts });
    let ballHits = 0;
    let falseHits = 0;
    for (let i = 0; i < 20; i++) {
      const bx = 40 + i * 9, by = 140 - i * 4;
      // "mão" de 14x14 px que se mexe (cor clara)
      const frame = renderScene({
        width: W,
        height: H,
        ball: { x: bx, y: by, r: 2.5, color: ORANGE },
        player: { x: 200 + ((i * 7) % 40), y: 30 + ((i * 5) % 30), w: 14, h: 14, color: distractor },
        noise: 5,
        seed: 100 + i,
      });
      const c = det.detect(frame, W, H);
      if (i < 2) continue;
      for (const k of c) {
        if (Math.hypot(k.x - bx, k.y - by) < 3) ballHits++;
        else falseHits++;
      }
    }
    return { ballHits, falseHits };
  }

  it('sem calibração, uma "mão" clara do tamanho certo vira candidato', () => {
    const r = runWith({ color: 'auto' }, WHITE);
    expect(r.falseHits).toBeGreaterThan(0);
  });

  it('com o tamanho esperado da bola, a "mão" é descartada', () => {
    const r = runWith({ color: 'auto', prior }, WHITE);
    expect(r.falseHits).toBe(0);
    expect(r.ballHits).toBe(18);
  });

  it('com a bola escolhida (laranja), objetos brancos nem entram na máscara', () => {
    const profileFrame = renderScene({ width: W, height: H, background: [20, 60, 140], ball: { x: 100, y: 90, r: 5, color: ORANGE } });
    const profile = sampleBall(profileFrame, W, H, 100, 90)!;
    const r = runWith({ profile }, WHITE);
    expect(r.falseHits).toBe(0);
    expect(r.ballHits).toBe(18);
  });
});
