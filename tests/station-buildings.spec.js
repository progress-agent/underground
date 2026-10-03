// station-buildings.spec.js: lane B (sprint 02Oct26f), white station buildings in the real app.
//
// D-048 items 2 to 4 and D-047 rail-overground-markers / walk-street-exit: every station is one white building
// with big roundels; the white spheres are gone; the map's boxes under a building are hidden on both paths; labels
// hang above the roof; hover reads the building; in the Pedestrian, touching a building stops the walker and opens
// the platform card, "Up to the street" lands outside facing the street and the card re-arms after 5 m.
// The data rules are pinned in tests/station-buildings.test.mjs; this spec is the running scene.
//
// Run through the GPU lock (ug-gpu.sh), headless ANGLE Metal, one worker.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// One failure must not hide the rest (the page is shared; each test sets its own pose).
test.describe.configure({ mode: 'default' });
test.setTimeout(300000);

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/station-buildings.json'), 'utf8'));
const KX = "King's Cross St. Pancras";

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
});
test.afterAll(async () => { await page?.close(); });

/** Camera at the label point of a site + (dx, dz), `upM` metres above ground, looking at the label point on the ground. */
const bl = (name, upM, dx, dz, wait = 1200) => page.evaluate(async ([name, upM, dx, dz, wait]) => {
  const u = window.__ug, sb = u.stationBuildings, key = sb.siteKeyOf(name), site = sb.data.sites[key];
  const b = sb.data.buildings.find(q => q.key === site.building), gy = u.getTerrainMeshSurfaceY({ x: b.label.x, z: b.label.z });
  u.camera.position.set(b.label.x + dx, gy + upM * 5, b.label.z + dz);
  u.controls.target.set(b.label.x, gy, b.label.z); u.controls.update();
  await new Promise(r => setTimeout(r, wait));
  return { key, building: b.key };
}, [name, upM, dx, dz, wait]);

/** bl() for another page (the live path's). */
const bl2 = (p, name) => p.evaluate(async (name) => {
  const u = window.__ug, sb = u.stationBuildings, b = sb.index.buildingForName(name), gy = u.getTerrainMeshSurfaceY({ x: b.label.x, z: b.label.z });
  u.camera.position.set(b.label.x, gy + 300 * 5, b.label.z + 200); u.controls.target.set(b.label.x, gy, b.label.z); u.controls.update();
  await new Promise(r => setTimeout(r, 1200));
}, name);

// ── The scene, the cost and the data in the browser ────────────────────────

test('the station buildings are built from the tracked data: two meshes, no per-instance colour, inside the cost cap', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, sb = u.stationBuildings, g = u.scene.getObjectByName('station-buildings');
    const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
    let tri = 0; for (const m of meshes) tri += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    return { parent: g.parent === u.scene, names: meshes.map(m => m.name), instanced: meshes.filter(m => m.isInstancedMesh || m.instanceColor).length,
      tri, stats: sb.stats, buildings: sb.data.buildings.length, fog: meshes.map(m => m.material.fog), walls: sb.meshes.walls.userData.triBuilding.length };
  });
  console.log('station buildings', JSON.stringify(r));
  expect(r.parent, 'a direct child of the scene (never a line group, so the D-040 cull leaves it drawn)').toBe(true);
  expect(r.names.sort()).toEqual(['station-buildings-walls', 'station-roundels']);
  expect(r.instanced).toBe(0);
  expect(r.buildings).toBe(DATA.buildings.length);
  expect(r.stats.draws).toBeLessThanOrEqual(3);
  expect(r.tri).toBeLessThanOrEqual(80000);
  expect(r.stats.textureBytes).toBeLessThanOrEqual(24 * 1048576);
  expect(r.stats.atlasMs).toBeLessThanOrEqual(120);
  expect(r.fog.every(f => f === true), 'fogged, unlike the platform roundel').toBe(true);
});

test('no white sphere is drawn above or below ground; the Elizabeth line keeps its seven', async () => {
  const count = () => page.evaluate(() => {
    const u = window.__ug; let drawn = 0, listed = 0, cross = 0;
    const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    u.scene.traverse(o => {
      if (o.userData?.kind === 'station-markers' && o.parent && visible(o)) drawn++;
      if (o.userData?.kind === 'station-markers') listed++;
      if (o.isMesh && o.geometry?.type === 'SphereGeometry' && visible(o) && o.parent?.name && /crossrail/i.test(o.parent.name + (o.name || ''))) cross++;
    });
    let crossAll = 0; const cr = u.scene.getObjectByName('crossrail') ?? u.scene.children.find(c => /crossrail/i.test(c.name || ''));
    cr?.traverse(o => { if (o.isMesh && o.geometry?.type === 'SphereGeometry') crossAll++; });
    return { drawn, listed, cross, crossAll, retired: [...u.lineShaftLayers.values()].every(l => l.stationsLayer.mesh.userData.retired === true),
      railRetired: [...u.surfaceRail.stationLayers.values()].every(l => l.stationsLayer.mesh.userData.retired === true) };
  });
  await bl(KX, 300, 0, 200);
  const above = await count();
  expect(above.drawn).toBe(0);
  expect(above.retired && above.railRetired).toBe(true);
  expect(above.crossAll, 'the Elizabeth spheres stay').toBeGreaterThan(0);
  await page.evaluate(() => { const u = window.__ug; u.camera.position.set(-194.2, -39, -2162.8); u.controls.target.set(-988.5, 9, -1557.1); u.controls.update(); });
  await page.waitForTimeout(800);
  expect((await count()).drawn).toBe(0);
});

