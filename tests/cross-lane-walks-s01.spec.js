// cross-lane-walks-s01.spec.js: the integration's walk checks for sprint 01Oct26h
// (D-042 item 1, D-043 item 4). Lane P's walk rides lane T's mapping of lane R's
// new open-air track; each lane was verified alone, and this spec walks the
// seams on the merged build, in the real app, in Pedestrian mode.
//
// Routes, Shift held (200 m/s), facing each branch wanted before its junction:
//   Jubilee        Swiss Cottage -> Stanmore: open air through West Hampstead (R dropped
//                  the 227 m stub), no bore frame between Finchley Road and Kilburn, and
//                  the Jubilee trains about West Hampstead drawn whole
//   Central        White City -> North Acton -> West Acton -> Ealing Broadway (R's new track)
//   Central        Leytonstone -> round the Hainault loop -> Woodford (R's new track from Newbury Park)
//   Metropolitan   Harrow-on-the-Hill -> West Harrow -> Rayners Lane (R's new track)
//   Metropolitan   Harrow-on-the-Hill -> Rickmansworth -> held at the map edge
//   Central        Woodford -> Theydon Bois -> held at the map edge (Epping lies beyond it)
//   Northern       Hampstead -> Edgware
//   DLR            Bank -> Lewisham
// Per route it records whether the walker stayed on the drawn track, the stops arrived at in
// order, and every stretch between two stops walked in the bore (with the line's refused
// intervals from the mapping report, which keep the walker in the bore by rule), and prints
// one JSON line per route ("[walk] ..."). The bounds are lane P's own (tests/pedestrian-open-air.spec.js):
// above the terrain, within lane + extra + 1 m of the drawn track wherever lane T's run is on it,
// lane T's fairings and junction hops within TRACK_SLACK_M, and at least 90% of open frames on the run.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

const VE = 5;
const TRACK_SLACK_M = 30;   // as tests/pedestrian-open-air.spec.js
let page;
const consoleErrors = [];

async function boot() {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.modes.ctx.tubeRoutes?.size > 11
      && window.__ug.surfaceRail && window.__ug.surfaceTrains;
  }, null, { timeout: 180000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}

/** The walker at a platform of `from` on `lineId`, at rest, facing toward `toward`. */
const placeAt = (lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
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

/** Walk until `until` is arrived at, or the walk holds at the map edge, or maxMs; every frame measured in the page. */
function ride({ lineId, until = null, keys = ['w', 'shift'], maxMs = 110000, via = null }) {
  return page.evaluate(async ({ lineId, until, keys, maxMs, via }) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const { distanceToDrawn, buildSegmentIndex } = await import('/src/surface-train-map.js');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const net = m.network, st = ug.surfaceTrains;
    const tn = st.networkFor(lineId), idx = tn.index || buildSegmentIndex(tn.net);
    const c0 = m.debug().clock;
    const since = (d) => d.arrivals.filter(a => a.at > c0);
    const is = (name, want) => name === want || name.replace(/\s*\(.*\)$/, '') === want;
    const posOf = (name) => net.entrances.filter(en => is(en.name, name) && en.stops.some(x => x.lineId === lineId));
    const frames = [];
    for (const k of keys) ug.fpsControls.keys.add(k);
    const t0 = performance.now();
    let vi = 0;
    try {
      while (performance.now() - t0 < maxMs) {
        if (via) {
          const d0 = m.debug(), c = ug.camera.position;
          while (vi < via.length && since(d0).some(a => is(a.name, via[vi]))) vi++;
          let e = null;
          for (let k = vi; k < via.length && !e; k++) {
            const best = posOf(via[k]).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
            if (best && Math.hypot(best.x - c.x, best.z - c.z) > 150) e = best;
          }
          if (e) { const want = Math.atan2(-(e.x - c.x), -(e.z - c.z)); m.turn(Math.atan2(Math.sin(want - d0.yaw), Math.cos(want - d0.yaw)), 0); }
        }
        await frame();
        const d = m.debug(), c = ug.camera.position;
        const f = { clock: d.clock, phase: d.phase, regime: d.regime, path: d.tunnel?.path ?? null, s: d.tunnel?.s ?? null,
          speed: d.tunnel?.speed ?? null, x: c.x, y: c.y, z: c.z, g: ug.modes.ctx.getTerrainY(c.x, c.z),
          interior: d.interior.visible, edge: d.atEdge, arrivals: since(d).length };
        if (d.regime === 'open' && d.shown) {
          f.extra = d.shown.extra; f.bridged = !!d.shown.bridged;
          f.dTrack = distanceToDrawn(tn.net, idx, c.x, c.z, 200);
          const q = m.openAir.present(net.paths[d.tunnel.path], d.tunnel.s, 0, {});
          f.runOff = q.mapped ? distanceToDrawn(tn.net, idx, q.x, q.z, 200) : null;
        }
        frames.push(f);
        if (d.phase !== 'tunnel') break;
        if (until && since(d).some(a => is(a.name, until))) break;
        if (!until && d.atEdge && d.tunnel.speed === 0) break;
      }
    } finally {
      for (const k of keys) ug.fpsControls.keys.delete(k);
    }
    const d = m.debug();
    const rep = m.openAirReport().lines[lineId] || {};
    return { frames, arrivals: since(d).map(a => ({ name: a.name, regime: a.regime })), ratio: st.ratio,
      end: { regime: d.regime, atEdge: d.atEdge, hint: document.getElementById('ug-mode-hint')?.textContent ?? '' },
      refused: (rep.refused || []).map(x => `${x.from.replace(/ (Underground|DLR) Station/, '')} - ${x.to.replace(/ (Underground|DLR) Station/, '')}`) };
  }, { lineId, until, keys, maxMs, via });
}

