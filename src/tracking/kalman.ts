/**
 * Filtro de Kalman 2D para a bola, em qualquer unidade (px ou m); dt em segundos.
 *
 * Modelos:
 *  - 'cv' (velocidade constante, estado [x, y, vx, vy]): robusto a quiques/golpes;
 *  - 'ca' (aceleração constante, estado [x, y, vx, vy, ax, ay]): segue arcos
 *    parabólicos (gravidade) e preenche falhas com menos erro.
 * Sem medição, `predict` sozinho preenche falhas curtas.
 */

export type KalmanModel = 'cv' | 'ca';

export interface KalmanOptions {
  model: KalmanModel;
  /**
   * Intensidade do ruído de processo: aceleração não modelada (unidade/s²) no
   * modelo 'cv', ou variação de aceleração (unidade/s³) no modelo 'ca'.
   */
  processNoise: number;
  /** Desvio padrão do erro de medição (unidade). */
  measNoise: number;
  /** Incerteza inicial da velocidade (unidade/s). */
  initialVelStd: number;
  /** Incerteza inicial da aceleração (unidade/s²), modelo 'ca'. */
  initialAccStd?: number;
}

type Mat = number[][];

const zeros = (r: number, c: number): Mat => Array.from({ length: r }, () => new Array<number>(c).fill(0));
const mul = (a: Mat, b: Mat): Mat => {
  const r = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < b.length; k++) {
      const v = a[i][k];
      if (v === 0) continue;
      for (let j = 0; j < b[0].length; j++) r[i][j] += v * b[k][j];
    }
  return r;
};
const tr = (a: Mat): Mat => a[0].map((_, j) => a.map((row) => row[j]));

export class Kalman2D {
  /** Estado (coluna). */
  private s: number[];
  private P: Mat;
  private readonly n: number;

  constructor(
    x0: number,
    y0: number,
    readonly opts: KalmanOptions,
    vx0 = 0,
    vy0 = 0,
  ) {
    this.n = opts.model === 'ca' ? 6 : 4;
    this.s = [x0, y0, vx0, vy0, ...(this.n === 6 ? [0, 0] : [])];
    this.P = zeros(this.n, this.n);
    const r = opts.measNoise ** 2;
    const v = opts.initialVelStd ** 2;
    this.P[0][0] = this.P[1][1] = r;
    this.P[2][2] = this.P[3][3] = v;
    if (this.n === 6) this.P[4][4] = this.P[5][5] = (opts.initialAccStd ?? 3000) ** 2;
  }

  get position() {
    return { x: this.s[0], y: this.s[1] };
  }

  get velocity() {
    return { x: this.s[2], y: this.s[3] };
  }

  get acceleration() {
    return this.n === 6 ? { x: this.s[4], y: this.s[5] } : { x: 0, y: 0 };
  }

  /** Matriz de transição e ruído de processo para um passo dt (por eixo, depois intercalado). */
  private transition(dt: number): { F: Mat; Q: Mat } {
    const n = this.n;
    const F = zeros(n, n);
    for (let i = 0; i < n; i++) F[i][i] = 1;
    F[0][2] = F[1][3] = dt;
    const q = this.opts.processNoise ** 2;
    const Q = zeros(n, n);
    // índices por eixo: posição, velocidade, (aceleração)
    const axes = n === 6 ? [[0, 2, 4], [1, 3, 5]] : [[0, 2], [1, 3]];
    let block: number[][];
    if (n === 6) {
      F[0][4] = F[1][5] = (dt * dt) / 2;
      F[2][4] = F[3][5] = dt;
      const d2 = dt * dt, d3 = d2 * dt, d4 = d3 * dt, d5 = d4 * dt;
      // ruído de jerk branco
      block = [
        [d5 / 20, d4 / 8, d3 / 6],
        [d4 / 8, d3 / 3, d2 / 2],
        [d3 / 6, d2 / 2, dt],
      ];
    } else {
      const d2 = dt * dt, d3 = d2 * dt, d4 = d3 * dt;
      // ruído de aceleração branca (contínuo)
      block = [
        [d4 / 4, d3 / 2],
        [d3 / 2, d2],
      ];
    }
    for (const idx of axes)
      for (let i = 0; i < idx.length; i++) for (let j = 0; j < idx.length; j++) Q[idx[i]][idx[j]] = block[i][j] * q;
    return { F, Q };
  }

  predict(dt: number): void {
    if (!(dt > 0)) return;
    const { F, Q } = this.transition(dt);
    this.s = mul(F, this.s.map((v) => [v])).map((r) => r[0]);
    const FP = mul(F, this.P);
    const FPFt = mul(FP, tr(F));
    this.P = FPFt.map((row, i) => row.map((v, j) => v + Q[i][j]));
  }

  /** Covariância da inovação S = H P Hᵀ + R (2x2: [a b; c d]). */
  innovationCov(): [number, number, number, number] {
    const r = this.opts.measNoise ** 2;
    return [this.P[0][0] + r, this.P[0][1], this.P[1][0], this.P[1][1] + r];
  }

  /** Distância de Mahalanobis² da medição até a posição prevista. */
  mahalanobis2(zx: number, zy: number): number {
    const [a, b, c, d] = this.innovationCov();
    const det = a * d - b * c;
    if (det <= 0) return Infinity;
    const dx = zx - this.s[0];
    const dy = zy - this.s[1];
    return (d * dx * dx - (b + c) * dx * dy + a * dy * dy) / det;
  }

  update(zx: number, zy: number): void {
    const [a, b, c, d] = this.innovationCov();
    const det = a * d - b * c;
    if (det <= 0) return;
    const Si = [d / det, -b / det, -c / det, a / det];
    const n = this.n;
    const P = this.P;
    // K = P Hᵀ S⁻¹ (n×2); P Hᵀ = colunas 0 e 1 de P
    const K = P.map((row) => [row[0] * Si[0] + row[1] * Si[2], row[0] * Si[1] + row[1] * Si[3]]);
    const yx = zx - this.s[0];
    const yy = zy - this.s[1];
    this.s = this.s.map((v, i) => v + K[i][0] * yx + K[i][1] * yy);
    // P = (I - K H) P, simetrizada
    const N = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) N[i][j] = P[i][j] - K[i][0] * P[0][j] - K[i][1] * P[1][j];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const m = (N[i][j] + N[j][i]) / 2;
        N[i][j] = N[j][i] = m;
      }
    this.P = N;
  }
}

/** Limiar χ² com 2 graus de liberdade (99%) para aceitar uma medição. */
export const GATE_CHI2_99 = 9.21;
