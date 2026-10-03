// termini.spec.js: the lines run on to their termini beyond the M25 (sprint 02Oct26f, lane T, D-048 item 7).
//
// Jordan (D-046 item 1, 02Oct26f): "Beyond the m25 they're just a tunnel or track in empty space." Seven stations lie
// beyond the ring: Epping (Central); Chorleywood, Chalfont & Latimer, Amersham and Chesham (Metropolitan); Theobalds
// Grove and Cheshunt (Overground Weaver). This spec pins, in the real app:
//   Track        drawn track reaches every platform, no gap over 20 m, the drawn length, the ground it rides (the hidden
//                ground, src/hidden-ground.js), D-024 beyond the ring, the on-map rail unchanged
//   Hidden ground  identical to the raw samplers on the map, smoothed beyond it, continuous across the ring, order
//                independent
//   Trains       Tube trains stand whole at the five Tube termini, no car off the drawn track, the Weaver to Cheshunt
//   Regimes      an underground camera in the corridor is underground (fog, light, labels, audio); scoped to the
//                corridor; no bore ribbon from above; the exterior cliff and chalk column views unchanged
//   Walk         the seven are stops, nothing held, Up to the street lands on the hidden ground, walking it, the soft
//                hold at the terrain grid, Epping is not underground
//   Cost         no console errors, O(1) per frame
// "Before" is e0675d7, served by a second dev server (UG_LB, default http://localhost:5254, a detached worktree at
// e0675d7); the checks that compare with it are skipped when UG_LB is "off".

import { test, expect } from '@playwright/test';
import { VIEWS } from '../scripts/measure-setups.mjs';

test.setTimeout(300000);

const VE = 5;
const LB = process.env.UG_LB === 'off' ? null : (process.env.UG_LB || 'http://localhost:5254');
const ST = {
  epping: [51.69368, 0.113767], theydon: [51.671759, 0.103085], rick: [51.640207, -0.473703], chorley: [51.654358, -0.518461],
  chalfont: [51.667985, -0.560689], amersham: [51.674126, -0.607714], chesham: [51.705208, -0.611247],
  turkey: [51.672628, -0.047217], theobalds: [51.692457, -0.034831], cheshunt: [51.702876, -0.02396], shooters: [51.4705, 0.0718],
};
const BEYOND = { central: ['epping'], metropolitan: ['chorley', 'chalfont', 'amersham', 'chesham'], weaver: ['theobalds', 'cheshunt'] };
const START = { central: 'theydon', metropolitan: 'rick', weaver: 'turkey' };

const errors = [];
let page, lb = null;

// The frozen-frame machinery of underground-cull.spec.js: ticks held until stepped.
const FREEZE = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const held = []; let lastTs = 0;
  window.requestAnimationFrame = cb => {
    if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
    return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
  };
  window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
  window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
};
const READY = () => {
  const u = window.__ug;
  return !!(u?.bakedStats?.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal && u.groundReady && u.economies
    && u.surfaceRail?.stationLayers.size > 0 && u.surfaceTrains && u.overground?.userData.linePaths && u.overground.userData.stationsAttached
    && (!u.termini || u.termini.corridor.ready));
};
async function openApp(browser, origin, { listen = false } = {}) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  if (listen) {
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  }
  await p.addInitScript(FREEZE);
  await p.goto(`${origin}/?fast=1&buildings=baked&mh=1.1`);
  await p.waitForFunction(READY, null, { timeout: 240000 });
  await p.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.renderQuality.set({ scale: 1, samples: 4 }); window.__ug.sim.paused = true; });
  return p;
}
const both = async (fn, arg) => ({ t: await page.evaluate(fn, arg), b: lb ? await lb.evaluate(fn, arg) : null });

test.beforeAll(async ({ browser }, info) => {
  page = await openApp(browser, info.project.use.baseURL ?? 'http://localhost:5243', { listen: true });
  if (LB) lb = await openApp(browser, LB);
});
test.afterAll(async () => { await page?.close(); await lb?.close(); });

/** Frozen pose (position, target), two frames stepped. */
async function pose(pg, p, t, { freeze = true } = {}) {
  await pg.evaluate(async ({ p, t, freeze }) => {
    window.__thaw();
    const u = window.__ug; u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
    await new Promise(r => setTimeout(r, 1200));
    if (freeze) { window.__freeze = true; await new Promise(r => setTimeout(r, 80)); window.__step(2); }
  }, { p, t, freeze });
}
const thaw = (pg) => pg.evaluate(() => window.__thaw());

/** The page-side look of the scene: fog, clear colour, every light, sorted. */
const LOOK = () => {
  const u = window.__ug, THREE = window.__ugTHREE, f = u.scene.fog, c = u.composer.renderer.getClearColor(new THREE.Color());
  const lights = []; u.scene.traverse(o => { if (o.isLight) lights.push([o.type, o.name || '', +o.intensity.toFixed(9)]); });
  lights.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]) || a[2] - b[2]);
  return { fog: f ? { color: f.color.toArray(), near: f.near, far: f.far } : null, clear: c.toArray(), lights };
};
// `far: false` leaves the fog's far distance out: environment.js widens it with the camera's distance from the origin (a
// macro pullback rule that has nothing to do with the regime), so it differs between two places whatever their regime.
const closeLook = (a, b, tol, label, { far = true } = {}) => {
  expect(a.fog, label).not.toBeNull(); expect(b.fog).not.toBeNull();
  a.fog.color.forEach((v, i) => expect(Math.abs(v - b.fog.color[i]), `${label}: fog colour ${i}`).toBeLessThanOrEqual(tol));
  expect(Math.abs(a.fog.near - b.fog.near), `${label}: fog near`).toBeLessThanOrEqual(Math.max(tol, 0.01 * b.fog.near));
  if (far) expect(Math.abs(a.fog.far - b.fog.far), `${label}: fog far`).toBeLessThanOrEqual(Math.max(tol, 0.01 * b.fog.far));
  a.clear.forEach((v, i) => expect(Math.abs(v - b.clear[i]), `${label}: clear ${i}`).toBeLessThanOrEqual(tol));
  expect(a.lights.length, `${label}: light count`).toBe(b.lights.length);
  a.lights.forEach((l, i) => { expect(l[0] + l[1]).toBe(b.lights[i][0] + b.lights[i][1]); expect(Math.abs(l[2] - b.lights[i][2]), `${label}: ${l[0]} ${l[1]} intensity`).toBeLessThanOrEqual(tol); });
};

// ============================ Data and track ============================

