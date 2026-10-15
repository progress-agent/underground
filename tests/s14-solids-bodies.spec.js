// Lane S (sprint 14Oct26w, D-053 item 8): the Drone and the Balloon meet bridges and station buildings,
// the walker's touch is unchanged, the camera's segment test is exact, and the per-frame cost is small.
// Acceptance ids S-10 to S-19, S-21, S-22 in the test names.

import { test, expect } from '@playwright/test';
import { boot, enter, setMaster } from './s14-helpers.js';

test.setTimeout(600000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => { (page.__errors ??= []).push(String(e)); });
  page.on('console', (m) => { if (m.type() === 'error') (page.__errors ??= []).push(m.text()); });
  await boot(page);
});
test.afterAll(async () => { await page?.close(); });

const leave = async () => { await page.keyboard.press('1'); await page.evaluate(() => window.__ug.fpsControls.keys.clear?.()); };

// ── helpers that run in the page ─────────────────────────────────────────

function pageLib() {
  const ug = window.__ug, T = window.__ugTHREE, VE = 5, lib = window.__s14;
  const ray = new T.Raycaster();
  const w = {};
  w.gap = (rec, f) => {
    const us = lib.piers(rec).map(a => (a.x - f.a.x) * f.ux + (a.z - f.a.z) * f.uz).filter(x => x > 0 && x < f.L).sort((a, b) => a - b);
    let best = 0, gap = f.L / 2;
    for (let i = 0; i + 1 < us.length; i++) if (us[i + 1] - us[i] > best) { best = us[i + 1] - us[i]; gap = (us[i] + us[i + 1]) / 2; }
    return gap;
  };
  w.horiz = (mesh, ox, oy, oz, dx, dz) => {
    ray.set(new T.Vector3(ox, oy, oz), new T.Vector3(dx, 0, dz)); ray.far = 500;
    const h = ray.intersectObject(mesh, false)[0];
    return h ? h.distance : null;
  };
  w.fly = (id, seconds, key, onStep) => {
    const mode = ug.modes.registry.get(id);
    if (key) ug.fpsControls.keys.add(key);
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) { ug.modes.update(1 / 60); onStep(mode.debug(), i); }
    if (key) ug.fpsControls.keys.delete(key);
    return mode.debug();
  };
  w.king = () => {
    const sb = ug.stationBuildings, b = sb.index.buildingForSite('kings-cross-st-pancras');
    const exit = sb.index.stationExitPose('kings-cross-st-pancras');
    const c = sb.contactAt(exit.x, exit.z, 120);
    return { sb, b, exit, c, base: sb.meshes.roofOf(b).base, roofY: sb.meshes.roofOf(b).roofY };
  };
  return w;
}

async function withLib(fn, arg) {
  return page.evaluate(`(${fn.toString()})(${JSON.stringify(arg ?? null)}, (${pageLib.toString()})())`);
}

// ── bridges ──────────────────────────────────────────────────────────────

test('S-10 the Drone stops at a deck side on Westminster Bridge', async () => {
  await setMaster(page, 1);
  await enter(page, '3');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, lib = window.__s14, VE = 5;
    const rec = ug.bridgeRegistry.get('westminster'), f = lib.frame(rec), hw = lib.halfWidth(rec, f);
    const u = L.gap(rec, f);
    const Q = lib.at(f, u, -hw);
    const top = lib.deckTop(rec, Q.x, Q.z), under = lib.undersideAbove(rec, Q.x, top - 3 * VE, Q.z) ?? top - 1.2 * VE;
    const y = (top + under) / 2;
    const s0 = lib.at(f, u, -hw - 25);
    ug.modes.registry.get('drone').place({ x: s0.x, y, z: s0.z, yaw: lib.yawOf(f.nx, f.nz), pitch: 0 });
    const face = L.horiz(rec.deckMesh, s0.x, y, s0.z, f.nx, f.nz);
    let maxT = -Infinity;
    const end = L.fly('drone', 4, 'w', (d) => { const t = (d.pos.x - s0.x) * f.nx + (d.pos.z - s0.z) * f.nz; if (t > maxT) maxT = t; });
    return { face, maxT, closest: face - maxT, hits: end.hits };
  });
  await leave();
  console.log('# S-10', JSON.stringify(r));
  expect(r.face).not.toBeNull();
  expect(r.closest).toBeGreaterThanOrEqual(1.49);
  expect(r.hits).toBeGreaterThanOrEqual(1);
});

