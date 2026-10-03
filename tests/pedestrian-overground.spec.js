// pedestrian-overground.spec.js: the Pedestrian walk on the London Overground, in the real app (sprint
// 02Oct26f, lane O, D-048 item 5).
//
// Jordan (D-048 item 5): "The Pedestrian walk is extended to the Overground, as its own lane: all six lines join
// the walk network, every Overground station is a stop, with changes to and from the Tube and DLR at
// interchanges, riding on the drawn track with the open-air machinery; Overground tunnels walked in first
// person in the bore at today's single 20 m depth."
//
// Routes (Shift, 200 m/s; each leg 90 s or less; each starts at rest on its `from` stop and the next carries on):
//   Weaver     London Liverpool Street -> Seven Sisters -> Enfield Town
//   Windrush   Dalston Junction -> New Cross Gate, through the Thames Tunnel IN THE BORE (Wapping to Rotherhithe)
//   Mildmay    Stratford -> Highbury & Islington
//   Suffragette  Gospel Oak -> Blackhorse Road -> Barking Riverside
//   Lioness    London Euston -> Willesden Junction -> Harrow & Wealdstone
//   Liberty    Romford -> Upminster (the first 20 s at 60 m/s)
// On every leg the arrivals are the line's stations in order, every open frame is at least terrain + 0.5 m x VE and
// within lane + 1 m of the drawn track (the frames beside an off-track site, and the junction hops between two drawn
// pieces, bounded separately), speed is 60 +/- 2 and 200 +/- 6 m/s along the track, tunnel stretches are walked in the
// bore with the lining at today's 20 m depth, and the walk never stops between stations.
// Then: the changes (Highbury & Islington, Stratford, Whitechapel, Canada Water), "towards" text, an Overground train
// passing through the walker, Master independence (D-039), lazy mapping, and the network's coverage and interchanges.
// Pins are floors and behaviours, never counts: Lane T extends the Weaver to Cheshunt in parallel.

import { test, expect } from '@playwright/test';

// Not serial: one failing leg does not hide the others. Every test sets its own state up on the shared page.
test.setTimeout(240000);

const VE = 5;
const TRACK_LANE_M = 3.6;           // the lane (2.6 m) and a metre
let page;
const consoleErrors = [], pageErrors = [];
const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());

async function boot() {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.goto('/?skip=1&buildings=baked&mh=1.1');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.modes.ctx.tubeRoutes?.size > 11
      && window.__ug.surfaceRail && window.__ug.surfaceTrains
      && window.__ug.overground?.userData?.linePaths?.size === 6 && window.__ug.modes.ctx.tubeRoutes.has('og:weaver');
  }, null, { timeout: 180000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}

/**
 * Place the walker at rest at the stop of `lineId` named `from`, facing toward `toward` (the next expected station): the path and
 * sense are the ones whose heading there has the best positive dot product with the plan direction to that station's entrance.
 */
const placeAt = (lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
  const m = window.__ug.modes.registry.get('pedestrian');
  const net = m.rebuildNetwork();
  m.openAir.ensureLine(net, lineId);
  const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '').replace(/ Station$/, '');
  const target = net.entrances.filter(en => en.names.includes(toward) && en.stops.some(x => x.lineId === lineId));
  let best = null;
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    for (const { s, stop } of p.stops) {
      if (clean(stop.name) !== from) continue;
      for (const dir of [1, -1]) {
        if (dir > 0 ? s >= p.length - 1e-6 : s <= 1e-6) continue;
        const h = m.openAir.headingOf(p, s, dir), q = m.openAir.present(p, s, 0, {});
        for (const en of target) {
          const l = Math.hypot(en.x - q.x, en.z - q.z) || 1, dot = (h.x * (en.x - q.x) + h.z * (en.z - q.z)) / l;
          if (!best || dot > best.dot) best = { path: p.id, s, dir, dot };
        }
      }
    }
  }
  if (!best || best.dot <= 0) return null;
  m.placeInTunnel({ path: best.path, s: best.s, dir: best.dir });
  return { path: best.path, s: best.s, dir: best.dir };
}, [lineId, from, toward]);

/**
 * Walk with the given keys until `until` is arrived at (by name), or maxMs. The walker faces the first station of `via`
 * still not arrived at and more than 150 m away (a viewer faces the branch they want before a fork). Every frame is
 * measured in the page.
 */
function ride({ lineId, until = null, keys = ['w', 'shift'], maxMs = 90000, via = null, stopSpeedAtEnd = false }) {
  return page.evaluate(async ({ lineId, until, keys, maxMs, via }) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const { sampleM25Insideness } = await import('/src/m25.js');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const net = m.network;
    const flare = document.getElementById('ug-portal-flare');
    const c0 = m.debug().clock;
    const since = (d) => d.arrivals.filter(a => a.at > c0);
    const posOf = (name) => net.entrances.filter(en => en.names.includes(name) && en.stops.some(x => x.lineId === lineId));
    const frames = [];
    for (const k of keys) ug.fpsControls.keys.add(k);
    const t0 = performance.now();
    let vi = 0;
    // The budget is the mode clock (a leg of 90 s or less of walking); the wall clock only guards a stalled page (a loaded GPU
    // draws fewer frames a second, and the walk's own step is per frame).
    try {
      while (performance.now() - t0 < maxMs * 2 && m.debug().clock - c0 < maxMs / 1000) {
        if (via) {
          const d0 = m.debug(), c = ug.camera.position;
          while (vi < via.length && since(d0).some(a => a.name === via[vi])) vi++;
          let e = null;
          for (let k = vi; k < via.length && !e; k++) {
            const best = posOf(via[k]).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
            if (best && Math.hypot(best.x - c.x, best.z - c.z) > 150) e = best;
          }
          if (e) { const want = Math.atan2(-(e.x - c.x), -(e.z - c.z)); m.turn(Math.atan2(Math.sin(want - d0.yaw), Math.cos(want - d0.yaw)), 0); }
        }
        await frame();
        const d = m.debug(), c = ug.camera.position;
        const w = ug.modes.ctx.waterSurfaceAt?.(c.x, c.z);
        frames.push({ clock: d.clock, phase: d.phase, regime: d.regime, path: d.tunnel?.path ?? null, s: d.tunnel?.s ?? null, lineId: d.tunnel?.lineId ?? null,
          speed: d.tunnel?.speed ?? null, x: c.x, y: c.y, z: c.z, g: ug.modes.ctx.getTerrainY(c.x, c.z), water: Number.isFinite(w) ? w : null,
          inside: sampleM25Insideness(c.x, c.z), above: ug.aboveGroundView, cut: d.openAir.cut?.kind ?? null,
          flare: +getComputedStyle(flare).opacity, card: d.card?.kind ?? null, edge: d.atEdge, interior: d.interior.visible,
          hint: document.getElementById('ug-mode-hint')?.textContent ?? '', arrivals: since(d).length, bridged: !!d.shown?.bridged,
          // metres of path arc to the nearest mouth of an open stretch (the drawn tunnel ramps down over its first 40 m or so)
          portal: d.tunnel && d.open ? Math.min(Infinity, ...d.open.flatMap(([a, b]) => [Math.abs(d.tunnel.s - a), Math.abs(d.tunnel.s - b)])) : null });
        if (d.phase !== 'tunnel') break;
        if (until && since(d).some(a => a.name === until)) break;
        if (d.atEdge && d.tunnel.speed === 0) break;
      }
    } finally { for (const k of keys) ug.fpsControls.keys.delete(k); }
    const d = m.debug();
    return { frames, arrivals: since(d), cuts: d.openAir.cuts, ratio: ug.surfaceTrains.ratio, wallMs: performance.now() - t0, modeS: d.clock - c0,
      end: { tunnel: d.tunnel, regime: d.regime, card: d.card, hint: document.getElementById('ug-mode-hint')?.textContent ?? '' } };
  }, { lineId, until, keys, maxMs, via });
}