// ── Hiding the map's boxes ────────────────────────────────────────────────

test('baked: the payload minus the boxes under a footprint is what is built, and none is left inside a footprint', async () => {
  // H from the payload itself (UGB1: 12-byte header, 16-byte tiles, 10-byte records).
  const buf = fs.readFileSync(path.join(ROOT, 'public/data/surface/baked/buildings.bin')), v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fps = DATA.buildings.map(b => ({ b: b.outline ?? null, p: b.pavilion ?? null }));
  void fps;
  const hid = await page.evaluate(() => window.__ug.stationBuildings.hidden);
  const tiles = v.getUint16(6, true);
  // Count in the page (same predicate the app used), and cross-check the arithmetic against the payload header.
  const r = await page.evaluate(() => {
    const u = window.__ug, idx = u.stationBuildings.index; let inside = 0, total = 0;
    u.scene.getObjectByName('surfaceGeometry').traverse(o => {
      if (!o.name?.startsWith('baked-buildings-')) return;
      const a = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) { total++; if (idx.hidesBox({ x: a[i * 16 + 12], z: a[i * 16 + 14] })) inside++; }
    });
    return { inside, total, stats: u.bakedStats };
  });
  console.log('baked hiding', JSON.stringify({ hid, ...r, tiles }));
  expect(r.inside, 'no instance centre inside a footprint').toBe(0);
  expect(hid.baked).toBeGreaterThan(200);
  expect(hid.baked).toBeLessThan(450);
  expect(r.stats.buildings).toBe(r.total);
  expect(hid.missedBeforeReady).toBe(0);
});

// ── Labels, hover, toggle ─────────────────────────────────────────────────

test('labels hang above the roof: 30 sites across the kinds at Master 1.1', async () => {
  const pick = [];
  const by = (pred, n) => { for (const [k, s] of Object.entries(DATA.sites)) { if (pick.length >= 0 && pred(s, DATA.buildings.find(b => b.key === s.building)) && !pick.includes(k)) { pick.push(k); if (--n === 0) break; } } };
  const inM25 = (b) => Math.hypot(b.label.x, b.label.z) < 14000;
  by((s, b) => b.outline && inM25(b), 10);
  by((s, b) => b.kind === 'pavilion-entrance' && inM25(b), 5);
  by((s, b) => b.kind === 'pavilion-point' && inM25(b), 5);
  by((s, b) => b.kind === 'pavilion-viaduct', 5);
  by((s, b) => s.nets.length >= 2 && inM25(b), 5);
  const res = [];
  for (const key of pick) {
    const name = DATA.sites[key].name;
    await bl(name, 40, 0, 150, 500);
    res.push(await page.evaluate(async ([name]) => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const u = window.__ug, sb = u.stationBuildings, T = window.__ugTHREE, a = sb.labelAnchor(name);
      const el = [...document.querySelectorAll('.station-label-surface')].find(e => e.textContent === name && e.style.display !== 'none');
      if (!el || !a) return { name, shown: false };
      const w = innerWidth, h = innerHeight; let top = Infinity;
      for (const [x, z] of [[a.x, a.z], ...a.corners]) { const p = new T.Vector3(x, a.roofY, z).project(u.camera); if (p.z < 1) top = Math.min(top, (1 - (p.y * 0.5 + 0.5)) * h); }
      const r = el.getBoundingClientRect();
      return { name, shown: true, bottom: r.bottom, top, ok: r.bottom <= top - 4 };
    }, [name]));
  }
  const shown = res.filter(r => r.shown);
  console.log('labels', shown.length, 'of', res.length, JSON.stringify(res.filter(r => r.shown && !r.ok)));
  expect(res.length).toBeGreaterThanOrEqual(28);
  expect(shown.length).toBeGreaterThanOrEqual(24);
  for (const r of shown) expect(r.ok, `${r.name}: label bottom ${r.bottom} above the roof's highest projected point ${r.top}`).toBe(true);
});

