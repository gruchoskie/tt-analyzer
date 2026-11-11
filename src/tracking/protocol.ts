import type { BallDetection2D, CameraId, SessionId, SyncedTimestamp } from '../core/types';
import type { TrackCandidate, TrackerStats, TrackPoint, TrackState } from './BallTracker';
import type { DetectorOptions } from './classicDetector';
import type { Rect } from './analysisGeometry';

/** Mensagens entre a thread principal e o Worker de rastreio. */

export interface FrameJobMeta {
  frameIndex: number;
  timestamp: SyncedTimestamp;
  cameraId: CameraId;
  sessionId: SessionId | null;
  /** Instante (performance.now) em que o quadro foi enviado, para medir a latência. */
  sentAt: number;
}

export type ToWorker =
  | {
      type: 'config';
      videoW: number;
      videoH: number;
      analysisW: number;
      analysisH: number;
      detector: Partial<DetectorOptions>;
      /** ROI em px do vídeo (null = imagem toda). */
      roi: Rect | null;
    }
  | { type: 'frame'; meta: FrameJobMeta; bitmap?: ImageBitmap; rgba?: ArrayBuffer }
  | { type: 'reset' };

export interface FrameResult {
  type: 'result';
  meta: FrameJobMeta;
  /** Candidatos em px do vídeo (debug). */
  candidates: TrackCandidate[];
  detection: BallDetection2D | null;
  state: TrackState;
  point: TrackPoint | null;
  trail: TrackPoint[];
  stats: TrackerStats;
  /** Tempo de processamento no Worker (ms). */
  workMs: number;
  maskPixels: number;
  rejectedGlobal: boolean;
}

export type FromWorker = FrameResult | { type: 'ready'; offscreen: boolean } | { type: 'error'; message: string };
