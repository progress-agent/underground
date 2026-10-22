// record-opening-film.mjs: records opening variant 4's film (sprint 21Oct26w, lane V; a throwaway branch).
// usage: node scripts/record-opening-film.mjs <devOrigin> <outDir> [--probe] [--frames=0,2500,4966]
// Run through the GPU lock. Headless Chromium on ANGLE Metal, 1920x1080 at DPR 1, fresh context. Frame k is at t = k * 1000 / 30 ms.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire('/Users/macstudio_1/repos/underground/package.json');
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const [origin, out] = args.filter(a => !a.startsWith('--'));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror ' + e.message));
await page.goto(`${origin}/?film=record`);
const t0 = Date.now();
await page.waitForFunction(() => window.__ugFilm && window.__ugFilm.ready, null, { timeout: 180000, polling: 500 });
console.log('ready after', Date.now() - t0, 'ms');
const info = await page.evaluate(() => {
  window.__ug.setRenderQualityMode('manual');
  const q = window.__ug.renderQuality.get();
  return { focal: window.__ugFilm.focalLength, master: window.__ugFilm.master, quality: q, dpr: devicePixelRatio, w: innerWidth, h: innerHeight,
    kids: window.__ug.scene.children.map(c => `${c.type}:${c.name || ''}:${c.visible}:${c.children?.length ?? 0}`) };
});
console.log(JSON.stringify(info, null, 1));
const raf2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const shoot = async (ms, file) => {
  await page.evaluate(t => window.__ugFilm.renderAt(t), ms);
  await raf2(); await raf2();
  await page.screenshot({ path: file });
};
if (flags.probe) {
  for (const ms of (flags.frames || '0,1000,2500,3300,4966').split(',').map(Number)) await shoot(ms, `${out}/probe-${String(Math.round(ms)).padStart(4, '0')}.png`);
} else {
  const N = info.frames ?? 150;
  for (let k = 0; k < 150; k++) await shoot(k * 1000 / 30, `${out}/f${String(k).padStart(4, '0')}.png`);
}
await writeFile(`${out}/record-info.json`, JSON.stringify({ info, errors }, null, 1));
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
