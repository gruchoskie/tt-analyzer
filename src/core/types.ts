/**
 * Tipos compartilhados por todos os módulos.
 *
 * Regra da arquitetura multi-câmera: todo quadro e toda detecção carregam
 * cameraId, sessionId e um timestamp com o relógio local + o deslocamento
 * para o relógio do hub. Com 1 celular o deslocamento é 0 (o aparelho é
 * câmera e hub ao mesmo tempo).
 */

export type CameraId = string;
export type SessionId = string;

/** Papel do aparelho. 'standalone' = 1 celular fazendo câmera + hub. */
export type DeviceRole = 'standalone' | 'camera' | 'hub';

/** Modo de análise. 2D = 1 câmera (plano da mesa); 3D = 2+ câmeras calibradas. */
export type AnalysisMode = '2d' | '3d';

/** Instante sincronizado, em milissegundos (epoch). */
export interface SyncedTimestamp {
  /** Relógio local do aparelho que capturou (performance.timeOrigin + performance.now()). */
  localMs: number;
  /** Deslocamento estimado para o relógio do hub: hubMs = localMs + offsetMs. */
  offsetMs: number;
  /** Instante no relógio do hub (derivado). */
  hubMs: number;
  /** Incerteza estimada da sincronia (± ms). 0 quando o aparelho é o próprio hub. */
  uncertaintyMs: number;
}

/** Metadados de um quadro de vídeo entregue por uma CameraSource. */
export interface FrameMeta {
  sessionId: SessionId | null;
  cameraId: CameraId;
  /** Contador monotônico de quadros desde que a fonte foi iniciada. */
  frameIndex: number;
  timestamp: SyncedTimestamp;
  width: number;
  height: number;
  /** Tempo de mídia do quadro (s), quando o navegador informa. */
  mediaTime?: number;
}

/** Detecção 2D da bola em pixels da imagem de uma câmera (Fase 3+). */
export interface BallDetection2D {
  sessionId: SessionId | null;
  cameraId: CameraId;
  frameIndex: number;
  timestamp: SyncedTimestamp;
  /** Centro da bola em pixels da imagem original. */
  x: number;
  y: number;
  radiusPx: number;
  /** 0..1 */
  confidence: number;
  /** Qual detector produziu (visão clássica hoje, modelo depois). */
  source: 'classic' | 'model';
}

/** Ponto em pixels. */
export interface Point2 {
  x: number;
  y: number;
}

/** Ponto 3D em metros, no referencial da mesa. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}
