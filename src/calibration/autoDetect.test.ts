import { describe, expect, it } from 'vitest';
import type { Point2 } from '../core/types';
import { detectTable, isTableDetection, rgbToHsv } from './autoDetect';
import { renderTableScene, type TableSceneOptions } from './tableScene';

const W = 320;
const H = 180;
const CORNERS: Point2[] = [
  { x: 60, y: 160 },
  { x: 260, y: 160 },
  { x: 205, y: 65 },
  { x: 115, y: 65 },
];

function inside(q: Point2[], x: number, y: number) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s = Math.sign(c);
    if (!s) continue;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function edgeDist(q: Point2[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    best = Math.min(best, Math.abs((b.x - a.x) * (a.y - y) - (a.x - x) * (b.y - a.y)) / len);
  }
  return best;
}

function scene(opts: { table: [number, number, number]; player?: boolean; noise?: number }) {
  const d = new Uint8ClampedArray(W * H * 4);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: [number, number, number] = [60, 55, 50]; // chão/parede
      if (inside(CORNERS, x + 0.5, y + 0.5)) {
        c = opts.table;
        // linha central e bordas brancas, rede
        if (Math.abs(x - 160) < 1 || Math.abs(y - 105) < 1.5) c = [235, 235, 235];
        // faixa branca da borda (toda mesa oficial tem)
        if (edgeDist(CORNERS, x + 0.5, y + 0.5) < 1.6) c = [235, 235, 235];
      }
      if (opts.player && x > 250 && x < 300 && y > 20 && y < 120) c = [30, 40, 150]; // camisa azul fora da mesa
      const j = (y * W + x) * 4;
      const n = (opts.noise ?? 0) * rnd();
      d[j] = c[0] + n;
      d[j + 1] = c[1] + n;
      d[j + 2] = c[2] + n;
      d[j + 3] = 255;
    }
  return d;
}

function maxCornerErr(found: Point2[]) {
  return Math.max(...found.map((p, i) => Math.hypot(p.x - CORNERS[i].x, p.y - CORNERS[i].y)));
}

