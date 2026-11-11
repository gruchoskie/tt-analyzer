/** Restrições de captura: ~720p, maior fps possível (ideal 60), câmera traseira. */

export const TARGET_WIDTH = 1280;
export const TARGET_HEIGHT = 720;
export const TARGET_FPS = 60;

export interface CaptureOptions {
  deviceId?: string;
  /** Pede microfone junto (necessário para quiques por áudio na Fase 4). */
  audio: boolean;
}

export function buildConstraints(opts: CaptureOptions): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: TARGET_WIDTH },
    height: { ideal: TARGET_HEIGHT },
    frameRate: { ideal: TARGET_FPS },
  };
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
  else video.facingMode = { ideal: 'environment' };
  return {
    video,
    audio: opts.audio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : false,
  };
}

/**
 * Dado o intervalo de fps que a câmera anuncia, escolhe o fps a pedir
 * no applyConstraints: o maior possível até TARGET_FPS.
 * Retorna null se não houver informação ou se não houver ganho.
 */
export function pickUpgradeFps(
  capabilityMax: number | undefined,
  currentFps: number | undefined,
  target = TARGET_FPS,
): number | null {
  if (!capabilityMax || !Number.isFinite(capabilityMax)) return null;
  const wanted = Math.min(capabilityMax, target);
  if (currentFps !== undefined && currentFps >= wanted - 0.5) return null;
  return wanted;
}