/** For each given (x, z): the plan distance to the line's drawn track, the deck height and the class there (acceptance D, deckY, clsAt). */
const nearDrawn = (line, pts) => page.evaluate(([line, pts]) => {
  const pieces = window.__ug.overground.userData.linePaths.get(line.replace(/^og:/, '')).filter(Boolean);
  return pts.map(([x, z]) => {
    let best = { d: Infinity, y: 0, cls: null };
    for (const P of pieces) {
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
        t = Math.min(1, Math.max(0, t));
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d < best.d) best = { d, y: a.y + (b.y - a.y) * t, cls: t < 0.5 ? a.cls : b.cls };
      }
    }
    return best;
  });
}, [line, pts]);

/** Plan speed over windows of >= 0.5 s of the mode clock, only where every frame is open, at the given speed, with no cut. */
function speeds(r, speed) {
  const L = r.frames, out = [];
  for (let i = 0; i < L.length; i++) {
    let j = i; while (j < L.length && L[j].clock - L[i].clock < 0.5) j++;
    if (j >= L.length) break;
    const seg = L.slice(i, j + 1);
    if (seg.some(f => f.regime !== 'open' || f.speed !== speed || f.cut || f.bridged)) continue;
    let d = 0, jump = false;
    for (let k = 1; k < seg.length; k++) {
      const dd = Math.hypot(seg[k].x - seg[k - 1].x, seg[k].z - seg[k - 1].z);
      if (dd > 3 * speed * (seg[k].clock - seg[k - 1].clock) + 1 || seg[k].path !== seg[k - 1].path) jump = true;
      d += dd;
    }
    if (jump) continue;
    out.push(d / (seg.at(-1).clock - seg[0].clock));
    i = j - 1;
  }
  return out.sort((a, b) => a - b);
}
const median = (a) => a[a.length >> 1];

/** Sites of the line's stations that lie more than 15 m off the drawn track (acceptance: off-track), with their offset. */
const offTrackSites = (line) => page.evaluate((line) => {
  line = line.replace(/^og:/, '');
  const g = window.__ug.overground.userData, pieces = g.linePaths.get(line).filter(Boolean);
  const set = g.stationSets.find(s => s.id === line);
  const near = (x, z) => { let b = Infinity; for (const P of pieces) for (let i = 0; i + 1 < P.length; i++) { const a = P[i], c = P[i + 1], dx = c.x - a.x, dz = c.z - a.z, L2 = dx * dx + dz * dz; let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0; t = Math.min(1, Math.max(0, t)); b = Math.min(b, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))); } return b; };
  return set.stations.map(s => ({ name: s.name, x: s.pos.x, z: s.pos.z, off: near(s.pos.x, s.pos.z) })).filter(s => s.off > 15);
}, line);

/** The checks on every open frame of a leg (O-RTE-b); returns counts. */
async function checkLeg(r, line, label, { slack = true } = {}) {
  const open = r.frames.filter(f => f.regime === 'open' && f.phase === 'tunnel');
  const near = await nearDrawn(line, open.map(f => [f.x, f.z]));
  const sites = await offTrackSites(line);
  let hops = 0;
  const high = [];   // frames with the eye more than 3 m above the nearest drawn deck, within the lane
  open.forEach((f, i) => {
    expect(f.y, `${label}: above the terrain at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeGreaterThanOrEqual(f.g + 0.5 * VE * r.ratio - 1e-6);
    if (f.inside >= 0.999) expect(f.above, `${label}: the D-040 cull holds at insideness ${f.inside}`).toBe(true);
    expect(f.interior, `${label}: no lining in the open`).toBe(false);
    const exempt = sites.some(s => Math.hypot(f.x - s.x, f.z - s.z) <= s.off + 10);
    const n = near[i];
    if (!exempt) {
      if (n.d > TRACK_LANE_M) { hops++; expect(n.d, `${label}: a junction hop beyond 20 m at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeLessThanOrEqual(20); }
      if (n.cls !== 'tunnel') {
        const above = f.y - n.y;
        expect(above, `${label}: eye height above the deck at ${f.x.toFixed(0)}, ${f.z.toFixed(0)} (${n.cls})`).toBeGreaterThanOrEqual(0.5 * VE * r.ratio - 1e-6);
        if (n.d <= TRACK_LANE_M && above > 3.0 * VE * r.ratio + 1e-6) high.push({ at: [Math.round(f.x), Math.round(f.z)], aboveM: +(above / VE / r.ratio).toFixed(2), deckBelowGroundM: +((f.g - n.y) / VE / r.ratio).toFixed(2),
          clamped: Math.abs(f.y - (f.g + 1 * VE * r.ratio)) < 1e-3, cls: n.cls, i });
      }
    }
  });
  if (slack) expect(hops / Math.max(1, open.length), `${label}: frames between 3.6 and 20 m of the track`).toBeLessThanOrEqual(0.01);
  // The eye is 1.7 m above the rail head, 3 m at most above the nearest drawn deck. The exceptions are the flanks of a tunnel bridged
  // as an overbridge (a tunnel run under 60 m between open runs is shown open, the rail head straight across): the drawn deck dips
  // into the first tunnel sample (surface-rail.js smooths the tunnel samples down into the ground), so the nearest drawn point
  // there, still of a surface sample's class, lies below the terrain while the walker rides straight across. A few frames a
  // leg, and where two drawn pieces of the line cross at different heights (a viaduct over the surface line) the nearest drawn point is the other
  // piece's; both are listed here, not hidden, and held to 1.5% of a leg's open frames.
  if (high.length) console.log(`[overground] ${label}: ${high.length} of ${open.length} open frames with the eye over 3 m above the nearest deck: ${JSON.stringify(high.slice(0, 6))}`);
  expect(high.length / Math.max(1, open.length), `${label}: share of open frames with the eye over 3 m above the deck`).toBeLessThanOrEqual(0.015);
  return { open: open.length, hops };
}

