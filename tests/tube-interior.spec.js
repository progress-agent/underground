// tube-interior.spec.js: Pedestrian mode underground shows the inside of the
// tube (sprint 25Sep26f, D-039, Lane P; Jordan's note 10). In the real app:
//   * in a tunnel, rays from the camera hit the interior lining in every
//     direction around the bore axis (and tilted ahead and behind), at the
//     line's TRUE bore radius, at Master 1 and at a stretched Master (D-039:
//     structures keep true proportions, the bore stays round);
//   * the walker's own line ribbon (every crown ribbon), the station markers
//     and the station shafts are hidden while inside; the near clip is 0.1;
//   * leaving the mode restores the near clip, the ribbons and markers, and
//     hides the lining;
//   * another mode's picture is unchanged: a frozen Deity frame at a reference
//     underground pose is pixel-identical before and after a Pedestrian trip
//     down a tunnel and back.
// Geometry details (window, winding, caps, determinism) are pinned in
// tests/tube-interior.test.mjs.

import { test, expect } from '@playwright/test';

const LANDING = { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] }; // render-merges.spec.js reference pose
const MAX_PCT = 0.002; // render-economies.spec.js's pixel tolerance

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    // Frozen, stepped app loop (render-merges.spec.js): stepping re-runs tick
    // with the same timestamp, so dt = 0 and nothing moves between grabs.
    const raf = window.requestAnimationFrame.bind(window);
    const held = [];
    let lastTs = 0;
    window.requestAnimationFrame = cb => {
      if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
      return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
    };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; const h = held.splice(0); for (const cb of h) window.requestAnimationFrame(cb); };
    window.__grab = () => {
      const u = window.__ug, r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      window.__step(4); u.composer.render(0); r.setRenderTarget(null);
      const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return { b, W, H };
    };
    window.__diff = (a, b) => {
      let n = 0, max = 0;
      for (let i = 0; i < a.b.length; i += 4) {
        const d = Math.max(Math.abs(a.b[i] - b.b[i]), Math.abs(a.b[i + 1] - b.b[i + 1]), Math.abs(a.b[i + 2] - b.b[i + 2]));
        if (d) { n++; if (d > max) max = d; }
      }
      return { px: n, pct: n / (a.W * a.H) * 100, max };
    };
    window.__place = async pose => {
      const u = window.__ug; u.controls.enableDamping = false;
      u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
      await new Promise(res => setTimeout(res, 1200));
      window.__freeze = true; await new Promise(res => setTimeout(res, 100));
    };
  });
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 5
      && window.__ug.modes.ctx.tubeInterior && window.__ug.unifiedShaftLayer
      && window.__ug.trainSystem?.allTrains.length > 100;
  }, null, { timeout: 180000 });
  // Nothing on the network moves while the frames are compared.
  await page.evaluate(() => { window.__ug.sim.paused = true; });
  await page.waitForTimeout(2000);
});
test.afterAll(async () => { await page?.close(); });

const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());

/** Pedestrian mode, down the shaft at `name`, into the bore of `lineId`. */
async function descend(name, lineId) {
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body',
    null, { timeout: 30000 });
  const ok = await page.evaluate(([name, lineId]) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const net = m.rebuildNetwork();
    const e = net.entrances.find(en => en.name === name && en.stops.some(s => s.lineId === lineId));
    if (!e) return false;
    ug.modes.physics.set('pedestrian', 'shaftSpeed', 400);
    const stop = e.stops.find(s => s.lineId === lineId), p = net.paths[stop.path];
    const i = Math.max(0, Math.min(p.n - 2, p.s.findIndex(x => x >= stop.s)));
    m.place(e.x + 3, e.z + 3, { yaw: Math.atan2(-(p.x[i + 1] - p.x[i]), -(p.z[i + 1] - p.z[i])) });
    return true;
  }, [name, lineId]);
  expect(ok).toBe(true);
  await page.waitForTimeout(200);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel',
    null, { timeout: 30000 });
}

/** Rays from the camera round the axis (display space, as drawn). */
const probe = () => page.evaluate(() => window.__ug.modes.ctx.tubeInterior.probe(window.__ug.camera, { count: 24 }));

function expectEnclosed(r, boreRadius, label) {
  expect(r, label).not.toBeNull();
  expect(r.hits.length).toBe(24 * 3);
  for (const h of r.hits) {
    expect(h.distance, `${label}: ${h.kind} ray at ${(h.th * 180 / Math.PI).toFixed(0)} degrees escapes`).not.toBeNull();
    // Radial rays meet the wall at the bore radius; 45-degree rays at radius x sqrt 2
    // (the bore curves a little over that distance, hence the looser bound).
    const expected = h.kind === 'radial' ? r.radius : r.radius * Math.SQRT2;
    expect(Math.abs(h.distance - expected), `${label}: ${h.kind} ray at ${h.th.toFixed(2)}: ${h.distance}`)
      .toBeLessThan(h.kind === 'radial' ? 0.12 : 0.35);
  }
  // True bore size for the line (drawn just inside the exterior glass).
  expect(r.radius).toBeGreaterThan(boreRadius - 0.1);
  expect(r.radius).toBeLessThan(boreRadius);
}

