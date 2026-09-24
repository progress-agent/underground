// housekeeping-s24.spec.js: sprint 24Sep26h (D-038) lane H follow-ups in the
// real app.
//
// 1. Space in Drone is rise, so it must not also press the button that kept
//    focus after a click. Keyboard access elsewhere is unchanged: in Deity a
//    focused button still presses on Space, and inside the Physics panel (which
//    keeps its keys to itself) Space still presses the panel's own buttons.
// 2. The open settings panel stacks above the controls guide (e367efd), and the
//    hover tooltip stacks above the open panel.
//
// Drone movement is timed on SIMULATED time (the modes' ctx.time), as in
// modes-drone-balloon.spec.js, so a loaded GPU cannot fail it.

import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/?skip=1');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
}

const frames = (page, n) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
}, n);

const simFor = (page, seconds, maxFrames = 3000) => page.evaluate(async ({ seconds, maxFrames }) => {
  const ctx = window.__ug.modes.ctx, t0 = ctx.time || 0;
  for (let i = 0; i < maxFrames && (ctx.time || 0) - t0 < seconds; i++) {
    await new Promise(r => requestAnimationFrame(r));
  }
  return (ctx.time || 0) - t0;
}, { seconds, maxFrames });

const pressed = (page) => page.locator('#flightSprint').getAttribute('aria-pressed');

