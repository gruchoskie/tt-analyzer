import { describe, expect, it } from 'vitest';
import { computeHomography } from '../calibration/homography';
import { TABLE_CORNERS_M } from '../calibration/table';
import { estimateCamera, orderCorners } from '../calibration/calibrate';
import type { Point3 } from '../core/types';
import { fitBallistic, project } from './ballistic';
import { BounceDetector, type BounceEvent } from './bounce';
import { GRAVITY_M_S2 } from './constants';
import { PinholeCamera } from './pinhole';
import { observe, simulateRally, type SimResult, type SimSegment } from './rallySim';
import { segmentSpeed } from './speed';

const W = 1280, H = 720;

function setup(camPos: Point3, hfov = 68) {
  const cam = new PinholeCamera(W, H, camPos, { x: 0.76, y: 1.37, z: -0.1 }, hfov);
  const px = TABLE_CORNERS_M.map((p) => cam.project({ x: p.x, y: p.y, z: 0 }));
  const corners = orderCorners(px, W, H);
  return { cam, corners, homography: computeHomography(corners, TABLE_CORNERS_M) };
}

const RALLY: SimSegment[] = [
  { to: { x: 0.35, y: 0.55 }, flight: 0.3, hit: true },
  { to: { x: 1.15, y: 2.2 }, flight: 0.35, hit: false },
  { to: { x: 0.3, y: 0.6 }, flight: 0.45, hit: true },
  { to: { x: 0.25, y: 2.3 }, flight: 0.45, hit: true },
  { to: { x: 0.78, y: 0.7 }, flight: 0.42, hit: true },
  { to: { x: 1.3, y: 2.1 }, flight: 0.33, hit: true }, // a mais rápida
];

/** Velocidade média verdadeira (km/h) entre dois instantes (ms). */
function trueAvgKmh(sim: SimResult, t0: number, t1: number): number {
  const at = (tms: number) => {
    const t = Math.max(0, tms / 1000);
    const a = sim.arcs.find((r) => t >= r.t0 && t < r.t1) ?? sim.arcs[sim.arcs.length - 1];
    const d = t - a.t0;
    return { x: a.p0.x + a.v0.x * d, y: a.p0.y + a.v0.y * d, z: a.p0.z + a.v0.z * d - (GRAVITY_M_S2 * d * d) / 2 };
  };
  let len = 0, prev = at(t0);
  for (let k = 1; k <= 200; k++) {
    const p = at(t0 + ((t1 - t0) * k) / 200);
    len += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    prev = p;
  }
  return (len / ((t1 - t0) / 1000)) * 3.6;
}

function run(det: BounceDetector, obs: { t: number; frameIndex: number; x: number; y: number }[]): BounceEvent[] {
  const out: BounceEvent[] = [];
  for (const o of obs) out.push(...det.push(o));
  out.push(...det.flush());
  return out;
}

describe('câmera estimada pela calibração', () => {
  it('projeta pontos acima da mesa como a câmera real', () => {
    for (const pos of [{ x: 0.76, y: -1.6, z: 1.0 }, { x: -1.4, y: -1.2, z: 1.1 }, { x: -2.6, y: 1.37, z: 1.0 }]) {
      const { cam, corners } = setup(pos, pos.x < -2 ? 75 : 68);
      const est = estimateCamera(corners, W, H)!;
      for (const p of [{ x: 0.3, y: 0.5, z: 0.3 }, { x: 1.2, y: 2.4, z: 0.5 }, { x: 0.76, y: 1.37, z: 0.15 }]) {
        const a = cam.project(p), b = project(est.P, p);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3);
      }
    }
  });
});

