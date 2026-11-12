import { describe, expect, it } from 'vitest';
import { LoadGovernor } from './loadGovernor';

function run(g: LoadGovernor, from: number, ms: number, gap: (i: number) => number): number {
  let t = from;
  for (let i = 0; t < from + ms; i++) {
    t += gap(i);
    g.frame(t);
  }
  return t;
}

describe('LoadGovernor', () => {
  it('fica em 0 com a tela lisa a 60 Hz', () => {
    const g = new LoadGovernor();
    run(g, 0, 10000, () => 16.7);
    expect(g.level).toBe(0);
  });

  it('sobe quando há congelamentos (pose de 400 ms) e desce devagar quando volta ao normal', () => {
    const g = new LoadGovernor();
    let t = run(g, 0, 3000, (i) => (i % 15 === 0 ? 420 : 16.7));
    expect(g.level).toBeGreaterThanOrEqual(2);
    t = run(g, t, 2000, () => 16.7);
    expect(g.level).toBeGreaterThanOrEqual(2); // ainda não desceu
    run(g, t, 20000, () => 16.7);
    expect(g.level).toBe(0);
  });

  it('30 Hz constante (aparelho que desenha a 30) não é travamento', () => {
    const g = new LoadGovernor();
    run(g, 0, 8000, () => 33.4);
    expect(g.level).toBe(0);
  });

  it('ignora a aba em segundo plano', () => {
    const g = new LoadGovernor();
    let t = run(g, 0, 2000, () => 16.7);
    t += 10000;
    g.frame(t);
    run(g, t, 3000, () => 16.7);
    expect(g.level).toBe(0);
  });
});
