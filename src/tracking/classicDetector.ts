/**
 * Detector clássico da bola (sem modelo de IA), em resolução reduzida:
 *   1. diferença tripla de quadros (|t − t−1| e |t − t−2|): só o que está se mexendo AGORA;
 *   2. filtro de cor (bola branca e/ou laranja);
 *   3. componentes conexos e filtros de tamanho, preenchimento e alongamento.
 * Funções puras sobre RGBA para poderem rodar no Worker e serem testadas.
 */

import type { BallPrior } from './ballPrior';
import { matchesProfile, type BallProfile } from './ballProfile';

export type BallColor = 'branca' | 'laranja' | 'auto';

export interface DetectorOptions {
  color: BallColor;
  /** Diferença mínima de luminância (0..255) para considerar movimento. */
  motionThreshold: number;
  /** Área mínima/máxima do blob em px da imagem de análise. */
  minArea: number;
  maxArea: number;
  /** Preenchimento mínimo do retângulo envolvente (disco = 0,785). */
  minFill: number;
  /** Alongamento máximo (rastro de borrão de movimento é alongado). */
  maxAspect: number;
  /** Região de interesse em px de análise (opcional). */
  roi?: { x0: number; y0: number; x1: number; y1: number };
  /** Máximo de candidatos devolvidos. */
  maxCandidates: number;
  /**
   * Conhecimento vindo da calibração (região do jogo por linha e raio esperado
   * da bola por linha). Quando presente, substitui a ROI e os limites de área.
   */
  prior?: Pick<BallPrior, 'spanMin' | 'spanMax' | 'rMin' | 'rMax' | 'rTypical'>;
  /** Bola escolhida pelo usuário: a cor dela substitui o filtro genérico. */
  profile?: BallProfile;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  color: 'auto',
  motionThreshold: 22,
  minArea: 3,
  maxArea: 260,
  minFill: 0.35,
  maxAspect: 4,
  maxCandidates: 8,
};

export interface Candidate {
  /** Centro em px da imagem de análise. */
  x: number;
  y: number;
  area: number;
  /** Raio equivalente (√(área/π)). */
  radius: number;
  width: number;
  height: number;
  fill: number;
  aspect: number;
  /** 0..1, maior = mais parecido com uma bola. */
  score: number;
}

export function luma(r: number, g: number, b: number): number {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

/** Cor de bola? Branca: clara e pouco saturada. Laranja: matiz ~15–45°, saturada, clara. */
export function isBallColor(r: number, g: number, b: number, color: BallColor): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (color !== 'laranja' && max >= 150 && max - min <= 70) return true; // branca
  if (color !== 'branca' && r >= 140 && r === max && max - min >= 60) {
    // matiz entre vermelho-alaranjado e amarelo-alaranjado
    const hue = (60 * (g - b)) / (max - min);
    if (hue >= 12 && hue <= 50) return true;
  }
  return false;
}

/** Converte RGBA para luminância (reaproveita o buffer de saída). */
export function toLuma(rgba: Uint8ClampedArray | Uint8Array, out?: Uint8Array): Uint8Array {
  const n = rgba.length >> 2;
  const y = out && out.length === n ? out : new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) y[i] = luma(rgba[j], rgba[j + 1], rgba[j + 2]);
  return y;
}

/**
 * Máscara de pixels candidatos: movimento em relação aos 2 quadros anteriores
 * E cor de bola E dentro da ROI.
 */
export function motionColorMask(
  rgba: Uint8ClampedArray | Uint8Array,
  y0: Uint8Array,
  y1: Uint8Array,
  y2: Uint8Array,
  width: number,
  height: number,
  opts: DetectorOptions,
  out?: Uint8Array,
): Uint8Array {
  const n = width * height;
  const mask = out && out.length === n ? out : new Uint8Array(n);
  mask.fill(0);
  const t = opts.motionThreshold;
  const roi = opts.roi ?? { x0: 0, y0: 0, x1: width, y1: height };
  const prior = opts.prior && opts.prior.spanMin.length === height ? opts.prior : null;
  const profile = opts.profile;
  const ya = Math.max(0, Math.floor(roi.y0));
  const yb = Math.min(height, Math.ceil(roi.y1));
  for (let yy = ya; yy < yb; yy++) {
    // região do jogo por linha (polígono da calibração) ou retângulo
    const xa = prior ? Math.max(0, prior.spanMin[yy]) : Math.max(0, Math.floor(roi.x0));
    const xb = prior ? Math.min(width, prior.spanMax[yy]) : Math.min(width, Math.ceil(roi.x1));
    if (xb <= xa) continue;
    // Lâmpada LED pisca: a linha inteira fica mais clara/escura de um quadro para
    // o outro (em faixas, pelo obturador linha a linha). Desconta o deslocamento
    // típico da linha, medido na linha toda (o que se mexe de verdade é pouco dela).
    const o1 = rowOffset(y0, y1, yy * width, width);
    const o2 = rowOffset(y0, y2, yy * width, width);
    let i = yy * width + xa;
    for (let xx = xa; xx < xb; xx++, i++) {
      const c = y0[i];
      if (Math.abs(c - y1[i] - o1) < t || Math.abs(c - y2[i] - o2) < t) continue;
      const j = i << 2;
      const ok = profile
        ? matchesProfile(rgba[j], rgba[j + 1], rgba[j + 2], profile)
        : isBallColor(rgba[j], rgba[j + 1], rgba[j + 2], opts.color);
      if (ok) mask[i] = 1;
    }
  }
  return mask;
}

