import type { CameraId, SessionId } from './types';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newSessionId(): SessionId {
  return `ses-${randomId()}`;
}

const CAMERA_ID_KEY = 'tt.cameraId';

/** Identificador estável deste aparelho como câmera (persistido no localStorage). */
export function getLocalCameraId(): CameraId {
  try {
    const existing = localStorage.getItem(CAMERA_ID_KEY);
    if (existing) return existing;
    const id = `cam-${randomId().slice(0, 8)}`;
    localStorage.setItem(CAMERA_ID_KEY, id);
    return id;
  } catch {
    return 'cam-local';
  }
}
