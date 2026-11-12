import type { BounceEvent } from '../physics/bounce';
import { hitterSide } from '../physics/speedStats';
import type { Stroke } from '../pose/strokes';
import type { StoredRally } from '../storage/types';

/**
 * CSV no formato do Excel/Planilhas em português: separador ";", vírgula
 * decimal e BOM UTF-8 (acentos aparecem certos).
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell, decimals = 2): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : v.toFixed(decimals);
    return s.replace('.', ',');
  }
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return '﻿' + [header.map((h) => csvCell(h)).join(';'), ...rows.map((r) => r.map((c) => csvCell(c)).join(';'))].join('\r\n') + '\r\n';
}

const sec = (ms: number) => ms / 1000;

export function bouncesCsv(bounces: BounceEvent[]): string {
  return toCsv(
    ['tempo_s', 'lado_quique', 'quem_bateu', 'x_m', 'y_m', 'direcao', 'saque', 'audio', 'velocidade_kmh', 'margem_kmh', 'saida_kmh', 'metodo'],
    bounces.map((b) => [
      sec(b.t),
      b.side,
      hitterSide(b),
      b.table.x,
      b.table.y,
      b.shot.direction ?? '',
      b.shot.serve,
      b.audio,
      b.speed?.avgKmh,
      b.speed?.errKmh,
      b.speed?.startKmh,
      b.speed?.method ?? '',
    ]),
  );
}

export function ralliesCsv(rallies: StoredRally[], winners: ('perto' | 'longe' | null)[]): string {
  return toCsv(
    ['rally', 'inicio_s', 'fim_s', 'duracao_s', 'trocas', 'sacador', 'ponto_para', 'ponto_estimado_para', 'motivo', 'jogadas_por_min', 'vel_max_kmh'],
    rallies.map((r, i) => [r.index, sec(r.startT), sec(r.endT), sec(r.durationMs), r.shots, r.server ?? '', winners[i] ?? '', r.winner ?? '', r.reason, r.shotsPerMin, r.maxKmh]),
  );
}

export function strokesCsv(strokes: Stroke[]): string {
  return toCsv(
    ['tempo_s', 'jogador', 'golpe', 'confianca', 'pulso_kmh', 'braco_kmh', 'bola_kmh', 'margem_bola_kmh', 'indice_potencia', 'indice_so_pulso'],
    strokes.map((s) => [sec(s.t), s.side, s.type, s.confidence, s.wristMps * 3.6, s.armMps * 3.6, s.ballKmh, s.ballErrKmh, s.powerIndex, s.wristOnly]),
  );
}
