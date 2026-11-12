// Gera um vídeo Y4M sintético (mesa + bola branca em arcos de ida e volta)
// para usar como câmera falsa do Chromium: --use-file-for-fake-video-capture=arquivo.y4m
// Uso: node e2e/gen-ball-y4m.mjs saida.y4m [segundos] [--distracoes]
// --distracoes: "mão" branca grande se mexendo ao lado da mesa, reflexo piscando e
// uma bola parada no canto da mesa (útil para "Escolher bola").
import { createWriteStream } from 'node:fs';

const out = process.argv[2] ?? 'bola.y4m';
const seconds = Number(process.argv[3] ?? 6);
const distract = process.argv.includes('--distracoes');
const W = 640, H = 360, FPS = 30;
const table = [ [120, 325], [520, 325], [410, 130], [230, 130] ]; // perto-esq, perto-dir, longe-dir, longe-esq

function inside(x, y) {
  // trapézio convexo
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = table[i], [bx, by] = table[(i + 1) % 4];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const s = Math.sign(c);
    if (s === 0) continue;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

function edgeDist(x, y) {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = table[i], [bx, by] = table[(i + 1) % 4];
    best = Math.min(best, Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / Math.hypot(bx - ax, by - ay));
  }
  return best;
}

function rgbToYuv(r, g, b) {
  return [
    Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16),
    Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128),
    Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128),
  ];
}

// fundo estático pré-calculado
const bgRGB = new Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let c = [35, 35, 40];
  if (inside(x, y)) c = edgeDist(x, y) < 3.2 + (2.2 * (y - 130)) / 195 ? [235, 235, 235] : [25, 70, 120]; // tampo com a faixa branca da borda
  if (Math.abs(y - 220) < 2 && x > 150 && x < 490) c = [230, 230, 230]; // rede
  bgRGB[y * W + x] = c;
}

/** Posição da bola no tempo t: arcos de 1 s indo e voltando entre os lados. */
function ball(t) {
  const k = Math.floor(t);
  const u = t - k;
  const dir = k % 2 === 0 ? 1 : -1;
  const yNear = 300, yFar = 150;
  const y0 = dir > 0 ? yNear : yFar;
  const y1 = dir > 0 ? yFar : yNear;
  const x = 320 + (dir > 0 ? -60 + 120 * u : 60 - 120 * u);
  const y = y0 + (y1 - y0) * u - 120 * Math.sin(Math.PI * u); // arco para cima (quebra nítida nas pontas, como um quique)
  const r = dir > 0 ? 5 - 2 * u : 3 + 2 * u; // menor quando longe
  return { x, y, r };
}

const BALL = [250, 150, 40]; // bola laranja
const ws = createWriteStream(out);
ws.write(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
const frames = seconds * FPS;
for (let f = 0; f < frames; f++) {
  const b = ball(f / FPS);
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  const t = f / FPS;
  const hand = { x: 470 + 25 * Math.sin(t * 5), y: 170 + 30 * Math.cos(t * 4), s: 14 };
  const flicker = f % 6 < 3;
  const rgbAt = (x, y) => {
    if ((x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r) return BALL;
    if (distract) {
      if ((x - 170) ** 2 + (y - 305) ** 2 <= 25) return BALL; // bola parada no canto
      if (x >= hand.x && x < hand.x + hand.s && y >= hand.y && y < hand.y + hand.s) return [235, 235, 230]; // "mão"/manga branca
      if (flicker && (x - 450) ** 2 + (y - 250) ** 2 <= 9) return [250, 250, 250]; // reflexo piscando
    }
    return bgRGB[y * W + x];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = rgbToYuv(...rgbAt(x, y))[0];
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const [, u, v] = rgbToYuv(...rgbAt(x * 2, y * 2));
    U[y * (W / 2) + x] = u;
    V[y * (W / 2) + x] = v;
  }
  ws.write('FRAME\n');
  ws.write(Y); ws.write(U); ws.write(V);
}
ws.end(() => console.log(`gerado ${out}: ${frames} quadros ${W}x${H}@${FPS}`));
