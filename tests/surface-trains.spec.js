// Sprint 30Sep26w (D-041 item 2, Lane T): the Tube and DLR trains on the
// open-air track are the underground timetable's own trains (trains.js
// trainStateAt), mapped onto the surface railway (src/surface-train-map.js,
// src/surface-trains.js). The mapping itself is unit-tested in
// tests/surface-trains.test.mjs; these checks run the app.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const LINES_WITH_OPEN_AIR = ['bakerloo', 'central', 'circle', 'district', 'hammersmith-city', 'jubilee', 'metropolitan', 'northern', 'piccadilly', 'dlr'];
const WHOLLY_IN_TUNNEL = ['victoria', 'waterloo-city'];

// Line topology comes from the live TfL API when reachable; pin both loads to
// the bundled route data, as tests/train-determinism.spec.js does.
async function open(page) {
  await page.context().route('https://api.tfl.gov.uk/**', r => r.abort());
  await page.goto('/?fast=1&buildings=baked&mh=1.1');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.surfaceTrains?.stats.written > 3, null, { timeout: 180000 });
  // The terrain resnap rebuilds the tube branches and their trains (same ids,
  // new curves): wait until ids and curve lengths have held still for 3 s, then
  // resnap once more so every load is surely snapped, and let the mappings land.
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

test('two loads draw every surface train identically at the same simulation time, and the frame path is the pure one', async ({ browser }) => {
  test.setTimeout(480000);
  const T = 1234.5;
  const one = async () => {
    const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await open(page);
    const r = await page.evaluate(T => {
      const u = window.__ug, st = u.surfaceTrains;
      const snap = st.snapshot(T);
      // The frame path at the same clock, unculled: the same cars, in iteration order.
      u.trainSystem.simTime = T;
      st.update(null, { frustumCull: false });
      const live = [];
      for (const p of st.profiles.values()) if (p.meshes) { const m = p.meshes[0]; for (let i = 0; i < m.count; i++) live.push(Array.from(m.instanceMatrix.array.slice(i * 16, i * 16 + 16))); }
      const pure = Object.values(snap).flatMap(t => t.cars.map(c => c.m));
      let worstLive = 0;
      const key = m => m.slice(12, 15).map(v => v.toFixed(2)).join(',');
      const liveByKey = new Map(live.map(m => [key(m), m]));
      for (const m of pure) { const l = liveByKey.get(key(m.map(Math.fround))); worstLive = Math.max(worstLive, l ? Math.max(...m.map((v, i) => Math.abs(Math.fround(v) - l[i]))) : Infinity); }
      return { snap, live: live.length, pure: pure.length, worstLive, trains: u.trainSystem.allTrains.length };
    }, T);
    await context.close();
    return { ...r, errors };
  };
  const a = await one(), b = await one();
  expect(a.errors).toEqual([]);
  expect(Object.keys(a.snap).length).toBeGreaterThan(50);
  expect(Object.keys(b.snap).sort()).toEqual(Object.keys(a.snap).sort());
  let worst = 0;
  for (const id of Object.keys(a.snap)) {
    expect(b.snap[id].cars.length, id).toBe(a.snap[id].cars.length);
    a.snap[id].cars.forEach((c, i) => c.m.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - b.snap[id].cars[i].m[k])); }));
  }
  expect(worst).toBe(0);
  for (const r of [a, b]) { expect(r.live).toBe(r.pure); expect(r.worstLive).toBe(0); }
});

