import { OnsetDetector } from '../physics/audioOnsets';

/**
 * "Tocs" do microfone ao vivo. Um AudioWorklet mínimo (criado a partir de uma
 * string, sem arquivo separado) copia o áudio em lotes para a thread principal,
 * onde o OnsetDetector roda. Os instantes saem no relógio local em ms (epoch),
 * o mesmo dos quadros de vídeo: tempo do AudioContext → performance.now pelo
 * par de getOutputTimestamp(). A latência de entrada do microfone não é
 * conhecida com precisão (tipicamente 10-40 ms); a janela de casamento com o
 * vídeo (±60 ms) absorve isso.
 */

const WORKLET = `
class TtTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; this.start = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n === 0) this.start = currentFrame;
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n >= this.buf.length) {
        this.port.postMessage({ start: this.start, data: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('tt-tap', TtTap);
`;

export type OnsetsListener = (timesMs: number[], analyzedUntilMs: number) => void;

export class LiveAudioOnsets {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private detector: OnsetDetector | null = null;
  private expectedFrame = -1;
  private unlock: (() => void) | null = null;

  constructor(private readonly listener: OnsetsListener) {}

  static supported(): boolean {
    return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
  }

  async start(stream: MediaStream): Promise<boolean> {
    if (!LiveAudioOnsets.supported() || !stream.getAudioTracks().length) return false;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.ctx !== ctx) return false; // parado enquanto carregava
    this.src = ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(ctx, 'tt-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.src.connect(this.node);
    this.detector = new OnsetDetector(ctx.sampleRate);
    this.node.port.onmessage = (e: MessageEvent<{ start: number; data: Float32Array }>) => this.onBlock(e.data.start, e.data.data);
    if (ctx.state !== 'running') {
      // navegadores exigem um toque para liberar o áudio
      const resume = () => void ctx.resume();
      window.addEventListener('pointerdown', resume, { once: true });
      this.unlock = () => window.removeEventListener('pointerdown', resume);
      void ctx.resume().catch(() => undefined);
    }
    return true;
  }

  /** Converte tempo do AudioContext (s) em ms do relógio local (epoch). */
  private ctxToLocalMs(ctxSeconds: number): number {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return performance.timeOrigin + ts.performanceTime + (ctxSeconds - ts.contextTime) * 1000;
    }
    return performance.timeOrigin + performance.now() - (ctx.currentTime - ctxSeconds) * 1000 - (ctx.baseLatency ?? 0) * 1000;
  }

  private onBlock(startFrame: number, data: Float32Array): void {
    const ctx = this.ctx;
    const det = this.detector;
    if (!ctx || !det) return;
    // reancora o relógio quando há salto (ex.: contexto suspenso e retomado)
    if (startFrame !== this.expectedFrame) det.resync(this.ctxToLocalMs(startFrame / ctx.sampleRate));
    this.expectedFrame = startFrame + data.length;
    const on = det.push(data);
    this.listener(
      on.map((o) => o.t),
      this.ctxToLocalMs(this.expectedFrame / ctx.sampleRate),
    );
  }

  stop(): void {
    this.unlock?.();
    this.unlock = null;
    try {
      this.src?.disconnect();
      this.node?.disconnect();
    } catch {
      /* já desconectado */
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.node = null;
    this.src = null;
    this.detector = null;
    this.expectedFrame = -1;
  }
}
