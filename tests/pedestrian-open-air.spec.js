// pedestrian-open-air.spec.js: the Pedestrian walk to the ends of the lines,
// in the real app (sprint 01Oct26h, D-042 item 1, D-043 item 4, Lane P).
//
// Jordan (D-042 item 1): "we should stop and be offered the street at stations
// only, not when a line leaves its tunnel. not even when leaving its tunnel for
// good. it should be possible to keep traveling in the same way to the ends of
// the lines even above ground and only possible to exit them at stations."
//
// Routes, Shift held (200 m/s), each leg a minute at most:
//   Northern   Hampstead -> Edgware
//   District   Stepney Green -> Upminster (three legs, the walk carried on from each)
//   Metropolitan  Moor Park -> Rickmansworth -> the map edge (60 m/s first, then Shift)
//   DLR        Bank -> Lewisham: arrivals in order; the regimes bore, open, bore at Cutty Sark, open
//   Central    Mile End -> Leytonstone, and Debden -> Theydon Bois -> the edge
//   Jubilee    Swiss Cottage -> Stanmore (two legs); no bore between Finchley Road and Kilburn once Lane
//              R's West Hampstead stub fix is in the data
// On every open-air frame: the camera is at least terrain + 0.5 m x VE; within lane + extra + 1 m of the
// drawn track wherever Lane T's run is itself on it (its fairings and junction hops are bounded
// separately, see TRACK_SLACK_M); the D-040 cull holds (aboveGroundView) wherever M25 insideness >= 0.999.
// Speed, as plan displacement over the mode clock: 60 +/- 2 and 200 +/- 6 m/s.
// Behaviour: surface pass-through, the street exit and entry, the glide back after a 200 m/s overshoot,
// Terminal 4, no label in the bore, a fork taken each way by facing it.
// Pins are floors and behaviours, never counts from 387dff0's data: Lane R is adding open-air track and
// removing the Jubilee's stub in parallel, and the integrator re-runs this spec on the merged build.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150000);

const VE = 5;
// pedestrian.js's own constants, read from the page in beforeAll: the platform zone (where the arrival card
// is on offer), the radius at which the street offers a station's platforms, the offsets of the step aside.
let K = null;
// Lane T's runs stray from the drawn track where they are faired (surface-train-map.js FAIR_MAX_DEV_M, 10 m
// beyond the run they replace) or hop a junction gap between two drawn pieces (Lane R's twin collapse leaves
// gaps up to about 32 m, some 50 m): the walker follows the run, as the trains do. Measured 01Oct26h over every
// open stretch: 0.2 to 2% of positions per line, the worst 22 m past the lane.
const TRACK_SLACK_M = 30;

let page;
const dbg = () => page.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());

async function boot() {
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

/** Place the walker at a platform of `from` on `lineId`, at rest, facing toward `toward` (the next station that way). */
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

/**
 * Walk with the given keys until `until` is arrived at, the walk holds at the map edge, or maxMs. With `via`,
 * the walker faces the first station of that list still ahead and more than 150 m away (a viewer faces the
 * branch they want before the junction station). Every frame is measured in the page.
 */
function ride({ lineId, until = null, keys = ['w', 'shift'], maxMs = 58000, via = null, stopAtEdge = true }) {
  return page.evaluate(async ({ lineId, until, keys, maxMs, via, stopAtEdge }) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const { distanceToDrawn, buildSegmentIndex, sampleRun } = await import('/src/surface-train-map.js');
    const { sampleM25Insideness } = await import('/src/m25.js');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const net = m.network, st = ug.surfaceTrains;
    const tn = st.networkFor(lineId), idx = tn.index || buildSegmentIndex(tn.net);
    const flare = document.getElementById('ug-portal-flare');
    // Arrivals since the ride began, by the mode clock: the arrivals log keeps the last 64 only, so an index
    // taken from its length stops counting once a long serial run has filled it (fix round 2: the fork test).
    const c0 = m.debug().clock;
    const since = (d) => d.arrivals.filter(a => a.at > c0);
    // A station's name without a parenthetical ("Cutty Sark (for Maritime Greenwich)"), matched whole
    // ("Upminster" is not "Upminster Bridge").
    const is = (name, want) => name === want || name.replace(/\s*\(.*\)$/, '') === want;
    const posOf = (name) => net.entrances.filter(en => is(en.name, name) && en.stops.some(x => x.lineId === lineId));
    const frames = [];
    const smp = {};
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
          inside: sampleM25Insideness(c.x, c.z), above: ug.aboveGroundView, cut: d.openAir.cut?.kind ?? null,
          flare: +getComputedStyle(flare).opacity, card: d.card?.kind ?? null, edge: d.atEdge, interior: d.interior.visible,
          hint: document.getElementById('ug-mode-hint')?.textContent ?? '', arrivals: since(d).length };
        if (d.regime === 'open' && d.shown) {
          f.extra = d.shown.extra; f.lane = d.shown.lane; f.bridged = !!d.shown.bridged;
          f.dTrack = distanceToDrawn(tn.net, idx, c.x, c.z, 200);
          // Is Lane T's run itself on the drawn track here (its centre within 0.5 m of a drawn piece)?
          const q = m.openAir.present(net.paths[d.tunnel.path], d.tunnel.s, 0, smp);
          f.runOff = q.mapped ? distanceToDrawn(tn.net, idx, q.x, q.z, 200) : null;
        }
        frames.push(f);
        if (d.phase !== 'tunnel') break;
        if (until && since(d).some(a => is(a.name, until))) break;
        if (stopAtEdge && d.atEdge && d.tunnel.speed === 0) break;
      }
    } finally {
      for (const k of keys) ug.fpsControls.keys.delete(k);
    }
    const d = m.debug();
    return { frames, arrivals: since(d), cuts: d.openAir.cuts, ratio: st.ratio, end: { tunnel: d.tunnel, regime: d.regime, atEdge: d.atEdge,
      edge: d.edge, hint: document.getElementById('ug-mode-hint')?.textContent ?? '' } };
  }, { lineId, until, keys, maxMs, via, stopAtEdge });
}