test.describe('in one load', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300000);
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await open(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('continuity at a portal: the underground and surface positions within the documented bound', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains, T = window.__ugTHREE;
      const map = await import('/src/surface-train-map.js');
      const P = new T.Vector3(), pt = {}, out = { tube: [], dlr: [], notNearest: 0, moved: 0, movedUnjustified: [], portals: 0, bounds: map.PORTAL_ERROR_BOUND_M };
      const seen = new Set();
      for (const train of u.trainSystem.allTrains) {
        const ud = train.userData;
        if (seen.has(ud.curve) || !st.stockOf.has(ud.lineId)) continue; seen.add(ud.curve);
        const m = st.mappingOf(ud), sign = ud.dir > 0 ? 1 : -1, L = ud.curve.getLength();
        for (const run of m.runs) for (let k = 0; k < run.au.length; k++) {
          if (!run.portal[k]) continue;
          const up = run.au[k];
          map.sampleRun(run, map.sAt(run, up), st.ratio, pt);
          const { ox, oz } = map.laneOffset(pt, sign), sx = pt.x + ox, sz = pt.z + oz;
          const d = v => { ud.curve.getPointAt(Math.min(1, Math.max(0, v)), P); return Math.hypot(P.x - sx, P.z - sz); };
          // The underground train is where trainStateAt puts it at u: on its own curve.
          (ud.lineId === 'dlr' ? out.dlr : out.tube).push({ line: ud.lineId, d: d(up) });
          out.portals++;
          // Tube portals are anchored at the chord's nearest approach (no along-track jump),
          // unless the speed bound moved them (flag 2, fix round 1): then the nearest approach
          // would have run a stretch beside it outside the bound (SPEED_RATIO_MIN/MAX, or the
          // interval's own ratio between its stations where that is outside them).
          if (ud.lineId === 'dlr') continue;
          if (run.portal[k] === 1) { const du = 15 / L; if (d(up) > Math.min(d(up - du), d(up + du)) + 3) out.notNearest++; continue; }
          out.moved++;
          let a = k - 1; while (a > 0 && !run.station[a]) a--;
          let b = k + 1; while (b < run.au.length - 1 && !run.station[b]) b++;
          const rInt = (run.as[b] - run.as[a]) / ((run.au[b] - run.au[a]) * L);
          const rHi = Math.max(map.SPEED_RATIO_MAX, rInt), rLo = Math.min(map.SPEED_RATIO_MIN, rInt);
          let un = run.au[k - 1], best = Infinity;
          for (let q = 1; q < 400; q++) { const v = run.au[k - 1] + (run.au[k + 1] - run.au[k - 1]) * q / 400, dv = d(v); if (dv < best) { best = dv; un = v; } }
          const r1 = (run.as[k] - run.as[k - 1]) / ((un - run.au[k - 1]) * L), r2 = (run.as[k + 1] - run.as[k]) / ((run.au[k + 1] - un) * L);
          const broke = q => !(q <= rHi * 0.97 && q >= rLo * 1.03);
          if (!broke(r1) && !broke(r2)) out.movedUnjustified.push({ line: ud.lineId, r1, r2, rHi, rLo });
        }
      }
      // A real crossing: a Northern line train out of the Hampstead tunnel at Golders Green.
      const p = u.surfaceRail.data.lines.find(l => l.id === 'northern').portals.find(q => q.id === 'northern-3');
      const c = u.llToXZ(p.lat, p.lon);
      let crossing = null;
      for (let t = 600; t < 600 + 3 * 3600 && !crossing; t += 0.5) {
        const snap = st.snapshot(t, { lineId: 'northern' });
        for (const [id, tr] of Object.entries(snap)) {
          if (tr.cars.length !== 1) continue; // the first car just out
          const k = tr.cars[0], dk = Math.hypot(k.m[12] - c.x, k.m[14] - c.z);
          if (dk > 60) continue;
          const train = u.trainSystem.allTrains.find(x => x.userData.id === id);
          train.userData.curve.getPointAt(tr.u, P);
          // The train's centre on the surface at this moment, against the underground train's.
          const sc = st.snapshot(t, { lineId: 'northern' })[id];
          crossing = { t, id, firstCarFromMouth: dk, undergroundToSurface: Math.hypot(P.x - k.m[12], P.z - k.m[14]), cars: sc.cars.length };
          break;
        }
      }
      out.crossing = crossing;
      const sum = a => ({ n: a.length, max: Math.max(...a.map(x => x.d)) });
      return { ...out, tube: sum(out.tube), dlr: sum(out.dlr) };
    });
    console.log('portals', JSON.stringify(r));
    expect(r.portals).toBeGreaterThan(100);
    expect(r.tube.n).toBeGreaterThan(50);
    expect(r.dlr.n).toBeGreaterThan(10);
    expect(r.tube.max).toBeLessThanOrEqual(r.bounds.tube);
    expect(r.dlr.max).toBeLessThanOrEqual(r.bounds.dlr);
    expect(r.notNearest).toBe(0);
    expect(r.moved).toBeGreaterThan(0);
    expect(r.movedUnjustified).toEqual([]);
    // The first car out sits at the mouth, and the underground train is within the bound of it.
    expect(r.crossing).not.toBeNull();
    expect(r.crossing.firstCarFromMouth).toBeLessThan(60);
    expect(r.crossing.undergroundToSurface).toBeLessThan(r.bounds.tube + 60);
  });

  test('counts per line: the same trains as the timetable, every open-air line, none for lines wholly in tunnel', async () => {
    const r = await page.evaluate(() => {
      const u = window.__ug, st = u.surfaceTrains;
      const byId = new Map(u.trainSystem.allTrains.map(t => [t.userData.id, t.userData.lineId]));
      const lines = {}, problems = [];
      let trains = 0, whole = 0;
      for (let k = 0; k < 12; k++) {
        const T = 900 + k * 517;
        const snap = st.snapshot(T);
        for (const [id, tr] of Object.entries(snap)) {
          trains++;
          if (byId.get(id) !== tr.lineId) problems.push(`${id} is not a ${tr.lineId} timetable train`);
          const n = st.stockOf.get(tr.lineId).layout.length;
          if (tr.cars.length > n) problems.push(`${id} draws ${tr.cars.length} of ${n} cars`);
          if (tr.cars.length === n) whole++;
          (lines[tr.lineId] ||= { appearances: 0, ids: new Set() }).appearances++;
          lines[tr.lineId].ids.add(id);
        }
      }
      // Live counts, unculled, match the pure query; the meshes hold exactly those cars.
      u.trainSystem.simTime = 4321;
      st.update(null, { frustumCull: false });
      const pure = Object.values(st.snapshot(4321)).reduce((a, t) => a + t.cars.length, 0);
      const meshCars = [...st.profiles.values()].reduce((a, p) => a + (p.meshes ? p.meshes[0].count : 0), 0);
      const perPart = [...st.profiles.values()].every(p => !p.meshes || p.meshes.every(m => m.count === p.meshes[0].count));
      const out = {};
      for (const [k, v] of Object.entries(lines)) out[k] = { appearances: v.appearances, distinct: v.ids.size };
      return { lines: out, problems, trains, whole, liveCars: st.stats.cars, pure, meshCars, perPart, liveLines: st.stats.lines };
    });
    console.log('counts', JSON.stringify(r));
    expect(r.problems).toEqual([]);
    for (const l of LINES_WITH_OPEN_AIR) expect(r.lines[l]?.appearances ?? 0, l).toBeGreaterThan(0);
    for (const l of WHOLLY_IN_TUNNEL) expect(r.lines[l], l).toBeUndefined();
    // Most surface trains are whole; the rest are part way through a portal or the edge of a mapped run.
    expect(r.whole / r.trains).toBeGreaterThan(0.8);
    expect(r.liveCars).toBe(r.pure);
    expect(r.meshCars).toBe(r.pure);
    expect(r.perPart).toBe(true);
  });

  test('no per-instance colour: variants are separate meshes; two shared materials', async () => {
    const r = await page.evaluate(() => {
      const g = window.__ug.surfaceTrains.group, mats = new Set(), meshes = [];
      g.traverse(o => { if (o.isMesh) { meshes.push({ name: o.name, inst: !!o.isInstancedMesh, ic: o.instanceColor ?? null, attr: !!o.geometry.getAttribute('instanceColor'), color: !!o.geometry.getAttribute('color') }); mats.add(o.material); } });
      return { meshes, materials: mats.size, top: g.parent === window.__ug.scene, name: g.name };
    });
    expect(r.meshes.length).toBe(6); // three profiles x body (with its roof) and windows
    for (const m of r.meshes) { expect(m.inst).toBe(true); expect(m.ic).toBeNull(); expect(m.attr).toBe(false); expect(m.color).toBe(false); }
    expect(r.materials).toBe(2);
    for (const f of ['../src/surface-trains.js', '../src/surface-train-map.js']) expect(await readFile(new URL(f, import.meta.url), 'utf8')).not.toMatch(/setColorAt|instanceColor\s*=/);
  });

  test('true proportions: each stock its real size at every Master, riding the rail as drawn', async () => {
    const MASTERS = [1, 1.1, 3, 10];
    const r = await page.evaluate(async MASTERS => {
      const u = window.__ug, st = u.surfaceTrains, T = window.__ugTHREE;
      const setMaster = m => { const el = document.getElementById('masterHeight'); el.value = String(m); el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush(); };
      // One whole train of each profile at one moment, chosen at Master 1.1.
      setMaster(1.1);
      const T0 = 2468;
      const snap = st.snapshot(T0);
      const pick = {};
      for (const [id, tr] of Object.entries(snap)) {
        const prof = st.stockOf.get(tr.lineId).profile;
        if (!pick[prof] && tr.cars.length === st.stockOf.get(tr.lineId).layout.length && ['metropolitan', 'central', 'dlr'].includes(tr.lineId)) pick[prof] = id;
      }
      const ray = new T.Raycaster(), rows = [];
      for (const m of MASTERS) {
        setMaster(m);
        // The rail as drawn now (the DLR's own meshes are rebuilt at each Master).
        const rails = [];
        for (const g of u.surfaceRail.groups.values()) g.traverse(o => { if (o.isMesh && !o.isInstancedMesh) rails.push(o); });
        u.overground.traverse(o => { if (o.isMesh && !o.isInstancedMesh) rails.push(o); });
        const ratio = u.masterHeight.ratio, now = st.snapshot(T0);
        for (const [prof, id] of Object.entries(pick)) {
          const tr = now[id]; if (!tr) { rows.push({ m, prof, missing: true }); continue; }
          const stock = st.stockOf.get(tr.lineId), profile = st.profiles.get(prof).profile;
          const cols = [], gaps = [];
          for (const c of tr.cars) {
            const D = new T.Matrix4().makeScale(1, ratio, 1).multiply(new T.Matrix4().fromArray(c.m)), e = D.elements;
            const col = i => new T.Vector3(e[4 * i], e[4 * i + 1], e[4 * i + 2]);
            cols.push({ w: col(0).length() * profile.widthM, h: col(1).length() * profile.heightM, l: col(2).length(), skew: Math.max(Math.abs(col(0).normalize().dot(col(1).normalize())), Math.abs(col(1).normalize().dot(col(2).normalize())), Math.abs(col(0).normalize().dot(col(2).normalize()))) });
            // The rail under the car (stripe or band, a little above the bed): straight down.
            ray.set(new T.Vector3(c.m[12], c.m[13] + 400, c.m[14]), new T.Vector3(0, -1, 0));
            // The rail nearest the car's own height (a flyover deck may pass above it).
            const hits = ray.intersectObjects(rails, false);
            gaps.push(hits.length ? hits.map(h => h.point.y - c.m[13]).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) : null);
          }
          rows.push({ m, prof, line: tr.lineId, stock: stock.key, cols, gaps, realW: stock.widthM, realH: stock.heightM, lengths: stock.layout.map(c => c.length) });
        }
      }
      setMaster(1.1);
      return { rows, pick };
    }, MASTERS);
    expect(Object.keys(r.pick).sort()).toEqual(['deep', 'dlr', 'subsurface']);
    for (const row of r.rows) {
      expect(row.missing, `${row.prof} at Master ${row.m}`).toBeUndefined();
      row.cols.forEach((c, i) => {
        expect(c.w, `${row.stock} width at Master ${row.m}`).toBeCloseTo(row.realW, 6);
        expect(c.h, `${row.stock} height at Master ${row.m}`).toBeCloseTo(row.realH, 6);
        expect(c.l, `${row.stock} car ${i} length at Master ${row.m}`).toBeCloseTo(row.lengths[i], 6);
        expect(c.skew).toBeLessThan(1e-6);
      });
      // Riding the drawn rail: the stripe or band is just above the bed the car
      // stands on (0.8 to 1.2 canonical units x the structure scale). Off the
      // centreline (the car's lane, 2.6 m out) the stripe's triangles on a bend
      // or a grade sit a few centimetres either way of the centreline's height
      // (measured: -0.14 to +0.7 units, the DLR at Master 1), so half a unit
      // (0.1 m at Master 1) is allowed below; the body itself starts 0.3 m up.
      const gaps = row.gaps.filter(g => g !== null);
      expect(gaps.length, `${row.stock} over its rail at Master ${row.m}`).toBeGreaterThan(row.gaps.length / 2);
      for (const g of gaps) { expect(g, `${row.stock} at Master ${row.m}: gaps ${JSON.stringify(row.gaps)}`).toBeGreaterThan(-0.5); expect(g).toBeLessThan(1.5); }
    }
  });

  test('trains hold together: adjacent cars meet end to end and turn together, everywhere, at any moment', async () => {
    // Fix round 1 (01Oct26h): the verifier found 140 of 43,429 adjacent car pairs more than 5 m apart and
    // 127 bent more than 60 degrees, about 4 broken trains on screen at any moment, at 60 fixed places
    // (junction hops, a station on a spur, DLR snaps alternating between parallel decks).
    const r = await page.evaluate(() => {
      const u = window.__ug, st = u.surfaceTrains, T = window.__ugTHREE, R = u.masterHeight.ratio;
      const out = { trains: 0, pairs: 0, maxGap: 0, maxYaw: 0, worst: null, broken: 0 };
      for (let k = 0; k < 40; k++) {
        const t = 500 + k * 77;
        for (const [id, tr] of Object.entries(st.snapshot(t))) {
          out.trains++;
          // Real metres (y scaled back from canonical by the Master ratio).
          const cars = tr.cars.map(c => { const e = new T.Matrix4().makeScale(1, R, 1).multiply(new T.Matrix4().fromArray(c.m)).elements; const f = new T.Vector3(e[8], e[9], e[10]), L = f.length(); f.normalize(); const p = new T.Vector3(e[12], e[13], e[14]); return { c: c.c, f, a: p.clone().addScaledVector(f, -L / 2), b: p.clone().addScaledVector(f, L / 2), p }; });
          let bad = false;
          for (let i = 0; i + 1 < cars.length; i++) {
            const A = cars[i], B = cars[i + 1];
            if (B.c !== A.c + 1) continue;
            out.pairs++;
            const gap = Math.min(A.a.distanceTo(B.a), A.a.distanceTo(B.b), A.b.distanceTo(B.a), A.b.distanceTo(B.b));
            const yaw = Math.acos(Math.max(-1, Math.min(1, (A.f.x * B.f.x + A.f.z * B.f.z) / (Math.hypot(A.f.x, A.f.z) * Math.hypot(B.f.x, B.f.z))))) * 180 / Math.PI;
            if (gap > out.maxGap) { out.maxGap = gap; out.worst = { t, id, gap, yaw, at: [A.p.x, A.p.z] }; }
            out.maxYaw = Math.max(out.maxYaw, yaw);
            if (gap > 5 || yaw > 60) bad = true;
          }
          if (bad) out.broken++;
        }
      }
      return out;
    });
    console.log('coupling', JSON.stringify(r));
    expect(r.trains).toBeGreaterThan(5000);
    expect(r.pairs).toBeGreaterThan(30000);
    expect(r.broken).toBe(0);
    // Measured 01Oct26h after fix round 1: largest gap 2.45 m (cars 0.6 m apart over couplers, on a curve and
    // a cross-slope); largest turn between neighbours 18 degrees, a DLR section on one of its real 40 to 45 m
    // radius curves (the Tube's largest, 16, where a junction gap is faired). Before: 140 pairs over 5 m, 127 over 60 degrees.
    expect(r.maxGap).toBeLessThan(3);
    expect(r.maxYaw).toBeLessThan(22);
  });

  test('speed: no surface train runs faster than the speed bound allows, on screen or between anchors', async () => {
    // Fix round 1 (01Oct26h): Circle trains by Paddington ran at 105 m/s on screen (a portal anchor put 770 m
    // of track into 88 m of chord), District trains at 55 m/s, DLR trains at up to three times their speed.
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains, R = u.masterHeight.ratio;
      const map = await import('/src/surface-train-map.js');
      const byId = new Map(u.trainSystem.allTrains.map(t => [t.userData.id, t.userData]));
      // 1. Drawn cars, 1 s apart, same car of the same train, no timetable wrap: metres per second against cruise.
      let prev = null, pairs = 0, maxRatio = 0, worst = null;
      for (let t = 700; t <= 1300; t += 1) {
        const snap = st.snapshot(t);
        if (prev) for (const [id, tr] of Object.entries(snap)) {
          const p = prev[id]; if (!p || Math.abs(tr.u - p.u) > 0.5) continue;
          const pc = new Map(p.cars.map(c => [c.c, c.m]));
          for (const c of tr.cars) { const m0 = pc.get(c.c); if (!m0) continue; const v = Math.hypot(c.m[12] - m0[12], (c.m[13] - m0[13]) * R, c.m[14] - m0[14]); pairs++; const q = v / byId.get(id).cruiseMps; if (q > maxRatio) { maxRatio = q; worst = { t, id, v }; } }
        }
        prev = snap;
      }
      // 2. Every stretch between anchors: track metres per metre of curve.
      const seen = new Set(), over = [];
      for (const train of u.trainSystem.allTrains) {
        const ud = train.userData; if (!st.stockOf.has(ud.lineId) || seen.has(ud.curve)) continue; seen.add(ud.curve);
        const m = st.mappingOf(ud), L = ud.curve.getLength();
        for (const run of m.runs) {
          for (let k = 1; k < run.au.length; k++) {
            const q = (run.as[k] - run.as[k - 1]) / ((run.au[k] - run.au[k - 1]) * L);
            let hi = map.SPEED_RATIO_MAX, lo = map.SPEED_RATIO_MIN;
            if (ud.lineId !== 'dlr') { // the interval's own ratio, between its stations, where it is outside the bound
              let a = k - 1; while (a > 0 && !run.station[a]) a--;
              let b = k; while (b < run.au.length - 1 && !run.station[b]) b++;
              const ri = (run.as[b] - run.as[a]) / ((run.au[b] - run.au[a]) * L); hi = Math.max(hi, ri); lo = Math.min(lo, ri);
            }
            if (q > hi * 1.05 || q < lo * 0.95 - 1e-9) over.push({ line: ud.lineId, q: +q.toFixed(2), hi: +hi.toFixed(2), lo: +lo.toFixed(2) });
          }
        }
      }
      return { pairs, maxRatio, worst, over: over.slice(0, 20), overN: over.length };
    });
    console.log('speed', JSON.stringify(r));
    expect(r.pairs).toBeGreaterThan(50000);
    // Measured 01Oct26h after fix round 1: at most 1.69 x cruise (20.3 m/s, a Hammersmith & City interval whose track is that much longer than its chord).
    expect(r.maxRatio).toBeLessThan(2);
    expect(r.overN).toBe(0);
  });

  test('cars ride the drawn track: a train standing at the end of its run stands on it, and no car is drawn far from it', async () => {
    // Fix round 2 (01Oct26h). The verifier's own audit: over 40 moments, each drawn car's distance from the nearest
    // drawn segment of its line's network, beyond its lane and a 1.5 m half-body. Before: 705 of 68,065 cars more than
    // 10 m off and 198 more than 40 m (to 53.7 m), 471 of them in trains dwelling at their curve's first or last stop,
    // carried straight on past the end of the drawn track (Epping, Watford, Richmond, Stanmore, Kensington (Olympia));
    // the rest on the DLR's undrawn stretches and a blend cutting its curve at Canning Town; every DLR train dwelling at
    // the end of its curve was drawn as half a train.
    // Sprint 30Sep26w integration: "drawn" means a segment whose two nodes are both drawn open track (Lane R draws no
    // Tube tunnel segment, and no lone open sample between tunnel ones: surface-train-map.js drawnOpenFlags). Round 2
    // measured to every segment, tunnel ones included, so lone cars over bare ground at Aldgate, Victoria and Gloucester
    // Road (277 m from any drawn segment) passed it; the round-2 verifier's audit found them.
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains;
      const { trainStateAt } = await import('/src/trains.js');
      const map = await import('/src/surface-train-map.js');
      const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0; return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
      const byId = new Map(u.trainSystem.allTrains.map(t => [t.userData.id, t]));
      const out = { cars: 0, off10: 0, off40: 0, max: 0, off10AtEnds: 0, dwellAtEnds: 0, dwellWhole: 0, places: {} };
      for (let k = 0; k < 40; k++) {
        const t = 640 + k * 173;
        for (const [id, tr] of Object.entries(st.snapshot(t))) {
          const ud = byId.get(id).userData, s = trainStateAt(ud, t), su = ud.stationUs;
          const atEnd = s.pausedLeft > 0 && (Math.abs(s.t - Math.min(...su)) < 1e-6 || Math.abs(s.t - Math.max(...su)) < 1e-6);
          if (atEnd) { out.dwellAtEnds++; if (tr.cars.length === st.stockOf.get(tr.lineId).layout.length) out.dwellWhole++; }
          const { net } = st.networkFor(tr.lineId);
          for (const c of tr.cars) {
            const x = c.m[12], z = c.m[14]; let best = Infinity, ex = 0;
            const cs = net.cell, cx = Math.floor(x / cs), cz = Math.floor(z / cs);
            for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (const i of net.grid.get(`${cx + a},${cz + b}`) || []) for (const j of [i - 1, i + 1]) {
              if (j < 0 || j >= net.n || net.piece[j] !== net.piece[i] || !net.open[i] || !net.open[j]) continue;
              const d = segDist(x, z, net.x[i], net.z[i], net.x[j], net.z[j]); if (d < best) { best = d; ex = net.extra[i]; }
            }
            const off = Math.max(0, best - (map.LANE_OFFSET_M + ex) - 1.5);
            out.cars++; out.max = Math.max(out.max, off);
            if (off > 10) { out.off10++; if (atEnd) out.off10AtEnds++; const key = `${tr.lineId}@${Math.round(x / 250) * 250},${Math.round(z / 250) * 250}`; out.places[key] = Math.max(out.places[key] || 0, +off.toFixed(1)); }
            if (off > 40) out.off40++;
          }
        }
      }
      // The renderer's pre-cull relies on every surface train lying within TRACK_ERROR_BOUND_M of its underground twin.
      const e = st.mappingErrors(), track = {};
      for (const [l, v] of Object.entries(e)) if (v.track) track[l] = +v.track.max.toFixed(1);
      return { ...out, track, bounds: map.TRACK_ERROR_BOUND_M };
    });
    console.log('ontrack', JSON.stringify(r));
    expect(r.cars).toBeGreaterThan(50000);
    // No train standing at the end of its run is drawn off the drawn track, and nearly all are drawn whole (01Oct26h,
    // integration: 711 of 724; the rest stand partly in a tunnel mouth, or by Lane R's undrawn 100 m at Stratford's DLR).
    expect(r.off10AtEnds).toBe(0);
    expect(r.dwellWhole / r.dwellAtEnds).toBeGreaterThan(0.95);
    // Nothing far off. What is left (01Oct26h, integration: 18 cars, at most 21.1 m) crosses between drawn pieces at junctions Lane R's
    // data leaves 20 to 40 m apart (Chalfont & Latimer, Abbey Road, Poplar): a train crossing a gap in the drawing.
    expect(r.off40).toBe(0);
    expect(r.max).toBeLessThan(25);
    expect(r.off10 / r.cars).toBeLessThan(0.001);
    for (const [l, m] of Object.entries(r.track)) expect(m, l).toBeLessThanOrEqual(l === 'dlr' ? r.bounds.dlr : r.bounds.tube);
  });

  test('the cull still hides the underground trains from above; the surface trains stay drawn and never below ground', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug;
      u.camera.position.set(2952.9, 337.8, -732.9); u.controls.target.set(1910.1, 196.2, -783.7); u.controls.update(); // street near Bank
      await new Promise(res => setTimeout(res, 1200));
      const set = u.undergroundCull.collect(), g = u.surfaceTrains.group;
      const inSet = o => { for (let x = o; x; x = x.parent) if (set.includes(x)) return true; return false; };
      const undergroundNotCulled = u.trainSystem.allTrains.filter(t => !inSet(t)).length;
      // Count what the renderer actually draws in one above-ground frame.
      let under = 0, surface = 0;
      const tap = (o, fn) => { const prev = o.onBeforeRender; o.onBeforeRender = function (...a) { fn(); return prev.apply(this, a); }; return () => { o.onBeforeRender = prev; }; };
      const undo = [];
      u.scene.traverse(o => { if (o.isMesh && o.name?.startsWith('train-batch-')) undo.push(tap(o, () => under++)); });
      for (const p of u.surfaceTrains.profiles.values()) if (p.meshes) for (const m of p.meshes) undo.push(tap(m, () => surface++));
      u.surfaceTrains.update(u.camera);
      u.undergroundCull.render(u.aboveGroundView, () => u.composer.render(0));
      for (const f of undo) f();
      // Every car drawn stands on open track, above the ground under it.
      const snap = u.surfaceTrains.snapshot();
      let below = 0, cars = 0;
      for (const tr of Object.values(snap)) for (const c of tr.cars) { cars++; const y = u.getTerrainMeshSurfaceY({ x: c.m[12], z: c.m[14] }); if (Number.isFinite(y) && c.m[13] < y - 2) below++; }
      return { above: u.aboveGroundView, top: g.parent === u.scene, named: g.name, culled: inSet(g), undergroundNotCulled, under, surface, below, cars };
    });
    expect(r.above).toBe(true);
    expect(r.top).toBe(true);
    expect(r.named.startsWith('line:')).toBe(false);
    expect(r.culled).toBe(false);
    expect(r.undergroundNotCulled).toBe(0); // every underground train is under a line:* group
    expect(r.under).toBe(0);
    expect(r.surface).toBeGreaterThan(0);
    expect(r.cars).toBeGreaterThan(200);
    expect(r.below).toBe(0);
  });

  test('shared track carries both operators: the Bakerloo on the Lioness, the District on the Mildmay', async () => {
    const r = await page.evaluate(() => {
      const u = window.__ug, st = u.surfaceTrains, og = u.overground.userData.linePaths;
      const near = (paths, x, z) => { let best = Infinity; for (const p of paths) if (p) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], vx = b.x - a.x, vz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1))); best = Math.min(best, Math.hypot(x - a.x - vx * t, z - a.z - vz * t)); } return best; };
      const out = {};
      for (const [line, ogLine] of [['bakerloo', 'lioness'], ['district', 'mildmay']]) {
        let on = 0, cars = 0;
        for (let k = 0; k < 10; k++) for (const tr of Object.values(st.snapshot(1000 + k * 701, { lineId: line }))) for (const c of tr.cars) { cars++; if (near(og.get(ogLine), c.m[12], c.m[14]) < 4) on++; }
        out[line] = { on, cars };
      }
      // The Overground's own trains run on those corridors too (they are not touched).
      out.overgroundFleets = u.overground.userData.fleets.map(f => f.name);
      return out;
    });
    console.log('shared', JSON.stringify(r));
    expect(r.bakerloo.on).toBeGreaterThan(20);
    expect(r.district.on).toBeGreaterThan(5);
    expect(r.overgroundFleets).toEqual(expect.arrayContaining(['overground-trains-lioness', 'overground-trains-mildmay']));
  });

  test('pause and speed are the shared clock; trains advance while offscreen', async () => {
    const r = await page.evaluate(async () => {
      const u = window.__ug, st = u.surfaceTrains;
      const live = () => { const out = []; for (const p of st.profiles.values()) if (p.meshes) { const m = p.meshes[0]; for (let i = 0; i < m.count; i++) out.push(m.instanceMatrix.array.slice(i * 16 + 12, i * 16 + 15).join()); } return out.sort().join('|'); };
      const frames = n => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      u.camera.position.set(2952.9, 337.8, -732.9); u.controls.target.set(1910.1, 196.2, -783.7); u.controls.update();
      u.sim.paused = true; await frames(5);
      const t0 = u.trainSystem.simTime, a = live(); await frames(30);
      const pausedSame = live() === a && u.trainSystem.simTime === t0;
      // Running at 8x: the clock advances by elapsed x 8, and the cars follow it.
      u.sim.timeScale = 8; u.sim.paused = false;
      const w0 = performance.now(), s0 = u.trainSystem.simTime; await frames(40);
      u.sim.paused = true; await frames(2);
      const advanced = u.trainSystem.simTime - s0, wall = (performance.now() - w0) / 1000;
      const moved = live() !== a;
      // Offscreen: fly 30 km away (every train beyond the distance cull), run, come back.
      u.camera.position.set(0, 20000, 60000); u.controls.target.set(0, 0, 50000); u.controls.update();
      u.sim.paused = false; await frames(30); u.sim.paused = true; await frames(2);
      const awayCars = st.stats.cars, tAway = u.trainSystem.simTime;
      u.camera.position.set(2952.9, 337.8, -732.9); u.controls.target.set(1910.1, 196.2, -783.7); u.controls.update(); await frames(3);
      // Back in view, the drawn cars are exactly the pure positions at the clock.
      st.update(null, { frustumCull: false });
      const pure = Object.values(st.snapshot(tAway)).flatMap(t => t.cars.map(c => [c.m[12], c.m[13], c.m[14]].map(v => Math.fround(v)).join()));
      return { pausedSame, advanced, wall, moved, awayCars, backMatches: live() === pure.sort().join('|'), tAway, s0 };
    });
    console.log('clock', JSON.stringify(r));
    expect(r.pausedSame).toBe(true);
    expect(r.moved).toBe(true);
    expect(r.advanced).toBeGreaterThan(0);
    expect(r.advanced).toBeLessThanOrEqual(r.wall * 8 + 1);
    expect(r.awayCars).toBe(0);
    expect(r.tAway).toBeGreaterThan(r.s0);
    expect(r.backMatches).toBe(true);
  });
});
