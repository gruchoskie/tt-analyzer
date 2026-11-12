import { describe, expect, it } from 'vitest';
import type { BounceEvent } from './bounce';
import { depthZone, summarizeBounces } from './bounceStats';

const b = (x: number, y: number, extra: Partial<BounceEvent> = {}): BounceEvent => ({
  t: 0,
  frameIndex: 0,
  image: { x: 0, y: 0 },
  table: { x, y },
  side: y < 1.37 ? 'perto' : 'longe',
  audio: 'sem-audio',
  kickMps: 4,
  speed: null,
  shot: { from: null, direction: null, serve: false },
  ...extra,
});

describe('resumo dos quiques', () => {
  it('profundidade a partir da rede', () => {
    expect(depthZone(1.2)).toBe('curta');
    expect(depthZone(0.1)).toBe('longa');
    expect(depthZone(2.0)).toBe('media');
  });
  it('conta lados, zonas, direções e áudio', () => {
    const s = summarizeBounces([
      b(0.2, 0.2, { shot: { from: null, direction: null, serve: true }, audio: 'confirmado' }),
      b(1.3, 2.6, { shot: { from: { x: 0.2, y: 0.2 }, direction: 'cruzada', serve: false }, audio: 'sem-som' }),
      b(0.7, 1.2, { shot: { from: { x: 1.3, y: 2.6 }, direction: 'meio', serve: false }, audio: 'confirmado' }),
    ]);
    expect(s.total).toBe(3);
    expect(s.bySide).toEqual({ perto: 2, longe: 1 });
    expect(s.grid.perto.longa.esquerda).toBe(1);
    expect(s.grid.perto.curta.meio).toBe(1);
    expect(s.grid.longe.longa.direita).toBe(1);
    expect(s.directions).toEqual({ cruzada: 1, paralela: 0, meio: 1 });
    expect(s.serves).toBe(1);
    expect([s.audioConfirmed, s.audioChecked]).toEqual([2, 3]);
  });
});
