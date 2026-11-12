import type { Point3 } from '../core/types';
import { leastSquares } from '../physics/ballistic';
import { GRAVITY_M_S2, NET_HEIGHT_M } from '../physics/constants';
import { NET_Y_M } from '../calibration/table';

/**
 * Métricas 3D de um voo da bola (entre batida e quique), Fase 9.
 *
 * Ajusta p(τ) = p0 + v0·τ + a·τ²/2 por eixo. Tirando da aceleração ajustada a
 * gravidade e o arrasto esperado (k·|v|·v, k ≈ 0,14 /m para a bola de 40 mm),
 * o que sobra é atribuído ao efeito Magnus: para cima = backspin, para baixo =
 * topspin, para o lado = efeito lateral. É uma ESTIMATIVA: depende de bons
 * ~8+ pontos 3D por voo e o arrasto real varia.
 */

export const DRAG_K = 0.14;

export type SpinKind = 'topspin' | 'backspin' | 'lateral' | 'pouco efeito' | 'indefinido';

export interface FlightMetrics {
  t0: number;
  t1: number;
  points: number;
  /** km/h */
  startKmh: number;
  endKmh: number;
  avgKmh: number;
  /** Ângulos de saída (graus): vertical (+ = subindo) e horizontal (+ = para x maior, em relação ao comprimento). */
  launchVertDeg: number;
  launchHorizDeg: number;
  /** Ponto mais alto (m acima do tampo). */
  apexM: number;
  /** Altura sobre a rede (m acima do topo da rede) quando cruza y = 1,37; null se não cruza. */
  netClearanceM: number | null;
  spin: { kind: SpinKind; side: 'direita' | 'esquerda' | null; /** aceleração de Magnus em g */ upG: number; sideG: number; strength: 'leve' | 'médio' | 'forte' | null };
  /** Erro de ajuste (m). */
  rmsM: number;
}

const toKmh = (v: number) => v * 3.6;

