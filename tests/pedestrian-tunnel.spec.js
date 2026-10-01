// pedestrian-tunnel.spec.js: the Pedestrian tunnel in the real app (sprint
// 30Sep26w, D-041, Lane P). Jordan (D-040 item 5): "passing trains is
// important, but also the speed of transit in tunnels should be 10x faster
// automatically, and it needs to be visually clear when you reach the next
// station, and can exit. Also when first descending, it needs to be possible to
// choose a platform." Pinned here:
//   * route data comes from the bundled TfL files by default; the live fetch
//     only behind ?tfl=live;
//   * the chooser at the shaft top lists "Line · towards X" read from the
//     bundled data (Oxford Circus, checked against the file independently);
//   * arrival fires when the walker crosses a platform at 60 m/s and at 200 m/s,
//     the name shows on screen and the bore opens into the platform tunnel;
//   * a train passing through never blocks or slows the walker, and its shake
//     is brief; a train dwelling round a walker at rest neither shakes the
//     view nor rumbles (fix round 2);
//   * digit keys pick rows while the card is open, and switch modes when it is
//     closed; opening the card releases pointer lock;
//   * a portal ends the walk and offers the street;
//   * at a tunnel mouth nothing but the interior is drawn in the bore, and the
//     mouth is daylight (fix round 1);
//   * another mode's picture at a reference pose is unchanged by a trip.
// Pure logic (crossings at any frame length, portals, towards X, the key
// capture) is pinned in tests/pedestrian-tunnel.test.mjs.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const LANDING = { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] }; // render-merges.spec.js reference pose
const MAX_PCT = 0.002; // render-economies.spec.js's pixel tolerance

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

async function boot(page, query = '?skip=1&buildings=baked') {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.unifiedShaftLayer && window.__ug.trainSystem?.allTrains.length > 100
      && window.__ug.modes.ctx.tubeRoutes?.size > 11
      && window.__ug.surfaceRail; // sprint 30Sep26w integration: the portals come from the surface railway
  }, null, { timeout: 180000 });
}
const dbg = (page) => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
async function enter(page) {
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}
/** In the bore at station `from` of `lineId`, at rest, facing toward station `toward`. */
const placeAt = (page, lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
  const m = window.__ug.modes.registry.get('pedestrian');
  const net = m.rebuildNetwork();
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    const st = p.stops.find(x => x.stop.name.startsWith(from));
    if (!st) continue;
    for (const dir of [1, -1]) {
      const nx = dir > 0 ? p.stations.find(x => x.s > st.s + 1e-6) : [...p.stations].reverse().find(x => x.s < st.s - 1e-6);
      if (nx && nx.name.startsWith(toward)) { m.placeInTunnel({ path: p.id, s: st.s, dir }); return { path: p.id, s: st.s, dir }; }
    }
  }
  return null;
}, [lineId, from, toward]);

// The bundled route file, read here independently of the app.
function bundledTowards(line, atName, nextName) {
  const d = JSON.parse(readFileSync(new URL(`../public/data/tfl/route-sequence/${line}.json`, import.meta.url), 'utf8'));
  const names = new Map();
  for (const sq of d.stopPointSequences) for (const sp of sq.stopPoint) names.set(sp.id, sp.name.replace(/ Underground Station$/, ''));
  const id = (n) => [...names].find(([, x]) => x === n)[0];
  const at = id(atName), next = id(nextName);
  const dest = new Set();
  for (const r of d.orderedLineRoutes) {
    const i = r.naptanIds.indexOf(at);
    if (i >= 0 && r.naptanIds[i + 1] === next) dest.add(names.get(r.naptanIds.at(-1)));
  }
  return [...dest].sort();
}

