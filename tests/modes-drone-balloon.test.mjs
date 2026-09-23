// Drone and Balloon flight models (sprint 23Sep26w, D-037, lane A3), pinned
// without a browser: FOV / bank / pitch derivation, idle hover, momentum and
// overshoot, collision response, balloon drift on the shared wind layers,
// thermal lag, time warp, and determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRONE_DEFAULTS, createDroneState, stepDrone, droneAttitude, droneHorizontalFov, droneLook,
  droneCameraAttitude, G,
} from '../src/modes/drone-physics.js';
import {
  attitudeBasis, attitudeQuaternion, yawPitchFromQuaternion, verticalFovFromHorizontal,
} from '../src/modes/drone-camera.js';
import {
  BALLOON_DEFAULTS, EQUILIBRIUM_DT, BASKET_EYE_M, createBalloonState, stepBalloon, windVector,
} from '../src/modes/balloon-physics.js';
import { createCollisionService } from '../src/modes/collision.js';
import { getWindAt } from '../src/wind.js';
import { createDroneMode } from '../src/modes/drone.js';
import { createBalloonMode } from '../src/modes/balloon.js';

const VE = 5;
const DEG = Math.PI / 180;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);

function run(state, input, seconds, params, world, fps = 60, step = stepDrone) {
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(seconds * fps); i++) step(state, input, dt, params, world);
  return state;
}

// A fake building tile laid out as baked-buildings.js writes it.
function tile(boxes) {
  const arr = new Float32Array(boxes.length * 16);
  boxes.forEach(({ x, z, side, h, y = 0 }, i) => {
    const o = i * 16;
    arr[o] = side; arr[o + 5] = h; arr[o + 10] = side;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  });
  return { isInstancedMesh: true, name: 'baked-buildings-0', count: boxes.length, instanceMatrix: { array: arr } };
}
function cityWorld(boxes, { ground = 0, water = null } = {}) {
  const collision = createCollisionService({
    getBuildingMeshes: () => [tile(boxes)],
    getHeightScale: () => 1,
    getGroundY: () => ground,
    getWaterSurfaceY: (x, z) => (water ? water(x, z) : null),
  });
  return {
    VE, collision,
    groundY: () => ground,
    waterSurfaceY: (x, z) => (water ? water(x, z) : null),
    wind: getWindAt,
  };
}

// ── Camera maths ────────────────────────────────────────────────────────────

test('FOV: the 110° horizontal tunable converts to THREE vertical fov per aspect', () => {
  const v = verticalFovFromHorizontal(110, 16 / 9);
  close(v, 2 * Math.atan(Math.tan(55 * DEG) / (16 / 9)) / DEG, 1e-9);
  close(v, 77.55, 0.01, 'vertical fov at 16:9');
  // Square aspect: vertical equals horizontal.
  close(verticalFovFromHorizontal(110, 1), 110, 1e-9);
  // Wider window, narrower vertical: the horizontal stays pinned at 110.
  assert.ok(verticalFovFromHorizontal(110, 2.4) < v);
  // Speed kick: 110 at rest, +fovKick at boosted top speed.
  const P = DRONE_DEFAULTS;
  assert.equal(droneHorizontalFov(0, P), 110);
  close(droneHorizontalFov(P.speed * P.sprint, P), 110 + P.fovKick, 1e-9);
  close(droneHorizontalFov(10 * P.speed * P.sprint, P), 110 + P.fovKick, 1e-9, 'kick is capped');
});

test('attitude quaternion round-trips yaw and pitch through the VE5 canonical camera', () => {
  for (const [yaw, pitch] of [[0, 0], [1.2, -0.4], [-2.5, 0.7], [3.0, -1.2]]) {
    const q = attitudeQuaternion(yaw, pitch, 0, VE);
    close(Math.hypot(...q), 1, 1e-9, 'unit quaternion');
    const r = yawPitchFromQuaternion(q, VE);
    close(r.yaw, yaw, 1e-9, 'yaw'); close(r.pitch, pitch, 1e-9, 'pitch');
  }
  // Positive roll banks LEFT: the up vector leans away from the right.
  const { up } = attitudeBasis(0, 0, 20 * DEG);
  assert.ok(up[0] < 0, `up.x=${up[0]}`);
});