/** A leg of a route: placed at `from` facing `toward`, ridden until `until`; arrivals are the expected slice, exactly. */
async function leg({ line, from, toward, until, order, keys = ['w', 'shift'], maxMs = 90000, minOpen = 30, speed = 200, label }) {
  const at = await placeAt(line, from, toward);
  expect(at, `${label}: ${from} on ${line} facing ${toward}`).not.toBeNull();
  const r = await ride({ lineId: line, until, keys, maxMs, via: order.slice(order.indexOf(from) + 1) });
  console.log(`[overground] ${label}: ${r.arrivals.length} arrivals in ${r.modeS.toFixed(1)} s of walking (${(r.wallMs / 1000).toFixed(1)} s wall, ${(r.frames.length / (r.wallMs / 1000)).toFixed(0)} fps), ${r.frames.filter(f => f.regime === 'open').length} open and ${r.frames.filter(f => f.regime === 'bore').length} bore frames`);
  if (!r.arrivals.some(a => a.name === until)) console.log(`[overground] ${label}: trace ${JSON.stringify(r.frames.filter((f, i) => i % 90 === 0).map(f => [+f.clock.toFixed(1), f.path, f.s && +f.s.toFixed(0), f.speed, f.regime, f.arrivals, +f.x.toFixed(0), +f.z.toFixed(0)]))}`);
  if (!r.arrivals.some(a => a.name === until)) console.log(`[overground] ${label}: arrivals ${JSON.stringify(r.arrivals.map(a => a.name))}, end ${JSON.stringify(r.end)}, last frames ${JSON.stringify(r.frames.slice(-3).map(f => ({ path: f.path, s: f.s && +f.s.toFixed(0), speed: f.speed, regime: f.regime, hint: f.hint })))}`);
  expect(r.arrivals.some(a => a.name === until), `${label}: ${until} arrived at within ${maxMs / 1000} s`).toBe(true);
  // The arrivals: distinct consecutive names, the start excluded, equal the expected stretch exactly.
  const names = r.arrivals.map(a => a.name).filter((n, i, A) => i === 0 || n !== A[i - 1]);
  const expected = order.slice(order.indexOf(from) + 1, order.indexOf(until) + 1);
  expect(names, `${label}: stops in order`).toEqual(expected);
  if (['og:weaver', 'og:windrush', 'og:lioness'].includes(line)) bores.push(...r.frames.filter(f => f.regime === 'bore'));   // for the depth check, whatever the leg's other checks say
  const c = await checkLeg(r, line, label);
  expect(c.open, `${label}: open frames`).toBeGreaterThanOrEqual(minOpen);
  const v = speeds(r, speed);
  if (speed === 200) {
    expect(v.length, `${label}: speed windows`).toBeGreaterThanOrEqual(label.includes('Thames') ? 1 : 5);
    if (v.length >= 5) { expect(Math.abs(median(v) - 200), `${label}: median ${median(v)}`).toBeLessThanOrEqual(6); for (const x of v) expect(Math.abs(x - 200), `${label}: window ${x}`).toBeLessThanOrEqual(10); }
  }
  // Never a card on the way, never the old portal hint, never stopped between stations once up to speed.
  expect(r.frames.every(f => f.card === null || f.card === 'arrival'), `${label}: no card but the arrival's`).toBe(true);
  expect(r.frames.some(f => /leaves its tunnel/.test(f.hint)), label).toBe(false);
  const lastArrival = r.arrivals.at(-1);
  const reached = r.frames.findIndex(f => f.speed === 200);
  if (speed === 200 && reached >= 0) {
    for (const f of r.frames.slice(reached)) {
      if (f.clock >= lastArrival.at - 0.0001) break;
      if (f.speed !== null) expect(f.speed, `${label}: never stops between stations (${f.speed} at s ${f.s?.toFixed(0)})`).toBeGreaterThanOrEqual(190);
    }
  }
  return r;
}

const ORDER = {
  weaver: ['London Liverpool Street', 'Bethnal Green', 'Cambridge Heath (London)', 'London Fields', 'Hackney Downs', 'Rectory Road', 'Stoke Newington', 'Stamford Hill',
    'Seven Sisters', 'Bruce Grove', 'White Hart Lane', 'Silver Street', 'Edmonton Green', 'Bush Hill Park', 'Enfield Town'],
  windrush: ['Dalston Junction', 'Haggerston', 'Hoxton', 'Shoreditch High Street', 'Whitechapel', 'Shadwell', 'Wapping', 'Rotherhithe', 'Canada Water', 'Surrey Quays', 'New Cross Gate'],
  mildmay: ['Stratford (London)', 'Hackney Wick', 'Homerton', 'Hackney Central', 'Dalston Kingsland', 'Canonbury', 'Highbury & Islington'],
  suffragette: ['Gospel Oak', 'Upper Holloway', 'Crouch Hill', 'Harringay Green Lanes', 'South Tottenham', 'Blackhorse Road', 'Walthamstow Queens Road', 'Leyton Midland Road',
    'Leytonstone High Road', 'Wanstead Park', 'Woodgrange Park', 'Barking', 'Barking Riverside'],
  lioness: ['London Euston', 'South Hampstead', 'Kilburn High Road', 'Queens Park (London)', 'Kensal Green', 'Willesden Junction', 'Harlesden', 'Stonebridge Park', 'Wembley Central',
    'North Wembley', 'South Kenton', 'Kenton', 'Harrow & Wealdstone'],
  liberty: ['Romford', 'Emerson Park', 'Upminster'],
};

const bores = [];   // bore frames of the Weaver, Windrush and Lioness legs, for the depth check

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await boot();
});
test.afterAll(async () => { await page?.close(); });

// ── coverage and interchanges ────────────────────────────────────────────────

