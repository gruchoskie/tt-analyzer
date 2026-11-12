import { NET_Y_M } from '../calibration/table';
import { lateralZone, type BounceEvent, type ShotDirection, type TableSide } from './bounce';

export type DepthZone = 'curta' | 'media' | 'longa';
export type LateralZone = ReturnType<typeof lateralZone>;

/** Profundidade dentro da meia-mesa: terços a partir da rede (curta = perto da rede). */
export function depthZone(y: number): DepthZone {
  const d = Math.abs(y - NET_Y_M) / NET_Y_M; // 0 na rede, 1 na cabeceira
  return d < 1 / 3 ? 'curta' : d < 2 / 3 ? 'media' : 'longa';
}

export interface BounceSummary {
  total: number;
  bySide: Record<TableSide, number>;
  /** Contagem por lado → [profundidade][lateral]. */
  grid: Record<TableSide, Record<DepthZone, Record<LateralZone, number>>>;
  directions: Record<ShotDirection, number>;
  serves: number;
  audioConfirmed: number;
  audioChecked: number;
}

const zeroGrid = () => {
  const row = () => ({ esquerda: 0, meio: 0, direita: 0 });
  return { curta: row(), media: row(), longa: row() };
};

export function summarizeBounces(bounces: BounceEvent[]): BounceSummary {
  const s: BounceSummary = {
    total: bounces.length,
    bySide: { perto: 0, longe: 0 },
    grid: { perto: zeroGrid(), longe: zeroGrid() },
    directions: { cruzada: 0, paralela: 0, meio: 0 },
    serves: 0,
    audioConfirmed: 0,
    audioChecked: 0,
  };
  for (const b of bounces) {
    s.bySide[b.side]++;
    s.grid[b.side][depthZone(b.table.y)][lateralZone(b.table.x)]++;
    if (b.shot.direction) s.directions[b.shot.direction]++;
    if (b.shot.serve) s.serves++;
    if (b.audio !== 'sem-audio') s.audioChecked++;
    if (b.audio === 'confirmado') s.audioConfirmed++;
  }
  return s;
}
