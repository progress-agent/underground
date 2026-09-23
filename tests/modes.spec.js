// modes.spec.js: conveyance-mode framework in the real app (sprint 23Sep26w,
// D-037, lane A1): switching by key and HUD, stub fallback to Deity, the
// owned-camera hook later modes rely on, look input, physics-panel
// persistence, collision against the real city, and the SFX bus.
//
// Keys are driven through page.keyboard (real KeyboardEvents, so the digit
// binding is exercised) and movement through fpsControls.keys, the same
// deterministic injection controls-week1.spec.js uses.

import { test, expect } from '@playwright/test';

async function boot(page, url = '/?skip=1') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
}

// A point on the WebGL canvas itself (the loading bar can sit over the centre
// while tiles are still streaming in).
async function canvasPoint(page) {
  return page.evaluate(() => {
    const canvas = window.__ug.modes.ctx.canvas;
    for (const [fx, fy] of [[0.3, 0.7], [0.25, 0.8], [0.4, 0.6], [0.6, 0.75]]) {
      const x = Math.round(innerWidth * fx), y = Math.round(innerHeight * fy);
      if (document.elementFromPoint(x, y) === canvas) return { x, y };
    }
    return null;
  });
}

const activeId = (page) => page.evaluate(() => window.__ug.modes.activeId);
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('#ug-mode-bar button[data-mode]')]
  .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.mode));