test('route data: bundled by default, the live TfL fetch only behind ?tfl=live', async ({ page }) => {
  const tfl = [];
  await page.route('https://api.tfl.gov.uk/**', async (route) => {
    // Serve the live request from the bundled copy: the test runs offline and deterministic.
    tfl.push(route.request().url());
    const m = /Line\/([^/]+)\/Route\/Sequence\/all/.exec(route.request().url());
    if (!m) return route.abort();
    const body = readFileSync(new URL(`../public/data/tfl/route-sequence/${m[1]}.json`, import.meta.url), 'utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const bundledReqs = [];
  page.on('request', r => { if (/\/data\/tfl\/route-sequence\/[a-z-]+\.json/.test(r.url())) bundledReqs.push(r.url()); });
  await boot(page);
  let stats = await page.evaluate(() => ({ ...window.__ug.tflStats, urls: undefined }));
  expect(tfl).toEqual([]);
  expect(stats.live).toBe(0);
  expect(stats.bundled).toBeGreaterThanOrEqual(12);
  expect(bundledReqs.length).toBeGreaterThanOrEqual(12);
  // The ordered routes are kept and on the mode context, with the trains.
  const ctx = await page.evaluate(() => {
    const c = window.__ug.modes.ctx;
    return { lines: [...c.tubeRoutes.keys()].sort(), victoria: c.tubeRoutes.get('victoria').orderedLineRoutes.length,
      trains: c.trainSystem === window.__ug.trainSystem };
  });
  expect(ctx.lines).toContain('victoria');
  expect(ctx.lines).toContain('dlr');
  expect(ctx.victoria).toBeGreaterThanOrEqual(2);
  expect(ctx.trains).toBe(true);

  await boot(page, '?skip=1&buildings=baked&tfl=live');
  stats = await page.evaluate(() => ({ ...window.__ug.tflStats, urls: undefined }));
  expect(stats.live).toBeGreaterThanOrEqual(12);
  expect(tfl.length).toBeGreaterThanOrEqual(12);
});

let page;
test.describe('in the tunnel', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      // Frozen, stepped app loop (render-merges.spec.js, tube-interior.spec.js).
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
    await boot(page);
    await enter(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('the shaft top: E opens "Line · towards X" rows from the bundled data; digits are the card\'s, then the modes\'', async () => {
    await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const e = m.rebuildNetwork().entrances.find(en => en.name === 'Oxford Circus');
      m.place(e.x + 10, e.z + 5, { yaw: 0 });
    });
    await expect(page.locator('#ug-mode-hint')).toContainText(/E: choose a platform at Oxford Circus/);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 30000 });
    const d = await dbg(page);
    expect(d.chooser.title).toBe('Oxford Circus');
    expect(d.chooser.rows).toEqual([
      'Bakerloo · towards Elephant & Castle', 'Bakerloo · towards Harrow & Wealdstone',
      'Central · towards Ealing Broadway or West Ruislip', 'Central · towards Epping or Hainault',
      'Victoria · towards Brixton', 'Victoria · towards Walthamstow Central',
    ]);
    // The same answers read straight from the bundled files.
    expect(bundledTowards('victoria', 'Oxford Circus', 'Green Park')).toEqual(['Brixton']);
    expect(bundledTowards('victoria', 'Oxford Circus', 'Warren Street')).toEqual(['Walthamstow Central']);
    expect(bundledTowards('bakerloo', 'Oxford Circus', 'Piccadilly Circus')).toEqual(['Elephant & Castle']);
    expect(bundledTowards('central', 'Oxford Circus', 'Tottenham Court Road')).toEqual(['Epping', 'Hainault']);
    // The card is visible, in the controls-guide style, one button per row.
    await expect(page.locator('#ug-platform-chooser')).toHaveClass(/is-open/);
    await expect(page.locator('#ug-platform-chooser button.row')).toHaveCount(6);

    // Digits while open: captured by the card (7 is out of range: nothing picked, no mode change).
    await page.keyboard.press('7');
    await page.keyboard.press('3');   // would be Drone
    let s = await dbg(page);
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('pedestrian');
    expect(s.chooser.keysCaptured).toBeGreaterThanOrEqual(2);
    // '3' picked row 3 (Central towards Ealing Broadway or West Ruislip) and the walker descends.
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel', null, { timeout: 30000 });
    s = await dbg(page);
    expect(s.tunnel.lineId).toBe('central');
    expect(s.card).toBeNull();
    // Closed: the digits switch modes again.
    await page.keyboard.press('3');
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('drone');
    await page.keyboard.press('2');
    expect(await page.evaluate(() => window.__ug.modes.activeId)).toBe('pedestrian');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
  });

  test('opening the card releases pointer lock so its rows can be clicked; a click picks', async () => {
    await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const e = m.rebuildNetwork().entrances.find(en => en.name === 'Green Park');
      m.place(e.x + 8, e.z + 4, { yaw: 0 });
    });
    // Capture the mouse the way a viewer does: click the view.
    await page.mouse.click(720, 700);
    const locked = await page.waitForFunction(() => document.pointerLockElement === window.__ug.modes.ctx.canvas, null, { timeout: 5000 })
      .then(() => true, () => false);
    test.info().annotations.push({ type: 'pointer lock', description: locked ? 'real (headless Chromium granted it)' : 'stand-in (headless refused it)' });
    console.log(`[pedestrian-tunnel] pointer lock: ${locked ? 'real' : 'stand-in'}`);
    if (!locked) {
      // Headless without pointer lock: stand in for it, so the release is still exercised.
      await page.evaluate(() => {
        const look = window.__ug.modes.ctx.look;
        let held = true;
        look.__isLocked = look.isLocked; look.__exit = look.exit;
        look.isLocked = () => held; look.exit = () => { held = false; };
      });
    }
    const before = (await dbg(page)).chooser.lockReleased;
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'shaft', null, { timeout: 30000 });
    const after = await page.evaluate(() => ({
      element: document.pointerLockElement, locked: window.__ug.modes.ctx.look.isLocked(),
      released: window.__ug.modes.registry.get('pedestrian').debug().chooser.lockReleased,
    }));
    expect(after.element).toBeNull();
    expect(after.locked).toBe(false);
    expect(after.released).toBe(before + 1);
    // A real click on a row picks it (the DOM receives clicks now).
    const rows = (await dbg(page)).chooser.detail;
    const i = rows.findIndex(r => r.lineId === 'jubilee');
    expect(i).toBeGreaterThanOrEqual(0);
    await page.locator('#ug-platform-chooser button.row').nth(i).click();
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel', null, { timeout: 30000 });
    expect((await dbg(page)).tunnel.lineId).toBe('jubilee');
    if (!locked) {
      await page.evaluate(() => { const look = window.__ug.modes.ctx.look; look.isLocked = look.__isLocked; look.exit = look.__exit; });
    }
    await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  });

  for (const [speed, keys, from, to] of [[60, ['w'], 'Oxford Circus', 'Green Park'], [200, ['w', 'shift'], 'Green Park', 'Victoria']]) {
    test(`arrival fires when crossing the platform at ${speed} m/s; the name shows and the bore opens into the platform tunnel`, async () => {
      expect(await placeAt(page, 'victoria', from, to)).not.toBeNull();
      const n0 = (await dbg(page)).arrivals.length;
      await page.evaluate((keys) => { for (const k of keys) window.__ug.fpsControls.keys.add(k); }, keys);
      // Up to speed well before the next platform (about 0.5 s), then across it.
      await page.waitForFunction((n0) => window.__ug.modes.registry.get('pedestrian').debug().arrivals.length > n0, n0, { timeout: 90000 });
      const d = await dbg(page);
      const shown = await page.evaluate(() => ({ text: document.getElementById('ug-station-banner')?.textContent,
        visible: document.getElementById('ug-station-banner')?.classList.contains('is-visible') }));
      await page.evaluate((keys) => { for (const k of keys) window.__ug.fpsControls.keys.delete(k); }, keys);
      const a = d.arrivals.at(-1);
      expect(a.name).toBe(to);
      expect(a.lineId).toBe('victoria');
      expect(a.speed).toBeCloseTo(speed, 6);   // at full walking speed: the crossing, not a stop, is the arrival
      expect(shown.text).toContain(to);   // shown in capitals by CSS
      expect(shown.visible).toBe(true);
      // The lit platform tunnel of that station is built around the walker's bore.
      expect(d.interior.platforms.map(p => p.name)).toContain(to);
      expect(d.interior.platformMeshes).toBeGreaterThanOrEqual(2);
      // Coming to rest there opens the arrival card: the street first, then the changes.
      await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
      const c = await dbg(page);
      expect(c.chooser.rows[0]).toBe('Up to the street');
      if (to === 'Green Park') {
        expect(c.chooser.rows).toEqual(expect.arrayContaining(['Jubilee · towards Stratford', 'Piccadilly · towards Cockfosters']));
      }
      await page.keyboard.press('Escape');
      expect((await dbg(page)).card).toBeNull();
    });
  }

  test('a change of line without surfacing: the card\'s row takes the walker to the other platform', async () => {
    expect(await placeAt(page, 'victoria', 'Oxford Circus', 'Green Park')).not.toBeNull();
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().arrivals.at(-1)?.name === 'Green Park', null, { timeout: 90000 });
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
    const rows = (await dbg(page)).chooser.rows;
    const i = rows.indexOf('Piccadilly · towards Cockfosters');
    expect(i).toBeGreaterThan(0);
    await page.keyboard.press(String(i + 1));
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'tunnel'
      && window.__ug.modes.registry.get('pedestrian').debug().tunnel?.lineId === 'piccadilly', null, { timeout: 30000 });
    const d = await dbg(page);
    expect(d.interior.lineId).toBe('piccadilly');
    expect(d.interior.platforms.map(p => p.name)).toContain('Green Park');
    // Never surfaced: still at platform depth, well below the street.
    const ground = await page.evaluate(() => { const c = window.__ug.camera.position; return window.__ug.modes.collision.groundHeightAt(c.x, c.z); });
    expect(d.eyeY).toBeLessThan(ground - 10 * 5);
    expect(d.phase).toBe('tunnel');
  });

  test('a train passing through never blocks or slows the walker; air rush, rumble and a shake', async () => {
    await page.mouse.click(5, 300); // a user gesture starts audio, so the mode voices have a bus
    expect(await placeAt(page, 'victoria', 'Warren Street', 'Oxford Circus')).not.toBeNull();
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const frame = () => new Promise(res => requestAnimationFrame(res));
      ug.fpsControls.keys.add('w');
      const log = [];
      let passesAtStart = m.debug().trains.passes, lastS = null, lastPath = null, maxRush = 0, maxShake = 0, maxRumble = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 120000) {
        await frame();
        const d = m.debug();
        const lv = ug.modes.sfx.levels();
        if (d.phase !== 'tunnel') break;
        log.push({ speed: d.tunnel.speed, inside: d.trains.inside, s: d.tunnel.s, path: d.tunnel.path, card: !!d.card, shake: d.shake, passT: d.passT });
        if (d.trains.inside) { maxShake = Math.max(maxShake, d.shake); maxRush = Math.max(maxRush, lv?.trainRush ?? 0); maxRumble = Math.max(maxRumble, lv?.trainRumble ?? 0); }
        if (d.trains.passes > passesAtStart && !d.trains.inside && log.filter(x => x.inside).length > 3) break;
      }
      ug.fpsControls.keys.delete('w');
      return { log, passes: m.debug().trains.passes - passesAtStart, maxRush, maxShake, maxRumble, walk: m.debug().speeds.walk };
    });
    expect(r.passes).toBeGreaterThanOrEqual(1);
    const inside = r.log.filter(x => x.inside);
    expect(inside.length).toBeGreaterThan(0);
    // Every frame inside a train: never slower than the frame before, and at the
    // full walking speed once the walk has reached it. (The walk starts from rest
    // at Warren Street: when a train happens to be dwelling there, the first
    // frames inside it are the half-second ramp up from rest, not a slowing;
    // seen when this test runs alone, fix round 2.)
    const reached = r.log.findIndex(f => f.speed === r.walk);
    expect(reached).toBeGreaterThanOrEqual(0);
    r.log.forEach((f, k) => {
      if (!f.inside) return;
      if (k > 0) expect(f.speed).toBeGreaterThanOrEqual(r.log[k - 1].speed);
      if (k >= reached) expect(f.speed).toBe(r.walk);
    });
    expect(inside.filter((f, k) => f.speed === r.walk).length).toBeGreaterThan(0);
    for (let k = 1; k < r.log.length; k++) {
      const a = r.log[k - 1], b = r.log[k];
      if (a.path === b.path && a.speed === r.walk && b.speed === r.walk) expect(Math.abs(b.s - a.s)).toBeGreaterThan(0);
    }
    expect(r.maxShake).toBeGreaterThan(0.005);
    expect(r.maxRumble).toBeGreaterThan(0.05);
    // Brief (fix round 2): 1.8 s into a pass the shake has all but gone (held
    // at most SHAKE.holdS = 1 s, then dying away with 0.25 s), however long the pass.
    for (const f of r.log) if (f.passT !== null && f.passT > 1.8) expect(f.shake).toBeLessThan(0.001);
  });

  test('a train dwelling round a walker at rest: no shake, no rumble, no rush, the view still (fix round 2)', async () => {
    // The verifier's case: arrive, come to rest on the platform, and a train of
    // that bore is standing there (about a quarter of the time): before this fix
    // the view shook at 0.012 rad and the rumble sat at its maximum for the whole
    // dwell (25 to 30 s of timetable) while the arrival card was open.
    await page.mouse.click(5, 300); // a user gesture: the mode voices have a bus
    const r = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const { pointAt } = await import('/src/modes/pedestrian-tunnels.js');
      const { trainStateAt } = await import('/src/trains.js');
      const frame = () => new Promise(res => requestAnimationFrame(res));
      const net = m.rebuildNetwork();
      // At the default 8x a dwell lasts about 3 s of real time; at 1x (the
      // slider's other end) it is the full 20 to 30 s, the verifier's case.
      const ts0 = ug.sim.timeScale;
      ug.sim.timeScale = 1;
      // A deep-tube train standing at a platform with at least 8 s of its dwell left.
      let best = null;
      for (const t of ug.trainSystem.allTrains) {
        const left = trainStateAt(t.userData, ug.trainSystem.simTime).pausedLeft;
        if (!(left > 8)) continue;
        for (const p of net.paths) {
          if (p.lineId !== t.userData.lineId) continue;
          for (const { s } of p.stops) for (const side of [1, -1]) {
            const q = pointAt(p, s, {}, side);
            const d = Math.hypot(q.x - t.position.x, q.z - t.position.z);
            if (d < 60 && (!best || d < best.d)) best = { d, path: p.id, s, side, train: t, left, lineId: p.lineId };
          }
        }
      }
      if (!best) { ug.sim.timeScale = ts0; return { error: 'no train dwelling at a platform' }; }
      m.placeInTunnel({ path: best.path, s: best.s, dir: 1, side: best.side });
      const p0 = best.train.position.clone();
      const log = [];
      let q0 = null;
      const t0 = performance.now();
      while (performance.now() - t0 < 3000) {
        await frame();
        const d = m.debug(), lv = ug.modes.sfx.levels();
        const q = ug.camera.quaternion.clone();
        log.push({ ms: performance.now() - t0, inside: d.trains.inside, shake: d.shake, rush: d.trains.rush, rumble: d.trains.rumble,
          lvRush: lv?.trainRush ?? null, lvRumble: lv?.trainRumble ?? null, speed: d.tunnel?.speed ?? null, phase: d.phase,
          moved: best.train.position.distanceTo(p0), turn: q0 ? q.angleTo(q0) : 0 });
        q0 = q;
      }
      ug.sim.timeScale = ts0;
      return { lineId: best.lineId, left: best.left, d: best.d, log };
    });
    expect(r.error).toBeUndefined();
    const still = r.log.filter(f => f.moved < 1e-6);
    // Inside it from the frame the bore's window is rebuilt round the new place on.
    const settled = still.slice(Math.max(0, still.findIndex(f => f.inside)));
    expect(settled.length).toBeGreaterThan(60);
    expect(settled.at(-1).ms).toBeGreaterThan(2500);     // the train stood round the walker throughout
    expect(settled.every(f => f.inside && f.phase === 'tunnel' && f.speed === 0)).toBe(true);
    // Not a flicker of it, from the first frame on; the sound once the voices' glide (0.06 s) has settled.
    for (const f of still) {
      expect(f.shake).toBe(0);
      expect(f.rush).toBe(0);
      expect(f.rumble).toBe(0);
      expect(f.turn).toBeLessThan(1e-6);
      if (f.ms > 500 && f.lvRumble !== null) { expect(f.lvRumble).toBeLessThan(0.005); expect(f.lvRush).toBeLessThan(0.005); }
    }
  });

  test('a portal: where the line leaves its tunnel the walk ends and the card offers the street', async () => {
    const at = await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const net = m.rebuildNetwork();
      // The Northern at Golders Green: the Hampstead tunnel's northern mouth. Sprint 30Sep26w integration: the
      // portals come from the drawn railway (Lane R's data), so a surface station's platform is a 10 m underground
      // gap between two open intervals; that gap is not a tunnel mouth, so the mouth taken here has no platform at
      // it and tunnel beyond it (round 2 took the first interval ending within 400 m of the station).
      const mouthAt = (p, s, out) => !p.stops.some(st => Math.abs(st.s - s) < 25)
        && !p.open.some(([a2, b2]) => Math.min(s, s + out) < b2 && Math.max(s, s + out) > a2);
      for (const p of net.paths) {
        if (p.lineId !== 'northern') continue;
        const gg = p.stations.find(st => /Golders Green/.test(st.name));
        if (!gg) continue;
        const ends = p.open.map(([a, b]) => [a, b]).filter(([, b]) => Math.abs(gg.s - b) < 1500 && mouthAt(p, b, 250))
          .sort((x, y) => Math.abs(gg.s - x[1]) - Math.abs(gg.s - y[1]));
        if (ends.length) {
          const [a, b] = ends[0];
          m.placeInTunnel({ path: p.id, s: b + 250, dir: -1 });
          return { path: p.id, a, b, stats: net.stats, fromStation: b - gg.s, source: net.openSource };
        }
      }
      return null;
    });
    expect(at).not.toBeNull();
    expect(at.source).toBe('track');
    expect(at.stats.portals).toBeGreaterThan(10);
    await page.evaluate(() => { window.__ug.fpsControls.keys.add('w'); window.__ug.fpsControls.keys.add('shift'); });
    await page.waitForFunction(() => !!window.__ug.modes.registry.get('pedestrian').debug().portal, null, { timeout: 60000 });
    // Keep pressing on: the walk does not go past the mouth.
    await page.waitForTimeout(1000);
    const held = await dbg(page);
    await page.evaluate(() => { window.__ug.fpsControls.keys.delete('w'); window.__ug.fpsControls.keys.delete('shift'); });
    expect(held.phase).toBe('tunnel');
    expect(held.tunnel.path).toBe(at.path);
    // Held 20 m inside the mouth (the lining runs on to the mouth itself).
    expect(held.tunnel.s).toBeCloseTo(at.b + 20, 6);
    expect(held.portal.mouthS).toBeCloseTo(at.b, 6);
    expect(held.tunnel.speed).toBe(0);
    expect(held.interior.portalAhead || held.interior.portalBehind).toBe(true);
    expect(held.interior.isolated).toBe(true); // fix round 1: the lining alone, right up to the mouth
    await expect(page.locator('#ug-mode-hint')).toContainText(/leaves its tunnel/);
    const card = await dbg(page);
    expect(card.card?.kind).toBe('portal');
    expect(card.chooser.rows).toEqual(['Up to the street', 'Back into the tunnel']);
    await page.keyboard.press('1');
    await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
    const d = await dbg(page);
    expect(d.state).toBe('ground');
    const g = await page.evaluate(([x, z]) => window.__ug.modes.collision.groundHeightAt(x, z), [d.x, d.z]);
    expect(d.y).toBeCloseTo(g, 3);
    expect(Math.hypot(d.x - held.portal.x, d.z - held.portal.z)).toBeLessThan(1);
  });

  // Sprint 30Sep26w integration: the Lane P verifier's blocking finding. The ground test found no portal on six lines
  // (the depth model draws most open-air Tube 7 to 32 m underground): Stratford to Leytonstone ended in a bore 28 m
  // deep. The portals now come from the drawn railway (Lane R's data).
  test('portals from the drawn railway: every line in the open has its mouths, and a walk out of a tunnel ends at the real one', async () => {
    const cover = await page.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const net = m.rebuildNetwork();
      const { BNG_REF_E, BNG_REF_N } = await import('/src/coordinates.js');
      const portals = {};
      for (const L of ug.surfaceRail.data.lines) portals[L.id] = L.portals.map(q => [q.e - BNG_REF_E, -(q.n - BNG_REF_N)]);
      window.__s30portals = portals;
      return { source: net.openSource, share: net.stats.openShare, unmatched: net.stats.unmatchedPaths };
    });
    expect(cover.source).toBe('track');
    expect(cover.unmatched).toBe(0);
    for (const l of ['bakerloo', 'central', 'circle', 'district', 'dlr', 'hammersmith-city', 'jubilee', 'metropolitan', 'northern', 'piccadilly']) {
      expect(cover.share[l], l).toBeGreaterThan(0.2); // 01Oct26h: 29% (Northern) to 86% (Metropolitan); the ground test gave 0% on six
    }
    expect(cover.share.victoria).toBe(0);
    expect(cover.share['waterloo-city']).toBe(0);
    for (const [lineId, from, toward, nearM] of [['central', 'Mile End', 'Stratford', 400], ['northern', 'Hampstead', 'Golders Green', 400],
      ['jubilee', 'Swiss Cottage', 'Finchley Road', 400]]) {
      expect(await placeAt(page, lineId, from, toward), `${from} toward ${toward}`).not.toBeNull();
      await page.evaluate(() => { window.__ug.fpsControls.keys.add('w'); window.__ug.fpsControls.keys.add('shift'); });
      await page.waitForFunction((t) => { const d = window.__ug.modes.registry.get('pedestrian').debug();
        return !!d.portal || d.arrivals.some(a => a.name.startsWith(t)); }, toward, { timeout: 60000 });
      await page.evaluate(() => { window.__ug.fpsControls.keys.delete('w'); window.__ug.fpsControls.keys.delete('shift'); });
      const d = await dbg(page);
      expect(d.portal, `${from} toward ${toward}: the walk ends at the mouth`).toBeTruthy();
      expect(d.arrivals.some(a => a.name.startsWith(toward)), `${toward} is in the open: never arrived at`).toBe(false);
      // The mouth (on the bore, a station-chord curve) is near one of Lane R's portal records for the line.
      const near = await page.evaluate(([l, x, z]) => Math.min(...window.__s30portals[l].map(([px, pz]) => Math.hypot(px - x, pz - z))), [lineId, d.portal.x, d.portal.z]);
      expect(near, `${from} toward ${toward}: mouth ${near.toFixed(0)} m from Lane R's portal`).toBeLessThan(nearM);
      await page.keyboard.press('Escape');
    }
  });

  // Fix round 1. The verifier found the camera unisolated within a window of
  // a portal, so the model outside was drawn inside the bore: at the District's
  // portal by Putney Bridge, where every walk there ends, a building cut into
  // the crown (4.74% of the frame), breaking the sprint 25Sep26f contract that
  // nothing but the walker's own lining is drawn inside it. The mouth is now
  // the lining's own daylight cap, and the camera stays isolated.
  test('at a tunnel mouth nothing but the interior is drawn in the bore; the mouth is daylight, under the bloom threshold', async () => {
    const mouth = (lineId, pick) => page.evaluate(([lineId, pick]) => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const net = m.rebuildNetwork();
      // Sprint 30Sep26w integration: a tunnel mouth, never a surface station's 10 m platform gap (see the portal test).
      const mouthAt = (p, s, out) => !p.stops.some(st => Math.abs(st.s - s) < 25)
        && !p.open.some(([a2, b2]) => Math.min(s, s + out) < b2 && Math.max(s, s + out) > a2);
      for (const p of net.paths) {
        if (p.lineId !== lineId) continue;
        for (const [a, b] of p.open) {
          if (!p.stations.some(st => st.name.includes(pick) && (Math.abs(st.s - a) < 1500 || Math.abs(st.s - b) < 1500))) continue;
          // The held pose: 20 m inside the mouth (PORTAL_STAND_M), facing it.
          const pos = b < p.length - 300 && mouthAt(p, b, 20) ? { path: p.id, s: b + 20, dir: -1 }
            : a > 300 && mouthAt(p, a, -20) ? { path: p.id, s: a - 20, dir: 1 } : null;
          if (!pos) continue;
          m.placeInTunnel(pos);
          return pos;
        }
      }
      return null;
    }, [lineId, pick]);
    /** Frame as drawn against the frame with everything off INTERIOR_LAYER hidden, plus the daylight in it. */
    const interiorOnly = () => page.evaluate(() => {
      const ug = window.__ug;
      window.__freeze = true;
      const drawn = window.__grab();
      const was = [];
      ug.scene.traverse(o => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !o.visible || (o.layers.mask & (1 << 7))) return;
        was.push(o); o.visible = false;
      });
      const r = ug.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      ug.composer.render(0); r.setRenderTarget(null);   // no tick: nothing re-shows what we hid
      const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      for (const o of was) o.visible = true;
      let bright = 0;
      for (let i = 0; i < drawn.b.length; i += 4) if (Math.min(drawn.b[i], drawn.b[i + 1], drawn.b[i + 2]) > 150) bright++;
      const d = window.__diff(drawn, { b, W, H });
      // Brightest linear value the scene pass writes (half-float, before tone mapping).
      const rt = ug.composer.renderTarget1;
      r.setRenderTarget(rt); r.clear(); r.render(ug.scene, ug.camera); r.setRenderTarget(null);
      const buf = new Uint16Array(4 * rt.width * rt.height);
      r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
      const h2f = h => { const e = (h >> 10) & 0x1f, f = h & 0x3ff, s = (h & 0x8000) ? -1 : 1;
        return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024); };
      let max = 0, nonFinite = 0;
      for (let i = 0; i < buf.length; i++) { if (i % 4 === 3) continue; const v = h2f(buf[i]); if (!Number.isFinite(v)) nonFinite++; else if (v > max) max = v; }
      window.__thaw();
      return { ...d, hidden: was.length, brightPct: bright / (W * H) * 100, max, nonFinite, mask: ug.camera.layers.mask };
    });
    // Control: with the view unisolated (the defect as found) the check sees the model in the bore.
    // Sprint 30Sep26w integration: round 2's control pose was the District's "mouth" on the Fulham railway bridge,
    // found by the ground test, which the verifier showed is not a portal. The portals now come from the drawn
    // railway, and at a real mouth drawn deep in the ground nothing reaches into the bore, so the control takes the
    // first of these mouths where something does; that mouth is then checked isolated with the others below.
    const candidates = [['district', 'Putney'], ['northern', 'Golders Green'], ['dlr', 'Shadwell'], ['dlr', 'Cutty Sark'],
      ['dlr', 'Island Gardens'], ['metropolitan', 'Finchley Road'], ['central', 'Stratford'], ['bakerloo', 'Queen']];
    await page.evaluate(() => {
      const ti = window.__ug.modes.ctx.tubeInterior;
      ti.__show = ti.show; ti.show = (net, pos) => ti.__show(net, pos, { isolate: false });
    });
    let control = null, controlAt = null;
    const tried = [];
    for (const c of candidates) {
      if (!(await mouth(...c))) { tried.push([c[1], null]); continue; }
      await page.waitForTimeout(800);
      const r = await interiorOnly();
      tried.push([c[1], +r.pct.toFixed(2)]);
      if (r.pct > 1) { control = r; controlAt = c; break; }
    }
    await page.evaluate(() => { const ti = window.__ug.modes.ctx.tubeInterior; ti.show = ti.__show; delete ti.__show; });
    console.log('mouth control', JSON.stringify(tried));
    expect(control?.pct, `control must detect foreign geometry at a mouth: ${JSON.stringify(tried)}`).toBeGreaterThan(1);
    const checked = [['district', 'Putney'], ['northern', 'Golders Green']];
    if (!checked.some(([l, p]) => l === controlAt[0] && p === controlAt[1])) checked.push(controlAt);
    for (const [lineId, pick] of checked) {
      expect(await mouth(lineId, pick), pick).not.toBeNull();
      await page.waitForTimeout(800);
      const d = await dbg(page);
      expect(d.interior.portalAhead || d.interior.portalBehind, pick).toBe(true);
      expect(d.interior.isolated, pick).toBe(true);
      const arc = d.interior.mouth.end ?? d.interior.mouth.start;
      expect(Math.abs(Math.abs(arc) - 20), `${pick}: the mouth 20 m ahead, ${JSON.stringify(d.interior.mouth)}`).toBeLessThan(1);
      const r = await interiorOnly();
      expect(r.mask, pick).toBe(1 << 7);
      expect(r.hidden, pick).toBeGreaterThan(100);
      expect(r.pct, `${pick}: ${JSON.stringify({ ...r, b: undefined })}`).toBeLessThanOrEqual(0.5);
      // The mouth is daylight ahead (the sky colour most of the way to white), never a white-out.
      expect(r.brightPct, pick).toBeGreaterThan(1);
      expect(r.nonFinite, pick).toBe(0);
      expect(r.max, pick).toBeLessThanOrEqual(1.0);
    }
  });

  test('another mode\'s picture is unchanged: Deity at the reference pose, before and after a trip down the tunnel', async () => {
    // Deity at the reference pose with the network still (sim paused), before the trip.
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    const r1 = await page.evaluate(async (pose) => {
      window.__ug.sim.paused = true;
      await window.__place(pose);
      window.__before = window.__grab();
      const again = window.__grab();
      window.__thaw();
      return window.__diff(window.__before, again);
    }, LANDING);
    expect(r1.px).toBe(0); // the frozen frame is stable (noise floor)
    // The trip: down at a platform, the platform tunnel and the line's trains
    // lifted onto the interior layer, a walk, the card opened and closed.
    await enter(page);
    expect(await placeAt(page, 'victoria', 'Oxford Circus', 'Green Park')).not.toBeNull();
    await page.evaluate(() => window.__ug.fpsControls.keys.add('w'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__ug.fpsControls.keys.delete('w'));
    const inside = await dbg(page);
    expect(inside.trains.meshes).toBeGreaterThan(0);
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    // Nothing the tunnel drew is left for any other camera.
    const left = await page.evaluate(() => {
      const ug = window.__ug;
      let lifted = 0, shown = 0;
      ug.scene.traverse(o => {
        if (!o.layers.isEnabled(7)) return;
        let visible = true;
        for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
        if (visible && (o.isMesh || o.isInstancedMesh)) shown++;
        if (/^train-batch/.test(o.name) || /^train-/.test(o.parent?.name ?? '')) lifted++;
      });
      return { mode: ug.modes.activeId, mask: ug.camera.layers.mask, lifted, shown,
        card: document.getElementById('ug-platform-chooser').classList.contains('is-open') };
    });
    expect(left).toEqual({ mode: 'deity', mask: 1, lifted: 0, shown: 0, card: false });
    const r2 = await page.evaluate(async (pose) => {
      await window.__place(pose);
      const b = window.__grab();
      const out = window.__diff(window.__before, b);
      window.__thaw();
      window.__ug.sim.paused = false;
      return out;
    }, LANDING);
    expect(r2.pct, JSON.stringify(r2)).toBeLessThanOrEqual(MAX_PCT);
  });
});
