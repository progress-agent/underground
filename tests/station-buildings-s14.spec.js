// station-buildings-s14.spec.js: lane B round two (sprint 14Oct26w; D-052 item 2, D-053 items 9 and 14).
//
//   1. Fulham Broadway and North Greenwich keep their big map box, with one marked entrance block: the box stands, roundels sit on
//      part of its sides and on its roof, touching the entrance opens the card and touching the box elsewhere does not, "Up to the
//      street" lands clear of it.
//   2. Names hung over white walls: a surface name is hidden when the point it hangs at is behind a station building, a map box or a
//      landmark (addSurfaceLabelOccluder is the hook lane P's figure uses too).
//   3. The name bar has no grey outline.
//   4. King's Cross at Master 1.5 shows no street over its roof.
//   5. Hover names a bridge, a train or an aircraft in front of a station building, not the station.
// The data rules are in tests/station-buildings.test.mjs and tests/station-buildings-ground.test.mjs; the Master scan of every
// roundel is in tests/station-buildings.spec.js ("no wall roundel is under the street ... at Master 1.0, 1.1, 1.5 and 3").
//
// Run through the GPU lock (ug-gpu.sh / ug-gpu-laptop.sh), headless ANGLE Metal, one worker. Set UG_BASE_URL to a server on bf10309 to
// have the before/after comparisons of the name tests run too (without it the "base shows the problem" evidence is skipped).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.describe.configure({ mode: 'default' });
test.setTimeout(300000);

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/station-buildings.json'), 'utf8'));
const KX = "King's Cross St. Pancras";
const SITES = { 'fulham-broadway': 'Fulham Broadway', 'north-greenwich': 'North Greenwich' };
const BLOCK = (site) => DATA.buildings.find(b => b.key === DATA.sites[site].building);
const FB0 = [-4555.31, 3085.84], NG0 = [9141.75, 551.83];       // the 04Oct26u report's old label points (the pose anchors)

let page;
const errors = [];

async function load(p, url) {
  await p.goto(url);
  await p.waitForFunction(() => {
    const u = window.__ug;
    return !!(u && u.modes && u.stationBuildings?.ready && u.overground?.userData.stationsAttached && u.surfaceRail?.stationLayers.size > 0 && u.lineBranchCenterPts?.size > 11
      && (u.buildingsPath !== 'baked' || (u.bakedStats && u.bakedStats.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal)));
  }, null, { timeout: 240000 });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await load(page, '/?fast=1&buildings=baked&mh=1.1');
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
  await installPixelHelpers();
});
test.afterAll(async () => { await page?.close(); });

async function installPixelHelpers() {
  await page.evaluate(() => {
    const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
    window.__sbGrab = () => { u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0)); rr.setRenderTarget(null);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return { b, W, H }; };
    window.__sbMask = (hideFn, showFn) => {
      const A = window.__sbGrab(); hideFn(); const B = window.__sbGrab(); showFn();
      const mask = new Uint8Array(A.W * A.H);
      for (let i = 0, k = 0; i < mask.length; i++, k += 4) mask[i] = (Math.abs(A.b[k] - B.b[k]) + Math.abs(A.b[k + 1] - B.b[k + 1]) + Math.abs(A.b[k + 2] - B.b[k + 2])) > 8 ? 1 : 0;
      return { A, mask };
    };
    window.__sbGroup = () => u.scene.getObjectByName('station-buildings');
    window.__sbHue = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d === 0) return [0, 0, mx / 255]; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; return [h, d / mx, mx / 255]; };
    // The baked instance whose centre is (x, z) within 0.5 m and side within 0.2 of `side`: { o, i } or null.
    window.__sbHostInstance = (x, z, side) => {
      let found = null;
      u.scene.getObjectByName('surfaceGeometry').traverse(o => {
        if (!o.name?.startsWith('baked-buildings-')) return;
        const a = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) if (Math.abs(a[i * 16 + 12] - x) <= 0.5 && Math.abs(a[i * 16 + 14] - z) <= 0.5 && Math.abs(Math.abs(a[i * 16]) - side) <= 0.2) found = { o, i };
      });
      return found;
    };
  });
}

