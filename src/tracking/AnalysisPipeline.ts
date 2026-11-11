import { FpsMeter } from '../camera/fpsMeter';
import type { CameraId, FrameMeta } from '../core/types';
import { analysisSize, type Rect } from './analysisGeometry';
import type { DetectorOptions } from './classicDetector';
import type { FrameResult, FromWorker, ToWorker } from './protocol';
import { computeBallPrior } from './ballPrior';
import type { BallProfile } from './ballProfile';
import type { TableCalibration } from '../calibration/types';
import { rescaleCalibration } from '../calibration/calibrate';

export interface PipelineStats {
  /** Quadros analisados por segundo. */
  analysisFps: number;
  /** Tempo médio de processamento no Worker (ms). */
  workMs: number;
  /** Tempo médio do envio até o resultado (ms). */
  latencyMs: number;
  /** Quadros descartados porque o Worker ainda estava ocupado. */
  dropped: number;
  submitted: number;
  mode: 'bitmap' | 'rgba';
  analysisW: number;
  analysisH: number;
}

export interface PipelineOptions {
  cameraId: CameraId;
  analysisWidth: number;
  detector?: Partial<DetectorOptions>;
  /** ROI em px do vídeo. */
  roi?: Rect | null;
  /** Calibração da mesa (para tamanho esperado da bola, região do jogo e velocidade máxima). */
  calibration?: TableCalibration | null;
  /** Bola escolhida pelo usuário. */
  profile?: BallProfile | null;
}

/**
 * Lado "dispositivo-câmera" do rastreio: pega quadros do <video>, reduz a
 * resolução e manda para o Worker. Se o Worker ainda estiver ocupado com o
 * quadro anterior, descarta o novo (prioriza tempo real a processar tudo).
 */
export class AnalysisPipeline {
  private worker: Worker;
  private busy = false;
  private configured = false;
  private videoW = 0;
  private videoH = 0;
  private aw = 0;
  private ah = 0;
  private useBitmap = typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
  private canvas: HTMLCanvasElement | null = null;
  private meter = new FpsMeter(1000);
  private workAvg = 0;
  private latAvg = 0;
  private dropped = 0;
  private submitted = 0;
  onResult?: (r: FrameResult) => void;
  onError?: (message: string) => void;

  constructor(
    private readonly video: HTMLVideoElement,
    private opts: PipelineOptions,
  ) {
    this.worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    this.worker.onerror = (ev) => this.onError?.(ev.message || 'Erro no Worker de rastreio');
  }

  /** Atualiza ROI/opções (ex.: depois de calibrar). */
  update(opts: Partial<PipelineOptions>): void {
    this.opts = { ...this.opts, ...opts };
    this.configured = false;
  }

  reset(): void {
    this.worker.postMessage({ type: 'reset' } satisfies ToWorker);
  }

  stats(): PipelineStats {
    return {
      analysisFps: this.meter.fps(),
      workMs: this.workAvg,
      latencyMs: this.latAvg,
      dropped: this.dropped,
      submitted: this.submitted,
      mode: this.useBitmap ? 'bitmap' : 'rgba',
      analysisW: this.aw,
      analysisH: this.ah,
    };
  }

  dispose(): void {
    this.worker.terminate();
  }

  private configure(): void {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const a = analysisSize({ width: vw, height: vh }, this.opts.analysisWidth);
    this.videoW = vw;
    this.videoH = vh;
    this.aw = a.width;
    this.ah = a.height;
    const cal = this.opts.calibration ? rescaleCalibration(this.opts.calibration, vw, vh) : null;
    let prior = null;
    try {
      prior = cal ? computeBallPrior(cal, a.width, a.height) : null;
    } catch {
      prior = null;
    }
    const msg: ToWorker = {
      type: 'config',
      videoW: vw,
      videoH: vh,
      analysisW: a.width,
      analysisH: a.height,
      detector: this.opts.detector ?? {},
      roi: this.opts.roi ?? null,
      prior,
      profile: this.opts.profile ?? null,
    };
    this.worker.postMessage(msg);
    this.configured = true;
  }

  /** Envia o quadro atual do vídeo, ou descarta se o Worker estiver ocupado. */
  submit(frame: Pick<FrameMeta, 'frameIndex' | 'timestamp' | 'sessionId'>): void {
    if (!this.video.videoWidth) return;
    if (this.busy) {
      this.dropped++;
      return;
    }
    if (!this.configured || this.video.videoWidth !== this.videoW || this.video.videoHeight !== this.videoH) this.configure();
    this.busy = true;
    this.submitted++;
    const meta = {
      frameIndex: frame.frameIndex,
      timestamp: frame.timestamp,
      sessionId: frame.sessionId,
      cameraId: this.opts.cameraId,
      sentAt: performance.now(),
    };
    if (this.useBitmap) {
      createImageBitmap(this.video, { resizeWidth: this.aw, resizeHeight: this.ah, resizeQuality: 'low' })
        .then((bitmap) => this.worker.postMessage({ type: 'frame', meta, bitmap } satisfies ToWorker, [bitmap]))
        .catch(() => {
          // Navegador sem createImageBitmap(video)/redimensionamento: usa o canvas principal.
          this.useBitmap = false;
          this.sendRgba(meta);
        });
    } else {
      this.sendRgba(meta);
    }
  }

  private sendRgba(meta: Extract<ToWorker, { type: 'frame' }>['meta']): void {
    try {
      if (!this.canvas) this.canvas = document.createElement('canvas');
      const c = this.canvas;
      if (c.width !== this.aw || c.height !== this.ah) {
        c.width = this.aw;
        c.height = this.ah;
      }
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D indisponível');
      ctx.drawImage(this.video, 0, 0, this.aw, this.ah);
      const data = ctx.getImageData(0, 0, this.aw, this.ah).data;
      this.worker.postMessage({ type: 'frame', meta, rgba: data.buffer } satisfies ToWorker, [data.buffer]);
    } catch (err) {
      this.busy = false;
      this.onError?.((err as Error).message);
    }
  }

  private handle(msg: FromWorker): void {
    if (msg.type === 'ready') {
      if (!msg.offscreen) this.useBitmap = false;
      return;
    }
    if (msg.type === 'error') {
      this.busy = false;
      if (/OffscreenCanvas/.test(msg.message)) this.useBitmap = false;
      this.onError?.(msg.message);
      return;
    }
    this.busy = false;
    const now = performance.now();
    this.meter.push(now);
    const a = 0.1;
    this.workAvg = this.workAvg ? this.workAvg * (1 - a) + msg.workMs * a : msg.workMs;
    const lat = now - msg.meta.sentAt;
    this.latAvg = this.latAvg ? this.latAvg * (1 - a) + lat * a : lat;
    this.onResult?.(msg);
  }
}
