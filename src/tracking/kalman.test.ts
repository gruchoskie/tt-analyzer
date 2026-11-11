import { describe, expect, it } from 'vitest';
import { GATE_CHI2_99, Kalman2D } from './kalman';

function rng(seed: number) {
  // gaussiana por Box-Muller sobre LCG determinístico
  let s = seed;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

const CV = { model: 'cv' as const, processNoise: 2000, measNoise: 2, initialVelStd: 1500 };
const CA = { model: 'ca' as const, processNoise: 20000, measNoise: 2, initialVelStd: 1500, initialAccStd: 3000 };
const OPTS = CV;

/** Trajetória parabólica em px (y para baixo): vx=600 px/s, vy0=-500 px/s, g=1500 px/s². */
function truth(t: number) {
  return { x: 100 + 600 * t, y: 400 - 500 * t + 0.5 * 1500 * t * t };
}

describe('Kalman 2D', () => {
  it('reduz o ruído de medição numa trajetória parabólica', () => {
    const g = rng(42);
    const dt = 1 / 60;
    const k = new Kalman2D(truth(0).x, truth(0).y, OPTS);
    let rawErr = 0;
    let filtErr = 0;
    let n = 0;
    for (let i = 1; i <= 40; i++) {
      const t = i * dt;
      const p = truth(t);
      const z = { x: p.x + g() * 2, y: p.y + g() * 2 };
      k.predict(dt);
      k.update(z.x, z.y);
      if (i > 10) {
        rawErr += Math.hypot(z.x - p.x, z.y - p.y);
        filtErr += Math.hypot(k.position.x - p.x, k.position.y - p.y);
        n++;
      }
    }
    expect(filtErr / n).toBeLessThan(rawErr / n);
    expect(k.velocity.x).toBeCloseTo(600, -2); // ~±50 px/s
  });

  it('modelo de aceleração constante preenche falha de 5 quadros quase sem erro', () => {
    const dt = 1 / 60;
    const k = new Kalman2D(truth(0).x, truth(0).y, CA);
    for (let i = 1; i <= 20; i++) {
      k.predict(dt);
      const p = truth(i * dt);
      k.update(p.x, p.y);
    }
    for (let i = 21; i <= 25; i++) k.predict(dt);
    const p = truth(25 * dt);
    expect(Math.hypot(k.position.x - p.x, k.position.y - p.y)).toBeLessThan(2);
    expect(k.acceleration.y).toBeGreaterThan(1200); // aprendeu a "gravidade" na imagem
  });

  it('velocidade constante também preenche a falha, com erro maior (≈ 1 diâmetro de bola)', () => {
    const dt = 1 / 60;
    const k = new Kalman2D(truth(0).x, truth(0).y, OPTS);
    for (let i = 1; i <= 20; i++) {
      k.predict(dt);
      const p = truth(i * dt);
      k.update(p.x, p.y);
    }
    for (let i = 21; i <= 25; i++) k.predict(dt);
    const p = truth(25 * dt);
    // sem modelar a gravidade, a velocidade estimada atrasa e o erro fica em ~10 px
    expect(Math.hypot(k.position.x - p.x, k.position.y - p.y)).toBeLessThan(15);
  });

  it('gate: aceita medição plausível e rejeita outlier distante', () => {
    const dt = 1 / 60;
    const k = new Kalman2D(0, 0, OPTS, 600, 0);
    for (let i = 1; i <= 15; i++) {
      k.predict(dt);
      k.update(600 * i * dt, 0);
    }
    k.predict(dt);
    expect(k.mahalanobis2(600 * 16 * dt + 1, 1)).toBeLessThan(GATE_CHI2_99);
    expect(k.mahalanobis2(600 * 16 * dt + 200, 150)).toBeGreaterThan(GATE_CHI2_99);
  });

  it('incerteza cresce sem medições e diminui com elas', () => {
    const k = new Kalman2D(0, 0, OPTS);
    const s0 = k.innovationCov()[0];
    k.predict(0.05);
    const s1 = k.innovationCov()[0];
    k.update(0, 0);
    const s2 = k.innovationCov()[0];
    expect(s1).toBeGreaterThan(s0);
    expect(s2).toBeLessThan(s1);
  });

  it('ignora dt inválido', () => {
    const k = new Kalman2D(5, 5, OPTS, 100, 0);
    k.predict(0);
    k.predict(-1);
    expect(k.position).toEqual({ x: 5, y: 5 });
  });
});
