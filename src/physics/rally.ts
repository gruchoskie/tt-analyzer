import type { BounceEvent, ShotDirection, TableSide } from './bounce';
import { hitterSide } from './speedStats';

/**
 * Pontos (rallies) e placar estimado.
 *
 * - Um rally começa no primeiro quique depois de uma pausa e termina quando a
 *   bola some (sem rastro) por `endGapMs`, ou quando passa `endGapMs` sem quique.
 * - Trocas = jogadas que chegaram à mesa (o saque conta 1, mesmo com 2 quiques).
 * - Quem ganhou: quem deixou a bola quicar no próprio lado por último perdeu o
 *   ponto (não devolveu, ou devolveu na rede/fora). É uma ESTIMATIVA: a câmera
 *   não vê a bola fora da mesa nem a rede com certeza, e o placar pode ser
 *   corrigido à mão.
 */

export interface Rally {
  index: number;
  startT: number;
  endT: number;
  durationMs: number;
  bounces: BounceEvent[];
  /** Jogadas que chegaram à mesa. */
  shots: number;
  /** Lado de quem sacou (se o saque foi visto). */
  server: TableSide | null;
  /** Ganhador estimado e por quê. */
  winner: TableSide | null;
  reason: string;
  /** Jogadas por minuto dentro do rally. */
  shotsPerMin: number | null;
  /** Intervalo médio entre jogadas (ms). */
  avgShotIntervalMs: number | null;
  maxKmh: number | null;
}

export interface RallyOptions {
  /** Pausa (sem bola ou sem quique) que encerra o rally (ms). */
  endGapMs: number;
  /** Mínimo de quiques para valer como rally. */
  minBounces: number;
}

export const DEFAULT_RALLY_OPTIONS: RallyOptions = { endGapMs: 2500, minBounces: 1 };

const other = (s: TableSide): TableSide => (s === 'perto' ? 'longe' : 'perto');

/** Fecha um rally a partir dos quiques dele. */
export function describeRally(index: number, bounces: BounceEvent[], startT: number, endT: number): Rally {
  // o 2º quique do saque não é uma jogada nova
  const shots = bounces.filter((b) => b.speed?.kind !== 'quique' && !isSecondServeBounce(bounces, b)).length;
  const first = bounces[0];
  const server = first ? (first.shot.serve ? first.side : null) : null;
  const last = bounces[bounces.length - 1];
  let winner: TableSide | null = null;
  let reason = 'sem quiques';
  if (last) {
    winner = other(last.side);
    reason = bounces.length === 1 && server ? `saque de ${last.side} não passou` : `${last.side} não devolveu (ou devolveu fora/na rede)`;
  }
  const times = bounces.filter((b) => !isSecondServeBounce(bounces, b)).map((b) => b.t);
  const intervals = times.slice(1).map((t, i) => t - times[i]);
  const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  const speeds = bounces.map((b) => b.speed?.avgKmh).filter((v): v is number => v !== undefined);
  return {
    index,
    startT,
    endT,
    durationMs: endT - startT,
    bounces,
    shots,
    server,
    winner,
    reason,
    shotsPerMin: avg ? 60000 / avg : null,
    avgShotIntervalMs: avg,
    maxKmh: speeds.length ? Math.max(...speeds) : null,
  };
}

function isSecondServeBounce(list: BounceEvent[], b: BounceEvent): boolean {
  const i = list.indexOf(b);
  return i === 1 && list[0].shot.serve && list[0].side !== b.side;
}

/** Acompanha a atividade da bola e os quiques e fecha os rallies. */
export class RallyTracker {
  private readonly opts: RallyOptions;
  private current: BounceEvent[] = [];
  private startT = NaN;
  private lastActiveT = -Infinity;
  private lastBounceT = -Infinity;
  readonly rallies: Rally[] = [];

  constructor(opts: Partial<RallyOptions> = {}) {
    this.opts = { ...DEFAULT_RALLY_OPTIONS, ...opts };
  }

  /** Rally em andamento (quiques até agora). */
  get live(): { bounces: BounceEvent[]; startT: number } | null {
    return this.current.length ? { bounces: this.current, startT: this.startT } : null;
  }

  /** Um quadro analisado: `ballSeen` = bola sendo rastreada. Devolve o rally que acabou de fechar. */
  tick(t: number, ballSeen: boolean): Rally | null {
    if (ballSeen) this.lastActiveT = t;
    if (!this.current.length) return null;
    const quiet = t - Math.max(this.lastActiveT, this.lastBounceT);
    const noBounce = t - this.lastBounceT;
    if (quiet >= this.opts.endGapMs || noBounce >= this.opts.endGapMs * 1.6) return this.close();
    return null;
  }

  bounce(b: BounceEvent): Rally | null {
    let closed: Rally | null = null;
    // um quique muito depois do último abre outro rally
    if (this.current.length && b.t - this.lastBounceT >= this.opts.endGapMs * 1.6) closed = this.close();
    if (!this.current.length) this.startT = b.shot.serve ? Math.min(b.t, b.speed?.fromT ?? b.t) : (b.speed?.fromT ?? b.t);
    this.current.push(b);
    this.lastBounceT = b.t;
    this.lastActiveT = Math.max(this.lastActiveT, b.t);
    return closed;
  }