test('S-11 the Drone stops at a Tower Bridge tower', async () => {
  await setMaster(page, 1);
  await enter(page, '3');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, lib = window.__s14, VE = 5;
    const rec = ug.bridgeRegistry.get('tower'), f = lib.frame(rec);
    const mid = rec.midpoint, top = lib.deckTop(rec, mid.x, mid.z);
    const y = top + 20 * VE;
    ug.modes.registry.get('drone').place({ x: mid.x, y, z: mid.z, yaw: lib.yawOf(f.ux, f.uz), pitch: 0 });
    const towers = rec.group.children.find(m => m.name === 'bridge:tower:towers');
    const face = L.horiz(towers, mid.x, y, mid.z, f.ux, f.uz);
    let maxT = -Infinity;
    const end = L.fly('drone', 6, 'w', (d) => { const t = (d.pos.x - mid.x) * f.ux + (d.pos.z - mid.z) * f.uz; if (t > maxT) maxT = t; });
    return { face, maxT, closest: face - maxT, hits: end.hits };
  });
  await leave();
  console.log('# S-11', JSON.stringify(r));
  expect(r.face).not.toBeNull();
  expect(r.closest).toBeGreaterThanOrEqual(1.49);
  expect(r.hits).toBeGreaterThanOrEqual(1);
});

test('S-12 the Drone flies under an arch with room, and S-13 cannot rise through the deck', async () => {
  await setMaster(page, 1);
  await enter(page, '3');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5;
    const rec = ug.bridgeRegistry.get('westminster'), f = lib.frame(rec), hw = lib.halfWidth(rec, f);
    const u = L.gap(rec, f);
    const s0 = lib.at(f, u, -hw - 30), w = c.waterAt(s0.x, s0.z);
    const y = w.surfaceY + 1.5 * VE;
    ug.modes.registry.get('drone').place({ x: s0.x, y, z: s0.z, yaw: lib.yawOf(f.nx, f.nz), pitch: 0 });
    let topClear = Infinity;
    const end = L.fly('drone', 6, 'w', (d) => {
      const v = (d.pos.x - f.a.x) * f.nx + (d.pos.z - f.a.z) * f.nz;
      if (Math.abs(v) <= hw) { const under = lib.undersideAbove(rec, d.pos.x, d.pos.y, d.pos.z); if (under !== null) topClear = Math.min(topClear, (under - (d.pos.y + 0.3 * VE)) / VE); }
    });
    const past = (end.pos.x - f.a.x) * f.nx + (end.pos.z - f.a.z) * f.nz - hw;
    // S-13: mid-gap under the centreline, then E for 5 s.
    const m = lib.at(f, u, 0), w2 = c.waterAt(m.x, m.z), y2 = w2.surfaceY + 1.5 * VE;
    ug.modes.registry.get('drone').place({ x: m.x, y: y2, z: m.z, yaw: 0, pitch: 0 });
    const under = lib.undersideAbove(rec, m.x, y2, m.z);
    let worst = -Infinity;
    L.fly('drone', 5, 'e', (d) => { worst = Math.max(worst, (d.pos.y + 0.3 * VE - under) / VE); });
    return { past, hits: end.hits, topClear, under: (under - y2) / VE, worstOver: worst };
  });
  await leave();
  console.log('# S-12/13', JSON.stringify(r));
  expect(r.past).toBeGreaterThanOrEqual(20);
  expect(r.hits).toBe(0);
  expect(r.topClear).toBeGreaterThan(0);
  expect(r.worstOver).toBeLessThanOrEqual(0.05);
});

