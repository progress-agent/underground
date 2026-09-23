// pedestrian-body.js: the Pedestrian body on the surface and in the river
// (sprint 23Sep26w, D-037, lane A2). Pure physics, no THREE and no DOM, so
// node tests pin it against a fake world.
//
// A body is a feet point plus velocity. It is in exactly one of three states:
//   ground  standing on terrain or a roof; WASD run, Space jumps
//   air     falling or jetpacking; gravity, inertia, landing on roofs
//   swim    in the Thames; Mario-swim physics in first person
// Station shafts and tunnels are separate (pedestrian-tunnels.js), because
// below ground the body does not move freely at all.
//
// UNITS (vertical-scale.js height contract): positions are canonical scene
// space, X/Z real metres and Y = real metres x VE. Velocities are REAL m/s on
// every axis, and tunables are real metres and seconds; this file converts Y
// with VE. Nothing here depends on the Master slider, which only rescales the
// camera display, so the physics is identical at every Master value.
//
// The world interface (collision.js supplies all of it):
//   moveAndSlide(pos, delta, { radius, height, step })  X/Z facade collision + slide
//   standHeightAt(x, z, feetY, step)   highest roof at or below feetY + step, else ground (or null)
//   waterAt(x, z)                      { surfaceY, bedY } where there is water, else null
//
// The input each frame:
//   { forward, right }   -1..1 (W/S, D/A)
//   yaw                  radians; 0 looks down -Z, positive turns left
//   pitch                DISPLAY pitch in radians (what the viewer sees at the current Master)
//   jumpPressed          Space went down since the last frame (edge)
//   jumpHeld             Space is held
//
// Events pushed to `events` (the mode turns them into sound):
//   { type: 'splash', intensity }   entered the water
//   { type: 'stroke' }              one swim stroke
//   { type: 'climb' }               climbed out at a bank
//   { type: 'land', speed }         landed from a fall (speed in m/s)

export const PEDESTRIAN_TUNABLES = Object.freeze([
  { key: 'speed', label: 'Run speed', unit: 'm/s', min: 1, max: 15, step: 0.1, default: 6 },
  { key: 'accel', label: 'Run accel', unit: 'm/s²', min: 2, max: 80, step: 1, default: 30 },
  { key: 'eye', label: 'Eye height', unit: 'm', min: 1, max: 2.5, step: 0.05, default: 1.7 },
  { key: 'gravity', label: 'Gravity', unit: 'm/s²', min: 1, max: 30, step: 0.1, default: 9.8 },
  { key: 'jump', label: 'Jump speed', unit: 'm/s', min: 1, max: 15, step: 0.1, default: 4.5 },
  { key: 'airControl', label: 'Air control', unit: 'm/s²', min: 0, max: 30, step: 0.5, default: 4 },
  { key: 'jetThrust', label: 'Jetpack thrust', unit: 'm/s²', min: 2, max: 60, step: 0.5, default: 17 },
  { key: 'jetControl', label: 'Jetpack steer', unit: 'm/s²', min: 0, max: 40, step: 0.5, default: 8 },
  { key: 'jetMaxRise', label: 'Jetpack max climb', unit: 'm/s', min: 2, max: 60, step: 1, default: 18 },
  { key: 'jetDelay', label: 'Jetpack hold delay', unit: 's', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'tunnelSprint', label: 'Tunnel sprint', unit: 'm/s', min: 5, max: 60, step: 1, default: 20 },
  { key: 'shaftSpeed', label: 'Shaft speed', unit: 'm/s', min: 1, max: 200, step: 1, default: 8 },
  { key: 'swimSpeed', label: 'Swim speed', unit: 'm/s', min: 0.3, max: 6, step: 0.1, default: 1.6 },
  { key: 'strokeUp', label: 'Stroke lift', unit: 'm/s', min: 0.5, max: 8, step: 0.1, default: 2.4 },
  { key: 'sink', label: 'Sink speed', unit: 'm/s', min: 0.05, max: 3, step: 0.05, default: 0.55 },
  { key: 'waterDrag', label: 'Water drag', unit: '/s', min: 0.1, max: 6, step: 0.1, default: 1.4 },
  { key: 'climb', label: 'Bank climb reach', unit: 'm', min: 0.3, max: 6, step: 0.1, default: 2.5 },
  { key: 'look', label: 'Look sensitivity', unit: 'mrad/px', min: 0.5, max: 8, step: 0.1, default: 2.2 },
  { key: 'easeTime', label: 'Scale ease', unit: 's', min: 0.1, max: 4, step: 0.1, default: 1 },
]);

