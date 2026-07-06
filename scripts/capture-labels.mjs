// Ad-hoc label declutter capture: 3 poses + overview frame timing.
// Usage: node scripts/capture-labels.mjs <outDir>
import { chromium } from '@playwright/test';

const outDir = process.argv[2] || '/tmp/label-cap';

const POSES = {
  overview: { cam: [0, 20000, 12000], tgt: [0, 0, 0] },
  oblique:  { cam: [25000, 8000, 25000], tgt: [0, 0, 0] },
  street:   { cam: [0, 60, 800], tgt: [0, 40, 0] },
};

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?fast=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelector('#loadingBar')?.classList.contains('done'),
  { timeout: 90000 });
await page.waitForFunction(() => window.__ug?.camera && window.__ug?.controls, { timeout: 30000 });
await page.waitForTimeout(5000);

async function setPose(cam, tgt) {
  await page.evaluate(({ cam, tgt }) => {
    const { camera, controls } = window.__ug;
    controls.target.set(tgt[0], tgt[1], tgt[2]);
    camera.position.set(cam[0], cam[1], cam[2]);
    controls.update();
    camera.updateMatrixWorld(true);
  }, { cam, tgt });
  await page.waitForTimeout(2500);
}

async function countVisible() {
  return await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('.station-label-surface')) {
      const s = getComputedStyle(el);
      if (s.display !== 'none' && parseFloat(s.opacity) > 0.05) n++;
    }
    return n;
  });
}

async function measure(ms) {
  return await page.evaluate((dur) => new Promise((res) => {
    const samples = [];
    let last = performance.now();
    const t0 = last;
    function tick(now) {
      samples.push(now - last);
      last = now;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else {
        samples.shift();
        samples.sort((a, b) => a - b);
        const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
        const p95 = samples[Math.floor(samples.length * 0.95)];
        res({ avg, p95, frames: samples.length });
      }
    }
    requestAnimationFrame(tick);
  }), ms);
}

const results = {};
for (const [name, p] of Object.entries(POSES)) {
  await setPose(p.cam, p.tgt);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  results[name] = { visibleSurfaceLabels: await countVisible() };
}
// Overview timing (3s)
await setPose(POSES.overview.cam, POSES.overview.tgt);
results.overviewTiming = await measure(3000);
results.overviewVisibleLabels = await countVisible();

console.log(JSON.stringify(results, null, 2));
await browser.close();