const strip = (n) => n.replace(/\s*\(.*\)$/, '');

/** The route's record: drawn-track adherence, stops in order, and the stretches between stops walked in the bore. */
function summarise(label, r, expected) {
  const open = r.frames.filter(f => f.regime === 'open' && f.phase === 'tunnel');
  let above = 0, onRun = 0, within = 0, inSlack = 0, bridged = 0, maxD = 0, interior = 0;
  for (const f of open) {
    if (f.y >= f.g + 0.5 * VE * r.ratio - 1e-6) above++;
    if (f.interior) interior++;
    if (f.bridged) { bridged++; continue; }
    const lim = 2.6 + (f.extra || 0) + 1;
    maxD = Math.max(maxD, f.dTrack);
    if (f.dTrack <= lim + TRACK_SLACK_M) inSlack++;
    if (f.runOff !== null && f.runOff <= 0.5) { onRun++; if (f.dTrack <= lim) within++; }
  }
  const names = r.arrivals.map(a => strip(a.name));
  // Stretches between consecutive stops (from the start to the first stop too), by regime of the frames walked.
  const stretches = [];
  const stops = ['(start)', ...names];
  for (let i = 0; i < stops.length - 1; i++) {
    const fr = r.frames.filter(f => f.arrivals === i && f.phase === 'tunnel');
    const b = fr.filter(f => f.regime === 'bore').length, o = fr.filter(f => f.regime === 'open').length;
    stretches.push({ from: stops[i], to: stops[i + 1], bore: b, open: o });
  }
  const borne = stretches.filter(s => s.bore > 0 && s.open === 0).map(s => `${s.from} - ${s.to}`);
  const mixed = stretches.filter(s => s.bore > 0 && s.open > 0).map(s => `${s.from} - ${s.to}`);
  const out = {
    route: label, inOrder: JSON.stringify(names) === JSON.stringify(expected), arrived: names, expected,
    frames: r.frames.length, openFrames: open.length, bridged, aboveTerrain: open.length ? +(above / open.length).toFixed(4) : null,
    onRun: open.length ? +(onRun / open.length).toFixed(4) : null, inLaneWhereOnRun: onRun ? +(within / onRun).toFixed(4) : null,
    withinSlack: open.length - bridged ? +(inSlack / (open.length - bridged)).toFixed(4) : null, maxOffDrawnM: +maxD.toFixed(1),
    liningInOpen: interior, boreOnlyStretches: borne, boreAndOpenStretches: mixed, end: r.end, refusedOnLine: r.refused,
  };
  console.log('[walk]', JSON.stringify(out));
  return out;
}

