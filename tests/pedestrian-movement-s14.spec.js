// pedestrian-movement-s14.spec.js: lane M of sprint 14Oct26w (D-053 items 5 to 7) in the real app.
// The physics itself is pinned in tests/pedestrian-s14.test.mjs; this spec pins the wiring: the new rows
// on the Physics panel, Space and Q reaching the body through the mode's input, and a cold load with no errors.
//
// Never a wall-clock key hold: each measurement runs inside ONE page.evaluate, adds keys to
// fpsControls.keys, steps the mode clock with modes.update(1/60), records the body, and removes the keys.

import { test, expect } from '@playwright/test';

const VE = 5;
const errors = [];

async function boot(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 5;
  }, null, { timeout: 90000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => {
    const m = window.__ug.modes.registry.get('pedestrian').debug();
    return m.phase === 'body' && !m.ease.running;
  }, null, { timeout: 30000 });
}

test.describe('Lane M: Space, swimming and jetpack steering', () => {
  test.describe.configure({ mode: 'serial' });
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();   // a fresh context: ug:physics:v1 is empty
    await boot(page);
  });
  test.afterAll(async () => { await page?.context().close(); });

  test('M-APP-5 a cold load reaches the Pedestrian body with no console error', () => {
    expect(errors).toEqual([]);
  });

  test('M-APP-1 the Physics panel shows the new and changed Pedestrian values', async () => {
    await page.click('#ug-mode-bar button.physics');
    const sec = page.locator('#ug-physics-panel section[data-mode="pedestrian"]');
    await expect(sec).toBeVisible();
    const rows = () => page.evaluate(() => {
      const out = {};
      for (const i of document.querySelectorAll('#ug-physics-panel section[data-mode="pedestrian"] input[data-key]')) {
        out[i.dataset.key] = { value: Number(i.value), max: Number(i.max), text: i.closest('label').querySelector('output').textContent };
      }
      return out;
    });
    const r = await rows();
    expect(Object.keys(r).length).toBe(23);
    expect(r.jetDelay.value).toBe(0.15);
    expect(r.jetControl.value).toBe(32);
    expect(r.jetControl.max).toBeGreaterThanOrEqual(80);
    expect(r.jetControl.text).toBe('32.0 m/s²');
    expect(r.jetSpool.value).toBe(0.15);
    expect(r.jetSpool.text).toBe('0.15 s');
    expect(r.swimUp.value).toBe(1.6);
    expect(r.swimUp.text).toBe('1.6 m/s');
    expect(r.swimDive.value).toBe(1.6);
    expect(r.jetThrust.value).toBe(17);
    expect(r.jetMaxRise.value).toBe(18);
    expect(r.tunnelWalk.value).toBe(60);
    // Move one, Reset, and the defaults return.
    await page.evaluate(() => {
      const el = document.querySelector('#ug-physics-panel section[data-mode="pedestrian"] input[data-key="jetControl"]');
      el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((await rows()).jetControl.value).toBe(10);
    await sec.locator('button[data-action="reset"]').click();
    const after = await rows();
    expect(after.jetControl.value).toBe(32);
    expect(after.jetDelay.value).toBe(0.15);
    await page.click('#ug-mode-bar button.physics');   // close
  });

  test('M-APP-2 holding Space from standing hands over to the jetpack with no dip', async () => {
    const res = await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian'), keys = window.__ug.fpsControls.keys;
      const step = () => window.__ug.modes.update(1 / 60);
      let { x, z } = window.__ug.camera.position;
      m.place(x, z, { yaw: 0, pitch: 0 });
      if (m.body.state === 'swim') { x += 50; m.place(x, z, { yaw: 0, pitch: 0 }); }
      const start = m.body.state;
      m.press('jump');
      keys.add(' ');
      const tr = [];
      for (let i = 0; i < 120; i++) { step(); tr.push({ jet: !!m.body.jet, jl: m.body.jetLevel, vy: m.body.vy, y: m.body.y }); }
      keys.delete(' ');
      return { start, tr };
    });
    expect(res.start).toBe('ground');
    const first = res.tr.findIndex(s => s.jet) + 1;   // step number, 1-based
    expect(first).toBeGreaterThanOrEqual(9);
    expect(first).toBeLessThanOrEqual(10);
    for (let i = 0; i < res.tr.length; i++) {
      if (i < first - 1) expect(res.tr[i].jl).toBe(0);
      if (i) {
        expect(res.tr[i].vy).toBeGreaterThanOrEqual(res.tr[i - 1].vy - 1e-9);
        expect(res.tr[i].y).toBeGreaterThan(res.tr[i - 1].y);
      }
    }
    expect(res.tr.findIndex(s => s.jl >= 1 - 1e-9) + 1).toBeLessThanOrEqual(20);
    // Let go and land before the next measurement.
    await page.evaluate(() => { const m = window.__ug.modes.registry.get('pedestrian'); for (let i = 0; i < 1800 && m.body.state !== 'ground'; i++) window.__ug.modes.update(1 / 60); });
  });

  // Find the deepest stretch of the real Thames with water 20 m all round.
  async function deepSpot() {
    return page.evaluate(() => {
      const c = window.__ug.modes.collision;
      let best = null;
      for (let x = -3000; x <= 6000; x += 100) for (let z = -3000; z <= 3000; z += 10) {
        const w = c.waterAt(x, z);
        if (!w || !Number.isFinite(w.bedY)) continue;
        const depth = (w.surfaceY - w.bedY) / 5;
        if (depth < 4 || (best && depth <= best.depth)) continue;
        if ([[20, 0], [-20, 0], [0, 20], [0, -20]].every(([dx, dz]) => c.waterAt(x + dx, z + dz))) best = { x, z, depth };
      }
      return best;
    });
  }

  test('M-APP-3 Q dives and Space rises in the real Thames, and the swimmer stays at the surface', async () => {
    const spot = await deepSpot();
    expect(spot, 'a deep stretch of river was found').not.toBeNull();
    const dive = await page.evaluate(({ x, z }) => {
      const m = window.__ug.modes.registry.get('pedestrian'), keys = window.__ug.fpsControls.keys;
      m.place(x, z, { yaw: 0, pitch: 0 });
      const state0 = m.body.state;
      const w = window.__ug.modes.collision.waterAt(m.body.x, m.body.z);
      keys.add('q');
      const ys = [], states = [];
      for (let i = 0; i < 90; i++) { window.__ug.modes.update(1 / 60); ys.push(m.body.y); states.push(m.body.state); }
      keys.delete('q');
      return { state0, ys, states, bedY: w.bedY };
    }, spot);
    expect(dive.state0).toBe('swim');
    expect(dive.states.every(s => s === 'swim')).toBe(true);
    const rate = (dive.ys[29] - dive.ys[89]) / VE / (60 / 60);
    const onBed = Math.abs(dive.ys[89] - dive.bedY) < 1e-6;
    expect(onBed || Math.abs(rate - 1.6) <= 0.15, `descent ${rate} m/s`).toBe(true);

    const rise = await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian'), keys = window.__ug.fpsControls.keys;
      m.press('jump');
      keys.add(' ');
      const states = [];
      for (let i = 0; i < 300; i++) { window.__ug.modes.update(1 / 60); states.push(m.body.state); }
      keys.delete(' ');
      const w = window.__ug.modes.collision.waterAt(m.body.x, m.body.z);
      return { eye: m.body.y + 1.7 * 5, surfaceY: w.surfaceY, states };
    });
    expect(rise.states.every(s => s === 'swim')).toBe(true);
    expect(rise.eye).toBeGreaterThanOrEqual(rise.surfaceY + 0.15 * VE);
    expect(rise.eye).toBeLessThanOrEqual(rise.surfaceY + 0.2 * VE + 1e-6);
  });

  test('M-APP-4 W follows the view in first person, and holds depth in third', async () => {
    const spot = await deepSpot();
    const res = await page.evaluate(({ x, z }) => {
      const m = window.__ug.modes.registry.get('pedestrian'), keys = window.__ug.fpsControls.keys;
      const step = () => window.__ug.modes.update(1 / 60);
      const w = () => window.__ug.modes.collision.waterAt(m.body.x, m.body.z);
      m.place(x, z, { yaw: 0, pitch: 0 });
      keys.add('q');
      for (let i = 0; i < 600; i++) {
        step();
        const ww = w();
        if ((ww.surfaceY - m.body.y) / 5 >= 2 && (m.body.y - ww.bedY) / 5 >= 1.5) break;
      }
      keys.delete('q');
      for (let i = 0; i < 30; i++) step();   // let the dive command die away
      const tp = !!window.__ug.modes.ctx.playerView?.isThirdPerson?.();
      const y0 = m.body.y, bedMargin = (y0 - w().bedY) / 5;
      m.turn(0, -Math.PI / 4);
      keys.add('w');
      for (let i = 0; i < 90; i++) step();
      keys.delete('w');
      return { tp, deeperM: (y0 - m.body.y) / 5, bedMargin };
    }, spot);
    expect(res.bedMargin).toBeGreaterThan(1.4);
    if (res.tp) expect(Math.abs(res.deeperM)).toBeLessThanOrEqual(0.1);
    else expect(res.deeperM).toBeGreaterThanOrEqual(0.5);
  });
});
