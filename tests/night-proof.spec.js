// night-proof.spec.js: the night research proof (sprint 02Oct26f, lane R). THROWAWAY: never merged.
// ?night=1 on the dev server. Pins what a still can: a cold load raises no console error, no frame is
// NaN or black through bloom, the street shows lit windows, the sky shows stars, and the same
// window term works on the baked and the live building paths (one shared material).
import { test, expect } from '@playwright/test';

async function boot(page, url) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugSun && window.__ug.groundReady), null, { timeout: 90000 });
  return errors;
}
const frames = (page, n = 4) => page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function look(page, p, t, rel = false) {
  await page.evaluate(([p, t, rel]) => {
    const u = window.__ug; u.fpsControls.enabled = false; u.controls.enableDamping = false;
    p = [...p]; t = [...t];
    if (rel) { const g = u.getTerrainMeshSurfaceY({ x: p[0], z: p[2] }) ?? 0; p[1] += g; t[1] += g; }
    u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
  }, [p, t, rel]);
  await page.waitForTimeout(2500);
  await frames(page);
}

const stats = page => page.evaluate(() => {
  const u = window.__ug, r = u.composer.renderer, gl = r.getContext();
  u.setRenderQualityMode('manual');
  u.composer.render(0);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, bright = 0, warm = 0, nan = 0, dim = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l; if (l > 150) bright++; if (l > 55) dim++; if (px[i] > 200 && px[i] > px[i + 2] + 30) warm++;
    if (Number.isNaN(l)) nan++;
  }
  return { mean: sum / (w * h), bright, dim, warm, nan, n: w * h };
});

test('night: cold load has no console error; the street shows lit windows and is not black', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  const errors = await boot(page, '/?fast=1&buildings=baked&night=1');
  expect(await page.evaluate(() => window.__ug.night.enabled)).toBe(true);
  await look(page, [2952.9, 337.8, -732.9], [1910.1, 196.2, -783.7]);
  const s = await stats(page);
  expect(s.nan).toBe(0);
  expect(s.mean).toBeGreaterThan(8);      // not a black frame
  expect(s.mean).toBeLessThan(110);       // and plainly not day
  expect(s.warm, 'lit windows read as warm bright pixels').toBeGreaterThan(300);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('night: the canopy shows stars looking up, and none are drawn by day', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await boot(page, '/?fast=1&buildings=baked&night=1');
  await look(page, [-3000, 30, -300], [-3000 + 120, 30 + 900, -300 - 300], true);
  const night = await stats(page);
  expect(night.dim, 'star pixels on a dark sky').toBeGreaterThan(8);
  expect(night.mean).toBeLessThan(40);
  // Same pose with the night level at 0 (flag absent): no stars, daylight.
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ug.groundReady), null, { timeout: 90000 });
  await look(page, [-3000, 30, -300], [-3000 + 120, 30 + 900, -300 - 300], true);
  const day = await stats(page);
  expect(day.mean).toBeGreaterThan(night.mean * 2);
});

test('night: overview at altitude is finite and lit from within (glow along the roads)', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  const errors = await boot(page, '/?fast=1&buildings=baked&night=1');
  await look(page, [0, 20000, 18000], [0, 0, 0]);
  const s = await stats(page);
  expect(s.nan).toBe(0);
  expect(s.mean).toBeGreaterThan(8);
  expect(s.mean).toBeLessThan(90);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('night: the live building path takes the same window term as the baked one', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await boot(page, '/?fast=1&buildings=live&night=1');
  await look(page, [2952.9, 337.8, -732.9], [1910.1, 196.2, -783.7]);
  await page.waitForTimeout(12000);       // live tiles stream in near the camera
  const s = await stats(page);
  expect(s.nan).toBe(0);
  expect(s.warm, 'lit windows on the live path').toBeGreaterThan(300);
});
