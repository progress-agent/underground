// opening-study-check.mjs (s21:V2): one cold load of an opening preview. usage: node opening-study-check.mjs <url> <outDir> [shotEveryMs]
// Headless Chromium on ANGLE Metal, 1440x900 DPR 1, cache disabled; records phases, the longest rAF gap, console errors and shots.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire('/Users/macstudio_1/repos/underground/package.json');
const { chromium } = require('@playwright/test');
const [url, out, every = '500'] = process.argv.slice(2);
await mkdir(`${out}/shots`, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 300)));
await page.addInitScript(() => {
  const R = window.__frames = [];
  const rec = ts => { R.push(ts); requestAnimationFrame(rec); };
  requestAnimationFrame(rec);
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit' });
let n = 0, landed = false;
while (Date.now() - t0 < 60000 && !landed) {
  await page.screenshot({ path: `${out}/shots/${String(n++).padStart(3, '0')}.png` }).catch(() => {});
  landed = await page.evaluate(() => !!window.__ugOpening?.phases?.some(p => p.phase === 'landed')).catch(() => false);
  await new Promise(r => setTimeout(r, Number(every)));
}
await new Promise(r => setTimeout(r, 800));
const data = await page.evaluate(() => ({ opening: window.__ugOpening, frames: window.__frames, now: performance.now(),
  alt: document.getElementById('ug-readout-alt')?.textContent ?? null }));
let longest = { gap: 0, at: 0 };
for (let i = 1; i < data.frames.length; i++) { const g = data.frames[i] - data.frames[i - 1]; if (g > longest.gap) longest = { gap: g, at: data.frames[i - 1] }; }
const ph = data.opening?.phases ?? [];
const bigGaps = [];
for (let i = 1; i < data.frames.length; i++) { const g = data.frames[i] - data.frames[i - 1]; if (g > 80) bigGaps.push({ gap: Math.round(g), at: Math.round(data.frames[i - 1]), after: [...ph].reverse().find(p => p.at <= data.frames[i - 1])?.phase ?? 'before cover-on' }); }
const at = name => ph.find(p => p.phase === name)?.at ?? null;
const inPhase = [...ph].reverse().find(p => p.at <= longest.at)?.phase ?? 'before cover-on';
const res = { url, landed, wallMs: Date.now() - t0, longestGapMs: Math.round(longest.gap), longestGapAtMs: Math.round(longest.at), longestGapAfterPhase: inPhase,
  coverUpDuringGap: !(at('tilt-start') !== null && longest.at > at('tilt-start')) && false,
  phases: ph.map(p => ({ phase: p.phase, at: Math.round(p.at), stage: p.stage })), params: data.opening?.params, startAltM: data.opening?.startAltM, vista: data.opening?.vista,
  bigGaps, errors, shots: n };
await writeFile(`${out}/check.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
