// Pose (MediaPipe) com câmera falsa mostrando uma pessoa.
// Uso: ffmpeg -loop 1 -i pessoa.jpg -vf "scale=640:427,pad=640:480:0:26,fps=30" -t 4 -pix_fmt yuv420p pessoa.y4m
//      POSE_Y4M=pessoa.y4m node e2e/pose.mjs   (com o app servido em APP_URL, ex.: npx vite preview)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR ?? '.';
const Y4M = process.env.POSE_Y4M ?? 'pessoa.y4m';
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`, '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('tt.pref.debug', 'true');
  localStorage.setItem('tt.pref.showPose', 'true');
});
await page.goto(URL);
await page.waitForFunction(() => /pose: (ok|erro)/.test(document.querySelector('.debug-panel')?.textContent ?? ''), null, { timeout: 60000 });
const dbg = await page.locator('.debug-panel').textContent();
const poseLine = dbg.match(/pose: [^\n]*?(?=toque|$)/)?.[0] ?? '';
console.log(poseLine);
if (/pose: erro/.test(dbg)) fail(await page.locator('.stroke-panel, .error-text').first().textContent());
await page.waitForSelector('svg g.pose line', { timeout: 15000 }).catch(() => fail('nenhum esqueleto desenhado'));
const lines = await page.locator('svg g.pose line').count();
console.log('linhas do esqueleto:', lines);
if (lines < 8) fail('esqueleto incompleto');
await page.waitForTimeout(1500);
console.log((await page.locator('.debug-panel').textContent()).match(/pose: .*?mão da raquete perto \w+/)?.[0]);
await page.screenshot({ path: `${OUT}/pose.png` });
if (errors.length) fail(errors.join('\n'));
await browser.close();
console.log('OK');
