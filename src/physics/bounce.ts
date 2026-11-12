import type { Point2 } from '../core/types';
import { applyHomography, invertHomography } from '../calibration/homography';
import { estimateCamera, type Quad } from '../calibration/calibrate';
import { NET_Y_M, TABLE_CORNERS_M } from '../calibration/table';
import { BALL_RADIUS_M, TABLE_LENGTH_M, TABLE_WIDTH_M } from './constants';

/**
 * Quiques da bola a partir do rastro 2D de 1 câmera.
 *
 * Na imagem, o quique é uma "quebra" brusca na velocidade vertical: a bola
 * vinha descendo (ou subindo menos) e passa a subir. A gravidade sozinha só
 * curva a trajetória para baixo, então uma quebra para cima de alguns m/s só
 * acontece em quique ou raquetada. Para separar os dois:
 *   - o quique acontece sobre o tampo (o ponto da quebra, levado à mesa pela
 *     homografia, cai dentro dela);
 *   - dois quiques seguidos não acontecem no mesmo lado: se a quebra cai no
 *     mesmo lado do último quique (sem raquetada entre eles), é a raquetada
 *     do jogador daquele lado (de trás, a bola no ar se projeta sobre a
 *     cabeceira dele).
 * Se houver áudio, um "toc" a até ±60 ms confirma o quique e afina o instante.
 *
 * A posição do quique é a parte mais confiável da análise com 1 câmera: no
 * quique a bola está no plano da mesa, onde a homografia é exata.
 */

export interface BallObservation {
  /** Instante (ms) no relógio do hub. */
  t: number;
  frameIndex: number;
  /** Centro da bola em px do vídeo. */
  x: number;
  y: number;
}

export type TableSide = 'perto' | 'longe';
export type ShotDirection = 'cruzada' | 'paralela' | 'meio';
export type AudioCheck = 'confirmado' | 'sem-som' | 'sem-audio';

export interface BounceEvent {
  t: number;
  frameIndex: number;
  /** Ponto do quique na imagem (px). */
  image: Point2;
  /** Ponto do quique na mesa (m): x = largura, y = comprimento a partir da cabeceira "perto". */
  table: Point2;
  side: TableSide;
  audio: AudioCheck;
  /** Tamanho da quebra vertical (m/s, aproximado). */
  kickMps: number;
  /** De onde veio a bola (mesa, m) e a direção da jogada. */
  shot: { from: Point2 | null; direction: ShotDirection | null; serve: boolean };
}

export interface HitEvent {
  t: number;
  image: Point2;
  /** Projeção no plano da mesa (aproximada: a bola está no ar). */
  table: Point2;
}

export interface BounceDetectorOptions {
  /** Meia-janela para medir a velocidade antes/depois (ms); cresce em fps baixo. */
  windowMs: number;
  /** Quebra vertical mínima (m/s). */
  minKickMps: number;
  /** Folga ao redor do tampo (m). */
  tableMarginM: number;
  /** Intervalo mínimo entre quiques (ms). */
  minGapMs: number;
  /** Buraco no rastro que encerra o trecho (ms). */
  maxGapMs: number;
  /** Janela para casar o quique com um "toc" do áudio (ms). */
  audioWindowMs: number;
  /** Atraso do áudio em relação ao vídeo (ms), somado aos tocs. */
  audioOffsetMs: number;
  /** Quanto esperar o áudio antes de decidir "sem som" (ms). */
  audioWaitMs: number;
  /** Pausa a partir da qual começa outro ponto (ms). */
  rallyGapMs: number;
}

export const DEFAULT_BOUNCE_OPTIONS: BounceDetectorOptions = {
  windowMs: 60,
  minKickMps: 2,
  tableMarginM: 0.05,
  minGapMs: 90,
  maxGapMs: 150,
  audioWindowMs: 60,
  audioOffsetMs: 0,
  audioWaitMs: 400,
  rallyGapMs: 1500,
};

type Fit = { x: number; y: number; vx: number; vy: number };

interface Kink {
  i: number;
  /** Instante da observação central e meia-janela usada. */
  tc: number;
  W: number;
  fb: Fit;
  fa: Fit;
  kick: number;
  tStar: number;
  pt: Point2;
}

/** Zonas laterais da mesa (terços da largura). */
export function lateralZone(x: number): 'esquerda' | 'meio' | 'direita' {
  if (x < TABLE_WIDTH_M / 3) return 'esquerda';
  if (x > (2 * TABLE_WIDTH_M) / 3) return 'direita';
  return 'meio';
}