test('S-14 the Balloon is held by a pier, S-15 stays under an arch and cannot rise through it', async () => {
  await setMaster(page, 1);
  await enter(page, '4');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5, ctx = ug.modes.ctx;
    const rec = ug.bridgeRegistry.get('waterloo'), f = lib.frame(rec);
    const piers = lib.piers(rec).filter(a => { const u = (a.x - f.a.x) * f.ux + (a.z - f.a.z) * f.uz; return u > 0 && u < f.L && c.waterAt(a.x, a.z); });
    const mid = rec.midpoint;
    piers.sort((p, q) => Math.hypot(p.x - mid.x, p.z - mid.z) - Math.hypot(q.x - mid.x, q.z - mid.z));
    const pier = piers[0];
    const balloon = ug.modes.registry.get('balloon');
    const windVec = () => { const wv = ctx.wind.getWindAt(0.5, ctx.time); return { x: -Math.sin(wv.dirRad) * wv.speedMps, z: Math.cos(wv.dirRad) * wv.speedMps, s: wv.speedMps }; };
    // Wait (in simulated time) for a breeze of at least 0.5 m/s.
    let guard = 0;
    while (windVec().s < 0.5 && guard++ < 30000) ug.modes.update(1 / 20);
    const wv = windVec(), wl = Math.hypot(wv.x, wv.z) || 1, wd = { x: wv.x / wl, z: wv.z / wl };
    const ext = pier.halfU * Math.abs(wd.x * pier.ux + wd.z * pier.uz) + pier.halfN * Math.abs(wd.x * pier.nx + wd.z * pier.nz);
    const dist0 = ext + 1.5 + 2;
    const sx = pier.x - wd.x * dist0, sz = pier.z - wd.z * dist0;
    const water = c.waterAt(sx, sz);
    balloon.place({ x: sx, y: water.surfaceY + 1.5 * VE, z: sz, dT: 0, vy: 0 });
    const rectDist = (x, z) => {
      const du = Math.max(0, Math.abs((x - pier.x) * pier.ux + (z - pier.z) * pier.uz) - pier.halfU);
      const dn = Math.max(0, Math.abs((x - pier.x) * pier.nx + (z - pier.z) * pier.nz) - pier.halfN);
      return Math.hypot(du, dn);
    };
    let closest = Infinity, bumped = false;
    const end = L.fly('balloon', 60, null, (d) => { closest = Math.min(closest, rectDist(d.pos.x, d.pos.z)); if (d.scraping || d.bumps > 0) bumped = true; });
    // S-15: mid-gap under the deck centreline, feet 0.5 m above the water.
    const u = L.gap(rec, f), m = lib.at(f, u, 0), w2 = c.waterAt(m.x, m.z);
    const feet = w2.surfaceY + 0.5 * VE;
    balloon.place({ x: m.x, y: feet + 1.5 * VE, z: m.z, dT: 0, vy: 0 });
    let overCold = -Infinity;
    const hw = lib.halfWidth(rec, f) ?? 8;
    const under0 = lib.undersideAbove(rec, m.x, feet, m.z);
    L.fly('balloon', 10, null, (d) => {
      const v = (d.pos.x - f.a.x) * f.nx + (d.pos.z - f.a.z) * f.nz;
      const un = lib.undersideAbove(rec, d.pos.x, d.pos.y - 1.5 * VE, d.pos.z);
      if (Math.abs(v) < hw && un !== null) overCold = Math.max(overCold, (d.pos.y - 1.5 * VE + 3 * VE - un) / VE);
    });
    balloon.place({ x: m.x, y: feet + 1.5 * VE, z: m.z, dT: 0, vy: 0 });
    let overBurn = -Infinity;
    L.fly('balloon', 15, 'e', (d) => {
      const v = (d.pos.x - f.a.x) * f.nx + (d.pos.z - f.a.z) * f.nz;
      const un = lib.undersideAbove(rec, d.pos.x, d.pos.y - 1.5 * VE, d.pos.z);
      if (Math.abs(v) < hw && un !== null) overBurn = Math.max(overBurn, (d.pos.y - 1.5 * VE + 3 * VE - un) / VE);
    });
    return { windSpeed: wv.s, startDist: dist0, closest, bumped, bumps: end.bumps, under: (under0 - feet) / VE, overCold, overBurn };
  });
  await leave();
  console.log('# S-14/15', JSON.stringify(r));
  expect(r.closest).toBeGreaterThanOrEqual(1.49);
  expect(r.bumped).toBe(true);
  expect(r.overCold).toBeLessThanOrEqual(0);
  expect(r.overBurn).toBeLessThanOrEqual(0.05);
});

