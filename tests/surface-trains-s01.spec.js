// Sprint 01Oct26h (D-043, Lane T): trains on the drawn track. West Hampstead's
// Jubilee drawn whole, trains standing at the ends of their curves drawn whole
// (or only inside the tunnel they stand at), and surface trains on every
// section Lane R added. The mapping is unit-tested in
// tests/surface-trains.test.mjs; determinism over two loads, the cull and the
// materials are held by tests/surface-trains.spec.js.
import { test, expect } from '@playwright/test';

async function open(page) {
  await page.context().route('https://api.tfl.gov.uk/**', r => r.abort());
  await page.goto('/?fast=1&buildings=baked&mh=1.1');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.surfaceTrains?.stats.written > 3, null, { timeout: 180000 });
  // As tests/surface-trains.spec.js: the terrain resnap settles, one more resnap, the mappings land.
  await page.waitForFunction(() => {
    const key = window.__ug.trainSystem.allTrains.map(t => `${t.userData.id}=${t.userData.curveLengthM.toFixed(3)}`).sort().join('|');
    const now = performance.now(), w = window;
    if (w.__trainKey !== key) { w.__trainKey = key; w.__trainKeySince = now; return false; }
    return now - w.__trainKeySince > 3000;
  }, null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => window.__ug.snapAllTubesToTerrain());
  await page.waitForFunction(() => window.__ug.surfaceTrains.stats.pending === 0, null, { timeout: 60000 });
  await page.evaluate(() => { window.__ug.sim.paused = true; });
}

