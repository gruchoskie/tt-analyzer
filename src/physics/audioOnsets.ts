/**
 * Detecção de "tocs" no áudio: o quique da bola na mesa (e a raquetada) é um
 * transiente curto e agudo. Passos:
 *   1. passa-alta de 2ª ordem (~1,5 kHz) tira voz, passos e ruído grave;
 *   2. energia em blocos curtos (~2,7 ms) em escala log (dB);
 *   3. toque = subida rápida (em ~10 ms) acima do nível de fundo (mediana
 *      dos últimos ~400 ms) por uma margem (padrão 14 dB), com período
 *      refratário. Sons que crescem devagar (voz, música) não contam.
 *
 * O instante é o do bloco de maior energia logo após a subida (o pico do toque).
 * Funciona em fluxo (OnsetDetector.push) ou de uma vez (detectOnsets).
 */

export interface OnsetOptions {
  /** Corte do passa-alta (Hz). */
  highpassHz: number;
  /** Tamanho do bloco de energia (amostras). */
  blockSize: number;
  /** Quanto acima do fundo (dB) para contar como toque. */
  thresholdDb: number;
  /** Janela do nível de fundo (ms). */
  backgroundMs: number;
  /** Intervalo mínimo entre toques (ms). */
  refractoryMs: number;
  /** Nível mínimo absoluto (dBFS) para não disparar no silêncio. */
  minLevelDb: number;
}

export const DEFAULT_ONSET_OPTIONS: OnsetOptions = {
  highpassHz: 1500,
  blockSize: 128,
  thresholdDb: 14,
  backgroundMs: 400,
  refractoryMs: 60,
  minLevelDb: -60,
};

export interface Onset {
  /** Instante (ms) no relógio de quem chamou. */
  t: number;
  /** Quanto o toque ficou acima do fundo (dB). */
  strengthDb: number;
}

export class OnsetDetector {
  private readonly opts: OnsetOptions;
  private readonly alpha: number;
  private prevIn = 0;
  private prevOut = 0;
  private prevOut2 = 0;
  /** Níveis (dB) dos últimos blocos, para exigir subida rápida. */
  private readonly recent: number[] = [];
  private acc = 0;
  private accN = 0;
  private blockStartSample = 0;
  private samplesSeen = 0;
  private readonly history: number[] = [];
  private readonly historyLen: number;
  private readonly recentLen: number;
  private lastOnsetMs = -Infinity;
  /** Toque em andamento: procura o pico nos próximos blocos. */
  private pending: { t: number; db: number; bg: number; left: number } | null = null;

  /**
   * @param sampleRate taxa do áudio
   * @param startMs instante (ms) da primeira amostra
   */
  constructor(
    readonly sampleRate: number,
    private startMs = 0,
    opts: Partial<OnsetOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ONSET_OPTIONS, ...opts };
    const rc = 1 / (2 * Math.PI * this.opts.highpassHz);
    const dt = 1 / sampleRate;
    this.alpha = rc / (rc + dt);
    this.historyLen = Math.max(8, Math.round((this.opts.backgroundMs / 1000) * (sampleRate / this.opts.blockSize)));
    this.recentLen = Math.max(2, Math.round((0.01 * sampleRate) / this.opts.blockSize));
  }

  /** Reposiciona o relógio: a próxima amostra empurrada acontece em `ms`. */
  resync(ms: number): void {
    this.startMs = ms - (this.samplesSeen / this.sampleRate) * 1000;
  }

  push(samples: Float32Array): Onset[] {
    const out: Onset[] = [];
    const { blockSize } = this.opts;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      // duas passa-altas de 1ª ordem em cascata
      const y1 = this.alpha * (this.prevOut + x - this.prevIn);
      const y = this.alpha * (this.prevOut2 + y1 - this.prevOut);
      this.prevIn = x;
      this.prevOut = y1;
      this.prevOut2 = y;
      this.acc += y * y;
      this.accN++;
      this.samplesSeen++;
      if (this.accN === blockSize) {
        const o = this.block(this.acc / blockSize);
        if (o) out.push(o);
        this.acc = 0;
        this.accN = 0;
        this.blockStartSample = this.samplesSeen;
      }
    }
    return out;
  }

  private block(meanSq: number): Onset | null {
    const db = 10 * Math.log10(meanSq + 1e-12);
    const t = this.startMs + ((this.blockStartSample + this.opts.blockSize / 2) / this.sampleRate) * 1000;
    let result: Onset | null = null;

    if (this.pending) {
      // acompanha a subida até o pico
      if (db >= this.pending.db) {
        this.pending.db = db;
        this.pending.t = t;
      }
      if (--this.pending.left <= 0 || db < this.pending.db - 3) {
        result = { t: this.pending.t, strengthDb: this.pending.db - this.pending.bg };
        this.lastOnsetMs = this.pending.t;
        this.pending = null;
      }
    } else if (this.history.length >= Math.min(this.historyLen, 16)) {
      const bg = median(this.history);
      const before = this.recent.length >= this.recentLen ? this.recent[0] : bg;
      const fast = db - before >= this.opts.thresholdDb * 0.7;
      if (fast && db - bg >= this.opts.thresholdDb && db >= this.opts.minLevelDb && t - this.lastOnsetMs >= this.opts.refractoryMs) {
        this.pending = { t, db, bg, left: 4 };
      }
    }
    this.recent.push(db);
    if (this.recent.length > this.recentLen) this.recent.shift();
    // o fundo não aprende com o próprio toque
    if (!this.pending) {
      this.history.push(db);
      if (this.history.length > this.historyLen) this.history.shift();
    }
    return result;
  }
}

function median(a: number[]): number {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
}

/** Detecta os toques de um áudio inteiro (ex.: trilha de uma gravação). */
export function detectOnsets(samples: Float32Array, sampleRate: number, startMs = 0, opts: Partial<OnsetOptions> = {}): Onset[] {
  const d = new OnsetDetector(sampleRate, startMs, opts);
  const out = d.push(samples);
  // fecha um toque em andamento no fim
  out.push(...d.push(new Float32Array((opts.blockSize ?? DEFAULT_ONSET_OPTIONS.blockSize) * 5)));
  return out;
}