test('T-K1 to K3: drawn track reaches every platform, no undrawn gap over 20 m, the drawn length beyond the ring', async () => {
  const r = await page.evaluate(async ({ ST, BEYOND, START }) => {
    const u = window.__ug;
    const { drawnOpenFlags } = await import('/src/surface-rail.js');
    const { isOffMapEdge, getMapEdgeRing, signedDistanceToRing } = await import('/src/m25-edge.js');
    const ring = getMapEdgeRing();
    const off = (x, z) => isOffMapEdge({ x, z });
    const out = {};
    for (const line of Object.keys(BEYOND)) {
      const paths = (line === 'weaver' ? u.overground.userData.linePaths.get('weaver') : u.surfaceRail.paths.get(line)).filter(Boolean);
      // Drawn samples (a sample is drawn when it is open and has an open neighbour), inside 5 km of the ring or beyond it.
      const S = []; let lengthBeyondM = 0;
      paths.forEach((path, bi) => {
        const f = drawnOpenFlags(path);
        path.forEach((p, i) => { if (f[i]) S.push({ x: p.x, z: p.z, bi, i, beyond: off(p.x, p.z), near: signedDistanceToRing(p.x, p.z, ring) < 5000 }); });
        for (let i = 1; i < path.length; i++) if (f[i] && f[i - 1] && off(path[i].x, path[i].z) && off(path[i - 1].x, path[i - 1].z)) lengthBeyondM += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      });
      const pool = S.filter(s => s.near);
      // Union-find over consecutive samples of a path, and any two samples at most 20 m apart.
      const parent = pool.map((_, k) => k); const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
      const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
      const byKey = new Map(pool.map((s, k) => [`${s.bi}:${s.i}`, k]));
      pool.forEach((s, k) => { const nx = byKey.get(`${s.bi}:${s.i + 1}`); if (nx !== undefined) uni(k, nx); });
      const cell = 20, grid = new Map();
      pool.forEach((s, k) => { const key = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(k); });
      pool.forEach((s, k) => { const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${cx + a},${cz + b}`) || []) if (j !== k && Math.hypot(pool[j].x - s.x, pool[j].z - s.z) <= 20) uni(k, j); });
      const nearest = (lat, lon) => { const c = u.llToXZ(lat, lon); let best = null; pool.forEach((s, k) => { const d = Math.hypot(s.x - c.x, s.z - c.z); if (!best || d < best.d) best = { d, k }; }); return best; };
      const from = nearest(...ST[START[line]]);
      out[line] = { lengthBeyondM, drawn: pool.length, stations: BEYOND[line].map(n => { const b = nearest(...ST[n]); return { name: n, offM: +b.d.toFixed(1), reachable: find(b.k) === find(from.k) }; }) };
    }
    return out;
  }, { ST, BEYOND, START });
  console.log('[termini] track', JSON.stringify(r));
  for (const [line, v] of Object.entries(r)) for (const s of v.stations) {
    expect(s.offM, `${line}: the nearest drawn open sample to ${s.name}`).toBeLessThanOrEqual(40);
    expect(s.reachable, `${line}: ${s.name} is connected to ${START[line]} by drawn track with no gap over 20 m`).toBe(true);
  }
  const km = l => r[l].lengthBeyondM / 1000;
  expect(km('central'), 'Central beyond the ring (km)').toBeGreaterThanOrEqual(1.1); expect(km('central')).toBeLessThanOrEqual(1.6);
  expect(km('metropolitan'), 'Metropolitan beyond the ring (km)').toBeGreaterThanOrEqual(13.0); expect(km('metropolitan')).toBeLessThanOrEqual(15.5);
  expect(km('weaver'), 'Weaver beyond the ring (km)').toBeGreaterThanOrEqual(2.5); expect(km('weaver')).toBeLessThanOrEqual(3.0);
});

test('T-K4: the ground under the beyond-ring track is smoother than the raw surface model it rode before, on every branch', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, VE = u.VERTICAL_EXAGGERATION;
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    // Steepest grade between samples at least 5 m apart, and the largest deviation from a 400 m running median (true m).
    const measure = (run, yOf) => {
      const arc = [0]; for (let i = 1; i < run.length; i++) arc.push(arc[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
      const y = run.map(yOf);
      let grade = 0, hump = 0;
      for (let i = 0; i < run.length; i++) {
        for (let j = i + 1; j < run.length && arc[j] - arc[i] < 60; j++) if (arc[j] - arc[i] >= 5) grade = Math.max(grade, Math.abs(y[j] - y[i]) / VE / (arc[j] - arc[i]));
        const win = []; for (let j = 0; j < run.length; j++) if (Math.abs(arc[j] - arc[i]) <= 200) win.push(y[j]);
        hump = Math.max(hump, Math.abs(y[i] - median(win)) / VE);
      }
      return { grade, hump };
    };
    const branches = [];
    const take = (line, paths) => paths.forEach((path, bi) => {
      if (!path) return;
      const run = path.filter(p => isOffMapEdge({ x: p.x, z: p.z }));
      if (run.length < 20) return;
      const after = measure(run, p => p.terrainY), before = measure(run, p => u.getStructuralSurfaceY({ x: p.x, z: p.z }));
      const last = path.at(-1), first = path[0];
      branches.push({ line, bi, n: run.length, after, before, ends: [first, last].map(p => [p.x, p.z]) });
    });
    for (const [l, paths] of u.surfaceRail.paths) if (l === 'central' || l === 'metropolitan') take(l, paths);
    take('weaver', u.overground.userData.linePaths.get('weaver'));
    const ches = u.llToXZ(51.705208, -0.611247);
    return { branches, ches: [ches.x, ches.z] };
  });
  for (const b of r.branches) console.log(`[termini] ground ${b.line}[${b.bi}] ${b.n} samples: grade ${(100 * b.after.grade).toFixed(1)}% (raw ${(100 * b.before.grade).toFixed(1)}%), hump ${b.after.hump.toFixed(1)} m (raw ${b.before.hump.toFixed(1)} m)`);
  expect(r.branches.length).toBeGreaterThanOrEqual(4);
  for (const b of r.branches) {
    expect(b.after.grade, `${b.line}[${b.bi}] grade`).toBeLessThanOrEqual(b.before.grade + 1e-9);
    expect(b.after.hump, `${b.line}[${b.bi}] hump`).toBeLessThanOrEqual(b.before.hump + 1e-9);
  }
  expect(Math.max(...r.branches.map(b => b.after.grade)), 'worst grade over all branches (was 28.1%)').toBeLessThanOrEqual(0.20);
  expect(Math.max(...r.branches.map(b => b.after.hump)), 'worst hump over all branches (was 9.1 m)').toBeLessThanOrEqual(6.5);
  const chesham = r.branches.filter(b => b.line === 'metropolitan' && b.ends.some(e => Math.hypot(e[0] - r.ches[0], e[1] - r.ches[1]) < 40));
  expect(chesham.length, 'the Chesham branch').toBe(1);
  expect(chesham[0].after.grade).toBeLessThanOrEqual(0.12); expect(chesham[0].after.hump).toBeLessThanOrEqual(4);
});

test('T-K5: D-024 beyond the ring: no stripe or band vertex of the Central, Metropolitan or Weaver more than 0.5 m below the hidden ground', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, VE = u.VERTICAL_EXAGGERATION, hg = u.termini.hiddenGround;
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    const out = { checked: 0, buried: 0, worstM: 0 };
    const scan = o => {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (!isOffMapEdge({ x, z })) continue;
        const g = hg.structuralY(x, z); if (!Number.isFinite(g)) continue;
        const below = (g - pos.getY(i)) / VE; out.checked++;
        if (below > 0.5) out.buried++;
        out.worstM = Math.max(out.worstM, below);
      }
    };
    for (const line of ['central', 'metropolitan']) u.surfaceRail.groups.get(line)?.traverse(o => { if (o.isMesh && ['stripe', 'band'].includes(o.userData.part)) scan(o); });
    u.overground.traverse(o => { if (o.isMesh && o.userData?.type === 'overground-line' && o.userData.lineId === 'weaver' && o.userData.part === 'stripe') scan(o); });
    return out;
  });
  console.log('[termini] D-024 beyond the ring', JSON.stringify(r));
  expect(r.checked, 'stripe and band vertices beyond the ring').toBeGreaterThan(1000);
  expect(r.buried).toBe(0);
});

test('T-K6: the on-map rail is unchanged: every surface-rail mesh but the Central and the Metropolitan hashes identically to e0675d7', async () => {
  test.skip(!lb, 'needs the e0675d7 server (UG_LB)');
  const HASH = () => {
    const u = window.__ug, out = {};
    const fnv = (h, bytes) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
    for (const [line, g] of u.surfaceRail.groups) {
      if (line === 'central' || line === 'metropolitan') continue;
      let k = 0;
      g.traverse(o => { if (!o.isMesh || o.isInstancedMesh) return; const p = o.geometry.attributes.position; out[`${line}|${o.userData.part ?? o.name}|${k++}`] = [p.count, fnv(2166136261 >>> 0, new Uint8Array(p.array.buffer, p.array.byteOffset, p.array.byteLength)).toString(16)]; });
    }
    return out;
  };
  const { t, b } = await both(HASH);
  expect(Object.keys(t).length).toBeGreaterThan(20);
  expect(t).toEqual(b);
});

// ============================ Hidden ground ============================

test('T-G1: identical to the raw samplers on the map: zero mismatches on a 200 x 100 lattice', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, hg = u.termini.hiddenGround, b = u.getTerrainBounds();
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    let on = 0, mismatch = 0;
    for (let i = 0; i < 200; i++) for (let j = 0; j < 100; j++) {
      const x = b.minX + (b.maxX - b.minX) * (i + 0.5) / 200, z = b.minZ + (b.maxZ - b.minZ) * (j + 0.5) / 100;
      if (isOffMapEdge({ x, z })) continue;
      on++;
      if (!Object.is(hg.terrainY(x, z), u.getTerrainMeshSurfaceY({ x, z })) || !Object.is(hg.structuralY(x, z), u.getStructuralSurfaceY({ x, z }))) mismatch++;
    }
    return { on, mismatch };
  });
  expect(r.on).toBeGreaterThan(3000);
  expect(r.mismatch).toBe(0);
});

test('T-G2: smoothed near the seven stations: never steeper than the raw surface, and at most a 16% grade where the raw was 32 to 36%', async () => {
  const r = await page.evaluate(async (ST) => {
    const u = window.__ug, hg = u.termini.hiddenGround, VE = u.VERTICAL_EXAGGERATION;
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    const out = {};
    for (const name of ['epping', 'chorley', 'chalfont', 'amersham', 'chesham', 'theobalds', 'cheshunt']) {
      const c = u.llToXZ(...ST[name]);
      let raw = 0, hid = 0;
      for (let dx = -1500; dx <= 1500; dx += 25) for (let dz = -1500; dz <= 1500; dz += 25) {
        const x = c.x + dx, z = c.z + dz;
        if (Math.hypot(dx, dz) > 1500 || !isOffMapEdge({ x, z }) || !isOffMapEdge({ x: x + 25, z }) || !isOffMapEdge({ x, z: z + 25 })) continue;
        const r0 = u.getTerrainMeshSurfaceY({ x, z }), h0 = hg.terrainY(x, z);
        raw = Math.max(raw, Math.abs(u.getTerrainMeshSurfaceY({ x: x + 25, z }) - r0), Math.abs(u.getTerrainMeshSurfaceY({ x, z: z + 25 }) - r0));
        hid = Math.max(hid, Math.abs(hg.terrainY(x + 25, z) - h0), Math.abs(hg.terrainY(x, z + 25) - h0));
      }
      out[name] = { raw, hid };
    }
    return out;
  }, ST);
  console.log('[termini] worst 25 m step (scene units; 20 = 16%)', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { raw: +v.raw.toFixed(1), hidden: +v.hid.toFixed(1) }]))));
  for (const [k, v] of Object.entries(r)) expect(v.hid, `${k}: hidden ground never steeper than the raw`).toBeLessThanOrEqual(v.raw + 1e-6);
  for (const k of ['chalfont', 'amersham', 'chesham']) expect(r[k].hid, `${k}: at most a 16% grade`).toBeLessThanOrEqual(20);
});

test('T-G3: continuous across the ring: the blend adds no cliff (40 transects, 1 m steps, 300 m in to 600 m out)', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, hg = u.termini.hiddenGround;
    const { getMapEdgeRing, isOffMapEdge } = await import('/src/m25-edge.js');
    const ring = getMapEdgeRing(), n = ring.length, worst = [];
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(k * n / 40), a = ring[(i + n - 1) % n], b = ring[(i + 1) % n], p = ring[i];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (!isOffMapEdge({ x: p[0] + nx * 20, z: p[1] + nz * 20 })) { nx = -nx; nz = -nz; }   // outward
      let rawStep = 0, hidStep = 0, pr = null, ph = null;
      for (let d = -300; d <= 600; d++) {
        const x = p[0] + nx * d, z = p[1] + nz * d, r0 = u.getTerrainMeshSurfaceY({ x, z }), h0 = hg.terrainY(x, z);
        if (!Number.isFinite(r0)) { pr = ph = null; continue; }
        if (pr !== null) { rawStep = Math.max(rawStep, Math.abs(r0 - pr)); hidStep = Math.max(hidStep, Math.abs(h0 - ph)); }
        pr = r0; ph = h0;
      }
      worst.push({ k, rawStep, hidStep });
    }
    return worst;
  });
  expect(r.length).toBe(40);
  for (const w of r) expect(w.hidStep, `transect ${w.k}: largest 1 m step ${w.hidStep.toFixed(2)} against the raw ${w.rawStep.toFixed(2)}`).toBeLessThanOrEqual(w.rawStep + 0.5);
});

test('T-G4: order independent: 2,000 beyond-ring points read forward and reversed on fresh instances give identical values, equal to the live one', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug;
    const { createHiddenGround } = await import('/src/hidden-ground.js');
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    const b = u.getTerrainBounds(), pts = [];
    for (let k = 0; pts.length < 2000 && k < 100000; k++) {
      const x = b.minX + (b.maxX - b.minX) * ((k * 0.6180339887) % 1), z = b.minZ + (b.maxZ - b.minZ) * ((k * 0.4142135623) % 1);
      if (isOffMapEdge({ x, z })) pts.push([x, z]);
    }
    const make = () => createHiddenGround({ getTerrainMeshSurfaceY: u.getTerrainMeshSurfaceY, getStructuralSurfaceY: u.getStructuralSurfaceY, getTerrainBounds: u.getTerrainBounds, isOffMapEdge });
    const a = make(), c = make();
    const fwd = pts.map(([x, z]) => a.terrainY(x, z));
    const rev = [...pts].reverse().map(([x, z]) => c.terrainY(x, z)).reverse();
    const live = pts.map(([x, z]) => u.termini.hiddenGround.terrainY(x, z));
    let diffRev = 0, diffLive = 0;
    for (let i = 0; i < pts.length; i++) { if (!Object.is(fwd[i], rev[i])) diffRev++; if (!Object.is(fwd[i], live[i])) diffLive++; }
    return { n: pts.length, diffRev, diffLive };
  });
  expect(r.n).toBe(2000);
  expect(r.diffRev).toBe(0);
  expect(r.diffLive).toBe(0);
});

// ============================ Trains ============================

test('T-T1 and T-T2: Tube trains stand whole at the five Tube termini, and no car beyond the ring is off the drawn track', async () => {
  const r = await page.evaluate(async ({ ST }) => {
    const u = window.__ug, st = u.surfaceTrains;
    const { trainStateAt } = await import('/src/trains.js');
    const map = await import('/src/surface-train-map.js');
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0; return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
    const byId = new Map(u.trainSystem.allTrains.map(t => [t.userData.id, t]));
    const stations = { central: [['epping', ST.epping]], metropolitan: [['chorley', ST.chorley], ['chalfont', ST.chalfont], ['amersham', ST.amersham], ['chesham', ST.chesham]] };
    const at = {}; for (const [line, list] of Object.entries(stations)) for (const [n, ll] of list) at[n] = { line, ...u.llToXZ(...ll), dwell: 0, whole: 0, partial: 0, t: null };
    const off = { cars: 0, worst: 0, over: 0 };
    for (let k = 0; k < 200; k++) {
      const t = 640 + 37 * k;
      for (const [id, tr] of Object.entries(st.snapshot(t))) {
        if (tr.lineId !== 'central' && tr.lineId !== 'metropolitan') continue;
        const ud = byId.get(id).userData, s = trainStateAt(ud, t);
        const { net } = st.networkFor(tr.lineId);
        if (s.pausedLeft > 0 && tr.cars.length) {
          const cx = tr.cars.reduce((a, c) => a + c.m[12], 0) / tr.cars.length, cz = tr.cars.reduce((a, c) => a + c.m[14], 0) / tr.cars.length;
          for (const v of Object.values(at)) if (v.line === tr.lineId && Math.hypot(cx - v.x, cz - v.z) < 300) {
            v.dwell++; if (tr.cars.length === st.stockOf.get(tr.lineId).layout.length) { v.whole++; v.t ??= t; } else v.partial++;
          }
        }
        for (const c of tr.cars) {
          const x = c.m[12], z = c.m[14];
          if (!isOffMapEdge({ x, z })) continue;
          let best = Infinity, ex = 0;
          const cs = net.cell, cx = Math.floor(x / cs), cz = Math.floor(z / cs);
          for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (const i of net.grid.get(`${cx + a},${cz + b}`) || []) for (const j of [i - 1, i + 1]) {
            if (j < 0 || j >= net.n || net.piece[j] !== net.piece[i] || !net.open[i] || !net.open[j]) continue;
            const d = segDist(x, z, net.x[i], net.z[i], net.x[j], net.z[j]); if (d < best) { best = d; ex = net.extra[i]; }
          }
          const o = Math.max(0, best - (map.LANE_OFFSET_M + ex) - 1.5);
          off.cars++; off.worst = Math.max(off.worst, o); if (o > 1.0) off.over++;
        }
      }
    }
    return { at, off };
  }, { ST });
  console.log('[termini] trains', JSON.stringify(r));
  for (const [n, v] of Object.entries(r.at)) {
    expect(v.dwell, `${n}: trains dwelling at the station`).toBeGreaterThanOrEqual(1);
    expect(v.partial, `${n}: every dwelling train is whole`).toBe(0);
    expect(v.whole, `${n}: whole trains`).toBeGreaterThanOrEqual(1);
  }
  expect(r.off.cars, 'cars beyond the ring').toBeGreaterThan(0);
  expect(r.off.over, `cars more than 1 m off the drawn track (worst ${r.off.worst.toFixed(2)} m)`).toBe(0);
});

test('T-T3: the Weaver runs to Cheshunt and Theobalds Grove: every car at the end stands on the drawn centreline', async () => {
  const r = await page.evaluate(async ({ ST }) => {
    const u = window.__ug, THREE = window.__ugTHREE;
    const fleet = u.overground.userData.fleets.find(f => f.name.includes('weaver'));
    fleet.userData.setEconomies({ compact: false });
    const paths = u.overground.userData.linePaths.get('weaver').filter(Boolean);
    const cheshunt = u.llToXZ(...ST.cheshunt), theo = u.llToXZ(...ST.theobalds);
    const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz; const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0; return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t); };
    const toLine = (x, z) => { let best = Infinity; for (const p of paths) for (let i = 1; i < p.length; i++) best = Math.min(best, segDist(x, z, p[i - 1], p[i])); return best; };
    const cars = (tr) => { const m = fleet.userData.meshes[0].instanceMatrix.array, out = []; for (let c = 0; c < tr.cars; c++) { const o = (tr.first + c) * 16; out.push({ x: m[o + 12], z: m[o + 14] }); } return out; };
    const ratio = 5 / 1.1;
    const end = { whole: true, worstCentre: 0, worstStation: 0, trains: 0 };
    const trains = fleet.userData.trains;
    // Cheshunt: the trains of the branch ending nearest it.
    const endsNear = tr => Math.hypot(tr.path.at(-1).x - cheshunt.x, tr.path.at(-1).z - cheshunt.z) < 60;
    for (const tr of trains.filter(endsNear)) {
      const keep = tr.phase;
      for (const ph of [0, tr.run - 1e-6]) {
        tr.phase = ph; fleet.userData.update(0, null, ratio);
        const atCheshunt = Math.hypot(tr.path.at(-1).x - cheshunt.x, tr.path.at(-1).z - cheshunt.z) < 60 && ph > 0;
        if (!atCheshunt) continue;
        end.trains++;
        for (const c of cars(tr)) { end.worstCentre = Math.max(end.worstCentre, toLine(c.x, c.z)); end.worstStation = Math.max(end.worstStation, Math.hypot(c.x - cheshunt.x, c.z - cheshunt.z)); }
      }
      tr.phase = keep;
    }
    // Theobalds Grove: some phase in 200 equal steps of 2 run, one train has every car within 150 m of the station and on the centreline.
    let theoFound = null;
    for (const tr of trains) {
      const keep = tr.phase;
      for (let k = 0; k < 200 && !theoFound; k++) {
        tr.phase = (2 * tr.run * k) / 200; fleet.userData.update(0, null, ratio);
        const cs = cars(tr);
        if (cs.every(c => Math.hypot(c.x - theo.x, c.z - theo.z) <= 150 && toLine(c.x, c.z) <= 5.1)) theoFound = { k, cars: cs.length };
      }
      tr.phase = keep;
      if (theoFound) break;
    }
    fleet.userData.update(0, null, ratio);
    return { end, theoFound, weaverBranchEndsNearCheshunt: trains.filter(endsNear).length, pathEnds: paths.map(p => Math.hypot(p.at(-1).x - cheshunt.x, p.at(-1).z - cheshunt.z)) };
  }, { ST });
  console.log('[termini] weaver', JSON.stringify(r));
  expect(r.weaverBranchEndsNearCheshunt, 'Weaver trains run on the branch to Cheshunt').toBeGreaterThanOrEqual(1);
  expect(r.end.trains).toBeGreaterThanOrEqual(1);
  expect(r.end.worstStation, 'every car within 150 m of Cheshunt').toBeLessThanOrEqual(150);
  expect(r.end.worstCentre, 'every car on the centreline (2.6 + 1 + 1.5 m)').toBeLessThanOrEqual(5.1);
  expect(r.theoFound, 'a Weaver train stands whole at Theobalds Grove').not.toBeNull();
});

// ============================ Regimes ============================

/** The pose inside the bore near Chalfont & Latimer: 30 m (150 su) below the hidden ground, looking 200 m along the bore. */
const boreNearChalfont = () => {
  const u = window.__ug, c = u.llToXZ(51.667985, -0.560689), hg = u.termini.hiddenGround;
  let best = null;
  for (const branch of u.lineBranchCenterPts.get('metropolitan')) branch.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.z - c.z); if (!best || d < best.d) best = { d, branch, i }; });
  const { branch, i } = best, p = branch[i], q = branch[Math.min(branch.length - 1, i + 1)] === p ? branch[i - 1] : branch[i + 1] ?? branch[i - 1];
  let dx = q.x - p.x, dz = q.z - p.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const g = hg.terrainY(p.x, p.z), y = g - 150;
  return { d: best.d, p: [p.x, y, p.z], t: [p.x + dx * 200, y, p.z + dz * 200] };
};
const REGIME = () => { const r = window.__ug.termini.regime; return { ...r }; };
const LABELS = () => ({
  underground: [...document.querySelectorAll('.station-layer-underground')].some(e => getComputedStyle(e).display !== 'none'),
  surface: [...document.querySelectorAll('.station-layer-surface')].some(e => getComputedStyle(e).display !== 'none'),
});

test('T-R1: an underground camera in the bore near Chalfont & Latimer is underground: fog, light, labels and audio', async () => {
  const bore = await page.evaluate(boreNearChalfont);
  expect(bore.d, 'the bore point lies within 150 m of the station').toBeLessThanOrEqual(150);
  const errs0 = errors.length;
  await pose(page, bore.p, bore.t);
  await page.evaluate(() => { window.__step(2); });
  const reg = await page.evaluate(REGIME), lab = await page.evaluate(LABELS), look = await page.evaluate(LOOK);
  console.log('[termini] bore regime', JSON.stringify({ reg, lab }));
  expect(reg.corridor).toBeGreaterThanOrEqual(0.99);
  expect(reg.under).toBe(true); expect(reg.audioUnderground).toBe(true); expect(reg.labelsUnderground).toBe(true); expect(reg.cullMode).toBeNull();
  expect(reg.beyond).toBe(true);
  expect(lab.underground, 'an underground label layer is displayed').toBe(true);
  expect(lab.surface, 'no surface label layer is').toBe(false);
  // The reference: Shooters Hill, in the map, at the same camera height.
  const sh = await page.evaluate(([lat, lon, y]) => { const u = window.__ug, c = u.llToXZ(lat, lon); return { p: [c.x, y, c.z], t: [c.x + 200, y, c.z] }; }, [...ST.shooters, bore.p[1]]);
  await thaw(page);
  await pose(page, sh.p, sh.t);
  const ref = await page.evaluate(LOOK);
  const regRef = await page.evaluate(REGIME);
  expect(regRef.cullMode).toBeNull();
  closeLook(look, ref, 0.01, 'bore beyond the edge against Shooters Hill', { far: false });
  if (lb) {
    // Before (e0675d7): the labels of a camera in the same bore are the surface ones.
    await pose(lb, bore.p, bore.t);
    const before = await lb.evaluate(LABELS);
    console.log('[termini] before (e0675d7) labels in the same bore', JSON.stringify(before));
    expect(before.surface, 'on e0675d7 the surface labels show in a beyond-edge bore').toBe(true);
    await thaw(lb);
  }
  expect(errors.length, 'no console error during the pose').toBe(errs0);
  await thaw(page);
});

test('T-R2: scoped to the corridor: 1,500 m south of Amersham, 30 m below the ground, nothing underground', async () => {
  const p = await page.evaluate(([lat, lon]) => { const u = window.__ug, c = u.llToXZ(lat, lon), z = c.z + 1500, y = u.termini.hiddenGround.terrainY(c.x, z) - 150; return { p: [c.x, y, z], t: [c.x + 200, y, z], d: u.termini.corridor.distanceAt(c.x, z) }; }, ST.amersham);
  expect(p.d, 'corridor distance').toBeGreaterThan(200);
  await pose(page, p.p, p.t);
  const reg = await page.evaluate(REGIME);
  expect(reg.corridor).toBe(0); expect(reg.audioUnderground).toBe(false); expect(reg.labelsUnderground).toBe(false);
  await thaw(page);
});

/** Pixels of the scene as the app draws it, with `hide` objects hidden: readPixels in the same task. */
const PIXELS = ({ hide, mode }) => {
  const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
  const toHide = hide.map(n => u.scene.getObjectByName(n)).filter(Boolean);
  const saved = toHide.map(o => o.visible);
  for (const o of toHide) o.visible = false;
  const m = mode === 'app' ? (u.termini ? (u.economies.on('underAbove') ? u.termini.regime.cullMode : false) : (u.aboveGroundView && u.economies.on('underAbove'))) : mode;
  u.undergroundCull.render(m, () => u.composer.render(0));
  rr.setRenderTarget(null);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
  toHide.forEach((o, i) => { o.visible = saved[i]; });
  let s = ''; const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return { n: b.length / 4, bytes: btoa(s) };
};
const diffPixels = (a, b, tol = 2) => { const A = Buffer.from(a.bytes, 'base64'), B = Buffer.from(b.bytes, 'base64'); let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > tol) n++; return n / (A.length / 4); };

test('T-R3: no bore ribbon from 300 m above Amersham: the lines cull hides line:*, the surface track is drawn', async () => {
  const pz = await page.evaluate(([lat, lon]) => { const u = window.__ug, c = u.llToXZ(lat, lon), g = u.termini.hiddenGround.terrainY(c.x, c.z);
    return { p: [c.x - 400, g + 1500, c.z + 300], t: [c.x, g, c.z] }; }, ST.amersham);
  const errs0 = errors.length;
  await pose(page, pz.p, pz.t);
  const st = await page.evaluate(() => { const u = window.__ug, lines = u.scene.children.filter(c => c.name?.startsWith('line:') && c.visible); return { reg: { ...u.termini.regime }, above: u.aboveGroundView, mode: u.undergroundCull.status.mode, hidden: u.undergroundCull.status.hidden, lines: lines.length }; });
  console.log('[termini] cull from 300 m above Amersham', JSON.stringify(st));
  expect(st.reg.cullMode).toBe('lines'); expect(st.above).toBe(false);
  expect(st.mode).toBe('lines');
  expect(st.hidden, 'the hidden count is the visible top-level line:* groups').toBe(st.lines);
  const a = await page.evaluate(PIXELS, { hide: [], mode: 'app' }), noBore = await page.evaluate(PIXELS, { hide: ['line:metropolitan'], mode: 'app' }), noRail = await page.evaluate(PIXELS, { hide: ['surface-rail-metropolitan'], mode: 'app' });
  expect(diffPixels(a, noBore), 'toggling line:metropolitan changes no pixel').toBe(0);
  expect(diffPixels(a, noRail), 'toggling surface-rail-metropolitan changes the picture').toBeGreaterThanOrEqual(0.005);
  if (lb) {
    await pose(lb, pz.p, pz.t);
    const la = await lb.evaluate(PIXELS, { hide: [], mode: 'app' }), lnb = await lb.evaluate(PIXELS, { hide: ['line:metropolitan'], mode: 'app' });
    const before = diffPixels(la, lnb, 0);
    console.log('[termini] before (e0675d7): toggling line:metropolitan changes', (100 * before).toFixed(3), '% of pixels');
    expect(before, 'on e0675d7 the bore ribbon is drawn here').toBeGreaterThan(0);
    await thaw(lb);
  }
  expect(errors.length).toBe(errs0);
  await thaw(page);
});

test('T-R4: the exterior is unchanged: the cliff and the chalk column views draw the same pixels, fog and light as e0675d7', async () => {
  test.skip(!lb, 'needs the e0675d7 server (UG_LB)');
  const VIEWS_EXT = { E1: { p: [-30000, -120, 9511], t: [-28513, -300, 9511] }, E2: { p: [-5405, -1500, 29000], t: [-5405, -1000, 27958] } };
  const SHOT = () => {
    const u = window.__ug, cloud = u.scene.getObjectByName('clouds') || u.scene.children.find(c => /cloud/i.test(c.name));
    const hides = [u.surfaceTrains?.group, cloud].filter(Boolean), saved = hides.map(o => o.visible);
    hides.forEach(o => { o.visible = false; });
    const look = (() => { const THREE = window.__ugTHREE, f = u.scene.fog, c = u.composer.renderer.getClearColor(new THREE.Color()); const lights = []; u.scene.traverse(o => { if (o.isLight) lights.push([o.type, o.name || '', +o.intensity.toFixed(9)]); }); lights.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]) || a[2] - b[2]); return { fog: f ? { color: f.color.toArray(), near: f.near, far: f.far } : null, clear: c.toArray(), lights }; })();
    const mode = u.termini ? (u.economies.on('underAbove') ? u.termini.regime.cullMode : false) : (u.aboveGroundView && u.economies.on('underAbove'));
    u.undergroundCull.render(mode, () => u.composer.render(0));
    const rr = u.composer.renderer, gl = rr.getContext(); rr.setRenderTarget(null);
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
    hides.forEach((o, i) => { o.visible = saved[i]; });
    let s = ''; const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return { look, bytes: btoa(s), corridor: u.termini?.regime.corridor ?? null };
  };
  for (const [name, v] of Object.entries(VIEWS_EXT)) {
    await pose(page, v.p, v.t); await pose(lb, v.p, v.t);
    const a = await page.evaluate(SHOT), b = await lb.evaluate(SHOT);
    expect(a.corridor, `${name}: outside the corridor`).toBe(0);
    closeLook(a.look, b.look, 1e-6, name);
    const A = Buffer.from(a.bytes, 'base64'), B = Buffer.from(b.bytes, 'base64');
    let sum = 0, within = 0;
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); sum += d; if (d <= 3) within++; }
    const mean = sum / (A.length / 4), frac = within / (A.length / 4);
    console.log(`[termini] ${name}: mean abs diff ${mean.toFixed(3)} levels, ${(100 * frac).toFixed(2)}% within 3 levels`);
    expect(mean, `${name}: mean absolute difference`).toBeLessThanOrEqual(0.5);
    expect(frac, `${name}: pixels within 3 levels`).toBeGreaterThanOrEqual(0.995);
    await thaw(page); await thaw(lb);
  }
});

test('T-R5: the in-map regimes are unchanged: fog, light and the cull at the standard views and the landing', async () => {
  test.skip(!lb, 'needs the e0675d7 server (UG_LB)');
  const poses = { ...Object.fromEntries(['overview', 'streetBank', 'riverGreenwich', 'm25Edge', 'heathrow'].map(k => [k, VIEWS[k]])), landing: { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] } };
  for (const [name, v] of Object.entries(poses)) {
    await pose(page, v.p, v.t); await pose(lb, v.p, v.t);
    const a = await page.evaluate(() => ({ look: (() => { const THREE = window.__ugTHREE, u = window.__ug, f = u.scene.fog, c = u.composer.renderer.getClearColor(new THREE.Color()); const lights = []; u.scene.traverse(o => { if (o.isLight) lights.push([o.type, o.name || '', +o.intensity.toFixed(9)]); }); lights.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]) || x[2] - y[2]); return { fog: f ? { color: f.color.toArray(), near: f.near, far: f.far } : null, clear: c.toArray(), lights }; })(),
      above: window.__ug.aboveGroundView, mode: window.__ug.termini.regime.cullMode, status: window.__ug.undergroundCull.status.mode }));
    const b = await lb.evaluate(() => { const THREE = window.__ugTHREE, u = window.__ug, f = u.scene.fog, c = u.composer.renderer.getClearColor(new THREE.Color()); const lights = []; u.scene.traverse(o => { if (o.isLight) lights.push([o.type, o.name || '', +o.intensity.toFixed(9)]); }); lights.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]) || x[2] - y[2]); return { look: { fog: f ? { color: f.color.toArray(), near: f.near, far: f.far } : null, clear: c.toArray(), lights }, above: u.aboveGroundView }; });
    expect(a.above, `${name}: aboveGroundView as before`).toBe(b.above);
    if (a.above) expect(a.mode, `${name}: the full cull exactly when aboveGroundView`).toBe('full');
    else expect([null, 'lines'], `${name}: the lines cull only where it is not the full view`).toContain(a.mode);
    closeLook(a.look, b.look, 1e-6, name);
    await thaw(page); await thaw(lb);
  }
});

// ============================ Cost ============================

test('T-C3: O(1) per frame: a million corridor lookups in 60 ms, 10,000 fresh hidden-ground reads in 250 ms', async () => {
  const r = await page.evaluate(async (ST) => {
    const u = window.__ug, c = u.termini.corridor, THREE = window.__ugTHREE;
    const { createHiddenGround } = await import('/src/hidden-ground.js');
    const { isOffMapEdge } = await import('/src/m25-edge.js');
    let sum = 0; const t0 = performance.now();
    for (let i = 0; i < 1000; i++) for (let j = 0; j < 1000; j++) sum += c.weightAt(-40000 + i * 70, -24000 + j * 53);
    const weightMs = performance.now() - t0;
    const g = createHiddenGround({ getTerrainMeshSurfaceY: u.getTerrainMeshSurfaceY, getStructuralSurfaceY: u.getStructuralSurfaceY, getTerrainBounds: u.getTerrainBounds, isOffMapEdge });
    const a = u.llToXZ(...ST.amersham);
    const t1 = performance.now(); let s2 = 0;
    for (let k = 0; k < 10000; k++) s2 += g.terrainY(a.x - 2500 + (k % 100) * 50, a.z - 2500 + Math.floor(k / 100) * 50);
    const groundMs = performance.now() - t1;
    return { weightMs, groundMs, sum, s2 };
  }, ST);
  console.log('[termini] cost', JSON.stringify(r));
  expect(r.weightMs).toBeLessThanOrEqual(60);
  expect(r.groundMs).toBeLessThanOrEqual(250);
});

test('T-C1: no console error from the cold load to here', async () => {
  console.log('[termini] console errors', JSON.stringify(errors.slice(0, 5)));
  expect(errors).toEqual([]);
});

// ============================ The walk ============================

test.describe('the walk (Pedestrian, /?skip=1)', () => {
  test.describe.configure({ mode: 'serial' });   // each walk begins where the last left the walker
  let walk;
  const dbg = () => walk.evaluate(() => window.__ug.modes.registry.get('pedestrian').debug());
  test.beforeAll(async ({ browser }, info) => {
    await page?.close(); page = null; await lb?.close(); lb = null;   // one GPU page at a time
    walk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    walk.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    walk.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await walk.goto(`${info.project.use.baseURL ?? 'http://localhost:5243'}/?skip=1&buildings=baked`);
    await walk.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
    await walk.waitForFunction(() => {
      const b = window.__ug.bakedStats;
      return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
        && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.modes.ctx.tubeRoutes?.size > 11
        && window.__ug.surfaceRail && window.__ug.surfaceTrains && window.__ug.termini?.corridor.ready;
    }, null, { timeout: 180000 });
    await walk.keyboard.press('2');
    await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
  });
  test.afterAll(async () => { await walk?.close(); });

  const placeAt = (lineId, from, toward) => walk.evaluate(([lineId, from, toward]) => {
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

  /** As tests/pedestrian-open-air.spec.js ride(): walk with the keys until `until` is arrived at (or maxMs), measuring every frame. */
  const ride = ({ lineId, until = null, keys = ['w', 'shift'], maxMs = 100000, via = null }) => walk.evaluate(async ({ lineId, until, keys, maxMs, via }) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian');
    const { distanceToDrawn, buildSegmentIndex } = await import('/src/surface-train-map.js');
    const { sampleM25Insideness } = await import('/src/m25.js');
    const { getMapEdgeRing, signedDistanceToRing } = await import('/src/m25-edge.js');
    const ring = getMapEdgeRing();
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const net = m.network, st = ug.surfaceTrains;
    const tn = st.networkFor(lineId), idx = tn.index || buildSegmentIndex(tn.net);
    const flare = document.getElementById('ug-portal-flare');
    const c0 = m.debug().clock;
    const since = (d) => d.arrivals.filter(a => a.at > c0);
    const is = (name, want) => name === want || name.replace(/\s*\(.*\)$/, '') === want;
    const posOf = (name) => net.entrances.filter(en => is(en.name, name) && en.stops.some(x => x.lineId === lineId));
    const frames = [], smp = {};
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
          inside: sampleM25Insideness(c.x, c.z), ringD: signedDistanceToRing(c.x, c.z, ring), above: ug.aboveGroundView, cut: d.openAir.cut?.kind ?? null,
          flare: +getComputedStyle(flare).opacity, card: d.card?.kind ?? null, edge: d.atEdge, interior: d.interior.visible,
          hint: document.getElementById('ug-mode-hint')?.textContent ?? '', arrivals: since(d).length };
        if (d.regime === 'open' && d.shown) {
          f.extra = d.shown.extra; f.lane = d.shown.lane; f.bridged = !!d.shown.bridged;
          f.dTrack = distanceToDrawn(tn.net, idx, c.x, c.z, 200);
          const q = m.openAir.present(net.paths[d.tunnel.path], d.tunnel.s, 0, smp);
          f.runOff = q.mapped ? distanceToDrawn(tn.net, idx, q.x, q.z, 200) : null;
        }
        frames.push(f);
        if (d.phase !== 'tunnel') break;
        if (until && since(d).some(a => is(a.name, until))) break;
      }
    } finally { for (const k of keys) ug.fpsControls.keys.delete(k); }
    const d = m.debug();
    return { frames, arrivals: since(d), ratio: st.ratio, end: { tunnel: d.tunnel, regime: d.regime, atEdge: d.atEdge, edge: d.edge } };
  }, { lineId, until, keys, maxMs, via });

  const TRACK_SLACK_M = 30;
  function checkOpenFrames(r, label) {
    const open = r.frames.filter(f => f.regime === 'open' && f.phase === 'tunnel');
    expect(open.length, `${label}: frames shown on the drawn track`).toBeGreaterThan(30);
    let onRun = 0;
    for (const f of open) {
      expect(f.y, `${label}: above the terrain at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeGreaterThanOrEqual(f.g + 0.5 * VE * r.ratio - 1e-6);
      if (f.inside >= 0.999) expect(f.above, `${label}: the D-040 cull holds at insideness ${f.inside}`).toBe(true);
      expect(f.interior, `${label}: no lining in the open`).toBe(false);
      if (f.bridged) continue;
      const lim = 2.6 + (f.extra || 0) + 1;
      expect(f.dTrack, `${label}: near the drawn track at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeLessThanOrEqual(lim + TRACK_SLACK_M);
      if (f.runOff !== null && f.runOff <= 0.5) { onRun++; expect(f.dTrack, `${label}: in its lane at ${f.x.toFixed(0)}, ${f.z.toFixed(0)}`).toBeLessThanOrEqual(lim); }
    }
    expect(onRun / open.length, `${label}: most of the walk is on the drawn track itself`).toBeGreaterThan(0.9);
  }
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

  test('T-W1: the seven are stops; nothing is held', async () => {
    const s = await walk.evaluate(() => {
      const m = window.__ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
      const names = new Set(net.paths.flatMap(p => p.stops.map(x => x.stop.name.replace(/\s*\(.*\)$/, '').replace(/ (Underground|Rail) Station$/, ''))));
      return { names: ['Epping', 'Chorleywood', 'Chalfont & Latimer', 'Amersham', 'Chesham'].map(n => [n, [...names].some(x => x.startsWith(n))]),
        edgeStops: net.stats.edgeStops, edges: net.paths.filter(p => p.edge && p.edge.length).map(p => p.id) };
    });
    console.log('[termini] stops', JSON.stringify(s));
    for (const [n, ok] of s.names) expect(ok, `${n} is a stop`).toBe(true);
    expect(s.edgeStops).toBe(0);
    expect(s.edges, 'no path has an edge stretch').toEqual([]);
  });

  test('T-W2 and T-W8: Debden to Epping: Epping is arrived at in the open, and the street there is a step aside, not a shaft', async () => {
    expect(await placeAt('central', 'Debden', 'Theydon Bois')).not.toBeNull();
    const r = await ride({ lineId: 'central', until: 'Epping' });
    expect(r.arrivals.map(a => a.name)).toEqual(['Theydon Bois', 'Epping']);
    expect(r.arrivals.at(-1).regime).toBe('open');
    expect(r.end.atEdge).toBe(false);
    checkOpenFrames(r, 'Central to Epping');
    expect(Math.min(...r.frames.map(f => f.ringD)), 'an open frame more than 500 m beyond the ring').toBeLessThanOrEqual(-500);
    // T-W8: the card at Epping and the street.
    await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
    const card = await dbg();
    expect(card.chooser.rows[0]).toBe('Up to the street');
    await walk.keyboard.press('1');
    const seen = await walk.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r)), log = [];
      for (let i = 0; i < 400; i++) { await frame(); const d = m.debug(), c = ug.camera.position; log.push({ phase: d.phase, y: c.y, g: ug.modes.ctx.getTerrainY(c.x, c.z) }); if (d.phase === 'body') break; }
      return log;
    });
    expect(seen.some(f => f.phase === 'step'), 'a step aside').toBe(true);
    expect(seen.some(f => f.phase === 'shaft' || f.phase === 'passage'), 'never a shaft or a passage').toBe(false);
    expect(seen.at(-1).phase).toBe('body');
  });

  test('T-W3: Moor Park to Amersham, every stop in order, in the open', async () => {
    expect(await placeAt('metropolitan', 'Moor Park', 'Rickmansworth')).not.toBeNull();
    const r = await ride({ lineId: 'metropolitan', until: 'Amersham', via: ['Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Amersham'] });
    expect(r.arrivals.map(a => a.name)).toEqual(['Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Amersham']);
    expect(r.arrivals.at(-1).regime).toBe('open');
    checkOpenFrames(r, 'Metropolitan to Amersham');
    const v = speeds(r, 200);
    expect(v.length).toBeGreaterThan(5);
    expect(Math.abs(median(v) - 200), `median ${median(v)}`).toBeLessThanOrEqual(6);
  });

  test('T-W5 and T-W6: Up to the street at Amersham lands on the hidden ground, and 300 m on it with no fall, jump or hold', async () => {
    await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
    const card = await dbg();
    expect(card.chooser.rows[0]).toBe('Up to the street');
    await walk.keyboard.press('1');
    const seen = await walk.evaluate(async () => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r)), log = [];
      for (let i = 0; i < 400; i++) { await frame(); const d = m.debug(), c = ug.camera.position;
        log.push({ phase: d.phase, state: d.state, y: c.y, g: ug.termini.hiddenGround.terrainY(c.x, c.z), step: d.step ? { to: { ...d.step.to }, station: d.step.station ? { ...d.step.station } : null } : null }); if (d.phase === 'body') break; }
      return log;
    });
    expect(seen.some(f => f.phase === 'step')).toBe(true);
    expect(seen.at(-1).phase).toBe('body');
    for (const f of seen) expect(f.y, 'the step is above the hidden ground').toBeGreaterThanOrEqual(f.g + 1 * VE - 1e-6);
    const d = await dbg();
    expect(d.state).toBe('ground');
    const g = await walk.evaluate(([x, z]) => window.__ug.termini.hiddenGround.terrainY(x, z), [d.x, d.z]);
    expect(Math.abs(d.y - g), `the body at ${d.y} stands on the hidden ground ${g}`).toBeLessThanOrEqual(0.05);
    // T-W6: turn away from the track and walk.
    const st = seen.find(f => f.step)?.step;
    const away = st?.station ? Math.atan2(-(st.to.x - st.station.x), -(st.to.z - st.station.z)) : null;
    const w = await walk.evaluate(async ({ away }) => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r));
      const d0 = m.debug();
      if (away !== null) m.turn(Math.atan2(Math.sin(away - d0.yaw), Math.cos(away - d0.yaw)), 0);
      const x0 = d0.x, z0 = d0.z, log = [], t0 = performance.now();
      for (const k of ['w', 'shift']) ug.fpsControls.keys.add(k);
      let prevY = d0.y, worstStep = 0, bad = 0, held = false, off = 0;
      try {
        while (performance.now() - t0 < 120000) {
          await frame();
          const d = m.debug(), g = ug.termini.hiddenGround.terrainY(d.x, d.z);
          worstStep = Math.max(worstStep, Math.abs(d.y - prevY)); prevY = d.y;
          if (d.state !== 'ground') bad++;
          off = Math.max(off, Math.abs(d.y - g));
          if ((document.getElementById('ug-mode-hint')?.textContent ?? '').includes('The map ends here')) held = true;
          if (Math.hypot(d.x - x0, d.z - z0) >= 300) break;
        }
      } finally { for (const k of ['w', 'shift']) ug.fpsControls.keys.delete(k); }
      const d = m.debug();
      return { metres: Math.hypot(d.x - x0, d.z - z0), worstStep, bad, held, off, seconds: (performance.now() - t0) / 1000, ringD: null };
    }, { away });
    console.log('[termini] walk on the hidden ground', JSON.stringify(w));
    expect(w.metres).toBeGreaterThanOrEqual(300);
    expect(w.bad, 'frames not on the ground (a fall or a jump)').toBe(0);
    expect(w.worstStep, 'the largest step in y between frames (scene units; 2.5 = 0.5 m)').toBeLessThanOrEqual(2.5);
    expect(w.off, 'y within 0.05 of the hidden ground').toBeLessThanOrEqual(0.05);
    expect(w.held, 'the hint never says the map ends').toBe(false);
  });

  test('T-W7: the soft hold at the terrain grid: 200 m inside its bounds, "The map ends here", and S walks back', async () => {
    const b = await walk.evaluate(() => { const t = window.__ug.getTerrainBounds(); return { minZ: t.minZ }; });
    await walk.evaluate(([x, z]) => window.__ug.modes.registry.get('pedestrian').place(x, z, { yaw: 0 }), [-34000, b.minZ + 500]);
    const r = await walk.evaluate(async (minZ) => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(res => requestAnimationFrame(res));
      for (const k of ['w', 'shift']) ug.fpsControls.keys.add(k);
      const t0 = performance.now(); let hint = '', held = '';
      while (performance.now() - t0 < 100000) {
        await frame(); const d = m.debug();
        hint = document.getElementById('ug-mode-hint')?.textContent ?? '';
        if (d.z - minZ < 215 && hint.includes('The map ends here')) { held = hint; await new Promise(res => setTimeout(res, 1500)); held = document.getElementById('ug-mode-hint')?.textContent ?? held; break; }
      }
      const d = m.debug(), inside = d.z - minZ;
      for (const k of ['w', 'shift']) ug.fpsControls.keys.delete(k);
      await frame();
      const z0 = d.z;
      ug.fpsControls.keys.add('s'); await new Promise(res => setTimeout(res, 3000)); ug.fpsControls.keys.delete('s');
      return { inside, hint: held, backM: m.debug().z - z0 };
    }, b.minZ);
    console.log('[termini] soft hold', JSON.stringify(r));
    expect(r.inside, 'distance inside the grid bound').toBeGreaterThanOrEqual(180); expect(r.inside).toBeLessThanOrEqual(220);
    expect(r.hint).toContain('The map ends here');
    expect(r.backM, 'S walks back').toBeGreaterThanOrEqual(10);
  });

  test('T-W4: Moor Park to Chesham, every stop in order, in the open', async () => {
    expect(await placeAt('metropolitan', 'Moor Park', 'Rickmansworth')).not.toBeNull();
    const r = await ride({ lineId: 'metropolitan', until: 'Chesham', via: ['Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Chesham'], maxMs: 150000 });
    expect(r.arrivals.map(a => a.name)).toEqual(['Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Chesham']);
    expect(r.arrivals.at(-1).regime).toBe('open');
    checkOpenFrames(r, 'Metropolitan to Chesham');
  });

  test('T-C1 (walk): no console error through the walks', async () => {
    expect(errors).toEqual([]);
  });
});
