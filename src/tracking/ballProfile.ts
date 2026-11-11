import { luma } from './classicDetector';

/**
 * "Assinatura" da bola escolhida pelo usuário (tocando nela na imagem):
 * cor média e brilho. O detector passa a aceitar só pixels parecidos com ela.
 */
export interface BallProfile {
  r: number;
  g: number;
  b: number;
  luma: number;
  /** Cromaticidade normalizada (independe do brilho). */
  rn: number;
  gn: number;
  /** Raio medido no toque (px da imagem onde foi amostrada). */
  radiusPx: number;
  imageWidth: number;
  imageHeight: number;
  createdAt: number;
}

export function chroma(r: number, g: number, b: number): [number, number] {
  const s = r + g + b + 1;
  return [r / s, g / s];
}

/**
 * Pixel compatível com a bola escolhida? Tolerante a perda de brilho (borrão
 * de movimento mistura a bola com o fundo), exigente com a cor.
 */
export function matchesProfile(r: number, g: number, b: number, p: BallProfile): boolean {
  const y = luma(r, g, b);
  if (y < p.luma * 0.55 || y > Math.min(255, p.luma * 1.3 + 15)) return false;
  const [rn, gn] = chroma(r, g, b);
  return Math.hypot(rn - p.rn, gn - p.gn) <= 0.055;
}

/**
 * Amostra a bola em volta do toque: procura o pixel mais "bola" (mais claro e
 * destacado do entorno) numa janela, e cresce a região de cor parecida.
 */
export function sampleBall(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  tapX: number,
  tapY: number,
  searchRadius = 14,
  maxRadius = 40,
  now = Date.now(),
): BallProfile | null {
  const at = (x: number, y: number) => (y * w + x) * 4;
  // fundo local: mediana grosseira da luminância num anel maior
  let seed = -1;
  let seedScore = -Infinity;
  const ringLuma: number[] = [];
  const R2 = (searchRadius * 2) ** 2;
  for (let y = Math.max(0, Math.round(tapY - searchRadius * 2)); y < Math.min(h, tapY + searchRadius * 2); y++)
    for (let x = Math.max(0, Math.round(tapX - searchRadius * 2)); x < Math.min(w, tapX + searchRadius * 2); x++) {
      const d2 = (x - tapX) ** 2 + (y - tapY) ** 2;
      if (d2 > R2) continue;
      const j = at(x, y);
      const yv = luma(rgba[j], rgba[j + 1], rgba[j + 2]);
      if (d2 > searchRadius * searchRadius) ringLuma.push(yv);
    }
  ringLuma.sort((a, b) => a - b);
  const bg = ringLuma.length ? ringLuma[ringLuma.length >> 1] : 0;
  for (let y = Math.max(0, Math.round(tapY - searchRadius)); y < Math.min(h, tapY + searchRadius); y++)
    for (let x = Math.max(0, Math.round(tapX - searchRadius)); x < Math.min(w, tapX + searchRadius); x++) {
      const d2 = (x - tapX) ** 2 + (y - tapY) ** 2;
      if (d2 > searchRadius * searchRadius) continue;
      const j = at(x, y);
      const [r, g, b] = [rgba[j], rgba[j + 1], rgba[j + 2]];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      // destaque em relação ao fundo + saturação (bola laranja), penaliza distância do toque
      const score = Math.abs(luma(r, g, b) - bg) + 0.5 * sat - 0.8 * Math.sqrt(d2);
      if (score > seedScore) {
        seedScore = score;
        seed = y * w + x;
      }
    }
  if (seed < 0) return null;
  const sj = seed * 4;
  const seedRGB = [rgba[sj], rgba[sj + 1], rgba[sj + 2]];
  if (Math.abs(luma(seedRGB[0], seedRGB[1], seedRGB[2]) - bg) < 25) return null; // nada se destaca

  // crescimento de região por cor parecida com a semente
  const sx = seed % w, sy = (seed - sx) / w;
  const seen = new Uint8Array(w * h);
  const stack = [seed];
  seen[seed] = 1;
  let n = 0, sr = 0, sg = 0, sb = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    const j = i * 4;
    n++;
    sr += rgba[j];
    sg += rgba[j + 1];
    sb += rgba[j + 2];
    if (n > Math.PI * maxRadius * maxRadius) return null; // grande demais: não é a bola
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if ((nx - sx) ** 2 + (ny - sy) ** 2 > maxRadius * maxRadius) continue;
      const k = ny * w + nx;
      if (seen[k]) continue;
      const kj = k * 4;
      const dist = Math.hypot(rgba[kj] - seedRGB[0], rgba[kj + 1] - seedRGB[1], rgba[kj + 2] - seedRGB[2]);
      if (dist <= 55) {
        seen[k] = 1;
        stack.push(k);
      }
    }
  }
  const r = sr / n, g = sg / n, b = sb / n;
  const [rn, gn] = chroma(r, g, b);
  return {
    r, g, b, luma: luma(r, g, b), rn, gn,
    radiusPx: Math.sqrt(n / Math.PI),
    imageWidth: w,
    imageHeight: h,
    createdAt: now,
  };
}
