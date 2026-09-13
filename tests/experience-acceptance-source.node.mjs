import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
import { createSchematicMapping, ORIENTATION_ROUTES, orientationRoutePath } from '../src/mini-map.js';
import data from '../src/mini-map-data.json' with { type: 'json' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const project = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - BNG_REF_E, z: BNG_REF_N - n }; };
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
};

test('revised displayed paths follow original TfL coordinates and interstation geographic movement', async () => {
  const mapping = createSchematicMapping({ projectStation: project });
  const index = JSON.parse(await readFile(new URL('../public/data/tfl/route-sequence/index.json', import.meta.url)));
  let samples = 0, maximum = 0;
  for (const route of ORIENTATION_ROUTES) {
    const original = JSON.parse(await readFile(new URL(`../public/data/tfl/route-sequence/${index.lines[route.line].file}`, import.meta.url)));
    const sourcePoints = original.stopPointSequences.flatMap(s => s.stopPoint);
    for (const station of route.geographic) assert.ok(sourcePoints.some(s => Math.abs(s.lat - station.lat) < .00006 && Math.abs(s.lon - station.lon) < .00006),
      `${route.line}: ${station.name} must retain original source geography`);
    const vertices = [...orientationRoutePath(mapping, route.stops).matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m => [+m[1], +m[2]]);
    for (let i = 1; i < route.geographic.length; i++) {
      const a = route.geographic[i - 1], b = route.geographic[i];
      for (let k = 0; k <= 19; k++) {
        const t = k / 19, p = project(a.lat * (1 - t) + b.lat * t, a.lon * (1 - t) + b.lon * t);
        const q = mapping.map(p.x, p.z);
        const error = Math.min(...vertices.slice(1).map((v, j) => distance(q, vertices[j], v))) * 320 / data.width;
        maximum = Math.max(maximum, error); samples++;
        assert.ok(error < 1.5, `${route.line} ${a.name} to ${b.name}, ${t}: ${error} CSS pixels`);
      }
    }
  }
  console.log(JSON.stringify({ mapSourceAndMotionSamples: samples, maximumCssError: maximum }));
});

test('all fourteen park registry entries retain independently checked source hashes and coordinates', async () => {
  const registry = JSON.parse(await readFile(new URL('../public/data/park-labels.json', import.meta.url)));
  assert.equal(registry.parks.length, 14);
  const cached = new Map();
  let tileSources = 0, repairedVertices = 0;
  for (const park of registry.parks) {
    const provenance = park.provenance;
    if (provenance.sourceTiles) {
      for (const source of provenance.sourceTiles) {
        if (!cached.has(source.file)) cached.set(source.file, await readFile(new URL(`../public/data/surface/tiles/${source.file}`, import.meta.url)));
        const bytes = cached.get(source.file);
        assert.equal(hash(bytes), source.sha256, source.file);
        const candidates = JSON.parse(bytes).parks.filter(p => p.name === park.name);
        assert.ok(candidates.some(p => park.rings[0].every(point => p.polygon.some(q => q[0] === point[0] && q[1] === point[1]))), park.name);
        tileSources++;
      }
    } else {
      const bytes = await readFile(new URL(`../${provenance.file}`, import.meta.url));
      assert.equal(hash(bytes), provenance.sha256);
      const original = JSON.parse(bytes);
      const relationId = Number(provenance.osm.split('/')[1]);
      const relation = original.elements.find(e => e.type === 'relation' && e.id === relationId);
      assert.ok(relation);
      const ways = new Map(original.elements.filter(e => e.type === 'way').map(w => [w.id, w]));
      const nodes = new Map(original.elements.filter(e => e.type === 'node').map(n => [n.id, n]));
      for (const [role, rings] of [['outer', park.rings], ['inner', park.holes]]) {
        const segments = new Set();
        const key = id => { const n = nodes.get(id), p = project(n.lat, n.lon); return `${p.x.toFixed(3)},${p.z.toFixed(3)}`; };
        for (const member of relation.members.filter(m => m.type === 'way' && m.role === role)) {
          const ids = ways.get(member.ref).nodes;
          for (let i = 1; i < ids.length; i++) segments.add([key(ids[i - 1]), key(ids[i])].sort().join('|'));
        }
        for (const ring of rings) for (let i = 0; i < ring.length; i++) {
          const a = ring[i].map(v => v.toFixed(3)).join(','), b = ring[(i + 1) % ring.length].map(v => v.toFixed(3)).join(',');
          assert.ok(segments.has([a, b].sort().join('|')), `${park.name}: every repaired edge must be an actual ${role} way edge`);
          repairedVertices++;
        }
      }
    }
  }
  console.log(JSON.stringify({ parks: registry.parks.length, tileSources, repairedVertices }));
});
