import type { BounceEvent } from '../physics/bounce';
import { hitterSide } from '../physics/speedStats';
import type { Swing } from './swing';
import type { PlayerSide, StrokeType } from './types';

/**
 * Golpe completo: o movimento do jogador (pose) + a bola que saiu dele (quique e velocidade).
 *
 * "Índice de potência" (0–100) combina a velocidade estimada da bola com a do
 * pulso. NÃO é força: é só um número para comparar golpes da mesma sessão.
 */
export interface Stroke {
  t: number;
  side: PlayerSide;
  type: StrokeType;
  /** Forehand/backhand pela pose (o saque vem da bola). */
  confidence: number;
  wristMps: number;
  armMps: number;
  ballKmh: number | null;
  ballErrKmh: number | null;
  powerIndex: number;
  /** true quando o índice usa só o pulso (bola não medida). */
  wristOnly: boolean;
}

/** Referências para 100: bola a 90 km/h e pulso a 12 m/s. */
export const POWER_REF = { ballKmh: 90, wristMps: 12 };

export function powerIndex(ballKmh: number | null, wristMps: number): number {
  const w = Math.min(1, wristMps / POWER_REF.wristMps);
  if (ballKmh === null) return Math.round(100 * w);
  const b = Math.min(1, ballKmh / POWER_REF.ballKmh);
  return Math.round(100 * (0.6 * b + 0.4 * w));
}

/** Casa cada golpe da pose com a jogada (quique) que começou nele: batida a até `windowMs`. */
export function buildStrokes(swings: { side: PlayerSide; swing: Swing }[], bounces: BounceEvent[], windowMs = 200): Stroke[] {
  const used = new Set<BounceEvent>();
  return swings
    .slice()
    .sort((a, b) => a.swing.t - b.swing.t)
    .map(({ side, swing }) => {
      let best: BounceEvent | null = null;
      let bestD = windowMs;
      for (const b of bounces) {
        if (used.has(b) || !b.speed || b.speed.kind !== 'golpe' || hitterSide(b) !== side) continue;
        const d = Math.abs(b.speed.fromT - swing.t);
        if (d <= bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) used.add(best);
      const ballKmh = best?.speed?.avgKmh ?? null;
      return {
        t: swing.t,
        side,
        type: best?.shot.serve ? 'saque' : swing.type,
        confidence: best?.shot.serve ? 1 : swing.confidence,
        wristMps: swing.wristMps,
        armMps: swing.armMps,
        ballKmh,
        ballErrKmh: best?.speed?.errKmh ?? null,
        powerIndex: powerIndex(ballKmh, swing.wristMps),
        wristOnly: ballKmh === null,
      } satisfies Stroke;
    });
}

export interface StrokeSummary {
  total: number;
  byType: Record<StrokeType, number>;
  maxWristMps: number;
  avgWristMps: number;
  maxPower: number;
  avgPower: number;
}

export function summarizeStrokes(strokes: Stroke[]): StrokeSummary {
  const s: StrokeSummary = { total: strokes.length, byType: { forehand: 0, backhand: 0, saque: 0 }, maxWristMps: 0, avgWristMps: 0, maxPower: 0, avgPower: 0 };
  for (const k of strokes) {
    s.byType[k.type]++;
    s.maxWristMps = Math.max(s.maxWristMps, k.wristMps);
    s.maxPower = Math.max(s.maxPower, k.powerIndex);
    s.avgWristMps += k.wristMps / strokes.length;
    s.avgPower += k.powerIndex / strokes.length;
  }
  return s;
}

/** Lado do jogador pela posição dos pés na mesa (m). */
export function sideFromFeet(tableY: number): PlayerSide {
  return tableY < 1.37 ? 'perto' : 'longe';
}