test('hover: a station building reads its station above ground; the toggle shows and hides the roundels only', async () => {
  await bl('Euston', 300, 0, 200);
  const at = await page.evaluate(() => {
    const u = window.__ug, a = u.stationBuildings.labelAnchor('Euston'), T = window.__ugTHREE;
    const p = new T.Vector3(a.x, a.roofY - 5, a.z).project(u.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  });
  await page.mouse.move(at.x + 40, at.y + 40); await page.waitForTimeout(150); await page.mouse.move(at.x, at.y);
  await expect.poll(() => page.evaluate(() => document.getElementById('hoverTip')?.textContent ?? ''), { timeout: 5000 }).toMatch(/Euston/);
  await bl('Dalston Junction', 300, 0, 200);
  const dj = await page.evaluate(() => {
    const u = window.__ug, a = u.stationBuildings.labelAnchor('Dalston Junction'), T = window.__ugTHREE;
    const p = new T.Vector3(a.x, a.roofY - 2, a.z).project(u.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  });
  await page.mouse.move(dj.x + 40, dj.y + 40); await page.waitForTimeout(150); await page.mouse.move(dj.x, dj.y);
  await expect.poll(() => page.evaluate(() => document.getElementById('hoverTip')?.textContent ?? ''), { timeout: 5000 }).toMatch(/Dalston Junction[\s\S]*Overground/);
  // The toggle.
  await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
  await expect(page.locator('label:has(#victoriaStations)')).toContainText('Station roundels');
  await page.locator('#victoriaStations').uncheck();
  expect(await page.evaluate(() => { const m = window.__ug.stationBuildings.meshes; return [m.roundels.visible, m.walls.visible, window.__ug.stationBuildings.roundelsVisible]; })).toEqual([false, true, false]);
  await page.locator('#victoriaStations').check();
  expect(await page.evaluate(() => { const m = window.__ug.stationBuildings.meshes; return [m.roundels.visible, m.walls.visible]; })).toEqual([true, true]);
});

test('underground: the glass shaft still names the station, and the buildings are never in the cull set', async () => {
  const set = await page.evaluate(() => {
    const u = window.__ug; const g = u.scene.getObjectByName('station-buildings');
    return { inSet: u.undergroundCull.collect().filter(o => o.name?.startsWith('station-buildings') || o === g).length, direct: g.parent === u.scene,
      stationMarkersInScene: (() => { let n = 0; u.scene.traverse(o => { if (o.userData?.kind === 'station-markers' && o.parent) n++; }); return n; })() };
  });
  expect(set).toEqual({ inSet: 0, direct: true, stationMarkersInScene: 0 });
});

// ── Contact, the card, the latch ──────────────────────────────────────────

const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
async function enterWalk() {
  // A checkbox the previous test clicked keeps the focus, and form-focused keys never switch the mode.
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  if (await page.evaluate(() => window.__ug.modes.activeId) === 'pedestrian') return;
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}
const placeAtExit = (name, back = 0) => page.evaluate(async ([name, back]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, key = sb.siteKeyOf(name), pose = sb.stationExitPose(key);
  m.place(pose.x - Math.sin(pose.yaw) * -back, pose.z - Math.cos(pose.yaw) * -back, { yaw: pose.yaw + Math.PI, pitch: 0 });
  await new Promise(r => requestAnimationFrame(r));
  return { pose, key };
}, [name, back]);

/** Hold W (and Shift) toward the building, logging every frame until `frames` or `stopWhen`. */
const pushIn = (frames = 240, keys = ['w']) => page.evaluate(async ([frames, keys]) => {
  const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const log = [];
  for (const k of keys) u.fpsControls.keys.add(k);
  try {
    for (let i = 0; i < frames; i++) {
      await frame();
      const d = m.debug(), c = d.contact;
      const hit = sb.contactAt(d.x, d.z, 30);
      log.push({ x: d.x, z: d.z, vx: d.vx, vz: d.vz, d: hit ? hit.d : null, key: hit?.building.key ?? null, card: d.card?.kind ?? null, open: d.chooser.open, rows: d.chooser.rows, latch: d.latchB });
      void c;
    }
  } finally { for (const k of keys) u.fpsControls.keys.delete(k); }
  return log;
}, [frames, keys]);

for (const [name, expectRows] of [[KX, /Victoria|Northern|Piccadilly|Metropolitan|Circle|Hammersmith/], ['Dalston Junction', null], ['South Quay', /DLR/]]) {
  test(`walking into ${name} stops the walker at the wall and opens the card within a frame (shift too)`, async () => {
    for (const keys of [['w'], ['w', 'shift']]) {
      await enterWalk();
      await placeAtExit(name);
      const log = await pushIn(300, keys);
      const i = log.findIndex(f => f.d !== null && f.d <= 0.40);
      expect(i, `${name}: reached the wall`).toBeGreaterThan(-1);
      const minD = Math.min(...log.map(f => f.d ?? 99));
      expect(minD, `${name}: never inside the footprint`).toBeGreaterThanOrEqual(0.33);
      expect(log[i].open || log[i + 1]?.open, `${name}: chooser open at the contact frame or the next`).toBe(true);
      expect(log[i].card === 'shaft' || log[i + 1]?.card === 'shaft').toBe(true);
      for (const f of log.slice(i + 1)) { expect(Math.hypot(f.vx, f.vz), 'stopped while W is held').toBeLessThan(0.05); expect(f.d).toBeGreaterThanOrEqual(0.33); }
      const rows = log[i + 1].rows;
      if (expectRows) expect(rows.some(r => expectRows.test(r)), `${name}: rows ${JSON.stringify(rows)}`).toBe(true);
      else expect(rows.length).toBeGreaterThan(0);
      if (name === KX) expect(new Set(rows.map(r => r.split(' · ')[0])).size).toBeGreaterThanOrEqual(5);
      await page.keyboard.press('Escape');
      await page.keyboard.press('1');
      await page.waitForTimeout(300);
    }
  });
}

test('the latch: after Esc, pushing on gives no card; 3 m out and back gives none; past 5 m out the next touch opens it within a frame', async () => {
  await enterWalk();
  await placeAtExit(KX);
  let log = await pushIn(200);
  expect(log.some(f => f.open)).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  expect((await dbg()).card).toBeNull();
  log = await pushIn(60);                       // 1 s pushing into the wall
  expect(log.every(f => !f.open), `no card while pushing on after Esc: ${JSON.stringify(log.filter(f => f.open).slice(0, 2))}`).toBe(true);
  // 3 m out and back
  await page.evaluate(() => { const u = window.__ug, m = u.modes.registry.get('pedestrian'); m.turn(Math.PI, 0); });
  await pushIn(Math.ceil(3 / 0.1), ['w']);
  await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  log = await pushIn(120);
  expect(log.every(f => !f.open), 'no card after 3 m out and back').toBe(true);
  // out past d0 + 5 m (the latch is the contact's 0.36 m), back in
  await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  let far = 0;
  for (let i = 0; i < 40 && far < 5.8; i++) { const l = await pushIn(6); far = l.at(-1).d ?? 99; }
  expect(far).toBeGreaterThanOrEqual(5.6);
  await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  log = await pushIn(200);
  const i = log.findIndex(f => f.d !== null && f.d <= 0.40);
  expect(i).toBeGreaterThan(-1);
  expect(log[i].open || log[i + 1]?.open, 'the card opens within one frame of contact once re-armed').toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
});

test('place() never opens a card: 3 m from King\'s Cross there is none for a second, and a placement inside it is moved out', async () => {
  await enterWalk();
  const r = await page.evaluate(async () => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, key = sb.siteKeyOf("King's Cross St. Pancras");
    const b = sb.data.buildings.find(q => q.key === sb.data.sites[key].building), pose = sb.stationExitPose(key);
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const out = {};
    // 3 m from the wall: the exit is 6 m out along its facing; 3 m of it back toward the building
    m.place(pose.x + Math.sin(pose.yaw) * 3, pose.z + Math.cos(pose.yaw) * 3, { yaw: pose.yaw });
    let card = false; for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card) card = true; }
    out.near = { card, d: sb.contactAt(m.debug().x, m.debug().z, 30)?.d };
    // inside the footprint
    m.place(b.label.x, b.label.z, { yaw: 0 });
    card = false; for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card) card = true; }
    const c = sb.contactAt(m.debug().x, m.debug().z, 30);
    out.inside = { card, d: c?.d, inside: !!c?.inside };
    return out;
  });
  expect(r.near.card).toBe(false);
  expect(r.near.d).toBeGreaterThan(2);
  expect(r.inside.card).toBe(false);
  expect(r.inside.inside).toBe(false);
  expect(r.inside.d).toBeGreaterThanOrEqual(0.33);
  await page.keyboard.press('1');
});

