// measure-cloud-thinning.mjs: how much of the layer shows from above (sprint 25Sep26f, Lane C).
//
// Jordan: above the clouds the layer thins to about a third. This measures it
// in the rendered picture: at each pose, the mean per-pixel change the clouds
// make (clouds on minus clouds off, luminance) with the thinning off and on.
// The ratio thinned / unthinned is the visible density left above the layer.
// Usage: node scripts/measure-cloud-thinning.mjs <dev origin> [out.json] [alpha ...]
//   Each optional alpha (a number, 0..1) is tried in turn in place of the built
//   CLOUD_CONFIG.above.alpha (calibration; the build is not changed).
// Sprint 30Sep26w (D-041) recalibrated it for 1.25 oktas and 3 to 7 puffs a
// cloud. Sprint 01Oct26h (D-043): the thinning is one fade of the whole layer
// (opacity only, every puff kept), so the only constant is the layer's opacity
// above it; on builds before D-043 pass "alpha,keep" pairs for the old
// per-puff thinAlpha / thinKeep instead. See CLOUD_CONFIG in src/clouds.js.
//   --climb   instead of the three poses, measure the ratio through the climb:
//             looking 25 degrees down, at display heights from 500 m below the
//             layer's mean top to 1,500 m above it (D-043 builds only).
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import UPNG from 'upng-js';

const args = process.argv.slice(2);
const isTrial = a => /^[0-9.]+(,[0-9.]+)?$/.test(a);
const pairs = args.filter(isTrial).map(a => a.split(',').map(Number));
const climb = args.includes('--climb');
const [origin = 'http://localhost:5214', out = ''] = args.filter(a => !isTrial(a) && a !== '--climb');
const POSES = {
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  above: { p: [-2500, 14000, 9000], t: [1500, 2500, -6000] },
  straightDown: { p: [0, 16000, 0], t: [0, 0, -1] },
};
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
await page.goto(`${origin}/?fast=1&buildings=baked`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
  && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
  && window.__ug.groundReady && window.__ugClouds, null, { timeout: 240000 });
await page.evaluate(() => {
  const u = window.__ug; u.controls.enableDamping = false;
  u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
  window.__ugClouds.setTimeOverride(900);
  for (const id of ['hudDetails']) document.getElementById(id)?.removeAttribute('open');
  // DOM overlays (labels, HUD) are the same in every frame and cancel out.
});
const lum = png => {
  const img = UPNG.decode(png), px = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const l = new Float32Array(px.length / 4);
  for (let i = 0; i < l.length; i++) l[i] = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
  return l;
};
let poses = POSES;
if (climb) {
  // Display heights relative to the mean top: canonical y = display / ratio.
  const { ratio, top } = await page.evaluate(() => ({ ratio: window.__ug.masterHeight.ratio, top: window.__ugClouds.status.meanTopM }));
  const down = Math.tan(25 * Math.PI / 180) / ratio;
  poses = Object.fromEntries([-500, 0, 250, 500, 750, 1000, 1500].map(h => {
    const y = (top + h) / ratio;
    return [`top${h >= 0 ? '+' : ''}${h}`, { p: [0, y, 9000], t: [0, y - down * 1000, 8000] }];
  }));
  console.log(`mean top ${top.toFixed(0)} m (display), ratio ${ratio}`);
}
const results = {};
for (const pair of pairs.length ? pairs : [null]) {
  if (pair) {
    await page.evaluate(([a, k]) => {
      const c = window.__ugClouds;
      if (k === undefined) c.config.above.alpha = a; // D-043: the layer's opacity above it
      else { const u = c.material.uniforms; u.uThinAlpha.value = a; u.uThinKeep.value = k; }
    }, pair);
    console.log(pair.length === 1 ? `above.alpha ${pair[0]}` : `thinAlpha ${pair[0]}, thinKeep ${pair[1]}`);
  }
  const tag = pair ? pair.join(',') : 'built';
  results[tag] = {};
  for (const [name, pose] of Object.entries(poses)) {
    const shot = async (on, thin) => {
      await page.evaluate(({ pose, on, thin }) => {
        const u = window.__ug, c = window.__ugClouds;
        c.setEnabled(on); c.setThinning(thin); c.setShadowsEnabled(false); // sprites only
        u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
      }, { pose, on, thin });
      await page.waitForTimeout(1500);
      return lum(await page.screenshot());
    };
    const off = await shot(false, true), full = await shot(true, false), thin = await shot(true, true);
    const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    const dFull = diff(full, off), dThin = diff(thin, off);
    results[tag][name] = { unthinned: +dFull.toFixed(2), thinned: +dThin.toFixed(2), ratio: +(dThin / dFull).toFixed(3) };
    console.log(name.padEnd(13), JSON.stringify(results[tag][name]));
  }
}
if (out) await writeFile(out, JSON.stringify({ origin, when: new Date().toISOString(), results }, null, 1));
await browser.close();
