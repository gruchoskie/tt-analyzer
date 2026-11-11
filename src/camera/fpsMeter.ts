/**
 * Mede o fps real a partir dos instantes em que cada quadro chegou,
 * numa janela deslizante. Independe do valor que o navegador "promete"
 * em track.getSettings().frameRate.
 */
export class FpsMeter {
  private times: number[] = [];
  private counts: number[] = [];

  constructor(private readonly windowMs = 1000) {
    if (windowMs <= 0) throw new RangeError('Janela deve ser positiva');
  }

  /**
   * Registra a chegada de quadro(s) no instante t (ms, monotônico).
   * `count` > 1 quando o navegador informa que vários quadros da câmera
   * chegaram desde o último callback (ex.: tela mais lenta que a câmera).
   */
  push(t: number, count = 1): void {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && t < last) {
      // Relógio voltou (ex.: troca de fonte): recomeça a medição.
      this.reset();
    }
    this.times.push(t);
    this.counts.push(Math.max(1, Math.floor(count)));
    const cutoff = t - this.windowMs;
    let drop = 0;
    while (drop < this.times.length - 1 && this.times[drop] < cutoff) drop++;
    if (drop > 0) {
      this.times.splice(0, drop);
      this.counts.splice(0, drop);
    }
  }

  /** fps médio na janela; 0 se não houver dados suficientes. */
  fps(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = this.times[n - 1] - this.times[0];
    if (span <= 0) return 0;
    let frames = 0;
    for (let i = 1; i < n; i++) frames += this.counts[i];
    return (frames * 1000) / span;
  }

  /** Maior intervalo entre quadros consecutivos na janela (ms) — indica travadas. */
  maxGapMs(): number {
    let max = 0;
    for (let i = 1; i < this.times.length; i++) {
      max = Math.max(max, this.times[i] - this.times[i - 1]);
    }
    return max;
  }

  reset(): void {
    this.times = [];
    this.counts = [];
  }
}
