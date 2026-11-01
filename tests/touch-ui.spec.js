// touch-ui.spec.js: the phone layout in the real app (D-058, 01Nov26u). An emulated iPhone (coarse pointer, no hover,
// real touch events through CDP) in both orientations: the layout swaps in, the rotate wall stays away, the mode bar
// switches bodies, the thumbstick drives a body and Deity through the real key path, Fast latches Shift, drag looks,
// a tap pins the info under it,
// and no key is left held. The stick's key mapping is pinned in touch-ui.test.mjs; this spec proves the wiring.
//
// Timing is gated on SIMULATED time (the modes' ctx.time), as modes-drone-balloon.spec.js explains.

import { test, expect, devices } from '@playwright/test';

async function boot(page, url = '/?skip=1') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
}

const simFor = (page, seconds, maxFrames = 3000) => page.evaluate(async ({ seconds, maxFrames }) => {
  const ctx = window.__ug.modes.ctx, t0 = ctx.time || 0;
  for (let i = 0; i < maxFrames && (ctx.time || 0) - t0 < seconds; i++) {
    await new Promise(r => requestAnimationFrame(r));
  }
}, { seconds, maxFrames });

const camPos = (page) => page.evaluate(() => { const p = window.__ug.camera.position; return { x: p.x, y: p.y, z: p.z }; });

// The iPhone descriptors name WebKit as their browser; the suite runs Chromium on the real GPU (playwright.config.js),
// so only the viewport, scale, touch and mobile flags are taken.
const phone = (name) => { const { defaultBrowserType, ...d } = devices[name]; return d; };

