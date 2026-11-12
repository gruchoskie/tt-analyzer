import type { BounceEvent, TableSide } from './bounce';

/** Quem bateu: o saque quica primeiro no lado de quem saca; as outras jogadas, no lado oposto. */
export function hitterSide(b: BounceEvent): TableSide {
  if (b.shot.serve) return b.side;
  return b.side === 'perto' ? 'longe' : 'perto';
}

export interface SpeedStat {
  count: number;
  /** km/h */
  maxKmh: number;
  maxErrKmh: number;
  avgKmh: number;
  /** Margem de erro da média (km/h): erros independentes encolhem com √n, mas o sistemático não. */
  avgErrKmh: number;
}

export interface SpeedSummary extends SpeedStat {
  /** Por jogador (lado da mesa de quem bateu). */
  byHitter: Record<TableSide, SpeedStat>;
}

const SYSTEMATIC = 0.05;

function stat(list: BounceEvent[]): SpeedStat {
  const s = list.map((b) => b.speed!).filter(Boolean);
  if (!s.length) return { count: 0, maxKmh: 0, maxErrKmh: 0, avgKmh: 0, avgErrKmh: 0 };
  const max = s.reduce((a, b) => (b.avgKmh > a.avgKmh ? b : a));
  const avg = s.reduce((a, b) => a + b.avgKmh, 0) / s.length;
  // parte aleatória de cada jogada (tirando o sistemático), somada em quadratura
  const rand2 = s.reduce((a, b) => a + Math.max(0, b.errKmh ** 2 - (SYSTEMATIC * b.avgKmh) ** 2), 0) / s.length ** 2;
  return { count: s.length, maxKmh: max.avgKmh, maxErrKmh: max.errKmh, avgKmh: avg, avgErrKmh: Math.sqrt(rand2 + (SYSTEMATIC * avg) ** 2) };
}

/** Resumo das velocidades (só jogadas com estimativa; o trecho entre os 2 quiques do saque não conta como golpe). */
export function summarizeSpeeds(bounces: BounceEvent[]): SpeedSummary {
  const shots = bounces.filter((b) => b.speed && b.speed.kind === 'golpe');
  return {
    ...stat(shots),
    byHitter: { perto: stat(shots.filter((b) => hitterSide(b) === 'perto')), longe: stat(shots.filter((b) => hitterSide(b) === 'longe')) },
  };
}

/** "32 ± 2 km/h" */
export function formatKmh(v: number, err?: number): string {
  const r = (x: number) => String(Math.round(x));
  return err !== undefined ? `${r(v)} ± ${r(Math.max(1, err))} km/h` : `${r(v)} km/h`;
}
