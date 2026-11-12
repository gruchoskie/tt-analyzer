import { localNowMs } from '../core/clock';
import { getLocalCameraId } from '../core/ids';
import type { TableCalibration } from '../calibration/types';
import { estimateOffset, type ClockEstimate, type PingSample } from '../fusion/clockSync';
import { getStore } from '../storage/storeSingleton';
import { PeerLink, type LinkState } from './PeerLink';
import { PROTOCOL_VERSION, type LinkMsg } from './protocol';

/**
 * Lado "câmera" (Fase 9): conexão com o hub, sincronia de relógio por pings
 * (e a correção da palma), envio das detecções 2D já no relógio do hub, da
 * calibração, dos tocs do áudio e, ao fim da gravação, do vídeo.
 */

export interface CameraLinkSnapshot {
  version: number;
  state: LinkState | 'desligado';
  hubLabel: string | null;
  clock: (ClockEstimate & { correctionMs: number }) | null;
  sending: { sessionId: string; sent: number; size: number } | null;
  notice: string | null;
}

class CameraLink {
  private link: PeerLink | null = null;
  private state: CameraLinkSnapshot['state'] = 'desligado';
  private hubLabel: string | null = null;
  private pings: PingSample[] = [];
  private pingId = 0;
  private pending = new Map<number, number>();
  private est: ClockEstimate | null = null;
  private correction = 0;
  private corrUnc = 0;
  private dets: [number, number, number][] = [];
  private timer: number | null = null;
  private sending: CameraLinkSnapshot['sending'] = null;
  private notice: string | null = null;
  private version = 0;
  private snap: CameraLinkSnapshot | null = null;
  private listeners = new Set<() => void>();
  /** Quem grava neste aparelho (CameraScreen) escuta os comandos do hub. */
  onRec: ((m: Extract<LinkMsg, { k: 'rec' }>) => void) | null = null;
  private lastCalib: string | null = null;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private changed() {
    this.version++;
    this.snap = null;
    for (const l of this.listeners) l();
  }

  snapshot = (): CameraLinkSnapshot => {
    if (!this.snap)
      this.snap = {
        version: this.version,
        state: this.state,
        hubLabel: this.hubLabel,
        clock: this.clock(),
        sending: this.sending,
        notice: this.notice,
      };
    return this.snap;
  };

  /** Relógio atual (sempre recalculado: o snapshot pode estar velho dentro de um handler). */
  private clock(): CameraLinkSnapshot['clock'] {
    const e = this.est;
    if (!e) return null;
    return { ...e, offsetMs: e.offsetMs + this.correction, uncertaintyMs: this.corrUnc ? Math.min(e.uncertaintyMs, this.corrUnc + 1) : e.uncertaintyMs, correctionMs: this.correction };
  }

  get connected(): boolean {
    return this.state === 'conectado';
  }

  /** Deslocamento atual para o relógio do hub (0 se não conectado). */
  offset(): { offsetMs: number; uncertaintyMs: number } | null {
    const c = this.clock();
    return c ? { offsetMs: c.offsetMs, uncertaintyMs: c.uncertaintyMs } : null;
  }

  /** Lê o código do hub e devolve o código de resposta para mostrar. */
  async join(offerCode: string): Promise<string> {
    this.leave();
    const { link, code } = await PeerLink.answer(offerCode);
    this.link = link;
    this.state = 'conectando';
    link.onState = (s) => {
      this.state = s;
      if (s === 'conectado') {
        link.send({ k: 'hello', cameraId: getLocalCameraId(), label: `Câmera ${getLocalCameraId().slice(4, 8)}`, role: 'camera', version: PROTOCOL_VERSION });
        this.lastCalib = null;
        this.startLoop();
      }
      this.changed();
    };
    link.onMessage = (m) => this.onMsg(m);
    this.changed();
    return code;
  }

  leave() {
    this.link?.close();
    this.link = null;
    this.state = 'desligado';
    this.pings = [];
    this.est = null;
    this.correction = 0;
    this.corrUnc = 0;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.changed();
  }

  private startLoop() {
    if (this.timer !== null) return;
    let n = 0;
    this.timer = window.setInterval(() => {
      if (!this.link?.open) return;
      n++;
      // pings: rajada no começo, depois 1 a cada ~1 s
      if (this.pings.length < 24 || n % 20 === 0) {
        const id = ++this.pingId;
        const t0 = localNowMs();
        this.pending.set(id, t0);
        this.link.sendFast({ k: 'ping', id, t0 });
      }
      if (this.dets.length) {
        this.link.sendFast({ k: 'det', d: this.dets, tNow: localNowMs() + (this.offset()?.offsetMs ?? 0) });
        this.dets = [];
      }
    }, 50);
  }