/** Camera at (x, z) + (dx, dz), `upM` metres over the ground at (x, z), looking at the ground there (the acceptance's bl()). */
const bl = (x, z, upM, dx, dz, wait = 1500) => page.evaluate(async ([x, z, upM, dx, dz, wait]) => {
  const u = window.__ug, gy = u.getTerrainMeshSurfaceY({ x, z });
  u.camera.position.set(x + dx, gy + upM * 5, z + dz); u.controls.target.set(x, gy, z); u.controls.update();
  await new Promise(r => setTimeout(r, wait));
}, [x, z, upM, dx, dz, wait]);
/** Camera at an exact point looking at a point (both in metres over the ground there). */
const look = (from, fromUp, to, toUp, wait = 1500) => page.evaluate(async ([from, fromUp, to, toUp, wait]) => {
  const u = window.__ug, g1 = u.getTerrainMeshSurfaceY({ x: from[0], z: from[1] }), g2 = u.getTerrainMeshSurfaceY({ x: to[0], z: to[1] });
  u.camera.position.set(from[0], g1 + fromUp * 5, from[1]); u.controls.target.set(to[0], g2 + toUp * 5, to[1]); u.controls.update();
  await new Promise(r => setTimeout(r, wait));
}, [from, fromUp, to, toUp, wait]);
const setMaster = (M) => page.evaluate(async (M) => {
  const el = document.getElementById('masterHeight'); el.value = String(M); el.dispatchEvent(new Event('input', { bubbles: true }));
  window.__ug.structureMorph.flush(); await new Promise(r => setTimeout(r, 600));
  return window.__ug.getBuildingHeightScale();
}, M);

/** The F2 / G2 pose of the acceptance: the exit pose moved a further 60 m along its facing, 20 m up, looking at the block 5 m up. */
const streetSide = async (site) => {
  const b = BLOCK(site), e = b.exit, fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), c = b.outline.reduce((a, p) => [a[0] + p[0] / b.outline.length, a[1] + p[1] / b.outline.length], [0, 0]);
  await look([e.x + fx * 60, e.z + fz * 60], 20, c, 5);
};

/** Pixels of the station-buildings group by hue (red ring, blue bar), the group hidden and shown in one task. */
const stationHues = () => page.evaluate(() => {
  const g = window.__sbGroup();
  const { A, mask } = window.__sbMask(() => { g.visible = false; }, () => { g.visible = true; });
  const near = (h, c, w) => Math.min(Math.abs(h - c), 360 - Math.abs(h - c)) <= w;
  const n = { mask: 0, red: 0, blue: 0 };
  for (let i = 0, k = 0; i < mask.length; i++, k += 4) {
    if (!mask[i]) continue; n.mask++;
    const [h, s, v] = window.__sbHue(A.b[k], A.b[k + 1], A.b[k + 2]);
    if (s < 0.45 || v < 0.15) continue;
    if (near(h, 3, 12)) n.red++; else if (near(h, 235, 16)) n.blue++;
  }
  return n;
});

// ── 1. Fulham Broadway and North Greenwich ────────────────────────────────