test('O-COV: the network has paths for all six lines; every station inside the map is a stop; entrances are named as TfL writes them', async () => {
  const r = await page.evaluate(() => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const net = m.rebuildNetwork();
    const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '').replace(/ Station$/, '');
    const g = ug.overground.userData;
    const inside = ug.modes.ctx.isInsideM25;
    const out = {};
    for (const set of g.stationSets) {
      const id = 'og:' + set.id;
      const paths = net.paths.filter(p => p.lineId === id);
      const stopNames = new Set(paths.flatMap(p => p.stops.map(x => clean(x.stop.name))));
      const seen = new Set(), stations = [];
      for (const s of set.stations) {
        const n = clean(s.name);
        if (stations.some(t => t.name === n && Math.hypot(t.x - s.pos.x, t.z - s.pos.z) <= 100)) continue;
        stations.push({ name: n, x: s.pos.x, z: s.pos.z });
      }
      const notStops = stations.filter(s => !stopNames.has(s.name)).map(s => ({ name: s.name, inside: inside(s.x, s.z) }));
      out[id] = { paths: paths.length, stations: stations.length, inside: stations.filter(s => inside(s.x, s.z)).length, stops: stopNames.size, notStops,
        stopsOnPaths: paths.reduce((a, p) => a + p.stops.length, 0) };
    }
    // Every entrance holding only og: stops carries the cleaned name: no " Rail Station", "London Euston" and "Stratford (London)" as written.
    const ogOnly = net.entrances.filter(e => e.stops.every(s => s.lineId.startsWith('og:')));
    const dirty = ogOnly.filter(e => / (Underground|DLR|Rail) Station$/.test(e.name) || / Station$/.test(e.name)).map(e => e.name);
    const offPos = [];
    for (const p of net.paths) if (p.lineId.startsWith('og:')) for (const { stop } of p.stops) {
      const set = g.stationSets.find(s => 'og:' + s.id === p.lineId);
      const rec = set.stations.find(s => clean(s.name) === clean(stop.name));
      if (rec) offPos.push(Math.hypot(rec.pos.x - stop.x, rec.pos.z - stop.z));
    }
    return { out, dirty, ogOnly: ogOnly.length, maxSiteGap: Math.max(...offPos), report: m.overgroundReport(), euston: net.entrances.some(e => e.name === 'London Euston' || e.names.includes('London Euston')) };
  });
  console.log('[overground] coverage', JSON.stringify(Object.fromEntries(Object.entries(r.out).map(([k, v]) => [k, { paths: v.paths, stations: v.stations, inside: v.inside, stops: v.stops, notStops: v.notStops }]))));
  for (const id of ['og:liberty', 'og:lioness', 'og:mildmay', 'og:suffragette', 'og:weaver', 'og:windrush']) {
    const v = r.out[id];
    expect(v.paths, `${id}: paths`).toBeGreaterThanOrEqual(1);
    // Every station of the line inside the map is a stop on it; the others are the map edge's (Cheshunt, Theobalds Grove).
    expect(v.notStops.filter(s => s.inside), `${id}: stations inside the map that are not stops`).toEqual([]);
    expect(v.stops, `${id}`).toBeGreaterThanOrEqual(v.inside);
  }
  // Sanity floors (the checker computes the counts from overground.json).
  expect(r.out['og:liberty'].stations).toBeGreaterThanOrEqual(3);
  expect(r.out['og:lioness'].stations).toBeGreaterThanOrEqual(17);
  expect(r.out['og:mildmay'].stations).toBeGreaterThanOrEqual(28);
  expect(r.out['og:suffragette'].stations).toBeGreaterThanOrEqual(13);
  expect(r.out['og:weaver'].stations).toBeGreaterThanOrEqual(23);
  expect(r.out['og:windrush'].stations).toBeGreaterThanOrEqual(29);
  // Weaver: Bethnal Green is a stop; Cheshunt is not (Lane T's track and edge: checked at integration).
  expect(r.out['og:weaver'].notStops.map(s => s.name)).not.toContain('Bethnal Green');
  expect(r.dirty, 'no Overground-only entrance carries a " Rail Station" name').toEqual([]);
  expect(r.maxSiteGap, 'a stop stands at its station\'s site').toBeLessThan(1);
  expect(r.euston).toBe(true);
  expect(r.report.lines['og:weaver'].gaps.length).toBeGreaterThanOrEqual(1);
});

test('O-INT: every interchange pair is in one entrance; Bethnal Green and the Kentish Towns are not merged; the Tube\'s own entrances are untouched', async () => {
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const net = m.rebuildNetwork();
    const { buildTunnelNetwork, cleanName } = await import('/src/modes/pedestrian-tunnels.js');
    const keyOf = (n) => cleanName(n).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/['’]/g, '').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
    const holds = (lineId, name, other) => net.entrances.some(e => e.stops.some(s => s.lineId === lineId && cleanName(s.name) === name)
      && e.stops.some(s => s.lineId === other));
    const pairs = [
      ['og:liberty', 'Upminster', ['district']],
      ...['Harlesden', 'Kensal Green', 'Kenton', 'North Wembley', 'Queens Park (London)', 'South Kenton', 'Stonebridge Park', 'Wembley Central', 'Willesden Junction', 'Harrow & Wealdstone'].map(n => ['og:lioness', n, ['bakerloo']]),
      ['og:lioness', 'London Euston', ['northern', 'victoria']],
      ...['Gunnersbury', 'Kensington (Olympia)', 'Kew Gardens', 'Richmond (London)', 'West Brompton'].map(n => ['og:mildmay', n, ['district']]),
      ['og:mildmay', 'Highbury & Islington', ['victoria']], ['og:mildmay', 'Stratford (London)', ['central', 'jubilee', 'dlr']], ['og:mildmay', 'Willesden Junction', ['bakerloo']],
      ['og:mildmay', 'Shepherds Bush', ['central']], ['og:mildmay', 'West Hampstead', ['jubilee']],
      ['og:suffragette', 'Barking', ['district', 'hammersmith-city']], ['og:suffragette', 'Blackhorse Road', ['victoria']],
      ['og:weaver', 'Walthamstow Central', ['victoria']], ['og:weaver', 'Seven Sisters', ['victoria']], ['og:weaver', 'London Liverpool Street', ['central', 'metropolitan']],
      ['og:windrush', 'Canada Water', ['jubilee']], ['og:windrush', 'Highbury & Islington', ['victoria']], ['og:windrush', 'Whitechapel', ['district']], ['og:windrush', 'Shadwell', ['dlr']],
    ];
    const missing = [];
    for (const [line, name, others] of pairs) for (const o of others) if (!holds(line, name, o)) missing.push(`${line} ${name} + ${o}`);
    const together = (a, b) => net.entrances.some(e => e.stops.some(s => s.lineId === a[0] && cleanName(s.name) === a[1]) && e.stops.some(s => s.lineId === b[0] && cleanName(s.name) === b[1]));
    const notTogether = [
      [['og:weaver', 'Bethnal Green'], ['central', 'Bethnal Green']], [['og:mildmay', 'Kentish Town West'], ['northern', 'Kentish Town']],
      [['og:mildmay', 'Camden Road'], ['northern', 'Camden Town']], [['og:mildmay', 'Dalston Kingsland'], ['og:windrush', 'Dalston Junction']],
    ].filter(([a, b]) => together(a, b)).map(([a, b]) => `${a.join(' ')} + ${b.join(' ')}`);
    // The 40 to 400 m pairs are printed; a pair beyond 40 m must match by name.
    const far = net.stats.ogInterchanges.filter(p => p.m >= 40);
    const badFar = far.filter(p => keyOf(p.og).replace(/^london /, '') !== keyOf(p.with).replace(/^london /, '')).map(p => `${p.og} / ${p.with} ${p.m}`);
    // Tube-only entrances unchanged against a network built WITHOUT the Overground.
    const src = ug.modes.ctx.tubeNetwork;
    const plain = buildTunnelNetwork({ THREE: window.__ugTHREE, branchesByLine: src.branches, stationLayers: src.stationLayers, VE: 5, halfSpacing: src.halfSpacing ?? 0 });
    const snap = (n) => new Map(n.entrances.filter(e => !e.stops.some(s => s.lineId.startsWith('og:'))).map(e => [`${e.name}|${Math.round(e.x)}|${Math.round(e.z)}`, e.stops.length]));
    const a = snap(net), b = snap(plain);
    const changed = [...a].filter(([k, v]) => b.get(k) !== v).map(([k]) => k);
    return { missing, notTogether, far: far.map(p => `${p.ogLine} ${p.og} / ${p.with} ${p.m} ${p.rule}`), badFar, merges: net.stats.ogMerges, changed, ogLinks: net.stats.ogLinks };
  });
  console.log('[overground] pairs 40 to 400 m', JSON.stringify(r.far), 'merges', JSON.stringify(r.merges));
  expect(r.missing, 'every interchange pair in one entrance').toEqual([]);
  expect(r.notTogether, 'stations that are not the same station').toEqual([]);
  expect(r.badFar, 'a pair beyond 40 m matches by name').toEqual([]);
  expect(r.changed, 'Tube-only entrances unchanged').toEqual([]);
  expect(r.ogLinks).toBeGreaterThan(0);
});

