// Rastreio seletivo com distrações: compara sem e com (mesa automática + bola escolhida).
// Uso: node e2e/gen-ball-y4m.mjs bola-dist.y4m 6 --distracoes && BALL_Y4M=bola-dist.y4m node e2e/selective.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR ?? '.';
const Y4M = process.env.BALL_Y4M ?? 'bola-dist.y4m';
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };
const TABLE = [[120, 325], [520, 325], [410, 130], [230, 130]];

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('tt.pref.debug', 'true'));
await page.goto(URL);
await page.waitForFunction(() => /fps de análise: [1-9]/.test(document.querySelector('.debug-panel')?.textContent ?? ''), null, { timeout: 15000 });

/** Classifica as detecções: perto da trajetória da bola (x 230..410) ou distração. */
async function measure(ms) {
  await page.evaluate(() => (window.__ttTrack = []));
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const rs = window.__ttTrack;
    let ball = 0, wrong = 0, wrongCands = 0;
    for (const r of rs) {
      for (const c of r.candidates) if (!(c.x > 225 && c.x < 415 && c.y < 320)) wrongCands++;
      const d = r.detection;
      if (!d) continue;
      if (d.x > 230 && d.x < 410 && d.y < 320) ball++;
      else wrong++;
    }
    return { frames: rs.length, ball, wrong, wrongCands };
  });
}

const before = await measure(4000);
console.log('sem calibração e sem bola escolhida:', before);

const vb = await page.locator('video.camera-video').boundingBox();
const cont = await page.evaluate(() => {
  const v = document.querySelector('video.camera-video');
  const s = Math.min(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
  return { s, ox: (v.clientWidth - v.videoWidth * s) / 2, oy: (v.clientHeight - v.videoHeight * s) / 2 };
});
const toPage = (x, y) => [vb.x + cont.ox + x * cont.s, vb.y + cont.oy + y * cont.s];

// Mesa automática
await page.getByLabel('Calibrar mesa').click();
await page.waitForSelector('text=Mesa encontrada', { timeout: 5000 }).catch(() => fail('mesa não detectada automaticamente'));
await page.getByRole('button', { name: 'Salvar' }).click();
const cal = await page.evaluate(() => JSON.parse(localStorage.getItem('tt.calibration.' + localStorage.getItem('tt.cameraId'))));
const err = Math.max(...cal.cornersPx.map((p, i) => Math.hypot(p.x - TABLE[i][0], p.y - TABLE[i][1])));
console.log('mesa automática: maior erro de canto =', err.toFixed(1), 'px', cal.cornersPx.map((p, i) => Math.hypot(p.x - TABLE[i][0], p.y - TABLE[i][1]).toFixed(1)).join(' '));
if (err > 4) fail('cantos automáticos imprecisos');

// Escolher a bola (a bola parada no canto)
await page.locator('.banner-info').click().catch(() => {});
await page.getByLabel('Escolher bola').click();
await page.waitForSelector('.pick-layer');
await page.mouse.click(...toPage(170, 305));
await page.waitForSelector('text=Bola escolhida', { timeout: 3000 }).catch(() => fail('bola não foi escolhida'));
const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('tt.pref.ballProfile')));
console.log('perfil da bola: rgb', [prof.r, prof.g, prof.b].map(Math.round).join(','), 'raio', prof.radiusPx.toFixed(1));

await page.waitForTimeout(500);
const after = await measure(4000);
console.log('com mesa automática + bola escolhida:', after);
await page.screenshot({ path: `${OUT}/seletivo.png` });
if (after.wrongCands > 0) fail(`ainda há ${after.wrongCands} candidatos em distrações`);
if (after.wrong > 0) fail(`ainda há ${after.wrong} detecções em distrações`);
if (after.ball < after.frames * 0.6) fail('poucas detecções da bola');

// Fase 4: a bola do vídeo sintético faz arcos de 1 s entre os dois lados da mesa,
// com uma quebra para cima em cada ponta (como um quique).
await page.locator('.bounce-panel').getByRole('button', { name: 'Zerar' }).click({ timeout: 3000 }).catch((e) => fail('Zerar: ' + e.message));
await page.waitForTimeout(5200);
const panel = (await page.locator('.bounce-panel').textContent()) ?? '';
const m = /(\d+)\s*quiques · perto (\d+) · longe (\d+)/.exec(panel);
console.log('quiques:', panel.replace(/\s+/g, ' ').trim());
if (!m) fail('painel de quiques não apareceu');
const [total, perto, longe] = m.slice(1).map(Number);
if (total < 3 || total > 7) fail(`quiques fora do esperado em 5 s: ${total}`);
if (!perto || !longe) fail('os quiques deveriam alternar entre os lados');
await page.screenshot({ path: `${OUT}/quiques.png` });

// Fase 8: grava ~6 s com a análise ao vivo e abre o relatório da sessão.
await page.getByLabel('Gravar').click();
await page.waitForTimeout(6500);
await page.getByLabel('Parar gravação').click();
await page.waitForSelector('text=Sessão salva', { timeout: 15000 }).catch(() => fail('gravação não foi salva'));
await page.getByLabel('Sessões').click();
await page.locator('[aria-label^="Relatório de"]').first().click();
await page.waitForSelector('.kpis', { timeout: 10000 }).catch(() => fail('relatório sem análise'));
const kpis = (await page.locator('.kpis').textContent()).replace(/\s+/g, ' ');
console.log('relatório:', kpis);
if (!(await page.locator('.chart svg').count())) fail('relatório sem gráficos');
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: /Baixar jogadas/ }).click();
const csv = await (await dl).path().then((p) => import('node:fs').then((fs) => fs.readFileSync(p, 'utf8')));
console.log('CSV:', csv.split('\r\n').length - 2, 'jogadas;', csv.split('\r\n')[0].slice(1, 60));
if (csv.split('\r\n').length < 4) fail('CSV de jogadas vazio');
await page.setViewportSize({ width: 412, height: 915 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/relatorio.png`, fullPage: true });
if (errors.length) fail(errors.join('\n'));
console.log('OK');
await browser.close();
