// Tube interior (sprint 25Sep26f, D-039, Lane P): the lining a Pedestrian
// walker sees underground. Pure geometry and controller logic; the in-app
// behaviour (near clip, ribbons, pixels) is pinned in tests/tube-interior.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTunnelNetwork, pointAt } from '../src/modes/pedestrian-tunnels.js';
import { boreRadiusM } from '../src/true-proportion.js';
import { INTERIOR, INTERIOR_LAYER, sampleBoreWindow, buildInteriorGeometry, createTubeInterior } from '../src/tube-interior.js';

const VE = 5;
const v = (x, depthM, z) => ({ x, y: -depthM * VE, z });
// A curving, descending twin-bore line with a spur joining it at J.
const A = v(0, 20, 0), B = v(500, 25, 0), J = v(1000, 30, 0), Cq = v(1400, 28, -250), Cr = v(1700, 24, -700);
function network() {
  const trunk = [A, B, J, Cq, Cr];
  const spur = [v(1300, 30, 500), v(1150, 30, 200), J];
  const st = (id, name, p, depthM) => ({ id, name, pos: new THREE.Vector3(p.x, p.y, p.z), surfaceY: 0, depthM });
  return buildTunnelNetwork({ THREE, VE, halfSpacing: 6,
    branchesByLine: new Map([['victoria', [trunk, spur]]]),
    stationLayers: new Map([['victoria', { stationsLayer: { stations: [st('b', 'Bravo', B, 25)] } }]]) });
}

test('the window follows the walker\'s own bore, contiguous, both ways, across a junction', () => {
  const net = network();
  const trunk = net.paths[0];
  const pos = { path: 0, s: 900, dir: 1, side: 1 };
  const w = sampleBoreWindow(net, pos);
  const at0 = w.points.find(p => p.s === 0);
  const here = pointAt(trunk, 900, {}, 1);
  assert.deepEqual([at0.x, at0.y, at0.z], [here.x, here.y, here.z]);
  // Arc is monotonic, spaced about one step, and reaches the window both ways.
  // (Steps are taken along the line's centreline arc; the bore 6 m off it runs
  // slightly longer on the outside of a curve, hence the 5% allowance.)
  for (let i = 1; i < w.points.length; i++) {
    const a = w.points[i - 1], b = w.points[i];
    assert.ok(b.s > a.s, `arc increases at ${i}`);
    const d = Math.hypot(b.x - a.x, (b.y - a.y) / VE, b.z - a.z);
    assert.ok(d <= INTERIOR.stepM * 1.05, `spacing ${d}`);
  }
  assert.ok(w.points.at(-1).s >= INTERIOR.aheadM - 1e-6);
  assert.ok(w.points[0].s <= -INTERIOR.behindM + 1e-6);
  assert.equal(w.endAhead, false);
  // Every point is on the SAME bore polyline the walker is locked to (not the
  // shared centreline, 6 m away in solid ground).
  const bore = trunk.left;
  for (const p of w.points) {
    let best = Infinity;
    for (let k = 0; k < trunk.n - 1; k++) {
      const ax = bore.x[k], ay = bore.y[k] / VE, az = bore.z[k];
      const vx = bore.x[k + 1] - ax, vy = bore.y[k + 1] / VE - ay, vz = bore.z[k + 1] - az;
      const L = vx * vx + vy * vy + vz * vz || 1;
      const u = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y / VE - ay) * vy + (p.z - az) * vz) / L));
      best = Math.min(best, Math.hypot(p.x - ax - vx * u, p.y / VE - ay - vy * u, p.z - az - vz * u));
    }
    assert.ok(best < 1e-6, `off the bore by ${best}`);
  }
});

test('the window stops at a line end and says so', () => {
  const net = network();
  const w = sampleBoreWindow(net, { path: 0, s: 60, dir: 1, side: -1 });
  assert.equal(w.endBehind, true);
  assert.ok(w.points[0].s > -61 && w.points[0].s < -59, `behind reaches the line end: ${w.points[0].s}`);
});

function rayTriangles(geometry, origin, dir) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  const rc = new THREE.Raycaster(origin, dir, 0, 1e4);
  return rc.intersectObject(mesh, false)[0] ?? null;
}

