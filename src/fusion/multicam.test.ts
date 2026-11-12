import { describe, expect, it } from 'vitest';
import { orderCorners } from '../calibration/calibrate';
import { NET_POSTS_M, TABLE_CORNERS_M } from '../calibration/table';
import type { Point3 } from '../core/types';
import { GRAVITY_M_S2, NET_HEIGHT_M } from '../physics/constants';
import { PinholeCamera } from '../physics/pinhole';
import { calibrateCamera3D, rotateCorners, type CameraModel } from './cameraPose';
import { Kalman3D } from './kalman3d';
import { analyzeFlight, DRAG_K, splitFlights } from './metrics3d';
import { interpolateTrack, triangulate } from './triangulate';

const W = 1280, H = 720;
function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
}

/** Voo com gravidade, arrasto e Magnus (ω̂ × v), integrado em passos de 1 ms. */
function flight(p0: Point3, v0: Point3, spinAxis: Point3 | null, cM: number, T: number, fps: number) {
  const out: { t: number; p: Point3 }[] = [];
  let p = { ...p0 }, v = { ...v0 };
  const dt = 0.001;
  for (let k = 0, next = 0; k * dt <= T + 1e-9; k++) {
    if (k * dt >= next - 1e-9) {
      out.push({ t: k * dt * 1000, p: { ...p } });
      next += 1 / fps;
    }
    const s = Math.hypot(v.x, v.y, v.z);
    const m = spinAxis ? { x: spinAxis.y * v.z - spinAxis.z * v.y, y: spinAxis.z * v.x - spinAxis.x * v.z, z: spinAxis.x * v.y - spinAxis.y * v.x } : { x: 0, y: 0, z: 0 };
    const a = { x: -DRAG_K * s * v.x + cM * m.x, y: -DRAG_K * s * v.y + cM * m.y, z: -GRAVITY_M_S2 - DRAG_K * s * v.z + cM * m.z };
    v = { x: v.x + a.x * dt, y: v.y + a.y * dt, z: v.z + a.z * dt };
    p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
  }
  return out;
}

function calibrated(pos: Point3, hfov = 68, rot = 0): { cam: PinholeCamera; model: CameraModel } {
  const cam = new PinholeCamera(W, H, pos, { x: 0.76, y: 1.37, z: 0.2 }, hfov);
  const r = rng(Math.round(pos.x * 100 + 7));
  const j = (p: { x: number; y: number }) => ({ x: p.x + r() * 0.8, y: p.y + r() * 0.8 });
  const corners = rotateCorners(orderCorners(TABLE_CORNERS_M.map((p) => j(cam.project({ ...p, z: 0 }))), W, H), rot);
  const posts = NET_POSTS_M.map((p) => j(cam.project({ ...p, z: NET_HEIGHT_M }))) as [{ x: number; y: number }, { x: number; y: number }];
  return { cam, model: calibrateCamera3D({ width: W, height: H, corners, netPosts: posts })! };
}

