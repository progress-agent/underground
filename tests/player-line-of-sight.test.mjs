// player-line-of-sight.test.mjs: collision.lineOfSight (sprint 14Oct26w, lane P, D-053 item 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollisionService } from '../src/modes/collision.js';

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
// A 20 m square, 10 m tall block centred on the origin: x, z in [-10, 10], y in [0, 50].
const BLOCK = { x: 0, z: 0, side: 20, h: 10 * VE };

function service(meshes, ground = () => 0) {
  return createCollisionService({
    getBuildingMeshes: () => meshes, getHeightScale: () => 1, getGroundY: ground,
    getWaterSurfaceY: () => null, isSubmerged: () => false,
  });
}
const P = (x, y, z) => ({ x, y, z });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

test('a box hit fraction is exact to 1e-3', () => {
  const c = service([tile([BLOCK])]);
  // from (-30, 20, 0) to (30, 20, 0): enters the pad-expanded box at x = -10 - 0.25
  const r = c.lineOfSight(P(-30, 20, 0), P(30, 20, 0), { pad: 0.25 });
  assert.equal(r.clear, false);
  assert.equal(r.what, 'box');
  near(r.t, (30 - 10.25) / 60, 1e-3);
  near(r.x, -10.25, 1e-3);
});

test('the pad moves the hit out by the pad', () => {
  const c = service([tile([BLOCK])]);
  const a = c.lineOfSight(P(-30, 20, 0), P(30, 20, 0), { pad: 0 });
  const b = c.lineOfSight(P(-30, 20, 0), P(30, 20, 0), { pad: 1 });
  near(a.x, -10, 1e-3);
  near(b.x, -11, 1e-3);
  assert.ok(b.t < a.t);
});

test('a segment that passes beside the box, or over its roof, is clear', () => {
  const c = service([tile([BLOCK])]);
  assert.equal(c.lineOfSight(P(-30, 20, 15), P(30, 20, 15), { pad: 0.25 }).clear, true);
  assert.equal(c.lineOfSight(P(-30, 80, 0), P(30, 80, 0), { pad: 0.25 }).clear, true);
  const clear = c.lineOfSight(P(-30, 80, 0), P(30, 80, 0));
  assert.equal(clear.t, 1);
  near(clear.x, 30, 1e-9);
});

test('a box that contains from is ignored', () => {
  const c = service([tile([BLOCK])]);
  const r = c.lineOfSight(P(0, 20, 0), P(30, 20, 0), { pad: 0.25 });
  assert.equal(r.clear, true);
});

test('a ground crossing is found by linear interpolation', () => {
  const c = service([], (x) => 0);
  // from 30 up at x = 0 down to 10 below at x = 40: crosses padY above the ground (padY = 1.25 by default)
  const r = c.lineOfSight(P(0, 30, 0), P(40, -10, 0), { pad: 0.25 });
  assert.equal(r.clear, false);
  assert.equal(r.what, 'ground');
  const u = (30 - 1.25) / 40;       // y(u) = 30 - 40 u = padY
  near(r.t, u, 0.05);
  const flat = c.lineOfSight(P(0, 30, 0), P(40, 20, 0), { pad: 0.25 });
  assert.equal(flat.clear, true);
});

test('a sloping ground is followed', () => {
  const c = service([], (x) => x * 0.5);         // rises to the east
  const r = c.lineOfSight(P(0, 10, 0), P(40, 10, 0), { pad: 0.25, padY: 0 });
  assert.equal(r.what, 'ground');
  near(r.x, 20, 1.2);
});

test('the extra hook: a number is a hit fraction, true is refined by bisection, false is no hit', () => {
  const c = service([]);
  const a = P(0, 20, 0), b = P(10, 20, 0);
  assert.equal(c.lineOfSight(a, b).clear, true);
  c.setExtraSegmentHit(() => 0.5);
  const r = c.lineOfSight(a, b);
  assert.equal(r.clear, false);
  assert.equal(r.what, 'extra');
  assert.ok(r.t <= 0.5 + 1e-6);
  c.setExtraSegmentHit((f, to) => to.x > 6);     // a solid from x = 6 on: true for any segment reaching past it
  const r2 = c.lineOfSight(a, b);
  assert.equal(r2.clear, false);
  near(r2.x, 6, 0.02);
  c.setExtraSegmentHit(() => false);
  assert.equal(c.lineOfSight(a, b).clear, true);
  c.setExtraSegmentHit(() => null);
  assert.equal(c.lineOfSight(a, b).clear, true);
  c.setExtraSegmentHit('nonsense');
  assert.equal(c.lineOfSight(a, b).clear, true);
});

test('the nearest of several hits wins', () => {
  const c = service([tile([BLOCK])]);
  c.setExtraSegmentHit(() => 0.9);
  const r = c.lineOfSight(P(-30, 20, 0), P(30, 20, 0), { pad: 0.25 });
  assert.equal(r.what, 'box');
  c.setExtraSegmentHit(() => 0.1);
  const r2 = c.lineOfSight(P(-30, 20, 0), P(30, 20, 0), { pad: 0.25 });
  assert.equal(r2.what, 'extra');
  near(r2.t, 0.1, 1e-9);
});

test('a camera orbited behind a facade stops short of it (the rig pulls in)', async () => {
  const THREE = await import('three');
  const { createCameraRig } = await import('../src/player/camera-rig.js');
  const c = service([tile([BLOCK])]);
  // the walker stands 3 m east of the block's east face, facing east (yaw -PI/2); the camera orbits to the west side
  const rig = createCameraRig({ THREE, ratio: 0.2, lineOfSight: (a, b, o) => c.lineOfSight(a, b, o), groundY: () => 0 });
  rig.reset({ yaw: Math.PI / 2 });      // looking west: the camera sits east of the walker, in the open
  rig.follow({ x: 13, y: 0, z: 0 }, 0, { snap: true });
  assert.equal(rig.pulled, false);
  rig.reset({ yaw: -Math.PI / 2 });     // looking east: the camera sits west of the walker, behind the block
  rig.follow({ x: 13, y: 0, z: 0 }, 0, { snap: true });
  assert.equal(rig.pulled, true);
  const cam = rig.pose(new THREE.Vector3()).position;
  assert.ok(cam.x > 10, `camera x ${cam.x} stays on the near side of the face at x = 10`);
  assert.ok(rig.distance < 4.2);
});