// ── Drone ───────────────────────────────────────────────────────────────────

test('bank is the coordinated-turn angle atan(v·ω/g), signed with the turn, clamped', () => {
  const P = { ...DRONE_DEFAULTS, bank: 1 };
  const a = droneAttitude({ speedFwd: 30, yawRate: 0.2 }, P);
  close(a.bank, Math.atan2(6, G), 1e-12, 'left turn');
  assert.ok(a.bank > 0);
  const b = droneAttitude({ speedFwd: 30, yawRate: -0.2 }, P);
  close(b.bank, -a.bank, 1e-12, 'right turn mirrors');
  assert.equal(droneAttitude({ speedFwd: 30, yawRate: 0 }, P).bank, 0, 'no turn, no bank');
  assert.equal(droneAttitude({ speedFwd: 0, yawRate: 2 }, P).bank, 0, 'pirouette in a hover stays level');
  close(droneAttitude({ speedFwd: 200, yawRate: 3 }, P).bank, P.maxBank * DEG, 1e-12, 'clamped');
  // Gain scales it; strafing right leans right.
  close(droneAttitude({ speedFwd: 30, yawRate: 0.2 }, { ...P, bank: 0.5 }).bank, a.bank * 0.5, 1e-12);
  assert.ok(droneAttitude({ lateralAccel: -10 }, P).bank < 0);
});

test('the view pitches forward with forward speed (drag tilt), back when reversing', () => {
  const P = DRONE_DEFAULTS;
  assert.equal(droneAttitude({ speedFwd: 0 }, P).dip, 0);
  const slow = droneAttitude({ speedFwd: 10 }, P).dip;
  const fast = droneAttitude({ speedFwd: 40 }, P).dip;
  assert.ok(slow > 0 && fast > slow, `${slow} < ${fast}`);
  close(fast, Math.atan2((P.accel / P.speed) * 40, G) * P.tilt, 1e-12);
  assert.ok(droneAttitude({ speedFwd: -10 }, P).dip < 0);
});

test('W thrust reaches the top speed along the view; Shift boosts; drone flies level with no gravity', () => {
  const P = DRONE_DEFAULTS;
  const s = createDroneState({ y: 1000 * VE, yaw: 0, pitch: 0 });
  run(s, { thrust: 1 }, 12, P, { VE });
  close(s.speed, P.speed, 0.5, 'top speed');
  assert.ok(s.vel.z < 0 && Math.abs(s.vel.x) < 1e-6, 'yaw 0 flies north (-Z)');
  close(s.pos.y, 1000 * VE, 1e-6, 'no gravity: height held');
  assert.ok(droneCameraAttitude(s).pitch < -5 * DEG, 'nose down at speed');
  run(s, { thrust: 1, boost: true }, 15, P, { VE });
  close(s.speed, P.speed * P.sprint, 1, 'boosted top speed');
});

test('idle hover: released, the drone coasts (momentum) then holds a dead-still hover', () => {
  const P = DRONE_DEFAULTS;
  const s = createDroneState({ y: 500 * VE });
  run(s, { thrust: 1 }, 6, P, { VE });
  const v0 = s.speed;
  const z0 = s.pos.z;
  run(s, {}, 0.5, P, { VE });
  assert.ok(s.speed > v0 * 0.4, `momentum: still ${s.speed} after 0.5 s`);
  run(s, {}, 8, P, { VE });
  assert.equal(s.speed, 0, 'dead still');
  assert.ok(s.pos.z < z0 - 10, 'coasted on after release');
  const hold = { ...s.pos };
  run(s, {}, 5, P, { VE });
  assert.deepEqual(s.pos, hold, 'hovers: no drift, no sink');
  close(s.pos.y, 500 * VE, 1e-9, 'never sank');
  assert.ok(Math.abs(s.bank) < 1e-3 && Math.abs(s.dip) < 1e-3, 'level in the hover');
});

