import { describe, expect, it } from 'vitest';
import type { BounceEvent, TableSide } from '../physics/bounce';
import { RallyTracker } from '../physics/rally';
import { buildAnalysis, rehydrateRallies, reportData } from './analysis';
import { bouncesCsv, csvCell, ralliesCsv, strokesCsv, toCsv } from './csv';

const b = (t: number, side: TableSide, serve = false, kmh = 30): BounceEvent => ({
  t,
  frameIndex: 0,
  image: { x: 0, y: 0 },
  table: { x: 0.4, y: side === 'perto' ? 0.6 : 2.1 },
  side,
  audio: 'confirmado',
  kickMps: 4,
  shot: { from: null, direction: serve ? null : 'cruzada', serve },
  speed: { kind: 'golpe', fromT: t - 400, toT: t, avgKmh: kmh, startKmh: kmh + 2, endKmh: kmh - 2, errKmh: 2.5, method: 'balistico', points: 10 },
});

describe('CSV', () => {
  it('pt-BR: ponto e vírgula, vírgula decimal, aspas quando precisa', () => {
    expect(csvCell(1.5)).toBe('1,50');
    expect(csvCell(3)).toBe('3');
    expect(csvCell(true)).toBe('sim');
    expect(csvCell(null)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('x"y;')).toBe('"x""y;"');
    const csv = toCsv(['a', 'b'], [[1, 'x'], [2.25, null]]);
    expect(csv.startsWith('﻿a;b\r\n1;x\r\n2,25;\r\n')).toBe(true);
  });
});

describe('análise salva e relatório', () => {
  // ao vivo: eventos no relógio do hub; a gravação começou em 100 000 ms
  const T0 = 100_000;
  const events = [b(T0 - 3000, 'perto'), b(T0 + 500, 'perto', true), b(T0 + 1200, 'longe', false, 40), b(T0 + 1900, 'perto', false, 25), b(T0 + 9000, 'longe', true)];
  const tr = new RallyTracker();
  const rallies = [];
  for (const e of events) {
    const c = tr.bounce(e);
    if (c) rallies.push(c);
  }
  rallies.push(tr.flush()!);

  const a = buildAnalysis({
    sessionId: 's1',
    cameraId: 'c1',
    source: 'ao-vivo',
    offsetMs: T0,
    coveredFromMs: T0,
    coveredToMs: T0 + 12_000,
    bounces: events,
    swings: [{ side: 'perto', swing: { t: T0 + 800, hand: 'direita', wristMps: 7, armMps: 4, type: 'forehand', confidence: 0.9 } }],
    rallies,
    winners: rallies.map((r) => r.winner),
    manual: [{ t: T0 + 11_000, winner: 'perto' }],
  });

  it('desloca para o tempo do vídeo e descarta o que veio antes da gravação', () => {
    expect(a.bounces.map((x) => x.t)).toEqual([500, 1200, 1900, 9000]);
    expect(a.bounces[1].speed?.fromT).toBe(800);
    expect(a.rallies.map((r) => [r.index, r.firstBounce, r.lastBounce])).toEqual([
      [1, 0, 2],
      [2, 3, 3],
    ]);
    expect(a.swings[0].swing.t).toBe(800);
    expect(a.coveredToMs).toBe(12_000);
    expect(rehydrateRallies(a)[0].bounces).toHaveLength(3);
    // o rally começou antes da gravação: conta só o que ficou
    expect(a.rallies[0].shots).toBe(2); // saque (2 quiques) + 1 jogada
    expect(a.rallies[0].startT).toBeGreaterThanOrEqual(0);
  });

  it('resumo do relatório', () => {
    const r = reportData(a);
    expect(r.rallySummary.count).toBe(2);
    expect(r.speeds.maxKmh).toBe(40);
    expect(r.speedSeries.map((p) => p.side)).toEqual(['perto', 'perto', 'longe', 'longe']);
    expect(r.strokes[0].ballKmh).toBe(40);
    // ponto 1: último quique em perto → longe; ponto 2: saque de longe sem volta → perto; +1 manual perto
    expect(r.score.points).toEqual({ perto: 2, longe: 1 });
    expect(r.bySide.perto.serves).toBe(1);
  });

  it('CSVs com uma linha por item', () => {
    const lines = (s: string) => s.trim().split('\r\n').length;
    expect(lines(bouncesCsv(a.bounces))).toBe(5);
    expect(lines(ralliesCsv(a.rallies, a.winners))).toBe(3);
    expect(lines(strokesCsv(reportData(a).strokes))).toBe(2);
    expect(bouncesCsv(a.bounces).split('\r\n')[2]).toBe('1,20;longe;perto;0,40;2,10;cruzada;não;confirmado;40;2,50;42;balistico');
  });
});
