import { test, expect } from '@playwright/test';

for (const dpr of [1, 2]) {
  test(`post-processing uses display pixels once at DPR ${dpr}, before and after resize`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      await page.goto('/?fast=1&buildings=baked');
      await page.waitForFunction(() => window.__ug?.composer);
      await page.evaluate(() => window.__ug.setRenderQualityMode?.('manual'));
      const dimensions = () => page.evaluate(() => {
        const { composer, bloomPass } = window.__ug;
        return {
          canvas: [composer.renderer.domElement.width, composer.renderer.domElement.height],
          scene: [composer.renderTarget1.width, composer.renderTarget1.height],
          bloom: [bloomPass.renderTargetBright.width, bloomPass.renderTargetBright.height],
          samples: [composer.renderTarget1.samples, composer.renderTarget2.samples],
        };
      });
      expect(await dimensions()).toEqual({ canvas: [1000*dpr, 700*dpr], scene: [1000*dpr, 700*dpr], bloom: [500*dpr, 350*dpr], samples: [4, 0] });
      await page.setViewportSize({ width: 1200, height: 800 });
      await expect.poll(dimensions).toEqual({ canvas: [1200*dpr, 800*dpr], scene: [1200*dpr, 800*dpr], bloom: [600*dpr, 400*dpr], samples: [4, 0] });
    } finally { await context.close(); }
  });
}

test('steady keyboard flight follows frame timestamps despite variable callback delay', async ({ page }) => {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__pacingProbe = { active: false, steps: [] };
    let syntheticTime, n = 0;
    window.requestAnimationFrame = callback => raf(time => {
      const probe = window.__pacingProbe;
      if (callback.name !== 'tick' || !probe.active) { callback(time); return; }
      syntheticTime ??= time;
      syntheticTime += 1000 / 60;
      // Same display cadence, different delay before the app's callback runs.
      if (n++ % 2) { const end = performance.now() + 8; while (performance.now() < end) {} }
      const before = window.__ug.camera.position.clone();
      callback(syntheticTime);
      probe.steps.push(before.distanceTo(window.__ug.camera.position));
    });
  });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal);
  await page.evaluate(() => {
    const u = window.__ug;
    u.camera.position.set(0, -5000, 0); u.controls.target.set(1000, -5000, 0); u.controls.update();
    // Isolate camera integration from GPU throughput and asset startup.
    u.composer.render = () => {};
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__ug.fpsControls.keys.add('w'); window.__pacingProbe.active = true; });
  await page.waitForFunction(() => window.__pacingProbe.steps.length >= 24);
  const steps = await page.evaluate(() => { window.__pacingProbe.active = false; window.__ug.fpsControls.keys.clear(); return window.__pacingProbe.steps.slice(2); });
  // Deep chalk: 500 units/s * 0.5 substrate factor / 60 display frames/s.
  for (const step of steps) expect(step).toBeCloseTo(250/60, 4);
});

test('keyboard flight clears a lingering tooltip and avoids its GPU readback', async ({ page }) => {
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.groundReady);
  await page.evaluate(() => {
    const gl = window.__ug.composer.renderer.getContext();
    const read = gl.readPixels.bind(gl);
    window.__tooltipReads = 0;
    gl.readPixels = (...args) => { window.__tooltipReads++; return read(...args); };
    const tip = document.getElementById('hoverTip');
    tip.innerHTML = '<b>Existing station hover</b>';
    tip.style.display = 'block'; tip.style.transform = 'translate(100px,100px)';
    window.__ug.cushionLuma.sample();
  });
  expect(await page.evaluate(() => window.__tooltipReads)).toBeGreaterThan(0);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__ug.fpsControls.active);
  await expect(page.locator('#hoverTip')).toBeHidden();
  await page.evaluate(() => { window.__tooltipReads = 0; });
  await page.mouse.move(400, 350);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__tooltipReads)).toBe(0);
  await page.keyboard.up('KeyW');
});
