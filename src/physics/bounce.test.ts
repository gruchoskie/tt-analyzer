import { describe, expect, it } from 'vitest';
import { computeHomography } from '../calibration/homography';
import { TABLE_CORNERS_M } from '../calibration/table';
import { orderCorners } from '../calibration/calibrate';
import type { Point3 } from '../core/types';
import { BounceDetector, classifyDirection, lateralZone, type BounceEvent } from './bounce';
import { PinholeCamera } from './pinhole';
import { observe, simulateRally, type SimSegment } from './rallySim';

const W = 1280, H = 720;

function setup(camPos: Point3, target: Point3 = { x: 0.76, y: 1.37, z: -0.1 }, hfov = 68) {
  const cam = new PinholeCamera(W, H, camPos, target, hfov);
  const px = TABLE_CORNERS_M.map((p) => cam.project({ x: p.x, y: p.y, z: 0 }));
  const corners = orderCorners(px, W, H);
  const homography = computeHomography(corners, TABLE_CORNERS_M);
  return { cam, homography };
}

// saque do lado "perto", 4 jogadas: cruzada, paralela, meio, cruzada
const RALLY: SimSegment[] = [
  { to: { x: 0.35, y: 0.55 }, flight: 0.3, hit: true }, // saque: 1º quique no próprio lado
  { to: { x: 1.15, y: 2.2 }, flight: 0.35, hit: false }, // 2º quique do saque, lado longe
  { to: { x: 0.3, y: 0.6 }, flight: 0.45, hit: true }, // cruzada (dir → esq)
  { to: { x: 0.25, y: 2.3 }, flight: 0.45, hit: true }, // paralela (esq → esq)
  { to: { x: 0.78, y: 0.7 }, flight: 0.42, hit: true }, // meio
  { to: { x: 1.3, y: 2.1 }, flight: 0.45, hit: true }, // cruzada (meio → dir, deslocamento grande)
];

function run(det: BounceDetector, obs: { t: number; frameIndex: number; x: number; y: number }[]): BounceEvent[] {
  const out: BounceEvent[] = [];
  for (const o of obs) out.push(...det.push(o));
  out.push(...det.flush());
  return out;
}

function matchAll(found: BounceEvent[], truth: { t: number; p: { x: number; y: number } }[], tolM: number) {
  expect(found.length).toBe(truth.length);
  found.forEach((b, i) => {
    const tr = truth[i];
    expect(Math.abs(b.t - tr.t * 1000)).toBeLessThan(25);
    expect(Math.hypot(b.table.x - tr.p.x, b.table.y - tr.p.y)).toBeLessThan(tolM);
  });
}

describe('zonas e direção', () => {
  it('terços da largura', () => {
    expect(lateralZone(0.1)).toBe('esquerda');
    expect(lateralZone(0.76)).toBe('meio');
    expect(lateralZone(1.4)).toBe('direita');
  });
  it('paralela, cruzada e meio', () => {
    expect(classifyDirection({ x: 0.2, y: -0.3 }, { x: 0.3, y: 2.2 })).toBe('paralela');
    expect(classifyDirection({ x: 0.2, y: -0.3 }, { x: 1.3, y: 2.2 })).toBe('cruzada');
    expect(classifyDirection({ x: 1.3, y: 2.9 }, { x: 0.76, y: 0.5 })).toBe('meio');
    // de fora da mesa (raquetada aberta) conta o lado
    expect(classifyDirection({ x: -0.4, y: 3 }, { x: 1.4, y: 0.5 })).toBe('cruzada');
  });
});

describe('quiques a partir do rastro 2D', () => {
  // tolerância de posição: em 30 fps a bola anda ~15-25 cm entre quadros
  const cases: Record<string, { cam: Point3; fps: number; hfov?: number; tol: number }> = {
    'câmera atrás, 60 fps': { cam: { x: 0.76, y: -1.6, z: 1.0 }, fps: 60, tol: 0.08 },
    'câmera atrás, 30 fps': { cam: { x: 0.76, y: -1.6, z: 1.0 }, fps: 30, tol: 0.13 },
    'diagonal, 60 fps': { cam: { x: -1.4, y: -1.2, z: 1.1 }, fps: 60, tol: 0.08 },
    'lateral, 60 fps': { cam: { x: -2.6, y: 1.37, z: 1.0 }, fps: 60, hfov: 75, tol: 0.08 },
  };
  for (const [name, c] of Object.entries(cases))
    it(name, () => {
      const { cam, homography } = setup(c.cam, undefined, c.hfov);
      const sim = simulateRally({ fps: c.fps, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
      const det = new BounceDetector(homography, {}, { width: W, height: H });
      const found = run(det, observe(sim, cam, { noisePx: 0.6 }));
      matchAll(found, sim.bounces, c.tol);
      // raquetadas não viram quique (e algumas são reconhecidas como raquetada)
      expect(det.hits.length).toBeGreaterThanOrEqual(2);
      expect(found.map((b) => b.side)).toEqual(sim.bounces.map((b) => (b.p.y < 1.37 ? 'perto' : 'longe')));
    });

  it('classifica saque e direção das jogadas (câmera atrás)', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 60, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
    const found = run(new BounceDetector(homography, {}, { width: W, height: H }), observe(sim, cam));
    expect(found[0].shot.serve).toBe(true);
    expect(found.slice(2).map((b) => b.shot.direction)).toEqual(['cruzada', 'paralela', 'meio', 'cruzada']);
  });

  it('aguenta quadros perdidos (10%)', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 60, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
    const found = run(new BounceDetector(homography, {}, { width: W, height: H }), observe(sim, cam, { dropRate: 0.1, seed: 5 }));
    // acha todos; com 2 quadros seguidos perdidos bem no quique (lado longe) a posição piora
    expect(found.length).toBe(sim.bounces.length);
    const errs = found.map((b, i) => Math.hypot(b.table.x - sim.bounces[i].p.x, b.table.y - sim.bounces[i].p.y)).sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThan(0.06);
    expect(errs[errs.length - 1]).toBeLessThan(0.4);
  });

  it('áudio confirma o quique e afina o instante; toc solto não cria quique', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 30, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
    const det = new BounceDetector(homography, {}, { width: W, height: H });
    det.setAudioActive(true);
    const onsets = sim.bounces.map((b) => b.t * 1000 + 3);
    onsets.push(sim.hits[1].t * 1000); // raquetada também faz toc
    onsets.push(250); // barulho qualquer
    det.addOnsets(onsets, 1e9);
    const found = run(det, observe(sim, cam));
    expect(found.length).toBe(sim.bounces.length);
    found.forEach((b, i) => {
      expect(b.audio).toBe('confirmado');
      expect(Math.abs(b.t - (sim.bounces[i].t * 1000 + 3))).toBeLessThan(1);
    });
  });

  it('sem toc perto do quique: marca "sem som"', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 60, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY.slice(0, 2) });
    const det = new BounceDetector(homography, {}, { width: W, height: H });
    det.setAudioActive(true);
    det.addOnsets([], 1e9);
    const found = run(det, observe(sim, cam));
    expect(found.map((b) => b.audio)).toEqual(['sem-som', 'sem-som']);
  });
});
