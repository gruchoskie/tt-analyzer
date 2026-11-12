import type { Point2, Point3 } from '../core/types';

/**
 * Câmera pinhole simples (pixels quadrados, centro óptico no meio da imagem).
 * Usada para gerar dados sintéticos nos testes (trajetórias, cenas) e, na
 * Fase 9, como base da calibração 3D.
 */
export class PinholeCamera {
  readonly f: number;
  private readonly fw: number[];
  private readonly rt: number[];
  private readonly up: number[];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly position: Point3,
    target: Point3,
    hfovDeg = 68,
    rollDeg = 0,
  ) {
    this.f = width / 2 / Math.tan((hfovDeg * Math.PI) / 360);
    const norm = (a: number[]) => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return a.map((v) => v / l);
    };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fw = norm([target.x - position.x, target.y - position.y, target.z - position.z]);
    let rt = norm(cross(fw, [0, 0, 1]));
    let up = cross(rt, fw);
    const r = (rollDeg * Math.PI) / 180;
    if (r) {
      const r2 = rt.map((v, i) => Math.cos(r) * v + Math.sin(r) * up[i]);
      const u2 = up.map((v, i) => -Math.sin(r) * rt[i] + Math.cos(r) * v);
      rt = r2;
      up = u2;
    }
    this.fw = fw;
    this.rt = rt;
    this.up = up;
  }

  /** Projeta um ponto 3D (m) em pixels. */
  project(p: Point3): Point2 {
    const d = [p.x - this.position.x, p.y - this.position.y, p.z - this.position.z];
    const zc = d[0] * this.fw[0] + d[1] * this.fw[1] + d[2] * this.fw[2];
    const xc = d[0] * this.rt[0] + d[1] * this.rt[1] + d[2] * this.rt[2];
    const yc = d[0] * this.up[0] + d[1] * this.up[1] + d[2] * this.up[2];
    return { x: this.width / 2 + (this.f * xc) / zc, y: this.height / 2 - (this.f * yc) / zc };
  }

  /** Direção (não normalizada) do raio que passa pelo pixel. */
  ray(px: number, py: number): number[] {
    const sx = (px - this.width / 2) / this.f;
    const sy = -(py - this.height / 2) / this.f;
    return [0, 1, 2].map((i) => this.fw[i] + sx * this.rt[i] + sy * this.up[i]);
  }
}
