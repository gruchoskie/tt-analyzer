import { describe, expect, it } from 'vitest';
import { estimateOffset, refineWithEvents, type PingSample } from './clockSync';

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Pings simulados: relógio da câmera = hub − trueOffset; atrasos de rede aleatórios e assimétricos. */
function pings(trueOffset: number, n: number, seed = 3): PingSample[] {
  const r = rng(seed);
  const out: PingSample[] = [];
  let hubNow = 1_000_000;
  for (let i = 0; i < n; i++) {
    hubNow += 200;
    const up = 2 + 30 * r() ** 3; // ms, com caudas (Wi-Fi)
    const down = 2 + 30 * r() ** 3;
    const proc = 0.3 + r();
    const t0 = hubNow - trueOffset;
    const t1 = hubNow + up;
    const t2 = t1 + proc;
    const t3 = t2 + down - trueOffset;
    out.push({ t0, t1, t2, t3 });
  }
  return out;
}

describe('sincronia de relógio', () => {
  it('pings estilo NTP: mediana dos de menor atraso', () => {
    for (const off of [0, 1234.5, -98765.25]) {
      const est = estimateOffset(pings(off, 40))!;
      expect(Math.abs(est.offsetMs - off)).toBeLessThan(3);
      // a incerteza informada cobre o erro real
      expect(est.uncertaintyMs).toBeGreaterThanOrEqual(Math.abs(est.offsetMs - off));
      expect(est.uncertaintyMs).toBeLessThan(10);
    }
  });

  it('poucas amostras: sem estimativa', () => {
    expect(estimateOffset(pings(5, 2))).toBeNull();
  });

  it('eventos simultâneos (tocs/flash) afinam o deslocamento', () => {
    const r = rng(7);
    const hub = Array.from({ length: 12 }, (_, i) => 5000 + i * 730 + r() * 100);
    const residual = 7.5; // erro que sobrou dos pings
    const cam = hub.map((t) => t - residual + (r() - 0.5) * 2); // ±1 ms de jitter
    cam.push(9999); // toc só na câmera
    const ref = refineWithEvents(hub.concat([12345]), cam)!;
    expect(Math.abs(ref.correctionMs - residual)).toBeLessThan(1);
    expect(ref.matches).toBeGreaterThanOrEqual(10);
    expect(ref.uncertaintyMs).toBeLessThan(2);
  });

  it('sem eventos casados: null', () => {
    expect(refineWithEvents([0, 1000], [500, 1500, 2500])).toBeNull();
  });
});