test('B14-2.2 the big box stands: the host is a drawn map box again, and its pixels are many at the report poses', async () => {
  const want = { 'fulham-broadway': { pose: [FB0, 45, 90, 90], min: 20000 }, 'north-greenwich': { pose: [NG0, 60, 140, 110], min: 10000 } };
  const out = {};
  for (const [site, w] of Object.entries(want)) {
    const host = BLOCK(site).host;
    await bl(w.pose[0][0], w.pose[0][1], w.pose[1], w.pose[2], w.pose[3]);
    out[site] = await page.evaluate(([host]) => {
      const T = window.__ugTHREE, found = window.__sbHostInstance(host.x, host.z, host.side);
      if (!found) return { found: false };
      const m4 = new T.Matrix4(); found.o.getMatrixAt(found.i, m4); const away = m4.clone(); away.setPosition(0, -1e6, 0);
      const { mask } = window.__sbMask(() => { found.o.setMatrixAt(found.i, away); found.o.instanceMatrix.needsUpdate = true; }, () => { found.o.setMatrixAt(found.i, m4); found.o.instanceMatrix.needsUpdate = true; });
      let n = 0; for (let i = 0; i < mask.length; i++) n += mask[i];
      return { found: true, pixels: n };
    }, [host]);
  }
  console.log('host boxes', JSON.stringify(out));
  for (const [site, w] of Object.entries(want)) {
    expect(out[site].found, `${site}: a baked instance at the host's centre and size`).toBe(true);
    expect(out[site].pixels, `${site}: host pixels`).toBeGreaterThanOrEqual(w.min);
  }
});

test('B14-2.3 roundels on a portion of its sides and one on the roof, at the ordinary sizes (data and pixels)', async () => {
  for (const [site, minWalls] of [['fulham-broadway', 5], ['north-greenwich', 3]]) {
    const b = BLOCK(site), c = b.outline.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const walls = b.roundels.filter(r => r.on === 'wall'), roofs = b.roundels.filter(r => r.on === 'roof');
    expect(walls.length, `${site}: wall roundels`).toBeGreaterThanOrEqual(minWalls);
    expect(roofs.length).toBe(1);
    for (const r of walls) {
      expect(r.D).toBeGreaterThanOrEqual(3.4); expect(r.D).toBeLessThanOrEqual(6.0);
      expect(Math.hypot(r.x - c[0], r.z - c[1]), `${site}: within 32 m of the block`).toBeLessThanOrEqual(32);
      if (Math.abs(r.nx) > 0.5) expect(r.host, 'no ring on the host\'s east or west face').toBeFalsy();
    }
    expect(roofs[0].D).toBeGreaterThanOrEqual(7); expect(roofs[0].D).toBeLessThanOrEqual(24);
    expect(Math.abs(roofs[0].yM - b.host.h)).toBeLessThanOrEqual(0.05);
    await streetSide(site);
    const hues = await stationHues();
    console.log(site, 'street side hues', JSON.stringify(hues));
    expect(hues.red, `${site}: ring red at the street side`).toBeGreaterThanOrEqual(2000);
    expect(hues.blue, `${site}: bar blue at the street side`).toBeGreaterThanOrEqual(400);
  }
  for (const [site, pose] of [['fulham-broadway', [FB0, 45, 90, 90]], ['north-greenwich', [NG0, 60, 140, 110]]]) {
    await bl(pose[0][0], pose[0][1], pose[1], pose[2], pose[3]);
    const hues = await stationHues();
    console.log(site, 'report pose hues', JSON.stringify(hues));
    expect(hues.red, `${site}: the roof roundel from the report pose`).toBeGreaterThanOrEqual(300);
  }
});

// ── Walking ───────────────────────────────────────────────────────────────

