// Collision service (src/modes/collision.js): footprint test, facade slide,
// walkable roofs, step-up, no trapping, Structure-slider roof heights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionService } from '../src/modes/collision.js';

// A fake building tile laid out exactly like baked-buildings.js / surface-geometry.js
// write it: base-pivoted axis-aligned box, [0]=side [5]=height [12..14]=x,y,z.
function tile(boxes, name = 'baked-buildings-0') {
  const arr = new Float32Array(boxes.length * 16);
  boxes.forEach(({ x, z, side, h, y = 0 }, i) => {
    const o = i * 16;
    arr[o] = side; arr[o + 5] = h; arr[o + 10] = side;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  });
  return { isInstancedMesh: true, name, count: boxes.length, instanceMatrix: { array: arr } };
}

const VE = 5;
// One 20m-square building centred at (0, 0), 10m tall authored => 50 scene units.
const BLOCK = { x: 0, z: 0, side: 20, h: 10 * VE };

function service(meshes, { scale = 1 } = {}) {
  let s = scale;
  const svc = createCollisionService({
    getBuildingMeshes: () => meshes,
    getHeightScale: () => s,
    getGroundY: () => 0,
    getWaterSurfaceY: (x) => (x > 1000 ? 12 : null),
    isSubmerged: (x, y) => x > 1000 && y < 12,
  });
  return { svc, setScale: (v) => { s = v; } };
}

test('walking straight into a facade stops at the facade (radius respected)', () => {
  const { svc } = service([tile([BLOCK])]);
  const r = svc.moveAndSlide({ x: -30, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { radius: 0.5, height: 9 });
  assert.ok(r.hit);
  assert.ok(Math.abs(r.x - (-10.5)) < 0.01, `x=${r.x}`);
  assert.equal(r.normalX, -1);
});

test('a diagonal move into a facade slides along it', () => {
  const { svc } = service([tile([BLOCK])]);
  const r = svc.moveAndSlide({ x: -12, y: 0, z: -5 }, { x: 10, y: 0, z: 8 }, { radius: 0.5, height: 9 });
  assert.ok(r.hit);
  assert.ok(r.x <= -10.5 + 1e-6, `penetrated to x=${r.x}`);
  assert.ok(Math.abs(r.z - 3) < 1e-6, `slid to z=${r.z}, expected the full 8m of tangential travel`);
});

test('fast motion does not tunnel through a thin building', () => {
  const thin = { x: 0, z: 0, side: 1, h: 50 };
  const { svc } = service([tile([thin])]);
  const r = svc.moveAndSlide({ x: -5, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { radius: 0.3, height: 9 });
  assert.ok(r.x < -0.5, `tunnelled to ${r.x}`);
});

test('a body at roof level walks across the roof; roofs are walkable', () => {
  const { svc } = service([tile([BLOCK])]);
  const r = svc.moveAndSlide({ x: -30, y: 50, z: 0 }, { x: 40, y: 0, z: 0 }, { radius: 0.5, height: 9 });
  assert.equal(r.hit, false);
  assert.equal(r.x, 10);
  assert.equal(svc.roofHeightAt(0, 0), 50);
  assert.equal(svc.standHeightAt(0, 0, 50), 50, 'standing on the roof');
  assert.equal(svc.standHeightAt(0, 0, 10), 0, 'below the roof you stand on the ground');
  assert.equal(svc.roofHeightAt(50, 50), null);
});

test('a kerb-high box within the step height is stepped onto, not blocked', () => {
  const kerb = { x: 0, z: 0, side: 20, h: 1.5 };
  const { svc } = service([tile([kerb])]);
  const r = svc.moveAndSlide({ x: -30, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { radius: 0.5, height: 9, step: 2 });
  assert.equal(r.hit, false);
});

test('a body already inside a footprint (Deity left it there) is never trapped', () => {
  const { svc } = service([tile([BLOCK])]);
  const r = svc.moveAndSlide({ x: 0, y: 0, z: 0 }, { x: 25, y: 0, z: 0 }, { radius: 0.5, height: 9 });
  assert.equal(r.x, 25);
});

test('roof heights follow the Structure slider (D-023 height scale)', () => {
  const { svc, setScale } = service([tile([BLOCK])]);
  setScale(0.4);
  assert.ok(Math.abs(svc.roofHeightAt(0, 0) - 20) < 1e-6);
  // A body at 25 is now above the scaled roof and passes over.
  const r = svc.moveAndSlide({ x: -30, y: 25, z: 0 }, { x: 60, y: 0, z: 0 }, { radius: 0.5, height: 9 });
  assert.equal(r.hit, false);
});

test('many tiles: only tiles near the query are indexed (lazy)', () => {
  const meshes = [];
  for (let t = 0; t < 50; t++) {
    const boxes = [];
    for (let i = 0; i < 400; i++) boxes.push({ x: t * 2000 + (i % 20) * 30, z: Math.floor(i / 20) * 30, side: 12, h: 50 });
    meshes.push(tile(boxes, `baked-buildings-${t}`));
  }
  const { svc } = service(meshes);
  svc.sync();
  assert.equal(svc.roofHeightAt(0, 0), 50);
  const near = svc.buildingsNear(31, 31, 10);
  assert.equal(near.length, 1);
  assert.deepEqual(svc.stats().indexedMeshes, 1);
  assert.equal(svc.stats().meshes, 50);
});

test('sync drops removed tiles and picks up new ones by identity', () => {
  const meshes = [tile([BLOCK])];
  const { svc } = service(meshes);
  svc.sync();
  assert.equal(svc.roofHeightAt(0, 0), 50);
  meshes.length = 0;
  meshes.push(tile([{ x: 100, z: 0, side: 10, h: 25 }], 'buildings-other'));
  svc.sync();
  assert.equal(svc.roofHeightAt(0, 0), null);
  assert.equal(svc.roofHeightAt(100, 0), 25);
});

test('water and ground queries delegate to the shared predicates', () => {
  const { svc } = service([]);
  assert.deepEqual(svc.waterAt(2000, 0), { surfaceY: 12, bedY: 0 });
  assert.equal(svc.waterAt(0, 0), null);
  assert.equal(svc.isInWater(2000, 5, 0), true);
  assert.equal(svc.isInWater(2000, 15, 0), false);
  assert.equal(svc.groundHeightAt(3, 4), 0);
});
