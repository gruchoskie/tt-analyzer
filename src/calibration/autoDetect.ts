import type { Point2 } from '../core/types';
import { isConvexQuad, orderCorners, signedArea, type Quad } from './calibrate';
import { applyHomography, computeHomography } from './homography';
import { TABLE_CORNERS_M } from './table';

/**
 * Detecção automática da mesa pelas 4 bordas (retas), não pelos cantos:
 *   1. cor de referência do tampo: pico de matiz azul/verde ponderado pelo
 *      centro-baixo da imagem (onde a mesa costuma estar) + mediana de
 *      saturação e brilho desse tom;
 *   2. máscara só dos pixels parecidos com essa cor (matiz, saturação e brilho),
 *      o que separa barreiras e painéis de azul mais forte;
 *   3. região principal (grande e central) + pedaços vizinhos (a rede e a
 *      linha central partem o tampo);
 *   4. retas candidatas (Hough) no contorno da região, ignorando a moldura da
 *      imagem, e escolha das 2 "horizontais" + 2 laterais que formam o
 *      quadrilátero que melhor cobre a região sem invadir o fundo;
 *   5. refino de cada reta pelos pontos do contorno e deslocamento para fora
 *      sobre a faixa branca da borda (o canto real fica na borda externa dela);
 *   6. cantos = interseções das retas. Um canto pode cair um pouco fora da
 *      imagem (mesa cortada na borda do quadro): ele é estimado pelas retas.
 */

export interface TableDetection {
  corners: Quad;
  /** 0..1: quanto o quadrilátero bate com a região da cor da mesa. */
  confidence: number;
  /** Fração da imagem ocupada pela mesa (parte visível). */
  areaFraction: number;
  /** Índices dos cantos estimados fora da imagem. */
  outside: number[];
}

export type TableDetectionFailure = { reason: 'sem-cor' | 'pequena' | 'forma' | 'cortada' };

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

function dilate(src: Uint8Array, w: number, h: number, r: number, ry = r): Uint8Array {
  // separável: horizontal e depois vertical (retângulo (2r+1) x (2ry+1))
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (src[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= ry) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= ry) out[y * w + x] = 1;
    }
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

/** Componentes conexos (vizinhança 4). */
function components(mask: Uint8Array, w: number): { label: Int32Array; areas: number[]; cx: number[]; cy: number[]; x0: number[]; x1: number[] } {
  const label = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  const areas = [0], cx = [0], cy = [0], x0 = [0], x1 = [0];
  let cur = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    cur++;
    let sp = 0, area = 0, sx = 0, sy = 0, minX = Infinity, maxX = -Infinity;
    stack[sp++] = s;
    label[s] = cur;
    while (sp) {
      const i = stack[--sp];
      const x = i % w;
      area++;
      sx += x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      sy += (i - x) / w;
      if (x > 0 && mask[i - 1] && !label[i - 1]) (label[i - 1] = cur), (stack[sp++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) (label[i + 1] = cur), (stack[sp++] = i + 1);
      if (i >= w && mask[i - w] && !label[i - w]) (label[i - w] = cur), (stack[sp++] = i - w);
      if (i + w < mask.length && mask[i + w] && !label[i + w]) (label[i + w] = cur), (stack[sp++] = i + w);
    }
    areas.push(area);
    cx.push(sx / area);
    cy.push(sy / area);
    x0.push(minX);
    x1.push(maxX);
  }
  return { label, areas, cx, cy, x0, x1 };
}

/** Reta na forma normal: n·p = rho, com n = (cos θ, sen θ). */
interface Line {
  nx: number;
  ny: number;
  rho: number;
}

function lineFromNormal(theta: number, rho: number): Line {
  return { nx: Math.cos(theta), ny: Math.sin(theta), rho };
}

/** Reta por mínimos quadrados totais. */
function fitLine(pts: Point2[]): Line | null {
  if (pts.length < 4) return null;
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
  const dir = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(dir), ny = Math.cos(dir);
  return { nx, ny, rho: nx * mx + ny * my };
}