  /** O rally em andamento como se fechasse agora (sem fechar). */
  peek(): Rally | null {
    const list = this.current;
    if (list.length < this.opts.minBounces) return null;
    return describeRally(this.rallies.length + 1, list, this.startT, list[list.length - 1].t);
  }

  /** Fim do vídeo / parar. */
  flush(): Rally | null {
    return this.current.length ? this.close() : null;
  }

  private close(): Rally | null {
    const list = this.current;
    this.current = [];
    if (list.length < this.opts.minBounces) return null;
    const endT = Math.max(list[list.length - 1].t, Math.min(this.lastActiveT, list[list.length - 1].t + this.opts.endGapMs));
    const r = describeRally(this.rallies.length + 1, list, this.startT, endT);
    this.rallies.push(r);
    return r;
  }
}

/* ---------- placar (regras de 11 pontos) ---------- */

export interface Score {
  points: Record<TableSide, number>;
  games: Record<TableSide, number>;
  /** Games já fechados (placar de cada um). */
  history: Record<TableSide, number>[];
  /** Quem saca agora (se o 1º sacador é conhecido). */
  server: TableSide | null;
}

export function gameOver(p: Record<TableSide, number>): TableSide | null {
  for (const s of ['perto', 'longe'] as const) if (p[s] >= 11 && p[s] - p[other(s)] >= 2) return s;
  return null;
}

/** Saque troca a cada 2 pontos; a partir de 10–10, a cada ponto. */
export function serverFor(p: Record<TableSide, number>, firstServer: TableSide): TableSide {
  const total = p.perto + p.longe;
  const turns = p.perto >= 10 && p.longe >= 10 ? 10 + (total - 20) : Math.floor(total / 2);
  return turns % 2 === 0 ? firstServer : other(firstServer);
}

/**
 * Placar a partir dos ganhadores (estimados ou corrigidos) na ordem.
 * `firstServer` = quem sacou no 1º ponto do game (se conhecido).
 */
export function computeScore(winners: (TableSide | null)[], firstServer: TableSide | null): Score {
  const s: Score = { points: { perto: 0, longe: 0 }, games: { perto: 0, longe: 0 }, history: [], server: firstServer };
  let gameServer = firstServer;
  for (const w of winners) {
    if (!w) continue;
    s.points[w]++;
    const g = gameOver(s.points);
    if (g) {
      s.games[g]++;
      s.history.push({ ...s.points });
      s.points = { perto: 0, longe: 0 };
      // no game seguinte saca quem recebeu primeiro no anterior
      if (gameServer) gameServer = other(gameServer);
    }
  }
  s.server = gameServer ? serverFor(s.points, gameServer) : null;
  return s;
}

/* ---------- estatísticas por lado ---------- */

export interface SideStats {
  pointsWon: number;
  /** Jogadas feitas por este lado (que chegaram à mesa do outro). */
  shots: number;
  serves: number;
  directions: Record<ShotDirection, number>;
  avgKmh: number | null;
  maxKmh: number | null;
  /** Quiques recebidos (na metade deste lado). */
  received: number;
}

export function sideStats(rallies: Rally[], winners: (TableSide | null)[]): Record<TableSide, SideStats> {
  const mk = (): SideStats => ({ pointsWon: 0, shots: 0, serves: 0, directions: { cruzada: 0, paralela: 0, meio: 0 }, avgKmh: null, maxKmh: null, received: 0 });
  const out = { perto: mk(), longe: mk() };
  const speeds: Record<TableSide, number[]> = { perto: [], longe: [] };
  rallies.forEach((r, i) => {
    const w = winners[i];
    if (w) out[w].pointsWon++;
    for (const b of r.bounces) {
      out[b.side].received++;
      if (isSecondServeBounce(r.bounces, b)) continue;
      const h = hitterSide(b);
      out[h].shots++;
      if (b.shot.serve) out[h].serves++;
      if (b.shot.direction) out[h].directions[b.shot.direction]++;
      if (b.speed && b.speed.kind === 'golpe') speeds[h].push(b.speed.avgKmh);
    }
  });
  for (const s of ['perto', 'longe'] as const) {
    const v = speeds[s];
    if (v.length) {
      out[s].avgKmh = v.reduce((a, b) => a + b, 0) / v.length;
      out[s].maxKmh = Math.max(...v);
    }
  }
  return out;
}

export interface RallySummary {
  count: number;
  avgShots: number;
  maxShots: number;
  avgDurationMs: number;
  maxDurationMs: number;
  /** Jogadas por minuto (média dos rallies com 2+ jogadas). */
  shotsPerMin: number | null;
}

export function summarizeRallies(rallies: Rally[]): RallySummary {
  const n = rallies.length;
  const paced = rallies.filter((r) => r.shotsPerMin !== null);
  return {
    count: n,
    avgShots: n ? rallies.reduce((a, r) => a + r.shots, 0) / n : 0,
    maxShots: n ? Math.max(...rallies.map((r) => r.shots)) : 0,
    avgDurationMs: n ? rallies.reduce((a, r) => a + r.durationMs, 0) / n : 0,
    maxDurationMs: n ? Math.max(...rallies.map((r) => r.durationMs)) : 0,
    shotsPerMin: paced.length ? paced.reduce((a, r) => a + r.shotsPerMin!, 0) / paced.length : null,
  };
}