describe('triangulação', () => {
  const rigs = [calibrated({ x: 0.76, y: -1.8, z: 1.1 }), calibrated({ x: -2.4, y: 1.0, z: 1.2 }, 75), calibrated({ x: 3.6, y: 2.2, z: 1.6 }, 70)];

  it('2 câmeras: erro de poucos mm/cm em pontos no ar', () => {
    const r = rng(4);
    for (const p of [{ x: 0.3, y: 0.5, z: 0.25 }, { x: 1.2, y: 2.3, z: 0.4 }, { x: 0.76, y: 1.37, z: 0.3 }]) {
      const views = rigs.slice(0, 2).map((g, i) => {
        const q = g.cam.project(p);
        return { cameraId: `c${i}`, P: g.model.P, x: q.x + r(), y: q.y + r() };
      });
      const tr = triangulate(views)!;
      expect(Math.hypot(tr.p.x - p.x, tr.p.y - p.y, tr.p.z - p.z)).toBeLessThan(0.03);
      expect(tr.rmsPx).toBeLessThan(3);
    }
  });

  it('3 câmeras com uma detecção errada: RANSAC descarta', () => {
    const p = { x: 0.9, y: 1.8, z: 0.35 };
    const views = rigs.map((g, i) => {
      const q = g.cam.project(p);
      return { cameraId: `c${i}`, P: g.model.P, x: q.x + (i === 2 ? 120 : 0), y: q.y };
    });
    const tr = triangulate(views)!;
    expect(tr.rejected).toEqual(['c2']);
    expect(Math.hypot(tr.p.x - p.x, tr.p.y - p.y, tr.p.z - p.z)).toBeLessThan(0.03);
  });

  it('câmera do outro lado da mesa, com os cantos girados para o referencial comum', () => {
    const far = calibrated({ x: 0.76, y: 4.6, z: 1.2 }, 68, 2);
    const p = { x: 0.4, y: 1.0, z: 0.3 };
    const views = [rigs[0], far].map((g, i) => {
      const q = g.cam.project(p);
      return { cameraId: `c${i}`, P: g.model.P, x: q.x, y: q.y };
    });
    const tr = triangulate(views)!;
    expect(Math.hypot(tr.p.x - p.x, tr.p.y - p.y, tr.p.z - p.z)).toBeLessThan(0.03);
  });

  it('interpola o rastro 2D de cada câmera para o mesmo instante', () => {
    const tr = [{ t: 0, x: 0, y: 0 }, { t: 16, x: 16, y: 32 }, { t: 100, x: 0, y: 0 }];
    expect(interpolateTrack(tr, 8)).toEqual({ x: 8, y: 16 });
    expect(interpolateTrack(tr, 50)).toBeNull(); // buraco grande
    expect(interpolateTrack(tr, 200)).toBeNull();
  });
});

describe('Kalman 3D e métricas do voo', () => {
  it('Kalman suaviza o ruído e reinicia no quique', () => {
    const r = rng(9);
    const a = flight({ x: 0.5, y: -0.2, z: 0.3 }, { x: 0.5, y: 8, z: 1 }, null, 0, 0.3, 60);
    const kf = new Kalman3D();
    let errRaw = 0, errKf = 0, n = 0;
    for (const s of a) {
      const z = { x: s.p.x + r() * 0.03, y: s.p.y + r() * 0.03, z: s.p.z + r() * 0.03 };
      const o = kf.update(s.t, z, 0.009);
      if (s.t > 80) {
        errRaw += Math.hypot(z.x - s.p.x, z.y - s.p.y, z.z - s.p.z);
        errKf += Math.hypot(o.p.x - s.p.x, o.p.y - s.p.y, o.p.z - s.p.z);
        n++;
      }
    }
    expect(errKf / n).toBeLessThan((0.9 * errRaw) / n);
    // quique: velocidade vertical inverte de repente
    const last = a[a.length - 1];
    kf.update(last.t + 16, { x: last.p.x, y: last.p.y + 0.12, z: last.p.z + 0.15 });
    const o = kf.update(last.t + 33, { x: last.p.x, y: last.p.y + 0.24, z: last.p.z + 0.3 });
    expect(o.v.z).toBeGreaterThan(5);
  });

  const cases: [string, Point3 | null, string][] = [
    ['topspin', { x: -1, y: 0, z: 0 }, 'topspin'],
    ['backspin', { x: 1, y: 0, z: 0 }, 'backspin'],
    ['lateral', { x: 0, y: 0, z: 1 }, 'lateral'],
    ['sem efeito', null, 'pouco efeito'],
  ];
  for (const [name, axis, kind] of cases)
    it(`efeito estimado: ${name}`, () => {
      const r = rng(11);
      const T = 0.42;
      const a = flight({ x: 0.4, y: -0.1, z: 0.3 }, { x: 0.6, y: 7, z: 1.6 }, axis, 0.55, T, 60).map((s) => ({ t: s.t, p: { x: s.p.x + r() * 0.01, y: s.p.y + r() * 0.01, z: s.p.z + r() * 0.01 } }));
      const m = analyzeFlight(a)!;
      expect(m.spin.kind).toBe(kind);
      const truthStart = Math.hypot(0.6, 7, 1.6) * 3.6;
      expect(Math.abs(m.startKmh - truthStart) / truthStart).toBeLessThan(0.08);
      expect(Math.abs(m.launchVertDeg - (Math.atan2(1.6, Math.hypot(0.6, 7)) * 180) / Math.PI)).toBeLessThan(4);
      const apex = Math.max(...a.map((s) => s.p.z));
      expect(Math.abs(m.apexM - apex)).toBeLessThan(0.03);
      // cruza a rede: altura verdadeira no cruzamento
      const cross = a.find((s, i) => i > 0 && a[i - 1].p.y < 1.37 && s.p.y >= 1.37)!;
      expect(m.netClearanceM).not.toBeNull();
      expect(Math.abs(m.netClearanceM! - (cross.p.z - NET_HEIGHT_M))).toBeLessThan(0.05);
    });

  it('separa os voos no quique', () => {
    const a = flight({ x: 0.4, y: 0.2, z: 0.3 }, { x: 0.2, y: 6, z: 1.2 }, null, 0, 0.35, 60);
    const end = a[a.length - 1];
    const b = flight({ ...end.p }, { x: 0.2, y: 5, z: 3 }, null, 0, 0.3, 60).slice(1).map((s) => ({ t: s.t + end.t, p: s.p }));
    const parts = splitFlights([...a, ...b]);
    expect(parts.length).toBe(2);
    expect(Math.abs(parts[0].length - a.length)).toBeLessThanOrEqual(2);
  });
});