test.describe('Space and focused buttons (lane H)', () => {
  test('Drone: Space rises and does not press the focused HUD button; Deity still presses it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });

    // Deity: Space on a focused button is ordinary keyboard access.
    await page.focus('#flightSprint');
    await page.keyboard.press(' ');
    await expect(page.locator('#flightSprint')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(' ');
    await expect(page.locator('#flightSprint')).toHaveAttribute('aria-pressed', 'false');

    // Drone, with the same button still focused (as after a mouse click on it).
    await page.evaluate(() => window.__ug.modes.activate('drone'));
    await frames(page, 2);
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('drone');
    await page.evaluate(() => {
      const ug = window.__ug, p = ug.camera.position;
      const g = ug.modes.collision.groundHeightAt(p.x, p.z) ?? 0;
      ug.modes.registry.get('drone').place({ x: p.x, y: g + 300 * 5, z: p.z, yaw: 0, pitch: 0 });
    });
    await page.focus('#flightSprint');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('flightSprint');
    const y0 = await page.evaluate(() => window.__ug.modes.registry.get('drone').debug().pos.y);
    await page.keyboard.down(' ');
    expect(await simFor(page, 1.0)).toBeGreaterThanOrEqual(1.0);
    await page.keyboard.up(' ');
    const y1 = await page.evaluate(() => window.__ug.modes.registry.get('drone').debug().pos.y);
    expect(y1).toBeGreaterThan(y0 + 1);        // Space is rise
    expect(await pressed(page)).toBe('false'); // and the button was not pressed
    // A short tap too (keydown and keyup inside one frame).
    await page.keyboard.press(' ');
    await frames(page, 2);
    expect(await pressed(page)).toBe('false');
    // Focus is left where it was: nothing is blurred behind the viewer's back.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('flightSprint');

    // Back to Deity: the guard is gone and the button presses again.
    await page.evaluate(() => window.__ug.modes.activate('deity'));
    await frames(page, 2);
    await page.focus('#flightSprint');
    await page.keyboard.press(' ');
    await expect(page.locator('#flightSprint')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(' ');
    await expect(page.locator('#flightSprint')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Drone: Space still presses buttons inside the Physics panel, which keeps its keys', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__ug.modes.activate('drone'));
    await frames(page, 2);
    await page.click('#ug-mode-bar button.physics');
    const section = '#ug-physics-panel section[data-mode="drone"]';
    await expect(page.locator(section)).toBeVisible();
    const fov = page.locator(`${section} input[data-key="fov"]`);
    const fov0 = await fov.inputValue();
    await fov.evaluate(el => { el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(fov).toHaveValue('90');
    await page.focus(`${section} button[data-action="reset"]`);
    await page.keyboard.press(' ');
    await expect(fov).toHaveValue(fov0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__ug.modes.activate('deity'));
  });

  test('Balloon keeps Space for the burner, and also leaves the Physics panel its Space', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
    await page.evaluate(() => window.__ug.modes.activate('balloon'));
    await frames(page, 2);
    await page.focus('#flightSprint');
    await page.keyboard.press(' ');
    await frames(page, 2);
    expect(await pressed(page)).toBe('false');
    await page.click('#ug-mode-bar button.physics');
    const section = '#ug-physics-panel section[data-mode="balloon"]';
    await expect(page.locator(section)).toBeVisible();
    const input = page.locator(`${section} input[type=range]`).first();
    const v0 = await input.inputValue();
    const max = await input.getAttribute('max');
    await input.evaluate((el, max) => { el.value = max; el.dispatchEvent(new Event('input', { bubbles: true })); }, max);
    if (max !== v0) await expect(input).toHaveValue(max);
    await page.focus(`${section} button[data-action="reset"]`);
    await page.keyboard.press(' ');
    await expect(input).toHaveValue(v0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__ug.modes.activate('deity'));
  });
});

test.describe('Tooltip stacking with the settings panel open (lane H)', () => {
  const stack = (page) => page.evaluate(() => {
    const z = (el) => el ? Number(getComputedStyle(el).zIndex) : null;
    const tip = document.getElementById('hoverTip');
    const hud = document.getElementById('hud');
    return {
      tip: z(tip), hud: z(hud),
      guide: z(document.getElementById('ug-controls-guide')),
      readout: z(document.getElementById('ug-readout')),
      // All four are fixed-position children of <body>, which forms no stacking
      // context of its own, so their z-indices compare directly.
      parents: [tip, hud, document.getElementById('ug-controls-guide'), document.getElementById('ug-readout')]
        .map(el => el?.parentElement?.tagName ?? null),
      positions: [tip, hud].map(el => getComputedStyle(el).position),
    };
  });

  test('open: tooltip above the panel, panel above the guide; closed: order unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await boot(page);
    await page.waitForFunction(() => !!document.getElementById('ug-controls-guide'), null, { timeout: 30000 });

    const closed = await stack(page);
    expect(closed.parents).toEqual(['BODY', 'BODY', 'BODY', 'BODY']);
    expect(closed.positions).toEqual(['fixed', 'fixed']);
    expect(closed).toMatchObject({ tip: 25, hud: 15, guide: 28, readout: 28 });

    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
    const open = await stack(page);
    expect(open.hud).toBeGreaterThan(open.guide);
    expect(open.hud).toBeGreaterThan(open.readout);
    expect(open.tip).toBeGreaterThan(open.hud);

    // The e367efd property still holds: Reset settings is reachable, not under
    // the guide, on a 720px-tall window.
    const hit = await page.evaluate(() => {
      const b = document.getElementById('resetPrefs');
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === b || b.contains(el);
    });
    expect(hit).toBe(true);

    // A tooltip shown over the open panel is the topmost element there. The tip
    // is pointer-events:none in use, so hit testing is switched on for the probe
    // only (elementFromPoint honours z-order, and it failed on e367efd).
    const onTop = await page.evaluate(() => {
      const hud = document.getElementById('hud').getBoundingClientRect();
      const tip = document.getElementById('hoverTip');
      // The app places the tip with a transform; put it over the panel instead.
      const saved = { transform: tip.style.transform, left: tip.style.left, top: tip.style.top };
      tip.textContent = 'stacking probe';
      Object.assign(tip.style, { display: 'block', transform: 'none', left: `${hud.left + 20}px`, top: `${hud.top + 40}px`,
        pointerEvents: 'auto' });
      const r = tip.getBoundingClientRect();
      const inside = r.left >= hud.left && r.right <= hud.right && r.top >= hud.top && r.bottom <= hud.bottom;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const result = inside && (el === tip || tip.contains(el));
      Object.assign(tip.style, { display: 'none', pointerEvents: '', ...saved });
      tip.textContent = '';
      return result;
    });
    expect(onTop).toBe(true);

    await page.evaluate(() => { document.getElementById('hudDetails').open = false; });
    expect(await stack(page)).toMatchObject({ tip: 25, hud: 15, guide: 28, readout: 28 });
  });
});

test.describe('Late-run failures: the causes, pinned (lane H)', () => {
  // chalk-clarity.spec.js:91 failed once late in a full run. Cause: a tube line
  // still arriving from the TfL API creates its label layers between two app
  // ticks with display 'block'; a read in that gap saw them. The next tick hides
  // them before anything paints. This holds one line's route request until the
  // camera is in the chalk, releases it, and checks both halves: the layers are
  // visible at creation (so the old read could fail) and hidden when painted.
  test('a tube line landing inside the chalk never paints its labels', async ({ page }) => {
    let release; const gate = new Promise(r => (release = r));
    let seen = 0, held = null;
    await page.route(/api\.tfl\.gov\.uk\/Line\/[^/]+\/Route\/Sequence/, async (route) => {
      seen++;
      if (!held && seen === 2) { held = route.request().url(); await gate; }
      await route.continue();
    });
    await page.goto('/?skipintro=1');
    await page.waitForFunction(() => !!(window.__ug && window.__ug.camera && typeof window.__ug.chalkClarity === 'number'),
      null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.station-overlay-layer').length > 0, null, { timeout: 60000 });
    await page.evaluate(() => {
      const u = window.__ug; u.fpsControls.enabled = false;
      const cs = u.getChalkSurfaceY(0, 0);
      u.camera.position.set(0, cs - 50, 0); u.controls.target.set(0, cs - 50, 500);
    });
    await page.waitForFunction(() => window.__ug.chalkClarity > 0.95, null, { timeout: 10000 });
    const n0 = await page.evaluate(() => document.querySelectorAll('.station-overlay-layer').length);
    expect(held).not.toBeNull();
    await page.evaluate((n) => {
      window.__atCreation = null;
      const mo = new MutationObserver(() => {
        const els = document.querySelectorAll('.station-overlay-layer');
        if (!window.__atCreation && els.length > n) { window.__atCreation = [...els].map(el => el.style.display); mo.disconnect(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }, n0);
    release();
    await page.waitForFunction(() => !!window.__atCreation, null, { timeout: 30000 });
    const atCreation = await page.evaluate(() => window.__atCreation);
    const painted = await page.evaluate(() => new Promise(r => requestAnimationFrame(() =>
      r([...document.querySelectorAll('.station-overlay-layer')].map(el => el.style.display)))));
    expect(atCreation.filter(d => d !== 'none').length).toBeGreaterThan(0); // the race the old read hit
    expect(painted.length).toBeGreaterThan(n0);
    expect(painted.every(d => d === 'none')).toBe(true);                     // what a viewer sees
  });
});
