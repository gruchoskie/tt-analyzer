import type { Point2 } from '../core/types';
import { TABLE_LENGTH_M, TABLE_WIDTH_M } from '../physics/constants';

/**
 * Cena sintética "realista" de uma mesa vista por uma câmera atrás do fundo,
 * renderizada por traçado de raios (câmera pinhole). Usada só nos testes do
 * detector automático da mesa: perspectiva forte, linhas brancas, rede com
 * postes, faces laterais do tampo, chão/parede, jogador, reflexo, luz desigual.
 *
 * Referencial: x = largura (0..1,525), y = comprimento (0..2,74), z para cima
 * a partir do tampo.
 */

type RGB = [number, number, number];

export interface TableSceneOptions {
  width: number;
  height: number;
  /** Posição da câmera (m) no referencial da mesa. */
  cam?: { x: number; y: number; z: number };
  /** Ponto para onde a câmera olha. */
  target?: { x: number; y: number; z: number };
  /** Campo de visão horizontal em graus. */
  hfovDeg?: number;
  /** Rolagem da câmera (graus): celular um pouco torto no tripé. */
  rollDeg?: number;
  table?: RGB;
  floor?: RGB;
  wall?: RGB;
  /** Jogador do outro lado, atrás do fundo da mesa. */
  player?: { x: number; shirt: RGB } | null;
  /** Divisória (barreira) colorida ao lado esquerdo da mesa. */
  barrier?: RGB | null;
  /** Arco colorido pintado na parede do fundo. */
  wallArc?: RGB | null;
  /** Reflexo de luz no tampo (centro em metros e raio). */
  glare?: { x: number; y: number; r: number } | null;
  /** Fator de luz no fundo da mesa (1 = igual à frente). */
  farLight?: number;
  noise?: number;
  blur?: boolean;
  seed?: number;
}

const LINE = 0.02;
const CENTER_LINE = 0.003;
const TOP_THICK = 0.025;
const NET_H = 0.1525;
const NET_OVERHANG = 0.1525;

export interface RenderedTable {
  rgba: Uint8ClampedArray;
  /** Cantos externos reais (perto-esq, perto-dir, longe-dir, longe-esq) em px. */
  corners: [Point2, Point2, Point2, Point2];
}