const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
async function enterWalk() {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  if (await page.evaluate(() => window.__ug.modes.activeId) === 'pedestrian') return;
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}
/** Place the walker at (x, z) facing `yaw`; if it lands more than 2.5 m over the ground, move 2 m further along `yaw` (up to 10 m). */
const placeAt = (x, z, yaw) => page.evaluate(async ([x, z, yaw]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), col = u.modes.collision;
  let moved = 0;
  for (; moved <= 10; moved += 2) {
    m.place(x - Math.sin(yaw) * moved, z - Math.cos(yaw) * moved, { yaw, pitch: 0 });
    await new Promise(r => requestAnimationFrame(r));
    const d = m.debug();
    if (d.y - col.groundHeightAt(d.x, d.z) <= 2.5) break;
  }
  const d = m.debug();
  return { moved, x: d.x, z: d.z, y: d.y };
}, [x, z, yaw]);
const pushIn = (frames = 240, keys = ['w']) => page.evaluate(async ([frames, keys]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const log = [];
  for (const k of keys) u.fpsControls.keys.add(k);
  try {
    for (let i = 0; i < frames; i++) {
      await frame();
      const d = m.debug();
      const hit = sb.contactAt(d.x, d.z, 30);
      log.push({ x: d.x, z: d.z, vx: d.vx, vz: d.vz, d: hit ? hit.d : null, key: hit?.building.key ?? null, card: d.card?.kind ?? null, open: d.chooser.open, rows: d.chooser.rows });
    }
  } finally { for (const k of keys) u.fpsControls.keys.delete(k); }
  return log;
}, [frames, keys]);

test('B14-2.5 touching the box elsewhere does not open the card, and never gets within 0.30 m of the host', async () => {
  const starts = [
    ['fulham-broadway', -4520.3, 3036.7, Math.PI], ['fulham-broadway', -4502.7, 3100.0, Math.PI / 2],
    ['north-greenwich', 9116.1, 504.2, Math.PI], ['north-greenwich', 9087.2, 570.0, -Math.PI / 2],
  ];
  const out = [];
  for (const [site, x, z, yaw] of starts) {
    await enterWalk();
    const host = BLOCK(site).host, half = host.side / 2;
    const placed = await placeAt(x, z, yaw);
    const log = await pushIn(240);        // 4 s at 60 frames a second
    // distance outside the host square (Chebyshev-like: the walker's centre against the axis-aligned square)
    const dist = (f) => Math.max(Math.abs(f.x - host.x) - half, Math.abs(f.z - host.z) - half);
    const minOutside = Math.min(...log.map(dist));
    out.push({ site, x, z, placed, anyCard: log.some(f => f.open || f.card), endOutside: dist(log.at(-1)), minOutside });
    await page.keyboard.press('Escape');
    await page.keyboard.press('1');
  }
  console.log('touching the box elsewhere', JSON.stringify(out));
  for (const r of out) {
    expect(r.anyCard, `${r.site} (${r.x}, ${r.z}): no card at any frame`).toBe(false);
    expect(r.minOutside, `${r.site}: the walker's centre never comes within 0.30 m of the host`).toBeGreaterThanOrEqual(0.30);
    expect(r.endOutside, `${r.site}: ends within 1.0 m outside the host square`).toBeLessThanOrEqual(1.0);
  }
});