// ── The street exit ───────────────────────────────────────────────────────

/** Wait for the walker to be back in the body phase, then report where it stands against its building. */
async function exitReport(name) {
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 60000 });
  return page.evaluate((name) => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, d = m.debug(), col = u.modes.collision;
    const key = sb.siteKeyOf(name), pose = sb.stationExitPose(key), b = sb.index.buildingForSite(key);
    const hit = sb.contactAt(d.x, d.z, 60);
    const ground = col.groundHeightAt(d.x, d.z);
    return { pose, d: { x: d.x, y: d.y, z: d.z, yaw: d.yaw, state: d.state }, ground, water: col.waterAt(d.x, d.z), top: col.standHeightAt(d.x, d.z, Infinity, 0),
      dist: hit?.d, facing: hit ? (-Math.sin(d.yaw)) * (d.x - hit.x) / Math.max(hit.d, 1e-9) + (-Math.cos(d.yaw)) * (d.z - hit.z) / Math.max(hit.d, 1e-9) : null, key: b.key, card: d.card };
  }, name);
}

test('"Up to the street" from a deep platform (Lancaster Gate) lands on the ground at the exit pose, facing away from the building', async () => {
  await enterWalk();
  const ok = await page.evaluate(() => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
    const e = net.entrances.find(en => en.name === 'Lancaster Gate' && en.stops.some(s => s.lineId === 'central'));
    if (!e) return false;
    ug.modes.physics.set('pedestrian', 'shaftSpeed', 400);
    const stop = e.stops.find(s => s.lineId === 'central'), p = net.paths[stop.path];
    const i = Math.max(0, Math.min(p.n - 2, p.s.findIndex(x => x >= stop.s)));
    m.place(e.x + 3, e.z + 3, { yaw: Math.atan2(-(p.x[i + 1] - p.x[i]), -(p.z[i + 1] - p.z[i])) });
    m.press('use');
    return true;
  });
  expect(ok).toBe(true);
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 10000 });
  await page.keyboard.press('1');                      // the first platform row
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel', null, { timeout: 60000 });
  await page.keyboard.press('e');                       // at the platform: the card
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
  await page.keyboard.press('1');                       // Up to the street
  const r = await exitReport('Lancaster Gate');
  console.log('deep exit', JSON.stringify(r));
  expect(Math.hypot(r.d.x - r.pose.x, r.d.z - r.pose.z)).toBeLessThan(0.5);
  expect(Math.abs(Math.atan2(Math.sin(r.d.yaw - r.pose.yaw), Math.cos(r.d.yaw - r.pose.yaw)))).toBeLessThan(0.05);
  expect(Math.abs(r.d.y - r.ground)).toBeLessThan(1e-3);
  expect(r.water).toBeNull();
  expect(r.top).toBeLessThanOrEqual(r.ground + 2.5);
  expect(r.dist).toBeGreaterThanOrEqual(5);
  expect(r.facing).toBeGreaterThanOrEqual(0.7);
  // The card stays closed for 2 s; then B5.3's out-and-back from the exit.
  await page.waitForTimeout(2000);
  expect((await dbg()).card).toBeNull();
  await page.keyboard.press('1');
});

