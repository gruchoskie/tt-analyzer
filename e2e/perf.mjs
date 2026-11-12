// Mede o peso no thread principal durante a gravação (CPU desacelerada para
// parecer um celular). Uso: npm run build && npx vite preview --port 4173 &
//   node e2e/gen-ball-y4m.mjs e2e/bola-dist.y4m 6 --distracoes && BALL_Y4M=e2e/bola-dist.y4m node e2e/perf.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.APP_URL ?? 'http://localhost:4173/';
const Y4M = process.env.BALL_Y4M ?? 'e2e/bola-dist.y4m';
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const POSE = process.env.POSE === '1';

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
await page.addInitScript((pose) => {
  localStorage.setItem('tt.pref.debug', 'true');
  if (pose) localStorage.setItem('tt.pref.showPose', 'true');
  // mesa já calibrada (a do vídeo sintético)
  window.__perf = { gaps: [], long: 0, longN: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__perf.long += e.duration;
        window.__perf.longN++;
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {}
  let last = 0;
  const raf = (t) => {
    if (last) window.__perf.gaps.push(t - last);
    last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}, POSE);
await page.goto(URL);
await page.waitForFunction(() => /fps de análise: [1-9]/.test(document.querySelector('.debug-panel')?.textContent ?? ''), null, { timeout: 15000 });
// mesa automática
await page.getByLabel('Calibrar mesa').click();
await page.waitForSelector('text=Mesa encontrada', { timeout: 5000 });
await page.getByRole('button', { name: 'Salvar' }).click();
if (POSE) await page.waitForTimeout(4000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

async function window_(ms) {
  await page.evaluate(() => (window.__perf = { ...window.__perf, gaps: [], long: 0, longN: 0 }));
  await page.waitForTimeout(ms);
  return page.evaluate((ms) => {
    const g = window.__perf.gaps.sort((a, b) => a - b);
    const dbg = document.querySelector('.debug-panel')?.textContent ?? '';
    const m = (re) => (dbg.match(re) ?? [])[1];
    return {
      rafFps: +(1000 * g.length / ms).toFixed(1),
      p95GapMs: Math.round(g[Math.floor(g.length * 0.95)] ?? 0),
      maxGapMs: Math.round(g[g.length - 1] ?? 0),
      longTaskMsPerS: Math.round((window.__perf.long / ms) * 1000),
      camFps: m(/fps medido: ([\d.]+)/),
      analysisFps: m(/fps de análise: ([\d.]+)/),
    };
  }, ms);
}
console.log('ociosa (sem gravar):', await window_(4000));
await page.getByLabel('Gravar').click();
await page.waitForSelector('.badge.rec');
console.log('gravando:', await window_(6000));
await page.getByLabel('Parar gravação').click();
await browser.close();