// ── routes ───────────────────────────────────────────────────────────────────

test('O-RTE-1 Weaver, London Liverpool Street to Enfield Town: both legs, every stop in order, the Chingford trunk not taken', async () => {
  const a = await leg({ line: 'og:weaver', from: 'London Liverpool Street', toward: 'Bethnal Green', until: 'Seven Sisters', order: ORDER.weaver, label: 'Weaver leg 1', minOpen: 30 });
  expect(a.cuts.length).toBeGreaterThanOrEqual(0);
  const b = await leg({ line: 'og:weaver', from: 'Seven Sisters', toward: 'Bruce Grove', until: 'Enfield Town', order: ORDER.weaver, label: 'Weaver leg 2' });
  console.log('[overground] weaver', JSON.stringify({ leg1: a.frames.length, leg2: b.frames.length }));
});

test('O-RTE-2 Windrush, Dalston Junction to New Cross Gate: through the Thames Tunnel in the bore with the lining, a flare out at Rotherhithe', async () => {
  const r = await leg({ line: 'og:windrush', from: 'Dalston Junction', toward: 'Haggerston', until: 'New Cross Gate', order: ORDER.windrush, label: 'Windrush Thames', minOpen: 15 });
  const idx = (n) => r.arrivals.findIndex(a => a.name === n) + 1;
  const wap = idx('Wapping'), rot = idx('Rotherhithe');
  expect(wap).toBeGreaterThan(0); expect(rot).toBeGreaterThan(wap);
  const between = r.frames.filter(f => f.arrivals >= wap && f.arrivals < rot);
  expect(between.length, 'frames between Wapping and Rotherhithe').toBeGreaterThanOrEqual(10);
  for (const f of between) {
    expect(f.regime, 'the Thames Tunnel is walked in the bore').toBe('bore');
    expect(f.interior, 'with the lining').toBe(true);
    if (f.water !== null) expect(f.y, 'under the water').toBeLessThan(f.water);
  }
  for (const f of r.frames.filter(f => f.regime === 'bore')) expect(f.interior, 'the lining in every bore frame').toBe(true);
  // Out at Rotherhithe: the first open frame after the arrival carries the flare.
  const k = r.frames.findIndex((f, i) => i > 0 && f.arrivals >= rot && f.regime === 'open');
  if (k > 0) {
    const cut = r.frames.slice(k, k + 3).some(f => f.cut === 'flare');
    expect(cut, 'a flare within 2 frames of the first open frame after Rotherhithe').toBe(true);
  }
  expect(r.cuts.some(c => c.kind === 'flare')).toBe(true);
});

test('O-RTE-3 Mildmay, Stratford to Highbury & Islington', async () => {
  await leg({ line: 'og:mildmay', from: 'Stratford (London)', toward: 'Hackney Wick', until: 'Highbury & Islington', order: ORDER.mildmay, label: 'Mildmay' });
});

test('O-RTE-4 Suffragette, Gospel Oak to Barking Riverside: arrival at the end of the line with its banner', async () => {
  await leg({ line: 'og:suffragette', from: 'Gospel Oak', toward: 'Upper Holloway', until: 'Blackhorse Road', order: ORDER.suffragette, label: 'Suffragette leg 1' });
  const r = await leg({ line: 'og:suffragette', from: 'Blackhorse Road', toward: 'Walthamstow Queens Road', until: 'Barking Riverside', order: ORDER.suffragette, label: 'Suffragette leg 2' });
  expect(r.arrivals.at(-1).name).toBe('Barking Riverside');
});

test('O-RTE-5 Lioness, London Euston to Harrow & Wealdstone', async () => {
  const a = await leg({ line: 'og:lioness', from: 'London Euston', toward: 'South Hampstead', until: 'Willesden Junction', order: ORDER.lioness, label: 'Lioness leg 1' });
  const b = await leg({ line: 'og:lioness', from: 'Willesden Junction', toward: 'Harlesden', until: 'Harrow & Wealdstone', order: ORDER.lioness, label: 'Lioness leg 2' });
});

test('O-RTE-6 Liberty, Romford to Upminster: 60 m/s along the drawn track for the first 20 s, then Shift', async () => {
  expect(await placeAt('og:liberty', 'Romford', 'Emerson Park')).not.toBeNull();
  const slow = await ride({ lineId: 'og:liberty', keys: ['w'], maxMs: 20000, via: ORDER.liberty.slice(1) });
  const v60 = speeds(slow, 60);
  expect(v60.length, '60 m/s windows').toBeGreaterThanOrEqual(5);
  for (const x of v60) expect(Math.abs(x - 60), `60 m/s window ${x}`).toBeLessThanOrEqual(2);
  const rest = await ride({ lineId: 'og:liberty', until: 'Upminster', maxMs: 70000, via: ORDER.liberty.slice(1 + slow.arrivals.length) });
  const names = slow.arrivals.concat(rest.arrivals).map(a => a.name);
  expect(names.filter((n, i, A) => i === 0 || n !== A[i - 1])).toEqual(['Emerson Park', 'Upminster']);
  await checkLeg(slow, 'og:liberty', 'Liberty 60');
  await checkLeg(rest, 'og:liberty', 'Liberty 200');
  const v = speeds(rest, 200);
  if (v.length >= 5) expect(Math.abs(median(v) - 200)).toBeLessThanOrEqual(6);
});