test('"Up to the street" from a surface platform (Upminster) eases to the exit pose, facing the street; the card stays shut until 5 m out', async () => {
  await enterWalk();
  const ok = await page.evaluate(() => {
    const m = window.__ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
    for (const p of net.paths) {
      if (p.lineId !== 'district') continue;
      const st = p.stops.find(x => x.stop.name.startsWith('Upminster'));
      if (!st) continue;
      return m.placeInTunnel({ path: p.id, s: st.s, dir: st.s >= p.length - 1e-6 ? -1 : 1 });
    }
    return false;
  });
  expect(ok).toBe(true);
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
  await page.keyboard.press('1');
  const seen = await page.evaluate(async () => {
    const m = window.__ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r));
    const log = [];
    for (let i = 0; i < 300; i++) { await frame(); const d = m.debug(); log.push({ phase: d.phase, step: d.step }); if (d.phase === 'body') break; }
    return log;
  });
  const st = seen.find(f => f.step)?.step;
  expect(st?.kind).toBe('exit');
  const r = await exitReport('Upminster');
  expect(st.pose).toEqual(r.pose);
  expect(Math.hypot(r.d.x - r.pose.x, r.d.z - r.pose.z)).toBeLessThan(0.5);
  expect(Math.abs(r.d.y - r.ground)).toBeLessThan(1e-3);
  expect(r.water).toBeNull();
  expect(r.top).toBeLessThanOrEqual(r.ground + 2.5);
  expect(r.dist).toBeGreaterThanOrEqual(5);
  expect(r.facing).toBeGreaterThanOrEqual(0.7);
  await page.waitForTimeout(2000);
  expect((await dbg()).card, 'no card standing at the exit').toBeNull();
  // 3 m out (it faces away from the building) and back: still no card (the latch is the exit's distance + 5 m)
  await pushIn(Math.ceil(3 / 0.1));
  await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').turn(Math.PI, 0));
  const back = await pushIn(300);
  expect(back.some(f => f.d !== null && f.d <= 0.4), 'reached the wall').toBe(true);
  expect(back.every(f => !f.open), 'no card at the wall after 3 m out and back').toBe(true);
  await page.keyboard.press('1');
});

test('stationExitPose is the pose the data holds, for 20 sites across every kind, and repeats', async () => {
  const keys = []; const kinds = new Set();
  for (const [k, s] of Object.entries(DATA.sites)) { const b = DATA.buildings.find(x => x.key === s.building); const tag = b.kind + (s.nets.length > 1 ? '+' : ''); if (!kinds.has(tag) || keys.length < 20) { kinds.add(tag); keys.push(k); } if (keys.length >= 20 && kinds.size >= 5) break; }
  const r = await page.evaluate((keys) => keys.map(k => { const sb = window.__ug.stationBuildings; return [sb.stationExitPose(k), sb.stationExitPose(k), sb.data.buildings.find(b => b.key === sb.data.sites[k].building).exit]; }), keys);
  for (const [a, b, exit] of r) { expect(a).toEqual(exit); expect(b).toEqual(a); }
  expect(await page.evaluate(() => window.__ug.stationBuildings.stationExitPose('no-such-station'))).toBeNull();
});

