/** Conversões de unidade usadas pelas métricas. */

export const MS_PER_S = 1000;

export function mpsToKmh(mps: number): number {
  return mps * 3.6;
}

export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

export function metersToCm(m: number): number {
  return m * 100;
}

export function cmToMeters(cm: number): number {
  return cm / 100;
}

/** Velocidade média (m/s) entre dois pontos, dado o intervalo em ms. */
export function speedMps(distanceM: number, dtMs: number): number {
  if (dtMs <= 0) throw new RangeError('Intervalo de tempo deve ser positivo');
  return distanceM / (dtMs / MS_PER_S);
}

/** Período de um quadro (ms) para um fps. */
export function frameIntervalMs(fps: number): number {
  if (fps <= 0) throw new RangeError('fps deve ser positivo');
  return MS_PER_S / fps;
}

/** Formata uma duração em ms como m:ss (ou h:mm:ss). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Formata bytes em KB/MB/GB (base 1024), com vírgula decimal pt-BR. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(digits).replace('.', ',')} ${units[i]}`;
}