test('O-RTE-g: in the bore the walker is at today\'s single 20 m depth', async () => {
  const far = bores.filter(f => f.water === null);
  const stops = await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').network.paths.filter(p => p.lineId.startsWith('og:')).flatMap(p => p.stops.map(x => ({ x: x.stop.x, z: x.stop.z }))));
  console.log(`[overground] bore frames kept ${bores.length}, off the water ${far.length}, lines ${JSON.stringify([...new Set(bores.map(f => f.lineId))])}`);
  expect(bores.length, 'bore frames from the Weaver, Windrush and Lioness legs').toBeGreaterThan(0);
  // Away from every stop (the platform is shallower than the bore for the Tube's shaft, and a stub's end is at the station).
  const away = far.filter(f => stops.every(s => Math.hypot(f.x - s.x, f.z - s.z) > 150));
  expect(away.length, 'bore frames away from every stop').toBeGreaterThanOrEqual(20);
  const depths = away.map(f => ({ d: (f.g - f.y) / VE, x: Math.round(f.x), z: Math.round(f.z), portal: f.portal }));
  const inRange = depths.filter(f => f.d >= 14 && f.d <= 24);
  const out = depths.filter(f => !(f.d >= 14 && f.d <= 24));
  console.log(`[overground] bore depth away from stops: ${inRange.length} of ${depths.length} frames within 14 to 24 m (min ${Math.min(...depths.map(f => f.d)).toFixed(1)}, max ${Math.max(...depths.map(f => f.d)).toFixed(1)}); the others: ${JSON.stringify(out.slice(0, 10))}`);
  // Today's single 20 m depth, smoothed near the mouths: the drawn tunnel (surface-rail.js) ramps from the surface down over its
  // first 40 m or so, and a tunnel shorter than about 100 m never reaches its depth. Those frames are the rest.
  expect(inRange.length / depths.length, 'share of bore frames away from stops at 14 to 24 m').toBeGreaterThanOrEqual(0.85);
  for (const f of depths) expect(f.d, `no bore deeper than 26 m at ${f.x}, ${f.z}`).toBeLessThanOrEqual(26);
});

// ── changes and "towards" text ───────────────────────────────────────────────

/** Place at rest on `line`'s stop of `station`, press E, wait for the arrival card; returns the labels (the walker's own platform's rows are not changes). */
const cardAt = (line, station) => page.evaluate(async ([line, station]) => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '').replace(/ Station$/, '');
  const net = m.rebuildNetwork();
  m.chooser.close();
  let pick = null;
  for (const p of net.paths) {
    if (p.lineId !== line) continue;
    for (const { s, stop } of p.stops) {
      if (clean(stop.name) !== station) continue;
      pick = { path: p.id, s, dir: s < p.length - 1e-6 ? 1 : -1 };
      break;
    }
    if (pick) break;
  }
  if (!pick) return { error: `no ${station} on ${line}` };
  m.placeInTunnel(pick);
  for (let i = 0; i < 3; i++) await frame();
  m.press('use');
  let d;
  for (let i = 0; i < 30; i++) { await frame(); d = m.debug(); if (d.card?.kind === 'arrival') break; }
  return { kind: d.card?.kind ?? null, labels: d.chooser.rows, detail: d.chooser.detail, pick };
}, [line, station]);

/** From the street beside the entrance of `station` (a stop of `line` there), E: the platform card's labels (every platform of every network). */
const streetRows = (line, station) => page.evaluate(async ([line, station]) => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
  const frame = () => new Promise(res => requestAnimationFrame(res));
  const net = m.rebuildNetwork();
  const e = net.entrances.find(en => en.names.includes(station) && en.stops.some(s => s.lineId === line));
  if (!e) return { error: `no entrance ${station} on ${line}` };
  m.chooser.close();
  m.place(e.x + 10, e.z + 6, { yaw: 0 });
  await frame(); await frame();
  m.press('use');
  for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card?.kind === 'shaft') break; }
  const d = m.debug();
  const labels = m.chooser.rows.map(r => r.label);
  m.chooser.close();
  return { kind: d.card?.kind ?? null, labels };
}, [line, station]);

const choose = (labelStart) => page.evaluate(async (labelStart) => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const rows = m.chooser.rows;
  const i = rows.findIndex(r => r.label.startsWith(labelStart));
  if (i < 0) return { error: `no row ${labelStart}`, rows: rows.map(r => r.label) };
  const row = rows[i];
  const before = { regime: m.debug().regime, cuts: m.debug().openAir.cuts.length };
  m.chooseRow(i);
  const log = [];
  for (let k = 0; k < 200; k++) {
    await frame(); const d = m.debug(), c = ug.camera.position;
    log.push({ phase: d.phase, regime: d.regime, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z), cut: d.openAir.cut?.kind ?? null, line: d.tunnel?.lineId ?? null });
    if (d.phase === 'tunnel' && k > 1) break;
  }
  const d = m.debug();
  const path = m.network.paths[d.tunnel.path];
  return { ratio: ug.surfaceTrains.ratio, log, line: d.tunnel.lineId, regime: d.regime, shouldBe: m.openAir.isOpen(path, d.tunnel.s) ? 'open' : 'bore',
    cuts: d.openAir.cuts.length, chosen: row.label, before, kinds: d.openAir.cuts.map(c => c.kind) };
}, labelStart);

/** After a choice: W and Shift until `until` is arrived at (30 s at most). */
const walkTo = (until) => page.evaluate(async (until) => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const c0 = m.debug().clock;
  ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
  let got = null;
  const t0 = performance.now();
  try {
    while (performance.now() - t0 < 30000) {
      await frame();
      const d = m.debug();
      const a = d.arrivals.filter(x => x.at > c0)[0];
      if (a) { got = a.name; break; }
      if (d.phase !== 'tunnel') break;
    }
  } finally { ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift'); }
  return { got, line: m.debug().tunnel?.lineId, clock: m.debug().clock - c0 };
}, until);

function checkChoice(r, label) {
  expect(r.error, label).toBeUndefined();
  expect(r.log.at(-1).phase, label).toBe('tunnel');
  expect(r.regime, `${label}: the regime of the platform`).toBe(r.shouldBe);
  // Within 3 s the walker is on the chosen line's platform in the regime it is shown in; a change between the bore and
  // the open air logs a cut (a dip or a flare), never an ease through the ground; between two open platforms the ease stays above it.
  if (r.before.regime !== r.shouldBe) expect(r.cuts, `${label}: a cut`).toBeGreaterThan(r.before.cuts);
  if (r.before.regime === 'open' && r.shouldBe === 'open') {
    for (const f of r.log.filter(x => x.phase === 'transfer')) expect(f.y, `${label}: the ease stays above the terrain`).toBeGreaterThanOrEqual(f.g + 1 * VE * r.ratio - 1e-6);
  }
}

