// cross-lane-s14.spec.js: the nine cross-lane checks of sprint 14Oct26w's integration (I/brief.md section 1).
// Each check exercises two or more lanes together in the real app (dev mode, real GPU):
//   1 label cover (P+B)        the figure hides a station name behind it through lane B's hook; names clear of it show
//   2 line of sight (P+S)      the over-the-shoulder camera, orbited behind a walker at King's Cross's wall and at a bridge
//                              pier, stays on the near side (lane S's segment test wired into lane P's line of sight)
//   3 swimming (P+M)           third person: W with the camera looking down keeps depth; first person: W follows the view
//   4 jetpack (P+M)            a tap jumps with no flames; a hold fires at about 0.15 s with no dip, four flames growing
//                              with jetLevel, the flying pose held; no flames in the river
//   5 board on a bridge (D+S+M) the skateboard rides across Westminster Bridge on its deck
//   6 Drone and Balloon (D+S+B) third-person Drone stops at Fulham Broadway's restored box and King's Cross's wall; the
//                              Balloon lands on a station roof
//   7 the walker's touch (S+B) King's Cross still stops the walker 0.36 m out and opens the card; Fulham Broadway's
//                              marked entrance opens its card
//   8 views by place (P+D)     third person above ground on foot, board, Drone and Balloon; first person in the shaft,
//                              the tunnel and the open-air ride; the street returns the chosen view
//   9 the opening              a cold default-URL load runs the opening as the live build does (UG_LB, default
//                              http://localhost:5268), the figure fetched only after the landing, zero console errors
//
// With UG_CAPTURE_DIR set, each check keeps PNGs there and appends its numbers to results.jsonl (the integrator's
// record); without it nothing is written. Keys are injected through fpsControls.keys; synchronous stepping uses
// modes.update(1/60) inside one evaluate, as lanes M and S do.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { installLib } from './s14-helpers.js';
import { FLAME } from '../src/player/flames.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600000);

const CAP = process.env.UG_CAPTURE_DIR || null;
const LB = process.env.UG_LB || 'http://localhost:5268';
const VE = 5;
const KX = [164.9, -2507.9, 0];        // open ground south of King's Cross (lane P's pose)
const THAMES = [885.1, -145.1, 0];     // mid-river by Waterloo Bridge

let page;
const errors = [];
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const snap = async (name, p = page) => { if (CAP) await p.screenshot({ path: path.join(CAP, `${name}.png`) }); };
const record = (check, data) => {
  console.log(`# ${check}`, JSON.stringify(data));
  if (CAP) fs.appendFileSync(path.join(CAP, 'results.jsonl'), JSON.stringify({ check, at: new Date().toISOString(), ...data }) + '\n');
};
const ped = (fn, arg) => ev(fn, arg);
const toPedestrian = async () => {
  await ev(() => window.__ug.fpsControls.keys.clear());
  if (await ev(() => window.__ug.modes.activeId) !== 'pedestrian') {
    await ev(() => window.__ug.modes.activate('pedestrian'));
  }
  await page.waitForFunction(() => { const d = window.__ug.modes.registry.get('pedestrian').debug(); return d.phase === 'body' && !d.ease.running; }, null, { timeout: 60000 });
};
const place = async ([x, z, yaw], settle = 800) => {
  await ev(([x, z, yaw]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw, pitch: 0 }), [x, z, yaw]);
  await wait(settle);
};
const frames = (n) => ev(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);