// Fixed body geometry (real metres). Not tunables: they are what a person is.
export const BODY = Object.freeze({
  radius: 0.35,        // footprint radius against facades
  headroom: 0.15,      // body height = eye + headroom
  step: 0.4,           // kerb / low roof step-up
  stepDown: 0.6,       // follow the ground down slopes and kerbs instead of hopping
  wade: 1.0,           // water deeper than this over the feet means swimming
  headOut: 0.2,        // eye can rise this far above the water top
  swimSink: 1.4,       // m/s² gentle gravity in water (Mario-swim), capped at the sink speed
  strokeFwd: 0.9,      // m/s forward kick added by a stroke
  strokeCooldown: 0.22,
  airDrag: 0.12,       // /s horizontal drag in the air with no input (inertia)
  terminal: 55,        // m/s fall cap
});

export function createBody() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'ground', airTime: 0, jet: false, strokeCd: 0 };
}

function approach2(body, tx, tz, maxDv) {
  const dx = tx - body.vx, dz = tz - body.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDv || d === 0) { body.vx = tx; body.vz = tz; return; }
  body.vx += dx / d * maxDv; body.vz += dz / d * maxDv;
}

function wishVector(input) {
  const yaw = input.yaw || 0;
  const f = input.forward || 0, r = input.right || 0;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let wx = fx * f + rx * r, wz = fz * f + rz * r;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  return { wx, wz, fx, fz, rx, rz, any: len > 1e-6 };
}

/** Eye Y (canonical) for a body. */
export const eyeY = (body, P, VE) => body.y + P.eye * VE;

/**
 * Advance the body one frame. Mutates and returns `body`.
 * @param {object} body   from createBody()
 * @param {object} input  see header
 * @param {number} dt     seconds
 * @param {object} world  see header
 * @param {object} P      tunables (PEDESTRIAN_TUNABLES keys)
 * @param {number} VE     vertical exaggeration
 * @param {Array} [events]
 */
export function stepBody(body, input, dt, world, P, VE, events = []) {
  if (!(dt > 0)) return body;
  body.strokeCd = Math.max(0, body.strokeCd - dt);
  if (body.state === 'swim') return stepSwim(body, input, dt, world, P, VE, events);
  return stepLand(body, input, dt, world, P, VE, events);
}

function stepLand(body, input, dt, world, P, VE, events) {
  const w = wishVector(input);
  const grounded = body.state === 'ground';

  // Jump (edge) from the ground.
  if (grounded && input.jumpPressed) {
    body.vy = P.jump;
    body.state = 'air';
    body.airTime = 0;
  }
  const inAir = body.state === 'air';
  if (inAir) body.airTime += dt;
  // Jetpack: Space held in the air beyond the hold delay (a tap is just a jump).
  body.jet = inAir && !!input.jumpHeld && body.airTime >= P.jetDelay;

  // Horizontal velocity.
  if (!inAir) {
    approach2(body, w.wx * P.speed, w.wz * P.speed, P.accel * dt);
  } else if (w.any) {
    const a = body.jet ? Math.max(P.airControl, P.jetControl) : P.airControl;
    // Air control steers toward the run velocity but never brakes momentum
    // the jetpack built up beyond it (inertia).
    const cur = Math.hypot(body.vx, body.vz);
    // The jetpack may push past running pace (up to 2.5x); plain air control may not.
    const cap = Math.max(body.jet ? P.speed * 2.5 : P.speed, cur);
    body.vx += w.wx * a * dt; body.vz += w.wz * a * dt;
    const n = Math.hypot(body.vx, body.vz);
    if (n > cap) { body.vx *= cap / n; body.vz *= cap / n; }
  } else {
    const k = Math.exp(-BODY.airDrag * dt);
    body.vx *= k; body.vz *= k;
  }

  // Vertical velocity.
  if (inAir) {
    body.vy += (-P.gravity + (body.jet ? P.jetThrust : 0)) * dt;
    if (body.jet && body.vy > P.jetMaxRise) body.vy = P.jetMaxRise;
    if (body.vy < -BODY.terminal) body.vy = -BODY.terminal;
  }

  // X/Z against facades, sliding along them.
  const stepVE = BODY.step * VE;
  const res = world.moveAndSlide({ x: body.x, y: body.y, z: body.z }, { x: body.vx * dt, y: 0, z: body.vz * dt },
    { radius: BODY.radius, height: (P.eye + BODY.headroom) * VE, step: stepVE });
  if (res.hit) {
    if (res.normalX && body.vx * res.normalX < 0) body.vx = 0;
    if (res.normalZ && body.vz * res.normalZ < 0) body.vz = 0;
  }
  body.x = res.x; body.z = res.z;

  // Vertical: stand, fall, land (roofs are walkable).
  const stand = world.standHeightAt(body.x, body.z, body.y, stepVE);
  if (body.state === 'ground') {
    if (stand === null || stand === undefined) {
      // Off the terrain entirely: hold height rather than fall forever.
    } else if (stand >= body.y - BODY.stepDown * VE) {
      body.y = stand;
      body.vy = 0;
    } else {
      body.state = 'air';   // walked off a roof edge or a drop
      body.airTime = P.jetDelay; // Space held now fires the jetpack at once
      body.vy = 0;
    }
  }
  if (body.state === 'air') {
    const ny = body.y + body.vy * dt * VE;
    if (stand !== null && stand !== undefined && ny <= stand && body.vy <= 0) {
      events.push({ type: 'land', speed: -body.vy });
      body.y = stand; body.vy = 0; body.state = 'ground'; body.jet = false;
    } else {
      body.y = ny;
    }
  }

  // Into the river: deeper than wading depth over the feet.
  const water = world.waterAt(body.x, body.z);
  if (water && body.y < water.surfaceY - BODY.wade * VE) {
    events.push({ type: 'splash', intensity: Math.min(1.5, Math.max(0.3, Math.hypot(body.vy, body.vx, body.vz) / 6)) });
    body.state = 'swim';
    body.jet = false;
    body.vy *= 0.25; body.vx *= 0.5; body.vz *= 0.5;
  }
  return body;
}

