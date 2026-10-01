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
    const a0 = m.debug().arrivals.length;
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
          while (vi < via.length && d0.arrivals.slice(a0).some(a => is(a.name, via[vi]))) vi++;
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
          hint: document.getElementById('ug-mode-hint')?.textContent ?? '', arrivals: d.arrivals.length - a0 };
        if (d.regime === 'open' && d.shown) {
          f.extra = d.shown.extra; f.lane = d.shown.lane; f.bridged = !!d.shown.bridged;
          f.dTrack = distanceToDrawn(tn.net, idx, c.x, c.z, 200);
          // Is Lane T's run itself on the drawn track here (its centre within 0.5 m of a drawn piece)?
          const q = m.openAir.present(net.paths[d.tunnel.path], d.tunnel.s, 0, smp);
          f.runOff = q.mapped ? distanceToDrawn(tn.net, idx, q.x, q.z, 200) : null;
        }
        frames.push(f);
        if (d.phase !== 'tunnel') break;
        if (until && d.arrivals.slice(a0).some(a => is(a.name, until))) break;
        if (stopAtEdge && d.atEdge && d.tunnel.speed === 0) break;
      }
    } finally {
      for (const k of keys) ug.fpsControls.keys.delete(k);
    }
    const d = m.debug();
    return { frames, arrivals: d.arrivals.slice(a0), cuts: d.openAir.cuts, ratio: st.ratio, end: { tunnel: d.tunnel, regime: d.regime, atEdge: d.atEdge,
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
      // Lane R removes the Jubilee's 227 m stub beside West Hampstead (sprint 01Oct26h); once it is gone from
      // the data, nothing between Finchley Road and Kilburn is in the bore.
      const fixed = await page.evaluate(() => {
        const L = window.__ug.surfaceRail.data.lines.find(l => l.id === 'jubilee');
        const wh = L.stations.find(s => /West Hampstead/.test(s.name));
        return !!wh && (wh.surface === true || wh.trackClass !== 'tunnel');
      });
      const i0 = r.arrivals.findIndex(a => a.name === 'Finchley Road') + 1, i1 = r.arrivals.findIndex(a => a.name === 'Kilburn') + 1;
      expect(i0).toBeGreaterThan(0); expect(i1).toBeGreaterThan(i0);
      const between = r.frames.filter(f => f.arrivals >= i0 && f.arrivals < i1);
      test.info().annotations.push({ type: 'West Hampstead stub', description: fixed ? 'fixed in the data: no bore frames allowed' : `still in the data: ${between.filter(f => f.regime === 'bore').length} bore frames` });
      if (fixed) expect(between.filter(f => f.regime === 'bore').length).toBe(0);
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

test('a surface stop: the card offers the street, which is a step aside to the ground; from the street, a surface platform eases onto the track', async () => {
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
    for (let i = 0; i < 300; i++) { await frame(); const d = m.debug(), c = ug.camera.position; log.push({ phase: d.phase, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z), near: d.near }); if (d.phase === 'body') break; }
    return log;
  });
  expect(seen.some(f => f.phase === 'step')).toBe(true);
  expect(seen.at(-1).phase).toBe('body');
  for (const f of seen) expect(f.y).toBeGreaterThanOrEqual(f.g + 1 * VE - 1e-6);   // the ease is above the terrain
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

test('the overshoot: released 0.25 s after an arrival at 200 m/s, the walker stops within 53 m, glides back to the stop and the card opens', async () => {
  expect(await placeAt('jubilee', 'Kingsbury', 'Queensbury')).not.toBeNull();
  const r = await page.evaluate(async () => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const frame = () => new Promise(res => requestAnimationFrame(res));
    ug.fpsControls.keys.add('w'); ug.fpsControls.keys.add('shift');
    const n0 = m.debug().arrivals.length;
    let arrClock = null, releaseS = null;
    const log = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      await frame();
      const d = m.debug();
      if (arrClock === null && d.arrivals.length > n0) arrClock = d.clock;
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
