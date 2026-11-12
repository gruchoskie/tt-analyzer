import { describe, expect, it } from 'vitest';
import { orderCorners } from '../calibration/calibrate';
import { NET_POSTS_M, TABLE_CORNERS_M } from '../calibration/table';
import type { Point3 } from '../core/types';
import { NET_HEIGHT_M } from '../physics/constants';
import { PinholeCamera } from '../physics/pinhole';
import { calibrateCamera3D, reprojectionQuality, rotateCorners } from './cameraPose';
import { projectP } from './geom3d';

const W = 1280, H = 720;

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
}

function scene(pos: Point3, hfov = 68, noise = 0, seed = 2) {
  const cam = new PinholeCamera(W, H, pos, { x: 0.76, y: 1.37, z: 0 }, hfov);
  const r = rng(seed);
  const jit = (p: { x: number; y: number }) => ({ x: p.x + noise * 2 * r(), y: p.y + noise * 2 * r() });
  const corners = orderCorners(TABLE_CORNERS_M.map((p) => jit(cam.project({ ...p, z: 0 }))), W, H);
  const posts = NET_POSTS_M.map((p) => jit(cam.project({ ...p, z: NET_HEIGHT_M }))) as [{ x: number; y: number }, { x: number; y: number }];
  return { cam, corners, posts };
}

describe('calibração 3D da câmera (cantos + postes da rede)', () => {
  // giro: a câmera do outro lado chama de "perto" a cabeceira dela; gira para o referencial comum
  const cases: [string, Point3, number, number][] = [
    ['atrás', { x: 0.76, y: -1.8, z: 1.1 }, 68, 0],
    ['diagonal', { x: -1.5, y: -1.0, z: 1.2 }, 68, 0],
    ['lateral', { x: -2.6, y: 1.37, z: 1.0 }, 75, 0],
    ['do outro lado, alta', { x: 2.4, y: 3.8, z: 2.2 }, 60, 2],
  ];
  for (const [name, pos, hfov, rot] of cases)
    it(`${name}: posição, foco e reprojeção`, () => {
      const { cam, corners: c0, posts: p0 } = scene(pos, hfov, 0.5);
      const corners = rotateCorners(c0, rot);
      // os postes podem vir em qualquer ordem
      const posts = [p0[1], p0[0]] as typeof p0;
      const m = calibrateCamera3D({ width: W, height: H, corners, netPosts: posts })!;
      expect(m).not.toBeNull();
      expect(m.points).toBe(6);
      expect(Math.hypot(m.position.x - pos.x, m.position.y - pos.y, m.position.z - pos.z)).toBeLessThan(0.08);
      expect(Math.abs(m.f - cam.f) / cam.f).toBeLessThan(0.05);
      expect(m.rmsPx).toBeLessThan(1.5);
      expect(reprojectionQuality(m)).toBe('boa');
      // ponto no ar projeta como a câmera real
      const p = { x: 0.5, y: 2.0, z: 0.35 };
      const a = cam.project(p), b = projectP(m.P, p);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3);
    });

  it('poste marcado errado aparece como erro de reprojeção alto', () => {
    const { corners, posts } = scene({ x: 0.76, y: -1.8, z: 1.1 });
    posts[1] = { x: posts[1].x + 40, y: posts[1].y - 30 };
    const m = calibrateCamera3D({ width: W, height: H, corners, netPosts: posts })!;
    expect(reprojectionQuality(m)).toBe('alta');
  });

  it('só os cantos também funciona (4 pontos)', () => {
    const { corners } = scene({ x: -1.5, y: -1.0, z: 1.2 });
    const m = calibrateCamera3D({ width: W, height: H, corners })!;
    expect(m.points).toBe(4);
    expect(Math.hypot(m.position.x + 1.5, m.position.y + 1.0, m.position.z - 1.2)).toBeLessThan(0.1);
  });
});
