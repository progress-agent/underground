// near-clearance.js (sprint 16Oct26f, lane T, T-near, D-054): the near plane that keeps a camera clear of the wall it
// stands against. Pure maths and a probe over a stand-in collision service; the browser criterion (no frame shows the
// inside of a wall at five contacts) is tests/near-clearance.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cornerFactor, nearForWall, wallDistance, hostDistance, createClearanceProbe, PROBE_REACH_M, NEAR_FLOOR, NEAR_CEIL, PROBE_AZIMUTHS,
} from '../src/player/near-clearance.js';

/** A moveAndSlide over axis-aligned boxes [minX, maxX, minZ, maxZ], as collision.js does it (expanded by radius, separate axes). */
function boxCollision(boxes) {
  let calls = 0;
  const moveAndSlide = (pos, delta, { radius }) => {
    calls++;
    let x = pos.x, z = pos.z, hit = false, normalX = 0, normalZ = 0;
    const steps = 6, sx = delta.x / steps, sz = delta.z / steps;
    for (let i = 0; i < steps; i++) {
      for (const axis of ['x', 'z']) {
        const d = axis === 'x' ? sx : sz;
        if (!d) continue;
        let nx = axis === 'x' ? x + d : x, nz = axis === 'z' ? z + d : z;
        for (const [x0, x1, z0, z1] of boxes) {
          if (nx > x0 - radius && nx < x1 + radius && nz > z0 - radius && nz < z1 + radius) {
            if (axis === 'x') { nx = d > 0 ? x0 - radius - 1e-4 : x1 + radius + 1e-4; normalX = d > 0 ? -1 : 1; normalZ = 0; }
            else { nz = d > 0 ? z0 - radius - 1e-4 : z1 + radius + 1e-4; normalX = 0; normalZ = d > 0 ? -1 : 1; }
            hit = true;
          }
        }
        x = nx; z = nz;
      }
    }
    return { x, z, y: pos.y, hit, normalX, normalZ };
  };
  return { moveAndSlide, get calls() { return calls; } };
}

test('the corner factor is how far the near plane\'s corners reach per unit of near', () => {
  assert.ok(Math.abs(cornerFactor(41.1, 1.6) - 1.225) < 0.005, 'default lens in a 1440 x 900 window');
  assert.ok(Math.abs(cornerFactor(55, 16 / 9) - 1.46) < 0.01, 'the third-person lens at 16:9');
  assert.ok(Math.abs(cornerFactor(0.001, 1) - 1) < 1e-6, 'a pinhole reaches only straight ahead');
});

test('pressed against a facade (eye 0.351 m away) the near is 0.221 and the corners reach 0.27 m, 8 cm clear of it', () => {
  const cf = cornerFactor(41.1, 1.6), near = nearForWall(0.351, cf);
  assert.ok(Math.abs(near - 0.221) < 0.003, `near ${near}`);
  assert.ok(near * cf < 0.351 - 0.05, 'corner reach is inside the wall distance, with what is drawn proud of the footprint to spare');
  assert.ok(1.0 * cf > 0.351, 'and the old near of 1.0 reached past it');
});

test('the near is clamped between the bores\' 0.1 and the on-foot 1.0', () => {
  const cf = 1.2;
  assert.equal(nearForWall(0.05, cf), NEAR_FLOOR);
  assert.equal(nearForWall(5, cf), NEAR_CEIL);
  assert.equal(nearForWall(null, cf), NEAR_CEIL);
  assert.equal(nearForWall(NaN, cf), NEAR_CEIL);
  for (let w = 0.1; w < 2; w += 0.1) assert.ok(nearForWall(w, cf) * cf <= Math.max(w - 0.05, NEAR_FLOOR * cf) + 1e-9, `wall ${w}`);
});