  private onMsg(m: LinkMsg) {
    switch (m.k) {
      case 'hello':
        this.hubLabel = m.label;
        break;
      case 'pong': {
        const t3 = localNowMs();
        if (!this.pending.has(m.id)) return;
        this.pending.delete(m.id);
        this.pings.push({ t0: m.t0, t1: m.t1, t2: m.t2, t3 });
        if (this.pings.length > 40) this.pings.shift();
        const prev = this.est?.offsetMs;
        this.est = estimateOffset(this.pings);
        const c = this.clock();
        if (this.est && c) {
          this.link?.send({ k: 'sync', offsetMs: c.offsetMs, uncertaintyMs: c.uncertaintyMs, rttMs: this.est.rttMs, source: this.corrUnc ? 'eventos' : 'ping' });
          if (prev !== undefined && Math.abs(prev - this.est.offsetMs) < 0.5) return;
        }
        break;
      }
      case 'synccorr':
        // o hub mediu a diferença que sobrou com a palma: soma à correção
        this.correction += m.correctionMs;
        this.corrUnc = m.uncertaintyMs;
        this.notice = `Sincronia ajustada pela palma (${m.correctionMs >= 0 ? '+' : ''}${m.correctionMs.toFixed(1)} ms).`;
        break;
      case 'rec':
        this.onRec?.(m);
        break;
      case 'bye':
        this.state = 'fechado';
        break;
    }
    this.changed();
  }

  /* ---------- dados enviados pela tela da câmera ---------- */

  sendCalibration(cal: TableCalibration | null) {
    if (!this.link?.open || !cal) return;
    const key = JSON.stringify([cal.cornersPx, cal.netPostsPx, cal.imageWidth, cal.imageHeight]);
    if (key === this.lastCalib) return;
    this.lastCalib = key;
    this.link.send({ k: 'calib', width: cal.imageWidth, height: cal.imageHeight, corners: cal.cornersPx, netPosts: cal.netPostsPx ?? null });
  }

  /** Detecção da bola (t já no relógio do hub). */
  detection(t: number, x: number, y: number) {
    if (this.connected) this.dets.push([t, x, y]);
  }

  stats(s: { fps: number; analysisFps: number; detRate: number; width: number; height: number }) {
    this.link?.send({ k: 'stats', ...s });
  }

  onsets(hubTimes: number[]) {
    if (hubTimes.length) this.link?.send({ k: 'onsets', t: hubTimes });
  }

  /** Manda o vídeo gravado desta sessão para o hub (em pedaços). */
  async sendVideo(sessionId: string) {
    const link = this.link;
    if (!link?.open) return;
    const store = await getStore();
    const s = await store.get(sessionId);
    const cam = s?.cameras.find((c) => c.cameraId === getLocalCameraId());
    if (!s || !cam) return;
    const blob = await store.getVideo(sessionId, cam.cameraId, cam.mimeType);
    if (!blob) return;
    this.sending = { sessionId, sent: 0, size: blob.size };
    this.changed();
    link.send({
      k: 'vid-start',
      sessionId,
      cameraId: cam.cameraId,
      label: `Câmera ${cam.cameraId.slice(4, 8)}`,
      mimeType: cam.mimeType,
      size: blob.size,
      startedAtHubMs: cam.startedAtHubMs,
      durationMs: cam.durationMs,
      width: cam.width,
      height: cam.height,
      fps: cam.measuredFps,
      clockOffsetMs: cam.clockOffsetMs,
    });
    const CH = 64 * 1024;
    let n = 0;
    try {
      for (let off = 0; off < blob.size; off += CH) {
        await link.sendBinary(await blob.slice(off, off + CH).arrayBuffer());
        n++;
        this.sending = { sessionId, sent: Math.min(blob.size, off + CH), size: blob.size };
        if (n % 16 === 0) this.changed();
      }
      link.send({ k: 'vid-end', sessionId, chunks: n });
      this.notice = 'Vídeo enviado ao hub.';
    } catch {
      this.notice = 'A conexão caiu no meio do envio do vídeo (ele continua salvo neste celular).';
    }
    this.sending = null;
    this.changed();
  }
}

export const cameraLink = new CameraLink();
