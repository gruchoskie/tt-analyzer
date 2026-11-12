import type { Point2 } from '../core/types';

/** Mensagens do canal de dados entre câmeras e hub (Fase 9). Tempos em ms. */
export type LinkMsg =
  | { k: 'hello'; cameraId: string; label: string; role: 'camera' | 'hub'; version: string }
  | { k: 'ping'; id: number; t0: number }
  | { k: 'pong'; id: number; t0: number; t1: number; t2: number }
  /** Câmera → hub: estimativa de sincronia atual (para mostrar o erro). */
  | { k: 'sync'; offsetMs: number; uncertaintyMs: number; rttMs: number; source: 'ping' | 'eventos' }
  /** Hub → câmera: correção vinda dos eventos (palma/tocs). */
  | { k: 'synccorr'; correctionMs: number; uncertaintyMs: number }
  | { k: 'calib'; width: number; height: number; corners: Point2[]; netPosts: Point2[] | null }
  /** Detecções: [t (relógio do hub), x, y] em px do vídeo da câmera. */
  | { k: 'det'; d: [number, number, number][]; tNow: number }
  | { k: 'stats'; fps: number; analysisFps: number; detRate: number; width: number; height: number }
  /** Tocs do áudio (relógio do hub, já com o deslocamento atual da câmera). */
  | { k: 'onsets'; t: number[] }
  /** Hub → câmeras: gravar/parar (mesma sessão em todos). */
  | { k: 'rec'; on: boolean; sessionId: string; name: string }
  /** Câmera → hub: vídeo gravado (depois vêm pedaços binários e 'vid-end'). */
  | { k: 'vid-start'; sessionId: string; cameraId: string; label: string; mimeType: string; size: number; startedAtHubMs: number; durationMs: number; width: number; height: number; fps: number; clockOffsetMs: number }
  | { k: 'vid-end'; sessionId: string; chunks: number }
  | { k: 'bye' };

export const PROTOCOL_VERSION = '1';