// ── Pixels: white, height law, colours, no halo ───────────────────────────

/** Install page helpers: grab() reads the final frame; mask() is the pixels the station buildings change. */
async function installPixelHelpers() {
  await page.evaluate(() => {
    const u = window.__ug, T = window.__ugTHREE, rr = u.composer.renderer, gl = rr.getContext();
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
    void T;
  });
}
const hueCount = (name, up, dx, dz) => page.evaluate(async ([name, up, dx, dz]) => {
  const u = window.__ug, sb = u.stationBuildings, key = sb.siteKeyOf(name), b = sb.data.buildings.find(q => q.key === sb.data.sites[key].building);
  const gy = u.getTerrainMeshSurfaceY({ x: b.label.x, z: b.label.z });
  u.camera.position.set(b.label.x + dx, gy + up * 5, b.label.z + dz); u.controls.target.set(b.label.x, gy, b.label.z); u.controls.update();
  await new Promise(r => setTimeout(r, 1500));
  const g = window.__sbGroup();
  const { A, mask } = window.__sbMask(() => { g.visible = false; }, () => { g.visible = true; });
  const near = (h, c, w) => Math.min(Math.abs(h - c), 360 - Math.abs(h - c)) <= w;
  const n = { mask: 0, red: 0, orange: 0, teal: 0, blue: 0 };
  for (let i = 0, k = 0; i < mask.length; i++, k += 4) {
    if (!mask[i]) continue; n.mask++;
    const [h, s, v] = window.__sbHue(A.b[k], A.b[k + 1], A.b[k + 2]);
    if (s < 0.5 || v < 0.15) continue;
    if (near(h, 3, 12)) n.red++; else if (near(h, 24, 12)) n.orange++; else if (near(h, 179, 14)) n.teal++; else if (near(h, 235, 16)) n.blue++;
  }
  return n;
}, [name, up, dx, dz]);

test('roundel colours by network: red and blue at King\'s Cross and Highbury, orange only at Dalston, teal only at South Quay', async () => {
  await installPixelHelpers();
  const kx = await hueCount(KX, 2, 0, 120);
  const dj = await hueCount('Dalston Junction', 20, 60, 40);
  const sq = await hueCount('South Quay', 8, 0, 40);
  const hi = await hueCount('Highbury & Islington', 20, 60, 40);
  console.log('hues', JSON.stringify({ kx, dj, sq, hi }));
  expect(kx.red, "King's Cross red ring").toBeGreaterThanOrEqual(1000);
  expect(kx.blue, "King's Cross blue bar").toBeGreaterThanOrEqual(500);
  expect(dj.orange, 'Dalston orange').toBeGreaterThanOrEqual(300);
  expect(dj.red, 'Dalston no red').toBeLessThan(50);
  expect(sq.teal, 'South Quay teal').toBeGreaterThanOrEqual(300);
  expect(sq.red, 'South Quay no red').toBeLessThan(50);
  expect(hi.red, 'Highbury red').toBeGreaterThanOrEqual(300);
  expect(hi.orange, 'Highbury no orange').toBeLessThan(50);
});

