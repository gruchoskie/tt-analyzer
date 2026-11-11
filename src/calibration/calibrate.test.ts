import { describe, expect, it } from 'vitest';
import { applyHomography } from './homography';
import { checkCorners, createCalibration, imageToTable, isConvexQuad, orderCorners, rescaleCalibration, tableToImageMatrix, type Quad } from './calibrate';
import { CENTER_LINE_X_M, NET_Y_M, TABLE_CORNERS_M, isOnTable, tableSegments, tableSide } from './table';
import { containTransform, elementToVideo, videoToElement } from './viewport';

// Mesa vista de trás, em 1280x720: trapézio (perto largo embaixo, longe estreito em cima).
const corners: Quad = [
  { x: 240, y: 650 },
  { x: 1040, y: 650 },
  { x: 820, y: 260 },
  { x: 460, y: 260 },
];

describe('calibração da mesa', () => {
  it('cantos viram as medidas oficiais em metros', () => {
    const cal = createCalibration('cam', corners, 1280, 720, 0);
    corners.forEach((c, i) => {
      const p = imageToTable(cal, c);
      expect(p.x).toBeCloseTo(TABLE_CORNERS_M[i].x, 6);
      expect(p.y).toBeCloseTo(TABLE_CORNERS_M[i].y, 6);
    });
  });

  it('centro da mesa fica no cruzamento das diagonais (perspectiva correta)', () => {
    const cal = createCalibration('cam', corners, 1280, 720, 0);
    const center = applyHomography(tableToImageMatrix(cal), { x: CENTER_LINE_X_M, y: NET_Y_M });
    // interseção das diagonais (0-2) e (1-3)
    const [a, b, c, d] = corners;
    const t = ((d.x - b.x) * (b.y - a.y) - (d.y - b.y) * (b.x - a.x)) / ((d.x - b.x) * (c.y - a.y) - (d.y - b.y) * (c.x - a.x));
    const ix = a.x + t * (c.x - a.x);
    const iy = a.y + t * (c.y - a.y);
    expect(center.x).toBeCloseTo(ix, 4);
    expect(center.y).toBeCloseTo(iy, 4);
    // e a rede aparece acima do meio vertical do trapézio (perspectiva)
    expect(center.y).toBeLessThan((650 + 260) / 2);
  });

  it('ordena toques em qualquer ordem', () => {
    const shuffled = [corners[2], corners[0], corners[3], corners[1]];
    expect(orderCorners(shuffled)).toEqual(corners);
  });

  it('valida quadriláteros', () => {
    expect(isConvexQuad(corners)).toBe(true);
    const crossed: Quad = [corners[0], corners[2], corners[1], corners[3]];
    expect(isConvexQuad(crossed)).toBe(false);
    expect(checkCorners(corners, 1280, 720)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(checkCorners(crossed, 1280, 720).ok).toBe(false);
  });

  it('avisa mesa pequena, ordem trocada e cantos fora da imagem', () => {
    const tiny: Quad = [
      { x: 600, y: 400 },
      { x: 640, y: 400 },
      { x: 635, y: 390 },
      { x: 605, y: 390 },
    ];
    expect(checkCorners(tiny, 1280, 720).errors[0]).toMatch(/muito pequena/);
    const flipped: Quad = [corners[3], corners[2], corners[1], corners[0]];
    expect(checkCorners(flipped, 1280, 720).warnings.length).toBeGreaterThan(0);
    const out: Quad = [{ x: -50, y: 700 }, corners[1], corners[2], corners[3]];
    expect(checkCorners(out, 1280, 720).errors.some((e) => /fora da imagem/.test(e))).toBe(true);
  });

  it('reescala para outra resolução de mesma proporção', () => {
    const cal = createCalibration('cam', corners, 1280, 720, 0);
    const half = rescaleCalibration(cal, 640, 360)!;
    const p = imageToTable(half, { x: 320, y: 325 });
    const q = imageToTable(cal, { x: 640, y: 650 });
    expect(p.x).toBeCloseTo(q.x, 6);
    expect(p.y).toBeCloseTo(q.y, 6);
    expect(rescaleCalibration(cal, 640, 480)).toBeNull();
    expect(rescaleCalibration(cal, 1280, 720)).toBe(cal);
  });
});

describe('geometria da mesa', () => {
  it('lados e limites', () => {
    expect(tableSide({ x: 0.5, y: 0.5 })).toBe('perto');
    expect(tableSide({ x: 0.5, y: 2 })).toBe('longe');
    expect(isOnTable({ x: 1.6, y: 1 })).toBe(false);
    expect(isOnTable({ x: 1.6, y: 1 }, 0.1)).toBe(true);
  });

  it('segmentos para desenhar', () => {
    const segs = tableSegments(0.5);
    expect(segs.filter((s) => s.kind === 'border')).toHaveLength(4);
    expect(segs.filter((s) => s.kind === 'net')).toHaveLength(1);
    // grade: x = 0.5, 1.0, 1.5 e y = 0.5..2.5
    expect(segs.filter((s) => s.kind === 'grid')).toHaveLength(3 + 5);
  });
});

describe('encaixe do vídeo na tela (object-fit: contain)', () => {
  it('faixas laterais quando a tela é mais larga', () => {
    const t = containTransform(1280, 720, 2000, 900);
    expect(t.scale).toBeCloseTo(1.25);
    expect(t.offsetX).toBeCloseTo(200);
    expect(t.offsetY).toBe(0);
    const p = { x: 100, y: 200 };
    const q = elementToVideo(t, videoToElement(t, p));
    expect(q.x).toBeCloseTo(100);
    expect(q.y).toBeCloseTo(200);
  });
});