test.beforeAll(async ({ browser }) => {
  if (CAP) fs.mkdirSync(CAP, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto('/?fast=1&buildings=baked&mh=1.1');
  await page.waitForFunction(() => {
    const ug = window.__ug, b = ug?.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && ug.groundReady && ug.bridgeRegistry?.size === 41
      && ug.stationBuildings?.ready && !!ug.scene.getObjectByName('m25Motorway') && ug.lineBranchCenterPts?.size > 5;
  }, null, { timeout: 240000 });
  await ev(() => window.__ug.setRenderQualityMode('manual'));
  await page.evaluate(installLib);
  await toPedestrian();
  await page.waitForFunction(() => window.__ug.modes.ctx.playerView.figureLoaded(), null, { timeout: 60000 });
});
test.afterAll(async () => { await page?.close(); });

// ── 1. label cover (P+B) ────────────────────────────────────────────────────────────────────────────────────────
test('1 label cover: a station name behind the figure is hidden, names clear of it show', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  await place(KX, 1200);
  // A recorder on lane B's hook, moved ahead of the two covers: it sees every name that would show before the covers
  // decide. (Adding a function again and calling the returned unsubscribe removes its first, original, registration.)
  await ev(async () => {
    const u = window.__ug, st = await import('/src/stations.js');
    const seen = window.__s14iSeen = new Map();
    window.__s14iRecorder ??= (rect, cam, info) => { seen.set(info?.name ?? '?', { x: rect.x, y: rect.y, w: rect.w, h: rect.h }); return false; };
    st.addSurfaceLabelOccluder(window.__s14iRecorder);
    for (const fn of [u.s14pLabelCover, u.s14dLabelCover]) st.addSurfaceLabelOccluder(fn)();
  });
  const sampleView = () => ev(async () => {
    const u = window.__ug, seen = window.__s14iSeen;
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    seen.clear();
    await new Promise((r) => requestAnimationFrame(r));
    const f = u.player.screenRect ? { ...u.player.screenRect } : null;
    const els = [...document.querySelectorAll('.station-label-surface')];
    const shown = (name) => { const el = els.find((e) => e._cleanName === name); return !!el && el.style.display !== 'none'; };
    const rows = [];
    for (const [name, r] of seen) {
      // clearly behind: the label's centre 4 px inside the figure's rectangle; clearly clear: no overlap with the
      // rectangle grown by 4 px (the figure idles, so a name on the edge may go either way from frame to frame)
      let covered = false, clearOf = true;
      if (f) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, m = 4;
        covered = cx >= f.x + m && cx <= f.x + f.w - m && cy >= f.y + m && cy <= f.y + f.h - m;
        const ow = Math.min(r.x + r.w, f.x + f.w + m) - Math.max(r.x, f.x - m), oh = Math.min(r.y + r.h, f.y + f.h + m) - Math.max(r.y, f.y - m);
        clearOf = !(ow > 0 && oh > 0);
      }
      rows.push({ name, covered, clearOf, shown: shown(name), rect: r });
    }
    return { fig: f, rows };
  });
  const samples = [];
  let best = null;
  // orbit the rig round the walker at three pitches (drag through the mode, 0.005 rad a pixel)
  for (const dy of [0, -50, -90]) {
    await ev((dy) => window.__ug.modes.registry.get('pedestrian').onLook(0, dy), dy);
    for (let k = 0; k < 24; k++) {
      await ev(() => window.__ug.modes.registry.get('pedestrian').onLook(52.36, 0));
      const s = await sampleView();
      samples.push({ dy, k, fig: s.fig, rows: s.rows });
      const cov = s.rows.filter((r) => r.covered);
      const kx = cov.find((r) => /King's Cross/.test(r.name));
      if (cov.length && (!best || (kx && !best.kx))) best = { dy, k, kx: !!kx, names: cov.map((r) => r.name) };
    }
    await ev((dy) => window.__ug.modes.registry.get('pedestrian').onLook(0, -dy), dy);
  }
  const covered = samples.flatMap((s) => s.rows.filter((r) => r.covered));
  const clear = samples.flatMap((s) => s.rows.filter((r) => r.clearOf));
  const coveredShown = covered.filter((r) => r.shown);
  const clearShown = clear.filter((r) => r.shown);
  // Re-enter the best view for the captures: third person (the name hidden), then V to first person (the name shows).
  let firstPerson = null;
  if (best) {
    await place(KX, 1200);
    await ev((dy) => window.__ug.modes.registry.get('pedestrian').onLook(0, dy), best.dy);
    for (let k = 0; k <= best.k; k++) await ev(() => window.__ug.modes.registry.get('pedestrian').onLook(52.36, 0));
    const again = await sampleView();
    await snap('1-label-cover-third');
    await page.keyboard.press('v');
    await wait(900);
    const fp = await sampleView();
    await snap('1-label-cover-first');
    firstPerson = { names: best.names, shownInFirst: best.names.filter((n) => fp.rows.some((r) => r.name === n && r.shown)),
      hiddenInThird: best.names.filter((n) => again.rows.some((r) => r.name === n && r.covered && !r.shown)), figInFirst: fp.fig };
    await page.keyboard.press('v');
    await wait(600);
  }
  record('1-label-cover', { samples: samples.length, covered: covered.length, coveredShown: coveredShown.map((r) => r.name),
    clear: clear.length, clearShown: clearShown.length, best, firstPerson, coveredNames: [...new Set(covered.map((r) => r.name))] });
  expect(covered.length, 'some name stood behind the figure in the sweep').toBeGreaterThan(0);
  expect(coveredShown, 'every name behind the figure is hidden').toEqual([]);
  expect(clearShown.length / Math.max(1, clear.length), 'names clear of the figure show (declutter aside)').toBeGreaterThanOrEqual(0.9);
  expect(firstPerson.figInFirst, 'no rectangle in first person').toBeNull();
  expect(firstPerson.shownInFirst.length, 'a name hidden in third person shows in first person').toBeGreaterThan(0);
});

// ── 2. line of sight (P+S) ──────────────────────────────────────────────────────────────────────────────────────
test('2 line of sight: orbited behind a walker at King\'s Cross\'s wall and at a bridge pier, the camera stays on the near side', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  // Stand `out` metres from a solid, facing it, then orbit the camera half round so it would sit inside the solid.
  const trial = (arg) => ev(async ({ x, z, nx, nz, out, label, wired }) => {
    const u = window.__ug, c = u.modes.collision, m = u.modes.registry.get('pedestrian'), T = window.__ugTHREE;
    if (!wired) c.setExtraSegmentHit(() => false);
    m.place(x + nx * out, z + nz * out, { yaw: Math.atan2(nx, nz), pitch: 0 });   // facing the solid (yaw 0 faces -Z)
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 12; i++) { m.onLook(52.36, 0); await new Promise((r) => requestAnimationFrame(r)); }   // pi
    for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
    const cam = u.camera.position.clone(), st = m.playerState(), neck = new T.Vector3();
    u.player.figure.boneWorldPosition('neck_01', neck);
    const side = (cam.x - x) * nx + (cam.z - z) * nz;              // > 0: the walker's side of the face
    const seg = c.segmentHitsSolids({ x: neck.x, y: neck.y, z: neck.z }, { x: cam.x, y: cam.y, z: cam.z });
    const third = m.isThirdPerson();
    if (!wired) c.setExtraSegmentHit((a, b) => c.segmentHitsSolids(a, b));
    return { label, wired, third, side, seg, camToBody: Math.hypot(cam.x - st.x, cam.z - st.z), cam: [cam.x, cam.y, cam.z] };
  }, arg);
  // King's Cross: the nearest point of its wall to the station's exit pose, and the wall's outward normal.
  const kx = await ev(() => {
    const sb = window.__ug.stationBuildings, exit = sb.index.stationExitPose('kings-cross-st-pancras');
    const c = sb.contactAt(exit.x, exit.z, 120);
    return { x: c.x, z: c.z, nx: c.nx, nz: c.nz };
  });
  const kxOn = await trial({ ...kx, out: 1.0, label: 'kings-cross', wired: true });
  await snap('2-los-kings-cross');
  const kxOff = await trial({ ...kx, out: 1.0, label: 'kings-cross (seam unwired, control)', wired: false });
  // A bridge pier by the Embankment: the land-standing pier nearest the north bank of Westminster to Blackfriars; else
  // the pier nearest a bank, the walker on the bank side.
  const pier = await ev(async () => {
    const u = window.__ug, c = u.modes.collision, bm = await import('/src/bridges.js');
    let best = null;
    for (const [slug, rec] of u.bridgeRegistry.entries()) {
      if (!rec.group.visible) continue;
      for (const p of bm.bridgePierAnchors(rec.data)) {
        // the pier's face toward the walker: along its short axis (n), the side with dry ground if any
        for (const sg of [1, -1]) {
          const nx = p.nx * sg, nz = p.nz * sg, out = p.halfN + 1.0;
          const wx = p.x + nx * out, wz = p.z + nz * out;
          const dry = !c.waterAt(wx, wz);
          // dry ground first, then the Embankment's bridges (Westminster to Blackfriars), then the most northerly
          const score = (dry ? 0 : 1e6) + (/westminster|hungerford|golden|waterloo|blackfriars/.test(slug) ? 0 : 1e5) + p.z * 1e-3;
          if (!best || score < best.score) best = { slug, score, dry, x: p.x + nx * p.halfN, z: p.z + nz * p.halfN, nx, nz, halfU: p.halfU, halfN: p.halfN };
        }
      }
    }
    return best;
  });
  let pierOn = null;
  if (pier) {
    pierOn = await trial({ ...pier, out: 1.0, label: `pier ${pier.slug}${pier.dry ? '' : ' (swimming)'}`, wired: true });
    await snap('2-los-pier');
  }
  record('2-line-of-sight', { kx, kxOn, kxOff, pier, pierOn });
  expect(kxOn.third).toBe(true);
  expect(kxOn.side, 'King\'s Cross: the camera stays on the walker\'s side of the wall').toBeGreaterThan(0);
  expect(kxOn.seg, 'King\'s Cross: nothing solid between the figure and the camera').toBeNull();
  expect(pier, 'a bridge pier was found').not.toBeNull();
  expect(pierOn.side, 'pier: the camera stays on the walker\'s side').toBeGreaterThan(0);
  expect(pierOn.seg, 'pier: nothing solid between the figure and the camera').toBeNull();
});

