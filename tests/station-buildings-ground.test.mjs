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

test('no wall roundel is under the street in front of it at Master 1.0, 1.1, 1.5 and 3, every ring stays under the roof, and no street stands over a roof', { skip: !have, timeout: 180000 }, async () => {
  // Sprint 14Oct26w (D-053 item 9, "roundels dipping into the street at high Master"). 02Oct26f held Master 1.0 and 1.1 at three
  // offsets (0.05, 1, 3 m); the street 6 m out was higher at 15 rings (0.28 m) and, above 1.1, 148 rings dipped at 1.5 and 583 at 3.
  // A station now keeps, on a slope, the wall it has above its highest street at 1.1 (riseM, in the data): its roof and every ring rise
  // with the street above 1.1. This reads the ground with the app's OWN terrain code (as the builder does) and the displayed extents
  // from the runtime's own formula (station-buildings.js roundelExtent / displayedRoofY, the vertex shader's), at four Masters,
  // with the street sampled at 0.05, 1, 3 and 6 m out across the ring's width.
  const { installNodeEnv } = await imp('scripts/bake-node-env.mjs');
  installNodeEnv();
  const terrain = await imp('src/terrain.js');
  const { centroid, rectRing, footprintOf } = await imp('src/station-building-geometry.js');
  const { roundelExtent, displayedRoofY } = await imp('src/station-buildings.js');
  const thames = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
  assert.ok(await terrain.tryCreateTerrainMesh({ thamesData: thames }), 'the terrain builds under the shim');
  const VE = terrain.VERTICAL_EXAGGERATION;
  // Integration 02Oct26f: the app's ground is lane T's hidden ground beyond the map edge (identical to the structural sampler
  // on the map), which is what the runtime stands the buildings on and what the walker stands on in front of them.
  const { isOffMapEdge } = await imp('src/m25-edge.js');
  const { createHiddenGround } = await imp('src/hidden-ground.js');
  const hidden = createHiddenGround({ getTerrainMeshSurfaceY: terrain.getTerrainMeshSurfaceY, getStructuralSurfaceY: terrain.getStructuralSurfaceY, getTerrainBounds: terrain.getTerrainBounds, isOffMapEdge });
  const Y = (x, z) => hidden.structuralY(x, z);          // canonical
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const wide = 500 / (2 * 203.1445);
  const dip = { 1: 0, 1.1: 0, 1.5: 0, 3: 0 }, worst = { 1: -Infinity, 1.1: -Infinity, 1.5: -Infinity, 3: -Infinity }; let rings = 0;
  const lowRoof = []; // buildings whose roof is not 0.5 m over their highest lattice street
  for (const b of data.buildings) {
    const ring = footprintOf(b);
    const base = Math.min(...[...ring, centroid(ring)].map(([x, z]) => Y(x, z)));
    for (const r of b.roundels.filter(q => q.on === 'wall')) {
      rings++;
      const topAtDesign = r.yM + r.D / 2, roofH = r.host ? b.host.h : b.height;
      assert.ok(topAtDesign <= roofH + 1e-6, `${b.key}: a ring's top ${topAtDesign.toFixed(2)} is over the roof ${roofH}`);
      assert.ok(r.D >= 3.4 && r.D <= 6 + 1e-9, `${b.key}: ring ${r.D}`);
      if (!r.host) assert.ok((b.riseM ?? -1) >= (r.gM ?? 0) - 1e-9, `${b.key}: riseM ${b.riseM} under a ring's street ${r.gM}`);
      const tx = r.nz, tz = -r.nx, W = r.D * wide;
      for (const M of [1, 1.1, 1.5, 3]) {
        const scale = 1 / M, e = roundelExtent(b, r, r.host ? 0 : base, scale, { VE });
        let street = -Infinity;
        for (const off of [0.05, 1, 3, 6]) for (let k = 0; k <= 8; k++) street = Math.max(street, Y(r.x + tx * (k / 8 - 0.5) * W + r.nx * off, r.z + tz * (k / 8 - 0.5) * W + r.nz * off));
        const d = (street - e.bottomY) / (5 * scale);
        worst[M] = Math.max(worst[M], d);
        if (d > 0) dip[M]++;
        const roofY = r.host ? b.host.baseM * VE + b.host.h * VE * scale : displayedRoofY(b, base, scale, { VE });
        assert.ok(e.topY <= roofY + 0.01 * 5 * scale, `${b.key} at Master ${M}: a ring's top is over the roof`);
      }
    }
    // Clearance of the roof over the highest street of the lattice (vertices, centroid, every edge at 1 m, offsets 0.05 to 6.5).
    let hi = -Infinity;
    const take = (x, z) => { const y = Y(x, z); if (Number.isFinite(y) && y > hi) hi = y; };
    for (const p of ring) take(p[0], p[1]);
    take(...centroid(ring));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-6) continue;
      const n = [-(c[1] - a[1]) / L, (c[0] - a[0]) / L], k = Math.max(1, Math.ceil(L));
      // (the outward normal depends on the winding: the data's rings are counter-clockwise, outward = (-dz, dx) / L)
      for (let j = 0; j <= k; j++) for (const off of [0.05, 1, 3, 6]) take(a[0] + (c[0] - a[0]) * j / k + n[0] * off, a[1] + (c[1] - a[1]) * j / k + n[1] * off);
    }
    for (const M of [1.1, 1.5, 3]) {
      const scale = 1 / M, roof = displayedRoofY(b, base, scale, { VE });
      // (street above the base is stretched with the terrain: the displayed street is base + (hi - base) x M / 5 in true metres)
      const displayedStreet = ((hi - base) / VE) * M;
      const clearance = (roof - base) / (5 * scale) - displayedStreet;
      if (clearance < 0.5 && !b.flags.includes('street-near-roof')) lowRoof.push(`${b.key} ${b.title} M${M} ${clearance.toFixed(2)}`);
    }
  }
  console.log(`${rings} wall roundels; worst dip (m) at Master 1.0 ${worst[1].toFixed(3)}, 1.1 ${worst[1.1].toFixed(3)}, 1.5 ${worst[1.5].toFixed(3)}, 3 ${worst[3].toFixed(3)}; roofs not 0.5 m clear: ${lowRoof.length}`);
  for (const M of [1, 1.1, 1.5, 3]) assert.equal(dip[M], 0, `Master ${M}: ${dip[M]} rings dip into the street (worst ${worst[M].toFixed(3)} m)`);
  assert.deepEqual(lowRoof, [], 'every roof stands 0.5 m over the highest street of its lattice at 1.1, 1.5 and 3');
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
