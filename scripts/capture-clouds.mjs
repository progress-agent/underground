// capture-clouds.mjs: before/after captures of the cloud layer (sprint 25Sep26f, Lane C).
//
// Usage: node scripts/capture-clouds.mjs <origin> <outDir> [shot,shot,...]
//   origin  a dev server (window.__ug and window.__ugClouds are dev-only)
// Each shot is captured with the clouds OFF ("before") and ON ("after") at the
// same pose, sun time and world time, Manual quality at 100% and MSAA 4x.
// Headless Chromium with ANGLE Metal (real GPU), 1440x900 at DPR 1.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [origin = 'http://localhost:5206', outDir = './cloud-captures', only = ''] = process.argv.slice(2);
const T_WORLD = 900; // seconds on the world clock: the same sky in every shot

// Poses are canonical scene coordinates (x east, y up at VE5, z south) at the
// default Master 1.1: the camera's display height is y x 0.22.
export const SHOTS = {
  overview: { label: 'Overview of the city from about 4.4 km (display)', p: [0, 20000, 18000], t: [0, 0, 0] },
  street: { label: 'Street near Bank looking up at the sky', p: [2952.9, 337.8, -732.9], t: [1900, 3300, -300] },
  above: { label: 'Above the clouds, about 3 km up, looking over the layer', p: [-2500, 14000, 9000], t: [1500, 2500, -6000] },
  dawn: { label: 'Dawn: from about 330 m, looking east towards the low sun', p: [-3000, 1500, 3000], t: [5000, 7200, -1000], sun: 0.02 },
  dusk: { label: 'Dusk: from about 330 m, looking west towards the low sun', p: [3000, 1500, 3000], t: [-5000, 7200, -1000], sun: 0.98 },
  morningLow: { label: 'Default morning from the same spot as dawn, for comparison', p: [-3000, 1500, 3000], t: [5000, 7200, -1000] },
  shadows: { label: 'Cloud shadows on the city at midday, looking down from about 3.3 km through the thinned layer', p: [0, 15000, 6000], t: [0, 0, 1500], sun: 0.5 },
  edge: { label: 'Towards the northern M25 edge from about 2.6 km up', p: [3000, 12000, -4000], t: [5000, 0, -21000] },
};

const names = only ? only.split(',') : Object.keys(SHOTS);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${origin}/?fast=1&buildings=baked`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
  && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
  && window.__ug.groundReady && window.__ugClouds, null, { timeout: 240000 });
await page.evaluate((tw) => {
  const u = window.__ug; u.controls.enableDamping = false;
  u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
  window.__ugSun.setShadowsEnabled(true, { persist: false });
  window.__ugClouds.setTimeOverride(tw);
  document.getElementById('hudDetails')?.removeAttribute('open');
}, T_WORLD);

const index = [];
for (const name of names) {
  const s = SHOTS[name];
  if (!s) throw new Error(`unknown shot ${name}`);
  for (const phase of ['before', 'after']) {
    await page.evaluate(({ s, on }) => {
      const u = window.__ug;
      window.__ugSun.setTime(s.sun ?? window.__ugSun.DEFAULT_SUN_TIME, { persist: false });
      window.__ugClouds.setEnabled(on);
      u.camera.position.fromArray(s.p); u.controls.target.fromArray(s.t); u.controls.update();
    }, { s, on: phase === 'after' });
    await page.waitForTimeout(1800);
    const file = `${name}-${phase}.png`;
    await page.screenshot({ path: join(outDir, file) });
    const st = await page.evaluate(() => { const c = window.__ugClouds.status; return { visibleClouds: c.visibleClouds, instances: c.instances, shadow: +c.shadowStrength.toFixed(3), opacity: c.opacity }; });
    index.push({ file, shot: name, phase, label: s.label, pose: { p: s.p, t: s.t, sun: s.sun ?? 'default' }, status: st });
    console.log(file, JSON.stringify(st));
  }
}
await writeFile(join(outDir, 'captures.json'), JSON.stringify({ origin, worldTime: T_WORLD, errors, index }, null, 1));
if (errors.length) console.log('page errors:', errors);
await browser.close();