function checkRoute(s) {
  expect(s.arrived, `${s.route}: stops in order`).toEqual(s.expected);
  expect(s.openFrames, `${s.route}: shown on the drawn track`).toBeGreaterThan(30);
  expect(s.aboveTerrain, `${s.route}: above the terrain`).toBe(1);
  expect(s.liningInOpen, `${s.route}: no lining in the open`).toBe(0);
  expect(s.withinSlack, `${s.route}: near the drawn track`).toBe(1);
  expect(s.onRun, `${s.route}: most of the walk on the drawn track itself`).toBeGreaterThan(0.9);
  expect(s.inLaneWhereOnRun, `${s.route}: in its lane wherever lane T's run is on the drawn track`).toBe(1);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await boot();
});
test.afterAll(async () => { await page?.close(); });

test('boot: no mergeGeometries or Object3D.add console errors (lanes R and M removed the 129 inherited ones)', async () => {
  console.log('[walk] console errors at boot', JSON.stringify({ count: consoleErrors.length, first: consoleErrors.slice(0, 5) }));
  expect(consoleErrors.filter(e => /mergeGeometries/.test(e))).toEqual([]);
  expect(consoleErrors.filter(e => /Object3D\.add/.test(e))).toEqual([]);
});

test('Jubilee, Swiss Cottage to Stanmore: open air through West Hampstead, no bore between Finchley Road and Kilburn, its trains whole', async () => {
  expect(await placeAt('jubilee', 'Swiss Cottage', 'Finchley Road')).not.toBeNull();
  const r = await ride({ lineId: 'jubilee', until: 'Stanmore' });
  const expected = ['Finchley Road', 'West Hampstead', 'Kilburn', 'Willesden Green', 'Dollis Hill', 'Neasden', 'Wembley Park', 'Kingsbury', 'Queensbury', 'Canons Park', 'Stanmore'];
  const s = summarise('Jubilee Swiss Cottage - Stanmore', r, expected);
  checkRoute(s);
  const i0 = r.arrivals.findIndex(a => a.name === 'Finchley Road') + 1, i1 = r.arrivals.findIndex(a => a.name === 'Kilburn') + 1;
  const between = r.frames.filter(f => f.arrivals >= i0 && f.arrivals < i1 && f.phase === 'tunnel');
  expect(between.length).toBeGreaterThan(0);
  expect(between.filter(f => f.regime === 'bore').length, 'no bore frame between Finchley Road and Kilburn').toBe(0);
  expect(r.arrivals.find(a => a.name === 'West Hampstead').regime).toBe('open');
  // The Jubilee trains about West Hampstead, every 2 s over 20 minutes of the timetable from now: drawn whole.
  const w = await page.evaluate(() => {
    const u = window.__ug, st = u.surfaceTrains;
    const line = u.surfaceRail.data.lines.find(l => l.id === 'jubilee');
    const s = line.stations.find(q => q.name.startsWith('West Hampstead')), c = u.llToXZ(s.lat, s.lon);
    const total = st.stockOf.get('jubilee').layout.length, t0 = u.trainSystem.simTime;
    let sightings = 0, whole = 0; const part = [];
    for (let t = t0; t <= t0 + 1200; t += 2) {
      for (const [id, tr] of Object.entries(st.snapshot(t, { lineId: 'jubilee' }))) {
        if (!tr.cars.some(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z) < 600)) continue;
        sightings++;
        if (tr.cars.length === total) whole++; else if (part.length < 5) part.push({ t: +(t - t0).toFixed(0), id, cars: tr.cars.length });
      }
    }
    return { sightings, whole, part };
  });
  console.log('[walk] West Hampstead Jubilee trains', JSON.stringify(w));
  expect(w.sightings).toBeGreaterThan(50);
  expect(w.part).toEqual([]);
});

