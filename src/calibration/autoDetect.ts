import type { Point2 } from '../core/types';
import { isConvexQuad, signedArea, type Quad } from './calibrate';

/**
 * Detecção automática da mesa: a superfície é uma região grande, de cor
 * saturada (azul ou verde) e uniforme. Passos:
 *   1. histograma de matiz dos pixels saturados → cor dominante azul/verde;
 *   2. máscara dessa cor + fechamento morfológico (tapa linhas brancas e a rede);
 *   3. maior componente conexo;
 *   4. cantos aproximados pelos extremos (x±y) e refinados ajustando uma reta
 *      a cada borda do contorno e intersectando as retas vizinhas.
 */

export interface TableDetection {
  corners: Quad;
  /** 0..1: quão "quadrilátero" é a região (área do quadrilátero / área da região). */
  confidence: number;
  /** Fração da imagem ocupada pela mesa. */
  areaFraction: number;
}

export type TableDetectionFailure = { reason: 'sem-cor' | 'pequena' | 'forma' };

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max / 255];
}

const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // separável: horizontal e depois vertical (quadrado de lado 2r+1)
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) if (src[y * w + x]) run = x;
      else if (run >= 0 && x - run <= r) tmp[y * w + x] = 1;
    run = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (src[y * w + x]) {
        run = x;
        tmp[y * w + x] = 1;
      } else if (run >= 0 && run - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) {
        run = y;
        out[y * w + x] = 1;
      } else if (run >= 0 && y - run <= r) out[y * w + x] = 1;
    run = -1;
    for (let y = h - 1; y >= 0; y--) if (tmp[y * w + x]) run = y;
      else if (run >= 0 && run - y <= r) out[y * w + x] = 1;
  }
  return out;
}

function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/** Maior componente conexo (vizinhança 4); devolve a máscara dele e a área. */
function largestComponent(mask: Uint8Array, w: number): { mask: Uint8Array; area: number } {
  const label = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = 0, bestArea = 0, cur = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    cur++;
    let sp = 0, area = 0;
    stack[sp++] = s;
    label[s] = cur;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const k of nb) if (k >= 0 && k < mask.length && mask[k] && !label[k]) {
          label[k] = cur;
          stack[sp++] = k;
        }
    }
    if (area > bestArea) {
      bestArea = area;
      best = cur;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = label[i] === best && best > 0 ? 1 : 0;
  return { mask: out, area: bestArea };
}

/** Reta por mínimos quadrados totais: ponto médio + direção (autovetor principal). */
function fitLine(pts: Point2[]): { p: Point2; d: Point2 } | null {
  if (pts.length < 2) return null;
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

function intersect(a: { p: Point2; d: Point2 }, b: { p: Point2; d: Point2 }): Point2 | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / den;
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y };
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

export function detectTable(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): TableDetection | TableDetectionFailure {
  const n = w * h;
  // 1. matiz dominante entre pixels saturados azul/verde
  const hist = new Float32Array(36);
  const hue = new Float32Array(n);
  const ok = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const [hh, s, v] = rgbToHsv(rgba[j], rgba[j + 1], rgba[j + 2]);
    hue[i] = hh;
    if (s >= 0.25 && v >= 0.12 && hh >= 80 && hh <= 260) {
      ok[i] = 1;
      hist[Math.floor(hh / 10)] += 1;
    }
  }
  let peak = -1, peakVal = 0;
  for (let b = 0; b < 36; b++) {
    const v = hist[b] + 0.5 * ((hist[b - 1] ?? 0) + (hist[b + 1] ?? 0));
    if (v > peakVal) {
      peakVal = v;
      peak = b;
    }
  }
  if (peak < 0 || peakVal < n * 0.02) return { reason: 'sem-cor' };
  const peakHue = peak * 10 + 5;

  // 2. máscara + fechamento (tapa linhas brancas e rede)
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (ok[i] && hueDist(hue[i], peakHue) <= 25) mask[i] = 1;
  const r = Math.max(2, Math.round(w / 100));
  mask = erode(dilate(mask, w, h, r), w, h, r);

  // 3. maior região
  const comp = largestComponent(mask, w);
  if (comp.area < n * 0.03) return { reason: 'pequena' };

  // contorno: pixels da região com vizinho fora
  const contour: Point2[] = [];
  const m = comp.mask;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w])
        contour.push({ x: x + 0.5, y: y + 0.5 });
    }

  // 4a. cantos aproximados pelos extremos (imagem com y para baixo; "perto" = embaixo)
  const ext = (f: (p: Point2) => number) => contour.reduce((a, p) => (f(p) > f(a) ? p : a), contour[0]);
  let corners: Quad = [ext((p) => p.y - p.x), ext((p) => p.y + p.x), ext((p) => p.x - p.y), ext((p) => -p.x - p.y)];

  // 4b. refino: cada ponto do contorno vai para a borda mais próxima; ajusta retas e intersecta
  for (let iter = 0; iter < 2; iter++) {
    const groups: Point2[][] = [[], [], [], []];
    for (const p of contour) {
      let bi = 0, bd = Infinity;
      for (let e = 0; e < 4; e++) {
        const d = distToSegment(p, corners[e], corners[(e + 1) % 4]);
        if (d < bd) {
          bd = d;
          bi = e;
        }
      }
      // ignora pontos perto dos cantos (cantos arredondados pelo fechamento)
      const a = corners[bi], b = corners[(bi + 1) % 4];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const da = Math.hypot(p.x - a.x, p.y - a.y), db = Math.hypot(p.x - b.x, p.y - b.y);
      if (bd < Math.max(3, len * 0.08) && da > len * 0.1 && db > len * 0.1) groups[bi].push(p);
    }
    const lines = groups.map(fitLine);
    if (lines.some((l) => !l)) break;
    const next = [0, 1, 2, 3].map((k) => intersect(lines[(k + 3) % 4]!, lines[k]!));
    if (next.some((p) => !p || !Number.isFinite(p.x))) break;
    corners = next as Quad;
  }

  if (!isConvexQuad(corners)) return { reason: 'forma' };
  const quadArea = Math.abs(signedArea(corners));
  const confidence = Math.max(0, 1 - Math.abs(quadArea - comp.area) / comp.area);
  if (confidence < 0.75) return { reason: 'forma' };
  return { corners, confidence, areaFraction: comp.area / n };
}

export function isTableDetection(r: TableDetection | TableDetectionFailure): r is TableDetection {
  return 'corners' in r;
}

export const TABLE_DETECTION_MESSAGES: Record<TableDetectionFailure['reason'], string> = {
  'sem-cor': 'Não encontrei uma superfície azul ou verde. Confira se a mesa inteira aparece e se há boa luz.',
  pequena: 'A mesa parece pequena demais na imagem. Aproxime a câmera ou marque os cantos à mão.',
  forma: 'Não consegui achar os 4 cantos com segurança (algo cobre a mesa?). Ajuste ou marque à mão.',
};
