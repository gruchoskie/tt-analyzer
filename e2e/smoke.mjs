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

// Calibração: toca nos 4 cantos (em qualquer ordem) de um trapézio
const vb = await page.locator('video.camera-video').boundingBox();
const cont = await page.evaluate(() => {
  const v = document.querySelector('video.camera-video');
  const s = Math.min(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
  return { s, ox: (v.clientWidth - v.videoWidth * s) / 2, oy: (v.clientHeight - v.videoHeight * s) / 2 };
});
const tap = (x, y) => page.mouse.click(vb.x + cont.ox + x * cont.s, vb.y + cont.oy + y * cont.s);
await page.getByLabel('Calibrar mesa').click();
await page.waitForSelector('.calib-step');
// a câmera falsa padrão não tem mesa; limpa o que a detecção automática tiver marcado
if (await page.getByRole('button', { name: 'Refazer' }).isEnabled()) await page.getByRole('button', { name: 'Refazer' }).click();
// sem mesa, o app pede um toque no tampo: aqui marcamos os cantos à mão
if (await page.getByRole('button', { name: 'Marcar à mão' }).isVisible()) await page.getByRole('button', { name: 'Marcar à mão' }).click();
await tap(820, 260);
await tap(240, 650);
await tap(460, 260);
await tap(1040, 650);
await page.waitForSelector('text=Arraste os pontos');
// arrasta o canto 1 um pouco e volta
const h1 = { x: vb.x + cont.ox + 240 * cont.s, y: vb.y + cont.oy + 650 * cont.s };
await page.mouse.move(h1.x, h1.y);
await page.mouse.down();
await page.mouse.move(h1.x + 20, h1.y - 10, { steps: 4 });
if (!(await page.locator('.calib-loupe').isVisible())) fail('lupa não apareceu');
await page.screenshot({ path: `${OUT}/calibrando.png` });
await page.mouse.move(h1.x, h1.y, { steps: 4 });
await page.mouse.up();
await page.getByRole('button', { name: 'Salvar' }).click();
await page.waitForSelector('text=Mesa calibrada');
const cal = await page.evaluate(() => JSON.parse(localStorage.getItem('tt.calibration.' + localStorage.getItem('tt.cameraId'))));
console.log('cantos salvos:', cal.cornersPx.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' '));
if (Math.abs(cal.cornersPx[0].x - 240) > 2 || Math.abs(cal.cornersPx[2].y - 260) > 2) fail('cantos errados');
// debug: toque no centro da mesa (cruzamento das diagonais) mostra ~ (0,76 ; 1,37)
await page.locator('.banner-info').click();
await tap(640, 393.5);
await page.screenshot({ path: `${OUT}/mesa-calibrada.png` });

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
const calFact = await page.locator('.facts div', { hasText: 'Calibração' }).innerText();
console.log('calibração na sessão:', calFact.replace(/\n/g, ': '));
if (!/Feita/.test(calFact)) fail('calibração não foi salva na sessão');
await page.waitForSelector('.player-stage canvas.table-overlay');
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
