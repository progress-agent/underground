// station-buildings-ground.test.mjs: lane B fix round 1. The tracked station-buildings.json against the app's own ground.
//
// The checker found 85 of 1,995 wall roundels (20 buildings: King's Cross, Waterloo, Euston, London Bridge, Liverpool
// Street...) with their centre below the street 1 m outside their wall at Master 1.1: a roundel hung at half the wall
// height above the building's base, the lowest ground under it, and on a slope the street on the high side is above that.
// This reads the ground with the app's OWN terrain code under the bake's Node shim (as the builder does) and holds every
// wall roundel above the street in front of it at Master 1.0 and 1.1. A separate file: the shim defines a `document`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_PATH = path.join(ROOT, 'public/data/station-buildings.json');
const have = fs.existsSync(JSON_PATH) && fs.existsSync(path.join(ROOT, 'public/data/surface/baked/meta.json'));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

test('no wall roundel is under the street in front of it (Master 1.0 and 1.1), and every ring stays under the roof', { skip: !have, timeout: 120000 }, async () => {
  const { installNodeEnv } = await imp('scripts/bake-node-env.mjs');
  installNodeEnv();
  const terrain = await imp('src/terrain.js');
  const { centroid, rectRing } = await imp('src/station-building-geometry.js');
  const thames = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
  assert.ok(await terrain.tryCreateTerrainMesh({ thamesData: thames }), 'the terrain builds under the shim');
  const VE = terrain.VERTICAL_EXAGGERATION;
  // Integration 02Oct26f: the app's ground is lane T's hidden ground beyond the map edge (identical to the structural sampler
  // on the map), which is what the runtime stands the buildings on and what the walker stands on in front of them.
  const { isOffMapEdge } = await imp('src/m25-edge.js');
  const { createHiddenGround } = await imp('src/hidden-ground.js');
  const hidden = createHiddenGround({ getTerrainMeshSurfaceY: terrain.getTerrainMeshSurfaceY, getStructuralSurfaceY: terrain.getStructuralSurfaceY, getTerrainBounds: terrain.getTerrainBounds, isOffMapEdge });
  const Y = (x, z) => hidden.structuralY(x, z) / VE;
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const wide = 500 / (2 * 203.1445);
  const rows = { 1: 0, 1.1: 0 }; let rings = 0, worst = Infinity;
  for (const b of data.buildings) {
    const ring = b.outline ?? rectRing(b.pavilion);
    const base = Math.min(...[...ring, centroid(ring)].map(([x, z]) => Y(x, z)));
    for (const r of b.roundels.filter(q => q.on === 'wall')) {
      rings++;
      assert.ok(r.yM + r.D / 2 <= b.height + 1e-6, `${b.key}: a ring's top ${(r.yM + r.D / 2).toFixed(2)} is over the roof ${b.height}`);
      assert.ok(r.D >= 3.4 && r.D <= 6 + 1e-9, `${b.key}: ring ${r.D}`);
      const half = r.D * wide / 2, tx = r.nz, tz = -r.nx;
      for (const M of [1, 1.1]) {
        let g = -Infinity;
        for (let s = -half; s <= half + 1e-9; s += half / 4) for (const off of [0, 1, 3]) g = Math.max(g, (Y(r.x + tx * s + r.nx * off, r.z + tz * s + r.nz * off) - base) * M);
        const clear = r.yM - r.D / 2 - g;
        if (M === 1.1) worst = Math.min(worst, clear);
        if (clear < 0.3) rows[M]++;
      }
    }
  }
  console.log(`${rings} wall roundels; under the street (clear < 0.3 m): Master 1.0 ${rows[1]}, Master 1.1 ${rows[1.1]}; tightest clearance at 1.1 ${worst.toFixed(2)} m`);
  assert.equal(rows[1], 0, 'Master 1.0');
  assert.equal(rows[1.1], 0, 'Master 1.1');
});

test('the exit stands in front of a wall roundel at King\'s Cross and for nine in ten buildings that carry one', { skip: !fs.existsSync(JSON_PATH) }, () => {
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const inFront = (b) => {
    const fx = -Math.sin(b.exit.yaw), fz = -Math.cos(b.exit.yaw);
    return b.roundels.filter(r => r.on === 'wall').some(r => r.nx * fx + r.nz * fz > 0.95
      && Math.abs((b.exit.x - r.x) * r.nz - (b.exit.z - r.z) * r.nx) <= r.D * 500 / 406.289 / 2 * 0.7
      && (b.exit.x - r.x) * r.nx + (b.exit.z - r.z) * r.nz > 4 && (b.exit.x - r.x) * r.nx + (b.exit.z - r.z) * r.nz < 9);
  };
  const kx = data.buildings.find(b => /King.s Cross/.test(b.title));
  assert.ok(inFront(kx), 'King\'s Cross: the street view shows a roundel');
  const withWalls = data.buildings.filter(b => b.roundels.some(r => r.on === 'wall'));
  const n = withWalls.filter(inFront).length;
  assert.ok(n / withWalls.length >= 0.9, `${n} of ${withWalls.length}`);
});
