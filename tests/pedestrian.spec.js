// pedestrian.spec.js: Pedestrian mode in the real app (sprint 23Sep26w, D-037,
// lane A2). Pins what can be pinned: the real-scale ease and its restore, the
// sliders staying adjustable, facade collision against the real baked city,
// station descent to the platform's true modelled depth, the tunnel
// centreline lock and sprint, ascent at a platform, and swim entry and exit
// at a real Thames bank. Physics details (jump arcs, jetpack roof landing,
// Mario-swim sink and strokes, junction choice) are pinned deterministically
// in tests/pedestrian.test.mjs.
//
// Movement is injected through fpsControls.keys (the same shared held-key set
// real keydown fills, as controls-week1 and modes.spec do); E and Space go
// through page.keyboard so the mode's own edge latch is exercised.

import { test, expect } from '@playwright/test';

const VE = 5;

async function boot(page) {
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
  await page.waitForFunction(() => window.__ug.buildingInstanceCount > 100000
    && window.__ug.lineBranchCenterPts.size > 5, null, { timeout: 90000 });
}

const setSlider = (page, id, v) => page.evaluate(([id, v]) => {
  const el = document.getElementById(id);
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(el.value);
}, [id, v]);
const sliders = (page) => page.evaluate(() => ({
  master: Number(document.getElementById('masterHeight').value),
  structure: Number(document.getElementById('buildingHeight').value),
  masterRatio: window.__ug.masterHeight.ratio,
}));
const dbg = (page) => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
const frames = (page, n) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
}, n);

// Enter Pedestrian and wait for the ~1s ease to finish.
async function enter(page) {
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body',
    null, { timeout: 30000 });
}