function intersect(a: Line, b: Line): Point2 | null {
  const den = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(den) < 1e-9) return null;
  return { x: (a.rho * b.ny - a.ny * b.rho) / den, y: (a.nx * b.rho - a.rho * b.nx) / den };
}

/** Largura da faixa branca da borda (m). */
const LINE_M = 0.02;

const dist = (l: Line, x: number, y: number) => l.nx * x + l.ny * y - l.rho;

/** Picos da transformada de Hough dos pontos (com supressão de vizinhos). */
function houghPeaks(pts: Point2[], w: number, h: number, maxPeaks: number, minVotes: number): Line[] {
  const NT = 180;
  const diag = Math.ceil(Math.hypot(w, h));
  const NR = 2 * diag + 1;
  const acc = new Uint16Array(NT * NR);
  const cs = new Float32Array(NT), sn = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    cs[t] = Math.cos((t * Math.PI) / NT);
    sn[t] = Math.sin((t * Math.PI) / NT);
  }
  for (const p of pts)
    for (let t = 0; t < NT; t++) {
      const r = Math.round(p.x * cs[t] + p.y * sn[t]) + diag;
      acc[t * NR + r]++;
    }
  // suaviza em rho (borda borrada espalha os votos por 2-3 px)
  const sm = new Float32Array(acc.length);
  for (let t = 0; t < NT; t++)
    for (let r = 1; r < NR - 1; r++) {
      const i = t * NR + r;
      sm[i] = acc[i] + 0.5 * (acc[i - 1] + acc[i + 1]);
    }
  const cells: number[] = [];
  for (let i = 0; i < sm.length; i++) if (sm[i] >= minVotes) cells.push(i);
  cells.sort((a, b) => sm[b] - sm[a]);
  const peaks: { t: number; r: number }[] = [];
  for (const i of cells) {
    const t = Math.floor(i / NR), r = (i % NR) - diag;
    const near = peaks.some((p) => {
      let dt = Math.abs(p.t - t);
      let dr = Math.abs(p.r - r);
      if (dt > NT / 2) {
        dt = NT - dt; // θ e θ+180 com rho trocado de sinal
        dr = Math.abs(p.r + r);
      }
      return dt <= 4 && dr <= 5;
    });
    if (near) continue;
    peaks.push({ t, r });
    if (peaks.length >= maxPeaks) break;
  }
  return peaks.map((p) => lineFromNormal((p.t * Math.PI) / NT, p.r));
}