test('the height law: a station building and an ordinary box of equal height stay equal at Master 1, 1.1, 3 and 10', async () => {
  await installPixelHelpers();
  const out = [];
  for (const master of [1, 1.1, 3, 10]) {
    out.push(await page.evaluate(async (master) => {
      const u = window.__ug, sb = u.stationBuildings;
      const el = document.getElementById('masterHeight'); el.value = String(master); el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
      await new Promise(r => setTimeout(r, 400));
      const scale = u.getBuildingHeightScale(), VE = 5;
      const key = sb.siteKeyOf("King's Cross St. Pancras"), b = sb.data.buildings.find(q => q.key === sb.data.sites[key].building);
      const roof = sb.meshes.roofOf(b, scale);
      // the longest wall roundel's front, 80 m out from its middle
      const w = b.roundels.filter(r => r.on === 'wall').sort((p, q) => q.D - p.D)[0];
      const level = (x, z, y, tx, tz) => { u.camera.position.set(x, y, z); u.controls.target.set(tx, y, tz); u.controls.update(); };
      const topRow = async (hide, show) => {
        await new Promise(r => setTimeout(r, 500));
        const { mask, A } = window.__sbMask(hide, show);
        let top = null; const W = A.W, H = A.H;
        for (let y = H - 1; y >= 0 && top === null; y--) { for (let x = Math.floor(W / 2) - 20; x < Math.floor(W / 2) + 20; x++) if (mask[y * W + x]) { top = H - 1 - y; break; } }
        return top;
      };
      level(w.x + w.nx * 80, w.z + w.nz * 80, roof.roofY, w.x, w.z);
      const g = window.__sbGroup();
      const stationTop = await topRow(() => { g.visible = false; }, () => { g.visible = true; });
      // the nearest ordinary baked box outside every footprint, height >= 6 m: its south face, 80 m out
      let best = null;
      u.scene.getObjectByName('surfaceGeometry').traverse(o => {
        if (!o.name?.startsWith('baked-buildings-')) return;
        const a = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          const x = a[i * 16 + 12], z = a[i * 16 + 14], h = a[i * 16 + 5];
          if (h < 6 * VE || sb.index.hidesBox({ x, z })) continue;
          const d = Math.hypot(x - b.label.x, z - b.label.z);
          if (!best || d < best.d) best = { d, o, i, x, z, side: a[i * 16], base: a[i * 16 + 13], h };
        }
      });
      const boxRoof = best.base + best.h * scale;
      level(best.x, best.z + best.side / 2 + 80, boxRoof, best.x, best.z);
      const m4 = new window.__ugTHREE.Matrix4(); best.o.getMatrixAt(best.i, m4); const away = m4.clone(); away.setPosition(0, -1e6, 0);
      const boxTop = await topRow(() => { best.o.setMatrixAt(best.i, away); best.o.instanceMatrix.needsUpdate = true; }, () => { best.o.setMatrixAt(best.i, m4); best.o.instanceMatrix.needsUpdate = true; });
      return { master, stationTop, boxTop, boxH: best.h / VE };
    }, master));
  }
  console.log('height law', JSON.stringify(out));
  for (const r of out) {
    expect(r.stationTop, `Master ${r.master}: station roof row`).not.toBeNull();
    expect(Math.abs(r.stationTop - 450), `Master ${r.master}: station roof ${r.stationTop} vs the horizon row`).toBeLessThanOrEqual(3);
    expect(r.boxTop, `Master ${r.master}: box roof row`).not.toBeNull();
    expect(Math.abs(r.boxTop - 450), `Master ${r.master}: box roof ${r.boxTop} vs the horizon row`).toBeLessThanOrEqual(3);
  }
  await page.evaluate(() => { const el = document.getElementById('masterHeight'); el.value = '1.1'; el.dispatchEvent(new Event('input', { bubbles: true })); window.__ug.structureMorph.flush(); });
});

test('white stays under the bloom threshold at noon, and bloom on or off leaves no halo', async () => {
  await installPixelHelpers();
  const r = await page.evaluate(async () => {
    const u = window.__ug, T = window.__ugTHREE, rr = u.composer.renderer, sb = u.stationBuildings;
    const sun = document.getElementById('sunTime'); window.__sunBefore = sun.value; sun.value = '500'; sun.dispatchEvent(new Event('input', { bubbles: true }));
    const out = [];
    for (const [name, up, dx, dz] of [['Euston', 400, 0, 1], [sb.siteKeyOf("King's Cross St. Pancras") && "King's Cross St. Pancras", 15, 0, 120]]) {
      const key = sb.siteKeyOf(name), b = sb.data.buildings.find(q => q.key === sb.data.sites[key].building);
      const gy = u.getTerrainMeshSurfaceY({ x: b.label.x, z: b.label.z });
      u.camera.position.set(b.label.x + dx, gy + up * 5, b.label.z + dz); u.controls.target.set(b.label.x, gy, b.label.z); u.controls.update();
      await new Promise(res => setTimeout(res, 1500));
      const W = 1440, H = 900, rt = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 0 });
      const g = window.__sbGroup();
      const draw = () => { const buf = new Uint16Array(W * H * 4); u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => { rr.setRenderTarget(rt); rr.render(u.scene, u.camera); }); rr.readRenderTargetPixels(rt, 0, 0, W, H, buf); rr.setRenderTarget(null); return buf; };
      const A = draw(); g.visible = false; const B = draw(); g.visible = true;
      let max = 0, n = 0;
      for (let i = 0; i < W * H; i++) {
        const k = i * 4;
        if (A[k] === B[k] && A[k + 1] === B[k + 1] && A[k + 2] === B[k + 2]) continue;
        const R = T.DataUtils.fromHalfFloat(A[k]), G = T.DataUtils.fromHalfFloat(A[k + 1]), Bl = T.DataUtils.fromHalfFloat(A[k + 2]);
        const L = 0.2126 * R + 0.7152 * G + 0.0722 * Bl; n++; if (L > max) max = L;
      }
      rt.dispose();
      out.push({ name, max, n });
    }
    return out;
  });
  console.log('brightest station pixel (linear luminance, pre-bloom)', JSON.stringify(r));
  for (const x of r) { expect(x.n, `${x.name}: station pixels`).toBeGreaterThan(500); expect(x.max, `${x.name}: under the bloom threshold 0.88`).toBeLessThan(0.88); }
  await page.evaluate(() => { const sun = document.getElementById('sunTime'); sun.value = window.__sunBefore; sun.dispatchEvent(new Event('input', { bubbles: true })); });
});

