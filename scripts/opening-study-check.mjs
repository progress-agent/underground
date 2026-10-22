// opening-study-check.mjs: one cold-load smoke run of an opening study preview (sprint 21Oct26w; throwaway branch).
// Usage: node scripts/opening-study-check.mjs <url> <outDir> [shotEveryMs=500]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , url, outDir, every = '500'] = process.argv;
if (!url || !outDir) { console.error('usage: node opening-study-check.mjs <url> <outDir>'); process.exit(2); }
mkdirSync(`${outDir}/shots`, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
await page.addInitScript(() => {
  window.__raf = []; const tick = (t) => { window.__raf.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
});
const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit' });
let n = 0, landed = false, altAtBegin = null;
while (Date.now() - t0 < 70000 && !landed) {
  const file = `${outDir}/shots/${String(n++).padStart(3, '0')}.png`;
  try { await page.screenshot({ path: file }); } catch (e) { errors.push(`shot: ${e.message}`); }
  const st = await page.evaluate(() => {
    const ph = window.__ugOpening?.phases || [];
    return { names: ph.map(p => p.phase), alt: document.getElementById('ug-readout-alt')?.textContent };
  }).catch(() => ({ names: [] }));
  if (st.names?.includes('descent-begin') && altAtBegin === null) altAtBegin = st.alt;
  landed = st.names?.includes('landed');
  await page.waitForTimeout(Number(every));
}
const data = await page.evaluate(() => ({ rec: window.__ugOpening, raf: window.__raf, ref: performance.timeOrigin, now: performance.now() }));
const phases = data.rec?.phases || [];
let longest = { gap: 0, at: 0 };
for (let i = 1; i < data.raf.length; i++) { const g = data.raf[i] - data.raf[i - 1]; if (g > longest.gap) longest = { gap: g, at: data.raf[i - 1] }; }
const phaseAt = (name) => phases.find(p => p.phase === name)?.at;
const lifted = phaseAt('cover-lifted');
const inPhase = (() => { let name = 'start'; for (const p of phases) if (p.at <= longest.at) name = p.phase; return name; })();
let black = null;
try {
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', `${outDir}/shots/%03d.png`, '-vf', `signalstats,metadata=print:file=${outDir}/luma.txt`, '-f', 'null', '-']);
  const txt = (await import('node:fs')).readFileSync(`${outDir}/luma.txt`, 'utf8');
  const yavg = [...txt.matchAll(/YAVG=([\d.]+)/g)].map(m => +m[1]), yhigh = [...txt.matchAll(/YHIGH=([\d.]+)/g)].map(m => +m[1]);
  black = yavg.filter((y, i) => y < 12 && yhigh[i] < 30).length;
} catch (e) { errors.push(`luma: ${e.message}`); }
const last = phases.find(p => p.phase === 'landed');
const rel = (name) => { const a = phaseAt(name); return a == null ? null : Math.round(a); };
const out = { url, phases, phaseMsSinceNav: Object.fromEntries(phases.map(p => [p.phase + (p.mark ? '@' + p.mark : ''), Math.round(p.at)])),
  longestGapMs: Math.round(longest.gap), longestGapAtMs: Math.round(longest.at), longestGapPhase: inPhase, coverUpDuringGap: lifted == null || longest.at < (phaseAt('descent-begin') ?? Infinity),
  blackShots: black, shots: n, errors, altAtDescentBegin: altAtBegin, startAltM: data.rec?.startAltM, vista: data.rec?.vista, params: data.rec?.params, landedCamera: last?.camera };
writeFileSync(`${outDir}/check.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
