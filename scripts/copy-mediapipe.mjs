// Copia o runtime WASM do MediaPipe para public/mediapipe (servido junto com o app, funciona offline).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dst = 'public/mediapipe';
if (!existsSync(src)) {
  console.error('MediaPipe não instalado (npm install).');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('MediaPipe WASM copiado para', dst);