/** The checks on every open-air frame of a ride. */
function checkOpenFrames(r, label) {
  const open = r.frames.filter(f => f.regime === 'open' && f.phase === 'tunnel');
  expect(open.length, `${label}: frames shown on the drawn track`).toBeGreaterThan(30);
  let onRun = 0, within = 0;
  for (const f of open) {
    expect(f.y, `${label}: above the terrain at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeGreaterThanOrEqual(f.g + 0.5 * VE * r.ratio - 1e-6);
    if (f.inside >= 0.999) expect(f.above, `${label}: the D-040 cull holds at insideness ${f.inside}`).toBe(true);
    expect(f.interior, `${label}: no lining in the open`).toBe(false);
    if (f.bridged) continue;   // a bridged gap of under 20 m: no drawn track there by definition
    const lim = 2.6 + (f.extra || 0) + 1;
    expect(f.dTrack, `${label}: near the drawn track (Lane T's run ${f.runOff?.toFixed(1)} m off it) at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeLessThanOrEqual(lim + TRACK_SLACK_M);
    if (f.runOff !== null && f.runOff <= 0.5) { onRun++; if (f.dTrack <= lim) within++; else expect(f.dTrack, `${label}: on the drawn track in its lane at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeLessThanOrEqual(lim); }
  }
  expect(onRun / open.length, `${label}: most of the walk is on the drawn track itself`).toBeGreaterThan(0.9);
  return { open: open.length, onRun, within };
}

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
      // A station link (the DLR's split stations) or a change of path is a step, not travel.
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

/** Regime runs, as [regime, chord metres] (consecutive frames on one path summed), shorter than minM dropped and neighbours merged. */
function regimes(r, minM = 150) {
  const runs = [];
  let prev = null;
  for (const f of r.frames) {
    if (f.phase !== 'tunnel') continue;
    const dm = prev && prev.path === f.path ? Math.abs(f.s - prev.s) : 0;
    const last = runs.at(-1);
    if (!last || last.regime !== f.regime) runs.push({ regime: f.regime, m: dm, from: f.arrivals, to: f.arrivals });
    else { last.m += dm; last.to = f.arrivals; }
    prev = f;
  }
  const big = runs.filter(x => x.m >= minM);
  const merged = [];
  for (const x of big) { const l = merged.at(-1); if (l && l.regime === x.regime) { l.m += x.m; l.to = x.to; } else merged.push({ ...x }); }
  return merged;
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await boot();
  K = await page.evaluate(async () => { const P = await import('/src/modes/pedestrian.js');
    return { zone: P.PLATFORM_ZONE_M, entrance: P.ENTRANCE_RADIUS_M, aside: P.STEP_ASIDE_M, hold: P.ARRIVAL_HOLD_M }; });
});
test.afterAll(async () => { await page?.close(); });

test('Northern, Hampstead to Edgware: out of the tunnel at Golders Green and on to the end of the line, every stop arrived at', async () => {
  expect(await placeAt('northern', 'Hampstead', 'Golders Green')).not.toBeNull();
  const r = await ride({ lineId: 'northern', until: 'Edgware' });
  const names = r.arrivals.map(a => a.name);
  expect(names).toEqual(['Golders Green', 'Brent Cross', 'Hendon Central', 'Colindale', 'Burnt Oak', 'Edgware']);
  expect(r.arrivals.filter(a => a.regime === 'open').length, 'arrivals shown in the open').toBeGreaterThanOrEqual(4);
  // Never a card on the way (the street only at stations, offered when the walker stops), never the old portal card.
  expect(r.frames.every(f => f.card === null || f.card === 'arrival')).toBe(true);
  expect(r.frames.some(f => /leaves its tunnel/.test(f.hint))).toBe(false);
  // The cut out of the Hampstead tunnel: a flare, the walk at full speed across it.
  const k = r.frames.findIndex(f => f.regime === 'open');
  expect(k).toBeGreaterThan(0);
  expect(r.frames[k].cut).toBe('flare');
  expect(r.frames[k].flare).toBeGreaterThan(0);
  expect(r.frames[k - 1].speed).toBe(200);
  expect(r.frames[k].speed).toBe(200);
  expect(r.cuts.some(c => c.kind === 'flare')).toBe(true);
  const c = checkOpenFrames(r, 'Northern');
  const v = speeds(r, 200);
  expect(v.length).toBeGreaterThan(10);
  expect(Math.abs(median(v) - 200), `median ${median(v)}`).toBeLessThanOrEqual(6);
  console.log('[open-air] Northern', JSON.stringify({ ...c, speed: [v[0], median(v), v.at(-1)].map(x => +x.toFixed(1)) }));
});

// Three legs, each from where the last one ends (placed, so that each leg stands alone).
for (const [leg, from, toward, until] of [[1, 'Stepney Green', 'Mile End', 'Barking'], [2, 'Barking', 'Upney', 'Dagenham East'], [3, 'Dagenham East', 'Elm Park', 'Upminster']]) {
  test(`District, Stepney Green to Upminster, leg ${leg} (${from} to ${until})`, async () => {
    expect(await placeAt('district', from, toward)).not.toBeNull();
    const r = await ride({ lineId: 'district', until });
    expect(r.arrivals.map(a => a.name)).toContain(until);
    if (leg === 1) {
      expect(r.frames[0].regime).toBe('bore');
      expect(r.cuts.some(c => c.kind === 'flare')).toBe(true);
    }
    checkOpenFrames(r, `District leg ${leg}`);
    const v = speeds(r, 200);
    if (v.length > 5) expect(Math.abs(median(v) - 200)).toBeLessThanOrEqual(6);
    if (leg === 3) {
      expect(r.end.tunnel.lineId).toBe('district');
      // Upminster is the end of the line: the walk is held there (the path's end), shown in the open.
      expect(r.end.regime).toBe('open');
    }
  });
}

test('Metropolitan, Moor Park to Rickmansworth and on to the map edge: 60 m/s along the drawn track, then Shift; held 150 m inside the edge', async () => {
  expect(await placeAt('metropolitan', 'Moor Park', 'Rickmansworth')).not.toBeNull();
  const slow = await ride({ lineId: 'metropolitan', keys: ['w'], maxMs: 9000, stopAtEdge: false });
  const v60 = speeds(slow, 60);
  expect(v60.length).toBeGreaterThan(5);
  for (const x of v60) expect(Math.abs(x - 60), `60 m/s window ${x}`).toBeLessThanOrEqual(2);
  const r = await ride({ lineId: 'metropolitan', maxMs: 50000 });
  const names = slow.arrivals.concat(r.arrivals).map(a => a.name);
  expect(names).toContain('Rickmansworth');
  expect(names.some(n => /Chorleywood|Chalfont|Amersham|Chesham/.test(n)), 'nothing beyond the edge is a stop').toBe(false);
  expect(r.end.atEdge).toBe(true);
  expect(r.end.hint).toContain('The map ends here · S walks back');
  checkOpenFrames(r, 'Metropolitan');
  const v = speeds(r, 200);
  expect(v.length).toBeGreaterThan(5);
  for (const x of v) expect(Math.abs(x - 200), `200 m/s window ${x}`).toBeLessThanOrEqual(6);
  // The hold sits at least 100 m inside the map's drawn edge, and S walks back.
  const at = await page.evaluate(async () => {
    const { getMapEdgeRing, signedDistanceToRing } = await import('/src/m25-edge.js');
    const c = window.__ug.camera.position;
    return signedDistanceToRing(c.x, c.z, getMapEdgeRing());
  });
  expect(at, 'the hold is well inside the edge ring').toBeGreaterThanOrEqual(100);
  const s0 = (await dbg()).tunnel.s;
  await page.evaluate(() => window.__ug.fpsControls.keys.add('s'));
  await page.waitForFunction((s0) => Math.abs(window.__ug.modes.registry.get('pedestrian').debug().tunnel.s - s0) > 30, s0, { timeout: 10000 });
  await page.evaluate(() => window.__ug.fpsControls.keys.delete('s'));
});

test('DLR, Bank to Lewisham: every station in order; bore, open, bore at Cutty Sark, open', async () => {
  expect(await placeAt('dlr', 'Bank', 'Shadwell')).not.toBeNull();
  const order = ['Shadwell', 'Limehouse', 'Westferry', 'West India Quay', 'Canary Wharf', 'Heron Quays', 'South Quay', 'Crossharbour',
    'Mudchute', 'Island Gardens', 'Cutty Sark', 'Greenwich', 'Deptford Bridge', 'Elverson Road', 'Lewisham'];
  const r = await ride({ lineId: 'dlr', until: 'Lewisham', via: order });
  const names = r.arrivals.map(a => a.name);
  expect(names.map(n => n.replace(/\s*\(.*\)$/, ''))).toEqual(order);
  const seq = regimes(r);
  expect(seq.map(x => x.regime), JSON.stringify(seq)).toEqual(['bore', 'open', 'bore', 'open']);
  // Cutty Sark is arrived at in the bore under the river; Greenwich in the open after it.
  const cutty = r.arrivals.findIndex(a => a.name.startsWith('Cutty Sark')) + 1, greenwich = r.arrivals.findIndex(a => a.name.startsWith('Greenwich')) + 1;
  expect(cutty).toBeGreaterThanOrEqual(seq[2].from); expect(cutty).toBeLessThanOrEqual(seq[2].to);
  expect(greenwich).toBeGreaterThanOrEqual(seq[3].from);
  expect(r.arrivals.find(a => a.name.startsWith('Cutty Sark')).regime).toBe('bore');
  expect(r.arrivals.find(a => a.name.startsWith('Canary Wharf')).regime).toBe('open');
  checkOpenFrames(r, 'DLR');
  const v = speeds(r, 200);
  expect(Math.abs(median(v) - 200)).toBeLessThanOrEqual(6);
});

test('Central, Mile End to Leytonstone: out of the tunnel and on, Leyton and Leytonstone arrived at in the open', async () => {
  expect(await placeAt('central', 'Mile End', 'Stratford')).not.toBeNull();
  const r = await ride({ lineId: 'central', until: 'Leytonstone' });
  expect(r.arrivals.map(a => a.name)).toEqual(['Stratford', 'Leyton', 'Leytonstone']);
  expect(r.arrivals.find(a => a.name === 'Leytonstone').regime).toBe('open');
  expect(r.cuts.some(c => c.kind === 'flare')).toBe(true);
  // The first open-air frame lies near one of Lane R's portal records for the line (the mouth on the drawn track).
  const k = r.frames.findIndex(f => f.regime === 'open');
  const near = await page.evaluate(async ([x, z]) => {
    const { BNG_REF_E, BNG_REF_N } = await import('/src/coordinates.js');
    const L = window.__ug.surfaceRail.data.lines.find(l => l.id === 'central');
    return Math.min(...L.portals.map(q => Math.hypot(q.e - BNG_REF_E - x, -(q.n - BNG_REF_N) - z)));
  }, [r.frames[k].x, r.frames[k].z]);
  expect(near, `the first open frame ${near.toFixed(0)} m from a portal record`).toBeLessThanOrEqual(50);
  checkOpenFrames(r, 'Central');
});

test('Central, Debden to Theydon Bois and the map edge: Theydon Bois is the last stop, Epping is beyond the map', async () => {
  expect(await placeAt('central', 'Debden', 'Theydon Bois')).not.toBeNull();
  const r = await ride({ lineId: 'central' });
  expect(r.arrivals.map(a => a.name)).toEqual(['Theydon Bois']);
  expect(r.end.atEdge).toBe(true);
  expect(r.end.hint).toContain('The map ends here');
  checkOpenFrames(r, 'Central edge');
  // Epping is not a stop, but "towards Epping" still reads at Theydon Bois.
  const rows = await page.evaluate(() => {
    const m = window.__ug.modes.registry.get('pedestrian');
    const net = m.network;
    const e = net.entrances.find(en => en.name === 'Theydon Bois');
    return { epping: net.entrances.some(en => en.name === 'Epping'), stops: e?.stops.length ?? 0 };
  });
  expect(rows.epping).toBe(false);
  expect(rows.stops).toBeGreaterThan(0);
  const arr = await page.evaluate(async () => {
    const m = window.__ug.modes.registry.get('pedestrian');
    const { platformRows } = await import('/src/modes/tube-routes.js');
    const net = m.network;
    return platformRows(net, net.entrances.find(en => en.name === 'Theydon Bois'), { tubeRoutes: window.__ug.modes.ctx.tubeRoutes }).map(r => r.label);
  });
  expect(arr).toContain('Central · towards Epping');
});

for (const [leg, from, toward, until] of [[1, 'Swiss Cottage', 'Finchley Road', 'Wembley Park'], [2, 'Wembley Park', 'Kingsbury', 'Stanmore']]) {
  test(`Jubilee, Swiss Cottage to Stanmore, leg ${leg} (${from} to ${until})`, async () => {
    expect(await placeAt('jubilee', from, toward)).not.toBeNull();
    const r = await ride({ lineId: 'jubilee', until });
    expect(r.arrivals.map(a => a.name)).toContain(until);
    checkOpenFrames(r, `Jubilee leg ${leg}`);
    if (leg === 1) {
      // Lane R removed the Jubilee's 227 m stub beside West Hampstead (sprint 01Oct26h): West Hampstead is an
      // open-air station in the data, and nothing between Finchley Road and Kilburn is in the bore. Made
      // unconditional at integration, now that lane R's data is merged.
      const fixed = await page.evaluate(() => {
        const L = window.__ug.surfaceRail.data.lines.find(l => l.id === 'jubilee');
        const wh = L.stations.find(s => /West Hampstead/.test(s.name));
        return !!wh && (wh.surface === true || wh.trackClass !== 'tunnel');
      });
      expect(fixed, 'West Hampstead is open-air in the surface data (lane R dropped the stub)').toBe(true);
      const i0 = r.arrivals.findIndex(a => a.name === 'Finchley Road') + 1, i1 = r.arrivals.findIndex(a => a.name === 'Kilburn') + 1;
      expect(i0).toBeGreaterThan(0); expect(i1).toBeGreaterThan(i0);
      const between = r.frames.filter(f => f.arrivals >= i0 && f.arrivals < i1);
      expect(between.length, 'frames walked between Finchley Road and Kilburn').toBeGreaterThan(0);
      expect(r.arrivals.map(a => a.name), 'West Hampstead arrived at between them').toContain('West Hampstead');
      expect(between.filter(f => f.regime === 'bore').length, 'no bore frame between Finchley Road and Kilburn').toBe(0);
    }
  });
}

test('surface trains pass through the walker in the open: rumble and a brief shake, never a stop', async () => {
  await page.mouse.click(5, 300); // a user gesture: the mode voices have a bus
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const net = m.rebuildNetwork(), oa = m.openAir, st = ug.surfaceTrains;
    const { sampleRun } = await import('/src/surface-train-map.js');
    for (const lineId of ['district', 'metropolitan', 'central']) {
      oa.ensureLine(net, lineId);
      const simT = ug.trainSystem.simTime, pt = {}, pt2 = {};
      let pick = null;
      for (const t of ug.trainSystem.allTrains) {
        if (t.userData.lineId !== lineId) continue;
        const a = st.placeAt(t, simT, Infinity), b = st.placeAt(t, simT + 1, Infinity);
        if (!a || !b) continue;
        sampleRun(a.run, a.s, st.ratio, pt, 0, -a.sign); sampleRun(b.run, b.s, st.ratio, pt2, 0, -b.sign);
        if (!pt.open || !pt.drawn || !pt2.open) continue;
        const H = { x: pt2.x - pt.x, z: pt2.z - pt.z };
        if (Math.hypot(H.x, H.z) < 3) continue;
        for (const p of net.paths) {
          if (p.lineId !== lineId) continue;
          let best = null;
          for (let s = 0; s <= p.length; s += 20) { const q = oa.present(p, s, 0, {}); if (!q.open) continue; const d = Math.hypot(q.x - pt.x, q.z - pt.z); if (!best || d < best.d) best = { d, s, hx: q.hx, hz: q.hz }; }
          if (!best || best.d > 15) continue;
          const dir = (H.x * best.hx + H.z * best.hz) > 0 ? 1 : -1;
          const s0 = best.s + dir * 500;   // 500 m ahead of the train, in its lane, walking toward it
          if (s0 < 0 || s0 > p.length) continue;
          let ok = true;
          for (let s = Math.min(s0, best.s); s <= Math.max(s0, best.s); s += 20) if (!oa.isOpen(p, s)) { ok = false; break; }
          if (ok) { pick = { path: p.id, s0, dir }; break; }
        }
        if (pick) break;
      }
      if (!pick) continue;
      m.placeInTunnel({ path: pick.path, s: pick.s0, dir: -pick.dir, side: pick.dir });
      await frame(); await frame();
      ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
      const log = [];
      const t0 = performance.now();
      let seen = 0;
      while (performance.now() - t0 < 12000) {
        await frame();
        const d = m.debug(), lv = ug.modes.sfx.levels();
        log.push({ regime: d.regime, inside: !!d.lastPass?.inside, rumble: d.lastPass?.rumble ?? 0, shake: d.shake, passT: d.passT, speed: d.tunnel?.speed, lv: lv?.trainRumble ?? 0 });
        if (d.lastPass?.inside) seen++;
        if (seen > 3 && !d.lastPass?.inside) break;
      }
      ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
      return { lineId, log, passes: m.debug().openAir.passes };
    }
    return { error: 'no surface train found running in the open' };
  });
  expect(r.error).toBeUndefined();
  const inside = r.log.filter(f => f.inside);
  expect(inside.length).toBeGreaterThan(0);
  expect(inside.every(f => f.regime === 'open'), 'the pass is in the open').toBe(true);
  expect(Math.max(...r.log.map(f => f.rumble))).toBeGreaterThan(0.05);
  expect(Math.max(...r.log.map(f => f.shake))).toBeGreaterThan(0.005);
  expect(Math.max(...r.log.map(f => f.lv))).toBeGreaterThan(0.05);
  // Never slowed: every frame inside the train at the full sprint once reached.
  const reached = r.log.findIndex(f => f.speed === 200);
  r.log.forEach((f, k) => { if (f.inside && k >= reached) expect(f.speed).toBe(200); });
  // Brief: past 1.8 s into a pass the shake has all but gone.
  for (const f of r.log) if (f.passT !== null && f.passT > 1.8) expect(f.shake).toBeLessThan(0.001);
  expect(r.passes).toBeGreaterThanOrEqual(1);
});

test('a surface stop: the card offers the street, which is an ease to the station building\'s exit pose on the ground; from the street, a surface platform eases onto the track', async () => {
  expect(await placeAt('district', 'Upminster Bridge', 'Upminster')).not.toBeNull();
  await ride({ lineId: 'district', until: 'Upminster', keys: ['w'], maxMs: 30000 });
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 20000 });
  const card = await dbg();
  expect(card.regime).toBe('open');
  expect(card.chooser.rows[0]).toBe('Up to the street');
  await page.keyboard.press('1');
  const seen = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const log = [];
    for (let i = 0; i < 300; i++) { await frame(); const d = m.debug(), c = ug.camera.position; log.push({ phase: d.phase, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z), near: d.near, step: d.step }); if (d.phase === 'body') break; }
    return log;
  });
  expect(seen.some(f => f.phase === 'step')).toBe(true);
  expect(seen.at(-1).phase).toBe('body');
  for (const f of seen) expect(f.y).toBeGreaterThanOrEqual(f.g + 1 * VE - 1e-6);   // the ease is above the terrain
  // s02:B (D-048 item 4, B6.2): "Up to the street" is an ease to the station building's exit pose, outside the
  // building and facing the street: the one pose stationExitPose gives (was: a step aside of 12, 20 or 30 m).
  const st = seen.find(f => f.step)?.step;
  expect(st.stop.name).toBe('Upminster');
  const pose = await page.evaluate(() => window.__ug.stationBuildings.stationExitPose(window.__ug.stationBuildings.siteKeyOf('Upminster')));
  expect(pose).not.toBeNull();
  expect(st.pose).toEqual(pose);
  expect(st.building).toBeTruthy();
  expect(Math.hypot(st.to.x - pose.x, st.to.z - pose.z)).toBeLessThan(1e-6);
  const d = await dbg();
  expect(d.state).toBe('ground');
  const where = await page.evaluate(([x, z]) => {
    const c = window.__ug.modes.collision;
    return { ground: c.groundHeightAt(x, z), top: c.standHeightAt(x, z, Infinity, 0), water: !!c.waterAt(x, z) };
  }, [d.x, d.z]);
  expect(d.y).toBeCloseTo(where.ground, 3);
  expect(where.water).toBe(false);
  expect(where.top).toBeLessThanOrEqual(where.ground + 0.5 * VE);   // not under a roof
  // From the street: the first of these whose platforms are in the open (Lane R's data places Wembley Park's
  // in a covered box today, sprint 01Oct26h; the others are in the open).
  const entry = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    for (const name of ['Wembley Park', 'Neasden', 'Kingsbury', 'Dollis Hill']) {
      const e = m.rebuildNetwork().entrances.find(en => en.name === name);
      if (!e) continue;
      m.place(e.x + 12, e.z + 8, { yaw: 0 });
      await frame();
      m.press('use');
      for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card?.kind === 'shaft') break; }
      const rows = m.chooser.rows;
      const i = rows.findIndex(r => r.surface);
      if (i < 0) { m.chooser.close(); continue; }
      const kicker = m.debug().chooser.kicker;
      m.chooseRow(i);
      const log = [];
      for (let k = 0; k < 300; k++) { await frame(); const d = m.debug(), c = ug.camera.position; log.push({ phase: d.phase, regime: d.regime, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z) }); if (d.phase === 'tunnel') break; }
      const d = m.debug();
      return { name, kicker, row: rows[i].label, log, end: { phase: d.phase, regime: d.regime, lineId: d.tunnel?.lineId, near: d.near, interior: d.interior.visible } };
    }
    return null;
  });
  expect(entry, 'a surface platform to step onto').not.toBeNull();
  test.info().annotations.push({ type: 'street entry', description: `${entry.name}: ${entry.row}` });
  expect(entry.log.some(f => f.phase === 'step')).toBe(true);
  for (const f of entry.log) expect(f.y).toBeGreaterThanOrEqual(f.g + 1 * VE - 1e-6);
  expect(entry.end).toMatchObject({ phase: 'tunnel', regime: 'open', interior: false });
});

// Fix round 1 (the verifier: District, Elm Park toward Hornchurch at 200 m/s, E 0.5 s after the arrival,
// the street picked: the walker stepped out 106 m from Hornchurch). D-042 item 1: "only possible to exit
// them at stations". Off the platform, E brings the walker back to the station; the card is never on offer
// away from it; the step aside is from the station's point on the drawn track.
test('the street only at the station: E pressed past a surface stop at 200 m/s brings the walker back to it, and the exit is beside the station building', async () => {
  expect(await placeAt('district', 'Elm Park', 'Hornchurch')).not.toBeNull();
  const r = await page.evaluate(async (K) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const hintNow = () => document.getElementById('ug-mode-hint')?.textContent ?? '';
    const c0 = m.debug().clock;   // arrivals by the clock, not the capped log's length
    ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
    let arr = null, d;
    const log = [];
    const t0 = performance.now();
    try {
      while (performance.now() - t0 < 30000) {
        await frame(); d = m.debug();
        if (!arr && d.arrivals.at(-1)?.at > c0) arr = { ...d.arrivals.at(-1) };
        if (arr && d.clock - arr.at >= 0.5) break;
      }
      // Still moving at full speed, W and Shift held: E.
      const pressed = { past: Math.abs(d.tunnel.s - arr.s), speed: d.tunnel.speed };
      m.press('use');
      for (let i = 0; i < 10; i++) { await frame(); d = m.debug(); log.push({ s: d.tunnel?.s, card: d.card?.kind ?? null, hint: hintNow() }); }
      ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
      const t1 = performance.now();
      while (performance.now() - t1 < 10000 && d.card?.kind !== 'arrival') {
        await frame(); d = m.debug(); log.push({ s: d.tunnel?.s, card: d.card?.kind ?? null, hint: hintNow() });
      }
      if (d.card?.kind !== 'arrival') return { arr, pressed, card: d.card, log: log.slice(-5) };
      const cardPast = Math.abs(d.tunnel.s - arr.s), rows = d.chooser.rows;
      m.chooseRow(0);
      let step = null;
      for (let i = 0; i < 120; i++) { await frame(); d = m.debug(); step ??= d.step; if (d.phase === 'body') break; }
      for (let i = 0; i < 3; i++) await frame();
      d = m.debug();
      const ent = m.network.entrances.find(en => en.stops.some(st => st.path === arr.path && Math.abs(st.s - arr.s) < 1e-6));
      return { arr: { name: arr.name, s: arr.s }, pressed, cardPast, rows, step, log, end: { phase: d.phase, state: d.state, x: d.x, z: d.z },
        endFromEntrance: Math.hypot(d.x - ent.x, d.z - ent.z), stationFromEntrance: Math.hypot(step.station.x - ent.x, step.station.z - ent.z), hint: hintNow() };
    } finally { ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift'); }
  }, K);
  expect(r.arr.name).toBe('Hornchurch');
  expect(r.pressed.speed, 'E pressed at full speed').toBeCloseTo(200, 6);
  expect(r.pressed.past, 'E pressed off the platform').toBeGreaterThan(K.zone);
  expect(r.log.some(f => /^Back to Hornchurch/.test(f.hint)), 'the hint says the walker is going back').toBe(true);
  for (const f of r.log) if (f.card === 'arrival') expect(Math.abs(f.s - r.arr.s), 'the card only on the platform').toBeLessThanOrEqual(K.zone);
  expect(r.cardPast, 'the card opens back at the stop').toBeLessThan(0.5);
  expect(r.rows[0]).toBe('Up to the street');
  expect(r.step).toMatchObject({ kind: 'exit', stop: { name: 'Hornchurch' } });
  // s02:B: the exit pose of Hornchurch's station building (was: 12, 20 or 30 m aside of the station's point). It stands
  // outside the building, so it is further from the station's point than a step aside could be, but never far from it.
  const aside = Math.hypot(r.step.to.x - r.step.station.x, r.step.to.z - r.step.station.z);
  expect(r.step.pose, 'the exit is the building\'s pose').toBeTruthy();
  expect(r.step.building).toBeTruthy();
  expect(aside, `exit ${aside.toFixed(1)} m from the station's point`).toBeLessThanOrEqual(300);
  expect(r.end).toMatchObject({ phase: 'body', state: 'ground' });
  test.info().annotations.push({ type: 'street exit', description: `E ${r.pressed.past.toFixed(0)} m past at 200 m/s; stepped out ${aside.toFixed(1)} m aside of the station's point, ${r.endFromEntrance.toFixed(1)} m from the entrance` });
  // Back on the street at the station: E offers its platforms again (where the drawn track runs that close to it).
  if (r.stationFromEntrance + aside <= K.entrance) {
    expect(r.endFromEntrance).toBeLessThanOrEqual(K.entrance);
    expect(r.hint).toContain('choose a platform at Hornchurch');
  }
});

// Fix round 1 (the verifier: Central, Stratford in a covered box, E 34 m out in the open, the street picked: the
// shaft's passage eased from the open air down through the ground to the platform). Where a station is shown in
// the other regime from the walker standing inside its platform zone, the street goes there through a cut.
test('the street from a station shown in the other regime than the walker: a cut, never an ease through the ground', async () => {
  const r = await page.evaluate(async (K) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const { nearestStopOnPath } = await import('/src/modes/pedestrian-tunnels.js');
    const net = m.rebuildNetwork(), oa = m.openAir;
    for (const l of new Set(net.paths.map(p => p.lineId))) oa.ensureLine(net, l);
    // Stops with the other regime well inside their own platform zone (10 m or more from the stop).
    const found = { bore: null, open: null };
    for (const p of net.paths) {
      for (const { s, stop } of p.stops) {
        const open = oa.isOpen(p, s), kind = open ? 'open' : 'bore';
        if (found[kind] || (!open && !(stop.depthM >= 10))) continue;   // a bore stop well below the street
        for (let ds = 10; ds <= K.zone - 5 && !found[kind]; ds += 2) {
          for (const sg of [1, -1]) {
            const ss = s + sg * ds;
            if (ss < 0 || ss > p.length || oa.isOpen(p, ss) === open || nearestStopOnPath(net, p.id, ss, K.zone) !== stop) continue;
            found[kind] = { path: p.id, s: ss, stopS: s, name: stop.name, lineId: p.lineId };
            break;
          }
        }
      }
    }
    const out = {};
    for (const [kind, f] of Object.entries(found)) {
      if (!f) continue;
      m.placeInTunnel({ path: f.path, s: f.s, dir: 1 });
      for (let i = 0; i < 3; i++) await frame();
      const before = m.debug().regime;
      m.press('use');
      let d;
      for (let i = 0; i < 30; i++) { await frame(); d = m.debug(); if (d.card?.kind === 'arrival') break; }
      if (d.card?.kind !== 'arrival') { out[kind] = { ...f, before, card: d.card }; continue; }
      m.chooseRow(0);
      const log = [];
      for (let i = 0; i < 900; i++) {
        await frame(); d = m.debug(); const c = ug.camera.position;
        log.push({ phase: d.phase, regime: d.regime, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z), interior: d.interior.visible, cut: d.openAir.cut?.kind ?? null, step: d.step });
        if (d.phase === 'body') break;
      }
      out[kind] = { ...f, before, first: log[0], end: log.at(-1), n: log.length,
        downThrough: log.findIndex((x, i) => i > 0 && log[i - 1].y >= log[i - 1].g && x.y < x.g),
        stepBelow: log.filter(x => x.phase === 'step' && x.y < x.g + 1 * 5 - 1e-6).length,
        step: log.find(x => x.step)?.step ?? null, end2: { phase: d.phase, state: d.state, x: d.x, z: d.z } };
    }
    return out;
  }, K);
  test.info().annotations.push({ type: 'stations', description: `bore stop, walker in the open: ${r.bore?.lineId} ${r.bore?.name}; surface stop, walker in the bore: ${r.open?.lineId} ${r.open?.name}` });
  // A station in the bore, the walker in the open inside its platform zone: a dip, then the shaft from the bore.
  expect(r.bore, 'a station in the bore with the open air inside its platform zone').toBeTruthy();
  expect(r.bore.before).toBe('open');
  expect(r.bore.first).toMatchObject({ phase: 'shaft', regime: 'bore', cut: 'dip', interior: true });
  expect(r.bore.first.y, 'in the bore at once').toBeLessThan(r.bore.first.g);
  expect(r.bore.downThrough, 'never down through the ground').toBe(-1);
  expect(r.bore.end2).toMatchObject({ phase: 'body', state: 'ground' });
  // A station in the open, the walker in the bore inside its platform zone: a flare, then the step aside.
  expect(r.open, 'a station in the open with the bore inside its platform zone').toBeTruthy();
  expect(r.open.before).toBe('bore');
  expect(r.open.first).toMatchObject({ phase: 'step', cut: 'flare', interior: false });
  expect(r.open.stepBelow, 'the step stays above the terrain').toBe(0);
  // s02:B: to the station building's exit pose (was: a step aside of at most 30 m).
  const aside = Math.hypot(r.open.step.to.x - r.open.step.station.x, r.open.step.to.z - r.open.step.station.z);
  expect(r.open.step.pose).toBeTruthy();
  expect(aside).toBeLessThanOrEqual(300);
  expect(r.open.end2).toMatchObject({ phase: 'body', state: 'ground' });
});

test('the overshoot: released 0.25 s after an arrival at 200 m/s, the walker stops within 53 m, glides back to the stop and the card opens', async () => {
  expect(await placeAt('jubilee', 'Kingsbury', 'Queensbury')).not.toBeNull();
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
    const c0 = m.debug().clock;   // arrivals by the clock, not the capped log's length
    let arrClock = null, releaseS = null;
    const log = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      await frame();
      const d = m.debug();
      if (arrClock === null && d.arrivals.at(-1)?.at > c0) arrClock = d.clock;
      if (arrClock !== null && releaseS === null && d.clock - arrClock >= 0.25) {
        ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift'); releaseS = d.tunnel.s;
      }
      if (arrClock !== null) log.push({ s: d.tunnel.s, v: d.tunnel.speed, glide: !!d.glide, card: d.card?.kind ?? null });
      if (d.card?.kind === 'arrival') break;
    }
    ug.fpsControls.keys.delete('w'); ug.fpsControls.keys.delete('shift');
    const d = m.debug();
    return { stop: d.arrivals.at(-1), releaseS, restS: log.find(f => f.v === 0)?.s ?? null, glided: log.some(f => f.glide), end: d.tunnel.s, card: d.card, rows: d.chooser.rows };
  });
  expect(r.stop.name).toBe('Queensbury');
  expect(r.releaseS).not.toBeNull();
  expect(Math.abs(r.restS - r.releaseS), 'braking from 200 m/s').toBeLessThanOrEqual(53);
  expect(r.glided).toBe(true);
  expect(Math.abs(r.end - r.stop.s), 'back at the stop').toBeLessThan(0.5);
  expect(r.card?.kind).toBe('arrival');
  expect(r.rows[0]).toBe('Up to the street');
  await page.keyboard.press('Escape');
});

