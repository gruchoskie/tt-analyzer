import { describe, expect, it } from 'vitest';
import { detectOnsets, OnsetDetector } from './audioOnsets';

const SR = 48000;

function scene(clicks: number[], opts: { durationS?: number; voice?: boolean; clickAmp?: number } = {}) {
  const n = Math.round((opts.durationS ?? 2) * SR);
  const a = new Float32Array(n);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    a[i] = 0.004 * rnd() + 0.05 * Math.sin(2 * Math.PI * 120 * t); // ruído + zumbido grave
    // "voz": tom grave longo, com ataque suave
    if (opts.voice && t > 1.2 && t < 1.6) a[i] += 0.2 * Math.sin(2 * Math.PI * 300 * t) * Math.min(1, (t - 1.2) / 0.05);
  }
  for (const ms of clicks) {
    const i0 = Math.round((ms / 1000) * SR);
    for (let k = 0; k < SR * 0.02 && i0 + k < n; k++) {
      const t = k / SR;
      a[i0 + k] += (opts.clickAmp ?? 0.3) * Math.exp(-t / 0.003) * Math.sin(2 * Math.PI * 4200 * t);
    }
  }
  return a;
}

describe('tocs no áudio', () => {
  it('acha os tocs da bola com precisão de poucos ms', () => {
    const clicks = [500, 760, 1010, 1700];
    const on = detectOnsets(scene(clicks), SR);
    expect(on.map((o) => Math.round(o.t))).toHaveLength(clicks.length);
    on.forEach((o, i) => expect(Math.abs(o.t - clicks[i])).toBeLessThan(4));
  });

  it('não dispara com voz/zumbido grave', () => {
    const on = detectOnsets(scene([], { voice: true }), SR);
    expect(on).toEqual([]);
  });

  it('toc fraco no meio do ruído ainda aparece; tocs colados respeitam o refratário', () => {
    const on = detectOnsets(scene([600, 630, 900], { clickAmp: 0.08 }), SR);
    expect(on.map((o) => Math.round(o.t / 10) * 10)).toEqual([600, 900]);
  });

  it('em fluxo, por blocos de 128 amostras, com relógio próprio', () => {
    const a = scene([400, 1300]);
    const d = new OnsetDetector(SR, 10_000);
    const out = [];
    for (let i = 0; i < a.length; i += 128) out.push(...d.push(a.subarray(i, i + 128)));
    expect(out.map((o) => Math.round(o.t))).toHaveLength(2);
    expect(Math.abs(out[0].t - 10_400)).toBeLessThan(4);
    expect(Math.abs(out[1].t - 11_300)).toBeLessThan(4);
  });
});