// ── station buildings ────────────────────────────────────────────────────

test('S-16 the Drone stops at King\'s Cross, S-17 the Balloon lands on a station roof', async () => {
  await setMaster(page, 1.1);
  await enter(page, '3');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, VE = 5;
    const k = L.king(), sb = k.sb;
    const start = { x: k.c.x + k.c.nx * 25, z: k.c.z + k.c.nz * 25 };
    ug.modes.registry.get('drone').place({ x: start.x, y: k.base + 8 * VE, z: start.z, yaw: window.__s14.yawOf(-k.c.nx, -k.c.nz), pitch: 0 });
    let closest = Infinity;
    const end = L.fly('drone', 4, 'w', (d) => { closest = Math.min(closest, sb.index.distanceTo(k.b, d.pos.x, d.pos.z)); });
    return { closest, hits: end.hits, wall: [k.c.x, k.c.z], normal: [k.c.nx, k.c.nz] };
  });
  await leave();
  console.log('# S-16', JSON.stringify(r));
  expect(r.closest).toBeGreaterThanOrEqual(1.49);
  expect(r.hits).toBeGreaterThanOrEqual(1);
  await enter(page, '4');
  const roofs = await withLib((arg, L) => {
    const ug = window.__ug, c = ug.modes.collision, VE = 5, sb = ug.stationBuildings, out = [];
    const pavilion = sb.index.buildings.find(b => b.kind.startsWith('pavilion') && b.key === 'p-abbey-road') ?? sb.index.buildings.find(b => b.kind.startsWith('pavilion'));
    const ctx = ug.modes.ctx;
    for (const b of [L.king().b, pavilion]) {
      const roof = sb.meshes.roofOf(b);
      const balloon = ug.modes.registry.get('balloon');
      // The breeze at the roof is steady (about 6 m/s here), and a basket drifts at roughly half of it while it
      // sinks 5.5 m. King's Cross is vast; a 16 by 12 m pavilion is not, so start the basket upwind by the drift the
      // previous try measured (Newton on the landing offset along the wind) and read the first grounded step.
      const wv = (() => { const w = ctx.wind.getWindAt(0.5, ctx.time); return { x: -Math.sin(w.dirRad), z: Math.cos(w.dirRad), s: w.speedMps }; })();
      let shift = 0, best = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        balloon.place({ x: b.label.x - wv.x * shift, y: roof.roofY + 5.5 * VE + 1.5 * VE, z: b.label.z - wv.z * shift, dT: 30, vy: 0 });
        let groundedAt = null, feetErr = null, lx = 0, lz = 0;
        const end = L.fly('balloon', 20, null, (d, i) => {
          if (d.grounded && groundedAt === null) { groundedAt = i / 60; feetErr = Math.abs((d.pos.y - 1.5 * VE) - roof.roofY) / VE; lx = d.pos.x; lz = d.pos.z; }
        });
        void end;
        const along = (lx - b.label.x) * wv.x + (lz - b.label.z) * wv.z;
        best = { key: b.key, wind: wv.s, attempt, shift, grounded: groundedAt !== null, groundedAt, feetErr, along,
          aboveGround: (roof.roofY - c.groundHeightAt(b.label.x, b.label.z)) / VE };
        if (groundedAt !== null && feetErr <= 0.05) break;
        shift += along; // landed `along` m beyond the label: start that much further upwind
      }
      out.push(best);
    }
    return out;
  });
  await leave();
  console.log('# S-17', JSON.stringify(roofs));
  for (const o of roofs) { expect(o.grounded, o.key).toBe(true); expect(o.feetErr, o.key).toBeLessThanOrEqual(0.05); expect(o.aboveGround, o.key).toBeGreaterThanOrEqual(5); }
});

