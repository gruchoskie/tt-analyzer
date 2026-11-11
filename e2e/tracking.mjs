// Teste do rastreio com câmera falsa mostrando uma bola sintética.
// Uso: node e2e/gen-ball-y4m.mjs bola.y4m && npm run build && npx vite preview --port 4173 &
//      BALL_Y4M=bola.y4m node e2e/tracking.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR ?? '.';
const Y4M = process.env.BALL_Y4M ?? 'bola.y4m';
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => localStorage.setItem('tt.pref.debug', 'true'));
await page.goto(URL);
await page.waitForSelector('.debug-panel');
await page.waitForFunction(() => /fps de análise: [1-9]/.test(document.querySelector('.debug-panel')?.textContent ?? ''), null, { timeout: 15000 });
await page.waitForTimeout(4000);
const dbg = await page.locator('.debug-panel').innerText();
console.log(dbg.split('\n').filter((l) => /análise|processamento|descartados|candidatos|rastro/.test(l)).join('\n'));
const badge = await page.locator('.badge', { hasText: 'Bola' }).innerText();
console.log('selo:', badge);
await page.screenshot({ path: `${OUT}/rastreio.png` });
const m = /Bola (\d+)%/.exec(badge);
if (!m) fail('sem taxa de detecção');
if (Number(m[1]) < 70) fail(`taxa de detecção baixa: ${m[1]}%`);
const afps = Number(/fps de análise: ([\d.]+)/.exec(dbg)[1]);
if (afps < 15) fail(`fps de análise abaixo de 15: ${afps}`);

// Sessão gravada: o rastreio também roda na reprodução
await page.getByLabel('Gravar').click();
await page.waitForTimeout(3000);
await page.getByLabel('Parar gravação').click();
await page.waitForSelector('text=Sessão salva', { timeout: 10000 });
await page.getByLabel('Sessões salvas').click();
await page.locator('.session-main').first().click();
await page.waitForSelector('video.player-video[src^="blob:"]');
await page.evaluate(() => { const v = document.querySelector('video.player-video'); v.muted = true; return v.play(); });
await page.waitForTimeout(2500);
const line = await page.locator('.track-line').innerText();
console.log('reprodução:', line);
const pm = /Bola detectada em (\d+)%/.exec(line);
if (!pm || Number(pm[1]) < 60) fail('rastreio na reprodução falhou');
await page.screenshot({ path: `${OUT}/rastreio-reproducao.png` });

if (errors.length) fail(errors.join('\n'));
console.log('OK');
await browser.close();
