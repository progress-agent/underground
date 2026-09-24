// drone-physics.js: Drone flight model (sprint 23Sep26w, D-037, lane A3).
// Pure and deterministic: stepDrone() is a function of (state, input, dt,
// params, world) only, so node tests pin it without a browser.
//
// Jordan: "FPV drone, fast and acrobatic", reproducing the PERSPECTIVE of an
// FPV drone with keyboard and mouse/trackpad, not FPV stick controls. So:
//   - W thrusts along where you are looking; the mouse steers the look.
//   - The look follows the mouse through an UNDERDAMPED spring, so a flick
//     overshoots and settles: momentum you can feel in the view itself.
//   - Velocity is inertial (thrust against linear drag, top speed =
//     accel / drag), so turns carry the old velocity through and slide.
//   - No gravity. Idle, the drone brakes to a hover and holds its height.
//   - The camera BANKS into turns by the coordinated-turn angle,
//     atan(v * turnRate / g), and PITCHES FORWARD with forward speed, by the
//     tilt a quad needs to hold that speed against drag. Both are derived
//     from the motion, never keyed directly (droneAttitude()).
//   - Buildings are solid: the drone bounces off a facade with restitution
//     and a decaying wobble; roofs and the ground are floors; the water
//     surface is a floor too (a drone skims the Thames, it does not dive).
//
// UNITS. state.pos is canonical scene space (the camera position: X/Z real
// metres, Y = metres x VE). Velocities, accelerations and every tunable are
// REAL metres and seconds; the step converts Y by VE at the boundary.

import { clampAbs } from './drone-camera.js';

export const G = 9.81;
const DEG = Math.PI / 180;
const MAX_SUBSTEP = 1 / 120;          // spring stability at any frame rate
const PITCH_LIMIT = 85 * DEG;
export const DRONE_RADIUS_M = 1.5;    // body + prop guards + a margin for the 1-unit near plane
export const DRONE_HALF_HEIGHT_M = 0.3;

// Physics-panel tunables (real units). Best first guesses; Jordan tunes at review.
export const DRONE_TUNABLES = Object.freeze([
  { key: 'speed', label: 'Top speed', unit: 'm/s', min: 5, max: 150, step: 1, default: 45 },
  { key: 'accel', label: 'Thrust', unit: 'm/s²', min: 5, max: 120, step: 1, default: 32 },
  { key: 'sprint', label: 'Boost (Shift)', unit: '×', min: 1, max: 8, step: 0.1, default: 3 },
  { key: 'damping', label: 'Idle brake', unit: '/s', min: 0, max: 5, step: 0.05, default: 0.9 },
  { key: 'climb', label: 'Rise/sink', unit: 'm/s²', min: 0, max: 60, step: 1, default: 18 },
  { key: 'turn', label: 'Look spring', unit: 'Hz', min: 0.3, max: 4, step: 0.05, default: 1.6 },
  { key: 'overshoot', label: 'Look damping', unit: 'ζ', min: 0.15, max: 1.2, step: 0.01, default: 0.45 },
  { key: 'sensitivity', label: 'Mouse', unit: '°/px', min: 0.02, max: 0.6, step: 0.01, default: 0.14 },
  { key: 'fov', label: 'FOV (horiz.)', unit: '°', min: 60, max: 150, step: 1, default: 110 },
  { key: 'fovKick', label: 'FOV at speed', unit: '°', min: 0, max: 30, step: 1, default: 8 },
  { key: 'bank', label: 'Bank', unit: '×', min: 0, max: 2, step: 0.05, default: 1 },
  { key: 'maxBank', label: 'Max bank', unit: '°', min: 0, max: 80, step: 1, default: 55 },
  { key: 'tilt', label: 'Speed pitch', unit: '×', min: 0, max: 1.5, step: 0.05, default: 0.3 },
  { key: 'bounce', label: 'Bounce', unit: '', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'wobble', label: 'Wobble', unit: '×', min: 0, max: 3, step: 0.05, default: 1 },
]);

export const DRONE_DEFAULTS = Object.freeze(Object.fromEntries(DRONE_TUNABLES.map(t => [t.key, t.default])));

const WOBBLE_HZ = 5.5;       // frame wobble after an impact
const WOBBLE_ZETA = 0.12;
const WOBBLE_MAX = 35 * DEG;
const ATTITUDE_TAU = 0.12;   // s, bank / dip smoothing so the horizon never jitters