test('O-CHG-1/2: Highbury & Islington, Victoria to Mildmay and back; both networks\' rows with TfL\'s towards text', async () => {
  const c = await cardAt('victoria', 'Highbury & Islington');
  expect(c.error).toBeUndefined();
  expect(c.kind).toBe('arrival');
  const labels = c.labels;
  expect(labels).toContain('Mildmay · towards Clapham Junction or Richmond (London)');
  expect(labels).toContain('Mildmay · towards Stratford (London)');
  expect(labels).toContain('Windrush · towards Clapham Junction, Crystal Palace, New Cross ELL or West Croydon');
  const r = await choose('Mildmay · towards Clapham Junction or Richmond (London)');
  checkChoice(r, 'to Mildmay');
  expect(r.line).toBe('og:mildmay');
  const w = await walkTo('Caledonian Road & Barnsbury');
  expect(w.got).toBe('Caledonian Road & Barnsbury');
  expect(w.clock).toBeLessThanOrEqual(30);
  // Back: at the Mildmay platform, E, the Victoria rows.
  const back = await cardAt('og:mildmay', 'Highbury & Islington');
  expect(back.kind).toBe('arrival');
  expect(back.labels).toContain('Victoria · towards Brixton');
  expect(back.labels).toContain('Victoria · towards Walthamstow Central');
  const v = await choose('Victoria · towards Brixton');
  checkChoice(v, 'back to the Victoria');
  expect(v.line).toBe('victoria');
  const k = await walkTo("King's Cross St. Pancras");
  expect(k.got).toMatch(/King's Cross St\. Pancras/);
});

test('O-CHG-3/4: Stratford, the Central and the DLR to the Mildmay (a terminus: one row)', async () => {
  const c = await cardAt('central', 'Stratford');
  expect(c.kind).toBe('arrival');
  const mild = c.labels.filter(l => l.startsWith('Mildmay'));
  expect(mild).toEqual(['Mildmay · towards Clapham Junction or Richmond (London)']);
  const r = await choose('Mildmay · towards Clapham Junction or Richmond (London)');
  checkChoice(r, 'Central to Mildmay');
  expect(r.line).toBe('og:mildmay');
  const w = await walkTo('Hackney Wick');
  expect(w.got).toBe('Hackney Wick');
  const d = await cardAt('dlr', 'Stratford');
  expect(d.kind, JSON.stringify(d.error)).toBe('arrival');
  expect(d.labels.filter(l => l.startsWith('Mildmay'))).toEqual(['Mildmay · towards Clapham Junction or Richmond (London)']);
  const r2 = await choose('Mildmay · towards Clapham Junction or Richmond (London)');
  checkChoice(r2, 'DLR to Mildmay');
  expect(r2.line).toBe('og:mildmay');
});

test('O-CHG-5/6: Whitechapel (District) and Canada Water (Jubilee) to the Windrush', async () => {
  const want = ['Windrush · towards Highbury & Islington', 'Windrush · towards Clapham Junction, Crystal Palace, New Cross ELL or West Croydon'];
  const a = await cardAt('district', 'Whitechapel');
  expect(a.kind).toBe('arrival');
  for (const l of want) expect(a.labels).toContain(l);
  const r = await choose(want[1]);
  checkChoice(r, 'Whitechapel to Windrush');
  expect(r.line).toBe('og:windrush');
  expect((await walkTo('Shadwell')).got).toBe('Shadwell');
  const b = await cardAt('jubilee', 'Canada Water');
  expect(b.kind).toBe('arrival');
  for (const l of want) expect(b.labels).toContain(l);
  const r2 = await choose(want[0]);
  checkChoice(r2, 'Canada Water to Windrush');
  expect(r2.line).toBe('og:windrush');
  expect((await walkTo('Rotherhithe')).got).toBe('Rotherhithe');
});

test('O-CHG-c: from the street at Highbury & Islington, E offers the platforms of both networks without Lane B', async () => {
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const net = m.rebuildNetwork();
    const e = net.entrances.find(en => en.names.includes('Highbury & Islington') && en.stops.some(s => s.lineId === 'victoria'));
    m.place(e.x + 12, e.z + 5, { yaw: 0 });
    await frame(); await frame();
    const hint = document.getElementById('ug-mode-hint')?.textContent ?? '';
    m.press('use');
    for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card?.kind === 'shaft') break; }
    const d = m.debug();
    return { hint, kind: d.card?.kind, lines: d.chooser.detail.map(x => x.lineId), labels: d.chooser.rows };
  });
  expect(r.hint).toMatch(/^E: choose a platform at Highbury/);
  expect(r.kind).toBe('shaft');
  expect(r.lines).toContain('og:mildmay');
  expect(r.lines).toContain('victoria');
  await page.keyboard.press('Escape');
});

test('O-TWD: "towards" text at Hackney Downs, Edmonton Green, Liverpool Street, Willesden Junction and Romford; every Overground row names a destination', async () => {
  const hd = await streetRows('og:weaver', 'Hackney Downs');
  expect(hd.kind).toBe('shaft');
  expect(hd.labels).toContain('Weaver · towards Chingford');
  expect(hd.labels).toContain('Weaver · towards Cheshunt or Enfield Town');
  expect(hd.labels.filter(l => l === 'Weaver · towards London Liverpool Street').length).toBeGreaterThanOrEqual(1);
  const eg = await streetRows('og:weaver', 'Edmonton Green');
  expect(eg.labels).toContain('Weaver · towards Cheshunt or Enfield Town');
  const ls = await streetRows('og:weaver', 'London Liverpool Street');
  expect(ls.labels).toContain('Weaver · towards Cheshunt, Chingford or Enfield Town');
  const wj = await streetRows('og:mildmay', 'Willesden Junction');
  expect(wj.labels).toContain('Mildmay · towards Clapham Junction or Richmond (London)');
  expect(wj.labels).toContain('Mildmay · towards Stratford (London)');
  const rf = await streetRows('og:liberty', 'Romford');
  expect(rf.labels.filter(l => l.startsWith('Liberty'))).toEqual(['Liberty · towards Upminster']);
  const all = await page.evaluate(async () => {
    const { platformRows } = await import('/src/modes/tube-routes.js');
    const m = window.__ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
    const bad = [];
    for (const e of net.entrances) for (const r of platformRows(net, e, { tubeRoutes: window.__ug.modes.ctx.tubeRoutes })) {
      if (r.lineId.startsWith('og:') && (!r.towards.length || r.label === r.lineName)) bad.push(`${e.name}: ${r.label}`);
    }
    return bad;
  });
  expect(all, 'every og: row has a destination').toEqual([]);
});

// ── an Overground train passes through the walker ────────────────────────────