/**
 * Direção da jogada pela posição lateral de onde a bola veio e de onde quicou:
 * mesmo lado = paralela, lados opostos = cruzada, quique no terço central = meio.
 */
export function classifyDirection(from: Point2, to: Point2): ShotDirection {
  const zt = lateralZone(to.x);
  if (zt === 'meio') return 'meio';
  const fx = Math.min(Math.max(from.x, 0), TABLE_WIDTH_M);
  const zf = lateralZone(fx);
  if (zf === zt) return 'paralela';
  if (zf === 'meio') return Math.abs(to.x - fx) >= 0.4 ? 'cruzada' : 'paralela';
  return 'cruzada';
}

export class BounceDetector {
  private readonly opts: BounceDetectorOptions;
  private readonly toImage: number[];
  private obs: BallObservation[] = [];
  /** Próximo índice de `obs` ainda não avaliado. */
  private next = 0;
  private kinks: (Kink | null)[] = [];
  private pending: { k: Kink; t: number }[] = [];
  private onsets: number[] = [];
  private audioUntil = -Infinity;
  private audioActive = false;
  private lastBounceT = -Infinity;
  private lastEventT = -Infinity;
  private origin: Point2 | null = null;
  private originIsHit = false;
  private segmentStart = true;
  readonly bounces: BounceEvent[] = [];
  readonly hits: HitEvent[] = [];

  /** Câmera estimada (para corrigir o raio da bola), quando o tamanho da imagem é conhecido. */
  private readonly cam: { x: number; y: number; z: number } | null;

  constructor(
    private readonly homography: number[],
    opts: Partial<BounceDetectorOptions> = {},
    image?: { width: number; height: number },
  ) {
    this.opts = { ...DEFAULT_BOUNCE_OPTIONS, ...opts };
    this.toImage = invertHomography(homography);
    const corners = TABLE_CORNERS_M.map((p) => applyHomography(this.toImage, p)) as Quad;
    const est = image ? estimateCamera(corners, image.width, image.height) : null;
    this.cam = est && est.position.z > 0.2 ? est.position : null;
  }

  /**
   * O centro da bola fica 2 cm acima do ponto de contato; a homografia leva
   * o centro para um ponto um pouco além (na direção oposta à câmera).
   * Corrige puxando para o pé da câmera na proporção raio/altura.
   */
  private contactPoint(centerOnPlane: Point2): Point2 {
    if (!this.cam) return centerOnPlane;
    const k = 1 - BALL_RADIUS_M / this.cam.z;
    return { x: this.cam.x + (centerOnPlane.x - this.cam.x) * k, y: this.cam.y + (centerOnPlane.y - this.cam.y) * k };
  }

  /** Liga a confirmação por áudio (os tocs chegam por addOnsets). */
  setAudioActive(active: boolean): void {
    this.audioActive = active;
  }

  /** Tocs detectados no áudio (ms, relógio do hub) e até onde o áudio já foi analisado. */
  addOnsets(times: number[], audioUntil: number): void {
    for (const t of times) this.onsets.push(t + this.opts.audioOffsetMs);
    this.onsets.sort((a, b) => a - b);
    this.audioUntil = Math.max(this.audioUntil, audioUntil + this.opts.audioOffsetMs);
    // descarta tocs velhos
    const cut = this.lastEventT - 5000;
    while (this.onsets.length && this.onsets[0] < cut) this.onsets.shift();
  }

  /** Rastro perdido: fecha o trecho atual. */
  breakTrack(): BounceEvent[] {
    this.evaluate(true);
    this.obs = [];
    this.kinks = [];
    this.next = 0;
    this.segmentStart = true;
    return this.release(Infinity);
  }

  /** Nova posição da bola. Devolve os quiques que ficaram prontos. */
  push(o: BallObservation): BounceEvent[] {
    const last = this.obs[this.obs.length - 1];
    let out: BounceEvent[] = [];
    if (last && (o.t - last.t > this.opts.maxGapMs || o.t <= last.t)) out = this.breakTrack();
    if (this.segmentStart) {
      // começo de um trecho: origem provável da próxima jogada
      if (!this.originIsHit || !this.origin) this.origin = this.toTable(o);
      this.segmentStart = false;
    }
    this.obs.push(o);
    this.kinks.push(undefined as unknown as Kink | null);
    this.evaluate(false);
    this.lastEventT = o.t;
    return out.concat(this.release(o.t));
  }

  /** Fim da análise: libera tudo o que estiver pendente. */
  flush(): BounceEvent[] {
    const out = this.breakTrack();
    return out.concat(this.release(Infinity, true));
  }

  private toTable(p: Point2): Point2 {
    return applyHomography(this.homography, p);
  }

