import type { Point2 } from '../core/types';
import { fitBallistic, positionAt, velocityAt, type BallisticFit, type FitPoint } from './ballistic';
import { BALL_RADIUS_M } from './constants';
import { mpsToKmh } from './units';

/**
 * Velocidade da bola em cada jogada (do golpe, ou do quique anterior, até o quique).
 *
 * Com 1 câmera é uma ESTIMATIVA: a calibração da mesa dá também uma câmera
 * aproximada (distância focal e posição), e a parábola ajustada aos quadros
 * entre a batida e o quique dá a velocidade 3D. A margem de erro soma:
 *  - o espalhamento do ajuste (ruído do rastro, quadros perdidos);
 *  - o erro da câmera estimada (≈ 5%);
 *  - a incerteza do instante do quique (meio quadro, ou ~3 ms com o "toc").
 * O arrasto do ar não entra: a velocidade de saída real é um pouco maior.
 */

export type SpeedKind = 'golpe' | 'quique';

export interface SpeedEstimate {
  /** 'golpe' = desde a raquetada (ou do início do rastro); 'quique' = desde o quique anterior. */
  kind: SpeedKind;
  fromT: number;
  toT: number;
  /** Velocidade média no trecho (km/h). */
  avgKmh: number;
  /** Logo depois da batida e logo antes do quique (km/h). */
  startKmh: number;
  endKmh: number;
  /** Margem de erro (±, km/h) da média. */
  errKmh: number;
  /** 'balistico' = parábola 3D; 'plano' = só a distância na mesa entre dois quiques. */
  method: 'balistico' | 'plano';
  points: number;
}

/** Erro sistemático da câmera estimada a partir dos 4 cantos. */
export const CAMERA_SYSTEMATIC = 0.05;
/** Acima disso (px) o trecho não é uma parábola só (raquetada no meio, rastro errado). */
export const MAX_FIT_RMS_PX = 3;

export interface SegmentInput {
  kind: SpeedKind;
  /** Começo do trecho (ms): instante da raquetada / do quique anterior / do início do rastro. */
  fromT: number;
  /** Posição na mesa do quique anterior (só para o método 'plano'). */
  fromTable?: Point2 | null;
  /** Quique que fecha o trecho. */
  to: { t: number; table: Point2; tErrMs: number };
  /** Intervalo típico entre quadros (ms). */
  frameMs: number;
}

function pathLength(fit: BallisticFit, t0: number, t1: number, steps = 24): number {
  let len = 0;
  let prev = positionAt(fit, t0);
  for (let k = 1; k <= steps; k++) {
    const p = positionAt(fit, t0 + ((t1 - t0) * k) / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
    prev = p;
  }
  return len;
}

const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

/** Velocidade de um trecho. `obs` pode ter pontos de fora do trecho (são filtrados). */
export function segmentSpeed(obs: FitPoint[], seg: SegmentInput, P: number[] | null): SpeedEstimate | null {
  const T = seg.to.t - seg.fromT;
  if (!(T > 40)) return null;
  // perto da batida a bola está na raquete; perto do quique, já encostando
  const pts = obs.filter((o) => o.t > seg.fromT + 0.6 * seg.frameMs && o.t < seg.to.t - 0.3 * seg.frameMs);
  const systematic = seg.kind === 'quique' && !P ? 0.04 : CAMERA_SYSTEMATIC;

  if (P && pts.length >= 3) {
    const end = { t: seg.to.t, p: { x: seg.to.table.x, y: seg.to.table.y, z: BALL_RADIUS_M }, sigmaM: 0.03 };
    let fit: BallisticFit | null = null;
    let start = 0;
    let kind = seg.kind;
    let fromT = seg.fromT;
    // se não fecha numa parábola, houve uma batida não vista: começa mais tarde.
    // Testa cada começo possível e fica com o mais cedo que ajusta quase tão bem quanto o melhor.
    const tries: { start: number; f: BallisticFit }[] = [];
    for (let st = 0; pts.length - st >= 4; st++) {
      const sub = pts.slice(st);
      if (sub[sub.length - 1].t - sub[0].t < 2.5 * seg.frameMs) break;
      const f = fitBallistic(sub, P, seg.to.t, end);
      if (f) tries.push({ start: st, f });
      // sem buraco nenhum: não precisa procurar mais
      if (st === 0 && f && f.rmsPx < 1.2) break;
    }
    const best = Math.min(...tries.map((x) => x.f.rmsPx));
    const pick = tries.find((x) => x.f.rmsPx <= Math.min(MAX_FIT_RMS_PX, 1.25 * best + 0.25));
    if (pick) {
      fit = pick.f;
      start = pick.start;
      if (start > 0) {
        kind = 'golpe';
        fromT = (pts[start - 1].t + pts[start].t) / 2;
      }
    }
    if (fit) {
      const T2 = seg.to.t - fromT;
      const len = pathLength(fit, fromT, seg.to.t);
      const avg = len / (T2 / 1000);
      // espalhamento: gradiente numérico da média em relação aos 6 parâmetros
      const base = [fit.p0.x, fit.p0.y, fit.p0.z, fit.v0.x, fit.v0.y, fit.v0.z];
      const at = (x: number[]) => ({ ...fit!, p0: { x: x[0], y: x[1], z: x[2] }, v0: { x: x[3], y: x[4], z: x[5] } });
      const grad = base.map((_, i) => {
        const h = i < 3 ? 1e-3 : 1e-2;
        const xp = [...base], xm = [...base];
        xp[i] += h;
        xm[i] -= h;
        return (pathLength(at(xp), fromT, seg.to.t) - pathLength(at(xm), fromT, seg.to.t)) / (2 * h) / (T2 / 1000);
      });
      let varStat = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) varStat += grad[i] * fit.cov[i][j] * grad[j];
      const err = Math.sqrt(Math.max(0, varStat) + (systematic * avg) ** 2 + ((avg * seg.to.tErrMs) / T2) ** 2);
      return {
        kind,
        fromT,
        toT: seg.to.t,
        avgKmh: mpsToKmh(avg),
        startKmh: mpsToKmh(speed(velocityAt(fit, fromT))),
        endKmh: mpsToKmh(speed(velocityAt(fit, seg.to.t))),
        errKmh: mpsToKmh(err),
        method: 'balistico',
        points: fit.n,
      };
    }
  }

  // sem câmera (ou sem parábola): entre dois quiques, só a distância na mesa
  if (seg.kind === 'quique' && seg.fromTable) {
    const d = Math.hypot(seg.to.table.x - seg.fromTable.x, seg.to.table.y - seg.fromTable.y);
    const v = d / (T / 1000);
    const rel = Math.hypot(0.06 / Math.max(d, 0.1), (Math.SQRT2 * seg.to.tErrMs) / T, systematic);
    return {
      kind: 'quique',
      fromT: seg.fromT,
      toT: seg.to.t,
      avgKmh: mpsToKmh(v),
      startKmh: mpsToKmh(v),
      endKmh: mpsToKmh(v),
      errKmh: mpsToKmh(v * rel),
      method: 'plano',
      points: pts.length,
    };
  }
  return null;
}