const hist = new Int32Array(511);
/**
 * Deslocamento de brilho de uma linha entre dois quadros: mediana das
 * diferenças (o que se mexe de verdade é pouco da linha). 0 se mudou pouco.
 */
export function rowOffset(a: Uint8Array, b: Uint8Array, start: number, width: number): number {
  hist.fill(0);
  const step = width > 160 ? 2 : 1;
  let n = 0;
  for (let x = 0; x < width; x += step) {
    hist[a[start + x] - b[start + x] + 255]++;
    n++;
  }
  const half = n / 2;
  let acc = 0;
  for (let k = 0; k < 511; k++) {
    acc += hist[k];
    if (acc >= half) {
      const m = k - 255;
      return Math.abs(m) < 3 ? 0 : m;
    }
  }
  return 0;
}

/** Componentes conexos (vizinhança 8) da máscara, com estatísticas por blob. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  maxBlobArea = Infinity,
): { area: number; sx: number; sy: number; minX: number; maxX: number; minY: number; maxY: number }[] {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const blobs = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width;
      const y = (i - x) / width;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const k = ny * width + nx;
          if (mask[k] && !seen[k]) {
            seen[k] = 1;
            stack[sp++] = k;
          }
        }
      }
    }
    // blobs gigantes (jogador, roupa branca) são descartados cedo
    if (area <= maxBlobArea) blobs.push({ area, sx, sy, minX, maxX, minY, maxY });
  }
  return blobs;
}

/** Transforma blobs em candidatos pontuados, aplicando os filtros de forma. */
export function scoreBlobs(blobs: ReturnType<typeof connectedComponents>, opts: DetectorOptions): Candidate[] {
  const out: Candidate[] = [];
  const prior = opts.prior;
  for (const b of blobs) {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const fill = b.area / (w * h);
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (fill < opts.minFill || aspect > opts.maxAspect) continue;
    let priorScore = 1;
    if (prior) {
      // Tamanho esperado da bola nessa altura da imagem (40 mm pela calibração).
      // Mede a "espessura" do blob (o borrão de movimento só alonga o comprimento).
      const row = Math.min(prior.rMin.length - 1, Math.max(0, Math.round(b.sy / b.area)));
      const thin = Math.min(w, h) / 2;
      const rMin = prior.rMin[row];
      const rMax = prior.rMax[row];
      if (thin < rMin * 0.8 || thin > rMax || b.area > Math.PI * rMax * rMax * opts.maxAspect) continue;
      const rTyp = prior.rTypical[row];
      priorScore = 1 - 0.6 * Math.min(1, Math.abs(thin - rTyp) / rTyp);
    } else if (b.area < opts.minArea || b.area > opts.maxArea) continue;
    // Disco perfeito: fill ≈ 0,785, aspect = 1. Penaliza o afastamento.
    const fillScore = 1 - Math.min(1, Math.abs(fill - 0.785) / 0.5);
    const aspectScore = 1 / aspect;
    const sizeScore = (b.area < 6 ? 0.6 : 1) * priorScore; // blobs minúsculos costumam ser ruído
    out.push({
      x: b.sx / b.area,
      y: b.sy / b.area,
      area: b.area,
      radius: Math.sqrt(b.area / Math.PI),
      width: w,
      height: h,
      fill,
      aspect,
      score: Math.max(0, Math.min(1, 0.5 * fillScore + 0.5 * aspectScore)) * sizeScore,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.maxCandidates);
}

/**
 * Detector com estado: guarda a luminância dos 2 quadros anteriores
 * (3 buffers em rodízio, sem alocar por quadro).
 * Retorna candidatos em px da imagem de análise.
 */
export class ClassicDetector {
  private bufs: Uint8Array[] = [];
  private frames = 0;
  private mask = new Uint8Array(0);
  private w = 0;
  private h = 0;
  /** Pixels marcados na última máscara (debug). */
  lastMaskCount = 0;
  /** Quadro descartado por mudança global (câmera mexeu, luz piscou). */
  lastRejectedGlobal = false;

  constructor(public opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS }) {}

  reset(): void {
    this.frames = 0;
  }

  detect(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Candidate[] {
    if (width !== this.w || height !== this.h || this.bufs.length !== 3) {
      this.w = width;
      this.h = height;
      const n = width * height;
      this.bufs = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
      this.mask = new Uint8Array(n);
      this.frames = 0;
    }
    const k = this.frames % 3;
    const y0 = toLuma(rgba, this.bufs[k]);
    const y1 = this.bufs[(k + 2) % 3];
    const y2 = this.bufs[(k + 1) % 3];
    this.frames++;
    this.lastRejectedGlobal = false;
    if (this.frames < 3) return [];
    const mask = motionColorMask(rgba, y0, y1, y2, width, height, this.opts, this.mask);
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    this.lastMaskCount = count;
    if (count > mask.length * 0.08) {
      this.lastRejectedGlobal = true;
      return [];
    }
    const maxBlob = this.opts.prior ? Infinity : this.opts.maxArea * 4;
    return scoreBlobs(connectedComponents(mask, width, height, maxBlob), this.opts);
  }
}
