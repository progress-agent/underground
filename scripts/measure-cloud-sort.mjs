// measure-cloud-sort.mjs: what the clouds' far-to-near re-sort costs a frame
// (sprint 01Oct26h, Lane C, D-043). With every cloud inside the map always
// drawn, every re-sort orders all of them (about 875 clouds, 4,150 puffs), and a
// re-sort that changes the order re-packs and re-uploads the puff buffer.
//
// Usage: node scripts/measure-cloud-sort.mjs <dev origin> [as-lived|weak|both] [seconds] [out.json]
//
// The camera flies level at about 1 km on the altimeter at Deity speed (about
// 900 m/s, so the order changes and the 1,500 m jump rule fires often), west
// to east across the map (18 km in 20 s), while the world clock runs, as in
// use: a re-sort at least once a second. Every call of the cloud system's update() is timed (the re-sort runs
// inside it), and so is every whole frame (the app's tick, which includes the
// render and so the buffer upload). Frames are split into: no re-sort; a
// re-sort that left the order as it was; a re-sort that re-packed the buffer
// (and the frame after it, where the upload lands if the driver defers it).
// Setups as scripts/measure-setups.mjs: as-lived (DPR 2) and weak (DPR 1, CPU
// throttled 4x through CDP); 1440x900, Automatic quality, headless ANGLE Metal.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { SETUPS } from './measure-setups.mjs';

const [origin = 'http://localhost:5234', which = 'both', secondsArg = '20', out = ''] = process.argv.slice(2);
const SECONDS = +secondsArg;

async function run(setup) {
  const S = SETUPS[setup];
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: S.dpr });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__frames = []; window.__fly = null;
    window.requestAnimationFrame = cb => raf(ts => {
      if (cb.name !== 'tick') return cb(ts);
      window.__fly?.(ts);
      const c = window.__ugClouds, s0 = c?.status.sorts ?? 0, w0 = c?.status.rewrites ?? 0;
      window.__upd = 0;
      const t = performance.now(); cb(ts); const ms = performance.now() - t;
      if (window.__fly) window.__frames.push([ms, window.__upd, (c?.status.sorts ?? 0) - s0, (c?.status.rewrites ?? 0) - w0]);
    });
  });
  await page.goto(`${origin}/?fast=1&buildings=baked`);
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ugClouds && window.__ug.landmarkGroup?.children.length, null, { timeout: 240000 });
  if (S.cpuThrottle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle }); }
  const r = await page.evaluate(async (seconds) => {
    const u = window.__ug, c = window.__ugClouds, sleep = ms => new Promise(res => setTimeout(res, ms));
    u.controls.enableDamping = false; u.fpsControls.enabled = false; u.setRenderQualityMode('auto');
    // Time every update() (the app calls it through this object every frame).
    const orig = c.update;
    c.update = a => { const t = performance.now(); orig(a); window.__upd += performance.now() - t; };
    const VE = u.VERTICAL_EXAGGERATION, x0 = -12000, z0 = -4000;
    const y = u.getTerrainMeshSurfaceY({ x: x0, z: z0 }) + 1000 * VE;
    const v = 900; // Deity at ~1 km (alt/500 x 500 units/s)
    let t0 = null;
    u.camera.position.set(x0, y, z0); u.controls.target.set(x0 + 1000, y, z0); u.controls.update();
    await sleep(2000);
    window.__frames.length = 0;
    window.__fly = ts => {
      t0 ??= ts;
      const x = x0 + v * (ts - t0) / 1000;
      u.camera.position.set(x, y, z0); u.controls.target.set(x + 1000, y, z0);
    };
    await sleep(seconds * 1000);
    window.__fly = null;
    c.update = orig;
    return { frames: window.__frames.slice(), level: u.adaptiveQuality.get(), clouds: c.status.visibleClouds, puffs: c.status.instances };
  }, SECONDS);
  await browser.close();
  const F = r.frames;
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : null; };
  const max = a => (a.length ? Math.max(...a) : null);
  const none = F.filter(f => f[2] === 0), same = F.filter(f => f[2] > 0 && f[3] === 0), rewrite = F.filter(f => f[3] > 0);
  const after = F.filter((f, i) => i > 0 && F[i - 1][3] > 0 && f[2] === 0);
  const sum = (set, k) => ({ n: set.length, medMs: med(set.map(f => f[k])), p95Ms: p95(set.map(f => f[k])), maxMs: max(set.map(f => f[k])) });
  const res = {
    setup, frames: F.length, clouds: r.clouds, puffs: r.puffs, automaticAtEnd: r.level,
    update: { noSort: sum(none, 1), sortSameOrder: sum(same, 1), sortRewrite: sum(rewrite, 1) },
    tick: { noSort: sum(none, 0), sortSameOrder: sum(same, 0), sortRewrite: sum(rewrite, 0), frameAfterRewrite: sum(after, 0) },
  };
  const f = o => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, medMs: v.medMs && +v.medMs.toFixed(3), p95Ms: v.p95Ms && +v.p95Ms.toFixed(3), maxMs: v.maxMs && +v.maxMs.toFixed(3) }])));
  console.log(setup.padEnd(9), `frames ${res.frames} clouds ${res.clouds} puffs ${res.puffs}`);
  console.log('  update()', f(res.update));
  console.log('  tick    ', f(res.tick));
  return res;
}

const setups = which === 'both' ? ['as-lived', 'weak'] : [which];
const all = { origin, seconds: SECONDS, host: os.hostname(), loadavg: os.loadavg(), results: {} };
for (const s of setups) all.results[s] = await run(s);
all.loadavgAfter = os.loadavg();
if (out) await writeFile(out, JSON.stringify(all, null, 1));
