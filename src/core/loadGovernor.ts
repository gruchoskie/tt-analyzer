/**
 * Mede se a tela está travando (intervalo entre quadros desenhados) e sobe ou
 * desce um "nível de economia":
 *   0 = tudo ligado;
 *   1 = pose pausada;
 *   2 = + rastreio analisa 1 de cada 2 quadros;
 *   3 = + rastreio analisa 1 de cada 3 quadros.
 * Sobe logo que trava (1 janela ruim); desce devagar (várias janelas boas, e
 * cada vez mais devagar se voltar a travar), para não ficar oscilando.
 */
export interface GovernorOptions {
  windowMs: number;
  /** Intervalo entre quadros considerado travada (ms). */
  jankMs: number;
  /** Fração de intervalos travados que torna a janela ruim. */
  badFraction: number;
  /** Um único intervalo maior que isto já torna a janela ruim. */
  freezeMs: number;
  downAfter: number;
  maxLevel: number;
}

export const DEFAULT_GOVERNOR: GovernorOptions = { windowMs: 1000, jankMs: 40, badFraction: 0.15, freezeMs: 150, downAfter: 5, maxLevel: 3 };

export class LoadGovernor {
  level = 0;
  private readonly o: GovernorOptions;
  private last = NaN;
  private winStart = NaN;
  private n = 0;
  private janky = 0;
  private maxGap = 0;
  private good = 0;
  /** Quantas vezes já precisou subir: cada vez demora mais para voltar (não fica oscilando). */
  private raises = 0;

  constructor(o: Partial<GovernorOptions> = {}) {
    this.o = { ...DEFAULT_GOVERNOR, ...o };
  }

  /** Um quadro desenhado em `now` (ms). Devolve o novo nível quando muda. */
  frame(now: number): number | null {
    if (Number.isNaN(this.last)) {
      this.last = now;
      this.winStart = now;
      return null;
    }
    const gap = now - this.last;
    this.last = now;
    // aba em segundo plano / tela apagada: não conta
    if (gap > 2000) {
      this.winStart = now;
      this.n = this.janky = this.maxGap = 0;
      return null;
    }
    this.n++;
    if (gap > this.o.jankMs) this.janky++;
    this.maxGap = Math.max(this.maxGap, gap);
    if (now - this.winStart < this.o.windowMs) return null;
    const bad = this.maxGap > this.o.freezeMs || (this.n > 0 && this.janky / this.n > this.o.badFraction);
    this.winStart = now;
    this.n = this.janky = this.maxGap = 0;
    const before = this.level;
    if (bad) {
      this.good = 0;
      if (this.level < this.o.maxLevel) this.raises++;
      this.level = Math.min(this.o.maxLevel, this.level + 1);
    } else if (++this.good >= this.o.downAfter * 2 ** Math.min(4, Math.max(0, this.raises - 1)) && this.level > 0) {
      this.good = 0;
      this.level--;
    }
    return this.level !== before ? this.level : null;
  }

  reset(): void {
    this.level = 0;
    this.last = this.winStart = NaN;
    this.n = this.janky = this.maxGap = this.good = this.raises = 0;
  }
}