// ── 3. swimming (P+M) ───────────────────────────────────────────────────────────────────────────────────────────
test('3 swimming: third person W with the camera looking down keeps depth; first person W follows the view down', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  const spot = await ev(() => {
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
  expect(spot).not.toBeNull();
  const dive = async () => ev(async ({ x, z }) => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), keys = u.fpsControls.keys, step = () => u.modes.update(1 / 60);
    const w = () => u.modes.collision.waterAt(m.body.x, m.body.z);
    m.place(x, z, { yaw: 0, pitch: 0 });
    keys.add('q');
    for (let i = 0; i < 600; i++) { step(); const ww = w(); if ((ww.surfaceY - m.body.y) / 5 >= 2 && (m.body.y - ww.bedY) / 5 >= 1.5) break; }
    keys.delete('q');
    for (let i = 0; i < 30; i++) step();
    return { state: m.body.state, depth: (w().surfaceY - m.body.y) / 5 };
  }, spot);
  const d3 = await dive();
  // third person: the rig pitched down by a drag (0.005 rad a pixel)
  const third = await ev(async () => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), keys = u.fpsControls.keys, T = window.__ugTHREE, step = () => u.modes.update(1 / 60);
    m.onLook(0, 160);
    for (let i = 0; i < 10; i++) step();
    const f = new T.Vector3(); u.camera.getWorldDirection(f);
    const y0 = m.body.y, tp = m.isThirdPerson();
    keys.add('w');
    let worst = 0;
    for (let i = 0; i < 180; i++) { step(); worst = Math.max(worst, Math.abs(m.body.y - y0) / 5); }
    keys.delete('w');
    for (let i = 0; i < 20; i++) step();
    return { tp, camDownY: f.y, worstM: worst, state: m.body.state };
  });
  for (let i = 0; i < 4; i++) await frames(1);
  await snap('3-swim-third');
  await dive();
  const first = await ev(async () => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), keys = u.fpsControls.keys, T = window.__ugTHREE, step = () => u.modes.update(1 / 60);
    m.setView('first');
    for (let i = 0; i < 30; i++) step();
    m.turn(0, -Math.PI / 4);
    step();
    const f = new T.Vector3(); u.camera.getWorldDirection(f);
    const y0 = m.body.y, tp = m.isThirdPerson();
    keys.add('w');
    for (let i = 0; i < 90; i++) step();
    keys.delete('w');
    return { tp, camDownY: f.y, deeperM: (y0 - m.body.y) / 5, state: m.body.state };
  });
  await frames(4);
  await snap('3-swim-first');
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  record('3-swimming', { spot, d3, third, first });
  expect(third.tp).toBe(true);
  expect(third.camDownY, 'the camera looks down').toBeLessThan(-0.1);
  expect(third.worstM, 'third person: depth kept within 0.1 m over 3 s').toBeLessThanOrEqual(0.1);
  expect(first.tp).toBe(false);
  expect(first.deeperM, 'first person: W follows the view down').toBeGreaterThanOrEqual(0.5);
});