// Fix round 2 (the verifier: District, Elm Park toward Hornchurch at 200 m/s, E pressed 25 to 55 m past the stop,
// inside its platform zone and still at speed, the natural press in reaction to the arrival banner: the card
// opened at once, the braking carried the walker out of the zone, the card closed, and the walker came to rest
// 77 to 106 m past with no card and the arrival marked as seen; Warren Street in the bore the same). E on the
// platform at speed now stops the walker at the station: brake to rest, then the card on the platform, or the
// glide back where the braking left it and then the card. Covered: the window the verifier found at 200 m/s
// and at 60 m/s, W held and W released, the press on the approach, a stop in the bore, and the press just past
// the stop where the walker comes to rest inside the zone (the control, where the card already stayed).
test('E on the platform at speed stops the walker at the station: at rest the card opens there, after the glide back if the braking carried it off the platform', async () => {
  // Presses are set from the zone's end (63 m today): braking takes 50 m from 200 m/s and 15 m from 60 m/s, so
  // the first three and the last come to rest beyond the zone, where the card was lost.
  const z = Math.round(K.zone);
  const cases = [
    { lineId: 'district', from: 'Elm Park', to: 'Hornchurch', press: z - 38, sprint: true, release: false },
    { lineId: 'district', from: 'Elm Park', to: 'Hornchurch', press: z - 18, sprint: true, release: true },
    { lineId: 'district', from: 'Elm Park', to: 'Hornchurch', press: z - 11, sprint: false, release: false },
    { lineId: 'district', from: 'Elm Park', to: 'Hornchurch', press: -30, sprint: true, release: false },
    { lineId: 'district', from: 'Elm Park', to: 'Hornchurch', press: 5, sprint: true, release: false },
    { lineId: 'victoria', from: 'Oxford Circus', to: 'Warren Street', press: z - 23, sprint: true, release: false },
  ];
  const lines = [], beyond = [];
  for (const c of cases) {
    const at = await placeAt(c.lineId, c.from, c.to);
    expect(at, `${c.lineId} ${c.from}`).not.toBeNull();
    const r = await page.evaluate(async ({ c, at }) => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
      const frame = () => new Promise(res => requestAnimationFrame(res));
      const hintNow = () => document.getElementById('ug-mode-hint')?.textContent ?? '';
      const net = m.network, p = net.paths[at.path];
      const st = p.stops.find(x => x.stop.name.startsWith(c.to) && (x.s - at.s) * at.dir > 0);
      // Start 600 m short of the stop (still between the two stations), so each case is a few seconds' walk.
      const s0 = Math.abs(st.s - at.s) > 700 ? st.s - at.dir * 600 : at.s;
      m.placeInTunnel({ path: at.path, s: s0, dir: at.dir });
      for (let i = 0; i < 3; i++) await frame();
      const keys = c.sprint ? ['w', 'shift'] : ['w'];
      for (const k of keys) ug.fpsControls.keys.add(k);
      const signed = (d) => (d.tunnel.s - st.s) * at.dir;   // + past the stop, - short of it
      let d, pressed = null;
      const log = [];
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < 20000) {
          await frame(); d = m.debug();
          if (d.phase !== 'tunnel') break;
          if (signed(d) >= c.press) break;
        }
        pressed = { past: signed(d), speed: d.tunnel.speed, phase: d.phase };
        m.press('use');
        if (c.release) { await frame(); for (const k of keys) ug.fpsControls.keys.delete(k); }
        const t1 = performance.now();
        while (performance.now() - t1 < 5000) {
          await frame(); d = m.debug();
          log.push({ past: signed(d), v: d.tunnel?.speed ?? null, card: d.card?.kind ?? null, glide: !!d.glide, halt: d.halt, hint: hintNow() });
          if (d.card?.kind === 'arrival' && d.tunnel?.speed === 0 && !d.glide) break;   // settled with the card
        }
      } finally { for (const k of keys) ug.fpsControls.keys.delete(k); }
      const rest = log.find(f => f.v === 0) ?? null;   // the first frame at rest (the glide, if any, begins on it)
      return { stop: st.stop.name, pressed, rest, end: log.at(-1), glided: log.some(f => f.glide), n: log.length,
        cardOff: log.filter(f => f.card === 'arrival' && Math.abs(f.past) > 0).map(f => f.past),
        firstHints: log.slice(0, 3).map(f => f.hint), rows: m.debug().chooser.rows };
    }, { c, at });
    const label = `${c.to} at ${c.sprint ? 200 : 60} m/s, E ${c.press} m ${c.press < 0 ? 'short of' : 'past'} the stop${c.release ? ', W released' : ''}`;
    // The case is the one meant: E pressed on the platform, at full speed.
    expect(r.pressed.phase, label).toBe('tunnel');
    expect(Math.abs(r.pressed.past), `${label}: pressed on the platform`).toBeLessThanOrEqual(K.zone);
    expect(r.pressed.speed, `${label}: pressed at speed`).toBeGreaterThan((c.sprint ? 200 : 60) * 0.95);
    // The end: the walker at rest at the station with its card, never left past it without one.
    expect(r.end.card, `${label}: the card opens (${JSON.stringify(r.end)})`).toBe('arrival');
    expect(r.end.v, label).toBe(0);
    expect(Math.abs(r.end.past), `${label}: the card on the platform`).toBeLessThanOrEqual(K.zone);
    expect(r.rows[0]).toBe('Up to the street');
    // Where the braking left the platform: the glide back, and the card at the stop.
    expect(r.rest, `${label}: came to rest`).not.toBeNull();
    if (Math.abs(r.rest.past) > K.zone) {
      beyond.push(`${c.to} ${c.sprint ? 200 : 60}`);
      expect(r.glided, `${label}: rest ${r.rest.past.toFixed(0)} m past, then the glide back`).toBe(true);
      expect(Math.abs(r.end.past), `${label}: back at the stop`).toBeLessThan(0.5);
    }
    for (const x of r.cardOff) expect(Math.abs(x), `${label}: the card only on the platform`).toBeLessThanOrEqual(K.zone);
    // Stopping, said at once (the hint is written before the press is read, so it follows a frame later).
    expect(r.firstHints.some(h => new RegExp(`^(Stopping at|Back to) ${c.to}`).test(h)), `${label}: ${r.firstHints.join(' | ')}`).toBe(true);
    lines.push(`${label}: rest ${r.rest.past.toFixed(0)} m, card at ${r.end.past.toFixed(1)} m${r.glided ? ' after the glide back' : ''}`);
  }
  test.info().annotations.push({ type: 'E at speed', description: lines.join('; ') });
  // The window the verifier found was exercised: at rest past the zone at 200 m/s, at 60 m/s and in the bore.
  expect(beyond, 'cases that came to rest beyond the platform zone').toEqual(expect.arrayContaining(['Hornchurch 200', 'Hornchurch 60', 'Warren Street 200']));
  await page.keyboard.press('Escape');
});