test.describe('Pedestrian mode', () => {
  test('entering eases to real scale, leaving restores the prior sliders, sliders stay adjustable', async ({ page }) => {
    await boot(page);
    await setSlider(page, 'masterHeight', 3);
    await setSlider(page, 'buildingHeight', 2);
    // Record the Master slider every frame through the ease.
    await page.evaluate(() => {
      window.__masterTrace = [];
      const rec = () => {
        window.__masterTrace.push(Number(document.getElementById('masterHeight').value));
        if (window.__masterTrace.length < 400) requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });
    await page.keyboard.press('2');
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('pedestrian');
    await page.waitForFunction(() => {
      const d = window.__ug.modes.registry.get('pedestrian').debug();
      return d.phase === 'body' && !d.ease.running;
    }, null, { timeout: 30000 });
    const trace = await page.evaluate(() => window.__masterTrace.slice());
    // Eased, not snapped: intermediate values were shown on the way down.
    expect(trace.some(v => v < 2.95 && v > 1.05)).toBe(true);
    const at = await sliders(page);
    expect(at.master).toBe(1);
    expect(at.structure).toBe(5);
    expect(at.masterRatio).toBeCloseTo(0.2, 6);

    // Standing at a 1.7m eye height on whatever is below.
    const d = await dbg(page);
    expect(d.state).toBe('ground');
    expect((d.eyeY - d.y) / VE).toBeCloseTo(1.7, 3);
    const ground = await page.evaluate(([x, z]) => window.__ug.modes.collision.standHeightAt(x, z, Infinity, 0), [d.x, d.z]);
    expect(Math.abs(d.y - ground)).toBeLessThan(0.5 * VE);

    // Sliders stay adjustable while walking: the mode does not fight them.
    await setSlider(page, 'masterHeight', 2.5);
    await setSlider(page, 'buildingHeight', 3.5);
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    await frames(page, 20);
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    expect(await sliders(page)).toMatchObject({ master: 2.5, structure: 3.5 });
    // Physics is canonical: the eye height is unchanged by the Master slider.
    const d2 = await dbg(page);
    expect((d2.eyeY - d2.y) / VE).toBeCloseTo(1.7, 3);

    // Leaving restores what the sliders were before entry.
    await page.keyboard.press('1');
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('deity');
    expect(await sliders(page)).toMatchObject({ master: 3, structure: 2 });
  });

  test('a pedestrian cannot walk through a real building; it slides along the facade', async ({ page }) => {
    await boot(page);
    await enter(page);
    const setup = await page.evaluate(() => {
      const ug = window.__ug, c = ug.modes.collision, m = ug.modes.registry.get('pedestrian');
      c.sync();
      const p = ug.camera.position;
      const near = c.buildingsNear(p.x, p.z, 2000).filter(b => b.maxX - b.minX > 10 && b.roofY - b.baseY > 20);
      for (const b of near) {
        const cz = (b.minZ + b.maxZ) / 2, sx = b.minX - 8;
        if (c.waterAt(sx, cz)) continue;
        const ground = c.groundHeightAt(sx, cz);
        if (ground === null || c.standHeightAt(sx, cz, Infinity, 0) !== ground) continue; // start on open ground
        // The first thing east of the start must be this facade.
        const probe = c.moveAndSlide({ x: sx, y: ground, z: cz }, { x: 12, y: 0, z: 0 }, { radius: 0.35, height: 9.25, step: 2 });
        if (!probe.hit || Math.abs(probe.x - (b.minX - 0.35)) > 0.01) continue;
        m.place(sx, cz, { yaw: -Math.PI / 2 }); // face +X
        return { found: true, facade: b.minX, cz, ground };
      }
      return { found: false, candidates: near.length };
    });
    expect(setup.found).toBe(true);
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    await page.waitForFunction((facade) => {
      const d = window.__ug.modes.registry.get('pedestrian').debug();
      return d.x > facade - 0.5 && Math.abs(d.vx) < 1e-6;
    }, setup.facade, { timeout: 20000 });
    await frames(page, 10);
    let d = await dbg(page);
    expect(d.x).toBeLessThanOrEqual(setup.facade - 0.34);
    expect(d.x).toBeGreaterThan(setup.facade - 0.5);
    expect(d.state).toBe('ground');
    // W+D into the facade: slides along it (Z changes), never enters.
    const z0 = d.z;
    await page.evaluate(() => window.__ug.fpsControls.keys.add('d'));
    // Every frame of the slide stays outside the facade.
    const slide = await page.evaluate(async ([facade, z0]) => {
      const m = window.__ug.modes.registry.get('pedestrian');
      let maxX = -Infinity, d = m.debug();
      for (let i = 0; i < 600 && Math.abs(d.z - z0) < 2; i++) {
        await new Promise(r => requestAnimationFrame(r));
        d = m.debug();
        maxX = Math.max(maxX, d.x);
      }
      return { dz: Math.abs(d.z - z0), maxX };
    }, [setup.facade, z0]);
    await page.evaluate(() => { window.__ug.fpsControls.keys.delete('w'); window.__ug.fpsControls.keys.delete('d'); });
    expect(slide.dz).toBeGreaterThanOrEqual(2);
    expect(slide.maxX).toBeLessThanOrEqual(setup.facade - 0.34);
  });

  test('station: E descends the shaft to the platform at true depth; tunnel lock, sprint, E ascends', async ({ page }) => {
    await boot(page);
    await enter(page);
    // A deep station with a single-line platform, well clear of the river.
    const st = await page.evaluate(() => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const net = m.rebuildNetwork();
      const e = net.entrances.filter(en => en.stops.length === 1 && en.stops[0].depthM > 20)
        .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      const stop = e.stops[0];
      // The station marker record main.js keeps for this platform.
      const layer = ug.modes.ctx.tubeNetwork.stationLayers.get(stop.lineId);
      const marker = layer.stationsLayer.stations.find(s => Math.hypot(s.pos.x - stop.x, s.pos.z - stop.z) < 3);
      ug.modes.physics.set('pedestrian', 'shaftSpeed', 200);
      m.place(e.x + 12, e.z + 5, { yaw: 0 });
      return { name: e.name, x: e.x, z: e.z, lineId: stop.lineId, platformY: stop.platformY,
        markerY: marker.pos.y, markerSurfaceY: marker.surfaceY, markerDepthM: marker.depthM, stats: net.stats };
    });
    expect(st.stats.entrances).toBeGreaterThan(100);
    await expect(page.locator('#ug-mode-hint')).toContainText(/E: down/);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel',
      null, { timeout: 30000 });
    let d = await dbg(page);
    // True depth: exactly the platform the markers and shafts use.
    expect(d.eyeY).toBeCloseTo(st.platformY, 6);
    expect(st.platformY).toBeCloseTo(st.markerY, 3);
    expect((st.markerSurfaceY - d.eyeY) / VE).toBeCloseTo(st.markerDepthM, 2);
    const cam = await page.evaluate(() => ({ x: window.__ug.camera.position.x, z: window.__ug.camera.position.z }));
    expect(Math.hypot(cam.x - st.x, cam.z - st.z)).toBeLessThan(3);
    expect(d.tunnel.lineId).toBe(st.lineId);
    await expect(page.locator('#ug-mode-hint')).toContainText(/E: up/);

    // Tunnel lock: hold W; every frame the camera is on the tunnel centreline.
    const walk = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const frame = () => new Promise(r => requestAnimationFrame(r));
      const net = m.network;
      let worst = 0, moved = 0;
      const start = ug.camera.position.clone();
      ug.fpsControls.keys.add('w');
      for (let i = 0; i < 40; i++) {
        await frame();
        const t = m.debug().tunnel;
        const path = net.paths[t.path];
        // Nearest polyline point to the camera (brute force; tests only).
        let best = Infinity;
        for (let k = 0; k < path.n - 1; k++) {
          const ax = path.x[k], ay = path.y[k], az = path.z[k];
          const bx = path.x[k + 1], by = path.y[k + 1], bz = path.z[k + 1];
          const vx = bx - ax, vy = by - ay, vz = bz - az, len2 = vx * vx + vy * vy + vz * vz || 1;
          const p = ug.camera.position;
          const u = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy + (p.z - az) * vz) / len2));
          best = Math.min(best, Math.hypot(p.x - ax - vx * u, p.y - ay - vy * u, p.z - az - vz * u));
        }
        worst = Math.max(worst, best);
      }
      moved = ug.camera.position.distanceTo(start);
      // Shift: superhuman sprint.
      ug.fpsControls.keys.add('shift');
      for (let i = 0; i < 90; i++) await frame();
      const sprint = m.debug().tunnel.speed;
      ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
      return { worst, moved, sprint, phase: m.debug().phase };
    });
    expect(walk.worst).toBeLessThan(0.01);
    expect(walk.moved).toBeGreaterThan(1);
    expect(walk.phase).toBe('tunnel');
    expect(walk.sprint).toBeCloseTo(20, 1);

    // Back to a platform and up: E ascends to the street at eye height.
    await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const net = m.network, t = m.debug().tunnel;
      const stops = net.paths[t.path].stops;
      const nearest = stops.reduce((a, b) => (Math.abs(b.s - t.s) < Math.abs(a.s - t.s) ? b : a));
      window.__ascendAt = nearest.stop;
    });
    // Walk back toward that platform by facing it (turn 180 degrees) until the hint offers E.
    await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      m.turn(Math.PI, 0);
      window.__ug.fpsControls.keys.add('w');
    });
    await expect(page.locator('#ug-mode-hint')).toContainText(/E: up/, { timeout: 30000 });
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body',
      null, { timeout: 30000 });
    d = await dbg(page);
    expect(d.state).toBe('ground');
    const g = await page.evaluate(([x, z]) => window.__ug.modes.collision.groundHeightAt(x, z), [d.x, d.z]);
    expect(d.y).toBeCloseTo(g, 3);
    expect((d.eyeY - d.y) / VE).toBeCloseTo(1.7, 3);
  });

  test('the river: walking off a real Thames bank enters swim; Space strokes up; climbing out at the bank', async ({ page }) => {
    await boot(page);
    await enter(page);
    await page.mouse.click(5, 300); // user gesture starts audio so the splash has a bus
    // Find a real bank: land to the south, water to the north, on a north-south line.
    const bank = await page.evaluate(() => {
      const c = window.__ug.modes.collision;
      for (let x = -2000; x <= 4000; x += 125) {
        for (let z = -3000; z <= 3000; z += 5) {
          if (c.waterAt(x, z) || !c.waterAt(x, z - 5)) continue;
          // z is land, z-5 is water. Need 30m of water beyond and open land behind.
          let ok = true;
          for (let k = 1; k <= 6 && ok; k++) if (!c.waterAt(x, z - 5 * k)) ok = false;
          for (let k = 0; k <= 4 && ok; k++) if (c.waterAt(x, z + 5 * k) || c.standHeightAt(x, z + 5 * k, Infinity, 0) !== c.groundHeightAt(x, z + 5 * k)) ok = false;
          if (ok) return { x, z, surfaceY: c.waterAt(x, z - 5).surfaceY };
        }
      }
      return null;
    });
    expect(bank).not.toBeNull();
    // Stand 10m back from the edge facing the water (north = -Z, yaw 0) and run in.
    await page.evaluate(({ x, z }) => {
      window.__ug.modes.registry.get('pedestrian').place(x, z + 10, { yaw: 0 });
      window.__ug.fpsControls.keys.add('w');
    }, bank);
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().state === 'swim',
      null, { timeout: 30000 });
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    let d = await dbg(page);
    expect(d.z).toBeLessThan(bank.z);
    await expect(page.locator('#ug-mode-hint')).toContainText(/Swimming/);

    // Idle: sinks slowly (Mario-swim), never faster than the sink speed.
    await frames(page, 60);
    d = await dbg(page);
    expect(d.vy).toBeLessThan(0);
    expect(d.vy).toBeGreaterThanOrEqual(-0.55 - 1e-6);
    // Space strokes upward.
    const before = d.vy;
    await page.keyboard.press(' ');
    await frames(page, 2);
    d = await dbg(page);
    expect(d.vy).toBeGreaterThan(before + 1);
    // Head never above the water top by more than the head-out allowance.
    expect(d.eyeY).toBeLessThanOrEqual(bank.surfaceY + 0.2 * VE + 1e-6);

    // Turn back to the bank (face +Z) and swim with strokes until out.
    await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      m.turn(Math.PI, 0);
      window.__ug.fpsControls.keys.add('w');
      window.__strokeTimer = setInterval(() => m.press('jump'), 400);
    });
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().state === 'ground',
      null, { timeout: 60000 });
    await page.evaluate(() => { clearInterval(window.__strokeTimer); window.__ug.fpsControls.keys.delete('w'); });
    d = await dbg(page);
    expect(d.z).toBeGreaterThanOrEqual(bank.z - 5);
    const onLand = await page.evaluate(([x, z]) => window.__ug.modes.collision.waterAt(x, z), [d.x, d.z]);
    expect(onLand).toBeNull();
  });
});
