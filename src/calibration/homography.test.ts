import { describe, expect, it } from 'vitest';
import type { Point2 } from '../core/types';
import { applyHomography, computeHomography, invertHomography, reprojectionError } from './homography';
import { mat3Det, mat3Inverse, mat3Mul, solveLinear } from './linalg';

/** Câmera pinhole sintética olhando a mesa de cima/atrás: gera a "verdade" para os testes. */
function syntheticH(): number[] {
  // mesa (m) -> imagem (px)
  return [420, 60, 380, -10, -150, 650, 0.02, 0.35, 1];
}

describe('álgebra linear', () => {
  it('resolve sistema com pivotamento', () => {
    const x = solveLinear(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 0],
      ],
      [7, 6, 4],
    );
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
    expect(x[2]).toBeCloseTo(3);
  });

  it('detecta sistema singular', () => {
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/);
  });

  it('inversa 3x3', () => {
    const m = [2, 0, 1, 1, 3, 2, 1, 1, 2];
    const id = mat3Mul(m, mat3Inverse(m));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(id[i]).toBeCloseTo(v));
    expect(mat3Det(m)).toBeCloseTo(6);
  });
});

describe('homografia', () => {
  const truth = syntheticH();
  const table: Point2[] = [
    { x: 0, y: 0 },
    { x: 1.525, y: 0 },
    { x: 1.525, y: 2.74 },
    { x: 0, y: 2.74 },
  ];
  const img = table.map((p) => applyHomography(truth, p));

  it('recupera a homografia exata com 4 pontos', () => {
    const H = computeHomography(table, img);
    truth.forEach((v, i) => expect(H[i]).toBeCloseTo(v, 6));
    expect(reprojectionError(H, table, img)).toBeLessThan(1e-6);
  });

  it('imagem -> mesa leva pontos internos ao lugar certo (rede, centro)', () => {
    const H = computeHomography(img, table);
    for (const p of [
      { x: 0.7625, y: 1.37 },
      { x: 0.2, y: 2.5 },
      { x: 1.4, y: 0.1 },
    ]) {
      const q = applyHomography(H, applyHomography(truth, p));
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
    }
  });

  it('inversa leva de volta', () => {
    const H = computeHomography(img, table);
    const Hi = invertHomography(H);
    const p = { x: 512, y: 300 };
    const q = applyHomography(Hi, applyHomography(H, p));
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.y).toBeCloseTo(p.y, 6);
  });

  it('mínimos quadrados com pontos extras e ruído', () => {
    const many: Point2[] = [];
    for (let x = 0; x <= 1.525; x += 0.305) for (let y = 0; y <= 2.74; y += 0.548) many.push({ x, y });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const noisy = many.map((p) => {
      const q = applyHomography(truth, p);
      return { x: q.x + rnd() * 0.5, y: q.y + rnd() * 0.5 };
    });
    const H = computeHomography(noisy, many);
    const err = reprojectionError(H, noisy, many);
    expect(err).toBeLessThan(0.01); // < 1 cm com ±0,5 px de ruído
  });

  it('rejeita pontos degenerados', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => computeHomography(line, table)).toThrow();
    expect(() => computeHomography(table.slice(0, 3), table.slice(0, 3))).toThrow(/4 pontos/);
  });
});
