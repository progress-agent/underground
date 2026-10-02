// capture-night.mjs: stills for the night research proof (sprint 02Oct26f, lane R). THROWAWAY.
//
//   node scripts/capture-night.mjs <origin> <outDir> [--query "night=1&buildings=baked"] [--poses a,b,c]
//        [--tag night] [--nobloom] [--w 1440] [--h 900] [--dpr 1] [--time 0.5] [--settle 3500]
//
// Run it through the GPU lock (ug-gpu.sh). Needs a DEV server (window.__ug). Poses:
// the standard views of scripts/measure-setups.mjs plus the night views (look-up
// canopy, the city from 2 km, a street corner, the river). File name:
// <tag>-<pose>[-nobloom].png in outDir.
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const POSES = {
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  streetBank: { p: [2952.9, 337.8, -732.9], t: [1910.1, 196.2, -783.7] },
  riverGreenwich: { p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
  // The city from about 2 km up, looking down the river at the centre.
  city2km: { p: [-1800, 2000, 3400], t: [1500, 0, -300] },
  // Street canyon, closer than streetBank, down a long straight.
  streetClose: { p: [2300, 130, -720], t: [1500, 90, -760] },
  // The DLR viaduct at West India Quay (lit trains on an elevated track), from the surface-train captures.
  dlrViaduct: { p: [7682.2, 192.7, -342.8], t: [7448, 24.5, -110.1] },
  // `rel` poses are ground-relative: p[1] and t[1] are metres-of-scene above the terrain under p.
  // Looking up: a street-level camera over Hyde Park, the canopy overhead.
  lookUp: { rel: true, p: [-3000, 30, -300], t: [-3000 + 120, 30 + 900, -300 - 300] },
  // The moon and the horizon: low, looking south-west over the park.
  lookMoon: { rel: true, p: [-3000, 30, -300], t: [-3000 - 800, 30 + 260, -300 + 560] },
  // Looking up, tilted back less: stars above the skyline from the middle of the park.
  lookSky: { rel: true, p: [-3000, 30, -300], t: [-3000 + 600, 30 + 420, -300 - 600] },
};

function arg(argv, key, fallback) {
  const i = argv.indexOf(`--${key}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export async function capture({ origin, outDir, query, poses, tag, noBloom, w, h, dpr, time, settleMs, ready = true }) {
  const { chromium } = await import('@playwright/test');
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/?fast=1&${query}`);
    await page.waitForFunction(() => window.__ug, null, { timeout: 90000 });
    if (ready) {
      await page.waitForFunction(() => {
        const u = window.__ug;
        const baked = u.bakedStats && u.bakedStats.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal;
        return u.groundReady && u.flightsGroup && u.motorwayGroup && u.landmarkGroup?.children.length && (baked || u.buildingsPath === 'live');
      }, null, { timeout: 240000 }).catch(() => {});
    }
    // Hold full quality (no Automatic rung changes) and a fixed sun-slider time.
    await page.evaluate(({ time }) => {
      const u = window.__ug; u.controls.enableDamping = false;
      try { u.setRenderQualityMode('full'); } catch {}
      if (time != null && window.__ugSun) window.__ugSun.setTime(time, { persist: false });
    }, { time });
    const bloomModes = noBloom === 'both' ? [true, false] : [noBloom ? false : true];
    for (const name of poses) {
      const pose = POSES[name]; if (!pose) throw new Error(`unknown pose ${name}`);
      await page.evaluate(pose => {
        const u = window.__ug; const p = [...pose.p], t = [...pose.t];
        if (pose.rel) { const g = u.getTerrainMeshSurfaceY({ x: p[0], z: p[2] }) ?? 0; p[1] += g; t[1] += g; }
        u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
      }, pose);
      await page.waitForTimeout(settleMs);
      for (const bloom of bloomModes) {
        await page.evaluate(b => { window.__ug.bloomPass.enabled = b; }, bloom);
        await page.waitForTimeout(700);
        const file = `${outDir}/${tag}-${name}${bloom ? '' : '-nobloom'}.png`;
        await page.screenshot({ path: file });
        console.log(file);
      }
    }
    await page.evaluate(() => { window.__ug.bloomPass.enabled = true; });
  } finally { await browser.close(); }
  if (errors.length) console.log(`console/page errors: ${errors.length}\n` + errors.slice(0, 6).join('\n'));
  return errors;
}

async function main() {
  const argv = process.argv.slice(2);
  const [origin, outDir] = argv;
  if (!origin || !outDir) { console.log('usage: node scripts/capture-night.mjs <origin> <outDir> [--query q] [--poses a,b] [--tag t] [--nobloom|--nobloom both]'); process.exitCode = 2; return; }
  const nb = arg(argv, 'nobloom', false);
  await capture({
    origin, outDir,
    query: arg(argv, 'query', 'buildings=baked'),
    poses: String(arg(argv, 'poses', 'overview,streetBank,riverGreenwich')).split(','),
    tag: arg(argv, 'tag', 'shot'),
    noBloom: nb === true ? true : nb === 'both' ? 'both' : false,
    w: +arg(argv, 'w', 1440), h: +arg(argv, 'h', 900), dpr: +arg(argv, 'dpr', 1),
    time: arg(argv, 'time', null) == null ? null : +arg(argv, 'time', null),
    settleMs: +arg(argv, 'settle', 3500),
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}