test('S-18 a walker jetpacking into a wall is stopped', async () => {
  await setMaster(page, 1);
  await enter(page, '2');
  const run = (out) => withLib((arg, L) => {
    const ug = window.__ug, k = L.king(), VE = 5;
    const m = ug.modes.registry.get('pedestrian');
    const sx = k.c.x + k.c.nx * arg.out, sz = k.c.z + k.c.nz * arg.out;
    m.place(sx, sz, { yaw: window.__s14.yawOf(-k.c.nx, -k.c.nz), pitch: 0 });
    m.press('jump');
    ug.fpsControls.keys.add(' '); ug.fpsControls.keys.add('w');
    // The wall stops the walker while its feet are below the roof less the step. King's Cross is 16 m tall and the
    // jetpack climbs at up to 18 m/s, so a walker that starts far out clears the roof before it reaches the wall and
    // flies over it, as it may (no building is a ceiling). The criterion is read over the steps where the wall applies.
    const roofLimit = k.roofY - 0.4 * VE;
    let minD = Infinity, inside = false, airSteps = 0, wallSteps = 0, clearedAt = null, maxFeet = 0, touched = 0;
    for (let i = 0; i < 180; i++) {
      ug.modes.update(1 / 60);
      const d = m.debug();
      maxFeet = Math.max(maxFeet, d.y);
      if (d.state === 'air') {
        airSteps++;
        if (d.y < roofLimit) {
          wallSteps++;
          const dist = k.sb.index.distanceTo(k.b, d.x, d.z);
          minD = Math.min(minD, dist);
          if (dist < 0.4) touched++;
          if (k.sb.contactAt(d.x, d.z, 1)?.inside) inside = true;
        } else if (clearedAt === null) clearedAt = i / 60;
      }
    }
    ug.fpsControls.keys.delete(' '); ug.fpsControls.keys.delete('w');
    return { out: arg.out, minD, inside, airSteps, wallSteps, touched, clearedAt, roofM: (k.roofY - k.base) / VE, maxFeetM: maxFeet / VE };
  }, { out });
  const near = await run(1.5), far = await run(8);
  await leave();
  console.log('# S-18', JSON.stringify([near, far]));
  // Pressed against the wall (1.5 m out): held at the wall for many frames, never inside.
  expect(near.wallSteps).toBeGreaterThan(10);
  expect(near.touched).toBeGreaterThan(5);
  expect(near.inside).toBe(false);
  expect(near.minD).toBeGreaterThanOrEqual(0.33);
  // From 8 m out (the designer's figure) the walker climbs past the 16 m roof before the wall: never inside below it.
  expect(far.inside).toBe(false);
  expect(far.minD).toBeGreaterThanOrEqual(0.33);
});