test('mouse steering overshoots and settles (underdamped look spring), banking into the turn', () => {
  const P = DRONE_DEFAULTS;
  const s = createDroneState({ y: 500 * VE });
  run(s, { thrust: 1 }, 4, P, { VE });
  // A flick left of 30° (dx negative turns left).
  droneLook(s, -30 / P.sensitivity, 0, P);
  const target = s.targetYaw;
  close(target, 30 * DEG, 1e-9);
  let peak = 0, maxBank = 0;
  for (let i = 0; i < 180; i++) {
    stepDrone(s, { thrust: 1 }, 1 / 60, P, { VE });
    peak = Math.max(peak, s.yaw);
    maxBank = Math.max(maxBank, s.bank);
  }
  assert.ok(peak > target * 1.05, `overshoot: peak ${peak / DEG}° vs ${target / DEG}°`);
  close(s.yaw, target, 0.5 * DEG, 'settled');
  assert.ok(maxBank > 10 * DEG, `banked left into the turn: ${maxBank / DEG}°`);
  // Critically damped look spring: no overshoot.
  const d = createDroneState({ y: 0 });
  const Pc = { ...P, overshoot: 1 };
  droneLook(d, -30 / Pc.sensitivity, 0, Pc);
  let pk = 0;
  for (let i = 0; i < 180; i++) { stepDrone(d, {}, 1 / 60, Pc, { VE }); pk = Math.max(pk, d.yaw); }
  assert.ok(pk <= d.targetYaw + 1e-6);
});

test('collision: the drone bounces off a facade with restitution and a decaying wobble, never entering', () => {
  const P = DRONE_DEFAULTS;
  // A 40m block north of the drone, 60m tall; the drone flies at it at 5m altitude.
  const world = cityWorld([{ x: 0, z: -60, side: 40, h: 60 * VE }]);
  const s = createDroneState({ x: 0, y: 5 * VE, z: 0, yaw: 0 });
  s.vel.z = -40; // flying north at 40 m/s under full thrust
  let hitAt = -1, vAfter = null, firstImpact = 0;
  const facade = -40 + 1.5; // south face (z = -40) plus the drone radius
  for (let i = 0; i < 120; i++) {
    stepDrone(s, { thrust: 1 }, 1 / 60, P, world);
    assert.ok(s.pos.z >= facade - 1e-3, `entered the building: z=${s.pos.z}`);
    if (s.hits && hitAt < 0) { hitAt = i; vAfter = s.vel.z; firstImpact = s.lastImpact; }
  }
  assert.ok(hitAt >= 0, 'hit the facade');
  assert.ok(vAfter > 0, `bounced back south: vz=${vAfter}`);
  assert.ok(firstImpact > 35, `impact speed ${firstImpact}`);
  close(vAfter, firstImpact * DRONE_DEFAULTS.bounce, 3, 'restitution');
  const wob = Math.abs(s.wobPitch) + Math.abs(s.wobRoll);
  // The wobble was excited and decays away.
  run(s, {}, 4, P, world);
  assert.ok(Math.abs(s.wobPitch) + Math.abs(s.wobRoll) < Math.max(1e-3, wob), 'wobble decays');
});

test('collision: roofs and the ground are floors; the drone lands on a roof, not through it', () => {
  const P = DRONE_DEFAULTS;
  const roof = 30 * VE;
  const world = cityWorld([{ x: 0, z: 0, side: 40, h: roof }]);
  const s = createDroneState({ x: 0, y: roof + 20 * VE, z: 0 });
  s.vel.y = -30;
  run(s, { lift: -1 }, 3, P, world);
  assert.ok(s.pos.y >= roof, `below the roof: ${s.pos.y}`);
  close(s.pos.y, roof + 0.3 * VE, 0.5, 'resting on the roof');
  assert.ok(s.hits >= 1);
  // Off the building, the ground (0) is the floor.
  const t = createDroneState({ x: 200, y: 10 * VE, z: 0 });
  run(t, { lift: -1, boost: true }, 5, P, world);
  close(t.pos.y, 0.3 * VE, 1e-6, 'on the ground');
});

