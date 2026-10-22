// opening-study-check.mjs: one cold-load smoke check of an opening study preview (sprint 21Oct26w, lane V; throwaway).
// usage: node scripts/opening-study-check.mjs <url> <outDir> [--query=...] [--noshots]
// Headless Chromium on ANGLE Metal, fresh context, 1440x900 at DPR 1, HTTP cache disabled. Run through the GPU lock.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire('/Users/macstudio_1/repos/underground/package.json');
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const [url, out] = args.filter(a => !a.startsWith('--'));
await mkdir(`${out}/shots`, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
await page.addInitScript(() => {
  const R = window.__chk = { raf: [], vfc: [], shots: 0 };
  const rec = ts => { R.raf.push(ts); requestAnimationFrame(rec); };
  requestAnimationFrame(rec);
  const hook = () => {
    const v = document.getElementById('ugFilm');
    if (!v) return setTimeout(hook, 20);
    const cb = (now, md) => { R.vfc.push([now, md.presentedFrames, md.mediaTime]); if (v.isConnected) v.requestVideoFrameCallback(cb); };
    try { v.requestVideoFrameCallback(cb); } catch (e) {}
  };
  document.addEventListener('DOMContentLoaded', hook);
});
const t0 = Date.now();
await page.goto(url + (flags.query || ''));
let landed = false, n = 0;
while (Date.now() - t0 < 70000) {
  if (!flags.noshots) await page.screenshot({ path: `${out}/shots/${String(n++).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 70 }).catch(() => {});
  const st = await page.evaluate(() => (window.__ugOpening?.phases || []).some(p => p.phase === 'landed')).catch(() => false);
  if (st) { landed = true; break; }
  await page.waitForTimeout(450);
}
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  const o = window.__ugOpening, R = window.__chk;
  const raf = R.raf, gaps = [];
  for (let i = 1; i < raf.length; i++) gaps.push([raf[i] - raf[i - 1], raf[i - 1]]);
  gaps.sort((a, b) => b[0] - a[0]);
  const mode = [...document.querySelectorAll('#ug-mode-bar button, #ug-mode-bar [aria-pressed], #ug-mode-bar .active')].map(e => `${e.textContent.trim()}:${e.getAttribute('aria-pressed') ?? e.className}`);
  const alt = document.getElementById('ug-readout-alt')?.textContent;
  return { opening: o, longestGaps: gaps.slice(0, 5), vfc: R.vfc, mode, alt, errorsDom: 0 };
});
const phases = res.opening?.phases ?? [];
const at = id => phases.find(p => p.phase === id)?.at;
const lg = res.longestGaps[0];
let phaseOfGap = null;
if (lg) { const order = phases.filter(p => p.at <= lg[1]); phaseOfGap = order.length ? order[order.length - 1].phase : 'before cover-on'; }
// frames presented by the film during the longest gap vs expected at 30 fps
let filmGap = null;
if (lg) {
  const a = lg[1], b = lg[1] + lg[0];
  const inside = res.vfc.filter(r => r[0] >= a && r[0] <= b);
  const before = res.vfc.filter(r => r[0] < a).pop(), after = res.vfc.find(r => r[0] > b);
  if (before && after) filmGap = { presented: after[1] - before[1], expectedAt30fps: Math.round((after[0] - before[0]) / 33.33), callbacksInside: inside.length };
}
const check = { url, landed, phases: phases.map(p => ({ phase: p.phase, at: Math.round(p.at), stage: p.stage })), longestGaps: res.longestGaps.map(g => [Math.round(g[0]), Math.round(g[1])]),
  phaseOfLongestGap: phaseOfGap, filmGap, mode: res.mode, alt: res.alt, errors, params: res.opening?.params,
  timings: Object.fromEntries(['cover-on', 'film-start', 'film-end', 'film-hold', 'handover', 'cover-lifted', 'descent-begin', 'crossing', 'landed'].map(k => [k, at(k) ? Math.round(at(k)) : null])) };
await writeFile(`${out}/check.json`, JSON.stringify(check, null, 1));
console.log(JSON.stringify(check, null, 1));
await browser.close();