export function detectTable(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): TableDetection | TableDetectionFailure {
  const n = w * h;
  const H = new Float32Array(n), S = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const [hh, s, v] = rgbToHsv(rgba[j], rgba[j + 1], rgba[j + 2]);
    H[i] = hh;
    S[i] = s;
    V[i] = v;
  }
  // peso "onde a mesa costuma estar": centro, um pouco abaixo do meio
  const weight = (x: number, y: number) => Math.exp(-(((x / w - 0.5) / 0.32) ** 2 + ((y / h - 0.62) / 0.3) ** 2) / 2);

  // 1. matiz dominante (azul/verde) e cor de referência
  const hist = new Float32Array(72);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (S[i] >= 0.18 && V[i] >= 0.15 && H[i] >= 80 && H[i] <= 260) hist[Math.floor(H[i] / 5)] += weight(x, y);
    }
  let peak = -1, peakVal = 0, total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) total += weight(x, y);
  for (let b = 0; b < 72; b++) {
    let v = 0;
    for (let k = -3; k <= 3; k++) v += (hist[b + k] ?? 0) * (1 - Math.abs(k) / 4);
    if (v > peakVal) {
      peakVal = v;
      peak = b;
    }
  }
  if (peak < 0 || peakVal < total * 0.04) return { reason: 'sem-cor' };
  const peakHue = peak * 5 + 2.5;
  const ss: number[] = [], vs: number[] = [];
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      const i = y * w + x;
      if (S[i] >= 0.18 && hueDist(H[i], peakHue) <= 10 && weight(x, y) > 0.4) {
        ss.push(S[i]);
        vs.push(V[i]);
      }
    }
  if (ss.length < 20) return { reason: 'sem-cor' };
  const median = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const sRef = median(ss), vRef = median(vs);

  // 2. máscara do tampo + limpeza leve
  const sLo = Math.max(0.12, sRef * 0.45), sHi = Math.min(1.01, sRef * 1.6 + 0.06);
  const vLo = vRef * 0.4, vHi = Math.min(1.01, vRef * 1.5 + 0.05);
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    if (hueDist(H[i], peakHue) <= 22 && S[i] >= sLo && S[i] <= sHi && V[i] >= vLo && V[i] <= vHi) mask[i] = 1;
  mask = dilate(erode(mask, w, h, 1), w, h, 1);
  mask = erode(dilate(mask, w, h, 1), w, h, 1);
  const isWhite = (i: number) => S[i] <= 0.3 && V[i] >= Math.max(0.5, vRef * 1.02);

  // 3. região principal + vizinhos
  const comp = components(mask, w);
  let main = 0, mainScore = 0;
  for (let c = 1; c < comp.areas.length; c++) {
    const sc = comp.areas[c] * weight(comp.cx[c], comp.cy[c]);
    if (sc > mainScore) {
      mainScore = sc;
      main = c;
    }
  }
  if (!main || comp.areas[main] < n * 0.02) return { reason: 'pequena' };
  const inGroup = new Uint8Array(comp.areas.length);
  inGroup[main] = 1;
  // a rede (faixa escura) separa as metades: tolera um vão vertical maior
  const gap = Math.max(2, Math.round(w / 80));
  const gapV = Math.max(gap, Math.round(h / 12));
  for (let pass = 0; pass < 2; pass++) {
    const g = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (inGroup[comp.label[i]]) g[i] = 1;
    const near = dilate(g, w, h, Math.max(gap, Math.round(w / 40)), gapV);
    for (let i = 0; i < n; i++) {
      const c = comp.label[i];
      if (!c || inGroup[c] || !near[i] || comp.areas[c] < n * 0.002) continue;
      // pedaços do tampo cabem na largura da mesa; parede/chão da mesma cor, não
      const mw = comp.x1[main] - comp.x0[main];
      // (de lado, a outra metade fica ao lado da principal)
      if (comp.x0[c] < comp.x0[main] - mw || comp.x1[c] > comp.x1[main] + mw) continue;
      if (comp.areas[c] > 1.5 * comp.areas[main]) continue;
      inGroup[c] = 1;
    }
  }
  const region = new Uint8Array(n);
  let regionArea = 0;
  for (let i = 0; i < n; i++)
    if (inGroup[comp.label[i]]) {
      region[i] = 1;
      regionArea++;
    }
  if (regionArea < n * 0.03) return { reason: 'pequena' };

  // 4. contorno (sem a moldura da imagem) e retas candidatas
  const border: Point2[] = [];
  const m = 2;
  for (let y = m; y < h - m; y++)
    for (let x = m; x < w - m; x++) {
      const i = y * w + x;
      if (region[i] && (!region[i - 1] || !region[i + 1] || !region[i - w] || !region[i + w])) border.push({ x: x + 0.5, y: y + 0.5 });
    }
  const lines = houghPeaks(border, w, h, 20, Math.max(10, Math.min(w, h) * 0.06));
  if (lines.length < 4) return regionTouchesFrame(region, w, h) ? { reason: 'cortada' } : { reason: 'forma' };

  // máscaras reduzidas para pontuar quadriláteros: passo 4 na busca, 2 na validação
  // (2 = região principal, 1 = outro pedaço da mesa, 0 = branco/neutro, -1 = outra coisa)
  const makeCls = (step: number) => {
    const sw = Math.ceil(w / step), sh = Math.ceil(h / step);
    const cls = new Int8Array(sw * sh);
    let region = 0, mainN = 0;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = y * step * w + x * step;
        const v = comp.label[i] === main ? 2 : inGroup[comp.label[i]] && comp.label[i] ? 1 : isWhite(i) ? 0 : -1;
        cls[y * sw + x] = v;
        if (v >= 1) region++;
        if (v === 2) mainN++;
      }
    return { cls, sw, sh, step, region, mainN };
  };
  const coarse = makeCls(4);
  const fine = makeCls(2);

  // Qualquer ângulo de câmera: testa todo conjunto de 4 retas e os 3 jeitos
  // de parear lados opostos; fica o quadrilátero que melhor cobre a região.
  let best: { lines: [Line, Line, Line, Line]; score: number } | null = null;
  const margin = 0.35;
  const L = lines.length;
  for (let i = 0; i < L; i++)
    for (let j = i + 1; j < L; j++)
      for (let k = j + 1; k < L; k++)
        for (let l = k + 1; l < L; l++) {
          const pairings: [number, number, number, number][] = [
            [i, k, j, l],
            [i, j, k, l],
            [i, j, l, k],
          ];
          for (const [a, c, b, d] of pairings) {
            // ordem cíclica a, c, b, d (a/b opostos, c/d opostos)
            const e: [Line, Line, Line, Line] = [lines[a], lines[c], lines[b], lines[d]];
            const quad = edgesToQuad(e);
            if (!quad) continue;
            if (quad.some((p) => p.x < -w * margin || p.x > w * (1 + margin) || p.y < -h * margin || p.y > h * (1 + margin))) continue;
            if (!isConvexQuad(quad) || Math.abs(signedArea(quad)) < n * 0.02 || !saneAngles(quad)) continue;
            const score = scoreQuad(quad, coarse.cls, coarse.sw, coarse.sh, coarse.step, coarse.region);
            if (!best || score > best.score) best = { lines: e, score };
          }
        }
  if (!best) return regionTouchesFrame(region, w, h) ? { reason: 'cortada' } : { reason: 'forma' };

  // 5. refino: reajusta cada reta pelos pontos do contorno próximos dela
  let edges = best.lines.map((l) => ({ ...l }));
  // lado k vai do canto k ao k+1 de edgesToQuad (ordem cíclica)
  for (let iter = 0; iter < 2; iter++) {
    const tol = iter === 0 ? 4 : 2.5;
    edges = edges.map((l, k) => {
      const corners = edgesToQuad(edges);
      if (!corners) return l;
      const p0 = corners[k], p1 = corners[(k + 1) % 4];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const pts = border.filter((p) => {
        if (Math.abs(dist(l, p.x, p.y)) > tol) return false;
        const t = ((p.x - p0.x) * (p1.x - p0.x) + (p.y - p0.y) * (p1.y - p0.y)) / (len * len);
        return t > 0.06 && t < 0.94;
      });
      return fitLine(pts) ?? l;
    });
  }
  let quad = edgesToQuad(edges);
  if (!quad || !isConvexQuad(quad)) return { reason: 'forma' };

  // 5b. a borda real é a externa da faixa branca: em cada ponto da reta anda
  // para fora enquanto houver branco (limitado à largura esperada da faixa,
  // 2 cm, pela escala local) e reajusta a reta pelos pontos externos — a
  // faixa fica mais fina com a distância, então não é um deslocamento único.
  const cxq = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cyq = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  // escala local (px por metro) pela homografia provisória
  const labeled = orderCorners(quad, w, h);
  const toTable = computeHomography(labeled, TABLE_CORNERS_M);
  const toImage = computeHomography(TABLE_CORNERS_M, labeled);
  // espessura esperada (px) da faixa: 1 cm na direção da mesa perpendicular à
  // borda, medido ao longo da normal da borda na imagem
  const pxPerMAcross = (x: number, y: number, edgeAlongX: boolean, ox: number, oy: number) => {
    const t = applyHomography(toTable, { x, y });
    const p = applyHomography(toImage, t);
    const q = applyHomography(toImage, edgeAlongX ? { x: t.x, y: t.y + 0.01 } : { x: t.x + 0.01, y: t.y });
    const s = Math.abs((q.x - p.x) * ox + (q.y - p.y) * oy) / 0.01;
    return Number.isFinite(s) ? s : 0;
  };
  edges = edges.map((l, k) => {
    const p0 = quad![k], p1 = quad![(k + 1) % 4];
    const sgn = dist(l, cxq, cyq) > 0 ? -1 : 1; // normal para fora
    const ox = sgn * l.nx, oy = sgn * l.ny;
    const ta = applyHomography(toTable, p0), tb = applyHomography(toTable, p1);
    const alongX = Math.abs(tb.x - ta.x) > Math.abs(tb.y - ta.y);
    const outer: Point2[] = [];
    let samples = 0;
    for (let s = 0; s <= 30; s++) {
      const t = 0.08 + (0.84 * s) / 30;
      const bx = p0.x + (p1.x - p0.x) * t, by = p0.y + (p1.y - p0.y) * t;
      if (bx < 2 || by < 2 || bx >= w - 2 || by >= h - 2) continue;
      samples++;
      const cap = Math.min(Math.max(1.5, 1.6 * LINE_M * pxPerMAcross(bx, by, alongX, ox, oy)), w / 25);
      // procura a faixa branca mais próxima da borda, um pouco para dentro
      // (a região pode incluir a face lateral do tampo, abaixo da faixa) ou
      // para fora; a borda real é o lado externo dessa faixa.
      // A face do tampo só aparece abaixo das bordas voltadas para a câmera
      // (normal para fora apontando para baixo); nas outras não procura para
      // dentro, senão acharia a fita da rede.
      const inMax = oy > 0.3 ? Math.ceil(4 * cap) + 2 : 1, outMax = Math.ceil(cap) + 1;
      let bestEnd = NaN, bestD = Infinity;
      let runStart = NaN;
      for (let k2 = -inMax; k2 <= outMax + 1; k2++) {
        const x = Math.round(bx + ox * k2), y = Math.round(by + oy * k2);
        const white = x >= 0 && y >= 0 && x < w && y < h && k2 <= outMax && isWhite(y * w + x);
        if (white && Number.isNaN(runStart)) runStart = k2;
        if (!white && !Number.isNaN(runStart)) {
          const end = k2 - 0.5; // borda externa da faixa
          const len = k2 - runStart;
          const d = Math.min(Math.abs(runStart), Math.abs(end));
          if (len <= cap + 1.5 && d < bestD) {
            bestD = d;
            bestEnd = end;
          }
          runStart = NaN;
        }
      }
      if (Number.isNaN(bestEnd) || bestD > Math.max(2, inMax - 1)) continue;
      outer.push({ x: bx + ox * bestEnd, y: by + oy * bestEnd });
    }
    if (samples < 5 || outer.length < Math.max(5, samples * 0.4)) return l;
    // ajuste robusto: descarta pontos longe da primeira reta e reajusta
    const first = fitLine(outer);
    if (!first) return l;
    const kept = outer.filter((p) => Math.abs(dist(first, p.x, p.y)) <= 1.5);
    return (kept.length >= 5 ? fitLine(kept) : first) ?? l;
  });
  quad = edgesToQuad(edges);
  if (!quad || !isConvexQuad(quad)) return { reason: 'forma' };

  // 6. validação
  const fill = quadFill(quad, fine.cls, fine.sw, fine.sh, fine.step);
  const covered = quadCoverage(quad, fine.cls, fine.sw, fine.sh, fine.step, fine.mainN);
  if (fill < 0.75 || covered < 0.8) return regionTouchesFrame(region, w, h) && covered < 0.8 ? { reason: 'cortada' } : { reason: 'forma' };
  // rótulos dos cantos (perto/longe, esquerda/direita) para qualquer ângulo
  quad = orderCorners(quad, w, h);
  const outside: number[] = [];
  quad.forEach((p, i) => {
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) outside.push(i);
  });
  return {
    corners: quad,
    confidence: Math.min(fill, covered),
    areaFraction: regionArea / n,
    outside,
  };
}