  /** px por metro perto de um ponto da imagem (o eixo da mesa menos encurtado). */
  private scaleAt(p: Point2): number {
    const t = this.toTable(p);
    const a = applyHomography(this.toImage, t);
    const bx = applyHomography(this.toImage, { x: t.x + 0.05, y: t.y });
    const by = applyHomography(this.toImage, { x: t.x, y: t.y + 0.05 });
    const s = Math.max(Math.hypot(bx.x - a.x, bx.y - a.y), Math.hypot(by.x - a.x, by.y - a.y)) / 0.05;
    return Number.isFinite(s) && s > 0 ? s : NaN;
  }

  private window(): number {
    // em fps baixo, a janela precisa de pelo menos ~3 quadros de cada lado
    const n = this.obs.length;
    if (n < 4) return this.opts.windowMs;
    const dts: number[] = [];
    for (let i = Math.max(1, n - 12); i < n; i++) dts.push(this.obs[i].t - this.obs[i - 1].t);
    dts.sort((a, b) => a - b);
    return Math.max(this.opts.windowMs, 2.6 * dts[dts.length >> 1]);
  }

  /**
   * Quebra na observação i: compara a reta de antes com a de depois. Testa o
   * quique exatamente em i (i nas duas retas) e entre i e i+1 (em fps baixo o
   * quique costuma cair entre dois quadros); fica com a maior quebra.
   */
  private kinkAt(i: number, W: number): Kink | null {
    const c = this.obs[i];
    const scale = this.scaleAt(c);
    if (!Number.isFinite(scale)) return null;
    let best: Kink | null = null;
    for (const split of [0, 1]) {
      const a0 = this.obs[i + split];
      if (!a0) continue;
      // janela de W; se faltar quadro (bola não detectada), alarga um pouco
      let before: BallObservation[] = [], after: BallObservation[] = [];
      for (const span of [W, 1.6 * W]) {
        before = [];
        after = [];
        for (let k = i; k >= 0 && c.t - this.obs[k].t <= span + 1e-6; k--) before.unshift(this.obs[k]);
        for (let k = i + split; k < this.obs.length && this.obs[k].t - a0.t <= span + 1e-6; k++) after.push(this.obs[k]);
        if (before.length >= 3 && after.length >= 3) break;
      }
      if (before.length < 3 || after.length < 3) continue;
      const fb = fit(before, c.t), fa = fit(after, c.t);
      const kick = ((fb.vy - fa.vy) * 1000) / scale; // px/ms → px/s → m/s
      // instante do quique: cruzamento das duas retas y(t)
      let dt = split ? (a0.t - c.t) / 2 : 0;
      if (Math.abs(fb.vy - fa.vy) > 1e-9) dt = (fa.y - fb.y) / (fb.vy - fa.vy);
      const lo = split ? 0 : -W / 2, hi = split ? a0.t - c.t : W / 2;
      dt = Math.max(lo, Math.min(hi, dt));
      const pt = { x: (fb.x + fb.vx * dt + fa.x + fa.vx * dt) / 2, y: (fb.y + fb.vy * dt + fa.y + fa.vy * dt) / 2 };
      if (!best || kick > best.kick) best = { i, tc: c.t, W, fb, fa, kick, tStar: c.t + dt, pt };
    }
    return best;
  }

  private evaluate(final: boolean): void {
    const W = this.window();
    const lastT = this.obs.length ? this.obs[this.obs.length - 1].t : -Infinity;
    // calcula a quebra onde já há janela completa depois
    for (let i = 0; i < this.obs.length; i++) {
      if (this.kinks[i] !== undefined) continue;
      if (!final && lastT - this.obs[i].t < W) break;
      this.kinks[i] = this.kinkAt(i, W);
    }
    // decide os máximos locais de quebra (com vizinhos já calculados)
    while (this.next < this.obs.length) {
      const i = this.next;
      if (this.kinks[i] === undefined) break;
      if (!final && lastT - this.obs[i].t < 2 * W) break;
      this.next++;
      const k = this.kinks[i];
      if (!k || k.kick < this.opts.minKickMps) continue;
      let isMax = true;
      for (let j = i - 1; j >= 0 && this.obs[i].t - this.obs[j].t <= W; j--) if ((this.kinks[j]?.kick ?? -Infinity) > k.kick) isMax = false;
      for (let j = i + 1; j < this.obs.length && this.obs[j].t - this.obs[i].t <= W; j++)
        if ((this.kinks[j]?.kick ?? -Infinity) >= k.kick) isMax = false;
      if (!isMax) continue;
      this.pending.push({ k, t: k.tStar });
    }
  }

