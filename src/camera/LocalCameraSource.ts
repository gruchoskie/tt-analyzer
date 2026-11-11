import { DeviceClock } from '../core/clock';
import type { CameraId, FrameMeta, SessionId } from '../core/types';
import type { CameraInfo, CameraSource, CameraStatus } from './CameraSource';
import { buildConstraints, pickUpgradeFps, type CaptureOptions } from './constraints';
import { FpsMeter } from './fpsMeter';

type FrameCb = (frame: FrameMeta) => void;

interface VideoFrameMetaLike {
  mediaTime: number;
  width: number;
  height: number;
  presentedFrames: number;
  captureTime?: number;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMetaLike) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export interface StartResult {
  stream: MediaStream;
  /** true quando o microfone foi pedido mas negado (vídeo segue sem áudio). */
  audioDenied: boolean;
}

/**
 * Câmera deste aparelho. Exibe a imagem no <video> recebido e mede
 * cada quadro real com requestVideoFrameCallback (fallback: rAF + mudança
 * de currentTime).
 */
export class LocalCameraSource implements CameraSource {
  readonly kind = 'local' as const;
  status: CameraStatus = 'idle';

  private stream: MediaStream | null = null;
  private sessionId: SessionId | null = null;
  private listeners = new Set<FrameCb>();
  private meter = new FpsMeter(1000);
  private frameIndex = 0;
  private loopHandle: number | null = null;
  private lastPresented = -1;
  private lastMediaTime = -1;
  private frameClock: CameraInfo['frameClock'] = 'animation-frame';

  constructor(
    readonly cameraId: CameraId,
    private readonly video: HTMLVideoElement,
    private readonly clock: DeviceClock = new DeviceClock(),
  ) {}

  async start(opts: CaptureOptions): Promise<StartResult> {
    this.stop();
    this.status = 'starting';
    let audioDenied = false;
    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(opts));
      } catch (err) {
        // Se só o microfone falhar, segue com vídeo.
        const name = (err as { name?: string }).name;
        if (opts.audio && (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError')) {
          stream = await navigator.mediaDevices.getUserMedia(buildConstraints({ ...opts, audio: false }));
          audioDenied = true;
        } else {
          throw err;
        }
      }
    } catch (err) {
      this.status = 'error';
      throw err;
    }

    this.stream = stream;
    await this.tryUpgradeFps();

    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => undefined);

    this.meter.reset();
    this.frameIndex = 0;
    this.status = 'live';
    this.startFrameLoop();
    return { stream, audioDenied };
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  setSession(sessionId: SessionId | null): void {
    this.sessionId = sessionId;
  }

  onFrame(cb: FrameCb): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getInfo(): CameraInfo {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    const caps = track && 'getCapabilities' in track ? track.getCapabilities?.() : undefined;
    return {
      cameraId: this.cameraId,
      label: track?.label ?? '',
      deviceId: settings?.deviceId,
      width: this.video.videoWidth || settings?.width || 0,
      height: this.video.videoHeight || settings?.height || 0,
      reportedFps: settings?.frameRate,
      maxFps: caps?.frameRate?.max,
      measuredFps: this.meter.fps(),
      maxGapMs: this.meter.maxGapMs(),
      hasAudio: (this.stream?.getAudioTracks().length ?? 0) > 0,
      frameClock: this.frameClock,
    };
  }

  stop(): void {
    this.stopFrameLoop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video.srcObject) this.video.srcObject = null;
    if (this.status !== 'idle') this.status = 'stopped';
  }

  private async tryUpgradeFps(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !('getCapabilities' in track) || !track.getCapabilities) return;
    try {
      const max = track.getCapabilities().frameRate?.max;
      const fps = pickUpgradeFps(max, track.getSettings().frameRate);
      if (fps) await track.applyConstraints({ ...track.getConstraints(), frameRate: { ideal: fps } });
    } catch {
      // Sem problema: segue com o fps que a câmera entregar.
    }
  }

  private emit(localMs: number, mediaTime?: number, count = 1): void {
    this.meter.push(localMs, count);
    this.frameIndex += count;
    const frame: FrameMeta = {
      sessionId: this.sessionId,
      cameraId: this.cameraId,
      frameIndex: this.frameIndex - 1,
      timestamp: this.clock.stamp(localMs),
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      mediaTime,
    };
    this.listeners.forEach((cb) => cb(frame));
  }

  private startFrameLoop(): void {
    const v = this.video as VideoWithRvfc;
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.frameClock = 'video-frame-callback';
      const tick = (now: number, meta: VideoFrameMetaLike) => {
        // presentedFrames pode pular (quadros que chegaram mas não foram exibidos):
        // conta todos, para o fps refletir a câmera e não a tela.
        const count = this.lastPresented >= 0 ? Math.max(1, meta.presentedFrames - this.lastPresented) : 1;
        this.lastPresented = meta.presentedFrames;
        // captureTime (quando existe) é o instante real de captura; senão, o callback.
        this.emit(performance.timeOrigin + (meta.captureTime ?? now), meta.mediaTime, count);
        this.loopHandle = v.requestVideoFrameCallback!(tick);
      };
      this.lastPresented = -1;
      this.loopHandle = v.requestVideoFrameCallback(tick);
    } else {
      this.frameClock = 'animation-frame';
      const tick = (now: number) => {
        const t = this.video.currentTime;
        if (t !== this.lastMediaTime) {
          this.lastMediaTime = t;
          this.emit(performance.timeOrigin + now, t);
        }
        this.loopHandle = requestAnimationFrame(tick);
      };
      this.loopHandle = requestAnimationFrame(tick);
    }
  }

  private stopFrameLoop(): void {
    if (this.loopHandle === null) return;
    const v = this.video as VideoWithRvfc;
    if (this.frameClock === 'video-frame-callback') v.cancelVideoFrameCallback?.(this.loopHandle);
    else cancelAnimationFrame(this.loopHandle);
    this.loopHandle = null;
  }
}