/** Ângulos internos plausíveis: nem quase raso (duas retas da mesma borda) nem agulha. */
function saneAngles(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (cos < -0.966 || cos > 0.966) return false; // > 165° ou < 15°
  }
  return true;
}

/** [near, right, far, left] → cantos [perto-esq, perto-dir, longe-dir, longe-esq]. */
function edgesToQuad(e: Line[]): Quad | null {
  const q = [intersect(e[0], e[3]), intersect(e[0], e[1]), intersect(e[2], e[1]), intersect(e[2], e[3])];
  if (q.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  return q as Quad;
}

function insideTest(q: Quad) {
  const s = Math.sign(signedArea(q));
  return (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if (s * ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) < 0) return false;
    }
    return true;
  };
}

function quadCounts(q: Quad, cls: Int8Array, sw: number, sh: number, step: number) {
  const inside = insideTest(q);
  let ys = Infinity, ye = -Infinity, xs = Infinity, xe = -Infinity;
  for (const p of q) {
    ys = Math.min(ys, p.y);
    ye = Math.max(ye, p.y);
    xs = Math.min(xs, p.x);
    xe = Math.max(xe, p.x);
  }
  const y0 = Math.max(0, Math.floor(ys / step)), y1 = Math.min(sh - 1, Math.ceil(ye / step));
  const x0 = Math.max(0, Math.floor(xs / step)), x1 = Math.min(sw - 1, Math.ceil(xe / step));
  let tbl = 0, other = 0, white = 0, main = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x * step + 0.5, y * step + 0.5)) continue;
      const c = cls[y * sw + x];
      if (c >= 1) tbl++;
      if (c === 2) main++;
      else if (c === -1) other++;
      else white++;
    }
  return { tbl, other, white, main };
}