test('in a tunnel the walker is enclosed by the lining, ribbons hidden, near clip 0.1; all restored on exit', async () => {
  // Every map device's own visibility before entry (some marker layers are
  // hidden by design; each must come back exactly as it was).
  const before = await page.evaluate(() => {
    const ug = window.__ug;
    const devices = [...ug.lineRibbonsById.values()].flat()
      .concat([...ug.lineShaftLayers.values()].map(l => l.stationsLayer?.mesh).filter(Boolean))
      .concat([ug.unifiedShaftLayer.group]);
    window.__devices = devices.map(m => [m, m.visible]);
    return { near: ug.camera.near, ribbons: [...ug.lineRibbonsById.values()].flat().filter(m => m.visible).length,
      markers: [...ug.lineShaftLayers.values()].filter(l => l.stationsLayer?.mesh?.visible).length, devices: devices.length };
  });
  expect(before.near).toBe(1);
  expect(before.ribbons).toBeGreaterThan(10);
  expect(before.markers).toBeGreaterThan(5);
  expect(await page.evaluate(() => window.__ug.modes.ctx.tubeInterior.visible)).toBe(false);

  await descend('Lancaster Gate', 'central');
  let d = await dbg();
  expect(d.phase).toBe('tunnel');
  expect(d.near).toBeCloseTo(0.1, 9);
  expect(d.interior.visible).toBe(true);
  expect(d.interior.lineId).toBe('central');
  expect(d.interior.side).toBe(d.tunnel.side);
  const state = await page.evaluate(() => {
    const ug = window.__ug;
    return {
      ownRibbons: (ug.lineRibbonsById.get('central') || []).map(m => m.visible),
      anyRibbon: [...ug.lineRibbonsById.values()].flat().some(m => m.visible),
      anyMarker: [...ug.lineShaftLayers.values()].some(l => l.stationsLayer?.mesh?.visible),
      shafts: ug.unifiedShaftLayer.group.visible,
      boreRadius: ug.trueProportion.boreRadiusM('central'),
      master: ug.masterHeight.value,
    };
  });
  expect(state.ownRibbons.length).toBeGreaterThan(0);
  expect(state.ownRibbons.every(v => v === false)).toBe(true);
  expect(state.anyRibbon).toBe(false);
  expect(state.anyMarker).toBe(false);
  expect(state.shafts).toBe(false);
  expect(state.master).toBe(1);
  expectEnclosed(await probe(), state.boreRadius, 'at the platform');

  // Walk and sprint well past the window: still enclosed every time we look.
  await page.evaluate(() => { const k = window.__ug.fpsControls.keys; k.add('w'); k.add('shift'); });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    expectEnclosed(await probe(), state.boreRadius, `walking, sample ${i}`);
  }
  await page.evaluate(() => { const k = window.__ug.fpsControls.keys; k.delete('w'); k.delete('shift'); });
  d = await dbg();
  expect(d.phase).toBe('tunnel');
  expect(d.interior.builds).toBeGreaterThan(1); // the window followed the walker

  // D-039: stretch Master while inside; the bore stays round at its true size.
  await page.evaluate(() => {
    const el = document.getElementById('masterHeight');
    el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__ug.masterHeight.value)).toBe(3);
  expectEnclosed(await probe(), state.boreRadius, 'at Master 3');

  // Leaving the mode restores everything it changed.
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const ug = window.__ug;
    return { mode: ug.modes.activeId, near: ug.camera.near, interior: ug.modes.ctx.tubeInterior.visible,
      changed: window.__devices.filter(([m, was]) => m.visible !== was).length };
  });
  expect(after).toEqual({ mode: 'deity', near: 1, interior: false, changed: 0 });
});

test('the near clip is 0.1 only below ground: back on the street it is restored', async () => {
  await descend('Goodge Street', 'northern');
  expect((await dbg()).near).toBeCloseTo(0.1, 9);
  // E at the platform: back up the shaft to the street.
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body',
    null, { timeout: 30000 });
  const d = await dbg();
  expect(d.near).toBe(1);
  expect(d.interior.visible).toBe(false);
  expect(await page.evaluate(() => [...window.__ug.lineRibbonsById.values()].flat().every(m => m.visible))).toBe(true);
  await page.keyboard.press('1');
  expect(await page.evaluate(() => window.__ug.camera.near)).toBe(1);
});

test('Deity pixels at a reference underground pose are unchanged by a Pedestrian trip down a tunnel', async () => {
  await page.evaluate(async (pose) => { await window.__place(pose); }, LANDING);
  const r1 = await page.evaluate(() => {
    const a = window.__grab(), a2 = window.__grab();
    window.__before = a;
    return window.__diff(a, a2);
  });
  expect(r1.px).toBe(0); // the frozen frame is stable (noise floor)
  await page.evaluate(() => window.__thaw());
  await descend('Pimlico', 'victoria');
  await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(async (pose) => {
    await window.__place(pose);
    const b = window.__grab();
    return { diff: window.__diff(window.__before, b), mode: window.__ug.modes.activeId, master: window.__ug.masterHeight.value };
  }, LANDING);
  await page.evaluate(() => window.__thaw());
  expect(r2.mode).toBe('deity');
  expect(r2.diff.pct, JSON.stringify(r2.diff)).toBeLessThanOrEqual(MAX_PCT);
});
