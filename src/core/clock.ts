import type { SyncedTimestamp } from './types';

/** Relógio de alta resolução em ms (epoch), comparável entre abas do mesmo aparelho. */
export function localNowMs(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Relógio de um aparelho com deslocamento conhecido para o relógio do hub.
 * Na Fase 9 o deslocamento passa a vir da sincronização estilo NTP;
 * até lá (1 celular) ele é 0 e a incerteza também.
 */
export class DeviceClock {
  private offsetMs = 0;
  private uncertaintyMs = 0;

  constructor(private readonly now: () => number = localNowMs) {}

  setOffset(offsetMs: number, uncertaintyMs: number): void {
    if (!Number.isFinite(offsetMs) || !Number.isFinite(uncertaintyMs) || uncertaintyMs < 0) {
      throw new RangeError('Deslocamento/incerteza de relógio inválidos');
    }
    this.offsetMs = offsetMs;
    this.uncertaintyMs = uncertaintyMs;
  }

  getOffset(): { offsetMs: number; uncertaintyMs: number } {
    return { offsetMs: this.offsetMs, uncertaintyMs: this.uncertaintyMs };
  }

  /** Carimba um instante local (ou "agora") com o relógio do hub. */
  stamp(localMs: number = this.now()): SyncedTimestamp {
    return makeTimestamp(localMs, this.offsetMs, this.uncertaintyMs);
  }
}

export function makeTimestamp(localMs: number, offsetMs = 0, uncertaintyMs = 0): SyncedTimestamp {
  return { localMs, offsetMs, hubMs: localMs + offsetMs, uncertaintyMs };
}

/** Converte um instante do relógio do hub de volta para o relógio local de um aparelho. */
export function hubToLocal(hubMs: number, offsetMs: number): number {
  return hubMs - offsetMs;
}
