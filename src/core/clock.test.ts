import { describe, expect, it } from 'vitest';
import { DeviceClock, hubToLocal, makeTimestamp } from './clock';

describe('relógio sincronizável', () => {
  it('sem deslocamento, hub = local (modo 1 celular)', () => {
    const c = new DeviceClock(() => 1000);
    expect(c.stamp()).toEqual({ localMs: 1000, offsetMs: 0, hubMs: 1000, uncertaintyMs: 0 });
  });

  it('aplica o deslocamento para o relógio do hub', () => {
    const c = new DeviceClock(() => 5000);
    c.setOffset(-120.5, 3);
    const t = c.stamp();
    expect(t.hubMs).toBeCloseTo(4879.5);
    expect(t.uncertaintyMs).toBe(3);
    expect(hubToLocal(t.hubMs, t.offsetMs)).toBeCloseTo(5000);
  });

  it('carimba instantes locais explícitos', () => {
    const c = new DeviceClock(() => 0);
    c.setOffset(10, 1);
    expect(c.stamp(250).hubMs).toBe(260);
  });

  it('rejeita valores inválidos', () => {
    const c = new DeviceClock();
    expect(() => c.setOffset(NaN, 0)).toThrow(RangeError);
    expect(() => c.setOffset(0, -1)).toThrow(RangeError);
  });

  it('makeTimestamp tem padrão sem deslocamento', () => {
    expect(makeTimestamp(42)).toEqual({ localMs: 42, offsetMs: 0, hubMs: 42, uncertaintyMs: 0 });
  });
});