  private onTable(p: Point2): boolean {
    const m = this.opts.tableMarginM;
    return p.x >= -m && p.x <= TABLE_WIDTH_M + m && p.y >= -m && p.y <= TABLE_LENGTH_M + m;
  }

  private release(now: number, force = false): BounceEvent[] {
    const out: BounceEvent[] = [];
    this.pending.sort((a, b) => a.t - b.t);
    while (this.pending.length) {
      const { k } = this.pending[0];
      const waitAudio = this.audioActive && this.audioUntil < k.tStar + this.opts.audioWindowMs;
      if (!force && waitAudio && now < k.tStar + this.opts.audioWaitMs) break;
      this.pending.shift();
      const ev = this.decide(k);
      if (ev) out.push(ev);
    }
    return out;
  }

  private decide(k: Kink): BounceEvent | null {
    const table = this.toTable(k.pt);
    // Duas quebras seguidas no mesmo lado, sem raquetada entre elas, não são
    // dois quiques: a segunda é a raquetada do jogador daquele lado (vista de
    // trás, a bola no ar se projeta sobre a própria cabeceira dele).
    const lb = this.bounces[this.bounces.length - 1];
    const lh = this.hits[this.hits.length - 1];
    const side0: TableSide = table.y < NET_Y_M ? 'perto' : 'longe';
    const repeat = !!lb && lb.side === side0 && k.tStar - lb.t < this.opts.rallyGapMs && !(lh && lh.t > lb.t);
    if (repeat || !this.onTable(table)) {
      // raquetada (ou quebra fora da mesa): vira a origem da próxima jogada
      this.hits.push({ t: k.tStar, image: k.pt, table });
      this.origin = table;
      this.originIsHit = true;
      return null;
    }
    if (k.tStar - this.lastBounceT < this.opts.minGapMs) return null;

    let audio: AudioCheck = this.audioActive ? 'sem-som' : 'sem-audio';
    let t = k.tStar;
    let pt = k.pt;
    if (this.audioActive) {
      let best = Infinity, bestT = NaN;
      for (const o of this.onsets) {
        const d = Math.abs(o - k.tStar);
        if (d < best) {
          best = d;
          bestT = o;
        }
      }
      if (best <= this.opts.audioWindowMs) {
        audio = 'confirmado';
        // o toc marca o instante; a posição vem da reta da trajetória nesse instante
        const dt = Math.max(-k.W / 2, Math.min(k.W / 2, bestT - k.tc));
        const f = dt < k.tStar - k.tc ? k.fb : k.fa;
        pt = { x: f.x + f.vx * dt, y: f.y + f.vy * dt };
        t = bestT;
      }
    }
    const tablePt = this.contactPoint(this.toTable(pt));
    const side: TableSide = tablePt.y < NET_Y_M ? 'perto' : 'longe';
    const from = this.origin;
    const fromSide: TableSide | null = from ? (from.y < NET_Y_M ? 'perto' : 'longe') : null;
    const serve = fromSide !== null && fromSide === side && !this.lastWasBounceOnSide(side);
    const direction = from && fromSide !== side ? classifyDirection(from, tablePt) : null;
    const ev: BounceEvent = {
      t,
      frameIndex: this.obs[k.i]?.frameIndex ?? -1,
      image: pt,
      table: tablePt,
      side,
      audio,
      kickMps: k.kick,
      shot: { from, direction, serve },
    };
    this.bounces.push(ev);
    this.lastBounceT = t;
    // a próxima jogada (sem raquetada vista) parte deste quique
    this.origin = tablePt;
    this.originIsHit = false;
    return ev;
  }

  private lastWasBounceOnSide(side: TableSide): boolean {
    const b = this.bounces[this.bounces.length - 1];
    const h = this.hits[this.hits.length - 1];
    if (!b) return false;
    if (h && h.t > b.t) return false;
    return b.side === side;
  }
}

/** Reta por mínimos quadrados de x(t) e y(t), centrada em t0 (velocidades em px/ms). */
function fit(pts: BallObservation[], t0: number): Fit {
  let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0;
  for (const p of pts) {
    const t = p.t - t0;
    st += t;
    sx += p.x;
    sy += p.y;
    stt += t * t;
    stx += t * p.x;
    sty += t * p.y;
  }
  const n = pts.length;
  const den = n * stt - st * st || 1e-9;
  const vx = (n * stx - st * sx) / den;
  const vy = (n * sty - st * sy) / den;
  return { x: (sx - vx * st) / n, y: (sy - vy * st) / n, vx, vy };
}
