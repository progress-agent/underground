// The airports and the M25 motorway became generators (sprint 21Oct26w, lane L, approach E; acceptance L-03): drained in
// one go, and driven slice by slice through the late-layer registry, they build the geometry 7c2d4bd built, hash for hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { layerHashes, hashGroup, syntheticSurface } from './fixtures/layer-goldens.mjs';
import { createLateLayers } from '../src/late-layers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/layer-goldens.json'), 'utf8'));

test('airports and motorway equal the 7c2d4bd geometry, drained in one call', { timeout: 120000 }, async () => {
  const got = JSON.parse(JSON.stringify(await layerHashes(ROOT, { tmp: path.join(os.tmpdir(), 'ug-layer-goldens-test') })));
  assert.deepEqual(got.airports, GOLD.airports);
  assert.deepEqual(got.motorway, GOLD.motorway);
  assert.deepEqual(got.motorwayStats, GOLD.motorwayStats);
  assert.deepEqual(got.motorwayLayout, GOLD.motorwayLayout, 'the traffic layout of every vehicle');
});

test('driven through the registry in small slices, every late layer gives the same geometry and every step is short', { timeout: 300000 }, async () => {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const { createServer } = require('vite');
  const realLog = console.log; console.log = (...a) => console.error(...a);
  const server = await createServer({ root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
    cacheDir: path.join(os.tmpdir(), 'ug-layer-goldens-test2'), server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const load = (f) => server.ssrLoadModule(f);
    const [airports, motorway, m25, edge, clip, coords, exterior, flights, reservoirs, canals] = await Promise.all(
      ['airports', 'm25-motorway', 'm25', 'm25-edge', 'map-edge-clip', 'coordinates', 'geology-exterior', 'flights', 'reservoirs', 'canals'].map(n => load(`/src/${n}.js`)));
    const proj4 = require('proj4');
    const { readFileSync } = await import('node:fs');
    const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, 'public/data', f), 'utf8'));
    const m25data = readJson('m25.json'), thames = readJson('thames.json');
    m25.initM25Boundary(m25data.supportPoints || m25data.points);
    const ring = edge.getMapEdgePointsBNG();
    const llToXZ = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - coords.BNG_REF_E, z: -(n - coords.BNG_REF_N) }; };
    const built = {};
    const layers = createLateLayers({ budgetMs: 2 });
    layers.define('airports', { steps: () => airports.createAirportsSteps({ getSurfaceY: syntheticSurface, VE: 5, heightScale: 1 }), attach: (g) => { built.airports = g; } });
    layers.define('motorway', { steps: () => motorway.createMotorwaySteps({ getSurfaceY: syntheticSurface, VE: 5, heightScale: 1 }), attach: (g) => { built.motorway = g; } });
    layers.define('cliff', {
      steps: function* () {
        const crossings = yield* m25.computeThamesCrossingsSteps(thames.points, ring, syntheticSurface);
        yield;
        const waterfalls = m25.createThamesWaterfalls(thames.points, ring, syntheticSurface, crossings);
        yield;
        const ext = yield* exterior.createGeologyExteriorSteps(ring, -300, syntheticSurface, crossings);
        return { crossings, waterfalls, ext };
      },
      attach: (r) => { built.crossings = r.crossings; built.waterfalls = r.waterfalls; built.exterior = r.ext; },
    });
    layers.define('flights', { steps: () => flights.createFlightsSteps({ getSurfaceY: syntheticSurface, VE: 5 }), attach: (g) => { built.flights = g; } });
    layers.define('reservoirs', {
      steps: function* () { const c = yield* clip.clipWaterToMapEdgeSteps(readJson('reservoirs.json'), llToXZ, edge.getMapEdgeRing(), { kind: 'polygon' }); yield; return yield* reservoirs.createReservoirsSteps(c.data, clip.SCENE_XZ, syntheticSurface); },
      attach: (g) => { built.reservoirs = g; } });
    layers.define('canals', {
      steps: function* () { const c = yield* clip.clipWaterToMapEdgeSteps(readJson('canals.json'), llToXZ, edge.getMapEdgeRing(), { kind: 'polyline', endInsetM: 6 }); yield; return yield* canals.createCanalsSteps(c.data, clip.SCENE_XZ, syntheticSurface); },
      attach: (g) => { built.canals = g; } });
    let frames = 0;
    while (layers.remaining() && frames < 200000) { layers.pump(); frames++; await new Promise(r => setImmediate(r)); }
    assert.ok(layers.settled());
    const j = (x) => JSON.parse(JSON.stringify(x));
    for (const id of ['airports', 'motorway', 'exterior', 'flights', 'reservoirs', 'canals']) assert.deepEqual(j(hashGroup(built[id])), GOLD[id], id);
    assert.deepEqual(j(hashGroup(built.waterfalls)), GOLD.waterfalls, 'waterfalls from the shared crossings');
    assert.deepEqual(j(built.crossings), GOLD.crossings);
    const snap = Object.fromEntries(layers.snapshot().map(l => [l.id, l]));
    const summary = Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, { steps: v.steps, maxStepMs: v.maxStepMs, buildMs: v.buildMs }]));
    console.error('registry steps', JSON.stringify(summary));
    // The point of slicing: many steps, none long. The opening's own criterion (at most 8 ms on the Studio) is
    // measured in the page by the registry's maxStepMs.
    // Relative to the layer's own total, so a loaded machine (the whole node suite runs in parallel) cannot fail it on a GC pause:
    // a monolithic layer has one step that is nearly all of its build.
    for (const [id, l] of Object.entries(snap)) assert.ok(l.maxStepMs < 0.4 * l.buildMs, `${id} max step ${l.maxStepMs} ms of ${l.buildMs} ms`);
    for (const id of ['airports', 'motorway']) assert.ok(snap[id].steps > 20, `${id} steps ${snap[id].steps}`);
  } finally { console.log = realLog; await server.close(); }
});
