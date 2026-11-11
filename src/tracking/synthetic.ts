/** Gerador de quadros sintéticos para testes: fundo, ruído, bola e "jogador". */

export interface SynthScene {
  width: number;
  height: number;
  ball?: { x: number; y: number; r: number; color: [number, number, number] } | null;
  /** Retângulo grande em movimento (ex.: braço com camisa branca). */
  player?: { x: number; y: number; w: number; h: number; color: [number, number, number] } | null;
  background?: [number, number, number];
  noise?: number;
  seed?: number;
}

export function renderScene(s: SynthScene): Uint8ClampedArray {
  const { width, height } = s;
  const bg = s.background ?? [30, 90, 60];
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = s.seed ?? 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const noise = s.noise ?? 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let c = bg;
      const p = s.player;
      if (p && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) c = p.color;
      const b = s.ball;
      if (b && (x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r) c = b.color;
      const j = (y * width + x) * 4;
      const n = noise ? rnd() * noise : 0;
      data[j] = c[0] + n;
      data[j + 1] = c[1] + n;
      data[j + 2] = c[2] + n;
      data[j + 3] = 255;
    }
  return data;
}
