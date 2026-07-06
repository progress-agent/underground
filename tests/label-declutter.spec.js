// Label declutter / performance policy (Wave 4).
// Verifies the altitude-aware distance fade + screen-grid declutter:
//   (a) overview pose shows a decluttered set (not the old 248-label wall)
//   (b) overview frame average is well under the pre-fix ~65ms
//   (c) street level still shows nearby labels
//
// Run: npx playwright test tests/label-declutter.spec.js
import { test, expect } from '@playwright/test';

test('Wave 4: label declutter + perf at overview, labels at street', async ({ page }) => {
  // ?fast=1 — any URL param skips the cinematic intro (see intro.js shouldSkipByUrl)
  await page.goto('/?fast=1', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () => window.__ug && window.__ug.camera && window.__ug.controls,
    { timeout: 30000 },
  );
  // Settle terrain mesh + shafts so surfaceY is resolved for the labels.
  await page.waitForTimeout(5000);

  async function setPose(cam, tgt) {
    await page.evaluate(({ cam, tgt }) => {
      const { camera, controls } = window.__ug;
      controls.target.set(tgt[0], tgt[1], tgt[2]);
      camera.position.set(cam[0], cam[1], cam[2]);
      controls.update();
      camera.updateMatrixWorld(true);
    }, { cam, tgt });
    await page.waitForTimeout(2000);
  }

  const visibleSurfaceLabels = () => page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('.station-label-surface')) {
      const s = getComputedStyle(el);
      if (s.display !== 'none' && parseFloat(s.opacity) > 0.05) n++;
    }
    return n;
  });

  // ── (a) Overview pose: decluttered count ────────────────────────
  await setPose([0, 20000, 12000], [0, 0, 0]);
  const overviewCount = await visibleSurfaceLabels();
  expect(overviewCount).toBeGreaterThanOrEqual(10);
  expect(overviewCount).toBeLessThanOrEqual(90);

  await page.waitForTimeout(3000); // let surface tiles finish streaming for this pose

  // ── (b) Overview frame average over 2s ──────────────────────────
  // The pre-fix overview frame was ~65ms (labels ~75% of it) with 248
  // always-visible blurred chips repositioned + repainted every frame. The
  // decluttered + dirty-checked build lands far below that.
  //
  // Threshold note: on a headed macOS browser the true steady-state frame time
  // (foreground, warm tile cache) is ~24ms — see scripts/capture-labels.mjs —
  // but the in-harness figure carries the app's own tile-streaming/GPU-contention
  // variance (measured 40-52ms for the fixed build vs ~68ms for the regression).
  // We assert < 55ms: comfortably clears the fixed build while still failing the
  // wall-of-text regression. The tight, environment-independent guard is the
  // visible-label count above (248 -> ~60), which is what actually bounds the
  // per-frame paint cost.
  const timing = await page.evaluate(() => new Promise((res) => {
    const samples = [];
    let last = performance.now();
    const t0 = last;
    function tick(now) {
      samples.push(now - last);
      last = now;
      if (now - t0 < 2000) requestAnimationFrame(tick);
      else {
        samples.splice(0, 10); // drop warm-up frames
        const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
        res({ avg, frames: samples.length });
      }
    }
    requestAnimationFrame(tick);
  }));
  console.log(`Overview frame avg: ${timing.avg.toFixed(1)}ms over ${timing.frames} frames`);
  expect(timing.avg).toBeLessThan(55);

  // ── (c) Street level: nearby labels visible ─────────────────────
  await setPose([0, 60, 800], [0, 40, 0]);
  const streetCount = await visibleSurfaceLabels();
  expect(streetCount).toBeGreaterThan(0);
});
