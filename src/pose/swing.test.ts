import { describe, expect, it } from 'vitest';
import { SwingDetector } from './swing';
import { buildStrokes, powerIndex, summarizeStrokes } from './strokes';
import { LM, type Landmark } from './types';
import type { BounceEvent } from '../physics/bounce';

/** Jogador sintético (metros, origem no quadril): braço da raquete faz golpes; a outra mão quase parada. */
function frames(opts: { fps: number; racket: 'direita' | 'esquerda'; swings: { t0: number; from: number; to: number; dur?: number }[]; endMs: number }) {
  const out: { t: number; world: Landmark[] }[] = [];
  const sgn = opts.racket === 'direita' ? 1 : -1; // + = lado do ombro direito
  const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  for (let k = 0; k * (1000 / opts.fps) <= opts.endMs; k++) {
    const t = (k * 1000) / opts.fps;
    const w: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
    w[LM.leftShoulder] = { x: -0.2, y: -0.5, z: 0, visibility: 0.9 };
    w[LM.rightShoulder] = { x: 0.2, y: -0.5, z: 0, visibility: 0.9 };
    // posição lateral da mão da raquete (em "lado da raquete" = +)
    // preparação lenta (500 ms) até o começo do golpe, depois o golpe rápido
    let lat = 0.35;
    let prev = 0.35;
    for (const s of opts.swings) {
      if (t >= s.t0 - 500) lat = prev + (s.from - prev) * smooth((t - (s.t0 - 500)) / 500);
      if (t >= s.t0) lat = s.from + (s.to - s.from) * smooth((t - s.t0) / (s.dur ?? 200));
      prev = s.to;
    }
    const z = 0.25 + 0.15 * Math.sin(lat * 3);
    const racketWrist = { x: sgn * lat, y: -0.25, z, visibility: 0.9 };
    const racketElbow = { x: sgn * (0.2 + lat * 0.4), y: -0.3, z: z * 0.5, visibility: 0.9 };
    const otherWrist = { x: -sgn * 0.3, y: -0.2 + 0.01 * Math.sin(t / 100), z: 0.2, visibility: 0.9 };
    const otherElbow = { x: -sgn * 0.25, y: -0.3, z: 0.1, visibility: 0.9 };
    if (opts.racket === 'direita') {
      w[LM.rightWrist] = racketWrist; w[LM.rightElbow] = racketElbow; w[LM.leftWrist] = otherWrist; w[LM.leftElbow] = otherElbow;
    } else {
      w[LM.leftWrist] = racketWrist; w[LM.leftElbow] = racketElbow; w[LM.rightWrist] = otherWrist; w[LM.rightElbow] = otherElbow;
    }
    out.push({ t, world: w });
  }
  return out;
}

const SWINGS = [
  { t0: 300, from: 0.5, to: -0.1 }, // forehand: lado da raquete → centro
  { t0: 1200, from: -0.5, to: 0.1 }, // backhand: cruza o corpo e sai
  { t0: 2000, from: 0.55, to: -0.15, dur: 160 }, // forehand mais forte
];

describe('golpes pela pose', () => {
  for (const racket of ['direita', 'esquerda'] as const)
    for (const fps of [30, 15])
      it(`destro/canhoto (${racket}), ${fps} fps: acha os golpes, a mão e o tipo`, () => {
        const det = new SwingDetector('auto');
        const found = [];
        for (const f of frames({ fps, racket, swings: SWINGS, endMs: 2800 })) found.push(...det.push(f));
        found.push(...det.flush());
        expect(det.racketHand()).toBe(racket);
        expect(found.map((s) => s.type)).toEqual(['forehand', 'backhand', 'forehand']);
        // pico teórico da smoothstep: 1,5 × distância / duração
        const truth = [1.5 * 0.6 / 0.2, 1.5 * 0.6 / 0.2, 1.5 * 0.7 / 0.16];
        found.forEach((s, i) => {
          expect(Math.abs(s.t - (SWINGS[i].t0 + (SWINGS[i].dur ?? 200) / 2))).toBeLessThan(1000 / fps + 1);
          // em 15 fps a diferença centrada achata o pico
          expect(Math.abs(s.wristMps - truth[i]) / truth[i]).toBeLessThan(fps === 30 ? 0.2 : 0.35);
          expect(s.armMps).toBeGreaterThan(0);
        });
        expect(found[2].wristMps).toBeGreaterThan(found[0].wristMps);
      });

  it('movimento lento não vira golpe; pontos pouco visíveis são ignorados', () => {
    const det = new SwingDetector('direita');
    const fr = frames({ fps: 30, racket: 'direita', swings: [{ t0: 300, from: 0.4, to: 0.1, dur: 600 }], endMs: 1500 });
    for (const f of fr) det.push(f);
    expect(det.flush()).toEqual([]);
    const det2 = new SwingDetector('direita');
    for (const f of frames({ fps: 30, racket: 'direita', swings: SWINGS.slice(0, 1), endMs: 800 })) {
      f.world[LM.rightWrist].visibility = 0.1;
      det2.push(f);
    }
    expect(det2.flush()).toEqual([]);
  });
});

describe('golpe completo e índice de potência', () => {
  const bounce = (fromT: number, side: 'perto' | 'longe', kmh: number, serve = false): BounceEvent => ({
    t: fromT + 400,
    frameIndex: 0,
    image: { x: 0, y: 0 },
    table: { x: 0.5, y: side === 'perto' ? 0.5 : 2.2 },
    side,
    audio: 'sem-audio',
    kickMps: 4,
    shot: { from: null, direction: null, serve },
    speed: { kind: 'golpe', fromT, toT: fromT + 400, avgKmh: kmh, startKmh: kmh, endKmh: kmh, errKmh: 3, method: 'balistico', points: 10 },
  });

  it('índice: 0..100, bola pesa mais, sem bola usa só o pulso', () => {
    expect(powerIndex(90, 12)).toBe(100);
    expect(powerIndex(0, 0)).toBe(0);
    expect(powerIndex(45, 6)).toBe(50);
    expect(powerIndex(200, 30)).toBe(100);
    expect(powerIndex(null, 6)).toBe(50);
  });

  it('casa o golpe com a bola que saiu dele (lado e instante)', () => {
    const sw = (t: number, type: 'forehand' | 'backhand') => ({ t, hand: 'direita' as const, wristMps: 6, armMps: 3, type, confidence: 0.8 });
    const strokes = buildStrokes(
      [
        { side: 'perto', swing: sw(1000, 'forehand') },
        { side: 'longe', swing: sw(1800, 'backhand') },
        { side: 'perto', swing: sw(3000, 'forehand') }, // bola não medida
        { side: 'perto', swing: sw(100, 'backhand') }, // saque
      ],
      [bounce(1050, 'longe', 40), bounce(1790, 'perto', 30), bounce(120, 'perto', 20, true), bounce(2400, 'longe', 50)],
    );
    expect(strokes.map((s) => [s.t, s.type, s.ballKmh])).toEqual([
      [100, 'saque', 20],
      [1000, 'forehand', 40],
      [1800, 'backhand', 30],
      [3000, 'forehand', null],
    ]);
    expect(strokes[3].wristOnly).toBe(true);
    const sum = summarizeStrokes(strokes);
    expect(sum.byType).toEqual({ forehand: 2, backhand: 1, saque: 1 });
    expect(sum.maxPower).toBe(Math.max(...strokes.map((s) => s.powerIndex)));
  });
});
