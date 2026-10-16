import { test, expect } from '@playwright/test';

// Sprint 16Oct26f (D-054, lane R): the economies that cut the weak machine's per-frame cost must leave the picture
// unchanged: trainCull, shadowFloat, edgeLineSize and m25Chunks ship on. shadowSnap (the fit snaps along the light too) saves about
// 1 ms a frame at the body views but differs from the unsnapped frame by up to 0.011% of the pixels (561 px, 4 levels at
// Westminster Bridge), above the 0.002% every economy is held to, so it ships OFF (DEFAULT_OFF in render-economies.js,
// R/options.md): its tests here pin that it is off and that its difference stays inside the documented bound.
//
// R-05: at ten poses (the figure in each of the four bodies, first person on foot, King's Cross street with names,
// a bridge deck, overview, Greenwich, the M25 edge) the app loop is held and stepped by hand with a repeated
// timestamp (dt = 0, the method of render-economies.spec.js), and the frame is grabbed with every economy at its
// default, then with the four new ones off, on, off. Each adjacent pair must match to within the renderer's own
// frame-to-frame noise plus at most 0.002% of pixels, none by more than 8 levels (the 24Sep26h economies' tolerance).
// Each of the four alone is also toggled at P1, P4, P8 and P9.
// R-14: the train cull is exact at the hand-over: the trains are not posed above ground, and the underground frame and
// every train's position and quaternion are the same as with the economy off.
// R-15: the shadow map is not re-rendered at a still camera, nor on every frame of a walk.

const SHIPPED = ['trainCull', 'shadowFloat', 'edgeLineSize', 'm25Chunks'];
const S16 = [...SHIPPED, 'shadowSnap'];
const MAX_PCT = 0.002, MAX_LEVEL = 8;
const SNAP_MAX_PCT = 0.02; // the documented bound for the one economy that ships off
const POSES = {
  P1: { kind: 'body', body: 'foot', view: 'third' },
  P2: { kind: 'body', body: 'board', view: 'third' },
  P3: { kind: 'body', body: 'drone', view: 'third' },
  P4: { kind: 'body', body: 'balloon', view: 'third' },
  P5: { kind: 'body', body: 'foot', view: 'first' },
  P6: { kind: 'body', body: 'kingsCross', view: 'third' },
  P7: { kind: 'body', body: 'westminster', view: 'third' },
  P8: { kind: 'deity', p: [0, 20000, 18000], t: [0, 0, 0] },
  P9: { kind: 'deity', p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
  P10: { kind: 'deity', p: [4910.7, 634.3, -18445.1], t: [6239.5, 102.8, -20483.9] },
};
const ALONE = ['P1', 'P4', 'P7', 'P8', 'P9'];

test.describe.configure({ mode: 'serial' });
test.setTimeout(600000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held = [];
    let lastTs = 0;
    window.requestAnimationFrame = cb => {
      if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
      return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
    };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; const h = held.splice(0); for (const cb of h) window.requestAnimationFrame(cb); };
  });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup
    && window.__ug.landmarkGroup?.children.length && window.__ug.stationBuildings?.ready, null, { timeout: 180000 });
  await page.evaluate(() => {
    const u = window.__ug;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setShadowsEnabled(true, { persist: false });
    u.controls.enableDamping = false;
  });
  await page.waitForTimeout(3000);
});
test.afterAll(async () => { await page?.close(); });

