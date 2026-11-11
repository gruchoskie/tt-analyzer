import type { Point2 } from '../core/types';
import { NET_OVERHANG_M, TABLE_LENGTH_M, TABLE_WIDTH_M } from '../physics/constants';

/**
 * Referencial da mesa (metros), visto da câmera atrás de uma extremidade:
 *  - x: largura, 0 = lateral esquerda, 1,525 = lateral direita
 *  - y: comprimento, 0 = fundo perto da câmera, 2,74 = fundo longe
 * A rede fica em y = 1,37 e a linha central (duplas) em x = 0,7625.
 */
export const TABLE_CORNERS_M: [Point2, Point2, Point2, Point2] = [
  { x: 0, y: 0 }, // perto-esquerda
  { x: TABLE_WIDTH_M, y: 0 }, // perto-direita
  { x: TABLE_WIDTH_M, y: TABLE_LENGTH_M }, // longe-direita
  { x: 0, y: TABLE_LENGTH_M }, // longe-esquerda
];

export const CORNER_NAMES = ['perto, à esquerda', 'perto, à direita', 'longe, à direita', 'longe, à esquerda'] as const;

export const NET_Y_M = TABLE_LENGTH_M / 2;
export const CENTER_LINE_X_M = TABLE_WIDTH_M / 2;

/** Postes da rede no plano da mesa (para a calibração 3D da Fase 9). */
export const NET_POSTS_M: [Point2, Point2] = [
  { x: -NET_OVERHANG_M, y: NET_Y_M },
  { x: TABLE_WIDTH_M + NET_OVERHANG_M, y: NET_Y_M },
];

export function isOnTable(p: Point2, marginM = 0): boolean {
  return p.x >= -marginM && p.x <= TABLE_WIDTH_M + marginM && p.y >= -marginM && p.y <= TABLE_LENGTH_M + marginM;
}

/** Lado da mesa: perto (lado da câmera) ou longe. */
export function tableSide(p: Point2): 'perto' | 'longe' {
  return p.y < NET_Y_M ? 'perto' : 'longe';
}

export interface Segment {
  a: Point2;
  b: Point2;
  kind: 'border' | 'net' | 'center' | 'grid';
}

/** Linhas para desenhar sobre o vídeo: bordas, rede, linha central e grade a cada `gridM` metros. */
export function tableSegments(gridM = 0.25): Segment[] {
  const W = TABLE_WIDTH_M;
  const L = TABLE_LENGTH_M;
  const segs: Segment[] = [];
  for (let x = gridM; x < W - 1e-6; x += gridM) segs.push({ a: { x, y: 0 }, b: { x, y: L }, kind: 'grid' });
  for (let y = gridM; y < L - 1e-6; y += gridM) segs.push({ a: { x: 0, y }, b: { x: W, y }, kind: 'grid' });
  segs.push({ a: { x: CENTER_LINE_X_M, y: 0 }, b: { x: CENTER_LINE_X_M, y: L }, kind: 'center' });
  segs.push({ a: NET_POSTS_M[0], b: NET_POSTS_M[1], kind: 'net' });
  const c = TABLE_CORNERS_M;
  for (let i = 0; i < 4; i++) segs.push({ a: c[i], b: c[(i + 1) % 4], kind: 'border' });
  return segs;
}