test('S-18b a walker jetpacked onto a station roof stands on it: no push, no card, then walks off and falls', async () => {
  await setMaster(page, 1);
  await enter(page, '2');
  const r = await withLib((arg, L) => {
    const ug = window.__ug, k = L.king(), VE = 5;
    const m = ug.modes.registry.get('pedestrian');
    const sx = k.c.x + k.c.nx * 1.5, sz = k.c.z + k.c.nz * 1.5;
    m.place(sx, sz, { yaw: window.__s14.yawOf(-k.c.nx, -k.c.nz), pitch: 0 });
    m.press('jump'); ug.fpsControls.keys.add(' '); ug.fpsControls.keys.add('w');
    let phase = 'climb', above = null, landedAt = null, standSteps = 0, pushed = false, card = false, maxDev = 0, sawInside = false;
    for (let i = 0; i < 900; i++) {
      if (phase === 'climb' && m.debug().y > k.roofY + 2 * VE) { ug.fpsControls.keys.delete(' '); phase = 'over'; above = i; }
      if (phase === 'over' && i - above > 40) { ug.fpsControls.keys.delete('w'); phase = 'land'; }
      ug.modes.update(1 / 60);
      const d = m.debug();
      if (phase === 'land' && landedAt === null && d.state === 'ground' && Math.abs(d.y - k.roofY) < 0.25) landedAt = i;
      if (landedAt !== null && i >= landedAt && i < landedAt + 120) {
        // 2 s on the roof with nothing held: still on it, no card, not pushed out of the footprint.
        standSteps++;
        maxDev = Math.max(maxDev, Math.abs(d.y - k.roofY) / VE);
        if (d.card) card = true;
        if (!k.sb.contactAt(d.x, d.z, 1)?.inside) pushed = true; else sawInside = true;
      }
    }
    ug.fpsControls.keys.delete(' '); ug.fpsControls.keys.delete('w');
    // Walk off the edge (back the way it came, toward the nearest wall): it falls to the street.
    ug.fpsControls.keys.add('s');
    let fellAt = null, minAbove = 0;
    for (let i = 0; i < 1500 && fellAt === null; i++) {
      ug.modes.update(1 / 60);
      const dd = m.debug();
      minAbove = Math.min(minAbove, (dd.y - k.roofY) / VE);
      if (dd.y < k.roofY - 2 * VE) fellAt = i;
    }
    ug.fpsControls.keys.delete('s');
    const d0 = m.debug();
    return { landedAt, standSteps, card, pushed, sawInside, maxDevM: maxDev, lastState: d0.state, endAboveRoofM: (d0.y - k.roofY) / VE, endInside: !!k.sb.contactAt(d0.x, d0.z, 1)?.inside, fellAt, minAboveM: minAbove };
  }, null);
  await leave();
  console.log('# S-18b', JSON.stringify(r));
  expect(r.landedAt).not.toBeNull();
  expect(r.sawInside).toBe(true);
  expect(r.pushed).toBe(false);
  expect(r.card).toBe(false);
  expect(r.maxDevM).toBeLessThanOrEqual(0.05);
  expect(r.fellAt, 'walking off the roof edge drops the walker to the street').not.toBeNull();
});

test('S-19 the walker\'s touch still stops 0.36 m from the wall and opens the card', async () => {
  await setMaster(page, 1);
  await enter(page, '2');
  const sites = ['kings-cross-st-pancras', 'dalston-junction', 'south-quay'];
  const rows = [];
  for (const site of sites) {
    rows.push(await page.evaluate(async (site) => {
      const ug = window.__ug, sb = ug.stationBuildings, m = ug.modes.registry.get('pedestrian');
      const b = sb.index.buildingForSite(site), pose = sb.index.stationExitPose(site);
      // Face the building: from the exit pose toward the nearest footprint point.
      const c0 = sb.contactAt(pose.x, pose.z, 120);
      const dx = c0.x - pose.x, dz = c0.z - pose.z, L = Math.hypot(dx, dz) || 1;
      m.place(pose.x, pose.z, { yaw: Math.atan2(-dx / L, -dz / L), pitch: 0 });
      ug.fpsControls.keys.add('w');
      let cardAt = null;
      for (let i = 0; i < 300; i++) {
        await new Promise(r => requestAnimationFrame(r));
        if (cardAt === null && m.debug().card) cardAt = i;
      }
      ug.fpsControls.keys.delete('w');
      const d = m.debug(), c = sb.contactAt(d.x, d.z, 5);
      return { site, d: c ? c.d : null, cardAt, card: !!d.card };
    }, site));
  }
  await leave();
  console.log('# S-19 lane', JSON.stringify(rows));
  const live = process.env.UG_LIVEBASE ?? 'http://localhost:5278';
  let liveRows = null;
  try {
    const ok = await fetch(live).then(r => r.ok, () => false);
    if (ok) {
      const p2 = await page.context().browser().newPage();
      await p2.goto(`${live}/?skip=1&buildings=baked`);
      await p2.waitForFunction(() => !!(window.__ug && window.__ug.modes && !window.__ug.intro.isRunning() && window.__ug.stationBuildings.ready && (() => { const b = window.__ug.bakedStats; return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal; })()), null, { timeout: 150000 });
      await p2.keyboard.press('2');
      await p2.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
      liveRows = [];
      for (const site of sites) {
        liveRows.push(await p2.evaluate(async (site) => {
          const ug = window.__ug, sb = ug.stationBuildings, m = ug.modes.registry.get('pedestrian');
          const pose = sb.index.stationExitPose(site), c0 = sb.contactAt(pose.x, pose.z, 120);
          const dx = c0.x - pose.x, dz = c0.z - pose.z, L = Math.hypot(dx, dz) || 1;
          m.place(pose.x, pose.z, { yaw: Math.atan2(-dx / L, -dz / L), pitch: 0 });
          ug.fpsControls.keys.add('w');
          for (let i = 0; i < 300; i++) await new Promise(r => requestAnimationFrame(r));
          ug.fpsControls.keys.delete('w');
          const d = m.debug(), c = sb.contactAt(d.x, d.z, 5);
          return { site, d: c ? c.d : null };
        }, site));
      }
      await p2.close();
    }
  } catch (e) { console.log('# livebase probe failed', String(e).slice(0, 200)); }
  console.log('# S-19 livebase', JSON.stringify(liveRows));
  for (const [i, r] of rows.entries()) {
    expect(r.d, r.site).toBeGreaterThanOrEqual(0.35); expect(r.d, r.site).toBeLessThanOrEqual(0.37); expect(r.card, r.site).toBe(true);
    if (liveRows) expect(Math.abs(r.d - liveRows[i].d), `${r.site} vs livebase`).toBeLessThanOrEqual(0.01);
  }
});