test.describe('sprint 01Oct26h, Lane T', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300000);
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await open(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('West Hampstead: every Jubilee train there is drawn whole, never a stub or a lone car, at every second for two hours', async () => {
    // 387dff0: the station's node was on the undrawn 227 m tunnel stub 11 m away (the open track 18 m away), so
    // Jubilee trains were drawn as stubs of 1 to 3 cars for about 250 m and a lone car stood about a second before
    // vanishing (continuity events near (-4731, -4231)). Lane R removed the stub; the station's node now also prefers
    // open track (surface-train-map.js stationNode), belt and braces.
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains, map = await import('/src/surface-train-map.js');
      const line = u.surfaceRail.data.lines.find(l => l.id === 'jubilee');
      const s = line.stations.find(q => q.name.startsWith('West Hampstead')), c = u.llToXZ(s.lat, s.lon);
      const { net } = st.networkFor('jubilee');
      const node = map.stationNode(net, c.x, c.z);
      const total = st.stockOf.get('jubilee').layout.length;
      const out = { node: { open: net.open[node], d: Math.hypot(net.x[node] - c.x, net.z[node] - c.z) }, moments: 0, sightings: 0, whole: 0, part: [], lone: 0, vanished: [] };
      let prev = new Set();
      for (let t = 600; t <= 600 + 7200; t += 1) {
        out.moments++;
        const snap = st.snapshot(t, { lineId: 'jubilee' }), near = new Set();
        for (const [id, tr] of Object.entries(snap)) {
          if (!tr.cars.some(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z) < 600)) continue;
          out.sightings++;
          if (tr.cars.length === total) out.whole++; else if (out.part.length < 10) out.part.push({ t, id, cars: tr.cars.length });
          if (tr.cars.length === 1) out.lone++;
          if (tr.cars.some(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z) < 500)) near.add(id);
        }
        // A train drawn within 500 m of the station one second and drawn nowhere the next (the Jubilee's curve ends at
        // Stanmore and Stratford, far from here, so no train ends its run near West Hampstead).
        for (const id of prev) if (!snap[id] && out.vanished.length < 10) out.vanished.push({ t, id });
        prev = near;
      }
      return out;
    });
    console.log('west hampstead', JSON.stringify(r));
    expect(r.node.open).toBe(1);
    expect(r.sightings).toBeGreaterThan(2000);
    expect(r.part).toEqual([]);
    expect(r.whole).toBe(r.sightings);
    expect(r.lone).toBe(0);
    expect(r.vanished).toEqual([]);
  });

  test('trains standing at the ends of their curves: whole, or the missing cars inside the tunnel they stand at (Barking, Earl\'s Court, Stratford DLR, Aldgate, Watford, Theydon Bois)', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains, map = await import('/src/surface-train-map.js');
      const stops = [];
      for (const l of u.surfaceRail.data.lines) for (const s of l.stations) { const p = u.llToXZ(s.lat, s.lon); stops.push({ line: l.id, name: s.name.replace(/ (Underground|DLR|Rail) Station/, ''), x: p.x, z: p.z }); }
      const nameAt = (line, x, z) => { let b = null, bd = Infinity; for (const s of stops) if (s.line === line) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; b = s; } } return b.name; };
      const pt = {}, ends = [], seen = new Set();
      for (const train of u.trainSystem.allTrains) {
        const ud = train.userData;
        if (!st.stockOf.has(ud.lineId) || seen.has(ud.curve)) continue; seen.add(ud.curve);
        const m = st.mappingOf(ud), stock = st.stockOf.get(ud.lineId), sign = ud.dir > 0 ? 1 : -1;
        const su = ud.stationUs.filter(Number.isFinite);
        for (const [end, ue] of [['first', Math.min(...su)], ['last', Math.max(...su)]]) {
          const P = ud.curve.getPointAt(ue), at = nameAt(ud.lineId, P.x, P.z);
          const run = map.runAt(m.runs, ue);
          if (!run) { ends.push({ line: ud.lineId, id: ud.id, end, at, cars: '' }); continue; }
          const s = map.sAt(run, ue), cars = [];
          let frontGap = null;
          for (const car of stock.layout) { map.sampleRun(run, s + sign * car.offset, st.ratio, pt); cars.push(!pt.inside ? 'X' : !pt.drawn ? 'u' : !pt.open ? 't' : 'o'); }
          // Distance from the train's outer end to the run's end (the end of the drawn track it stands on, at a terminus).
          const atRunEnd = Math.abs(ue - run.u1) < 1e-12 ? run.cum[run.cum.length - 1] - (s + stock.trainM / 2) : Math.abs(ue - run.u0) < 1e-12 ? (s - stock.trainM / 2) - run.cum[0] : null;
          frontGap = atRunEnd;
          ends.push({ line: ud.lineId, id: ud.id, end, at, cars: cars.join(''), frontGap });
        }
      }
      return ends;
    });
    // Whole ('o' every car), none drawn, or drawn in part with the cars not drawn all on the run in tunnel ('t'),
    // together at one end of the train: inside the tunnel the train stands at. Never a car past the run's end ('X')
    // or on undrawn track ('u') beside drawn ones, and never a gap in the middle.
    const bad = [], counts = { whole: 0, none: 0, inTunnel: 0, unmapped: 0 };
    for (const e of r) {
      if (!e.cars) { counts.unmapped++; continue; }
      if (!/[^o]/.test(e.cars)) { counts.whole++; continue; }
      if (!/o/.test(e.cars)) { counts.none++; continue; }
      if (/^o+t+$|^t+o+$/.test(e.cars)) { counts.inTunnel++; continue; }
      bad.push(e);
    }
    console.log('termini', JSON.stringify(counts), JSON.stringify(r.filter(e => /o/.test(e.cars) && /[^o]/.test(e.cars)).map(e => `${e.line}@${e.at} ${e.end} ${e.cars}`)));
    expect(bad).toEqual([]);
    expect(counts.whole).toBeGreaterThan(80);
    const at = (line, name) => r.filter(e => e.line === line && e.at === name);
    // Barking (Hammersmith & City): whole, fitted short of the bridge past the platforms. Before: one car past the band's end.
    expect(at('hammersmith-city', 'Barking').map(e => e.cars)).toEqual(['ooooooo', 'ooooooo']);
    // Stratford DLR: every curve ending there, whole (the Canning Town curve now on the drawn track, not over bare ground).
    const strat = at('dlr', 'Stratford').filter(e => e.cars.includes('o') || e.cars.includes('u'));
    expect(strat.length).toBeGreaterThanOrEqual(4);
    for (const e of strat) expect(e.cars, e.id).toBe('oooooo');
    // Earl's Court: trains starting there whole; trains ending there whole or with their rear inside the tunnel they came out of.
    for (const e of at('district', "Earl's Court")) { if (e.end === 'first') expect(e.cars, e.id).toBe('ooooooo'); else expect(e.cars, e.id).toMatch(/^o+t*$|^t*o+$/); }
    // Aldgate (Metropolitan): never drawn in part (it stands in the tunnel).
    for (const e of at('metropolitan', 'Aldgate')) expect(e.cars === '' || !/o/.test(e.cars) || !/[^o]/.test(e.cars)).toBe(true);
    // Watford: whole, its front at the buffers (the end of the drawn track) less END_CLEAR_M.
    const wat = at('metropolitan', 'Watford');
    expect(wat.length).toBe(2);
    for (const e of wat) { expect(e.cars).toBe('oooooooo'); expect(e.frontGap).toBeGreaterThan(1.9); expect(e.frontGap).toBeLessThan(3); }
  });

  // Sprint 02Oct26f (D-048 item 7, lane T): the Central runs on past the map edge to Epping, so its trains are drawn past
  // the edge now; that every such car is on the drawn track is tests/termini.spec.js T-T1 and T-T2. Inverted at integration.
  test('Theydon Bois, the last station inside the map on the Epping branch: trains standing there whole, at the station; the trains run on past the map edge (s02:T)', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains, { trainStateAt } = await import('/src/trains.js');
      const { isOffMapEdge } = await import('/src/m25-edge.js'); // the cliff surface-rail.js stops the track at (s01:R)
      const line = u.surfaceRail.data.lines.find(l => l.id === 'central');
      const tb = line.stations.find(s => s.name.startsWith('Theydon Bois')), c = u.llToXZ(tb.lat, tb.lon);
      const total = st.stockOf.get('central').layout.length;
      const out = { standing: 0, whole: 0, far: 0, offMap: 0, cars: 0 };
      for (let t = 600; t <= 600 + 3600; t += 5) {
        const snap = st.snapshot(t, { lineId: 'central' });
        for (const [id, tr] of Object.entries(snap)) {
          for (const k of tr.cars) { out.cars++; if (isOffMapEdge({ x: k.m[12], z: k.m[14] })) out.offMap++; }
          const ud = u.trainSystem.allTrains.find(x => x.userData.id === id).userData, s = trainStateAt(ud, t);
          if (!(s.pausedLeft > 0)) continue;
          const P = ud.curve.getPointAt(s.t); if (Math.hypot(P.x - c.x, P.z - c.z) > 150) continue;
          out.standing++;
          if (tr.cars.length === total) out.whole++;
          const mid = tr.cars[tr.cars.length >> 1].m; out.far = Math.max(out.far, Math.hypot(mid[12] - c.x, mid[14] - c.z));
        }
      }
      return out;
    });
    console.log('theydon bois', JSON.stringify(r));
    expect(r.standing).toBeGreaterThan(5);
    expect(r.whole).toBe(r.standing);
    expect(r.far).toBeLessThan(60);
    expect(r.offMap, 'cars drawn past the map edge, on the way to Epping').toBeGreaterThan(0);
  });

  test('surface trains run on every section Lane R added, on the drawn track, sharing the District\'s into Ealing Broadway', async () => {
    const SECTIONS = {
      central: ['West Acton', 'Ealing Broadway', 'Newbury Park', 'Barkingside', 'Fairlop', 'Hainault', 'Grange Hill', 'Chigwell', 'Roding Valley'],
      metropolitan: ['West Harrow', 'Rayners Lane'],
      dlr: ['Pudding Mill Lane', 'Stratford'],
    };
    const r = await page.evaluate(async SECTIONS => {
      const u = window.__ug, st = u.surfaceTrains, map = await import('/src/surface-train-map.js');
      const { linePieces } = await import('/src/surface-trains.js');
      const out = {};
      for (const [lineId, names] of Object.entries(SECTIONS)) {
        const line = u.surfaceRail.data.lines.find(l => l.id === lineId);
        const at = names.map(n => { const s = line.stations.find(q => q.name.replace(/ (Underground|DLR|Rail) Station/, '') === n); return s ? { n, ...u.llToXZ(s.lat, s.lon) } : { n, missing: true }; });
        const { net } = st.networkFor(lineId), total = st.stockOf.get(lineId).layout.length;
        // The pieces in network order, for the owner of the track under a car.
        const pieces = linePieces({ lineId, data: u.surfaceRail.data, ownerPaths: u.surfaceRail.paths, overground: u.overground });
        const res = Object.fromEntries(names.map(n => [n, { whole: 0, cars: 0, worstOff: 0, over6: 0, owners: {} }]));
        for (let k = 0; k < 60; k++) {
          const t = 640 + k * 113;
          for (const tr of Object.values(st.snapshot(t, { lineId }))) {
            const mid = tr.cars[tr.cars.length >> 1].m;
            for (const a of at) {
              if (a.missing || Math.hypot(mid[12] - a.x, mid[14] - a.z) > 400) continue;
              const q = res[a.n];
              if (tr.cars.length === total) q.whole++;
              for (const c of tr.cars) {
                let best = Infinity, owner = null, extra = 0;
                for (let i = 0; i + 1 < net.n; i++) {
                  if (net.piece[i] !== net.piece[i + 1] || !net.open[i] || !net.open[i + 1]) continue;
                  const ax = net.x[i], az = net.z[i], vx = net.x[i + 1] - ax, vz = net.z[i + 1] - az, l2 = vx * vx + vz * vz;
                  if (Math.abs(ax - c.m[12]) > 300 || Math.abs(az - c.m[14]) > 300) continue;
                  const f = l2 > 0 ? Math.max(0, Math.min(1, ((c.m[12] - ax) * vx + (c.m[14] - az) * vz) / l2)) : 0;
                  const d = Math.hypot(c.m[12] - ax - vx * f, c.m[14] - az - vz * f);
                  if (d < best) { best = d; owner = pieces[net.piece[i]].owner ?? lineId; extra = net.extra[i]; }
                }
                q.cars++;
                const off = best - (map.LANE_OFFSET_M + extra);
                q.worstOff = Math.max(q.worstOff, off); if (off > 6) q.over6++;
                q.owners[owner] = (q.owners[owner] || 0) + 1;
              }
            }
          }
        }
        out[lineId] = { missing: at.filter(a => a.missing).map(a => a.n), res };
      }
      return out;
    }, SECTIONS);
    console.log('sections', JSON.stringify(r));
    for (const [lineId, v] of Object.entries(r)) {
      expect(v.missing, lineId).toEqual([]);
      for (const [n, q] of Object.entries(v.res)) {
        expect(q.whole, `${lineId} at ${n}`).toBeGreaterThan(0);
        // Each car in its lane on the drawn track. Where Lane R's drawn pieces do not meet (the loop's pieces north of
        // Hainault, about 100 m apart; the loop joining the main line by Roding Valley; by Grange Hill) a train crosses
        // the gap as a crossover would, faired, up to 12.9 m off the nearest drawn segment (identical on Lane R's head,
        // ead96c8): the whole map's bound in tests/surface-trains.spec.js ("cars ride the drawn track", under 25 m),
        // and few such cars.
        expect(q.worstOff, `${lineId} at ${n}`).toBeLessThan(25);
        expect(q.over6 / q.cars, `${lineId} at ${n}`).toBeLessThan(0.1);
      }
    }
    // Into Ealing Broadway the Central runs on the District's corridor (Lane R draws it there as the District's band).
    expect(r.central.res['Ealing Broadway'].owners.district ?? 0).toBeGreaterThan(0);
  });
});
