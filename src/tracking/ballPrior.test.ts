import { describe, expect, it } from 'vitest';
import { createCalibration, type Quad } from '../calibration/calibrate';
import { computeBallPrior, convexHull } from './ballPrior';

const corners: Quad = [
  { x: 240, y: 650 },
  { x: 1040, y: 650 },
  { x: 820, y: 260 },
  { x: 460, y: 260 },
];

describe('prior da bola a partir da calibração', () => {
  const cal = createCalibration('cam', corners, 1280, 720);
  const prior = computeBallPrior(cal, 640, 360);

  it('raio esperado: ~5 px perto e menor longe (640x360)', () => {
    // perto: 400 px de análise para 1,525 m → 262 px/m → bola de 2 cm ≈ 5,2 px
    expect(prior.rTypical[340]).toBeGreaterThan(4.2);
    expect(prior.rTypical[340]).toBeLessThan(6.5);
    expect(prior.rTypical[140]).toBeLessThan(prior.rTypical[300]);
    expect(prior.rMin[300]).toBeLessThan(prior.rTypical[300]);
    expect(prior.rMax[300]).toBeGreaterThan(prior.rTypical[300]);
  });

  it('região do jogo cobre a mesa e acima, mas não as laterais distantes', () => {
    const row = 250; // altura da rede, aproximadamente
    expect(prior.spanMin[row]).toBeLessThan(320);
    expect(prior.spanMax[row]).toBeGreaterThan(320);
    expect(prior.spanMin[row]).toBeGreaterThan(20); // lateral esquerda fora
    expect(prior.spanMax[row]).toBeLessThan(620);
    // acima da mesa (linha 60) ainda é região do jogo
    expect(prior.spanMax[60]).toBeGreaterThan(prior.spanMin[60]);
  });

  it('velocidade máxima plausível em px/s', () => {
    // 32 m/s * 262 px/m * 1,3 ≈ 10.900 px/s (≈ 180 px por quadro a 60 fps)
    expect(prior.maxSpeedPx).toBeGreaterThan(8000);
    expect(prior.maxSpeedPx).toBeLessThan(14000);
  });

  it('envoltória convexa', () => {
    const h = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(h).toHaveLength(4);
  });
});