import { MultiCamFusion } from './MultiCamFusion';

describe('fusão no hub', () => {
  it('2 câmeras com relógios e fps diferentes: voos 3D, e volta ao 2D quando uma cai', () => {
    const A = calibrated({ x: 0.76, y: -1.8, z: 1.1 });
    const B = calibrated({ x: -2.4, y: 1.0, z: 1.2 }, 75);
    const f1 = flight({ x: 0.4, y: -0.1, z: 0.3 }, { x: 0.6, y: 7, z: 1.6 }, { x: -1, y: 0, z: 0 }, 0.55, 0.42, 240);
    const end = f1[f1.length - 1];
    const f2 = flight({ ...end.p, z: 0.02 }, { x: -0.3, y: 5.5, z: 2.6 }, null, 0, 0.3, 240).slice(1).map((s) => ({ t: s.t + end.t, p: s.p }));
    const truth = [...f1, ...f2];
    const at = (t: number) => {
      let i = truth.findIndex((s) => s.t >= t);
      if (i <= 0) i = 1;
      const a = truth[i - 1], b = truth[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return { x: a.p.x + (b.p.x - a.p.x) * u, y: a.p.y + (b.p.y - a.p.y) * u, z: a.p.z + (b.p.z - a.p.z) * u };
    };
    const fu = new MultiCamFusion();
    fu.setCamera('A', A.model);
    fu.setCamera('B', B.model);
    const r = rng(21);
    const T0 = 50_000;
    const tEnd = truth[truth.length - 1].t;
    // A a 60 fps, B a 30 fps defasada; sincronia com ±2 ms de erro em B
    const evs: { cam: 'A' | 'B'; t: number }[] = [];
    for (let t = 0; t <= tEnd; t += 1000 / 60) evs.push({ cam: 'A', t });
    for (let t = 7; t <= tEnd; t += 1000 / 30) evs.push({ cam: 'B', t });
    evs.sort((a, b) => a.t - b.t);
    for (const e of evs) {
      const g = e.cam === 'A' ? A : B;
      const q = g.cam.project(at(e.t));
      fu.ingest(e.cam, T0 + e.t + (e.cam === 'B' ? 2 : 0), q.x + r() * 0.8, q.y + r() * 0.8);
    }
    expect(fu.mode(T0 + tEnd)).toBe('3d');
    fu.step(T0 + tEnd + 1000);
    fu.flush();
    expect(fu.flights.length).toBe(2);
    expect(fu.flights[0].spin.kind).toBe('topspin');
    const truthStart = Math.hypot(0.6, 7, 1.6) * 3.6;
    expect(Math.abs(fu.flights[0].startKmh - truthStart) / truthStart).toBeLessThan(0.12);
    // posições 3D boas
    const errs = fu.samples.map((s) => {
      const p = at(s.t - T0);
      return Math.hypot(s.p.x - p.x, s.p.y - p.y, s.p.z - p.z);
    });
    errs.sort((a, b) => a - b);
    expect(errs[errs.length >> 1]).toBeLessThan(0.03);
    // B some: 2D
    fu.heartbeat('A', T0 + tEnd + 3000);
    expect(fu.mode(T0 + tEnd + 3000)).toBe('2d');
    expect(fu.status(T0 + tEnd + 3000).find((s) => s.cameraId === 'B')!.live).toBe(false);
  });
});