for (const orient of ['portrait', 'landscape']) {
  test.describe(`phone ${orient}`, () => {
    test.use(phone(orient === 'landscape' ? 'iPhone 15 Pro landscape' : 'iPhone 15 Pro'));

    test('the phone layout replaces the desktop furniture', async ({ page }) => {
      await boot(page);
      const s = await page.evaluate(() => ({
        touch: document.documentElement.classList.contains('ug-touch'),
        wall: !!document.querySelector('#ug-landscape-lock.locked'),
        guide: getComputedStyle(document.getElementById('ug-controls-guide')).display,
        bar: [...document.querySelectorAll('#ug-touch .modes button')].map(b => b.dataset.mode),
        ratioCap: window.__ug.renderQuality.get().pixelRatio <= 1.5 * window.__ug.renderQuality.get().scale + 1e-6,
      }));
      expect(s.touch).toBe(true);
      expect(s.wall).toBe(false);
      expect(s.guide).toBe('none');
      expect(s.bar).toEqual(['deity', 'pedestrian', 'drone', 'balloon']);
      expect(s.ratioCap).toBe(true);
    });

    test('the mode bar switches body, the stick drives it and drag looks, with no key left held', async ({ page, context }) => {
      await boot(page);
      const cdp = await context.newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent',
        { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
      const { width: W, height: H } = page.viewportSize();

      await page.tap('#ug-touch .modes button[data-mode=drone]');
      await expect.poll(() => page.evaluate(() => window.__ug.modes.activeId)).toBe('drone');
      await expect(page.locator('#ug-touch .stick-zone')).toBeVisible();
      await simFor(page, 0.5);

      const yaw = () => page.evaluate(() => window.__ug.camera.rotation.y);
      const before = await camPos(page);
      const sx = W * 0.18, sy = H * 0.8;
      await touch('touchStart', [[sx, sy, 5]]);
      for (let i = 1; i <= 5; i++) await touch('touchMove', [[sx, sy - i * 8, 5]]);
      expect(await page.evaluate(() => [...window.__ug.fpsControls.keys])).toContain('w');
      await simFor(page, 1.0);
      await touch('touchEnd', []);
      const after = await camPos(page);
      expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(5);

      const y0 = await yaw();
      await touch('touchStart', [[W * 0.7, H * 0.4, 9]]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [[W * 0.7 - i * 10, H * 0.4, 9]]);
      await touch('touchEnd', []);
      await simFor(page, 0.2);
      expect(Math.abs((await yaw()) - y0)).toBeGreaterThan(0.05);

      // A held button releases on lift, and a mode change releases everything.
      const rise = page.locator('#ug-touch .actions button[data-action=up]');
      const box = await rise.boundingBox();
      await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2, 3]]);
      expect(await page.evaluate(() => window.__ug.fpsControls.keys.has(' '))).toBe(true);
      await touch('touchEnd', []);
      expect(await page.evaluate(() => [...window.__ug.fpsControls.keys])).toEqual([]);

      // Fast latches Shift on one tap and off on the next, and survives a switch into another mode that has it.
      const fastBtn = page.locator('#ug-touch .actions button[data-action=fast]');
      await fastBtn.tap();
      expect(await page.evaluate(() => window.__ug.fpsControls.keys.has('shift'))).toBe(true);
      await expect(page.locator('#ug-touch .stick-zone')).toHaveClass(/is-fast/);

      await page.tap('#ug-touch .modes button[data-mode=deity]');
      await expect.poll(() => page.evaluate(() => window.__ug.modes.activeId)).toBe('deity');
      expect(await page.evaluate(() => [...window.__ug.fpsControls.keys])).toEqual(['shift']);
      await page.locator('#ug-touch .actions button[data-action=fast]').tap();
      expect(await page.evaluate(() => [...window.__ug.fpsControls.keys])).toEqual([]);

      // Deity flies on the stick too, as W does on a keyboard.
      await expect(page.locator('#ug-touch .stick-zone')).toBeVisible();
      const d0 = await camPos(page);
      await touch('touchStart', [[sx, sy, 6]]);
      for (let i = 1; i <= 5; i++) await touch('touchMove', [[sx, sy - i * 8, 6]]);
      await page.evaluate(async () => { for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r)); });
      await touch('touchEnd', []);
      const d1 = await camPos(page);
      expect(Math.hypot(d1.x - d0.x, d1.z - d0.z)).toBeGreaterThan(1);
      expect(await page.evaluate(() => [...window.__ug.fpsControls.keys])).toEqual([]);
    });

    test('a tap pins the info under it; a drag over the same point shows nothing', async ({ page, context }) => {
      await boot(page);
      const cdp = await context.newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent',
        { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
      const { width: W, height: H } = page.viewportSize();
      const tip = () => page.evaluate(() => { const t = document.getElementById('hoverTip');
        return { shown: t.style.display === 'block', text: t.textContent || '' }; });
      const dismiss = async () => { await touch('touchStart', [[W / 2, 4, 4]]); await touch('touchEnd', []); };

      // Taps over the view's middle band until one lands on something with info (station, line, tunnel, ground layer).
      let hit = null;
      for (let gy = 0.3; gy <= 0.62 && !hit; gy += 0.04) {
        for (let gx = 0.15; gx <= 0.85 && !hit; gx += 0.1) {
          const x = W * gx, y = H * gy;
          await touch('touchStart', [[x, y, 2]]);
          await touch('touchEnd', []);
          const t = await tip();
          if (t.shown && t.text.trim()) hit = { x, y, text: t.text };
        }
      }
      expect(hit, 'no tap in the middle band found anything with info').not.toBeNull();

      // Pinned as a card inside the screen.
      const r = await page.evaluate(() => document.getElementById('hoverTip').getBoundingClientRect().toJSON());
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(W);
      expect(r.bottom).toBeLessThanOrEqual(H);
      // The next touch dismisses it.
      await dismiss();
      expect((await tip()).shown).toBe(false);

      // A drag that passes over the same point is a pan, not a tap: no info.
      await touch('touchStart', [[hit.x - 60, hit.y, 1]]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [[hit.x - 60 + i * 15, hit.y, 1]]);
      await touch('touchEnd', []);
      expect((await tip()).shown).toBe(false);
    });
  });
}

test('desktop keeps the desktop layout', async ({ page }) => {
  await boot(page);
  const s = await page.evaluate(() => ({
    touch: document.documentElement.classList.contains('ug-touch'),
    layer: !!document.getElementById('ug-touch'),
  }));
  expect(s).toEqual({ touch: false, layer: false });
});
