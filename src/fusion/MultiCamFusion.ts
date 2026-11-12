import type { AnalysisMode, CameraId, Point3 } from '../core/types';
import type { CameraModel } from './cameraPose';
import { Kalman3D } from './kalman3d';
import { analyzeFlight, splitFlights, type FlightMetrics } from './metrics3d';
import { interpolateTrack, triangulate, type View } from './triangulate';

/**
 * Fusão no hub (Fase 9): recebe as detecções 2D de cada câmera (já no relógio
 * do hub), interpola todas para os mesmos instantes, triangula com as câmeras
 * calibradas em 3D (RANSAC com 3+), suaviza com o Kalman 3D e fecha os voos
 * com as métricas 3D. Com menos de 2 câmeras calibradas vivas, fica em 2D
 * (as métricas 2D continuam vindo do celular hub, como antes).
 */

export interface CamStatus {
  cameraId: CameraId;
  calibrated3d: boolean;
  lastSeen: number;
  detections: number;
  /** Instantes em que entrou na triangulação / foi descartada pelo RANSAC. */
  used: number;
  rejected: number;
}

export interface Sample3D {
  t: number;
  /** Medida triangulada e estimativa do Kalman. */
  raw: Point3;
  p: Point3;
  v: Point3;
  cameras: CameraId[];
  rmsPx: number;
}

export interface FusionOptions3D {
  /** Passo da grade de tempo (ms). */
  stepMs: number;
  /** Espera por câmeras atrasadas (ms). */
  latencyMs: number;
  /** Câmera sem dados há mais que isso conta como perdida (ms). */
  staleMs: number;
  /** Buraco máximo no rastro 2D para interpolar (ms). */
  maxGapMs: number;
  ransacPx: number;
}

export const DEFAULT_FUSION_3D: FusionOptions3D = { stepMs: 1000 / 60, latencyMs: 150, staleMs: 1500, maxGapMs: 45, ransacPx: 10 };

export class MultiCamFusion {
  private readonly o: FusionOptions3D;
  private cams = new Map<CameraId, { model: CameraModel | null; track: { t: number; x: number; y: number }[]; st: CamStatus }>();
  private kf = new Kalman3D();
  private nextT = -Infinity;
  private flight: { t: number; p: Point3 }[] = [];
  readonly samples: Sample3D[] = [];
  readonly flights: FlightMetrics[] = [];

  constructor(opts: Partial<FusionOptions3D> = {}) {
    this.o = { ...DEFAULT_FUSION_3D, ...opts };
  }

  setCamera(cameraId: CameraId, model: CameraModel | null): void {
    const c = this.cams.get(cameraId);
    if (c) {
      c.model = model;
      c.st.calibrated3d = !!model;
    } else this.cams.set(cameraId, { model, track: [], st: { cameraId, calibrated3d: !!model, lastSeen: -Infinity, detections: 0, used: 0, rejected: 0 } });
  }

  removeCamera(cameraId: CameraId): void {
    this.cams.delete(cameraId);
  }

  heartbeat(cameraId: CameraId, t: number): void {
    const c = this.cams.get(cameraId);
    if (c) c.st.lastSeen = Math.max(c.st.lastSeen, t);
  }

  ingest(cameraId: CameraId, t: number, x: number, y: number): void {
    const c = this.cams.get(cameraId);
    if (!c) return;
    c.st.lastSeen = Math.max(c.st.lastSeen, t);
    c.st.detections++;
    const tr = c.track;
    if (tr.length && t <= tr[tr.length - 1].t) {
      // fora de ordem (rede): insere no lugar
      let i = tr.length - 1;
      while (i >= 0 && tr[i].t > t) i--;
      if (i >= 0 && tr[i].t === t) return;
      tr.splice(i + 1, 0, { t, x, y });
    } else tr.push({ t, x, y });
    if (this.nextT === -Infinity) this.nextT = t;
  }

  status(now: number): (CamStatus & { live: boolean })[] {
    return [...this.cams.values()].map((c) => ({ ...c.st, live: now - c.st.lastSeen <= this.o.staleMs }));
  }

  mode(now: number): AnalysisMode {
    return this.status(now).filter((s) => s.live && s.calibrated3d).length >= 2 ? '3d' : '2d';
  }

  /** Processa até `now − latência`. Devolve as novas amostras 3D e os voos fechados. */
  step(now: number): { samples: Sample3D[]; flights: FlightMetrics[] } {
    const outS: Sample3D[] = [];
    const outF: FlightMetrics[] = [];
    const horizon = now - this.o.latencyMs;
    if (this.nextT === -Infinity) return { samples: outS, flights: outF };
    for (; this.nextT <= horizon; this.nextT += this.o.stepMs) {
      const t = this.nextT;
      const views: View[] = [];
      for (const [id, c] of this.cams) {
        if (!c.model) continue;
        const q = interpolateTrack(c.track, t, this.o.maxGapMs);
        if (q) views.push({ cameraId: id, P: c.model.P, x: q.x, y: q.y });
      }
      const tri = views.length >= 2 ? triangulate(views, this.o.ransacPx) : null;
      if (!tri || tri.p.z < -0.1) {
        // sem medida: um buraco longo fecha o voo
        const last = this.flight[this.flight.length - 1];
        if (last && t - last.t > 120) outF.push(...this.closeFlight());
        continue;
      }
      for (const id of tri.cameras) this.cams.get(id)!.st.used++;
      for (const id of tri.rejected) this.cams.get(id)!.st.rejected++;
      // ruído da medida ~ erro de reprojeção × distância / foco (≈ 1 px ≈ 3 mm a 3 m)
      const est = this.kf.update(t, tri.p, Math.max(0.006, tri.rmsPx * 0.003));
      if (est.broke) outF.push(...this.closeFlight());
      this.flight.push({ t, p: tri.p });
      const s: Sample3D = { t, raw: tri.p, p: est.p, v: est.v, cameras: tri.cameras, rmsPx: tri.rmsPx };
      this.samples.push(s);
      outS.push(s);
    }
    // limpa o passado
    const keep = horizon - 3000;
    for (const c of this.cams.values()) while (c.track.length > 2 && c.track[1].t < keep) c.track.shift();
    while (this.samples.length && this.samples[0].t < keep - 30000) this.samples.shift();
    return { samples: outS, flights: outF };
  }

  flush(): FlightMetrics[] {
    return this.closeFlight();
  }

  private closeFlight(): FlightMetrics[] {
    const pts = this.flight;
    this.flight = [];
    const out: FlightMetrics[] = [];
    // o Kalman pode deixar passar uma quebra pequena: separa de novo pela parábola
    for (const part of splitFlights(pts)) {
      const m = analyzeFlight(part);
      if (m) out.push(m);
    }
    this.flights.push(...out);
    return out;
  }
}
