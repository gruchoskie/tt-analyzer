import type { CameraId, FrameMeta, SessionId } from '../core/types';

/**
 * Abstração de uma fonte de câmera. Hoje só existe a câmera local
 * (LocalCameraSource); na Fase 9 uma RemoteCameraSource representará um
 * celular conectado ao hub por WebRTC e entregará as mesmas FrameMeta /
 * detecções, de modo que tracking, física e pose não precisem mudar.
 */
export interface CameraSource {
  readonly cameraId: CameraId;
  readonly kind: 'local' | 'remote';
  readonly status: CameraStatus;

  /** Sessão à qual os próximos quadros pertencem (null = só pré-visualização). */
  setSession(sessionId: SessionId | null): void;

  /** Assina os quadros. Retorna a função para cancelar. */
  onFrame(cb: (frame: FrameMeta) => void): () => void;

  /** Informações atuais da captura. */
  getInfo(): CameraInfo;

  stop(): void;
}

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error' | 'stopped';

export interface CameraInfo {
  cameraId: CameraId;
  label: string;
  deviceId?: string;
  width: number;
  height: number;
  /** fps anunciado pelo navegador (track.getSettings().frameRate). */
  reportedFps?: number;
  /** fps máximo que a câmera diz suportar. */
  maxFps?: number;
  /** fps realmente medido a partir da chegada dos quadros. */
  measuredFps: number;
  /** Maior intervalo entre quadros no último segundo (ms). */
  maxGapMs: number;
  hasAudio: boolean;
  /** Método usado para medir os quadros. */
  frameClock: 'video-frame-callback' | 'animation-frame';
}

export interface VideoInputDevice {
  deviceId: string;
  label: string;
}

export async function listVideoInputs(): Promise<VideoInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }));
}
