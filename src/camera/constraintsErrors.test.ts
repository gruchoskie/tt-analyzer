import { describe, expect, it } from 'vitest';
import { buildConstraints, pickUpgradeFps } from './constraints';
import { checkCameraSupport, describeCameraError } from './errors';

describe('restrições de captura', () => {
  it('pede ~720p a 60 fps, câmera traseira, áudio cru', () => {
    const c = buildConstraints({ audio: true });
    const v = c.video as MediaTrackConstraints;
    expect(v.width).toEqual({ ideal: 1280 });
    expect(v.height).toEqual({ ideal: 720 });
    expect(v.frameRate).toEqual({ ideal: 60 });
    expect(v.facingMode).toEqual({ ideal: 'environment' });
    expect(c.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false });
  });

  it('usa deviceId exato quando escolhido e sem áudio', () => {
    const c = buildConstraints({ audio: false, deviceId: 'abc' });
    const v = c.video as MediaTrackConstraints;
    expect(v.deviceId).toEqual({ exact: 'abc' });
    expect(v.facingMode).toBeUndefined();
    expect(c.audio).toBe(false);
  });

  it('escolhe o fps de upgrade', () => {
    expect(pickUpgradeFps(120, 30)).toBe(60);
    expect(pickUpgradeFps(30, 24)).toBe(30);
    expect(pickUpgradeFps(60, 60)).toBeNull();
    expect(pickUpgradeFps(undefined, 30)).toBeNull();
  });
});

describe('mensagens de erro de câmera', () => {
  it('permissão negada', () => {
    const e = describeCameraError({ name: 'NotAllowedError' });
    expect(e.kind).toBe('denied');
    expect(e.canRetry).toBe(true);
    expect(e.message).toMatch(/permita/);
  });

  it('câmera ocupada / inexistente / inválida', () => {
    expect(describeCameraError({ name: 'NotReadableError' }).kind).toBe('busy');
    expect(describeCameraError({ name: 'NotFoundError' }).kind).toBe('not-found');
    expect(describeCameraError({ name: 'OverconstrainedError' }).kind).toBe('overconstrained');
    expect(describeCameraError({ name: 'NotSupportedError' }).kind).toBe('unsupported');
    expect(describeCameraError(new Error('x')).kind).toBe('unknown');
    expect(describeCameraError(null).kind).toBe('unknown');
  });

  it('verifica suporte antes de abrir', () => {
    expect(checkCameraSupport({ isSecureContext: false, hasGetUserMedia: true, hasMediaRecorder: true })?.kind).toBe('insecure');
    expect(checkCameraSupport({ isSecureContext: true, hasGetUserMedia: false, hasMediaRecorder: true })?.kind).toBe('unsupported');
    expect(checkCameraSupport({ isSecureContext: true, hasGetUserMedia: true, hasMediaRecorder: false })?.kind).toBe('unsupported');
    expect(checkCameraSupport({ isSecureContext: true, hasGetUserMedia: true, hasMediaRecorder: true })).toBeNull();
  });
});
