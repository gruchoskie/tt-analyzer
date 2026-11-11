import { applyHomography } from '../calibration/homography';
import { tableToImageMatrix } from '../calibration/calibrate';
import { TABLE_LENGTH_M, TABLE_WIDTH_M } from '../physics/constants';
import { BALL_RADIUS_M } from '../physics/constants';
import type { TableCalibration } from '../calibration/types';
import type { Point2 } from '../core/types';

/**
 * O que a calibração sabe sobre a bola em cada parte da imagem:
 *  - raio esperado (a bola tem 40 mm; a homografia diz quantos px por metro);
 *  - região do jogo (polígono: mesa + espaço acima + folga lateral), por linha;
 *  - velocidade máxima plausível em px/s.
 * Tudo calculado na resolução de análise e enviado ao Worker.
 */
export interface BallPrior {
  width: number;
  height: number;
  /** Para cada linha: [xMin, xMax) da região do jogo (xMin > xMax = linha fora). */
  spanMin: Int16Array;
  spanMax: Int16Array;
  /** Raio mínimo/máximo aceitável (px de análise) por linha, medido na direção mais estreita do blob. */
  rMin: Float32Array;
  rMax: Float32Array;
  /** Raio "típico" por linha (px de análise). */
  rTypical: Float32Array;
  /** Velocidade máxima plausível (px de análise por segundo). */
  maxSpeedPx: number;
}

/** Bola raramente passa de ~30 m/s (108 km/h) mesmo em smash forte. */
export const MAX_BALL_SPEED_MPS = 32;

/**
 * px por metro na imagem em torno de um ponto da mesa, na direção da largura
 * (paralela à imagem). A bola é uma esfera: o tamanho aparente depende da
 * distância, não do encurtamento do plano no sentido do comprimento.
 */
function pxPerMeter(Hinv: number[], p: Point2): number {
  const d = 0.1;
  const a = applyHomography(Hinv, p);
  const b = applyHomography(Hinv, { x: p.x + d, y: p.y });
  return Math.hypot(b.x - a.x, b.y - a.y) / d;
}

/** Envoltória convexa (monotone chain). */
export function convexHull(pts: Point2[]): Point2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function computeBallPrior(cal: TableCalibration, analysisW: number, analysisH: number): BallPrior {
  const sx = analysisW / cal.imageWidth;
  const sy = analysisH / cal.imageHeight;
  const s = Math.sqrt(sx * sy);
  const Hinv = tableToImageMatrix(cal);
  const W = TABLE_WIDTH_M;
  const L = TABLE_LENGTH_M;

  // Raio da bola nas bordas perto/longe (px de análise).
  const nearScale = pxPerMeter(Hinv, { x: W / 2, y: 0.05 }) * s;
  const farScale = pxPerMeter(Hinv, { x: W / 2, y: L - 0.05 }) * s;
  const rNear = BALL_RADIUS_M * nearScale;
  const rFar = BALL_RADIUS_M * farScale;
  const toA = (p: Point2) => ({ x: p.x * sx, y: p.y * sy });
  const c = cal.cornersPx.map(toA);
  const nearRow = (c[0].y + c[1].y) / 2;
  const farRow = (c[2].y + c[3].y) / 2;
  const tableH = Math.max(1, nearRow - farRow);
  const tableWNear = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);

  // Região do jogo: mesa, folga lateral de 20% da largura, e até ~1,3 m acima da
  // mesa (em px usa a altura da mesa na imagem como referência generosa).
  const up = 1.3 * tableH;
  const side = 0.2 * tableWNear;
  const poly = convexHull([
    { x: c[0].x - side, y: c[0].y + 0.05 * tableH },
    { x: c[1].x + side, y: c[1].y + 0.05 * tableH },
    { x: c[2].x + side * 0.6, y: c[2].y },
    { x: c[3].x - side * 0.6, y: c[3].y },
    { x: c[0].x - side, y: c[0].y - up },
    { x: c[1].x + side, y: c[1].y - up },
    { x: c[2].x + side * 0.6, y: c[2].y - up },
    { x: c[3].x - side * 0.6, y: c[3].y - up },
  ]);

  const spanMin = new Int16Array(analysisH).fill(analysisW);
  const spanMax = new Int16Array(analysisH).fill(0);
  for (let y = 0; y < analysisH; y++) {
    const yc = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const x = a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (lo <= hi) {
      spanMin[y] = Math.max(0, Math.floor(lo));
      spanMax[y] = Math.min(analysisW, Math.ceil(hi));
    }
  }

  const rMin = new Float32Array(analysisH);
  const rMax = new Float32Array(analysisH);
  const rTypical = new Float32Array(analysisH);
  for (let y = 0; y < analysisH; y++) {
    let r: number;
    let lo: number, hi: number;
    if (y >= nearRow) {
      r = rNear;
      lo = 0.5 * rNear;
      hi = 1.9 * rNear;
    } else if (y >= farRow) {
      const t = (nearRow - y) / tableH; // 0 perto .. 1 longe
      r = rNear + (rFar - rNear) * t;
      lo = 0.5 * r;
      hi = 1.9 * rNear; // bola alta sobre o lado perto aparece mais acima na imagem
    } else {
      r = rFar;
      lo = 0.5 * rFar;
      hi = 1.9 * rNear;
    }
    rTypical[y] = r;
    rMin[y] = Math.max(0.5, lo);
    rMax[y] = Math.max(2.5, hi);
  }

  return { width: analysisW, height: analysisH, spanMin, spanMax, rMin, rMax, rTypical, maxSpeedPx: MAX_BALL_SPEED_MPS * nearScale * 1.3 };
}