test('O-PAS: an Overground train in the walker\'s lane passes through it in the open: rumble and a brief shake, never a stop; the other lane never does', async () => {
  await page.mouse.click(5, 300); // a user gesture: the mode voices have a bus
  const run = (laneOpposite) => page.evaluate(async (laneOpposite) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const net = m.rebuildNetwork(), oa = m.openAir;
    for (const lineId of ['og:windrush', 'og:lioness', 'og:suffragette']) {
      oa.ensureLine(net, lineId);
      const fleet = ug.overground.userData.fleets.find(f => f.name === `overground-trains-${lineId.slice(3)}`);
      for (const t of fleet.userData.trains) {
        const dirOf = (tr) => (tr.phase < tr.run ? 1 : -1);
        const x0 = t.position.x, z0 = t.position.z, d0 = dirOf(t);
        await frame(); await frame();
        const mx = t.position.x - x0, mz = t.position.z - z0;
        if (Math.hypot(mx, mz) < 0.01) continue;
        let best = null;
        for (const p of net.paths) {
          if (p.lineId !== lineId) continue;
          for (let s = 0; s <= p.length; s += 20) {
            const q = oa.present(p, s, 0, {});
            if (!q.open) continue;
            const d = Math.hypot(q.x - t.position.x, q.z - t.position.z);
            if (!best || d < best.d) best = { d, s, path: p, hx: q.hx, hz: q.hz };
          }
        }
        if (!best || best.d > 15) continue;
        const dir = (mx * best.hx + mz * best.hz) > 0 ? 1 : -1;
        const s0 = best.s + dir * 500;
        const p = best.path;
        if (s0 < 0 || s0 > p.length) continue;
        let ok = true;
        for (let s = Math.min(s0, best.s); s <= Math.max(s0, best.s); s += 20) if (!oa.isOpen(p, s)) { ok = false; break; }
        if (!ok) continue;
        m.placeInTunnel({ path: p.id, s: s0, dir: -dir, side: laneOpposite ? -dir : dir });
        await frame(); await frame();
        ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
        const log = [];
        const t0 = performance.now(), c0 = m.debug().clock;
        let seen = 0;
        // 12 s at most, and the walker's first 6 s of walking (1.2 km): the one train it was placed to meet. In the other lane
        // any train running the opposite way is in the walker's lane, so a longer walk would meet one.
        while (performance.now() - t0 < 24000 && m.debug().clock - c0 < (laneOpposite ? 6 : 12)) {
          await frame();
          const d = m.debug(), lv = ug.modes.sfx.levels();
          log.push({ regime: d.regime, inside: !!d.lastPass?.inside, rumble: d.lastPass?.rumble ?? 0, shake: d.shake, passT: d.passT, speed: d.tunnel?.speed, lv: lv?.trainRumble ?? 0,
            who: d.openAir.pass?.nearest?.id ?? null });
          if (d.lastPass?.inside) seen++;
          if (seen > 3 && !d.lastPass?.inside) break;
        }
        ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
        return { lineId, log, passes: m.debug().openAir.passes, train: fleet.userData.trains.indexOf(t) };
      }
    }
    return { error: 'no Overground train found running in the open' };
  }, laneOpposite);
  const r = await run(false);
  expect(r.error).toBeUndefined();
  const inside = r.log.filter(f => f.inside);
  expect(inside.length).toBeGreaterThan(0);
  expect(inside.every(f => f.regime === 'open'), 'the pass is in the open').toBe(true);
  expect(Math.max(...r.log.map(f => f.rumble))).toBeGreaterThan(0.05);
  expect(Math.max(...r.log.map(f => f.shake))).toBeGreaterThan(0.005);
  expect(Math.max(...r.log.map(f => f.lv))).toBeGreaterThan(0.05);
  const reached = r.log.findIndex(f => f.speed === 200);
  r.log.forEach((f, k) => { if (f.inside && k >= reached) expect(f.speed).toBe(200); });
  for (const f of r.log) if (f.passT !== null && f.passT > 1.8) expect(f.shake).toBeLessThan(0.001);
  expect(r.passes).toBeGreaterThanOrEqual(1);
  // The other lane: the walker 5.2 m across from the train: never inside.
  const o = await run(true);
  if (!o.error) {
    const mine = `overground-trains-${o.lineId.slice(3)}:${o.train}`;
    expect(o.log.filter(f => f.inside && f.who === mine).length, `the other lane never gives inside for train ${mine}`).toBe(0);
  }
});

// ── Master independence (D-039) ──────────────────────────────────────────────

test('O-MST: on the Weaver deck 300 m south of Hackney Downs the eye keeps its real height above the deck at Master 1.1 and 3, with no remap', async () => {
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const net = m.rebuildNetwork(), oa = m.openAir;
    oa.ensureLine(net, 'og:weaver');
    const clean = (n) => n.replace(/ (Underground|DLR|Rail) Station$/, '');
    let at = null;
    for (const p of net.paths) {
      if (p.lineId !== 'og:weaver') continue;
      const st = p.stops.find(x => clean(x.stop.name) === 'Hackney Downs');
      if (!st) continue;
      for (const dir of [1, -1]) {
        const s = st.s + dir * -300;   // 300 m the other way from `dir`
        if (s < 0 || s > p.length) continue;
        const q = oa.present(p, s, 0, {});
        if (q.open && !q.bridged) { at = { path: p.id, s, dir: -dir }; break; }
      }
      if (at) break;
    }
    if (!at) return { error: 'no open point 300 m from Hackney Downs' };
    const sample = async () => {
      m.placeInTunnel({ path: at.path, s: at.s, dir: at.dir });
      for (let i = 0; i < 3; i++) await frame();
      const c = ug.camera.position, p = net.paths[at.path];
      const q = oa.present(p, at.s, 0, {});
      return { camY: c.y, ratio: ug.surfaceTrains.ratio, deck: q.y, builds: m.debug().openAir.lines['og:weaver'].builtPaths };
    };
    const slider = document.getElementById('masterHeight');
    const prev = slider.value;
    const a = await sample();
    slider.value = '3'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    ug.structureMorph.flush();
    for (let i = 0; i < 3; i++) await frame();
    const b = await sample();
    slider.value = prev; slider.dispatchEvent(new Event('input', { bubbles: true })); ug.structureMorph.flush();
    for (let i = 0; i < 3; i++) await frame();
    return { a, b, held: m.debug().ease };
  });
  expect(r.error).toBeUndefined();
  const g1 = r.a.camY - r.a.deck, g3 = r.b.camY - r.b.deck;
  expect(Math.abs(g3 / g1 - r.b.ratio / r.a.ratio), `eye height ratio ${g3 / g1} against ${r.b.ratio / r.a.ratio}`).toBeLessThanOrEqual(0.05);
  // The Weaver's mapping is not rebuilt by Master (the DLR's is: its drawn deck follows the ratio, so the counter of ALL builds rises).
  expect(r.b.builds, 'the Overground mapping is not rebuilt by Master').toBe(r.a.builds);
});

// ── cost ─────────────────────────────────────────────────────────────────────

test('O-REG-3 / O-CST: every line is mapped lazily within the budget; the mapping costs under 4 ms a line; the network rebuild is timed', async () => {
  await page.waitForFunction(() => Object.values(window.__ug.modes.registry.get('pedestrian').openAirReport().lines)
    .every(v => !v.paths || v.mapped === v.paths), null, { timeout: 60000 });
  const rep = await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').openAirReport());
  for (const id of ['og:liberty', 'og:lioness', 'og:mildmay', 'og:suffragette', 'og:weaver', 'og:windrush']) {
    const v = rep.lines[id];
    expect(v.mapped, id).toBe(v.paths);
    expect(v.ms, `${id} mapping ms`).toBeLessThanOrEqual(4);
    expect(v.maxPathMs, `${id} max path ms`).toBeLessThanOrEqual(4);
  }
  const t = await page.evaluate(() => { const m = window.__ug.modes.registry.get('pedestrian'); const ts = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); m.rebuildNetwork(); ts.push(performance.now() - t0); } return ts.sort((a, b) => a - b); });
  console.log('[overground] rebuildNetwork ms', JSON.stringify(t.map(x => +x.toFixed(1))));
  // e0675d7 measures about 450 ms here (its portals and map edge); the checker compares this lane's median with livebase's.
  expect(t[2], 'a network rebuild').toBeLessThan(700);
});

test('no console error and no uncaught page error over the whole run', async () => {
  expect(consoleErrors, 'console errors').toEqual([]);
  expect(pageErrors, 'page errors').toEqual([]);
});