function stepSwim(body, input, dt, world, P, VE, events) {
  const water = world.waterAt(body.x, body.z);
  if (!water) { body.state = 'air'; body.airTime = P.jetDelay; return body; }
  const w = wishVector(input);
  const pitch = input.pitch || 0;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = input.forward || 0;

  // W / mouse direct: swim along the look direction, including up and down.
  if (w.any) {
    const r = input.right || 0;
    let dx = w.fx * cp * f + w.rx * r, dy = sp * f, dz = w.fz * cp * f + w.rz * r;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const a = P.swimSpeed * 3 * dt; // reach swim speed in about a third of a second
    body.vx += dx * a; body.vy += dy * a; body.vz += dz * a;
    const n = Math.hypot(body.vx, body.vy, body.vz);
    const cap = Math.max(P.swimSpeed, P.strokeUp);
    if (n > cap) { body.vx *= cap / n; body.vy *= cap / n; body.vz *= cap / n; }
  }
  // Space strokes upward (Mario), with a small kick along the view.
  if (input.jumpPressed && body.strokeCd <= 0) {
    body.vy = Math.max(body.vy, 0) + P.strokeUp;
    body.vx += w.fx * BODY.strokeFwd; body.vz += w.fz * BODY.strokeFwd;
    body.strokeCd = BODY.strokeCooldown;
    events.push({ type: 'stroke' });
  }
  // Buoyant drift: everything decays slowly (floaty inertia) ...
  const drag = Math.exp(-P.waterDrag * dt);
  body.vx *= drag; body.vz *= drag; body.vy *= drag;
  // ... and a gentle gravity settles into a slow sink.
  body.vy -= BODY.swimSink * dt;
  // (Diving with W and the view pointed down may go faster than the sink.)
  if (body.vy < -P.sink && !(w.any && f * sp < 0)) body.vy = -P.sink;

  // Horizontal, with the bank test.
  const nx = body.x + body.vx * dt, nz = body.z + body.vz * dt;
  const ahead = world.waterAt(nx, nz);
  const eye = body.y + P.eye * VE;
  if (!ahead) {
    const land = world.standHeightAt(nx, nz, eye + P.climb * VE, 0);
    if (land !== null && land !== undefined && land <= eye + P.climb * VE) {
      body.x = nx; body.z = nz; body.y = land;
      body.vx = body.vy = body.vz = 0;
      body.state = 'ground';
      events.push({ type: 'climb' });
      return body;
    }
    body.vx = 0; body.vz = 0; // a wall too high to climb
  } else {
    const res = world.moveAndSlide({ x: body.x, y: body.y, z: body.z }, { x: nx - body.x, y: 0, z: nz - body.z },
      { radius: BODY.radius, height: (P.eye + BODY.headroom) * VE, step: BODY.step * VE });
    body.x = res.x; body.z = res.z;
  }

  // Vertical: bed below, air above (head just out of the water).
  const here = world.waterAt(body.x, body.z) || water;
  body.y += body.vy * dt * VE;
  const top = here.surfaceY + (BODY.headOut - P.eye) * VE;
  if (body.y > top) { body.y = top; if (body.vy > 0) body.vy = 0; }
  const bed = Number.isFinite(here.bedY) ? here.bedY : null;
  if (bed !== null && body.y < bed) { body.y = bed; if (body.vy < 0) body.vy = 0; }
  // Shallows: stand up and wade.
  if (bed !== null && bed >= here.surfaceY - BODY.wade * 0.8 * VE && body.y <= bed + 0.05 * VE) {
    body.state = 'ground'; body.vy = 0;
    events.push({ type: 'climb' });
  }
  return body;
}