describe('parábola a partir de 1 câmera', () => {
  it('recupera a velocidade de um voo limpo', () => {
    const { cam, corners } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const P = estimateCamera(corners, W, H)!.P;
    const p0 = { x: 0.4, y: 0.2, z: 0.3 }, v0 = { x: 1.5, y: 7, z: 1.2 };
    const pos = (s: number) => ({ x: p0.x + v0.x * s, y: p0.y + v0.y * s, z: p0.z + v0.z * s - (GRAVITY_M_S2 * s * s) / 2 });
    const pts = [];
    for (let k = 0; k < 18; k++) {
      const q = cam.project(pos(k / 60));
      pts.push({ t: (k * 1000) / 60, x: q.x, y: q.y });
    }
    const f = fitBallistic(pts, P, 0)!;
    expect(f.rmsPx).toBeLessThan(1);
    expect(Math.hypot(f.v0.x - v0.x, f.v0.y - v0.y, f.v0.z - v0.z)).toBeLessThan(0.4);
  });

  it('entre dois quiques sem câmera: distância na mesa / tempo', () => {
    const s = segmentSpeed([], { kind: 'quique', fromT: 0, fromTable: { x: 0.5, y: 0.5 }, to: { t: 300, table: { x: 0.5, y: 2.3 }, tErrMs: 8 }, frameMs: 16.7 }, null)!;
    expect(s.method).toBe('plano');
    expect(s.avgKmh).toBeCloseTo((1.8 / 0.3) * 3.6, 5);
    expect(s.errKmh).toBeGreaterThan(0.5);
  });
});

describe('velocidade por jogada no rally', () => {
  const cases: Record<string, { cam: Point3; fps: number; hfov?: number; tol: number }> = {
    'atrás, 60 fps': { cam: { x: 0.76, y: -1.6, z: 1.0 }, fps: 60, tol: 0.08 },
    'atrás, 30 fps': { cam: { x: 0.76, y: -1.6, z: 1.0 }, fps: 30, tol: 0.12 },
    'diagonal, 60 fps': { cam: { x: -1.4, y: -1.2, z: 1.1 }, fps: 60, tol: 0.08 },
    'lateral, 60 fps': { cam: { x: -2.6, y: 1.37, z: 1.0 }, fps: 60, hfov: 75, tol: 0.1 },
  };
  for (const [name, c] of Object.entries(cases))
    it(name, () => {
      const { cam, homography } = setup(c.cam, c.hfov);
      const sim = simulateRally({ fps: c.fps, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
      const found = run(new BounceDetector(homography, {}, { width: W, height: H }), observe(sim, cam, { noisePx: 0.6 }));
      expect(found.length).toBe(sim.bounces.length);
      const withSpeed = found.filter((b) => b.speed);
      expect(withSpeed.length).toBeGreaterThanOrEqual(found.length - 1);
      let inside = 0;
      for (const b of withSpeed) {
        const s = b.speed!;
        const truth = trueAvgKmh(sim, s.fromT, s.toT);
        expect(Math.abs(s.avgKmh - truth) / truth).toBeLessThan(c.tol);
        if (Math.abs(s.avgKmh - truth) <= s.errKmh) inside++;
        expect(s.errKmh).toBeGreaterThan(0);
        expect(s.errKmh / s.avgKmh).toBeLessThan(0.3);
      }
      // a margem cobre a verdade na maioria das jogadas
      expect(inside / withSpeed.length).toBeGreaterThanOrEqual(0.6);
      // a jogada mais rápida é reconhecida como a mais rápida
      const fastest = withSpeed.reduce((a, b) => (b.speed!.avgKmh > a.speed!.avgKmh ? b : a));
      expect(fastest.t).toBeCloseTo(sim.bounces[5].t * 1000, -2);
    });

  it('com 10% dos quadros perdidos e ruído maior, a mediana do erro fica baixa', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 60, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
    const found = run(new BounceDetector(homography, {}, { width: W, height: H }), observe(sim, cam, { dropRate: 0.1, noisePx: 1.2, seed: 5 }));
    const errs = found.filter((b) => b.speed).map((b) => Math.abs(b.speed!.avgKmh - trueAvgKmh(sim, b.speed!.fromT, b.speed!.toT)) / b.speed!.avgKmh);
    expect(errs.length).toBeGreaterThanOrEqual(5);
    errs.sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThan(0.06);
  });

  it('o 2º quique do saque é medido desde o 1º', () => {
    const { cam, homography } = setup({ x: 0.76, y: -1.6, z: 1.0 });
    const sim = simulateRally({ fps: 60, start: { x: 1.2, y: -0.25, z: 0.25 }, segments: RALLY });
    const found = run(new BounceDetector(homography, {}, { width: W, height: H }), observe(sim, cam));
    expect(found[1].speed?.kind).toBe('quique');
    expect(found[2].speed?.kind).toBe('golpe');
  });
});