export function renderTableScene(o: TableSceneOptions): RenderedTable {
  const W = o.width;
  const H = o.height;
  const cam = o.cam ?? { x: TABLE_WIDTH_M / 2, y: -1.6, z: 0.75 };
  const tgt = o.target ?? { x: TABLE_WIDTH_M / 2, y: 1.6, z: -0.25 };
  const f = W / 2 / Math.tan(((o.hfovDeg ?? 68) * Math.PI) / 360);
  const table: RGB = o.table ?? [24, 62, 128];
  const floor: RGB = o.floor ?? [120, 110, 100];
  const wall: RGB = o.wall ?? [175, 170, 160];
  const farLight = o.farLight ?? 1;

  // base da câmera: fw (frente), rt (direita), up
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const norm = (a: number[]) => {
    const l = Math.hypot(...a);
    return a.map((v) => v / l);
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const C = [cam.x, cam.y, cam.z];
  const fw = norm(sub([tgt.x, tgt.y, tgt.z], C));
  let rt = norm(cross(fw, [0, 0, 1]));
  let up = cross(rt, fw);
  const roll = ((o.rollDeg ?? 0) * Math.PI) / 180;
  if (roll) {
    const r2 = rt.map((v, i) => Math.cos(roll) * v + Math.sin(roll) * up[i]);
    const u2 = up.map((v, i) => -Math.sin(roll) * rt[i] + Math.cos(roll) * v);
    rt = r2;
    up = u2;
  }

  const project = (p: number[]): Point2 => {
    const d = sub(p, C);
    const zc = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    const xc = d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2];
    const yc = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return { x: W / 2 + (f * xc) / zc, y: H / 2 - (f * yc) / zc };
  };

  let seed = o.seed ?? 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;

  const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
  const tableColorAt = (x: number, y: number): RGB => {
    const k = 1 - (1 - farLight) * (y / TABLE_LENGTH_M);
    const white =
      x < LINE || x > TABLE_WIDTH_M - LINE || y < LINE || y > TABLE_LENGTH_M - LINE || Math.abs(x - TABLE_WIDTH_M / 2) < CENTER_LINE / 2;
    let c: RGB = white ? [230, 230, 228] : table;
    c = shade(c, k);
    if (o.glare) {
      const g = Math.exp(-((x - o.glare.x) ** 2 + (y - o.glare.y) ** 2) / (o.glare.r * o.glare.r));
      c = [c[0] + (250 - c[0]) * g, c[1] + (250 - c[1]) * g, c[2] + (250 - c[2]) * g];
    }
    return c;
  };

  const raw = new Float32Array(W * H * 3);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const sx = (px + 0.5 - W / 2) / f;
      const sy = -(py + 0.5 - H / 2) / f;
      const d = [0, 1, 2].map((i) => fw[i] + sx * rt[i] + sy * up[i]);
      let best = Infinity;
      let col: RGB = wall;
      const hit = (t: number, c: RGB) => {
        if (t > 1e-6 && t < best) {
          best = t;
          col = c;
        }
      };
      // parede ao fundo (y = 7) e chão (z = -0,76)
      if (d[1] > 0) {
        const t = (7 - C[1]) / d[1];
        const x = C[0] + t * d[0], z = C[2] + t * d[2];
        const rr = Math.hypot(x - 1.2, z - 0.6);
        hit(t, o.wallArc && rr > 1.1 && rr < 1.4 && x < 1.6 ? o.wallArc : wall);
      }
      if (o.barrier && d[0] < 0) {
        const t = (-0.9 - C[0]) / d[0];
        const y = C[1] + t * d[1], z = C[2] + t * d[2];
        if (y > -0.8 && y < 2.2 && z > -0.76 && z < -0.1) hit(t, o.barrier);
      }
      if (d[2] < 0) {
        const t = (-0.76 - C[2]) / d[2];
        const x = C[0] + t * d[0], y = C[1] + t * d[1];
        // sombra/estrutura escura debaixo da mesa
        const under = x > 0.1 && x < TABLE_WIDTH_M - 0.1 && y > 0.1 && y < TABLE_LENGTH_M - 0.1;
        hit(t, under ? shade(floor, 0.45) : floor);
      }
      // tampo (z = 0)
      if (d[2] < 0) {
        const t = -C[2] / d[2];
        const x = C[0] + t * d[0], y = C[1] + t * d[1];
        if (x >= 0 && x <= TABLE_WIDTH_M && y >= 0 && y <= TABLE_LENGTH_M) hit(t, tableColorAt(x, y));
      }
      // face lateral perto (y = 0) e laterais (x = 0, x = W): borda do tampo, cor da mesa escurecida
      if (d[1] !== 0) {
        const t = (0 - C[1]) / d[1];
        const x = C[0] + t * d[0], z = C[2] + t * d[2];
        if (x >= 0 && x <= TABLE_WIDTH_M && z <= 0 && z >= -TOP_THICK) hit(t, shade(table, 0.6));
      }
      for (const xs of [0, TABLE_WIDTH_M])
        if (d[0] !== 0) {
          const t = (xs - C[0]) / d[0];
          const y = C[1] + t * d[1], z = C[2] + t * d[2];
          if (y >= 0 && y <= TABLE_LENGTH_M && z <= 0 && z >= -TOP_THICK) hit(t, shade(table, 0.5));
        }
      // pernas (finas, escuras) nos cantos
      // rede (y = 1,37): malha escura semitransparente, fita branca no topo, postes
      if (d[1] !== 0) {
        const t = (TABLE_LENGTH_M / 2 - C[1]) / d[1];
        const x = C[0] + t * d[0], z = C[2] + t * d[2];
        if (x >= -NET_OVERHANG && x <= TABLE_WIDTH_M + NET_OVERHANG && z >= 0 && z <= NET_H && t < best) {
          const post = x < -NET_OVERHANG + 0.03 || x > TABLE_WIDTH_M + NET_OVERHANG - 0.03;
          if (post || z > NET_H - 0.015) hit(t, post ? [30, 30, 30] : [235, 235, 235]);
          else {
            // malha: mistura 55% preto com o que está atrás
            const tz = -C[2] / d[2];
            const bx = C[0] + tz * d[0], by = C[1] + tz * d[1];
            const behind = bx >= 0 && bx <= TABLE_WIDTH_M && by >= 0 && by <= TABLE_LENGTH_M ? tableColorAt(bx, by) : floor;
            hit(t, shade(behind, 0.45));
          }
        }
      }
      // jogador atrás do fundo (caixa simplificada: tronco e pernas)
      if (o.player && d[1] > 0) {
        const t = (TABLE_LENGTH_M + 0.6 - C[1]) / d[1];
        const x = C[0] + t * d[0], z = C[2] + t * d[2];
        if (Math.abs(x - o.player.x) < 0.22 && z > 0.05 && z < 0.75) hit(t, o.player.shirt);
        else if (Math.abs(x - o.player.x) < 0.18 && z <= 0.05 && z > -0.76) hit(t, [35, 35, 40]);
        else if (Math.abs(x - o.player.x) < 0.1 && z >= 0.75 && z < 0.98) hit(t, [190, 150, 120]);
      }
      const n = (o.noise ?? 0) * rnd();
      const j = (py * W + px) * 3;
      raw[j] = col[0] + n;
      raw[j + 1] = col[1] + n;
      raw[j + 2] = col[2] + n;
    }

  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      for (let c = 0; c < 3; c++) {
        let v: number;
        if (o.blur) {
          let s = 0, k = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const yy = py + dy, xx = px + dx;
              if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
              s += raw[(yy * W + xx) * 3 + c];
              k++;
            }
          v = s / k;
        } else v = raw[(py * W + px) * 3 + c];
        rgba[(py * W + px) * 4 + c] = v;
      }
      rgba[(py * W + px) * 4 + 3] = 255;
    }

  const corners = [
    project([0, 0, 0]),
    project([TABLE_WIDTH_M, 0, 0]),
    project([TABLE_WIDTH_M, TABLE_LENGTH_M, 0]),
    project([0, TABLE_LENGTH_M, 0]),
  ] as [Point2, Point2, Point2, Point2];
  return { rgba, corners };
}