test('every viaduct pavilion stands beside the drawn DLR deck, never under it (at least 4.5 m from its centreline)', async () => {
  const r = await page.evaluate(() => {
    const u = window.__ug, sb = u.stationBuildings, paths = u.surfaceRail.paths.get('dlr').filter(Boolean).flat();
    const rect = (p) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [p.cx + c * a * p.w / 2 + s * b * p.d / 2, p.cz - s * a * p.w / 2 + c * b * p.d / 2]); };
    const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L)) : 0; return Math.hypot(px - a.x - t * dx, pz - a.z - t * dz); };
    const out = [];
    const inRing = (x, z, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins; } return ins; };
    for (const b of sb.data.buildings.filter(q => q.kind === 'pavilion-viaduct')) {
      const ring = rect(b.pavilion); let min = Infinity;
      for (const p of paths) {
        if (Math.hypot(p.x - b.pavilion.cx, p.z - b.pavilion.cz) > 100) continue;
        let d = 0;
        if (!inRing(p.x, p.z, ring)) { d = Infinity; for (let i = 0; i < 4; i++) { const q = ring[i], r = ring[(i + 1) % 4]; d = Math.min(d, segDist(p.x, p.z, { x: q[0], z: q[1] }, { x: r[0], z: r[1] })); } }
        min = Math.min(min, d);
      }
      out.push({ key: b.key, min, near: min < Infinity });
    }
    return out;
  });
  console.log('viaduct clearance', JSON.stringify(r.map(x => [x.key, +x.min.toFixed(1)])));
  expect(r.length).toBeGreaterThanOrEqual(9);
  for (const x of r) { expect(x.near, `${x.key}: the DLR path is within 100 m`).toBe(true); expect(x.min, `${x.key}: ${x.min.toFixed(1)} m from the drawn deck points`).toBeGreaterThanOrEqual(4.5); }
});

// ── The live path (D-048 item 2 on both paths; replaces the retired roof-lift live-marker spec) ──

test('live: after its tile arrives each station building is drawn and no box centre is inside a footprint', async ({ browser }) => {
  test.setTimeout(600000);
  const live = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const liveErrors = [];
  live.on('console', (m) => { if (m.type() === 'error') liveErrors.push(m.text()); });
  live.on('pageerror', (e) => liveErrors.push('pageerror: ' + e.message));
  try {
    await load(live, '/?fast=1&buildings=live&mh=1.1');
    await live.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
    const out = [];
    for (const name of [KX, 'Euston', 'Dalston Junction', 'Wembley Park', 'Hillingdon', 'Ealing Broadway']) {
      await bl2(live, name);
      // The loader is quiet: nothing loading and the loaded count unchanged for three one-second checks.
      await live.waitForFunction(async () => {
        const u = window.__ug, s0 = u.surfaceLoaderStats; if (!s0 || s0.loading !== 0) return false;
        for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 1000)); const s = u.surfaceLoaderStats; if (s.loading !== 0 || s.loaded !== s0.loaded) return false; }
        return true;
      }, null, { timeout: 120000, polling: 1000 });
      out.push(await live.evaluate((name) => {
        const u = window.__ug, sb = u.stationBuildings, b = sb.index.buildingForName(name), idx = sb.index;
        let meshes = 0, inside = 0, near = 0;
        u.scene.getObjectByName('surfaceGeometry').traverse(o => {
          if (!o.name?.startsWith('buildings-')) return;
          meshes++; const a = o.instanceMatrix.array;
          for (let i = 0; i < o.count; i++) {
            const x = a[i * 16 + 12], z = a[i * 16 + 14];
            if (Math.hypot(x - b.label.x, z - b.label.z) < 150) near++;
            if (idx.hidesBox({ x, z })) inside++;
          }
        });
        const g = u.scene.getObjectByName('station-buildings');
        return { name, meshes, near, inside, drawn: !!g?.visible && g.parent === u.scene, hidden: sb.hidden };
      }, name));
    }
    console.log('live path', JSON.stringify(out));
    for (const r of out) {
      expect(r.near, `${r.name}: its tile has arrived (boxes within 150 m)`).toBeGreaterThan(0);
      expect(r.inside, `${r.name}: no box centre inside a footprint on the live path`).toBe(0);
      expect(r.drawn, `${r.name}: the station building is drawn`).toBe(true);
    }
    expect(out.at(-1).hidden.live, 'the live predicate hid boxes').toBeGreaterThan(0);
    expect(liveErrors.filter(e => !/favicon/i.test(e)), 'live cold load: no console error').toEqual([]);
  } finally { await live.close(); }
});

test('a cold load printed no console error', async () => {
  expect(errors.filter(e => !/favicon/i.test(e))).toEqual([]);
});
