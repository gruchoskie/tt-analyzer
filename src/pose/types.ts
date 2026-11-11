import type { CameraId, SyncedTimestamp } from '../core/types';

/** Pose do jogador num quadro (Fase 6, MediaPipe Pose Landmarker). */
export interface PoseFrame {
  cameraId: CameraId;
  timestamp: SyncedTimestamp;
  /** Pontos normalizados (0..1) na imagem, no padrão de 33 pontos do MediaPipe. */
  landmarks: { x: number; y: number; z: number; visibility: number }[];
}