export function createDroneState({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0 } = {}) {
  const p = clampAbs(pitch, PITCH_LIMIT);
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },          // real m/s
    yaw, yawRate: 0, targetYaw: yaw,     // look spring (yaw)
    pitch: p, pitchRate: 0, targetPitch: p,
    bank: 0, dip: 0,                     // derived attitude (smoothed)
    wobRoll: 0, wobRollRate: 0, wobPitch: 0, wobPitchRate: 0,
    hits: 0, lastImpact: 0, speed: 0, time: 0,
  };
}

/**
 * The attitude the frame takes from the motion, before smoothing.
 * bank: coordinated-turn angle atan(v_fwd * yawRate / g), plus the lean a
 *       strafe acceleration needs, scaled by params.bank, clamped to maxBank.
 *       Positive = left bank (a left turn, yawRate > 0, banks left).
 * dip:  forward pitch that holds the current forward speed against drag,
 *       atan(drag * v_fwd / g) scaled by params.tilt. Positive = nose down;
 *       flying backwards pitches the nose up.
 */
export function droneAttitude({ speedFwd = 0, yawRate = 0, lateralAccel = 0 }, params = DRONE_DEFAULTS) {
  const drag = params.accel / Math.max(1e-6, params.speed);
  const maxBank = params.maxBank * DEG;
  const bank = clampAbs(Math.atan2(speedFwd * yawRate + lateralAccel, G) * params.bank, maxBank);
  const dip = clampAbs(Math.atan2(drag * speedFwd, G) * params.tilt, 45 * DEG);
  return { bank, dip };
}

/** Horizontal FOV for the current speed: the tunable plus a small speed kick. */
export function droneHorizontalFov(speed, params = DRONE_DEFAULTS) {
  const top = params.speed * params.sprint;
  const k = Math.min(1, Math.max(0, speed / Math.max(1e-6, top)));
  return params.fov + params.fovKick * k;
}