/** Put the app at pose `id` with the loop running; the caller then freezes it. */
async function place(id) {
  const P = POSES[id];
  await page.evaluate(async ({ P }) => {
    window.__thaw();
    const u = window.__ug, reg = u.modes.registry, sleep = ms => new Promise(r => setTimeout(r, ms));
    if (P.kind === 'deity') {
      if (u.modes.activeId !== 'deity') u.modes.activate('deity');
      u.camera.position.fromArray(P.p); u.controls.target.fromArray(P.t); u.controls.update();
      return;
    }
    const needFigure = () => u.modes.ctx.playerView?.figureLoaded?.();
    const walker = async () => {
      if (u.modes.activeId !== 'pedestrian') u.modes.activate('pedestrian');
      for (let i = 0; i < 600; i++) { const d = reg.get('pedestrian').debug(); if (d.phase === 'body' && !d.ease.running) break; await sleep(50); }
      for (let i = 0; i < 400 && !needFigure(); i++) await sleep(50);
      return reg.get('pedestrian');
    };
    if (P.body === 'foot' || P.body === 'board') {
      const ped = await walker();
      ped.place(2743.9, -760.9, { yaw: Math.PI });
      ped.setView?.(P.view);
      if (P.body === 'board') { ped.setBoard?.(true); for (let i = 0; i < 100 && ped.debug().board && !ped.debug().board.on; i++) await sleep(50); }
      else if (ped.debug().board?.on) ped.setBoard?.(false);
    } else if (P.body === 'drone') {
      u.modes.activate('drone');
      for (let i = 0; i < 400 && !needFigure(); i++) await sleep(50);
      const g = u.modes.collision.groundHeightAt(2743.9, -760.9) ?? 0;
      reg.get('drone').place({ x: 2743.9, y: g + 25, z: -760.9, yaw: Math.PI, pitch: 0 });
      reg.get('drone').setView?.('third');
    } else if (P.body === 'balloon') {
      u.modes.activate('balloon');
      for (let i = 0; i < 400 && !needFigure(); i++) await sleep(50);
      const w = u.modes.ctx.waterSurfaceAt(885.1, -145.1) ?? 0;
      reg.get('balloon').place({ x: 885.1, y: w + 151.5 * 5, z: -145.1, dT: 60, vy: 0 });
      reg.get('balloon').setView?.('third');
    } else if (P.body === 'kingsCross') {
      const ped = await walker(), sb = u.stationBuildings, pose = sb.stationExitPose(sb.siteKeyOf("King's Cross St. Pancras"));
      ped.place(pose.x - Math.sin(pose.yaw) * 30, pose.z - Math.cos(pose.yaw) * 30, { yaw: pose.yaw + Math.PI, pitch: 0 });
      ped.setView?.('third');
    } else if (P.body === 'westminster') {
      const ped = await walker(), rec = u.bridgeRegistry.get('westminster'), a = rec.deckEndpoints.a, b = rec.deckEndpoints.b;
      const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      ped.place(a.x + ux * L / 2, a.z + uz * L / 2, { yaw: Math.atan2(-ux, -uz), pitch: 0 });
      ped.setView?.('third');
    }
  }, { P });
  await page.evaluate(() => new Promise(r => setTimeout(r, 3000)));
}

/** Freeze, then grab off/on sequences of the named economies; returns the pixel differences. */
async function compare(names, { withDefault }) {
  return page.evaluate(async ({ names, withDefault }) => {
    window.__freeze = true;
    await new Promise(res => setTimeout(res, 150));
    const u = window.__ug, r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = on => {
      for (const n of names) u.economies.set(n, on);
      // Three held ticks, the last of which draws the frame through the app's own undergroundCull.render (the underground set
      // hidden for an above-ground camera, as lived) and leaves it in the buffer; read it in the same task. (A direct
      // composer.render here would draw everything the cull hides, including the tube trains, and make trainCull look
      // like a pixel change it is not: the 07391f3 economies spec does that, which is harmless to it.)
      window.__step(3); // M25 traffic recomputes every third tick
      r.setRenderTarget(null);
      const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b;
    };
    const diff = (a, b) => {
      let n = 0, max = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d) { n++; if (d > max) max = d; }
      }
      return { px: n, pct: n / (W * H) * 100, max };
    };
    // the first frames after a mode or camera change are still settling (eased things, the label pass): step until two
    // consecutive frames are identical, so the sequence compares frames of a settled scene (P8 after the figure's modes
    // needed about a dozen held steps: its first grabs differed by 900 px while every later one was identical)
    { let prev = grab(true); for (let k = 0; k < 16; k++) { const cur = grab(true); const same = diff(prev, cur).px === 0; prev = cur; if (same) break; } }
    const d0 = withDefault ? grab(true) : null;
    const off1 = grab(false), on1 = grab(true), off2 = grab(false), on2 = grab(true);
    const out = {
      size: [W, H], noise: diff(off1, off2), onNoise: diff(on1, on2),
      pairs: [...(withDefault ? [diff(d0, off1)] : []), diff(off1, on1), diff(on1, off2), diff(off2, on2)],
      nonBlack: (() => { let n = 0; for (let i = 0; i < on1.length; i += 64) if (on1[i] + on1[i + 1] + on1[i + 2] > 30) n++; return n; })(),
      shadowsActive: window.__ugSun.status.active,
      figure: u.modes.ctx.playerView?.figureLoaded?.() ?? null, mode: u.modes.activeId,
    };
    window.__thaw();
    return out;
  }, { names, withDefault });
}

