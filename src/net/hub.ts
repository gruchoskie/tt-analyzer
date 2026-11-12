import { localNowMs } from '../core/clock';
import type { Point2 } from '../core/types';
import type { Quad } from '../calibration/calibrate';
import type { TableCalibration } from '../calibration/types';
import { calibrateCamera3D, reprojectionQuality, type CameraModel } from '../fusion/cameraPose';
import { refineWithEvents } from '../fusion/clockSync';
import type { FlightMetrics } from '../fusion/metrics3d';
import { MultiCamFusion, type Sample3D } from '../fusion/MultiCamFusion';
import { getStore } from '../storage/storeSingleton';
import { PeerLink, type LinkState } from './PeerLink';
import { PROTOCOL_VERSION, type LinkMsg } from './protocol';

/**
 * Hub (Fase 9): o celular que junta as câmeras. Guarda as conexões, responde
 * aos pings de sincronia, recebe detecções/calibração/tocs, roda a fusão 3D e
 * recebe os vídeos gravados nas câmeras ao fim de cada gravação.
 */

export interface RemoteCam {
  key: number;
  link: PeerLink;
  state: LinkState;
  cameraId: string | null;
  label: string;
  stats: { fps: number; analysisFps: number; detRate: number; width: number; height: number } | null;
  sync: { offsetMs: number; uncertaintyMs: number; rttMs: number; source: string } | null;
  rttMs: number | null;
  model: CameraModel | null;
  quality: ReturnType<typeof reprojectionQuality> | null;
  lastMsg: number;
  onsets: number[];
  video: { sessionId: string; got: number; size: number } | null;
}

export interface HubSnapshot {
  version: number;
  cams: RemoteCam[];
  local: { cameraId: string | null; model: CameraModel | null; quality: RemoteCam['quality']; lastSeen: number };
  mode: '2d' | '3d';
  status: ReturnType<MultiCamFusion['status']>;
  recent: Sample3D[];
  flights: FlightMetrics[];
  clap: { until: number; result: string | null } | null;
  notice: string | null;
}

function modelFrom(width: number, height: number, corners: Point2[], posts: Point2[] | null): CameraModel | null {
  if (corners.length !== 4) return null;
  return calibrateCamera3D({ width, height, corners: corners as Quad, netPosts: posts && posts.length === 2 ? [posts[0], posts[1]] : null });
}

class Hub {
  private cams: RemoteCam[] = [];
  private nextKey = 1;
  fusion = new MultiCamFusion();
  private localId: string | null = null;
  private localModel: CameraModel | null = null;
  private localSeen = -Infinity;
  private localOnsets: number[] = [];
  private clap: HubSnapshot['clap'] = null;
  private notice: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private snap: HubSnapshot | null = null;
  private videoBuf = new Map<number, { meta: Extract<LinkMsg, { k: 'vid-start' }>; seq: number }>();