test('Terminal 4 reads "towards Cockfosters"', async () => {
  const rows = await page.evaluate(async () => {
    const m = window.__ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const e = m.rebuildNetwork().entrances.find(en => en.name === 'Heathrow Terminal 4');
    m.place(e.x + 8, e.z + 6, { yaw: 0 });
    await frame();
    m.press('use');
    for (let i = 0; i < 60; i++) { await frame(); if (m.debug().card) break; }
    const r = m.debug().chooser.rows;
    m.chooser.close();
    return r;
  });
  expect(rows).toEqual(['Piccadilly · towards Cockfosters']);
});

test('no station label is drawn in the bore, the walker\'s own line\'s included; in the open they are', async () => {
  const visible = () => page.evaluate(() => [...document.querySelectorAll('.station-label')].filter(e => {
    if (e.style.display === 'none') return false;
    for (let p = e; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }).map(e => e.textContent));
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r)); });
  expect(await placeAt('victoria', 'Oxford Circus', 'Warren Street')).not.toBeNull();
  await settle();
  expect((await dbg()).interior.visible).toBe(true);
  expect(await visible()).toEqual([]);
  expect(await placeAt('northern', 'Colindale', 'Burnt Oak')).not.toBeNull();
  await settle();
  const d = await dbg();
  expect(d.regime).toBe('open');
  expect((await visible()).length).toBeGreaterThan(0);
  // On the drawn track the station markers and shafts (sized for the view from the sky: 12 m balls at
  // platform level) are hidden as in the bore, and the lining is not drawn; leaving the mode restores them.
  expect(d.interior.visible).toBe(false);
  expect(d.interior.hiddenDevices).toBeGreaterThan(0);
  // s02:B: no white sphere is drawn in the mode or out of it (the spheres retired); the station buildings stand throughout.
  const markers = () => page.evaluate(() => { let n = 0; window.__ug.scene.traverse(o => { if (o.userData?.kind === 'station-markers' && o.visible) n++; }); return n; });
  expect(await markers()).toBe(0);
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  expect(await markers()).toBe(0);
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
});

