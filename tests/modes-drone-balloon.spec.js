// modes-drone-balloon.spec.js: Drone and Balloon in the real app (sprint
// 23Sep26w, D-037, lane A3). The flight models are pinned exactly in
// modes-drone-balloon.test.mjs; this spec proves the wiring: keys and hints,
// FOV on the real camera and its restoration, owned camera, pointer look,
// bank / pitch reaching the camera, idle hover, collision against the real
// baked city, wind drift, time warp, and the physics panel.
//
// Movement is injected through fpsControls.keys (as controls-week1.spec.js
// does) and look through the registry, so no pointer lock is needed. Timing
// uses real frames; assertions are about direction and state, never fps.

import { test, expect } from '@playwright/test';

async function boot(page, url = '/?skip=1') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
}

const frames = (page, n) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
}, n);

const dbg = (page, id) => page.evaluate((id) => window.__ug.modes.registry.get(id).debug(), id);

test.describe('Drone and Balloon modes', () => {
  test('Drone: key 3, pointer-lock look, ~110° horizontal FOV on the camera, restored on leaving', async ({ page }) => {
    await boot(page);
    const fov0 = await page.evaluate(() => window.__ug.camera.fov);
    await page.keyboard.press('3');
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const ug = window.__ug, cam = ug.camera;
      const expected = 2 * Math.atan(Math.tan(55 * Math.PI / 180) / cam.aspect) * 180 / Math.PI;
      return { id: ug.modes.activeId, look: ug.modes.look.mode, fov: cam.fov, expected,
        orbit: ug.controls.enabled, stub: ug.modes.registry.get('drone').stub };
    });
    expect(r).toMatchObject({ id: 'drone', look: 'lock', orbit: false, stub: false });
    expect(Math.abs(r.fov - r.expected)).toBeLessThan(0.05);
    await expect(page.locator('#ug-mode-hint')).toContainText('W thrust');
    await expect(page.locator('#ug-mode-hint')).toContainText('click the view');

    // Physics panel: the drone's tunables are live.
    await page.click('#ug-mode-bar button.physics');
    await expect(page.locator('#ug-physics-panel section[data-mode="drone"]')).toBeVisible();
    for (const key of ['speed', 'accel', 'fov', 'bank', 'tilt', 'overshoot', 'bounce']) {
      await expect(page.locator(`#ug-physics-panel section[data-mode="drone"] input[data-key="${key}"]`)).toHaveCount(1);
    }
    await page.evaluate(() => {
      const el = document.querySelector('#ug-physics-panel section[data-mode="drone"] input[data-key="fov"]');
      el.value = '90';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await frames(page, 2);
    const fov90 = await page.evaluate(() => {
      const cam = window.__ug.camera;
      return { fov: cam.fov, expected: 2 * Math.atan(Math.tan(45 * Math.PI / 180) / cam.aspect) * 180 / Math.PI };
    });
    expect(Math.abs(fov90.fov - fov90.expected)).toBeLessThan(0.05);
    await page.click('#ug-physics-panel section[data-mode="drone"] button[data-action="reset"]');
    // The panel keeps keys to itself while focused (A1), so give focus back first.
    await page.evaluate(() => document.activeElement?.blur());

    await page.keyboard.press('1');
    await frames(page, 2);
    expect(await page.evaluate(() => window.__ug.camera.fov)).toBe(fov0);
    expect(await page.evaluate(() => window.__ug.controls.enabled)).toBe(true);
  });

  test('Drone flight: W thrusts, the view pitches forward and banks into a mouse turn, idle hovers', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('3');
    await frames(page, 2);
    // Put the drone 400 m above the ground where it is, facing north, level.
    await page.evaluate(() => {
      const ug = window.__ug, p = ug.camera.position;
      const g = ug.modes.collision.groundHeightAt(p.x, p.z) ?? 0;
      ug.modes.registry.get('drone').place({ x: p.x, y: g + 400 * 5, z: p.z, yaw: 0, pitch: 0 });
    });
    const start = await dbg(page, 'drone');
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    await frames(page, 60);
    const flying = await dbg(page, 'drone');
    expect(flying.speed).toBeGreaterThan(10);
    expect(flying.pos.z).toBeLessThan(start.pos.z - 10); // north is -Z
    expect(flying.dip).toBeGreaterThan(0.02);            // nose down with speed
    expect(Math.abs(flying.pos.y - start.pos.y)).toBeLessThan(0.5); // no gravity

    // A mouse turn left (negative dx) while flying banks left (positive roll).
    let maxRoll = 0;
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.__ug.modes.registry.look(-25, 0));
      await frames(page, 2);
      maxRoll = Math.max(maxRoll, (await dbg(page, 'drone')).roll);
    }
    expect(maxRoll).toBeGreaterThan(5 * Math.PI / 180);
    // The roll reached the real camera.
    const camUp = await page.evaluate(() => {
      const cam = window.__ug.camera;
      const up = new cam.up.constructor(0, 1, 0).applyQuaternion(cam.quaternion);
      const right = new cam.up.constructor(1, 0, 0).applyQuaternion(cam.quaternion);
      return { upY: up.y, rightY: right.y };
    });
    expect(camUp.upY).toBeLessThan(0.9999);
    expect(camUp.rightY).toBeGreaterThan(0); // left bank: the right side rises

    // Release: momentum carries it on, then it brakes to a dead-still hover.
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    await page.waitForFunction(() => window.__ug.modes.registry.get('drone').debug().speed === 0, null, { timeout: 20000 });
    const a = await dbg(page, 'drone');
    await frames(page, 30);
    const b = await dbg(page, 'drone');
    expect(b.pos).toEqual(a.pos);
    expect(Math.abs(b.pos.y - start.pos.y)).toBeLessThan(0.5);
  });

  test('Drone collision: bounces off a real building facade and never enters it', async ({ page }) => {
    await boot(page, '/?skip=1&buildings=baked');
    await page.waitForFunction(() => window.__ug.buildingInstanceCount > 100000, null, { timeout: 90000 });
    await page.keyboard.press('3');
    await frames(page, 2);
    const setup = await page.evaluate(() => {
      const ug = window.__ug, c = ug.modes.collision, p = ug.camera.position;
      c.sync();
      const near = c.buildingsNear(p.x, p.z, 2000).filter(b => b.maxX - b.minX > 12 && b.roofY - b.baseY > 40);
      for (const b of near) {
        const cz = (b.minZ + b.maxZ) / 2, x0 = b.minX - 25;
        const y = b.baseY + (b.roofY - b.baseY) * 0.5;
        // Clear air on the approach: nothing between the start and the facade.
        const between = c.buildingsNear(x0, cz, 24).filter(o => o !== b && o.roofY > y && o.baseY < y
          && o.maxX < b.minX && o.maxX > x0 - 3 && o.minZ < cz + 3 && o.maxZ > cz - 3);
        if (between.length) continue;
        if ((c.groundHeightAt(x0, cz) ?? Infinity) > y - 20) continue;
        ug.modes.registry.get('drone').place({ x: x0, y, z: cz, yaw: -Math.PI / 2, pitch: 0 }); // facing east
        return { found: true, facade: b.minX };
      }
      return { found: false };
    });
    expect(setup.found).toBe(true);
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    let maxX = -Infinity, reversed = false, hits = 0;
    for (let i = 0; i < 90; i++) {
      await frames(page, 1);
      const d = await dbg(page, 'drone');
      maxX = Math.max(maxX, d.pos.x);
      if (d.hits > 0 && d.vel.x < 0) reversed = true;
      hits = d.hits;
    }
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    expect(hits).toBeGreaterThan(0);
    expect(reversed).toBe(true);
    expect(maxX).toBeLessThanOrEqual(setup.facade - 1.49);
  });

  test('Balloon: key 4, drag look, drift follows the wind layer, T time-warps x10, burner heats', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('4');
    await frames(page, 2);
    expect(await page.evaluate(() => ({ id: window.__ug.modes.activeId, look: window.__ug.modes.look.mode,
      orbit: window.__ug.controls.enabled }))).toEqual({ id: 'balloon', look: 'drag', orbit: false });
    await expect(page.locator('#ug-mode-hint')).toContainText('T time warp ×10');
    await expect(page.locator('#ug-mode-hint')).toContainText('E/Space burner');
    await expect(page.locator('#ug-physics-panel section[data-mode="balloon"] input[data-key="lag"]')).toHaveCount(1);

    // 250 m up, neutral envelope.
    await page.evaluate(() => {
      const ug = window.__ug, p = ug.camera.position;
      const g = ug.modes.collision.groundHeightAt(p.x, p.z) ?? 0;
      ug.modes.registry.get('balloon').place({ x: p.x, y: g + (250 + 1.5) * 5, z: p.z, dT: 60 });
    });
    await frames(page, 40);
    const drift = await page.evaluate(() => {
      const ug = window.__ug, d = ug.modes.registry.get('balloon').debug();
      const w = ug.modes.ctx.wind.getWindAt(d.altitude, d.windTime);
      const wx = -Math.sin(w.dirRad) * w.speedMps, wz = Math.cos(w.dirRad) * w.speedMps;
      const ang = Math.abs(Math.atan2(d.vel.x * wz - d.vel.z * wx, d.vel.x * wx + d.vel.z * wz));
      return { ang, speed: Math.hypot(d.vel.x, d.vel.z), wind: w.speedMps };
    });
    expect(drift.ang).toBeLessThan(5 * Math.PI / 180);
    expect(Math.abs(drift.speed - drift.wind)).toBeLessThan(0.1 * drift.wind);

    // Time warp: T toggles; simulated time runs ten times the frame time.
    const rate = async () => page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('balloon');
      const s0 = m.debug().simTime, t0 = ug.modes.ctx.time;
      for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
      return (m.debug().simTime - s0) / (ug.modes.ctx.time - t0);
    });
    expect(await rate()).toBeCloseTo(1, 3);
    await page.keyboard.press('t');
    expect(await page.evaluate(() => window.__ug.modes.registry.get('balloon').warp)).toBe(true);
    await expect(page.locator('#ug-mode-hint')).toContainText('ON');
    expect(await rate()).toBeCloseTo(10, 3);
    await page.keyboard.press('t');
    await expect(page.locator('#ug-mode-hint')).not.toContainText('ON');

    // Burner: E held feeds the lagged heat; released it decays.
    await page.keyboard.down('e');
    await frames(page, 30);
    const burning = await dbg(page, 'balloon');
    await page.keyboard.up('e');
    expect(burning.burner).toBe(true);
    expect(burning.heat).toBeGreaterThan(0.05);
    expect(burning.heat).toBeLessThan(0.9); // multi-second lag, not instant

    // Leaving restores Deity and releases the warp key.
    await page.keyboard.press('1');
    expect(await page.evaluate(() => window.__ug.modes.registry.get('balloon').warp)).toBe(false);
  });

  test('Balloon collision: the basket settles on a real roof, not through it', async ({ page }) => {
    await boot(page, '/?skip=1&buildings=baked');
    await page.waitForFunction(() => window.__ug.buildingInstanceCount > 100000, null, { timeout: 90000 });
    await page.keyboard.press('4');
    await frames(page, 2);
    const roof = await page.evaluate(() => {
      const ug = window.__ug, c = ug.modes.collision, p = ug.camera.position;
      c.sync();
      const b = c.buildingsNear(p.x, p.z, 2000).filter(b => b.maxX - b.minX > 30 && b.maxZ - b.minZ > 30)
        .sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX))[0];
      if (!b) return null;
      const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      const m = ug.modes.registry.get('balloon');
      m.place({ x, y: c.roofHeightAt(x, z) + (4 + 1.5) * 5, z, dT: 30 }); // cold: sinks onto the roof
      return { roofY: c.roofHeightAt(x, z) };
    });
    expect(roof).not.toBeNull();
    await page.waitForFunction(() => window.__ug.modes.registry.get('balloon').debug().grounded, null, { timeout: 20000 });
    const d = await dbg(page, 'balloon');
    // Resting on this roof or a neighbouring one it drifted onto; never inside.
    const under = await page.evaluate(({ x, z }) => ({
      standing: window.__ug.modes.collision.standHeightAt(x, z, Infinity),
      ground: window.__ug.modes.collision.groundHeightAt(x, z),
    }), d.pos);
    expect(Math.abs(d.pos.y - (under.standing + 1.5 * 5))).toBeLessThan(0.01);
    expect(under.standing).toBeGreaterThan(under.ground + 5); // a roof, not the street below it
  });
});
