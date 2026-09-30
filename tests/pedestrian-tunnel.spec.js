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
//   * a train passing through never blocks or slows the walker;
//   * digit keys pick rows while the card is open, and switch modes when it is
//     closed; opening the card releases pointer lock;
//   * a portal ends the walk and offers the street;
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
      && window.__ug.modes.ctx.tubeRoutes?.size > 11;
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
        log.push({ speed: d.tunnel.speed, inside: d.trains.inside, s: d.tunnel.s, path: d.tunnel.path, card: !!d.card });
        if (d.trains.inside) { maxShake = Math.max(maxShake, d.shake); maxRush = Math.max(maxRush, lv?.trainRush ?? 0); maxRumble = Math.max(maxRumble, lv?.trainRumble ?? 0); }
        if (d.trains.passes > passesAtStart && !d.trains.inside && log.filter(x => x.inside).length > 3) break;
      }
      ug.fpsControls.keys.delete('w');
      return { log, passes: m.debug().trains.passes - passesAtStart, maxRush, maxShake, maxRumble, walk: m.debug().speeds.walk };
    });
    expect(r.passes).toBeGreaterThanOrEqual(1);
    const inside = r.log.filter(x => x.inside);
    expect(inside.length).toBeGreaterThan(0);
    // Every frame inside a train: still at the full walking speed, still moving.
    for (const f of inside) expect(f.speed).toBe(r.walk);
    for (let k = 1; k < r.log.length; k++) {
      const a = r.log[k - 1], b = r.log[k];
      if (a.path === b.path && a.speed === r.walk && b.speed === r.walk) expect(Math.abs(b.s - a.s)).toBeGreaterThan(0);
    }
    expect(r.maxShake).toBeGreaterThan(0.005);
    expect(r.maxRumble).toBeGreaterThan(0.05);
  });

  test('a portal: where the line leaves its tunnel the walk ends and the card offers the street', async () => {
    const at = await page.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian');
      const net = m.rebuildNetwork();
      // The Northern at Golders Green, found geometrically (the track reaching the ground).
      for (const p of net.paths) {
        if (p.lineId !== 'northern') continue;
        for (const [a, b] of p.open) {
          const gg = p.stations.find(st => /Golders Green/.test(st.name));
          if (gg && Math.abs(gg.s - b) < 400) {
            m.placeInTunnel({ path: p.id, s: b + 250, dir: -1 });
            return { path: p.id, a, b, stats: net.stats };
          }
        }
      }
      return null;
    });
    expect(at).not.toBeNull();
    expect(at.stats.portals).toBeGreaterThan(10);
    await page.evaluate(() => { window.__ug.fpsControls.keys.add('w'); window.__ug.fpsControls.keys.add('shift'); });
    await page.waitForFunction(() => !!window.__ug.modes.registry.get('pedestrian').debug().portal, null, { timeout: 60000 });
    // Keep pressing on: the walk does not go past the mouth.
    await page.waitForTimeout(1000);
    const held = await dbg(page);
    await page.evaluate(() => { window.__ug.fpsControls.keys.delete('w'); window.__ug.fpsControls.keys.delete('shift'); });
    expect(held.phase).toBe('tunnel');
    expect(held.tunnel.path).toBe(at.path);
    expect(held.tunnel.s).toBeCloseTo(at.b, 6);
    expect(held.tunnel.speed).toBe(0);
    expect(held.interior.portalAhead || held.interior.portalBehind).toBe(true);
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