test('an open-air fork, taken each way by facing the branch', async () => {
  const forks = [['district', 'Stamford Brook', 'Turnham Green', ['Chiswick Park', 'Gunnersbury']],
    ['dlr', 'Canary Wharf', 'West India Quay', ['Westferry', 'Poplar']]];
  for (const [line, from, j, branches] of forks) {
    for (const br of branches) {
      expect(await placeAt(line, from, j)).not.toBeNull();
      const r = await ride({ lineId: line, until: br, via: [j, br], maxMs: 40000 });
      expect(r.arrivals.map(a => a.name), `${line} at ${j}, facing ${br}`).toContain(br);
      expect(r.frames.filter(f => f.arrivals >= 1).every(f => f.regime === 'open' || f.regime === 'bore')).toBe(true);
    }
  }
});

test('changes of line: between the open air and the bore a cut, never an ease through the ground; between two surface platforms an ease above it', async () => {
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const net = m.rebuildNetwork(), oa = m.openAir;
    for (const l of new Set(net.paths.map(p => p.lineId))) oa.ensureLine(net, l);
    const open = (st) => oa.isOpen(net.paths[st.path], st.s);
    const arriveAt = async (st) => {
      const p = net.paths[st.path];
      m.placeInTunnel({ path: st.path, s: st.s, dir: st.s < p.length - 1 ? 1 : -1 });
      for (let i = 0; i < 3; i++) await frame();
      m.press('use');
      for (let i = 0; i < 30; i++) { await frame(); if (m.debug().card?.kind === 'arrival') break; }
      return m.chooser.rows;
    };
    const out = { cuts: [], eases: [] };
    for (const e of net.entrances) {
      if (new Set(e.stops.map(s => s.lineId)).size < 2) continue;
      const from = e.stops.find(open);
      if (!from) continue;
      const rows = await arriveAt(from);
      const i = rows.findIndex(r => r.kind === 'change' && !open(r.stop));
      const j = rows.findIndex(r => r.kind === 'change' && open(r.stop));
      if (i >= 0 && out.cuts.length < 2) {
        m.chooseRow(i); await frame();
        const d = m.debug();
        out.cuts.push({ name: e.name, phase: d.phase, regime: d.regime, cut: d.openAir.cut?.kind ?? null, interior: d.interior.visible });
        continue;
      }
      if (j >= 0 && out.eases.length < 1) {
        m.chooseRow(j);
        const log = [];
        for (let k = 0; k < 200; k++) { await frame(); const d = m.debug(), c = ug.camera.position; log.push({ phase: d.phase, regime: d.regime, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z), transferOpen: d.transfer?.open ?? null }); if (d.phase === 'tunnel' && k > 2) break; }
        out.eases.push({ name: e.name, log });
        continue;
      }
      m.chooser.close();
      if (out.cuts.length >= 2 && out.eases.length >= 1) break;
    }
    return out;
  });
  expect(r.cuts.length, 'an interchange where one line is in the open and another in the bore').toBeGreaterThan(0);
  for (const c of r.cuts) expect(c, c.name).toMatchObject({ phase: 'tunnel', regime: 'bore', cut: 'dip', interior: true });
  expect(r.eases.length, 'an interchange with two surface platforms').toBeGreaterThan(0);
  for (const e of r.eases) {
    expect(e.log.some(f => f.phase === 'transfer' && f.transferOpen === true), e.name).toBe(true);
    for (const f of e.log) expect(f.y, `${e.name}: the change stays above the ground`).toBeGreaterThanOrEqual(f.g + 1 * VE - 1e-6);
    expect(e.log.at(-1)).toMatchObject({ phase: 'tunnel', regime: 'open' });
  }
});