test('drone: identical inputs give identical flights (deterministic)', () => {
  const fly = () => {
    const world = cityWorld([{ x: 30, z: -80, side: 25, h: 40 * VE }]);
    const s = createDroneState({ y: 8 * VE });
    for (let i = 0; i < 400; i++) {
      if (i % 50 === 0) droneLook(s, (i % 100 ? 40 : -60), 3, DRONE_DEFAULTS);
      stepDrone(s, { thrust: i < 300 ? 1 : 0, strafe: i % 120 < 30 ? 1 : 0 }, 1 / 60 + (i % 7) * 1e-3, DRONE_DEFAULTS, world);
    }
    return JSON.stringify(s);
  };
  assert.equal(fly(), fly());
});

// ── Balloon ─────────────────────────────────────────────────────────────────

function balloonAt(altM, windTime = 0) {
  return createBalloonState({ y: (altM + BASKET_EYE_M) * VE, windTime });
}
const angleBetween = (a, b) => {
  const d = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return Math.abs(d);
};

test('balloon drift follows the wind layer at its altitude (and a different layer steers differently)', () => {
  const world = { VE, wind: getWindAt, groundY: () => 0 };
  const P = { ...BALLOON_DEFAULTS, cool: 1e9 }; // hold altitude for the measurement
  const drift = (alt) => {
    const s = balloonAt(alt, 600);
    // Neutral envelope: no cooling, no burner, so it stays in its layer.
    run(s, {}, 60, P, world, 30, stepBalloon);
    const w = windVector(getWindAt(s.altitude, s.windTime));
    return { s, w, alt: s.altitude };
  };
  const low = drift(200);   // surface layer (westerly)
  const high = drift(2800); // high layer
  for (const { s, w, alt } of [low, high]) {
    assert.ok(Math.abs(alt - (alt > 1000 ? 2800 : 200)) < 1, `held altitude ${alt}`);
    assert.ok(angleBetween(s.vel, w) < 2 * DEG, `drift heading matches the layer at ${alt}m`);
    close(Math.hypot(s.vel.x, s.vel.z), Math.hypot(w.x, w.z), 0.05 * Math.hypot(w.x, w.z), 'drift speed');
    const sp = Math.hypot(s.vel.x, s.vel.z);
    assert.ok(sp >= 4 && sp <= 17, `real drift 5 to 15 m/s: ${sp}`);
  }
  assert.ok(low.s.vel.x > 0, 'surface westerly drifts east');
  assert.ok(angleBetween(low.s.vel, high.s.vel) > 45 * DEG, 'altitude choice is steering');
});

test('balloon thermal lag: a burn lifts seconds later and keeps lifting after release; vent sinks', () => {
  const world = { VE, wind: getWindAt, groundY: () => 0 };
  const P = BALLOON_DEFAULTS;
  const s = balloonAt(300);
  run(s, { burner: true }, 1, P, world, 60, stepBalloon);
  assert.ok(s.vy < 0.15, `no instant lift: vy=${s.vy} after 1 s`);
  run(s, { burner: true }, 7, P, world, 60, stepBalloon);
  assert.ok(s.vy > 0.8, `lifting after 8 s of burn: vy=${s.vy}`);
  const vRelease = s.vy;
  run(s, {}, 3, P, world, 60, stepBalloon);
  assert.ok(s.vy > vRelease, `still accelerating 3 s after release: ${s.vy} > ${vRelease}`);
  assert.ok(s.dT > EQUILIBRIUM_DT);
  run(s, { vent: true }, 25, P, world, 60, stepBalloon);
  assert.ok(s.vy < 0, `venting sinks: vy=${s.vy}`);
});

