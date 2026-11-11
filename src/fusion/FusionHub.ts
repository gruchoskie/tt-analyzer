import type { AnalysisMode, BallDetection2D, CameraId } from '../core/types';

/**
 * Lado "hub" da arquitetura. Recebe detecções 2D de N câmeras, já com
 * timestamp no relógio do hub, e as agrupa por instante.
 *
 * Hoje (1 câmera) cada grupo tem uma única detecção e o modo é 2D.
 * Na Fase 9 a triangulação consome os grupos com 2+ câmeras calibradas,
 * sem que tracking/física/pose precisem mudar.
 */

export interface CameraState {
  cameraId: CameraId;
  /** Calibração 3D disponível (Fase 9). */
  calibrated3d: boolean;
  lastSeenHubMs: number;
  detections: number;
}

/** Observações de várias câmeras para (aproximadamente) o mesmo instante. */
export interface FusedObservation {
  hubMs: number;
  mode: AnalysisMode;
  /** Uma detecção por câmera (a de maior confiança, se houver mais de uma). */
  perCamera: BallDetection2D[];
  /** Câmeras ativas que não viram a bola neste instante. */
  missing: CameraId[];
}

export interface FusionOptions {
  /** Detecções a até ±groupToleranceMs são consideradas simultâneas. */
  groupToleranceMs: number;
  /** Espera por câmeras atrasadas antes de liberar um grupo. */
  latencyMs: number;
  /** Câmera sem dados há mais que isso é considerada perdida. */
  staleAfterMs: number;
}

export const DEFAULT_FUSION_OPTIONS: FusionOptions = {
  groupToleranceMs: 8,
  latencyMs: 60,
  staleAfterMs: 1500,
};

export class FusionHub {
  private readonly opts: FusionOptions;
  private cameras = new Map<CameraId, CameraState>();
  private buffer: BallDetection2D[] = [];
  private lastEmittedHubMs = -Infinity;

  constructor(opts: Partial<FusionOptions> = {}) {
    this.opts = { ...DEFAULT_FUSION_OPTIONS, ...opts };
  }

  addCamera(cameraId: CameraId, calibrated3d = false): void {
    const prev = this.cameras.get(cameraId);
    this.cameras.set(cameraId, {
      cameraId,
      calibrated3d,
      lastSeenHubMs: prev?.lastSeenHubMs ?? -Infinity,
      detections: prev?.detections ?? 0,
    });
  }

  removeCamera(cameraId: CameraId): void {
    this.cameras.delete(cameraId);
    this.buffer = this.buffer.filter((d) => d.cameraId !== cameraId);
  }

  /** Marca que a câmera está viva (heartbeat, mesmo sem detecção). */
  heartbeat(cameraId: CameraId, hubMs: number): void {
    const c = this.cameras.get(cameraId);
    if (c) c.lastSeenHubMs = Math.max(c.lastSeenHubMs, hubMs);
  }

  ingest(d: BallDetection2D): void {
    const c = this.cameras.get(d.cameraId);
    if (!c) throw new Error(`Câmera desconhecida: ${d.cameraId}`);
    c.lastSeenHubMs = Math.max(c.lastSeenHubMs, d.timestamp.hubMs);
    c.detections++;
    if (d.timestamp.hubMs <= this.lastEmittedHubMs) return; // chegou tarde demais
    this.buffer.push(d);
  }

  /** Câmeras com dados recentes no instante `nowHubMs`. */
  activeCameras(nowHubMs: number): CameraState[] {
    return [...this.cameras.values()].filter((c) => nowHubMs - c.lastSeenHubMs <= this.opts.staleAfterMs);
  }

  /** 3D só com 2+ câmeras ativas e calibradas em 3D; senão, degrada para 2D. */
  mode(nowHubMs: number): AnalysisMode {
    return this.activeCameras(nowHubMs).filter((c) => c.calibrated3d).length >= 2 ? '3d' : '2d';
  }

  /**
   * Libera os grupos cujo instante já passou da janela de espera
   * (nowHubMs - latencyMs), em ordem de tempo.
   */
  flush(nowHubMs: number): FusedObservation[] {
    const horizon = nowHubMs - this.opts.latencyMs;
    this.buffer.sort((a, b) => a.timestamp.hubMs - b.timestamp.hubMs);
    const out: FusedObservation[] = [];
    const active = this.activeCameras(nowHubMs).map((c) => c.cameraId);
    const mode = this.mode(nowHubMs);

    while (this.buffer.length > 0 && this.buffer[0].timestamp.hubMs <= horizon) {
      const t0 = this.buffer[0].timestamp.hubMs;
      let end = 0;
      while (end < this.buffer.length && this.buffer[end].timestamp.hubMs - t0 <= this.opts.groupToleranceMs) end++;
      const group = this.buffer.splice(0, end);

      const best = new Map<CameraId, BallDetection2D>();
      for (const d of group) {
        const cur = best.get(d.cameraId);
        if (!cur || d.confidence > cur.confidence) best.set(d.cameraId, d);
      }
      const perCamera = [...best.values()];
      const hubMs = perCamera.reduce((s, d) => s + d.timestamp.hubMs, 0) / perCamera.length;
      out.push({
        hubMs,
        mode,
        perCamera,
        missing: active.filter((id) => !best.has(id)),
      });
      this.lastEmittedHubMs = Math.max(this.lastEmittedHubMs, ...group.map((d) => d.timestamp.hubMs));
    }
    return out;
  }
}
