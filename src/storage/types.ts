import type { AnalysisMode, CameraId, DeviceRole, SessionId } from '../core/types';
import type { TableCalibration } from '../calibration/types';

export type SessionStatus = 'recording' | 'complete' | 'interrupted';

/** Dados de uma câmera dentro de uma sessão (1 no modo 2D, N no modo 3D). */
export interface SessionCamera {
  cameraId: CameraId;
  label: string;
  width: number;
  height: number;
  /** fps medido durante a gravação (média). */
  measuredFps: number;
  reportedFps?: number;
  mimeType: string;
  hasAudio: boolean;
  durationMs: number;
  sizeBytes: number;
  chunkCount: number;
  /** Deslocamento do relógio desta câmera para o hub no momento da gravação. */
  clockOffsetMs: number;
  /** Instante (relógio do hub) em que a gravação desta câmera começou. */
  startedAtHubMs: number;
}

export interface SessionRecord {
  id: SessionId;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  mode: AnalysisMode;
  /** Papel do aparelho que criou a sessão. */
  role: DeviceRole;
  hubCameraId: CameraId;
  cameras: SessionCamera[];
  /** Calibração por câmera (Fase 2). */
  calibrations: Record<CameraId, TableCalibration>;
  notes?: string;
}

/** Pedaço de vídeo gravado (salvo durante a gravação para não perder dados). */
export interface VideoChunk {
  sessionId: SessionId;
  cameraId: CameraId;
  seq: number;
  blob: Blob;
}