test('time warp runs the same physics and the wind clock ten times faster', () => {
  const world = { VE, wind: getWindAt, groundY: () => 0 };
  const P = { ...BALLOON_DEFAULTS, cool: 1e9 };
  const a = balloonAt(200, 100), b = balloonAt(200, 100);
  for (const s of [a, b]) { const w = windVector(getWindAt(200, 100)); s.vel.x = w.x; s.vel.z = w.z; }
  run(a, { warp: 1 }, 5, P, world, 60, stepBalloon);
  run(b, { warp: 10 }, 5, P, world, 60, stepBalloon);
  close(a.simTime, 5, 1e-9); close(b.simTime, 50, 1e-9);
  close(b.windTime - 100, 10 * (a.windTime - 100), 1e-6, 'wind clock warps');
  const da = Math.hypot(a.pos.x, a.pos.z), db = Math.hypot(b.pos.x, b.pos.z);
  assert.ok(db > 8.5 * da && db < 11 * da, `x10 distance: ${db} vs ${da}`);
  // Warped equals real time run for ten times as long (same substep size).
  const c = balloonAt(200, 100);
  { const w = windVector(getWindAt(200, 100)); c.vel.x = w.x; c.vel.z = w.z; }
  run(c, { warp: 1 }, 50, P, world, 60, stepBalloon);
  close(c.pos.x, b.pos.x, 0.05 * Math.abs(c.pos.x) + 1, 'same trajectory');
});

test('balloon basket bumps off a facade and scrapes along it, then rests on a roof', () => {
  // A tall block to the east; the westerly pushes the basket into its west face.
  const world = cityWorld([{ x: 60, z: 0, side: 40, h: 50 * VE }]);
  const P = { ...BALLOON_DEFAULTS, cool: 1e9 };
  const s = balloonAt(20);
  s.windTime = 0;
  let scraped = 0;
  for (let i = 0; i < 60 * 30; i++) {
    stepBalloon(s, {}, 1 / 60, P, world);
    assert.ok(s.pos.x <= 40 - 1.5 + 1e-3, `basket entered the building: x=${s.pos.x}`);
    if (s.scraping) scraped++;
  }
  assert.ok(scraped > 100, `scraped along the facade (${scraped} frames)`);
  assert.ok(s.bumps >= 1, 'bumped');
  // Now drop onto a roof: start above the block with a cold envelope.
  const r = createBalloonState({ x: 60, y: (50 + 30 + BASKET_EYE_M) * VE, z: 0 });
  r.dT = EQUILIBRIUM_DT - 20;
  run(r, {}, 60, { ...BALLOON_DEFAULTS, windLag: 1e9 }, world, 30, stepBalloon);
  close(r.pos.y, (50 + BASKET_EYE_M) * VE, 1e-6, 'resting on the roof');
  assert.ok(r.grounded, 'grounded on the roof');
  assert.ok(r.bumps >= 1, 'touched down with a bump');
});

test('balloon: identical inputs give identical flights (deterministic)', () => {
  const fly = () => {
    const world = cityWorld([{ x: 60, z: 0, side: 40, h: 50 * VE }]);
    const s = balloonAt(15, 42);
    for (let i = 0; i < 900; i++) stepBalloon(s, { burner: i % 200 < 60, vent: i % 300 > 280, warp: i > 600 ? 10 : 1 }, 1 / 60, BALLOON_DEFAULTS, world);
    return JSON.stringify(s);
  };
  assert.equal(fly(), fly());
});

// ── Mode objects under node (the framework test constructs them with an empty ctx) ──

test('mode objects: ids, keys, look modes and solidity per D-037', () => {
  const d = createDroneMode({}), b = createBalloonMode({});
  assert.deepEqual([d.id, d.key, d.look, d.solid, d.stub], ['drone', '3', 'lock', true, false]);
  assert.deepEqual([b.id, b.key, b.look, b.solid, b.stub], ['balloon', '4', 'drag', true, false]);
  assert.match(d.hint, /W thrust/);
  assert.match(b.hint, /T time warp ×10/);
});
