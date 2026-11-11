import { describe, expect, it } from 'vitest';
import { FpsMeter } from './fpsMeter';

function feed(m: FpsMeter, fps: number, durationMs: number, start = 0): number {
  const dt = 1000 / fps;
  let t = start;
  for (; t <= start + durationMs; t += dt) m.push(t);
  return t;
}

describe('FpsMeter', () => {
  it('mede 60 fps', () => {
    const m = new FpsMeter(1000);
    feed(m, 60, 2000);
    expect(m.fps()).toBeCloseTo(60, 0);
  });

  it('mede 30 fps e acompanha mudança de taxa', () => {
    const m = new FpsMeter(1000);
    const end = feed(m, 60, 2000);
    feed(m, 30, 2000, end);
    expect(m.fps()).toBeCloseTo(30, 0);
  });

  it('retorna 0 sem dados suficientes', () => {
    const m = new FpsMeter();
    expect(m.fps()).toBe(0);
    m.push(10);
    expect(m.fps()).toBe(0);
  });

  it('detecta travadas pelo maior intervalo', () => {
    const m = new FpsMeter(1000);
    m.push(0);
    m.push(16);
    m.push(216);
    m.push(232);
    expect(m.maxGapMs()).toBe(200);
  });

  it('conta quadros agrupados (tela a 30 Hz, câmera a 60 fps)', () => {
    const m = new FpsMeter(1000);
    m.push(0, 1);
    for (let t = 33.3; t <= 2000; t += 33.3) m.push(t, 2);
    expect(m.fps()).toBeCloseTo(60, 0);
  });

  it('recomeça se o relógio voltar', () => {
    const m = new FpsMeter(1000);
    feed(m, 60, 1000, 5000);
    m.push(10);
    expect(m.fps()).toBe(0);
  });
});