function check(name, r) {
  console.log(name, JSON.stringify(r));
  expect(r.nonBlack, `${name} is a real picture`).toBeGreaterThan(1000);
  const allowPct = MAX_PCT + Math.max(r.noise.pct, r.onNoise.pct);
  for (const d of r.pairs) {
    expect(d.pct, `${name} pair differs by ${d.pct}% (${d.px} px, max ${d.max})`).toBeLessThanOrEqual(allowPct);
    if (d.px > Math.max(r.noise.px, r.onNoise.px)) expect(d.max, `${name} largest level difference`).toBeLessThanOrEqual(MAX_LEVEL);
  }
}

test('the five economies exist; four are on by default and shadowSnap ships off', async () => {
  const r = await page.evaluate(() => ({ desc: Object.keys(window.__ug.economies.describe()), on: ['trainCull', 'shadowFloat', 'edgeLineSize', 'm25Chunks', 'shadowSnap'].map(n => window.__ug.economies.on(n)) }));
  for (const n of S16) expect(r.desc).toContain(n);
  expect(r.on).toEqual([true, true, true, true, false]);
});

for (const id of Object.keys(POSES)) {
  test(`${id}: the shipped economies together leave the picture unchanged`, async () => {
    await place(id);
    check(id, await compare(SHIPPED, { withDefault: true }));
  });
  if (ALONE.includes(id)) for (const name of SHIPPED) {
    test(`${id}: ${name} alone leaves the picture unchanged`, async () => {
      await place(id);
      check(`${id}/${name}`, await compare([name], { withDefault: true }));
    });
  }
  // shadowSnap ships off: its difference is documented, not held to the strict tolerance
  test(`${id}: shadowSnap (off by default) differs from the unsnapped frame by no more than the documented bound`, async () => {
    await place(id);
    const r = await compare(['shadowSnap'], { withDefault: false });
    console.log(`${id}/shadowSnap`, JSON.stringify(r.pairs));
    expect(r.nonBlack).toBeGreaterThan(1000);
    for (const d of r.pairs) { expect(d.pct).toBeLessThanOrEqual(SNAP_MAX_PCT); expect(d.max).toBeLessThanOrEqual(MAX_LEVEL); }
  });
}

test('R-14: the trains are not posed above ground, still move, and the hand-over is exact', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, sleep = ms => new Promise(res => setTimeout(res, ms));
    window.__thaw();
    if (u.modes.activeId !== 'deity') u.modes.activate('deity');
    for (const n of ['trainCull', 'shadowFloat', 'edgeLineSize', 'm25Chunks']) u.economies.set(n, true);
    u.camera.position.fromArray([0, 20000, 18000]); u.controls.target.fromArray([0, 0, 0]); u.controls.update();
    await sleep(1500);
    const trains = u.trainSystem.allTrains, S = u.trainPoseStats;
    // every train sits under a line:* group (the cull's set); a train under any other group would not be covered
    const under = trains.filter(t => { let o = t; while (o.parent && o.parent !== u.scene) o = o.parent; return (o.name || '').startsWith('line:'); }).length;
    const before = { ...S }, pos0 = trains.map(t => t.position.toArray());
    await sleep(5000);
    const after = { ...S }, moved = trains.filter((t, i) => { const p = t.position.toArray(); return p.some((v, k) => v !== pos0[i][k]); }).length;
    return { n: trains.length, under, before, after, moved, cull: u.undergroundCull?.status?.mode ?? null };
  });
  console.log('R-14 (1)', JSON.stringify(r));
  expect(r.n).toBeGreaterThan(100);
  expect(r.under).toBe(r.n);
  expect(r.after.culled).toBeGreaterThan(r.before.culled);
  expect(r.after.posed).toBe(r.before.posed);
  expect(r.moved).toBeGreaterThan(r.n * 0.5); // dwelling trains do not move; the rest do, for the audio
});