// ── 4. jetpack (P+M) ────────────────────────────────────────────────────────────────────────────────────────────
test('4 jetpack: a tap jumps with no flames; a hold fires at about 0.15 s with no dip, flames growing with jetLevel, the pose held; none underwater', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  await place(KX, 1000);
  /** Real frames on the mode clock: keys at exact mode-clock offsets, one row per frame. */
  const run = (seconds, at) => ev(async ({ seconds, at }) => {
    const u = window.__ug, ctx = u.modes.ctx, m = u.modes.registry.get('pedestrian'), keys = u.fpsControls.keys;
    const rows = [], t0 = ctx.time, todo = at.map((a) => ({ ...a, done: false }));
    for (let i = 0; i < 6000 && ctx.time - t0 < seconds; i++) {
      for (const a of todo) if (!a.done && ctx.time - t0 >= a.t) { a.done = true; for (const k of a.down ?? []) keys.add(k); for (const k of a.up ?? []) keys.delete(k); if (a.press) m.press(a.press); }
      await new Promise((r) => requestAnimationFrame(r));
      const d = u.player.debug();
      rows.push({ t: ctx.time - t0, state: m.body.state, jet: !!m.body.jet, jl: m.body.jetLevel ?? null, y: m.body.y, vy: m.body.vy,
        count: d.flames.count, len: d.flames.lengthM.slice(), fly: d.poseWeights.fly });
    }
    keys.clear();
    return rows;
  }, { seconds, at });
  const land = () => page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').body.state === 'ground', null, { timeout: 60000 });
  const tap = await run(1.6, [{ t: 0, down: [' '], press: 'jump' }, { t: 0.05, up: [' '] }]);
  await land();
  await place(KX, 800);
  const hold = await run(1.6, [{ t: 0, down: [' '], press: 'jump' }]);
  // a capture while firing
  await ev(() => { window.__ug.fpsControls.keys.add(' '); });
  await wait(500);
  await snap('4-jetpack-flames');
  await ev(() => { window.__ug.fpsControls.keys.delete(' '); });
  await land();
  await place(THAMES, 1000);
  const river = await run(1.5, [{ t: 0, down: [' '], press: 'jump' }]);
  const first = hold.find((r) => r.jet);
  const startI = hold.findIndex((r) => r.state !== 'ground');
  let dips = 0;
  for (let i = Math.max(1, startI); i < hold.length; i++) if (hold[i].y < hold[i - 1].y - 1e-6) dips++;
  const jetRows = hold.filter((r) => r.jet);
  const meanLen = (r) => r.len.reduce((a, b) => a + b, 0) / 4;
  const low = jetRows.filter((r) => r.jl !== null && r.jl < 0.6), full = jetRows.filter((r) => r.jl !== null && r.jl >= 0.999);
  const avg = (a) => a.reduce((s, r) => s + meanLen(r), 0) / Math.max(1, a.length);
  const lateFly = jetRows.filter((r) => r.t >= first.t + 0.5).map((r) => r.fly);
  const out = {
    tap: { air: tap.some((r) => r.state === 'air'), jet: tap.some((r) => r.jet), flames: Math.max(...tap.map((r) => r.count)) },
    // Flames show only above FLAME.minLevel (flames.js flameVisible): the first jet frame can sit below it and the flames then
    // appear a frame later. The count is read over the frames that are above the threshold; the rule itself is unchanged.
    hold: { firstJetT: first?.t ?? null, dips, count: [...new Set(jetRows.filter((r) => r.jl !== null && r.jl > FLAME.minLevel).map((r) => r.count))], lowLen: avg(low), fullLen: avg(full), nLow: low.length, nFull: full.length,
      flyMinLate: lateFly.length ? Math.min(...lateFly) : null, jlMonotone: jetRows.every((r, i) => i === 0 || (r.jl ?? 1) >= (jetRows[i - 1].jl ?? 1) - 1e-9) },
    river: { states: [...new Set(river.map((r) => r.state))], flames: Math.max(...river.map((r) => r.count)) },
  };
  record('4-jetpack', out);
  await toPedestrian();
  expect(out.tap.air).toBe(true);
  expect(out.tap.jet).toBe(false);
  expect(out.tap.flames).toBe(0);
  expect(out.hold.firstJetT).toBeGreaterThanOrEqual(0.12);
  expect(out.hold.firstJetT).toBeLessThanOrEqual(0.20);
  expect(out.hold.dips, 'height monotonic on the hold').toBe(0);
  expect(out.hold.count).toEqual([4]);
  expect(out.hold.nLow + out.hold.nFull).toBeGreaterThan(0);
  if (out.hold.nLow > 0) expect(out.hold.lowLen, 'flames grow with jetLevel').toBeLessThan(out.hold.fullLen);
  expect(out.hold.flyMinLate, 'the flying pose is held while firing').toBeGreaterThanOrEqual(0.95);
  expect(out.river.flames, 'no flames in the river').toBe(0);
});

