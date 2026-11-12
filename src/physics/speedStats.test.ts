import { describe, expect, it } from 'vitest';
import type { BounceEvent } from './bounce';
import { formatKmh, hitterSide, summarizeSpeeds } from './speedStats';

const b = (y: number, kmh: number | null, extra: Partial<BounceEvent> = {}): BounceEvent => ({
  t: 0,
  frameIndex: 0,
  image: { x: 0, y: 0 },
  table: { x: 0.5, y },
  side: y < 1.37 ? 'perto' : 'longe',
  audio: 'sem-audio',
  kickMps: 4,
  shot: { from: null, direction: null, serve: false },
  speed: kmh === null ? null : { kind: 'golpe', fromT: 0, toT: 300, avgKmh: kmh, startKmh: kmh, endKmh: kmh, errKmh: kmh * 0.08, method: 'balistico', points: 10 },
  ...extra,
});

describe('resumo de velocidade', () => {
  it('quem bateu: oposto ao quique, menos no saque', () => {
    expect(hitterSide(b(2.2, 30))).toBe('perto');
    expect(hitterSide(b(0.5, 30))).toBe('longe');
    expect(hitterSide(b(0.5, 30, { shot: { from: null, direction: null, serve: true } }))).toBe('perto');
  });

  it('máxima, média e por jogador; ignora jogadas sem estimativa', () => {
    const s = summarizeSpeeds([b(2.2, 30), b(0.5, 40), b(2.0, 50), b(0.6, null)]);
    expect(s.count).toBe(3);
    expect(s.maxKmh).toBe(50);
    expect(s.avgKmh).toBeCloseTo(40);
    expect(s.byHitter.perto.count).toBe(2);
    expect(s.byHitter.perto.maxKmh).toBe(50);
    expect(s.byHitter.longe.avgKmh).toBe(40);
    // a margem da média é menor que a de cada jogada, mas não some
    expect(s.avgErrKmh).toBeLessThan(40 * 0.08);
    expect(s.avgErrKmh).toBeGreaterThanOrEqual(40 * 0.05 - 1e-9);
  });

  it('formata', () => {
    expect(formatKmh(31.6, 2.2)).toBe('32 ± 2 km/h');
    expect(formatKmh(31.6, 0.2)).toBe('32 ± 1 km/h');
  });
});