describe('detecção automática da mesa', () => {
  it('HSV', () => {
    expect(rgbToHsv(0, 0, 255)[0]).toBeCloseTo(240);
    expect(rgbToHsv(0, 255, 0)[0]).toBeCloseTo(120);
  });

  it('acha os 4 cantos de mesa azul com linhas brancas e rede', () => {
    const r = detectTable(scene({ table: [20, 60, 140], noise: 8 }), W, H);
    expect(isTableDetection(r)).toBe(true);
    if (!isTableDetection(r)) return;
    expect(maxCornerErr(r.corners)).toBeLessThan(3);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('mesa verde', () => {
    const r = detectTable(scene({ table: [25, 100, 60], noise: 8 }), W, H);
    expect(isTableDetection(r) && maxCornerErr(r.corners)).toBeLessThan(3);
  });

  it('ignora outra região azul menor (camisa) ao lado', () => {
    const r = detectTable(scene({ table: [20, 60, 140], player: true, noise: 6 }), W, H);
    expect(isTableDetection(r) && maxCornerErr(r.corners)).toBeLessThan(3);
  });

  it('falha com mensagem quando não há mesa', () => {
    const d = new Uint8ClampedArray(W * H * 4).fill(90);
    const r = detectTable(d, W, H);
    expect(isTableDetection(r)).toBe(false);
    expect((r as { reason: string }).reason).toBe('sem-cor');
  });

  describe('cenas realistas (câmera atrás do fundo, perspectiva, rede, linhas brancas)', () => {
    const W2 = 400, H2 = 225;
    const cam = (x: number, y: number, z: number) => ({ x, y, z });
    const std = { cam: cam(0.76, -1.3, 1.0), target: cam(0.76, 1.37, -0.2) };
    const cases: Record<string, Partial<TableSceneOptions>> = {
      padrão: std,
      'câmera alta': { cam: cam(0.76, -1.0, 1.5), target: cam(0.76, 1.3, -0.4) },
      'de lado e torta': { cam: cam(0.35, -1.3, 1.0), target: cam(0.85, 1.4, -0.2), rollDeg: 3 },
      'jogador de camisa azul': { ...std, player: { x: 0.9, shirt: [30, 60, 160] } },
      'chão vermelho e parede azul': { ...std, floor: [150, 45, 45], wall: [40, 50, 90] },
      'reflexo de luz': { ...std, glare: { x: 0.9, y: 0.9, r: 0.35 } },
      'fundo mais escuro e ruído': { ...std, farLight: 0.5, noise: 12 },
      'mesa verde': { ...std, table: [30, 95, 60], floor: [90, 120, 80] },
      'barreira e painel azuis': { ...std, barrier: [10, 90, 200], wallArc: [60, 140, 220] },
    };
    for (const [name, c] of Object.entries(cases))
      it(name, () => {
        const sc = renderTableScene({ width: W2, height: H2, noise: 6, blur: true, ...c });
        const r = detectTable(sc.rgba, W2, H2);
        expect(isTableDetection(r)).toBe(true);
        if (!isTableDetection(r)) return;
        const err = Math.max(...r.corners.map((p, i) => Math.hypot(p.x - sc.corners[i].x, p.y - sc.corners[i].y)));
        expect(err).toBeLessThan(4);
        expect(r.outside).toEqual([]);
      });

    it('mesa cortada no canto de baixo: estima o canto fora do quadro pelas bordas', () => {
      // como no teste real: mesa clara, barreira azul ao lado, arco azul na parede,
      // cantos de perto saindo do quadro
      const sc = renderTableScene({
        width: W2, height: H2, noise: 6, blur: true,
        cam: cam(0.9, -0.75, 0.75), target: cam(0.75, 1.6, -0.25), hfovDeg: 70,
        table: [95, 150, 180], floor: [150, 142, 128], wall: [45, 45, 50], barrier: [10, 90, 200], wallArc: [60, 140, 220],
      });
      const r = detectTable(sc.rgba, W2, H2);
      expect(isTableDetection(r)).toBe(true);
      if (!isTableDetection(r)) return;
      expect(r.outside.length).toBeGreaterThan(0);
      r.corners.forEach((p, i) => {
        const e = Math.hypot(p.x - sc.corners[i].x, p.y - sc.corners[i].y);
        expect(e).toBeLessThan(r.outside.includes(i) ? 8 : 4);
      });
    });

    it('sem a borda de perto no quadro: recusa em vez de inventar', () => {
      const sc = renderTableScene({ width: W2, height: H2, noise: 6, blur: true, cam: cam(0.76, -0.7, 0.8), target: cam(0.76, 1.6, -0.3) });
      const r = detectTable(sc.rgba, W2, H2);
      expect(isTableDetection(r)).toBe(false);
      expect((r as { reason: string }).reason).toBe('cortada');
    });
  });

  describe('qualquer ângulo de câmera (diagonal e lateral)', () => {
    const W2 = 400, H2 = 225;
    const cam = (x: number, y: number, z: number) => ({ x, y, z });
    const C = cam(0.76, 1.37, -0.1);
    const cases: Record<string, Partial<TableSceneOptions>> = {
      'diagonal pela esquerda': { cam: cam(-1.3, -1.2, 1.0), target: C },
      'diagonal pela direita, torta': { cam: cam(2.8, -1.0, 0.9), target: C, rollDeg: -2 },
      'lateral, na altura da rede': { cam: cam(-2.4, 1.37, 1.0), target: C, hfovDeg: 75 },
      'lateral, deslocada': { cam: cam(-2.2, 0.6, 1.1), target: C, hfovDeg: 75 },
      'lateral pelo outro lado': { cam: cam(3.8, 1.8, 1.0), target: C, hfovDeg: 75 },
    };
    for (const [name, c] of Object.entries(cases))
      it(name, () => {
        const sc = renderTableScene({ width: W2, height: H2, noise: 6, blur: true, ...c });
        const r = detectTable(sc.rgba, W2, H2);
        expect(isTableDetection(r)).toBe(true);
        if (!isTableDetection(r)) return;
        // De lado, qual cabeceira é "perto" é convenção (a mais baixa na imagem):
        // aceita a mesa girada 180°, mas nunca trocar cabeceira por lateral.
        const err = (shift: number) =>
          Math.max(...r.corners.map((p, i) => Math.hypot(p.x - sc.corners[(i + shift) % 4].x, p.y - sc.corners[(i + shift) % 4].y)));
        expect(Math.min(err(0), err(2))).toBeLessThan(6);
      });
  });

  describe('toque no tampo (ginásio com mesa cinza no chão da mesma cor)', () => {
    const W2 = 400, H2 = 225;
    const cam = (x: number, y: number, z: number) => ({ x, y, z });
    const gym: Partial<TableSceneOptions> = {
      table: [112, 122, 125],
      floor: [106, 124, 136],
      wall: [40, 40, 45],
      barrier: [10, 90, 200],
    };
    const cases: Record<string, Partial<TableSceneOptions>> = {
      'atrás da mesa': { ...gym, cam: cam(0.76, -1.3, 1.0), target: cam(0.76, 1.37, -0.2) },
      diagonal: { ...gym, cam: cam(-1.3, -1.2, 1.0), target: cam(0.76, 1.37, -0.1) },
      'com reflexo': { ...gym, cam: cam(0.76, -1.3, 1.0), target: cam(0.76, 1.37, -0.2), glare: { x: 0.9, y: 0.9, r: 0.35 } },
    };
    for (const [name, c] of Object.entries(cases))
      it(name, () => {
        const sc = renderTableScene({ width: W2, height: H2, noise: 6, blur: true, ...c });
        const q = sc.corners;
        // toque num ponto do tampo (entre o centro e o canto de perto, longe da rede)
        const seed = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4 * 0.6 + (q[0].x + q[1].x) / 2 * 0.4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 * 0.6 + (q[0].y + q[1].y) / 2 * 0.4 };
        const r = detectTable(sc.rgba, W2, H2, { seed });
        expect(isTableDetection(r)).toBe(true);
        if (!isTableDetection(r)) return;
        const err = (shift: number) => Math.max(...r.corners.map((p, i) => Math.hypot(p.x - q[(i + shift) % 4].x, p.y - q[(i + shift) % 4].y)));
        // é o ponto de partida: o usuário confere com a lupa (3% da largura)
        expect(Math.min(err(0), err(2))).toBeLessThan(14);
      });

    it('sem toque, não confunde o chão azulado com a mesa', () => {
      const sc = renderTableScene({ width: W2, height: H2, noise: 6, blur: true, ...gym, cam: cam(0.76, -1.3, 1.0), target: cam(0.76, 1.37, -0.2) });
      const r = detectTable(sc.rgba, W2, H2);
      if (isTableDetection(r)) {
        const q = sc.corners;
        const err = Math.max(...r.corners.map((p, i) => Math.hypot(p.x - q[i].x, p.y - q[i].y)));
        expect(err).toBeLessThan(6);
      }
    });
  });
});