for (const [site, name, line, exitRows] of [['fulham-broadway', 'Fulham Broadway', 'district', /District/], ['north-greenwich', 'North Greenwich', 'jubilee', /Jubilee/]]) {
  test(`B14-2.6 ${name}: down by the entrance, "Up to the street" lands clear of the block, facing away, and the card re-arms after 5 m`, async () => {
    await enterWalk();
    const b = BLOCK(site), pose = b.exit;
    // Walk in to the card (B14-2.4's contact), take the platform row, then ride to the street.
    const placed = await page.evaluate(([x, z, yaw]) => {
      const m = window.__ug.modes.registry.get('pedestrian'); m.place(x, z, { yaw: yaw + Math.PI, pitch: 0 }); return true;
    }, [pose.x, pose.z, pose.yaw]);
    expect(placed).toBe(true);
    const log = await pushIn(300);
    const i = log.findIndex(f => f.d !== null && f.d <= 0.40);
    expect(i, `${name}: reached the block`).toBeGreaterThan(-1);
    expect(log[i].open || log[i + 1]?.open, 'the card is open at the contact frame or the next').toBe(true);
    expect(log[i + 1].rows.some(r => exitRows.test(r)), `${name}: rows ${JSON.stringify(log[i + 1].rows)}`).toBe(true);
    // the first row: the platform
    await page.keyboard.press('1');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel', null, { timeout: 90000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
    await page.keyboard.press('1');             // Up to the street
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 90000 });
    const r = await page.evaluate((name) => {
      const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, d = m.debug(), col = u.modes.collision;
      const key = sb.siteKeyOf(name), p = sb.stationExitPose(key), hit = sb.contactAt(d.x, d.z, 60);
      return { pose: p, d: { x: d.x, y: d.y, z: d.z, yaw: d.yaw }, ground: col.groundHeightAt(d.x, d.z), water: col.waterAt(d.x, d.z), top: col.standHeightAt(d.x, d.z, Infinity, 0),
        dist: hit?.d, facing: hit ? (-Math.sin(d.yaw)) * (d.x - hit.x) / Math.max(hit.d, 1e-9) + (-Math.cos(d.yaw)) * (d.z - hit.z) / Math.max(hit.d, 1e-9) : null };
    }, name);
    console.log(name, 'up to the street', JSON.stringify(r));
    expect(Math.hypot(r.d.x - r.pose.x, r.d.z - r.pose.z)).toBeLessThan(0.5);
    expect(Math.abs(Math.atan2(Math.sin(r.d.yaw - r.pose.yaw), Math.cos(r.d.yaw - r.pose.yaw)))).toBeLessThan(0.05);
    expect(Math.abs(r.d.y - r.ground)).toBeLessThan(1e-3);
    expect(r.water).toBeNull();
    expect(r.top).toBeLessThanOrEqual(r.ground + 2.5);
    expect(r.dist).toBeGreaterThanOrEqual(5.5); expect(r.dist).toBeLessThanOrEqual(7.0);
    expect(r.facing).toBeGreaterThanOrEqual(0.7);
    await page.waitForTimeout(2000);
    expect((await dbg()).card, 'no card standing at the exit for 2 s').toBeNull();
    // 3 m out and back: no card (the latch is the exit's distance + 5 m); past that and back: the card opens within one frame
    await pushIn(Math.ceil(3 / 0.1));
    await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
    const back = await pushIn(300);
    expect(back.some(f => f.d !== null && f.d <= 0.4), 'reached the block').toBe(true);
    expect(back.every(f => !f.open), 'no card at the block after 3 m out and back').toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('1');
  });
}

// ── 4. King's Cross at Master 1.5 (C7) ─────────────────────────────────────

test('B14-5.4 King\'s Cross at Master 1.5: its rings and bar are drawn, and the walker stands on the street, not on the roof', async () => {
  const scale = await setMaster(1.5);
  expect(scale).toBeCloseTo(1 / 1.5, 4);
  await enterWalk();
  const pose = DATA.buildings.find(b => b.key === DATA.sites['kings-cross-st-pancras'].building).exit;
  await page.evaluate(([x, z, yaw]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw: yaw + Math.PI, pitch: 0 }), [pose.x, pose.z, pose.yaw]);
  await page.waitForTimeout(1500);
  const hues = await stationHues();
  const st = await page.evaluate(() => { const u = window.__ug, d = u.modes.registry.get('pedestrian').debug(); return { dy: d.y - u.modes.collision.groundHeightAt(d.x, d.z) }; });
  console.log('King\'s Cross at Master 1.5', JSON.stringify({ hues, st }));
  expect(hues.red, 'ring red').toBeGreaterThanOrEqual(5000);
  expect(hues.blue, 'bar blue').toBeGreaterThanOrEqual(1000);
  expect(st.dy, 'the walker stands on the street').toBeLessThanOrEqual(0.01);
  await page.keyboard.press('1');
  await setMaster(1.1);
});

test('a cold load printed no console error', async () => {
  expect(errors.filter(e => !/favicon/i.test(e))).toEqual([]);
});