// ── the camera's segment test and the cost ───────────────────────────────

test('S-21 segmentHitsSolids agrees with the drawn bridge and station walls', async () => {
  await setMaster(page, 1);
  const r = await withLib((arg, L) => {
    const ug = window.__ug, T = window.__ugTHREE, lib = window.__s14, c = ug.modes.collision, VE = 5;
    const out = {};
    const hitAt = (from, to) => { const t = c.segmentHitsSolids(from, to); return t === null ? null : { t, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t }; };
    const cast = (objs, from, to) => {
      const d = new T.Vector3(to.x - from.x, to.y - from.y, to.z - from.z), len = d.length(); d.normalize();
      const r = new T.Raycaster(new T.Vector3(from.x, from.y, from.z), d, 0, len);
      const h = r.intersectObjects(objs, false)[0];
      return h ? h.point : null;
    };
    // (a) through a Tower Bridge tower, horizontal, 10 m above the deck.
    const tb = ug.bridgeRegistry.get('tower'), f = lib.frame(tb), mid = tb.midpoint;
    const topT = lib.deckTop(tb, mid.x, mid.z), y = topT + 10 * VE;
    // a 60 m segment centred on the first tower: find the tower box by raycast from the midpoint along +u
    const towers = tb.group.children.find(m => m.name === 'bridge:tower:towers');
    const dFace = L.horiz(towers, mid.x, y, mid.z, f.ux, f.uz);
    const a0 = { x: mid.x + f.ux * (dFace - 30), y, z: mid.z + f.uz * (dFace - 30) }, a1 = { x: mid.x + f.ux * (dFace + 30), y, z: mid.z + f.uz * (dFace + 30) };
    const ha = hitAt(a0, a1), ra = cast(lib.drawnBridgeMeshes(tb), a0, a1);
    out.a = ha && ra ? Math.hypot(ha.x - ra.x, ha.y - ra.y, ha.z - ra.z) : (ha === null && ra === null ? 'both-null' : 'mismatch');
    // (b) vertical at Westminster mid-gap on the centreline.
    const wm = ug.bridgeRegistry.get('westminster'), wf = lib.frame(wm), u = L.gap(wm, wf), p = lib.at(wf, u, 0);
    const wTop = lib.deckTop(wm, p.x, p.z), wWater = c.waterAt(p.x, p.z).surfaceY;
    const hb = hitAt({ x: p.x, y: wTop + 5 * VE, z: p.z }, { x: p.x, y: wWater, z: p.z });
    out.b = hb ? Math.abs(hb.y - wTop) / VE : null;
    // (c) King's Cross: horizontal at base + 8 m crossing the wall.
    const k = L.king(), yc = k.base + 8 * VE;
    const c0 = { x: k.c.x + k.c.nx * 15, y: yc, z: k.c.z + k.c.nz * 15 }, c1 = { x: k.c.x - k.c.nx * 15, y: yc, z: k.c.z - k.c.nz * 15 };
    const hc = hitAt(c0, c1), rc = cast([k.sb.meshes.walls], c0, c1);
    out.c = hc && rc ? Math.hypot(hc.x - rc.x, hc.y - rc.y, hc.z - rc.z) : (hc === null && rc === null ? 'both-null' : 'mismatch');
    // (d) along Westminster's flat mid-span, 0.5 m above the deck, 0.15 m inside the edge: null.
    const hw = lib.halfWidth(wm, wf);
    const d0 = lib.at(wf, wf.L / 2 - 50, hw - 0.15), d1 = lib.at(wf, wf.L / 2 + 50, hw - 0.15);
    const topD = lib.deckTop(wm, d0.x, d0.z);
    out.d = c.segmentHitsSolids({ x: d0.x, y: topD + 0.5 * VE, z: d0.z }, { x: d1.x, y: topD + 0.5 * VE, z: d1.z });
    // (e) starts inside King's Cross.
    const inner = { x: k.c.x - k.c.nx * 4, z: k.c.z - k.c.nz * 4 };
    out.e = c.segmentHitsSolids({ x: inner.x, y: yc, z: inner.z }, { x: inner.x - k.c.nx * 60, y: yc, z: inner.z - k.c.nz * 60 });
    // (f) 100 m above Westminster.
    out.f = c.segmentHitsSolids({ x: p.x - 50, y: wTop + 100 * VE, z: p.z }, { x: p.x + 50, y: wTop + 100 * VE, z: p.z });
    out.ts = [ha?.t, hb?.t, hc?.t].filter(x => x !== undefined);
    return out;
  });
  console.log('# S-21', JSON.stringify(r));
  expect(typeof r.a === 'number' ? r.a : 99).toBeLessThanOrEqual(0.5);
  expect(r.b).not.toBeNull(); expect(r.b).toBeLessThanOrEqual(0.05);
  expect(typeof r.c === 'number' ? r.c : 99).toBeLessThanOrEqual(0.05);
  expect(r.d).toBeNull();
  expect(r.e).toBeGreaterThan(0); expect(r.e).toBeLessThanOrEqual(1e-5);
  expect(r.f).toBeNull();
  for (const t of r.ts) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThanOrEqual(1); }
});

