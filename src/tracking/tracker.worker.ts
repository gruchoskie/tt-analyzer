/// <reference lib="webworker" />
import { BallTracker } from './BallTracker';
import { ClassicDetector, DEFAULT_DETECTOR_OPTIONS } from './classicDetector';
import { scaleRect } from './analysisGeometry';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Worker de rastreio: recebe quadros já reduzidos (ImageBitmap ou RGBA),
 * roda o detector clássico + Kalman e devolve o resultado. Roda fora da
 * thread da interface para não travar o vídeo.
 */
declare const self: DedicatedWorkerGlobalScope;

const detector = new ClassicDetector({ ...DEFAULT_DETECTOR_OPTIONS });
const tracker = new BallTracker();
let cfg: Extract<ToWorker, { type: 'config' }> | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'config') {
      cfg = msg;
      const sx = msg.analysisW / msg.videoW;
      const sy = msg.analysisH / msg.videoH;
      detector.opts = {
        ...DEFAULT_DETECTOR_OPTIONS,
        ...msg.detector,
        roi: msg.roi ? scaleRect(msg.roi, sx, sy) : undefined,
      };
      detector.reset();
      tracker.reset();
      if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(msg.analysisW, msg.analysisH);
        ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
      }
      post({ type: 'ready', offscreen: !!ctx });
      return;
    }
    if (msg.type === 'reset') {
      detector.reset();
      tracker.reset();
      return;
    }
    if (msg.type === 'frame') {
      if (!cfg) {
        msg.bitmap?.close();
        return;
      }
      const t0 = performance.now();
      const { analysisW: aw, analysisH: ah, videoW, videoH } = cfg;
      let rgba: Uint8ClampedArray;
      if (msg.bitmap) {
        if (!ctx) throw new Error('OffscreenCanvas indisponível');
        ctx.drawImage(msg.bitmap, 0, 0, aw, ah);
        msg.bitmap.close();
        rgba = ctx.getImageData(0, 0, aw, ah).data;
      } else if (msg.rgba) {
        rgba = new Uint8ClampedArray(msg.rgba);
      } else return;

      const sx = videoW / aw;
      const sy = videoH / ah;
      const cands = detector.detect(rgba, aw, ah).map((c) => ({
        x: (c.x + 0.5) * sx,
        y: (c.y + 0.5) * sy,
        radius: c.radius * (sx + sy) * 0.5,
        score: c.score,
      }));
      const step = tracker.step(msg.meta.timestamp.hubMs, msg.meta.frameIndex, cands);
      const det = step.detection;
      post({
        type: 'result',
        meta: msg.meta,
        candidates: cands,
        detection: det
          ? {
              sessionId: msg.meta.sessionId,
              cameraId: msg.meta.cameraId,
              frameIndex: msg.meta.frameIndex,
              timestamp: msg.meta.timestamp,
              x: det.x,
              y: det.y,
              radiusPx: det.radius,
              confidence: det.score,
              source: 'classic',
            }
          : null,
        state: step.state,
        point: step.point,
        trail: [...tracker.getTrail()],
        stats: tracker.getStats(),
        workMs: performance.now() - t0,
        maskPixels: detector.lastMaskCount,
        rejectedGlobal: detector.lastRejectedGlobal,
      });
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