function springStep(x, v, target, hz, zeta, dt) {
  const w = 2 * Math.PI * hz;
  const a = w * w * (target - x) - 2 * zeta * w * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

/**
 * Look input (CSS px deltas from pointer lock or drag). Moves the spring
 * TARGET; the view follows through the spring in stepDrone.
 */
export function droneLook(state, dx, dy, params = DRONE_DEFAULTS) {
  const s = params.sensitivity * DEG;
  state.targetYaw -= dx * s;
  state.targetPitch = clampAbs(state.targetPitch - dy * s, PITCH_LIMIT);
}

/**
 * Advance the drone.
 * input: { thrust: -1..1 (W / S), strafe: -1..1 (D / A), lift: -1..1 (E / Q), boost: bool }
 * world: { VE, collision?: { moveAndSlide, standHeightAt }, waterSurfaceY?(x, z) }
 * Returns the state (mutated in place).
 */
export function stepDrone(state, input, dt, params = DRONE_DEFAULTS, world = {}) {
  if (!(dt > 0)) return state;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(state, input, h, params, world);
  state.time += dt;
  return state;
}

function substep(s, input, dt, P, world) {
  const VE = world.VE ?? 5;
  const thrust = clampAbs(input.thrust || 0, 1);
  const strafe = clampAbs(input.strafe || 0, 1);
  const lift = clampAbs(input.lift || 0, 1);
  const boost = input.boost ? P.sprint : 1;
  const idle = thrust === 0 && strafe === 0 && lift === 0;

  // 1. Look spring (underdamped: overshoot and settle).
  [s.yaw, s.yawRate] = springStep(s.yaw, s.yawRate, s.targetYaw, P.turn, P.overshoot, dt);
  [s.pitch, s.pitchRate] = springStep(s.pitch, s.pitchRate, s.targetPitch, P.turn, P.overshoot, dt);
  s.pitch = clampAbs(s.pitch, PITCH_LIMIT);

  // 2. Forces (real units). Thrust follows the look; drag sets the top speed.
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
  const fx = -sy * cp, fy = sp, fz = -cy * cp;
  const rx = cy, rz = -sy;
  const A = P.accel * boost;
  const drag = P.accel / Math.max(1e-6, P.speed) + (idle ? P.damping : 0);
  const ax = fx * A * thrust + rx * A * 0.6 * strafe - drag * s.vel.x;
  const ay = fy * A * thrust + P.climb * boost * lift - drag * s.vel.y;
  const az = fz * A * thrust + rz * A * 0.6 * strafe - drag * s.vel.z;
  s.vel.x += ax * dt; s.vel.y += ay * dt; s.vel.z += az * dt;
  // A dead-still hover once the brake has done its work (no creeping).
  if (idle && Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 0.02) { s.vel.x = 0; s.vel.y = 0; s.vel.z = 0; }

  // 3. Horizontal move with building collision.
  const halfH = DRONE_HALF_HEIGHT_M * VE;
  const oldFeet = s.pos.y - halfH;
  const dxm = s.vel.x * dt, dzm = s.vel.z * dt;
  const col = world.collision;
  if (col?.moveAndSlide && (dxm || dzm)) {
    const r = col.moveAndSlide({ x: s.pos.x, y: oldFeet, z: s.pos.z }, { x: dxm, y: 0, z: dzm },
      { radius: DRONE_RADIUS_M, height: halfH * 2, step: 0.2 * VE });
    s.pos.x = r.x; s.pos.z = r.z;
    if (r.hit) facadeImpact(s, r.normalX, r.normalZ, P, fx, fz);
  } else {
    s.pos.x += dxm; s.pos.z += dzm;
  }

  // 4. Vertical move; ground, roofs and water are floors.
  let y = s.pos.y + s.vel.y * dt * VE;
  let floor = col?.standHeightAt ? col.standHeightAt(s.pos.x, s.pos.z, oldFeet, 0.2 * VE) : null;
  const water = world.waterSurfaceY?.(s.pos.x, s.pos.z);
  if (Number.isFinite(water) && (floor === null || water > floor)) floor = water;
  if (Number.isFinite(floor) && y - halfH < floor) {
    y = floor + halfH;
    if (s.vel.y < 0) {
      const impact = -s.vel.y;
      s.vel.y = impact > 1 ? impact * P.bounce * 0.6 : 0;
      if (impact > 1) {
        s.wobPitchRate -= Math.min(8, impact * 0.35) * P.wobble; // a hard landing nods the nose
        s.hits++; s.lastImpact = impact;
      }
    }
  }
  s.pos.y = y;

  // 5. Impact wobble (two lightly damped oscillators on the frame).
  [s.wobRoll, s.wobRollRate] = springStep(s.wobRoll, s.wobRollRate, 0, WOBBLE_HZ, WOBBLE_ZETA, dt);
  [s.wobPitch, s.wobPitchRate] = springStep(s.wobPitch, s.wobPitchRate, 0, WOBBLE_HZ, WOBBLE_ZETA, dt);
  s.wobRoll = clampAbs(s.wobRoll, WOBBLE_MAX);
  s.wobPitch = clampAbs(s.wobPitch, WOBBLE_MAX);

  // 6. Derived attitude, smoothed.
  const speedFwd = s.vel.x * -sy + s.vel.z * -cy;
  const lateralAccel = -A * 0.6 * strafe; // leftward accel: strafing right leans right (negative bank)
  const target = droneAttitude({ speedFwd, yawRate: s.yawRate, lateralAccel }, P);
  const k = 1 - Math.exp(-dt / ATTITUDE_TAU);
  s.bank += (target.bank - s.bank) * k;
  s.dip += (target.dip - s.dip) * k;
  s.speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
}

function facadeImpact(s, nx, nz, P, fx, fz) {
  const vn = s.vel.x * nx + s.vel.z * nz; // < 0 when moving into the facade
  if (vn >= 0) return;
  const impact = -vn;
  // Reflect the normal component with restitution; scrub the tangential.
  s.vel.x -= (1 + P.bounce) * vn * nx;
  s.vel.z -= (1 + P.bounce) * vn * nz;
  const tx = s.vel.x - (s.vel.x * nx + s.vel.z * nz) * nx;
  const tz = s.vel.z - (s.vel.x * nx + s.vel.z * nz) * nz;
  s.vel.x -= tx * 0.25; s.vel.z -= tz * 0.25;
  // Wobble: a glancing blow on the right rolls the frame one way, the left
  // the other; a head-on blow kicks the nose up.
  const h = Math.hypot(fx, fz) || 1;
  const side = (nx * (-fz / h) + nz * (fx / h));        // normal . left
  const head = -(nx * fx + nz * fz) / h;                 // 1 when head-on
  const kick = Math.min(10, impact * 0.3) * P.wobble;
  s.wobRollRate += kick * (side >= 0 ? 1 : -1) * (0.4 + 0.6 * Math.abs(side));
  s.wobPitchRate += kick * Math.max(0.3, head);
  s.hits++; s.lastImpact = impact;
}

/** Camera attitude for the current state: look, minus speed dip, plus wobble. */
export function droneCameraAttitude(s) {
  return {
    yaw: s.yaw,
    pitch: clampAbs(s.pitch - s.dip + s.wobPitch, 89 * DEG),
    roll: s.bank + s.wobRoll,
  };
}