  get active(): boolean {
    return this.cams.length > 0;
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private changed() {
    this.version++;
    this.snap = null;
    for (const l of this.listeners) l();
  }

  snapshot = (): HubSnapshot => {
    if (this.snap) return this.snap;
    const now = localNowMs();
    this.snap = {
      version: this.version,
      cams: [...this.cams],
      local: { cameraId: this.localId, model: this.localModel, quality: this.localModel ? reprojectionQuality(this.localModel) : null, lastSeen: this.localSeen },
      mode: this.fusion.mode(now),
      status: this.fusion.status(now),
      recent: this.fusion.samples.filter((s) => s.t > now - 4000),
      flights: this.fusion.flights.slice(-30),
      clap: this.clap,
      notice: this.notice,
    };
    return this.snap;
  };

  private ensureTimer() {
    if (this.timer !== null) return;
    let n = 0;
    this.timer = window.setInterval(() => {
      const { samples, flights } = this.fusion.step(localNowMs());
      n++;
      if (n % 10 === 0) for (const c of this.cams) void c.link.rttMs().then((r) => (c.rttMs = r));
      if (this.clap && localNowMs() > this.clap.until && !this.clap.result) this.finishClap();
      if (samples.length || flights.length || n % 5 === 0) this.changed();
    }, 100);
  }

  /** Nova câmera: devolve o código da oferta e a função para aceitar a resposta. */
  async addCamera(): Promise<{ code: string; accept: (answer: string) => Promise<void>; cancel: () => void }> {
    const { link, code } = await PeerLink.offer();
    const cam: RemoteCam = {
      key: this.nextKey++,
      link,
      state: 'pareando',
      cameraId: null,
      label: `Câmera ${this.cams.length + 2}`,
      stats: null,
      sync: null,
      rttMs: null,
      model: null,
      quality: null,
      lastMsg: 0,
      onsets: [],
      video: null,
    };
    link.onState = (s) => {
      cam.state = s;
      if (s === 'conectado') link.send({ k: 'hello', cameraId: this.localId ?? 'hub', label: 'Hub', role: 'hub', version: PROTOCOL_VERSION });
      if ((s === 'caiu' || s === 'fechado') && cam.cameraId) this.notice = `${cam.label} desconectou: seguindo com as outras câmeras.`;
      this.changed();
    };
    link.onMessage = (m) => this.onMsg(cam, m);
    link.onBinary = (b) => void this.onVideoChunk(cam, b);
    this.cams.push(cam);
    this.ensureTimer();
    this.changed();
    return {
      code,
      accept: async (answer) => {
        await link.acceptAnswer(answer);
        this.changed();
      },
      cancel: () => this.remove(cam.key),
    };
  }

  remove(key: number) {
    const c = this.cams.find((x) => x.key === key);
    if (!c) return;
    c.link.close();
    if (c.cameraId) this.fusion.removeCamera(c.cameraId);
    this.cams = this.cams.filter((x) => x !== c);
    this.changed();
  }

  private onMsg(cam: RemoteCam, m: LinkMsg) {
    const now = localNowMs();
    cam.lastMsg = now;
    switch (m.k) {
      case 'ping':
        cam.link.sendFast({ k: 'pong', id: m.id, t0: m.t0, t1: now, t2: localNowMs() });
        return;
      case 'hello':
        cam.cameraId = m.cameraId;
        cam.label = m.label || cam.label;
        this.fusion.setCamera(m.cameraId, cam.model);
        break;
      case 'sync':
        cam.sync = m;
        break;
      case 'calib':
        cam.model = modelFrom(m.width, m.height, m.corners, m.netPosts);
        cam.quality = cam.model ? reprojectionQuality(cam.model) : null;
        if (cam.cameraId) this.fusion.setCamera(cam.cameraId, cam.model);
        break;
      case 'det':
        if (!cam.cameraId) return;
        for (const [t, x, y] of m.d) this.fusion.ingest(cam.cameraId, t, x, y);
        this.fusion.heartbeat(cam.cameraId, m.tNow);
        return;
      case 'stats':
        cam.stats = m;
        if (cam.cameraId) this.fusion.heartbeat(cam.cameraId, now);
        break;
      case 'onsets':
        cam.onsets.push(...m.t);
        cam.onsets = cam.onsets.filter((t) => t > now - 30000);
        return;
      case 'vid-start':
        this.videoBuf.set(cam.key, { meta: m, seq: 0 });
        cam.video = { sessionId: m.sessionId, got: 0, size: m.size };
        void this.prepareVideo(m);
        break;
      case 'vid-end':
        void this.finishVideo(cam);
        break;
      case 'bye':
        cam.state = 'fechado';
        break;
    }
    this.changed();
  }

  /* ---------- câmera do próprio hub ---------- */

  setLocal(cameraId: string, cal: TableCalibration | null) {
    this.localId = cameraId;
    this.localModel = cal ? modelFrom(cal.imageWidth, cal.imageHeight, cal.cornersPx, cal.netPostsPx ?? null) : null;
    this.fusion.setCamera(cameraId, this.localModel);
    this.changed();
  }

  ingestLocal(t: number, x: number, y: number) {
    if (!this.localId) return;
    this.localSeen = t;
    this.fusion.ingest(this.localId, t, x, y);
  }

  heartbeatLocal(t: number) {
    if (!this.localId) return;
    this.localSeen = t;
    this.fusion.heartbeat(this.localId, t);
  }

  addLocalOnsets(times: number[]) {
    const now = localNowMs();
    this.localOnsets.push(...times);
    this.localOnsets = this.localOnsets.filter((t) => t > now - 30000);
  }

  /* ---------- sincronia por palma / tocs ---------- */

  startClap(seconds = 6) {
    this.clap = { until: localNowMs() + seconds * 1000, result: null };
    this.changed();
  }

  private finishClap() {
    const from = this.clap!.until - 8000;
    const hub = this.localOnsets.filter((t) => t >= from);
    const parts: string[] = [];
    for (const c of this.cams) {
      if (c.state !== 'conectado') continue;
      const r = refineWithEvents(hub, c.onsets.filter((t) => t >= from - 100), 60, 1);
      if (r) {
        c.link.send({ k: 'synccorr', correctionMs: r.correctionMs, uncertaintyMs: r.uncertaintyMs });
        parts.push(`${c.label}: ${r.correctionMs >= 0 ? '+' : ''}${r.correctionMs.toFixed(1)} ms`);
      } else parts.push(`${c.label}: não ouviu`);
    }
    this.clap = { until: this.clap!.until, result: hub.length ? `Ajuste pela palma — ${parts.join(' · ') || 'sem câmeras'}` : 'O hub não ouviu a palma (microfone ligado?).' };
    this.changed();
  }

  /* ---------- gravação ---------- */

  startRecording(sessionId: string, name: string) {
    for (const c of this.cams) c.link.send({ k: 'rec', on: true, sessionId, name });
  }

  stopRecording(sessionId: string, name: string) {
    for (const c of this.cams) c.link.send({ k: 'rec', on: false, sessionId, name });
  }

  private async prepareVideo(m: Extract<LinkMsg, { k: 'vid-start' }>) {
    const store = await getStore();
    const s = await store.get(m.sessionId);
    if (!s) return;
    await store.upsertCamera(m.sessionId, {
      cameraId: m.cameraId,
      label: m.label,
      width: m.width,
      height: m.height,
      measuredFps: m.fps,
      mimeType: m.mimeType,
      hasAudio: true,
      durationMs: m.durationMs,
      sizeBytes: 0,
      chunkCount: 0,
      clockOffsetMs: m.clockOffsetMs,
      startedAtHubMs: m.startedAtHubMs,
    });
  }

  private async onVideoChunk(cam: RemoteCam, b: ArrayBuffer) {
    const v = this.videoBuf.get(cam.key);
    if (!v) return;
    const seq = v.seq++;
    const store = await getStore();
    await store.appendChunk(v.meta.sessionId, v.meta.cameraId, seq, new Blob([b]));
    if (cam.video) cam.video.got += b.byteLength;
    if (seq % 20 === 0) this.changed();
  }

  private async finishVideo(cam: RemoteCam) {
    const v = this.videoBuf.get(cam.key);
    if (!v) return;
    this.videoBuf.delete(cam.key);
    const store = await getStore();
    const s = await store.get(v.meta.sessionId);
    const c = s?.cameras.find((x) => x.cameraId === v.meta.cameraId);
    if (s && c) {
      const st = await store.chunkStats(s.id, c.cameraId);
      await store.upsertCamera(s.id, { ...c, sizeBytes: st.bytes, chunkCount: st.count });
      const calibrated = [s.hubCameraId, c.cameraId].length >= 2 && this.fusion.mode(localNowMs()) === '3d';
      if (calibrated && s.mode !== '3d') await store.update(s.id, { mode: '3d' });
    }
    cam.video = null;
    this.notice = `Vídeo de ${cam.label} recebido.`;
    this.changed();
  }

  /** Câmeras conectadas e vivas (para o selo da tela da câmera). */
  liveCount(): number {
    return this.cams.filter((c) => c.state === 'conectado').length;
  }
}

export const hub = new Hub();