test('the mapping report: per line, built, timed, its refused open stretches listed', async () => {
  // Every line is mapped lazily within a budget a frame once the walker is in the mode (the walker's own line
  // synchronously): wait for the lazy pump to finish on its own.
  await page.waitForFunction(() => Object.values(window.__ug.modes.registry.get('pedestrian').openAirReport().lines)
    .every(v => !v.paths || v.mapped === v.paths), null, { timeout: 60000 });
  const rep = await page.evaluate(() => window.__ug.modes.registry.get('pedestrian').openAirReport());
  const lines = Object.entries(rep.lines).filter(([, v]) => v.paths);
  expect(lines.length).toBeGreaterThanOrEqual(12);
  for (const [lineId, v] of lines) {
    expect(v.mapped, lineId).toBe(v.paths);
    expect(Array.isArray(v.refused ?? []), lineId).toBe(true);
  }
  console.log('[open-air] mapping', JSON.stringify(Object.fromEntries(lines.map(([l, v]) => [l, { paths: v.paths, ms: v.ms, maxPathMs: v.maxPathMs,
    openKm: +((v.openM || 0) / 1000).toFixed(1), refused: (v.refused || []).map(x => `${x.from.replace(/ (Underground|DLR) Station/, '')}-${x.to.replace(/ (Underground|DLR) Station/, '')}`) }]))));
});

test('surface stops are stops: every station of a line in the open is arrived at, and none beyond the edge', async () => {
  const s = await page.evaluate(() => {
    const m = window.__ug.modes.registry.get('pedestrian');
    const net = m.rebuildNetwork();
    const st = net.paths.flatMap(p => p.stops.map(x => x.stop));
    return { shallow: st.filter(x => x.shallow).length, all: st.length, epping: st.some(x => /^Epping/.test(x.name)), chorleywood: st.some(x => /^Chorleywood/.test(x.name)),
      edgeStops: net.stats.edgeStops, links: net.stats.links };
  });
  expect(s.shallow).toBeGreaterThan(0);
  expect(s.epping).toBe(false);
  expect(s.chorleywood).toBe(false);
  expect(s.edgeStops).toBeGreaterThanOrEqual(2);
  expect(s.links).toBeGreaterThan(0);
});