test('a wall within reach is found from any direction, and nothing in the open', () => {
  const R = 0.33, wallZ = -10;                      // a facade whose face is at z = -10, boxes run north (-z) of it
  const col = boxCollision([[-50, 50, -60, wallZ]]);
  // eye 0.351 m from the face, looking at it
  const d = wallDistance(col, 3, wallZ + 0.351, 0, 9, R);
  assert.ok(d !== null && Math.abs(d - 0.351) < 0.01, `pressed: ${d}`);
  // 1.2 m away
  const d2 = wallDistance(col, 3, wallZ + 1.2, 0, 9, R);
  assert.ok(d2 !== null && Math.abs(d2 - 1.2) < 0.02, `1.2 m: ${d2}`);
  // 2 m away: beyond the probe's reach
  assert.equal(wallDistance(col, 3, wallZ + 2.0, 0, 9, R), null);
  assert.ok(PROBE_REACH_M < 2);
  // open ground
  assert.equal(wallDistance(boxCollision([]), 0, 0, 0, 9, R), null);
  assert.equal(wallDistance(null, 0, 0, 0, 9, R), null);
});

test('in a corner the nearer wall decides, whichever way the probes slide', () => {
  const R = 0.33;
  const col = boxCollision([[-50, 50, -60, -10], [10, 60, -60, 60]]);   // a facade ahead (z = -10) and one to the east (x = 10)
  const d = wallDistance(col, 9.6, -9.6, 0, 9, R);                       // 0.4 m from the east wall and from the north
  assert.ok(d !== null && Math.abs(d - 0.4) < 0.02, `corner ${d}`);
});

test('the probe is cached: a walker who stands still, or moves under 2 cm, costs nothing', () => {
  const col = boxCollision([[-50, 50, -60, -10]]);
  const probe = createClearanceProbe({ collision: col, VE: 5 });
  const band = { feetY: 0, height: 9, radius: 0.33 };
  const a = probe.measure(0, 0, -9.0, band);
  const calls = col.calls;
  assert.equal(calls, PROBE_AZIMUTHS);
  for (let i = 0; i < 20; i++) assert.equal(probe.measure(0.001 * i, 0, -9.0, band), a);
  assert.equal(col.calls, calls, 'no further probes for sub-2 cm movement');
  probe.measure(0, 0, -9.1, band);
  assert.equal(col.calls, 2 * PROBE_AZIMUTHS, 'a 10 cm step probes again');
  for (let i = 0; i < 31; i++) probe.measure(0, 0, -9.1, band);
  assert.equal(col.calls, 3 * PROBE_AZIMUTHS, 'and a standing walker is refreshed every 30 frames');
  probe.measure(0, 0, -9.1, { ...band, radius: 0.05 });
  assert.equal(col.calls, 4 * PROBE_AZIMUTHS, 'a different probe radius is a new question');
});

test('a raised host box (the walker passes under it) is found by its square, not by the collision band', () => {
  const hosts = [{ x: 100, z: 200, side: 90 }];
  assert.ok(Math.abs(hostDistance(hosts, 100, 200 - 45 - 0.4) - 0.4) < 1e-9, 'north of the north face');
  assert.ok(Math.abs(hostDistance(hosts, 100 + 45 + 0.3, 200 + 45 + 0.4) - 0.5) < 1e-9, 'diagonally off a corner');
  assert.equal(hostDistance(hosts, 100, 200 - 45 - 2), null, 'out of reach');
  assert.equal(hostDistance(hosts, 100, 200), 0, 'inside its square');
  assert.equal(hostDistance([], 0, 0), null);
  assert.equal(hostDistance(null, 0, 0), null);
  const col = boxCollision([]);                       // the collision knows nothing of it
  const probe = createClearanceProbe({ collision: col, VE: 5 });
  const m1 = probe.measure(100, 0, 200 - 45 - 0.4, { feetY: 0, height: 9, radius: 0.33, hosts });
  assert.ok(Math.abs(m1 - 0.4) < 1e-9);
  assert.equal(probe.measure(100, 0, 200 - 45 - 0.4, { feetY: 0, height: 9, radius: 0.33 }), m1, 'cached');
});