test.describe('Conveyance modes', () => {
  test('Deity by default; keys 1-4 and the HUD picker switch mode; stubs say "coming"', async ({ page }) => {
    await boot(page);
    expect(await activeId(page)).toBe('deity');
    const labels = await page.$$eval('#ug-mode-bar button[data-mode]', bs => bs.map(b => b.dataset.mode));
    expect(labels).toEqual(['deity', 'pedestrian', 'drone', 'balloon']);
    await expect(page.locator('#ug-mode-bar button.physics')).toBeVisible();
    await expect(page.locator('#ug-mode-hint')).toContainText('WASD');

    for (const [key, id] of [['2', 'pedestrian'], ['3', 'drone'], ['4', 'balloon'], ['1', 'deity']]) {
      await page.keyboard.press(key);
      expect(await activeId(page)).toBe(id);
      expect(await pressed(page)).toEqual([id]);
      // Stubs say "coming"; a mode its own lane has built (Pedestrian, A2) shows its key hint.
      const stub = await page.evaluate((m) => window.__ug.modes.registry.get(m).stub, id);
      if (id !== 'deity' && stub) await expect(page.locator('#ug-mode-hint')).toContainText(/coming/i);
      if (id !== 'deity' && !stub) await expect(page.locator('#ug-mode-hint')).not.toContainText(/coming/i);
    }

    await page.click('#ug-mode-bar button[data-mode="drone"]');
    expect(await activeId(page)).toBe('drone');
    await page.click('#ug-mode-bar button[data-mode="deity"]');
    expect(await activeId(page)).toBe('deity');
  });

  test('digits typed into a form control or with a modifier do not switch mode', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      document.getElementById('hudDetails').open = true;
      const input = document.createElement('input');
      input.id = 'modes-spec-text';
      document.body.appendChild(input);
    });
    await page.focus('#modes-spec-text');
    await page.keyboard.press('3');
    expect(await activeId(page)).toBe('deity');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Alt+3');
    expect(await activeId(page)).toBe('deity');
  });

  test('stub modes fall back to Deity movement exactly', async ({ page }) => {
    await boot(page);
    // Constant-base underground regime, as controls-week1 does.
    await page.evaluate(() => {
      window.__ug.camera.position.y -= 4000;
      window.__ug.controls.target.y -= 4000;
      window.__ug.camera.updateMatrixWorld(true);
    });
    const hold = async () => page.evaluate(async () => {
      const ug = window.__ug, frame = () => new Promise(r => requestAnimationFrame(r));
      const p0 = ug.camera.position.clone();
      ug.fpsControls.keys.add('w');
      for (let i = 0; i < 6; i++) await frame();
      ug.fpsControls.keys.delete('w');
      await frame();
      return { moved: ug.camera.position.distanceTo(p0), speed: ug.fpsControls.lastSpeed };
    });
    const deity = await hold();
    // Whichever modes are still stubs (Pedestrian stopped being one in lane A2).
    const stubKey = await page.evaluate(() => window.__ug.modes.registry.list().find(m => m.stub)?.key ?? null);
    test.skip(stubKey === null, 'every mode has been built; no stub left to check');
    await page.keyboard.press(stubKey);
    const stub = await hold();
    expect(deity.moved).toBeGreaterThan(10);
    expect(stub.moved).toBeGreaterThan(10);
    expect(stub.speed).toBe(deity.speed);
    expect(deity.speed).toBe(500);
  });

  test('a mode that owns the camera replaces Deity keyboard motion and holds OrbitControls off', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const ug = window.__ug, frame = () => new Promise(r => requestAnimationFrame(r));
      const calls = { update: 0, activate: 0, deactivate: 0, look: [] };
      ug.modes.registry.register({
        id: 'spec-owned', label: 'Spec', key: '9', hint: 'spec hint', look: 'drag', solid: true,
        activate: () => { calls.activate++; },
        deactivate: () => { calls.deactivate++; },
        update: (dt, ctx) => { calls.update++; ctx.camera.position.y += 0; return true; },
        onLook: (dx, dy) => { calls.look.push([dx, dy]); },
      });
      ug.modes.activate('spec-owned');
      const p0 = ug.camera.position.clone();
      ug.fpsControls.keys.add('w');
      for (let i = 0; i < 6; i++) await frame();
      ug.fpsControls.keys.delete('w');
      const moved = ug.camera.position.distanceTo(p0);
      const orbitEnabled = ug.controls.enabled;
      const lookMode = ug.modes.look.mode;
      window.__specCalls = calls;
      return { moved, orbitEnabled, lookMode, updates: calls.update, activate: calls.activate };
    });
    expect(r.moved).toBe(0);
    expect(r.orbitEnabled).toBe(false);
    expect(r.lookMode).toBe('drag');
    expect(r.updates).toBeGreaterThan(3);
    expect(r.activate).toBe(1);
    await expect(page.locator('#ug-mode-hint')).toHaveText('spec hint');

    // Drag-to-look reaches the mode with real pointer movement deltas.
    const pt = await canvasPoint(page);
    expect(pt).not.toBeNull();
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 40, pt.y + 10, { steps: 4 });
    await page.mouse.up();
    const look = await page.evaluate(() => window.__specCalls.look);
    const sum = look.reduce((a, [dx, dy]) => [a[0] + dx, a[1] + dy], [0, 0]);
    expect(sum[0]).toBeGreaterThan(20);
    expect(sum[1]).toBeGreaterThan(4);

    // Back to Deity: hand-back runs and OrbitControls come back.
    await page.keyboard.press('1');
    const after = await page.evaluate(async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { deactivate: window.__specCalls.deactivate, orbit: window.__ug.controls.enabled,
        lookMode: window.__ug.modes.look.mode };
    });
    expect(after).toEqual({ deactivate: 1, orbit: true, lookMode: 'none' });
  });

  test('pointer-lock look: a click on the view captures the mouse when a mode opts in', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.__lockLook = [];
      window.__ug.modes.registry.register({ id: 'spec-lock', key: '8', hint: 'lock hint', look: 'lock',
        update: () => true, onLook: (dx, dy) => window.__lockLook.push([dx, dy]) });
      window.__ug.modes.activate('spec-lock');
    });
    await expect(page.locator('#ug-mode-hint')).toContainText('click the view');
    const pt = await canvasPoint(page);
    expect(pt).not.toBeNull();
    await page.mouse.click(pt.x, pt.y);
    const locked = await page.waitForFunction(() => window.__ug.modes.look.isLocked(), null, { timeout: 3000 })
      .then(() => true, () => false);
    if (locked) {
      await expect(page.locator('#ug-mode-hint')).toContainText('Esc');
      await page.mouse.move(pt.x + 30, pt.y, { steps: 3 });
      expect(await page.evaluate(() => window.__lockLook.length)).toBeGreaterThan(0);
    } else {
      // Headless Chromium may refuse the lock. The contract for that case (and
      // for after Esc) is that drag-to-look still works in a lock mode.
      console.log('[modes] pointer lock refused by this browser; checking the unlocked drag fallback');
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.mouse.move(pt.x + 30, pt.y + 6, { steps: 3 });
      await page.mouse.up();
      const sum = await page.evaluate(() => window.__lockLook.reduce((a, [dx]) => a + dx, 0));
      expect(sum).toBeGreaterThan(15);
    }
    // Switching to a non-lock mode releases the cursor.
    await page.keyboard.press('1');
    expect(await page.evaluate(() => window.__ug.modes.look.isLocked())).toBe(false);
    expect(await page.evaluate(() => window.__ug.modes.look.mode)).toBe('none');
  });

  test('physics panel: Deity tunables drive the controls, persist across reload, reset restores', async ({ page }) => {
    await boot(page);
    await page.click('#ug-mode-bar button.physics');
    const section = page.locator('#ug-physics-panel section[data-mode="deity"]');
    await expect(section).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('#ug-physics-panel section[data-mode="deity"] input[data-key="speed"]');
      el.value = '800';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.evaluate(() => window.__ug.fpsControls.moveSpeed)).toBe(800);

    await boot(page); // reload
    expect(await page.evaluate(() => window.__ug.fpsControls.moveSpeed)).toBe(800);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ug:physics:v1'))))
      .toEqual({ deity: { speed: 800 } });

    await page.click('#ug-mode-bar button.physics');
    await page.click('#ug-physics-panel section[data-mode="deity"] button[data-action="reset"]');
    expect(await page.evaluate(() => window.__ug.fpsControls.moveSpeed)).toBe(500);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ug:physics:v1')))).toEqual({});
  });

  test('collision service stops a body at a real building facade and reads its roof', async ({ page }) => {
    await boot(page, '/?skip=1&buildings=baked');
    await page.waitForFunction(() => window.__ug.buildingInstanceCount > 100000, null, { timeout: 90000 });
    const r = await page.evaluate(() => {
      const ug = window.__ug, c = ug.modes.collision;
      c.sync();
      // Find a free-standing building near the camera, at least 8m across.
      const p = ug.camera.position;
      const near = c.buildingsNear(p.x, p.z, 1500).filter(b => b.maxX - b.minX > 8 && b.roofY - b.baseY > 10);
      for (const b of near) {
        const cz = (b.minZ + b.maxZ) / 2, start = { x: b.minX - 6, y: b.baseY, z: cz };
        const ground = c.groundHeightAt(start.x, start.z);
        if (ground === null) continue;
        start.y = Math.max(ground, b.baseY);
        const res = c.moveAndSlide(start, { x: 12, y: 0, z: 0 }, { radius: 0.4, height: 9, step: 2 });
        if (!res.hit) continue; // something else in the way or a neighbour first; try another
        return { found: true, stopX: res.x, facade: b.minX, roof: c.roofHeightAt((b.minX + b.maxX) / 2, cz),
          roofY: b.roofY, stats: c.stats() };
      }
      return { found: false, candidates: near.length };
    });
    expect(r.found).toBe(true);
    expect(r.stopX).toBeLessThanOrEqual(r.facade - 0.39);
    expect(r.roof).toBeGreaterThanOrEqual(r.roofY - 1e-3);
    expect(r.stats.indexedMeshes).toBeGreaterThan(0);
    expect(r.stats.indexedMeshes).toBeLessThan(r.stats.meshes); // lazy: only the neighbourhood
  });

  test('mode SFX route to the master bus after the first gesture, and silence on switch', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.__ug.modes.sfx.levels())).toBeNull();
    await page.mouse.click(5, 300); // user gesture starts audio
    await page.waitForFunction(() => window.__ug.isAudioReady(), null, { timeout: 5000 });
    const r = await page.evaluate(async () => {
      const s = window.__ug.modes.sfx;
      s.jetpack(1); s.droneWhine(30); s.burner(true); s.splash(); s.strokes(); s.footsteps(5);
      await new Promise(r => setTimeout(r, 400));
      const on = s.levels();
      window.__ug.modes.activate('drone');
      await new Promise(r => setTimeout(r, 600));
      return { ready: s.ready, on, off: s.levels() };
    });
    expect(r.ready).toBe(true);
    expect(r.on.jetpack).toBeGreaterThan(0.2);
    expect(r.on.drone).toBeGreaterThan(0.05);
    expect(r.on.burner).toBeGreaterThan(0.2);
    expect(r.off.jetpack).toBeLessThan(0.01);
    expect(r.off.burner).toBeLessThan(0.02);
  });
});
