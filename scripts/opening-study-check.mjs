// Smoke check for the opening study previews (sprint 21Oct26w, lane V). Usage: node scripts/opening-study-check.mjs <url> <outDir>
// Cold headless Chromium (ANGLE Metal), 1440x900 at DPR 1, HTTP cache off; one screenshot every 500 ms until landed or 60 s.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire('/Users/macstudio_1/repos/underground/package.json');
const { chromium } = require('@playwright/test');
const [url, out] = process.argv.slice(2);
await mkdir(`${out}/shots`, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.addInitScript(() => {
  const R = window.__frames = [];
  const rec = ts => { R.push(ts); requestAnimationFrame(rec); };
  requestAnimationFrame(rec);
  window.__landed = false;
  window.addEventListener('ug:intro-done', () => { window.__landed = true; window.__landedPos = null; }, { once: true });
  window.addEventListener('ug:opening-phase', e => { if (e.detail.phase === 'descent-begin') { const a = document.getElementById('ug-readout-alt'); window.__altAtBegin = a ? a.textContent : null; } });
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit' });
let n = 0;
while (Date.now() - t0 < 60000) {
  const landed = await page.evaluate(() => window.__landed).catch(() => false);
  await page.screenshot({ path: `${out}/shots/${String(n++).padStart(3, '0')}.png` }).catch(() => {});
  if (landed) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
const data = await page.evaluate(() => ({
  phases: window.__ugOpening?.phases ?? null, startAltM: window.__ugOpening?.startAltM, vista: window.__ugOpening?.vista, params: window.__ugOpening?.params,
  frames: window.__frames, altAtBegin: window.__altAtBegin,
  cam: window.__ugCam || null,
}));
let gap = 0, gapAt = 0;
for (let i = 1; i < data.frames.length; i++) { const g = data.frames[i] - data.frames[i - 1]; if (g > gap) { gap = g; gapAt = data.frames[i - 1]; } }
const ph = data.phases ?? [];
const lifted = ph.find(p => p.phase === 'cover-lifted')?.at ?? null;
const landed = ph.find(p => p.phase === 'landed');
const res = {
  url, phases: ph.map(p => ({ phase: p.phase, atMs: Math.round(p.at), stage: p.stage, fraction: +(p.fraction ?? 0).toFixed(2) })),
  longestGapMs: Math.round(gap), longestGapAtMs: Math.round(gapAt), gapPhase: lifted !== null && gapAt < lifted ? 'before cover-lifted (cover was up)' : 'after cover-lifted',
  errors, readoutAtDescentBegin: data.altAtBegin, startAltM: data.startAltM, vista: data.vista, params: data.params,
  landedPos: landed ? { x: landed.x, y: landed.y, z: landed.z } : null, shots: n,
};
await writeFile(`${out}/check.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