function scoreQuad(q: Quad, cls: Int8Array, sw: number, sh: number, step: number, regionSmall: number): number {
  const { tbl, other } = quadCounts(q, cls, sw, sh, step);
  // cobre a região da mesa; cada pixel "de fora" dentro do quadrilátero custa caro
  return tbl - 2 * other - 1 * (regionSmall - tbl);
}

function quadFill(q: Quad, cls: Int8Array, sw: number, sh: number, step: number): number {
  const { tbl, other, white } = quadCounts(q, cls, sw, sh, step);
  const all = tbl + other + white;
  return all ? (tbl + white) / all : 0;
}

/**
 * Quanto da região da mesa ficou dentro do quadrilátero: toda a região
 * principal (a parte grande e central do tampo) e os pedaços vizinhos que
 * estão perto dele (os distantes podem ser parede/chão da mesma cor).
 */
function quadCoverage(q: Quad, cls: Int8Array, sw: number, sh: number, step: number, mainSmall: number): number {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const big = q.map((p) => ({ x: cx + (p.x - cx) * 1.35, y: cy + (p.y - cy) * 1.35 })) as Quad;
  const inner = quadCounts(q, cls, sw, sh, step);
  const around = quadCounts(big, cls, sw, sh, step).tbl;
  const local = around ? inner.tbl / around : 0;
  const mainCov = mainSmall ? inner.main / mainSmall : 0;
  return Math.min(local, mainCov);
}

function regionTouchesFrame(region: Uint8Array, w: number, h: number): boolean {
  let c = 0;
  for (let x = 0; x < w; x++) c += region[(h - 1) * w + x] + region[x];
  for (let y = 0; y < h; y++) c += region[y * w] + region[y * w + w - 1];
  return c > Math.min(w, h) * 0.15;
}

export function isTableDetection(r: TableDetection | TableDetectionFailure): r is TableDetection {
  return 'corners' in r;
}

export const TABLE_DETECTION_MESSAGES: Record<TableDetectionFailure['reason'], string> = {
  'sem-cor': 'Não encontrei uma superfície azul ou verde. Confira se a mesa aparece e se há boa luz.',
  pequena: 'A mesa parece pequena demais na imagem. Aproxime a câmera ou marque os cantos à mão.',
  forma: 'Não consegui achar as 4 bordas da mesa com segurança (algo cobre a mesa?). Ajuste ou marque à mão.',
  cortada: 'A mesa está cortada na imagem e não consegui achar as 4 bordas. Afaste ou levante o celular para a mesa inteira aparecer.',
};