// ── 5. the board on a bridge (D+S+M) ────────────────────────────────────────────────────────────────────────────
test('5 board on a bridge: the skateboard rides across Westminster Bridge on its deck', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  const r = await ev(async () => {
    const u = window.__ug, L = window.__s14, c = u.modes.collision, m = u.modes.registry.get('pedestrian'), keys = u.fpsControls.keys;
    const slug = [...u.bridgeRegistry.keys()].find((k) => /^westminster/.test(k));
    const rec = u.bridgeRegistry.get(slug), f = L.frame(rec, 0);
    let blocked = false;
    for (let s = -20; s <= 0; s++) { const p = L.at(f, s, 0); if (c.buildingsNear(p.x, p.z, 0.4).length || c.waterAt(p.x, p.z)) { blocked = true; break; } }
    const s0 = L.at(f, blocked ? -2 : -20, 0);
    m.setBoard(false);
    m.place(s0.x, s0.z, { yaw: L.yawOf(f.ux, f.uz), pitch: 0 });
    for (let i = 0; i < 20; i++) await new Promise((res) => requestAnimationFrame(res));
    m.setBoard(true);
    for (let i = 0; i < 200 && !m.debug().board.on; i++) await new Promise((res) => requestAnimationFrame(res));
    const on0 = m.debug().board.on;
    keys.add('w');
    let furthest = -Infinity, minRel = Infinity, maxRel = -Infinity, maxOff = 0, onDeck = 0, swim = false, offBoard = 0, noHit = 0, n = 0;
    for (let i = 0; i < 60 * 60; i++) {
      u.modes.update(1 / 60); n++;
      const st = m.playerState(), d = m.debug();
      if (!st.board) offBoard++;
      if (d.state === 'swim') swim = true;
      const uu = (d.x - f.a.x) * f.ux + (d.z - f.a.z) * f.uz, vv = (d.x - f.a.x) * f.nx + (d.z - f.a.z) * f.nz;
      furthest = Math.max(furthest, uu);
      if (uu >= 0 && uu <= f.L) {
        onDeck++;
        const top = L.deckTop(rec, d.x, d.z, d.y + 2.5 * 5);
        if (top === null) noHit++; else { const rel = (d.y - top) / 5; minRel = Math.min(minRel, rel); maxRel = Math.max(maxRel, rel); }
        maxOff = Math.max(maxOff, Math.abs(vv));
      }
      if (uu >= f.L + 3) break;
    }
    keys.delete('w');
    const hw = L.halfWidth(rec, { ...f }) ?? rec.data.deckWidthM / 2;
    // stand mid-deck on the board for the capture
    const mid = L.at(f, f.L / 2, 0);
    m.place(mid.x, mid.z, { yaw: L.yawOf(f.ux, f.uz), pitch: 0 });
    return { slug, L: f.L, hw, blocked, on0, furthest, minRel, maxRel, maxOff, onDeck, swim, offBoard, noHit, steps: n, boardAfter: m.debug().board.on };
  });
  await wait(1200);
  await snap('5-board-westminster');
  await ev(() => window.__ug.modes.registry.get('pedestrian').setBoard(false));
  record('5-board-bridge', r);
  expect(r.on0, 'the board went on').toBe(true);
  expect(r.furthest, 'rode the whole deck').toBeGreaterThanOrEqual(r.L);
  expect(r.swim, 'never in the river').toBe(false);
  expect(r.offBoard, 'stayed on the board').toBe(0);
  expect(r.onDeck).toBeGreaterThan(30);
  expect(r.noHit).toBe(0);
  expect(r.minRel, 'never below the deck').toBeGreaterThanOrEqual(-0.15);
  expect(r.maxRel, 'never floating off it').toBeLessThanOrEqual(0.6);
  expect(r.maxOff, 'inside the deck\'s width').toBeLessThan(r.hw);
});

// ── 5b. the board on a station roof (D+S) ───────────────────────────────────────────────────────────────────────
// Added after the integration verifier found the rider thrown off: skate-glue.js called the touch rule directly and
// bypassed lane S's on-foot roof guard. A rider on a station roof is above the wall, not at it.
test('5b board on a roof: the skateboard on King\'s Cross\'s roof stays on the roof, with no push and no card', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  await ev(() => window.__ug.modes.registry.get('pedestrian').setBoard(false));
  const r = await ev(async () => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), sb = u.stationBuildings, keys = u.fpsControls.keys, VE = 5;
    const site = 'kings-cross-st-pancras';
    const b = sb.index.buildingForSite(site), exit = sb.index.stationExitPose(site);
    const c = sb.contactAt(exit.x, exit.z, 200), roofY = sb.meshes.roofOf(b).roofY;
    m.place(c.x + c.nx * 1.5, c.z + c.nz * 1.5, { yaw: Math.atan2(c.nx, c.nz), pitch: 0 });
    for (let i = 0; i < 5; i++) u.modes.update(1 / 60);
    m.press('jump'); keys.add(' '); keys.add('w');
    let phase = 'climb', above = null, landed = null;
    for (let i = 0; i < 1200; i++) {
      if (phase === 'climb' && m.debug().y > roofY + 2 * VE) { keys.delete(' '); phase = 'over'; above = i; }
      if (phase === 'over' && i - above > 40) { keys.delete('w'); phase = 'land'; }
      u.modes.update(1 / 60);
      const d = m.debug();
      if (phase === 'land' && d.state === 'ground' && Math.abs(d.y - roofY) < 0.25) { landed = i; break; }
    }
    keys.clear();
    for (let i = 0; i < 30; i++) u.modes.update(1 / 60);
    const foot = m.debug();
    const footOnRoof = Math.abs(foot.y - roofY) < 0.25 && !!sb.contactAt(foot.x, foot.z, 1)?.inside;
    m.setBoard(true);
    for (let i = 0; i < 400 && !m.debug().board.on; i++) await new Promise((res) => requestAnimationFrame(res));
    const on = m.debug().board.on;
    const x0 = foot.x, z0 = foot.z;
    let maxMoved = 0, minRel = Infinity, maxRel = -Infinity, card = null;
    for (let i = 0; i < 120; i++) {
      u.modes.update(1 / 60);
      const d = m.debug();
      maxMoved = Math.max(maxMoved, Math.hypot(d.x - x0, d.z - z0));
      minRel = Math.min(minRel, (d.y - roofY) / VE); maxRel = Math.max(maxRel, (d.y - roofY) / VE);
      card = card ?? (d.card?.kind ?? null);
    }
    const d = m.debug();
    return { landed, footOnRoof, on, maxMoved, minRel, maxRel, card, stillOn: d.board.on, inside: !!sb.contactAt(d.x, d.z, 1)?.inside, state: d.state };
  });
  await wait(600);
  await snap('5b-board-kings-cross-roof');
  await ev(() => { window.__ug.modes.registry.get('pedestrian').setBoard(false); });
  record('5b-board-roof', r);
  expect(r.landed, 'the walker reached the roof').not.toBeNull();
  expect(r.footOnRoof, 'on foot the walker stands on the roof').toBe(true);
  expect(r.on, 'the board went on').toBe(true);
  expect(r.maxMoved, 'the touch rule does not push a rider on the roof').toBeLessThan(0.5);
  expect(r.minRel, 'not dropped off the roof').toBeGreaterThanOrEqual(-0.3);
  expect(r.maxRel).toBeLessThanOrEqual(0.3);
  expect(r.card, 'no station card on the roof').toBeNull();
  expect(r.stillOn).toBe(true);
  expect(r.inside, 'still over the building').toBe(true);
});

