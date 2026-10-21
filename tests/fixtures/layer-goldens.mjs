// Geometry hashes of the two late layers whose builders became generators (sprint 21Oct26w, lane L, approach E):
// the airports and the M25 motorway, built over a fixed synthetic terrain. Run against a checkout to hash ITS builders:
//   node tests/fixtures/layer-goldens.mjs <repo root>
// The goldens in layer-goldens.json are 7c2d4bd's (the live worktree); tests/late-layer-builders.test.mjs holds the
// branch to them. The modules are loaded through a Vite SSR server so their JSON imports and relative paths behave as
// they do in the app.
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const sha = (arr) => createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');

/** A smooth, bounded, deterministic terrain in scene Y (VE already applied): a few hundred units of relief. */
export function syntheticSurface({ x, z }) {
  return 40 + 25 * Math.sin(x / 2300) * Math.cos(z / 1900) + 12 * Math.sin((x + z) / 700) + 5 * Math.cos(x / 130 + z / 170);
}

export function hashGroup(root) {
  const meshes = [];
  root.traverse((o) => {
    if (!o.geometry) return;
    const attrs = Object.entries(o.geometry.attributes).sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, a]) => `${name}:${a.itemSize}:${a.array.length}:${sha(a.array)}`);
    const index = o.geometry.index ? `${o.geometry.index.array.length}:${sha(o.geometry.index.array)}` : null;
    meshes.push({ name: o.name || o.type, type: o.type, attrs, index, count: o.isInstancedMesh ? o.count : undefined });
  });
  return { children: root.children.length, meshes };
}

export async function layerHashes(repoRoot, { tmp = path.join(os.tmpdir(), 'ug-layer-goldens-cache') } = {}) {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const realLog = console.log; console.log = (...a) => console.error(...a); // the builders log; stdout is the JSON
  const { createServer } = require('vite');
  const server = await createServer({ root: repoRoot, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: tmp,
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const out = {};
    const airports = await server.ssrLoadModule('/src/airports.js');
    out.airports = hashGroup(airports.createAirports({ getSurfaceY: syntheticSurface, VE: 5, heightScale: 1 }));
    const motorway = await server.ssrLoadModule('/src/m25-motorway.js');
    const mw = motorway.createMotorway({ getSurfaceY: syntheticSurface, VE: 5, heightScale: 1 });
    out.motorway = hashGroup(mw);
    out.motorwayStats = { ...mw.userData.stats, drawCalls: undefined };
    // The traffic's layout (every vehicle's chainage, wobble, class and lane pick), which the geometry hashes do not cover.
    out.motorwayLayout = mw.userData.carriers.map(c => Object.fromEntries(['base', 'amp', 'omega', 'phase', 'type', 'colour', 'lanePick'].map(k => [k, sha(c.layout[k])])));
    // The cliff (Thames waterfalls and the exterior column), the flights, the reservoirs and the canals, over the real
    // data files, the real map-edge ring and the synthetic terrain.
    const { readFileSync } = await import('node:fs');
    const readJson = (f) => JSON.parse(readFileSync(path.join(repoRoot, 'public/data', f), 'utf8'));
    const m25data = readJson('m25.json'), thames = readJson('thames.json');
    const m25 = await server.ssrLoadModule('/src/m25.js');
    const edge = await server.ssrLoadModule('/src/m25-edge.js');
    const clip = await server.ssrLoadModule('/src/map-edge-clip.js');
    const { BNG_REF_E, BNG_REF_N } = await server.ssrLoadModule('/src/coordinates.js');
    const proj4 = require('proj4');
    m25.initM25Boundary(m25data.supportPoints || m25data.points);
    const ring = edge.getMapEdgePointsBNG();
    const crossings = m25.computeThamesCrossings(thames.points, ring, syntheticSurface);
    out.crossings = JSON.parse(JSON.stringify(crossings));
    out.waterfalls = hashGroup(m25.createThamesWaterfalls(thames.points, ring, syntheticSurface));
    out.exterior = hashGroup((await server.ssrLoadModule('/src/geology-exterior.js')).createGeologyExterior(ring, -300, syntheticSurface, crossings));
    out.flights = hashGroup((await server.ssrLoadModule('/src/flights.js')).createFlights({ getSurfaceY: syntheticSurface, VE: 5 }));
    const llToXZ = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) }; };
    const reservoirs = clip.clipWaterToMapEdge(readJson('reservoirs.json'), llToXZ, edge.getMapEdgeRing(), { kind: 'polygon' });
    out.reservoirs = hashGroup((await server.ssrLoadModule('/src/reservoirs.js')).createReservoirs(reservoirs.data, clip.SCENE_XZ, syntheticSurface));
    const canals = clip.clipWaterToMapEdge(readJson('canals.json'), llToXZ, edge.getMapEdgeRing(), { kind: 'polyline', endInsetM: 6 });
    out.canals = hashGroup((await server.ssrLoadModule('/src/canals.js')).createCanals(canals.data, clip.SCENE_XZ, syntheticSurface));
    return out;
  } finally { console.log = realLog; await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await layerHashes(path.resolve(process.argv[2]))));
}
