import { describe, expect, it } from 'vitest';
import type { BounceEvent, TableSide } from './bounce';
import { computeScore, gameOver, RallyTracker, serverFor, sideStats, summarizeRallies } from './rally';

let seq = 0;
const b = (t: number, side: TableSide, extra: Partial<BounceEvent> = {}): BounceEvent => ({
  t,
  frameIndex: seq++,
  image: { x: 0, y: 0 },
  table: { x: 0.4, y: side === 'perto' ? 0.6 : 2.1 },
  side,
  audio: 'sem-audio',
  kickMps: 4,
  shot: { from: null, direction: 'cruzada', serve: false },
  speed: { kind: 'golpe', fromT: t - 400, toT: t, avgKmh: 30, startKmh: 31, endKmh: 29, errKmh: 2, method: 'balistico', points: 10 },
  ...extra,
});
const serve = (t: number, side: TableSide) => b(t, side, { shot: { from: null, direction: null, serve: true } });
const serve2 = (t: number, side: TableSide) => b(t, side, { speed: { kind: 'quique', fromT: t - 350, toT: t, avgKmh: 20, startKmh: 20, endKmh: 20, errKmh: 2, method: 'balistico', points: 8 } });

/** Alimenta o tracker com quadros a 30 fps e a bola visível nos intervalos dados. */
function play(tr: RallyTracker, events: BounceEvent[], visible: [number, number][], endMs: number) {
  const closed = [];
  let k = 0;
  const evs = [...events].sort((a, c) => a.t - c.t);
  for (let t = 0; t <= endMs; t += 1000 / 30) {
    while (k < evs.length && evs[k].t <= t) {
      const c = tr.bounce(evs[k++]);
      if (c) closed.push(c);
    }
    const c = tr.tick(t, visible.some(([a, z]) => t >= a && t <= z));
    if (c) closed.push(c);
  }
  const c = tr.flush();
  if (c) closed.push(c);
  return closed;
}

describe('rallies', () => {
  it('separa pontos pela pausa da bola, conta trocas e estima o ganhador', () => {
    const tr = new RallyTracker();
    const events = [
      // ponto 1: saque de perto, 4 jogadas; termina com quique em longe sem volta → perto ganha
      serve(500, 'perto'), serve2(850, 'longe'), b(1500, 'perto'), b(2200, 'longe'), b(2900, 'perto'), b(3600, 'longe'),
      // ponto 2: saque de perto que não passa (só 1 quique) → longe ganha
      serve(8000, 'perto'),
      // ponto 3: saque de longe, 2 jogadas; último quique em longe → perto ganha
      serve(12000, 'longe'), serve2(12350, 'perto'), b(13000, 'longe'),
    ];
    const rallies = play(tr, events, [[200, 4000], [7700, 8300], [11700, 13400]], 17000);
    expect(rallies.map((r) => r.shots)).toEqual([5, 1, 2]);
    expect(rallies.map((r) => r.winner)).toEqual(['perto', 'longe', 'perto']);
    expect(rallies.map((r) => r.server)).toEqual(['perto', 'perto', 'longe']);
    expect(rallies[1].reason).toMatch(/saque/);
    expect(rallies[0].durationMs).toBeGreaterThan(3000);
    expect(rallies[0].durationMs).toBeLessThan(4500);
    expect(rallies[0].avgShotIntervalMs).toBeCloseTo(775, 0);
    expect(rallies[0].shotsPerMin).toBeCloseTo(60000 / 775, 0);
    const sum = summarizeRallies(rallies);
    expect(sum.count).toBe(3);
    expect(sum.maxShots).toBe(5);
    expect(sum.avgShots).toBeCloseTo(8 / 3);
  });

  it('bola que continua visível sem quique por muito tempo também fecha o rally', () => {
    const tr = new RallyTracker();
    const rallies = play(tr, [serve(500, 'perto'), serve2(850, 'longe')], [[0, 10000]], 10000);
    expect(rallies).toHaveLength(1);
    expect(rallies[0].endT).toBeLessThan(5000);
  });

  it('estatísticas por lado', () => {
    const tr = new RallyTracker();
    const rallies = play(tr, [serve(500, 'perto'), serve2(850, 'longe'), b(1500, 'perto'), b(2200, 'longe')], [[0, 2500]], 6000);
    const st = sideStats(rallies, rallies.map((r) => r.winner));
    // perto: saque + 1 jogada; longe: 1 jogada
    expect(st.perto.shots).toBe(2);
    expect(st.perto.serves).toBe(1);
    expect(st.longe.shots).toBe(1);
    expect(st.perto.pointsWon).toBe(1);
    expect(st.longe.received).toBe(2);
    expect(st.perto.avgKmh).toBe(30);
  });
});

describe('placar', () => {
  it('game a 11 com 2 de diferença', () => {
    expect(gameOver({ perto: 11, longe: 9 })).toBe('perto');
    expect(gameOver({ perto: 11, longe: 10 })).toBeNull();
    expect(gameOver({ perto: 12, longe: 14 })).toBe('longe');
  });

  it('saque a cada 2 pontos, a cada 1 no 10–10', () => {
    expect(serverFor({ perto: 0, longe: 0 }, 'perto')).toBe('perto');
    expect(serverFor({ perto: 1, longe: 1 }, 'perto')).toBe('longe');
    expect(serverFor({ perto: 3, longe: 1 }, 'perto')).toBe('perto');
    expect(serverFor({ perto: 10, longe: 10 }, 'perto')).toBe('perto');
    expect(serverFor({ perto: 11, longe: 10 }, 'perto')).toBe('longe');
    expect(serverFor({ perto: 11, longe: 11 }, 'perto')).toBe('perto');
  });

  it('soma pontos, fecha games e ignora pontos sem ganhador', () => {
    const w: (TableSide | null)[] = [...Array(11).fill('perto'), null, 'longe', 'longe'];
    const s = computeScore(w, 'perto');
    expect(s.games).toEqual({ perto: 1, longe: 0 });
    expect(s.history).toEqual([{ perto: 11, longe: 0 }]);
    expect(s.points).toEqual({ perto: 0, longe: 2 });
    // 2º game começa com o outro sacando; depois de 2 pontos troca
    expect(s.server).toBe('perto');
  });
});
