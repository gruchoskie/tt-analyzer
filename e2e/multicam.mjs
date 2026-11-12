// Fase 9: pareia hub e câmera (dois "celulares" = dois contextos do Chromium)
// trocando os códigos colados, e confere conexão, sincronia e sinal.
// Uso: npm run build && npx vite preview --port 4173 & node e2e/multicam.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = (process.env.APP_URL ?? 'http://localhost:4173/') + '#/multicam';
const OUT = process.env.SHOT_DIR ?? '.';
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ['camera', 'microphone'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fail(`erro na página: ${e.message}`));
  await p.goto(URL);
  return p;
};
const hubP = await mk();
const camP = await mk();

await hubP.getByRole('button', { name: 'Este celular é o hub' }).click();
await camP.getByRole('button', { name: 'Este celular é uma câmera' }).click();

await hubP.getByRole('button', { name: 'Adicionar câmera' }).click();
const offer = (await hubP.locator('.qr-text').first().textContent({ timeout: 15000 }))?.trim();
if (!offer?.startsWith('TTO1.')) fail(`código do hub estranho: ${offer?.slice(0, 20)}`);
console.log('código do hub:', offer.length, 'caracteres');
await hubP.waitForSelector('.qr img');

await camP.locator('.code-input').fill(offer);
await camP.getByRole('button', { name: 'Usar código colado' }).click();
const answer = (await camP.locator('.qr-text').first().textContent({ timeout: 15000 }))?.trim();
if (!answer?.startsWith('TTR1.')) fail(`código da câmera estranho: ${answer?.slice(0, 20)}`);
console.log('código da câmera:', answer.length, 'caracteres');

await hubP.locator('.pairing .code-input').fill(answer);
await hubP.locator('.pairing').getByRole('button', { name: 'Usar código colado' }).click();

await camP.waitForFunction(() => document.body.innerText.includes('Conectado ao hub'), null, { timeout: 20000 });
await camP.waitForFunction(() => /sincronia ± [\d,]+ ms/.test(document.body.innerText), null, { timeout: 10000 });
await hubP.waitForFunction(() => /± [\d,]+ ms/.test(document.querySelector('.shot-list')?.textContent ?? ''), null, { timeout: 10000 });
await hubP.waitForFunction(() => /\d+ ms (bom|ok|fraco)/.test(document.querySelector('.shot-list')?.textContent ?? ''), null, { timeout: 10000 });
const row = (await hubP.locator('.shot-list tbody tr').nth(1).innerText()).replace(/\s+/g, ' ');
console.log('linha da câmera no hub:', row);
if (!row.includes('conectado')) fail('câmera não aparece conectada no hub');
const camState = (await camP.locator('.card').first().innerText()).split('\n')[0];
console.log('na câmera:', camState, '|', (await camP.locator('.card .small').first().innerText()));

// a câmera abre a filmadora: o hub passa a ver fps
await camP.getByRole('button', { name: 'Abrir a câmera' }).click();
await hubP.waitForFunction(() => /\d+ \(análise/.test(document.querySelector('.shot-list')?.textContent ?? ''), null, { timeout: 20000 });
console.log('com a câmera filmando:', (await hubP.locator('.shot-list tbody tr').nth(1).innerText()).replace(/\s+/g, ' '));
await hubP.screenshot({ path: `${OUT}/multicam-hub.png` });

// o hub grava: a câmera grava junto e manda o vídeo no fim
await hubP.getByRole('button', { name: 'Abrir a câmera do hub' }).click();
await hubP.waitForFunction(() => /\d+ fps/.test(document.querySelector('.hud-top')?.textContent ?? ''), null, { timeout: 15000 });
await hubP.getByLabel('Gravar').click();
await camP.waitForSelector('.badge.rec', { timeout: 10000 });
console.log('câmera começou a gravar junto com o hub');
await hubP.waitForTimeout(3000);
await hubP.getByLabel('Parar gravação').click();
await camP.waitForFunction(() => !document.querySelector('.badge.rec'), null, { timeout: 10000 });
await hubP.getByLabel('Sessões salvas').click();
await hubP.waitForFunction(() => /2 câmeras/.test(document.querySelector('.session-card')?.textContent ?? ''), null, { timeout: 30000 });
console.log('sessão no hub:', (await hubP.locator('.session-card').first().innerText()).replace(/\n/g, ' | '));
await hubP.locator('.session-main').first().click();
await hubP.waitForFunction(() => {
  const vs = [...document.querySelectorAll('.synced-videos video')];
  return vs.length === 1 && vs[0].readyState >= 2;
}, null, { timeout: 20000 });
await hubP.evaluate(() => document.querySelector('video.player-video').play());
await hubP.waitForTimeout(1500);
const t = await hubP.evaluate(() => [document.querySelector('video.player-video').currentTime, document.querySelector('.synced-videos video').currentTime, document.querySelector('.synced-videos video').paused]);
console.log('tempos (principal, outra, outra pausada):', t.map((x) => (typeof x === 'number' ? x.toFixed(2) : x)).join(' · '));
if (t[2]) fail('o vídeo da outra câmera não acompanhou o play');
await hubP.screenshot({ path: `${OUT}/multicam-player.png`, fullPage: true });

// queda: a câmera desconecta e o hub segue
await hubP.evaluate((u) => (location.hash = new URL(u).hash), URL);
await hubP.waitForSelector('.shot-list');
await camP.close();
await hubP.waitForFunction(() => /desconectou/.test(document.body.innerText), null, { timeout: 15000 });
console.log('aviso do hub:', await hubP.getByText(/desconectou/).first().textContent());

await browser.close();
console.log('OK');
