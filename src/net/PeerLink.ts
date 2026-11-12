import { decodeSignal, encodeSignal } from './signalCode';
import type { LinkMsg } from './protocol';

/**
 * Conexão WebRTC (só canal de dados) entre dois celulares, pareada por
 * códigos trocados à mão ou por QR. Dois canais: 'ctl' (confiável: comandos,
 * calibração, vídeo) e 'det' (sem retransmissão: detecções, que perdem o
 * valor se chegarem tarde).
 */
export type LinkState = 'pareando' | 'conectando' | 'conectado' | 'caiu' | 'fechado';

const ICE: RTCConfiguration = {
  // Na mesma rede Wi-Fi bastam os candidatos locais; o STUN ajuda em redes diferentes.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function waitIce(pc: RTCPeerConnection, ms = 3500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', on);
      res();
    };
    const on = () => pc.iceGatheringState === 'complete' && done();
    pc.addEventListener('icegatheringstatechange', on);
    setTimeout(done, ms);
  });
}

export class PeerLink {
  state: LinkState = 'pareando';
  onMessage: (m: LinkMsg) => void = () => {};
  onBinary: (b: ArrayBuffer) => void = () => {};
  onState: (s: LinkState) => void = () => {};
  private ctl: RTCDataChannel | null = null;
  private det: RTCDataChannel | null = null;

  private constructor(readonly pc: RTCPeerConnection) {
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      // "conectado" só quando o canal de controle abriu (senão o hello se perde)
      if (s === 'connected') {
        if (this.open) this.set('conectado');
      } else if (s === 'connecting') this.set('conectando');
      else if (s === 'failed' || s === 'disconnected') this.set('caiu');
      else if (s === 'closed') this.set('fechado');
    });
    pc.addEventListener('datachannel', (e) => this.bind(e.channel));
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && typeof CompressionStream !== 'undefined';
  }

  /** Hub: cria a oferta. Depois chame acceptAnswer com o código da câmera. */
  static async offer(): Promise<{ link: PeerLink; code: string }> {
    const link = new PeerLink(new RTCPeerConnection(ICE));
    link.bind(link.pc.createDataChannel('ctl', { ordered: true }));
    link.bind(link.pc.createDataChannel('det', { ordered: false, maxRetransmits: 0 }));
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await waitIce(link.pc);
    return { link, code: await encodeSignal('oferta', link.pc.localDescription!.sdp) };
  }

  async acceptAnswer(code: string): Promise<void> {
    const { kind, sdp } = await decodeSignal(code);
    if (kind !== 'resposta') throw new Error('Esse é um código de oferta. Leia o código que aparece na câmera.');
    this.set('conectando');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** Câmera: responde à oferta do hub. Mostre o código devolvido para o hub ler. */
  static async answer(offerCode: string): Promise<{ link: PeerLink; code: string }> {
    const { kind, sdp } = await decodeSignal(offerCode);
    if (kind !== 'oferta') throw new Error('Esse é um código de resposta. Leia o código que aparece no hub.');
    const link = new PeerLink(new RTCPeerConnection(ICE));
    await link.pc.setRemoteDescription({ type: 'offer', sdp });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await waitIce(link.pc);
    link.set('conectando');
    return { link, code: await encodeSignal('resposta', link.pc.localDescription!.sdp) };
  }

  private set(s: LinkState) {
    if (this.state === s) return;
    this.state = s;
    this.onState(s);
  }

  private bind(ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'ctl') this.ctl = ch;
    else this.det = ch;
    ch.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m: LinkMsg;
        try {
          m = JSON.parse(e.data) as LinkMsg;
        } catch {
          return; // mensagem estranha: ignora
        }
        this.onMessage(m);
      } else this.onBinary(e.data as ArrayBuffer);
    };
    ch.onopen = () => {
      if (this.open) this.set('conectado');
    };
  }

  get open(): boolean {
    return this.ctl?.readyState === 'open';
  }

  send(m: LinkMsg): void {
    if (this.ctl?.readyState === 'open') this.ctl.send(JSON.stringify(m));
  }

  /** Detecções: pelo canal sem retransmissão (cai para o confiável se ele não abriu). */
  sendFast(m: LinkMsg): void {
    const ch = this.det?.readyState === 'open' ? this.det : this.ctl;
    if (ch?.readyState === 'open') ch.send(JSON.stringify(m));
  }

  /** Binário com controle de fila (para o vídeo não estourar a memória). */
  async sendBinary(b: ArrayBuffer): Promise<void> {
    const ch = this.ctl;
    if (!ch || ch.readyState !== 'open') throw new Error('Conexão fechada');
    if (ch.bufferedAmount > 4 * 1024 * 1024) {
      ch.bufferedAmountLowThreshold = 1024 * 1024;
      await new Promise<void>((res) => ch.addEventListener('bufferedamountlow', () => res(), { once: true }));
    }
    ch.send(b);
  }

  /** RTT medido pelo próprio WebRTC (ms), se disponível. */
  async rttMs(): Promise<number | null> {
    try {
      const stats = await this.pc.getStats();
      let rtt: number | null = null;
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
      });
      return rtt;
    } catch {
      return null;
    }
  }

  close(): void {
    try {
      this.send({ k: 'bye' });
    } catch {
      /* ignora */
    }
    this.pc.close();
    this.set('fechado');
  }
}