// ── 6. the Drone and the Balloon against buildings (D+S+B) ─────────────────────────────────────────────────────
test('6 Drone and Balloon: the third-person Drone stops at Fulham Broadway\'s box and King\'s Cross\'s wall; the Balloon lands on a station roof', async () => {
  await ev(() => window.__ug.fpsControls.keys.clear());
  await ev(() => window.__ug.modes.activate('deity'));
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__ug.modes.activeId === 'drone', null, { timeout: 30000 });
  // Fulham Broadway's restored host box: the biggest map box within 80 m of the report's old label point
  const fb = await ev(() => {
    const c = window.__ug.modes.collision; c.sync();
    const boxes = c.buildingsNear(-4555.31, 3085.84, 80);
    boxes.sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ));
    const b = boxes[0];
    return b ? { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, baseY: b.baseY, roofY: b.roofY } : null;
  });
  expect(fb).not.toBeNull();
  const flyAtBox = await ev(async (b) => {
    const u = window.__ug, d = u.modes.registry.get('drone');
    const cz = (b.minZ + b.maxZ) / 2, y = (b.baseY + b.roofY) / 2;
    const sx = b.minX - 10;                                            // west of the box, flying east (+X)
    d.place({ x: sx, y, z: cz, yaw: -Math.PI / 2, pitch: 0 });
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    const third = d.isThirdPerson();
    u.fpsControls.keys.add('w');
    let minGap = Infinity, inside = false;
    for (let i = 0; i < 300; i++) {
      u.modes.update(1 / 60);
      const p = d.debug().pos;
      const gap = b.minX - p.x;
      minGap = Math.min(minGap, gap);
      if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y > b.baseY && p.y < b.roofY) inside = true;
    }
    u.fpsControls.keys.delete('w');
    return { third, minGap, inside, hits: d.debug().hits };
  }, fb);
  for (let i = 0; i < 30; i++) await frames(1);
  await snap('6-drone-fulham-box');
  const flyAtKx = await ev(async () => {
    const u = window.__ug, d = u.modes.registry.get('drone'), sb = u.stationBuildings;
    const b = sb.index.buildingForSite('kings-cross-st-pancras'), exit = sb.index.stationExitPose('kings-cross-st-pancras');
    const c = sb.contactAt(exit.x, exit.z, 120), roof = sb.meshes.roofOf(b);
    d.place({ x: c.x + c.nx * 25, y: roof.base + 8 * 5, z: c.z + c.nz * 25, yaw: Math.atan2(c.nx, c.nz), pitch: 0 });
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    const third = d.isThirdPerson();
    u.fpsControls.keys.add('w');
    let closest = Infinity;
    for (let i = 0; i < 240; i++) { u.modes.update(1 / 60); const p = d.debug().pos; closest = Math.min(closest, sb.index.distanceTo(b, p.x, p.z)); }
    u.fpsControls.keys.delete('w');
    return { third, closest, hits: d.debug().hits };
  });
  for (let i = 0; i < 30; i++) await frames(1);
  await snap('6-drone-kings-cross');
  await page.keyboard.press('4');
  await page.waitForFunction(() => window.__ug.modes.activeId === 'balloon', null, { timeout: 30000 });
  const balloon = await ev(async () => {
    const u = window.__ug, ctx = u.modes.ctx, sb = u.stationBuildings, bl = u.modes.registry.get('balloon'), c = u.modes.collision;
    const b = sb.index.buildingForSite('kings-cross-st-pancras'), roof = sb.meshes.roofOf(b);
    const w = ctx.wind.getWindAt(0.5, ctx.time), wv = { x: -Math.sin(w.dirRad), z: Math.cos(w.dirRad), s: w.speedMps };
    let shift = 0, best = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      bl.place({ x: b.label.x - wv.x * shift, y: roof.roofY + 5.5 * 5 + 1.5 * 5, z: b.label.z - wv.z * shift, dT: 30, vy: 0 });
      let groundedAt = null, feetErr = null, lx = 0, lz = 0;
      for (let i = 0; i < 20 * 60; i++) {
        u.modes.update(1 / 60);
        const d = bl.debug();
        if (d.grounded && groundedAt === null) { groundedAt = i / 60; feetErr = Math.abs((d.pos.y - 1.5 * 5) - roof.roofY) / 5; lx = d.pos.x; lz = d.pos.z; }
      }
      const along = (lx - b.label.x) * wv.x + (lz - b.label.z) * wv.z;
      best = { attempt, grounded: groundedAt !== null, groundedAt, feetErr, wind: wv.s, aboveGroundM: (roof.roofY - c.groundHeightAt(b.label.x, b.label.z)) / 5 };
      if (groundedAt !== null && feetErr <= 0.05) break;
      shift += along;
    }
    return { third: bl.isThirdPerson(), ...best };
  });
  for (let i = 0; i < 40; i++) await frames(1);
  await snap('6-balloon-kings-cross-roof');
  record('6-drone-balloon', { fb, flyAtBox, flyAtKx, balloon });
  await toPedestrian();
  expect(flyAtBox.third).toBe(true);
  expect(flyAtBox.inside, 'never inside Fulham Broadway\'s box').toBe(false);
  expect(flyAtBox.minGap, 'stops short of the box').toBeGreaterThanOrEqual(1.3);
  expect(flyAtBox.minGap, 'and reaches it').toBeLessThanOrEqual(3);
  expect(flyAtKx.third).toBe(true);
  expect(flyAtKx.closest, 'stops at King\'s Cross\'s wall').toBeGreaterThanOrEqual(1.49);
  expect(flyAtKx.hits).toBeGreaterThanOrEqual(1);
  expect(balloon.third).toBe(true);
  expect(balloon.grounded, 'the Balloon lands').toBe(true);
  expect(balloon.feetErr, 'on the roof').toBeLessThanOrEqual(0.05);
  expect(balloon.aboveGroundM).toBeGreaterThanOrEqual(5);
});