test('the lining is round at the true bore radius, faces inward, and encloses the axis', () => {
  const net = network();
  const w = sampleBoreWindow(net, { path: 0, s: 1200, dir: 1, side: 1 });
  const radius = boreRadiusM('victoria') - INTERIOR.insetM;
  const g = buildInteriorGeometry(w.points, { radius, VE });
  const p = g.attributes.position, ax = g.attributes.trueAxisY, uv = g.attributes.interiorUV;
  const ring = INTERIOR.radialSegments + 1;
  // Real-metre section: every wall vertex is `radius` from its axis point, in
  // real metres (horizontal metres, y offsets real about the axis).
  for (let i = 0; i < w.points.length; i++) {
    const P = w.points[i];
    for (let j = 0; j < ring; j++) {
      const k = i * ring + j;
      assert.equal(ax.getX(k), Math.fround(P.y));
      const r = Math.hypot(p.getX(k) - P.x, p.getY(k) - P.y, p.getZ(k) - P.z);
      assert.ok(Math.abs(r - radius) < 1e-3, `ring ${i} vertex ${j} at ${r}`);
    }
  }
  // Every wall triangle faces the axis (inward), so FrontSide draws it from inside.
  const idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  let wall = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
    if (uv.getY(i0) < 0) continue; // caps are checked below
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    const ringIdx = Math.floor(i0 / ring), P = w.points[ringIdx];
    const toAxis = new THREE.Vector3(P.x, P.y, P.z).sub(a);
    assert.ok(n.dot(toAxis) > 0, `triangle ${t / 3} faces outward`);
    wall++;
  }
  assert.equal(wall, (w.points.length - 1) * INTERIOR.radialSegments * 2);
  // From the walker's eye on the axis, rays in every direction round the axis
  // (and tilted ahead / behind) hit the lining at about the bore radius.
  const i0 = w.points.findIndex(q => q.s === 0), P = w.points[i0], Q = w.points[i0 + 1];
  const tdir = new THREE.Vector3(Q.x - P.x, (Q.y - P.y) / VE, Q.z - P.z).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tdir).normalize();
  const up = new THREE.Vector3().crossVectors(tdir, side);
  const eye = new THREE.Vector3(P.x, P.y, P.z);
  for (let k = 0; k < 36; k++) {
    const th = (2 * Math.PI * k) / 36;
    const d = side.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th));
    for (const tilt of [0, 1, -1]) {
      const dir = d.clone().addScaledVector(tdir, tilt).normalize();
      const hit = rayTriangles(g, eye, dir);
      assert.ok(hit, `ray at ${k * 10} degrees tilt ${tilt} escapes`);
      // 45 degrees off the wall is radius x sqrt 2 on a straight bore; the
      // 32-sided section is within 0.5% of round.
      const expected = tilt ? radius * Math.SQRT2 : radius;
      assert.ok(Math.abs(hit.distance - expected) < 0.08, `ray ${k} tilt ${tilt}: ${hit.distance} vs ${expected}`);
    }
  }
  // Straight along the axis the window is closed too (by the curving wall here).
  for (const sgn of [1, -1]) {
    assert.ok(rayTriangles(g, eye, tdir.clone().multiplyScalar(sgn)), `axis ray ${sgn} escapes the window`);
  }
});

test('on a straight bore the dark end caps close both ends of the window', () => {
  const pts = Array.from({ length: 41 }, (_, i) => ({ x: 0, y: -100, z: (i - 20) * 2.5, s: (i - 20) * 2.5 }));
  const g = buildInteriorGeometry(pts, { radius: 1.75, VE });
  const uv = g.attributes.interiorUV;
  for (const sgn of [1, -1]) {
    const hit = rayTriangles(g, new THREE.Vector3(0, -100, 0), new THREE.Vector3(0.001, 0.002, sgn).normalize());
    assert.ok(hit, `axis ray ${sgn} escapes`);
    assert.ok(uv.getY(hit.face.a) < 0 && uv.getY(hit.face.b) < 0, 'lands on an end cap');
    assert.ok(Math.abs(hit.distance - 50) < 0.01, `cap at the window end: ${hit.distance}`);
  }
});

test('interior uv: arc in metres along, 0 at the invert and 0.5 at the crown', () => {
  const pts = [{ x: 0, y: -100, z: 0, s: -5 }, { x: 0, y: -100, z: 5, s: 0 }, { x: 0, y: -100, z: 10, s: 5 }];
  const g = buildInteriorGeometry(pts, { radius: 2, VE, radialSegments: 8, caps: false });
  const p = g.attributes.position, uv = g.attributes.interiorUV;
  assert.equal(uv.getX(9), 0);
  assert.equal(uv.getY(9), 0);
  assert.ok(Math.abs(p.getY(9) - -102) < 1e-5, 'j = 0 is the floor');
  assert.equal(uv.getY(13), 0.5);
  assert.ok(Math.abs(p.getY(13) - -98) < 1e-5, 'j = R/2 is the crown');
});