export function analyzeFlight(pts: { t: number; p: Point3 }[]): FlightMetrics | null {
  if (pts.length < 6) return null;
  const t0 = pts[0].t;
  const T = (pts[pts.length - 1].t - t0) / 1000;
  if (T < 0.08) return null;
  const A = pts.map((q) => {
    const s = (q.t - t0) / 1000;
    return [1, s, (s * s) / 2];
  });
  const fitAxis = (k: 'x' | 'y' | 'z') => {
    try {
      return leastSquares(A, pts.map((q) => q.p[k]));
    } catch {
      return null;
    }
  };
  const fx = fitAxis('x'), fy = fitAxis('y'), fz = fitAxis('z');
  if (!fx || !fy || !fz) return null;
  const pos = (s: number): Point3 => ({
    x: fx.x[0] + fx.x[1] * s + (fx.x[2] * s * s) / 2,
    y: fy.x[0] + fy.x[1] * s + (fy.x[2] * s * s) / 2,
    z: fz.x[0] + fz.x[1] * s + (fz.x[2] * s * s) / 2,
  });
  const vel = (s: number): Point3 => ({ x: fx.x[1] + fx.x[2] * s, y: fy.x[1] + fy.x[2] * s, z: fz.x[1] + fz.x[2] * s });
  let se = 0;
  pts.forEach((q) => {
    const p = pos((q.t - t0) / 1000);
    se += (p.x - q.p.x) ** 2 + (p.y - q.p.y) ** 2 + (p.z - q.p.z) ** 2;
  });
  const rmsM = Math.sqrt(se / pts.length);
  const len = (v: Point3) => Math.hypot(v.x, v.y, v.z);
  let path = 0;
  let prev = pos(0);
  for (let k = 1; k <= 30; k++) {
    const p = pos((T * k) / 30);
    path += len({ x: p.x - prev.x, y: p.y - prev.y, z: p.z - prev.z });
    prev = p;
  }
  const v0 = vel(0), v1 = vel(T), vm = vel(T / 2);
  // ponto mais alto
  let apex = Math.max(pos(0).z, pos(T).z);
  if (fz.x[2] < 0) {
    const sv = -fz.x[1] / fz.x[2];
    if (sv > 0 && sv < T) apex = Math.max(apex, pos(sv).z);
  }
  // cruzamento da rede
  let net: number | null = null;
  const [a0, a1, a2] = fy.x;
  const roots: number[] = [];
  if (Math.abs(a2) < 1e-9) {
    if (Math.abs(a1) > 1e-9) roots.push((NET_Y_M - a0) / a1);
  } else {
    const disc = a1 * a1 - 2 * a2 * (a0 - NET_Y_M);
    if (disc >= 0) roots.push((-a1 + Math.sqrt(disc)) / a2, (-a1 - Math.sqrt(disc)) / a2);
  }
  const sNet = roots.filter((s) => s >= -0.02 && s <= T + 0.02).sort((a, b) => a - b)[0];
  if (sNet !== undefined) net = pos(sNet).z - NET_HEIGHT_M;

  // efeito: aceleração que sobra além de gravidade e arrasto
  const acc = { x: fx.x[2], y: fy.x[2], z: fz.x[2] };
  const sp = len(vm);
  const am = { x: acc.x + DRAG_K * sp * vm.x, y: acc.y + DRAG_K * sp * vm.y, z: acc.z + GRAVITY_M_S2 + DRAG_K * sp * vm.z };
  const u = { x: vm.x / sp, y: vm.y / sp, z: vm.z / sp };
  const up = { x: -u.z * u.x, y: -u.z * u.y, z: 1 - u.z * u.z };
  const upN = len(up) || 1;
  const eUp = { x: up.x / upN, y: up.y / upN, z: up.z / upN };
  const side = { x: u.y * 1 - u.z * 0, y: u.z * 0 - u.x * 1, z: 0 }; // u × ẑ
  const sN = len(side) || 1;
  const eSide = { x: side.x / sN, y: side.y / sN, z: 0 };
  const upA = am.x * eUp.x + am.y * eUp.y + am.z * eUp.z;
  const sideA = am.x * eSide.x + am.y * eSide.y;
  // incerteza da aceleração ajustada (por eixo), escalada pelo resíduo
  const sig2 = Math.max(rmsM, 0.004) ** 2 * (pts.length / Math.max(1, pts.length - 3));
  const sigA = Math.sqrt(sig2 * Math.max(fx.inv[2][2], fy.inv[2][2], fz.inv[2][2]));
  const thr = Math.max(1.5, 2 * sigA);
  let kind: SpinKind;
  let sideDir: 'direita' | 'esquerda' | null = null;
  if (sigA > 6) kind = 'indefinido';
  else if (Math.abs(sideA) > thr && Math.abs(sideA) > Math.abs(upA)) {
    kind = 'lateral';
    sideDir = sideA > 0 ? 'direita' : 'esquerda';
  } else if (upA > thr) kind = 'backspin';
  else if (upA < -thr) kind = 'topspin';
  else kind = 'pouco efeito';
  const mag = Math.hypot(upA, sideA) / GRAVITY_M_S2;
  const strength = kind === 'pouco efeito' || kind === 'indefinido' ? null : mag < 0.4 ? 'leve' : mag < 1 ? 'médio' : 'forte';
  return {
    t0,
    t1: pts[pts.length - 1].t,
    points: pts.length,
    startKmh: toKmh(len(v0)),
    endKmh: toKmh(len(v1)),
    avgKmh: toKmh(path / T),
    launchVertDeg: (Math.atan2(v0.z, Math.hypot(v0.x, v0.y)) * 180) / Math.PI,
    launchHorizDeg: (Math.atan2(v0.x, Math.abs(v0.y)) * 180) / Math.PI,
    apexM: apex,
    netClearanceM: net,
    spin: { kind, side: sideDir, upG: upA / GRAVITY_M_S2, sideG: sideA / GRAVITY_M_S2, strength },
    rmsM,
  };
}

/**
 * Separa a sequência 3D em voos: quebra onde o ponto foge da parábola dos
 * anteriores (quique, raquetada) ou há buraco no tempo.
 */
export function splitFlights(pts: { t: number; p: Point3 }[], tolM = 0.06, maxGapMs = 120): { t: number; p: Point3 }[][] {
  const out: { t: number; p: Point3 }[][] = [];
  let cur: { t: number; p: Point3 }[] = [];
  for (const q of pts) {
    const last = cur[cur.length - 1];
    let brk = !!last && q.t - last.t > maxGapMs;
    if (!brk && cur.length >= 4) {
      // extrapola com a parábola dos últimos 6 pontos
      const w = cur.slice(-6);
      const t0 = w[0].t;
      const A = w.map((r) => {
        const s = (r.t - t0) / 1000;
        return [1, s, (s * s) / 2];
      });
      const s = (q.t - t0) / 1000;
      let err = 0;
      for (const k of ['x', 'y', 'z'] as const) {
        try {
          const c = leastSquares(A, w.map((r) => r.p[k])).x;
          err += (c[0] + c[1] * s + (c[2] * s * s) / 2 - q.p[k]) ** 2;
        } catch {
          err = Infinity;
        }
      }
      brk = Math.sqrt(err) > tolM;
    }
    if (brk) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    cur.push(q);
  }
  if (cur.length) out.push(cur);
  return out;
}