test('S-22 the per-frame cost on Tower Bridge and beside King\'s Cross', async () => {
  await setMaster(page, 1);
  const r = await withLib((arg, L) => {
    const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5;
    const bench = (x, y, z) => {
      const body = { radius: 0.35, height: 9.25, step: 2 }, pos = { x, y, z }, delta = { x: 0.1, y: 0, z: 0 };
      for (let i = 0; i < 1000; i++) { c.moveAndSlide(pos, delta, body); c.standHeightAt(x, z, y, 2); c.ceilingAt(x, z, y); }
      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) { c.moveAndSlide(pos, delta, body); c.standHeightAt(x, z, y, 2); c.ceilingAt(x, z, y); }
      return (performance.now() - t0) * 1000 / 10000;
    };
    const tb = ug.bridgeRegistry.get('tower'), f = lib.frame(tb), mid = tb.midpoint;
    const top = lib.deckTop(tb, mid.x, mid.z);
    const k = L.king();
    const out = {
      towerBridgeUs: bench(mid.x, top, mid.z),
      kingsCrossUs: bench(k.c.x + k.c.nx * 1, k.base, k.c.z + k.c.nz * 1),
      hydeParkUs: bench(-2100, c.groundHeightAt(-2100, -700) ?? 0, -700),
    };
    void f;
    return out;
  });
  console.log('# S-22 us per iteration', JSON.stringify(r));
  expect(r.towerBridgeUs).toBeLessThanOrEqual(100);
  expect(r.kingsCrossUs).toBeLessThanOrEqual(100);
});

test('S-25 no console errors', async () => {
  expect(page.__errors ?? []).toEqual([]);
});