test('controller: shows around the walker, hides every map device, restores exactly on hide', () => {
  const net = network();
  const scene = new THREE.Scene();
  const ribbonA = new THREE.Object3D(), ribbonB = new THREE.Object3D();
  ribbonB.visible = false; // already hidden by something else: must stay hidden
  const interior = createTubeInterior({ scene, lineColour: () => 0x0098d4, mapDevices: () => [ribbonA, ribbonB] });
  assert.equal(interior.mesh.parent, scene);
  assert.equal(interior.visible, false);
  assert.equal(interior.show(net, { path: 0, s: 900, dir: 1, side: 1 }), true);
  assert.equal(interior.visible, true);
  assert.equal(ribbonA.visible, false);
  const d = interior.debug();
  assert.equal(d.lineId, 'victoria');
  assert.equal(interior.lineId, 'victoria');
  assert.equal(d.builds, 1);
  assert.ok(Math.abs(d.radius - (boreRadiusM('victoria') - INTERIOR.insetM)) < 1e-9);
  // Small moves reuse the window; leaving it, or changing bore, rebuilds.
  interior.show(net, { path: 0, s: 950, dir: 1, side: 1 });
  assert.equal(interior.debug().builds, 1);
  interior.show(net, { path: 0, s: 900 + INTERIOR.rebuildM + 1, dir: 1, side: 1 });
  assert.equal(interior.debug().builds, 2);
  interior.show(net, { path: 0, s: 900 + INTERIOR.rebuildM + 1, dir: 1, side: -1 });
  assert.equal(interior.debug().builds, 3);
  interior.hide();
  assert.equal(interior.visible, false);
  assert.equal(interior.lineId, null);
  assert.equal(ribbonA.visible, true);
  assert.equal(ribbonB.visible, false);
  assert.equal(interior.debug().hiddenDevices, 0);
  // A bad position hides rather than throwing.
  assert.equal(interior.show(net, { path: 99, s: 0 }), false);
  assert.equal(interior.visible, false);
});

test('inside, the camera draws the lining alone (no foreign bore can cross it); its layers come back exactly', () => {
  // Fix round 1: at interchanges other lines' frosted exterior tubes cross the
  // walker's bore. The camera sees only the lining's layer while inside.
  const net = network();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.layers.enable(3); // some prior layer state: must be restored bit for bit
  const mask0 = camera.layers.mask;
  const foreign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(foreign);
  const interior = createTubeInterior({ scene, camera: () => camera });
  assert.ok(interior.mesh.layers.test(new THREE.Layers()), 'the lining stays on layer 0 too');
  interior.show(net, { path: 0, s: 900, dir: 1, side: 1 });
  assert.equal(camera.layers.mask, 1 << INTERIOR_LAYER);
  assert.ok(interior.mesh.layers.test(camera.layers), 'the camera sees the lining');
  assert.ok(!foreign.layers.test(camera.layers), 'the camera does not see anything else');
  assert.equal(interior.debug().isolated, true);
  // Repeated shows keep the ORIGINAL mask to restore, not the isolated one.
  interior.show(net, { path: 0, s: 910, dir: 1, side: 1 });
  // In the cross passage (camera maybe outside the lining) the view is whole again.
  interior.show(net, { path: 0, s: 910, dir: 1, side: 1 }, { isolate: false });
  assert.equal(camera.layers.mask, mask0);
  interior.show(net, { path: 0, s: 910, dir: 1, side: 1 });
  assert.equal(camera.layers.mask, 1 << INTERIOR_LAYER);
  interior.hide();
  assert.equal(camera.layers.mask, mask0);
  assert.equal(interior.debug().isolated, false);
  interior.hide(); // idempotent
  assert.equal(camera.layers.mask, mask0);
  // A bad position hides, and restores the view with it.
  interior.show(net, { path: 0, s: 900, dir: 1, side: 1 });
  interior.show(net, { path: 99, s: 0 });
  assert.equal(camera.layers.mask, mask0);
});

test('the window is deterministic: the same position gives identical geometry', () => {
  const net = network();
  const pos = { path: 0, s: 777.7, dir: -1, side: -1 };
  const a = buildInteriorGeometry(sampleBoreWindow(net, pos).points, { radius: 1.8, VE });
  const b = buildInteriorGeometry(sampleBoreWindow(net, { ...pos }).points, { radius: 1.8, VE });
  assert.deepEqual(Array.from(a.attributes.position.array), Array.from(b.attributes.position.array));
});
