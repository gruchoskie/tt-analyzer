// Teste de fumaça no Chromium com câmera/microfone simulados.
// Uso: npm run build && npx vite preview --port 4173 & node e2e/smoke.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR ?? '.';
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL);
await page.waitForFunction(() => /\d+ fps/.test(document.querySelector('.hud-top')?.textContent ?? ''), null, { timeout: 15000 });
const fps = await page.locator('.badge').first().textContent();
console.log('fps exibido:', fps);

// Modo debug
await page.getByLabel('Ajustes').click();
await page.getByText('Modo debug').click();
await page.getByRole('button', { name: 'Fechar' }).click();
await page.waitForSelector('.debug-panel');
console.log('debug:', (await page.locator('.debug-panel').innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/camera.png` });

// Grava ~3 s
await page.getByLabel('Gravar').click();
await page.waitForSelector('.badge.rec');
await page.waitForTimeout(3200);
await page.screenshot({ path: `${OUT}/gravando.png` });
await page.getByLabel('Parar gravação').click();
await page.waitForSelector('text=Sessão salva', { timeout: 10000 });
console.log('aviso:', await page.locator('.banner-info').innerText());

// Lista
await page.getByLabel('Sessões salvas').click();
await page.waitForSelector('.session-card');
console.log('lista:', (await page.locator('.session-card').first().innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/sessoes.png` });

// Reprodução
await page.locator('.session-main').first().click();
await page.waitForSelector('video.player-video[src^="blob:"]');
await page.waitForFunction(() => {
  const v = document.querySelector('video.player-video');
  return v && Number.isFinite(v.duration) && v.duration > 0 && v.readyState >= 2;
}, null, { timeout: 10000 });
const dur = await page.evaluate(() => document.querySelector('video.player-video').duration);
console.log('duração do vídeo reproduzido (s):', dur.toFixed(2));
if (dur < 2 || dur > 5) fail(`duração inesperada ${dur}`);
await page.screenshot({ path: `${OUT}/reproducao.png` });

// Recarrega: sessão persiste no IndexedDB
await page.goto(URL + '#/sessoes');
await page.waitForSelector('.session-card');
const count = await page.locator('.session-card').count();
console.log('sessões após recarregar:', count);
if (count !== 1) fail('sessão não persistiu');

// Service worker registrado
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
console.log('service worker:', sw);

await ctx.close();

// Permissão negada
// (o Chromium headless não mostra o pedido de permissão, então simulamos a recusa)
const ctx2 = await browser.newContext({ viewport: { width: 915, height: 412 } });
const p2 = await ctx2.newPage();
await p2.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
});
await p2.goto(URL);
await p2.waitForSelector('.error-panel', { timeout: 15000 });
const denied = await p2.locator('.error-panel h2').innerText();
console.log('erro sem permissão:', denied);
if (denied !== 'Permissão de câmera negada') fail('mensagem de permissão negada errada');
if (!(await p2.getByRole('button', { name: 'Tentar de novo' }).isVisible())) fail('sem botão Tentar de novo');
await p2.screenshot({ path: `${OUT}/permissao-negada.png` });

if (errors.length) fail(errors.join('\n'));
console.log('OK');
process.exit(0);