test('R-14: the underground frame and every train pose are the same with the cull on and off', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, sleep = ms => new Promise(res => setTimeout(res, ms));
    window.__thaw();
    if (u.modes.activeId !== 'deity') u.modes.activate('deity');
    u.controls.enableDamping = false;
    const rr = u.composer.renderer, gl = rr.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const P8 = { p: [0, 20000, 18000], t: [0, 0, 0] };
    const go = (p, t) => { u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update(); };
    go(P8.p, P8.t); await sleep(1500);
    window.__freeze = true; await sleep(150);
    // the train nearest Bank, and the camera 300 units to its side at its depth
    const bank = { x: 2743.9, z: -760.9 };
    const trains = u.trainSystem.allTrains;
    let best = null, bd = Infinity;
    for (const t of trains) { const d = Math.hypot(t.position.x - bank.x, t.position.z - bank.z); if (d < bd) { bd = d; best = t; } }
    const grabAt = on => {
      u.economies.set('trainCull', on);
      go(P8.p, P8.t); window.__step(5);                  // above ground, held
      const tp = best.position;
      go([tp.x + 300, tp.y, tp.z], [tp.x, tp.y, tp.z]); window.__step(1); // underground, one held tick
      const cull = u.undergroundCull?.status?.mode ?? null;
      const rec = trains.map(t => [...t.position.toArray(), ...t.quaternion.toArray()]);
      rr.setRenderTarget(null);
      const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); // the frame the held tick drew
      return { b, rec, cull };
    };
    const A = grabAt(true), B = grabAt(false), A2 = grabAt(true);
    let n = 0, max = 0;
    for (let i = 0; i < A.b.length; i += 4) { const d = Math.max(Math.abs(A.b[i] - B.b[i]), Math.abs(A.b[i + 1] - B.b[i + 1]), Math.abs(A.b[i + 2] - B.b[i + 2])); if (d) { n++; if (d > max) max = d; } }
    let nn = 0; for (let i = 0; i < A.b.length; i += 4) { const d = Math.max(Math.abs(A.b[i] - A2.b[i]), Math.abs(A.b[i + 1] - A2.b[i + 1]), Math.abs(A.b[i + 2] - A2.b[i + 2])); if (d) nn++; }
    let mismatches = 0; A.rec.forEach((row, i) => row.forEach((v, k) => { if (!Object.is(v, B.rec[i][k])) mismatches++; }));
    window.__thaw();
    return { px: n, max, noisePx: nn, pct: n / (W * H) * 100, mismatches, trains: trains.length, cullA: A.cull, cullB: B.cull, bankDistance: bd };
  });
  console.log('R-14 (2)', JSON.stringify(r));
  expect(r.cullA).toBeNull(); expect(r.cullB).toBeNull(); // underground: nothing is culled
  expect(r.mismatches, 'every train position and quaternion, number for number').toBe(0);
  expect(r.pct).toBeLessThanOrEqual(MAX_PCT + r.noisePx / (1440 * 2 * 900 * 2) * 100);
  if (r.px > r.noisePx) expect(r.max).toBeLessThanOrEqual(MAX_LEVEL);
});

test('R-15: the shadow map is not re-rendered at a still camera, nor on every frame of a walk', async () => {
  const frames = n => page.evaluate(n => new Promise(res => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const rendered = () => page.evaluate(() => ({ ...window.__ug.shadowCache.stats }));
  const out = {};
  for (const id of ['P9', 'P10']) {
    await place(id);
    await page.evaluate(() => { for (const n of ['trainCull', 'shadowFloat', 'edgeLineSize']) window.__ug.economies.set(n, true); window.__ug.economies.set('shadowSnap', false); });
    await frames(30);
    const a = await rendered(); await frames(60); const b = await rendered();
    out[id] = { requested: b.requested - a.requested, rendered: b.rendered - a.rendered, skipped: b.skipped - a.skipped };
  }
  // the walk: as shipped (shadowSnap off) the map re-renders as 07391f3 does; with shadowSnap switched on only on texel crossings
  await place('P1');
  for (const snap of [false, true]) {
    await page.evaluate(snap => { window.__ug.economies.set('shadowSnap', snap); window.__ug.fpsControls.keys.add('w'); }, snap);
    await frames(20);
    const a = await rendered(); await frames(60); const b = await rendered();
    await page.evaluate(() => { window.__ug.fpsControls.keys.delete('w'); window.__ug.economies.set('shadowSnap', false); });
    out[snap ? 'walkSnap' : 'walk'] = { requested: b.requested - a.requested, rendered: b.rendered - a.rendered, skipped: b.skipped - a.skipped };
    await place('P1');
  }
  console.log('R-15', JSON.stringify(out));
  expect(out.P9.rendered).toBeLessThanOrEqual(2);
  expect(out.P10.rendered).toBeLessThanOrEqual(2);
  expect(out.walkSnap.rendered).toBeLessThanOrEqual(20);
});
