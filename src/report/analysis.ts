import type { BounceEvent, TableSide } from '../physics/bounce';
import { summarizeBounces } from '../physics/bounceStats';
import { computeScore, describeRally, sideStats, summarizeRallies, type Rally } from '../physics/rally';
import { hitterSide, summarizeSpeeds } from '../physics/speedStats';
import { buildStrokes, summarizeStrokes } from '../pose/strokes';
import type { Swing } from '../pose/swing';
import type { SessionAnalysis, StoredRally } from '../storage/types';

type SideSwing = { side: TableSide; swing: Swing };

const shiftBounce = (b: BounceEvent, d: number): BounceEvent => ({
  ...b,
  t: b.t + d,
  speed: b.speed ? { ...b.speed, fromT: b.speed.fromT + d, toT: b.speed.toT + d } : null,
});

/**
 * Monta o registro da análise. `offsetMs` é o instante (no relógio dos eventos)
 * que corresponde ao início do vídeo: ao vivo, o início da gravação no relógio
 * do hub; na reprodução, 0.
 */
export function buildAnalysis(p: {
  sessionId: string;
  cameraId: string;
  source: SessionAnalysis['source'];
  offsetMs: number;
  coveredFromMs: number;
  coveredToMs: number;
  bounces: BounceEvent[];
  swings: SideSwing[];
  rallies: Rally[];
  winners: (TableSide | null)[];
  manual: { t: number; winner: TableSide }[];
}): SessionAnalysis {
  const d = -p.offsetMs;
  const bounces = p.bounces.filter((b) => b.t + d >= 0).map((b) => shiftBounce(b, d));
  const index = new Map(p.bounces.filter((b) => b.t + d >= 0).map((b, i) => [b, i]));
  const rallies: StoredRally[] = [];
  const winners: (TableSide | null)[] = [];
  p.rallies.forEach((r, i) => {
    const kept = r.bounces.filter((b) => index.has(b));
    if (!kept.length) return;
    const idx = kept.map((b) => index.get(b)!);
    // rally que começou antes da gravação: recontado só com o que ficou
    const rr = kept.length === r.bounces.length ? r : describeRally(r.index, kept, Math.max(r.startT, p.offsetMs), r.endT);
    const { bounces: _omit, ...rest } = rr;
    void _omit;
    rallies.push({ ...rest, index: rallies.length + 1, startT: rr.startT + d, endT: rr.endT + d, durationMs: rr.endT - rr.startT, firstBounce: Math.min(...idx), lastBounce: Math.max(...idx) });
    winners.push(p.winners[i] ?? null);
  });
  return {
    sessionId: p.sessionId,
    cameraId: p.cameraId,
    source: p.source,
    updatedAt: Date.now(),
    coveredFromMs: Math.max(0, p.coveredFromMs + d),
    coveredToMs: Math.max(0, p.coveredToMs + d),
    bounces,
    swings: p.swings.filter((s) => s.swing.t + d >= 0).map((s) => ({ side: s.side, swing: { ...s.swing, t: s.swing.t + d } })),
    rallies,
    winners,
    manualPoints: p.manual.filter((m) => m.t + d >= 0).map((m) => ({ t: m.t + d, winner: m.winner })),
  };
}

/** Rallies com os quiques de volta. */
export function rehydrateRallies(a: SessionAnalysis): Rally[] {
  return a.rallies.map(({ firstBounce, lastBounce, ...r }) => ({ ...r, bounces: a.bounces.slice(firstBounce, lastBounce + 1) }));
}

export interface SpeedPoint {
  n: number;
  t: number;
  kmh: number;
  errKmh: number;
  side: TableSide;
  label: string;
}

/** Tudo o que o relatório mostra, calculado do registro salvo. */
export function reportData(a: SessionAnalysis) {
  const rallies = rehydrateRallies(a);
  const strokes = buildStrokes(a.swings, a.bounces);
  const all = [...a.rallies.map((r, i) => ({ t: r.endT, w: a.winners[i] })), ...a.manualPoints.map((m) => ({ t: m.t, w: m.winner as TableSide | null }))].sort((x, y) => x.t - y.t);
  const speedSeries: SpeedPoint[] = a.bounces
    .filter((b) => b.speed && b.speed.kind === 'golpe')
    .map((b, i) => ({
      n: i + 1,
      t: b.speed!.fromT,
      kmh: b.speed!.avgKmh,
      errKmh: b.speed!.errKmh,
      side: hitterSide(b),
      label: b.shot.serve ? 'saque' : (b.shot.direction ?? 'jogada'),
    }));
  return {
    rallies,
    strokes,
    bounces: summarizeBounces(a.bounces),
    speeds: summarizeSpeeds(a.bounces),
    strokeSummary: summarizeStrokes(strokes),
    rallySummary: summarizeRallies(rallies),
    bySide: sideStats(rallies, a.winners),
    score: computeScore(
      all.map((x) => x.w),
      rallies.find((r) => r.server)?.server ?? null,
    ),
    speedSeries,
  };
}