// ── 7. the walker's touch (S+B) ─────────────────────────────────────────────────────────────────────────────────
test('7 the walker\'s touch: King\'s Cross stops the walker 0.36 m out and opens the card; Fulham Broadway\'s marked entrance opens its card', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  const kx = await ev(async () => {
    const u = window.__ug, sb = u.stationBuildings, m = u.modes.registry.get('pedestrian'), site = 'kings-cross-st-pancras';
    const pose = sb.index.stationExitPose(site), c0 = sb.contactAt(pose.x, pose.z, 120);
    const dx = c0.x - pose.x, dz = c0.z - pose.z, L = Math.hypot(dx, dz) || 1;
    m.place(pose.x, pose.z, { yaw: Math.atan2(-dx / L, -dz / L), pitch: 0 });
    u.fpsControls.keys.add('w');
    let cardAt = null;
    for (let i = 0; i < 300; i++) { await new Promise((r) => requestAnimationFrame(r)); if (cardAt === null && m.debug().card) cardAt = i; }
    u.fpsControls.keys.delete('w');
    const d = m.debug(), c = sb.contactAt(d.x, d.z, 5);
    return { d: c ? c.d : null, cardAt, card: d.card?.kind ?? null, rows: d.chooser?.rows ?? [] };
  });
  await snap('7-touch-kings-cross');
  await page.keyboard.press('Escape');
  await wait(400);
  const fb = await ev(async () => {
    const u = window.__ug, sb = u.stationBuildings, m = u.modes.registry.get('pedestrian');
    const data = await (await fetch('/data/station-buildings.json')).json();
    const b = data.buildings.find((x) => x.key === data.sites['fulham-broadway'].building), pose = b.exit;
    m.place(pose.x, pose.z, { yaw: pose.yaw + Math.PI, pitch: 0 });
    u.fpsControls.keys.add('w');
    const log = [];
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const d = m.debug(), hit = sb.contactAt(d.x, d.z, 30);
      log.push({ d: hit ? hit.d : null, key: hit?.building.key ?? null, open: d.chooser.open, rows: d.chooser.rows });
      if (d.chooser.open) break;
    }
    u.fpsControls.keys.delete('w');
    // A contact is a footprint within the rule's trigger distance (0.42 m, CONTACT_TRIGGER_M in pedestrian.js); the first frame under
    // it can land anywhere between 0.36 and 0.42 m, according to the frame step, so 'reached' is read at 0.42 (it was 0.40 and
    // missed a 0.4015 m opening frame once under load: the card did open).
    const i = log.findIndex((f) => f.d !== null && f.d <= 0.42);
    return { kind: b.kind, key: b.key, reached: i, open: log.some((f) => f.open), rows: log.at(-1).rows, dMin: Math.min(...log.filter((f) => f.d !== null).map((f) => f.d)) };
  });
  await snap('7-touch-fulham-broadway');
  await page.keyboard.press('Escape');
  await wait(400);
  record('7-walker-touch', { kx, fb });
  expect(kx.d).toBeGreaterThanOrEqual(0.35);
  expect(kx.d).toBeLessThanOrEqual(0.37);
  expect(kx.card).not.toBeNull();
  expect(fb.reached, 'reached Fulham Broadway\'s entrance block').toBeGreaterThan(-1);
  expect(fb.open, 'its card opens').toBe(true);
  expect(fb.rows.some((r) => /District/.test(r)), JSON.stringify(fb.rows)).toBe(true);
});