test('Central, White City to Ealing Broadway: on R\'s new track through West Acton', async () => {
  expect(await placeAt('central', 'White City', 'East Acton')).not.toBeNull();
  const expected = ['East Acton', 'North Acton', 'West Acton', 'Ealing Broadway'];
  const r = await ride({ lineId: 'central', until: 'Ealing Broadway', via: expected });
  checkRoute(summarise('Central White City - Ealing Broadway', r, expected));
});

test('Central, Leytonstone round the Hainault loop to Woodford', async () => {
  expect(await placeAt('central', 'Leytonstone', 'Wanstead')).not.toBeNull();
  const expected = ['Wanstead', 'Redbridge', 'Gants Hill', 'Newbury Park', 'Barkingside', 'Fairlop', 'Hainault', 'Grange Hill', 'Chigwell', 'Roding Valley', 'Woodford'];
  const r = await ride({ lineId: 'central', until: 'Woodford', via: expected });
  const s = summarise('Central Hainault loop Leytonstone - Woodford', r, expected);
  checkRoute(s);
  // Wanstead, Redbridge and Gants Hill are in tunnel; the loop is in the open from Newbury Park.
  expect(r.arrivals.find(a => a.name === 'Redbridge').regime).toBe('bore');
  for (const n of ['Barkingside', 'Fairlop', 'Hainault']) expect(r.arrivals.find(a => a.name === n).regime, n).toBe('open');
});

test('Metropolitan, Harrow-on-the-Hill to Rayners Lane: on R\'s new track through West Harrow', async () => {
  expect(await placeAt('metropolitan', 'Harrow-on-the-Hill', 'West Harrow')).not.toBeNull();
  const expected = ['West Harrow', 'Rayners Lane'];
  const r = await ride({ lineId: 'metropolitan', until: 'Rayners Lane', via: expected });
  checkRoute(summarise('Metropolitan Harrow-on-the-Hill - Rayners Lane', r, expected));
});

test('Metropolitan, Harrow-on-the-Hill to Rickmansworth and the map edge', async () => {
  expect(await placeAt('metropolitan', 'Harrow-on-the-Hill', 'North Harrow')).not.toBeNull();
  const expected = ['North Harrow', 'Pinner', 'Northwood Hills', 'Northwood', 'Moor Park', 'Rickmansworth'];
  const r = await ride({ lineId: 'metropolitan', via: expected });
  checkRoute(summarise('Metropolitan Harrow-on-the-Hill - Rickmansworth - edge', r, expected));
  expect(r.end.atEdge).toBe(true);
  expect(r.end.hint).toContain('The map ends here');
});

test('Central, Woodford to Theydon Bois and the map edge', async () => {
  expect(await placeAt('central', 'Woodford', 'Buckhurst Hill')).not.toBeNull();
  const expected = ['Buckhurst Hill', 'Loughton', 'Debden', 'Theydon Bois'];
  const r = await ride({ lineId: 'central', via: expected });
  checkRoute(summarise('Central Woodford - Theydon Bois - edge', r, expected));
  expect(r.end.atEdge).toBe(true);
  expect(r.end.hint).toContain('The map ends here');
});

test('Northern, Hampstead to Edgware', async () => {
  expect(await placeAt('northern', 'Hampstead', 'Golders Green')).not.toBeNull();
  const expected = ['Golders Green', 'Brent Cross', 'Hendon Central', 'Colindale', 'Burnt Oak', 'Edgware'];
  const r = await ride({ lineId: 'northern', until: 'Edgware' });
  checkRoute(summarise('Northern Hampstead - Edgware', r, expected));
});

test('DLR, Bank to Lewisham', async () => {
  expect(await placeAt('dlr', 'Bank', 'Shadwell')).not.toBeNull();
  const expected = ['Shadwell', 'Limehouse', 'Westferry', 'West India Quay', 'Canary Wharf', 'Heron Quays', 'South Quay', 'Crossharbour',
    'Mudchute', 'Island Gardens', 'Cutty Sark', 'Greenwich', 'Deptford Bridge', 'Elverson Road', 'Lewisham'];
  const r = await ride({ lineId: 'dlr', until: 'Lewisham', via: expected });
  checkRoute(summarise('DLR Bank - Lewisham', r, expected));
});