// ── 8. views by place (P+D) ─────────────────────────────────────────────────────────────────────────────────────
test('8 views by place: third person above ground on foot, board, Drone and Balloon; first person in the shaft, tunnel and open-air ride; the street returns the choice', async () => {
  await toPedestrian();
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  await place(KX, 800);
  const out = { foot: await ev(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson()) };
  await ev(() => window.__ug.modes.registry.get('pedestrian').setBoard(true));
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().board.on, null, { timeout: 10000 });
  await wait(400);
  out.board = await ev(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson());
  await ev(() => window.__ug.modes.registry.get('pedestrian').setBoard(false));
  await ev(() => window.__ug.modes.activate('deity'));
  await page.keyboard.press('3');
  await page.waitForFunction(() => window.__ug.modes.activeId === 'drone', null, { timeout: 30000 });
  await wait(600);
  out.drone = await ev(() => window.__ug.modes.registry.get('drone').isThirdPerson());
  await page.keyboard.press('4');
  await page.waitForFunction(() => window.__ug.modes.activeId === 'balloon', null, { timeout: 30000 });
  await wait(600);
  out.balloon = await ev(() => window.__ug.modes.registry.get('balloon').isThirdPerson());
  await toPedestrian();
  // the station: E at an entrance, the shaft, the tunnel, then up to the street (both choices of view)
  out.station = [];
  for (const pressV of [false, true]) {
    await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
    const at = await ev(() => {
      const n = window.__ug.modes.registry.get('pedestrian').network;
      const stop = n.paths.find((q) => !q.lineId.startsWith('og:') && q.stops.length)?.stops.find((x) => x.stop.depthM > 10)?.stop;
      return stop ? { x: stop.x, z: stop.z } : null;
    });
    await place([at.x, at.z, 0], 900);
    if (pressV) { await page.keyboard.press('v'); await wait(400); }
    const chosen = await ev(() => window.__ug.modes.registry.get('pedestrian').debug().view.chosen);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 15000 });
    await ev(() => window.__ug.modes.registry.get('pedestrian').chooseRow(0));
    const seen = [];
    for (let i = 0; i < 400; i++) {
      await wait(40);
      const s = await ev(() => { const m = window.__ug.modes.registry.get('pedestrian'); return { phase: m.debug().phase, third: m.isThirdPerson() }; });
      seen.push(s);
      if (s.phase === 'tunnel') break;
    }
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 20000 });
    await ev(() => window.__ug.modes.registry.get('pedestrian').chooseRow(0));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 60000 });
    await wait(1000);
    const back = await ev(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson());
    out.station.push({ pressV, chosen, phases: [...new Set(seen.map((s) => s.phase))], thirdUnderground: seen.filter((s) => s.phase !== 'body' && s.phase !== 'enter' && s.third).length, back });
  }
  // the open-air ride: a place on a line's drawn track in the open
  await ev(() => window.__ug.modes.registry.get('pedestrian').setView('third'));
  out.openAir = await ev(async () => {
    const u = window.__ug, m = u.modes.registry.get('pedestrian'), n = m.network;
    const rank = (id) => { const i = ['district', 'metropolitan', 'central', 'piccadilly'].indexOf(id); return i < 0 ? 9 : i; };
    const paths = n.paths.filter((p) => !p.lineId.startsWith('og:')).sort((a, b) => rank(a.lineId) - rank(b.lineId));
    for (const p of paths) {
      for (let s = 50; s < p.length; s += 300) {
        m.placeInTunnel({ path: p.id, s, dir: 1 });
        for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
        if (m.debug().regime === 'open') {
          let third = 0;
          for (let i = 0; i < 30; i++) { await new Promise((r) => requestAnimationFrame(r)); if (m.isThirdPerson()) third++; }
          return { path: p.id, lineId: p.lineId, s, regime: 'open', phase: m.debug().phase, third, chosen: m.debug().view.chosen };
        }
      }
    }
    return null;
  });
  await snap('8-open-air-first-person');
  await place(KX, 1200);
  out.streetAfterOpenAir = await ev(() => window.__ug.modes.registry.get('pedestrian').isThirdPerson());
  await snap('8-street-third-person');
  record('8-views-by-place', out);
  expect(out.foot).toBe(true);
  expect(out.board).toBe(true);
  expect(out.drone).toBe(true);
  expect(out.balloon).toBe(true);
  for (const s of out.station) {
    expect(s.phases).toContain('shaft');
    expect(s.phases).toContain('tunnel');
    expect(s.thirdUnderground, 'first person below ground').toBe(0);
    expect(s.back, 'the street returns the choice').toBe(s.chosen === 'third');
  }
  expect(out.openAir, 'an open-air stretch was found').not.toBeNull();
  expect(out.openAir.third, 'first person on the open-air ride').toBe(0);
  expect(out.streetAfterOpenAir).toBe(true);
});

// ── 9. the opening (against the live build) ────────────────────────────────────────────────────────────────────
test('9 the opening: a cold default load runs it as the live build does, the figure fetched after the landing, no console error', async ({ browser }) => {
  const INIT = () => {
    window.__s14o = { reveal: null, done: null };
    window.addEventListener('ug:opening-reveal', () => { window.__s14o.reveal = performance.now(); }, { once: true });
    window.addEventListener('ug:intro-done', () => { window.__s14o.done = performance.now(); }, { once: true });
  };
  const one = async (base, label) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await p.addInitScript(INIT);
    try {
      await p.goto(base + '/');
      await p.waitForFunction(() => window.__s14o?.done !== null && window.__s14o?.done !== undefined && window.__ug?.intro?.getPhase() === 'done', null, { timeout: 240000 });
      const phaseAtDone = await p.evaluate(() => window.__ug.intro.getPhase());
      // the figure: fetched once the opening has landed (idle callback, at most 4 s), never before
      await p.waitForTimeout(7000);
      const r = await p.evaluate(() => ({
        reveal: window.__s14o.reveal, done: window.__s14o.done,
        glb: performance.getEntriesByType('resource').filter((e) => /models\/player\/.*\.glb/.test(e.name)).map((e) => ({ name: e.name.replace(/^.*\/models/, '/models'), start: e.startTime })),
      }));
      if (label === 'candidate-1') await snap('9-opening-landed', p);
      return { label, base, ...r, phaseAtDone, errors: errs };
    } finally { await p.close(); }
  };
  const runs = [];
  for (let k = 0; k < 2; k++) {
    runs.push(await one(LB, `live-${k}`));
    runs.push(await one('', `candidate-${k}`));
  }
  const live = runs.filter((r) => r.label.startsWith('live')), cand = runs.filter((r) => r.label.startsWith('candidate'));
  const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
  const sum = { liveReveal: mean(live, 'reveal'), liveDone: mean(live, 'done'), candReveal: mean(cand, 'reveal'), candDone: mean(cand, 'done'),
    liveSpread: Math.max(...live.map((r) => r.done)) - Math.min(...live.map((r) => r.done)) };
  record('9-opening', { sum, runs });
  for (const r of cand) {
    expect(r.errors, `${r.label}: zero console errors`).toEqual([]);
    expect(r.glb.length, `${r.label}: the figure is fetched once`).toBe(1);
    expect(r.glb[0].start, `${r.label}: after the landing`).toBeGreaterThan(r.done);
  }
  for (const r of live) expect(r.glb.length).toBe(0);
  // within noise: the candidate's mean reveal and landing within 15% (or 1.5 s) of the live build's
  const tol = (v) => Math.max(1500, 0.15 * v);
  expect(Math.abs(sum.candReveal - sum.liveReveal), 'reveal time').toBeLessThanOrEqual(tol(sum.liveReveal));
  expect(Math.abs(sum.candDone - sum.liveDone), 'landing time').toBeLessThanOrEqual(tol(sum.liveDone));
});

test('no console or page errors across the cross-lane checks', () => {
  expect(errors).toEqual([]);
});
