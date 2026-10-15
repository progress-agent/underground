// skate-body.js: the skateboard's physics (sprint 14Oct26w, lane D, D-053 item 2). Pure: no THREE, no DOM, so node
// tests pin it against a fake world, as pedestrian-body.js is.
//
// The mock's handling is the starting point (Working/player-mock-01Oct26h/src/main.js stepSkate): W pushes, S
// brakes, A/D steer with lean, Space is an ollie, Shift is faster, a wall takes the speed off, falling into the
// river drops the board. The step calls stepBody (pedestrian-body.js) with the board's own parameter object, as the
// mock does, with jumpHeld false, so Space never fires the jetpack on a board.
//
// UNITS are pedestrian-body.js's: positions canonical (X/Z metres, Y metres x VE), velocities real m/s, the
// tunables real metres and seconds. `v` is the board's speed along its heading; `heading` is the travel direction
// in the walker's yaw convention (0 faces -Z, positive turns left).
//
// THE NUMBERS (the Physics panel's "Skateboard" section; the defaults are the design's):
//   top      12 m/s cruising, reached from rest in top / push = 1.71 s; Shift 1.5x = 18 m/s in 2.57 s
//   coast    0.9 m/s per second lost with W released; brake (S) 12 more, so 12 m/s stops in 0.93 s
//   steer    2.1 rad/s at 5 m/s and above, (0.35 + 0.65 min(1, v / 5)) of it below: a board cannot pivot on the spot
//   lean     0.04 rad per m/s up to 20 degrees, into the turn (positive = left, as a left turn)
//   ollie    4.0 m/s: apex 0.82 m, 0.82 s in the air
import { stepBody } from './pedestrian-body.js';

export const SKATE_TUNABLES = Object.freeze([
  { key: 'top', label: 'Cruising speed', unit: 'm/s', min: 4, max: 30, step: 0.5, default: 12 },
  { key: 'boost', label: 'Fast (Shift)', unit: '×', min: 1, max: 2.5, step: 0.05, default: 1.5 },
  { key: 'push', label: 'Push accel', unit: 'm/s²', min: 1, max: 20, step: 0.5, default: 7 },
  { key: 'coast', label: 'Coast drag', unit: 'm/s²', min: 0, max: 5, step: 0.05, default: 0.9 },
  { key: 'brake', label: 'Brake (S)', unit: 'm/s²', min: 2, max: 30, step: 0.5, default: 12 },
  { key: 'steer', label: 'Steer rate', unit: 'rad/s', min: 0.5, max: 5, step: 0.05, default: 2.1 },
  { key: 'lean', label: 'Lean per m/s', unit: 'rad', min: 0, max: 0.1, step: 0.005, default: 0.04 },
  { key: 'maxLean', label: 'Max lean', unit: '°', min: 0, max: 40, step: 1, default: 20 },
  { key: 'ollie', label: 'Ollie speed', unit: 'm/s', min: 1, max: 8, step: 0.1, default: 4.0 },
]);

export const SKATE_DEFAULTS = Object.freeze(Object.fromEntries(SKATE_TUNABLES.map((d) => [d.key, d.default])));

/** Fixed geometry and timings of the board (real metres, seconds). Not tunables. */
export const SKATE = Object.freeze({
  deckTopM: 0.157,        // the standing surface above the ground, with the model at 0.80 m long
  leanRate: 8,            // /s, how fast the lean follows its target
  pushRiseS: 0.15,        // the push weight eases 0 to 1 in this
  pushFallS: 0.2,         // and 1 to 0 in this
  pushPeriodS: 0.9,       // one kick-and-return
  pushBelowTopMps: 0.3,   // the push stops this short of the speed W is heading for
  tuckRiseS: 0.12,        // the crouch in the air
  tuckFallS: 0.15,
  idleSpeed: 0.05,        // below this the board is at rest
});

/** Why B is refused. */
export const REFUSALS = Object.freeze(['water', 'air', 'below', 'card', 'unavailable']);

export function createSkate() {
  return {
    on: false, v: 0, heading: 0, lean: 0, push: 0, pushPhase: 0, pushT: 0, tuck: 0, airT: 0,
    facing: 0, refused: null, lastDrop: null, pending: false,
  };
}

/**
 * Whether the walker may step on the board now: null, or the reason. Pure.
 * @param {{ phase: string, state: string, inWater: boolean, cardOpen: boolean, unavailable?: boolean }} s
 */
export function canBoard({ phase, state, inWater, cardOpen, unavailable = false }) {
  if (unavailable) return 'unavailable';
  if (phase !== 'body') return 'below';
  if (cardOpen) return 'card';
  if (inWater || state === 'swim') return 'water';
  if (state !== 'ground') return 'air';
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The travel speed Shift or not asks for. */
export const topSpeed = (K, shift) => K.top * (shift ? K.boost : 1);

/**
 * Advance the board one frame. Mutates and returns `sk`; `body` is the walker's body (pedestrian-body.js).
 * @param {object} sk     from createSkate()
 * @param {object} body   from createBody()
 * @param {{ forward: number, steer: number, shift: boolean, ollie: boolean }} input
 *        forward -1..1 (W up, S down); steer +1 for A (left) and -1 for D; ollie is an edge (Space went down)
 * @param {number} dt
 * @param {object} world  the pedestrian's world (moveAndSlide, standHeightAt, waterAt)
 * @param {object} P      the pedestrian's tunables (eye, gravity, ...)
 * @param {number} VE
 * @param {Array} events  sound events, as stepBody's
 * @param {object} K      the board's tunables (SKATE_TUNABLES keys)
 */
export function stepSkate(sk, body, input, dt, world, P, VE, events, K) {
  if (!(dt > 0)) return sk;
  const topNow = topSpeed(K, input.shift);
  const wasGround = body.state === 'ground';
  const fwd = input.forward || 0;
  const steer = clamp(input.steer || 0, -1, 1);

  if (wasGround) {
    // Pushing, coasting and braking. W below the speed asked for accelerates; above it (Shift let go) it eases down.
    if (fwd > 0) sk.v = sk.v < topNow ? Math.min(topNow, sk.v + K.push * dt) : Math.max(topNow, sk.v - K.coast * dt);
    else sk.v = Math.max(0, sk.v - K.coast * dt);
    if (fwd < 0) sk.v = Math.max(0, sk.v - K.brake * dt);
    // A board turns by leaning, so it cannot spin on the spot: the rate is a share of the full one below 5 m/s.
    sk.heading += steer * K.steer * (0.35 + 0.65 * Math.min(1, sk.v / 5)) * dt;
  }
  // The body moves as the mock moves it: a stepBody with the board's speed as the run speed and a huge acceleration,
  // so the velocity is the board's. Space is only an edge (no jetpack).
  stepBody(body, {
    forward: sk.v > SKATE.idleSpeed ? 1 : 0, right: 0, yaw: sk.heading, pitch: 0,
    jumpPressed: !!input.ollie && body.state === 'ground', jumpHeld: false,
  }, dt, world, { ...P, speed: Math.max(sk.v, 0.01), accel: 400, jump: K.ollie, airControl: 0 }, VE, events);

  const hs = Math.hypot(body.vx, body.vz);
  if (body.state === 'ground' && hs < sk.v) sk.v = hs;     // a facade takes the speed off
  if (body.state === 'swim') {                              // fell in: the board is dropped, the walker swims
    sk.on = false; sk.lastDrop = 'water'; sk.v = 0; sk.push = 0; sk.pushT = 0; sk.tuck = 0; sk.lean = 0; sk.airT = 0;
    return sk;
  }

  const ground = body.state === 'ground';
  // Air time: since take-off.
  sk.airT = ground ? 0 : sk.airT + dt;

  // Lean into the turn, on the ground only.
  const maxLean = (K.maxLean * Math.PI) / 180;
  const target = ground ? steer * Math.min(maxLean, sk.v * K.lean) : 0;
  sk.lean += (target - sk.lean) * (1 - Math.exp(-SKATE.leanRate * dt));

  // The push: the back foot kicks while W is held below the speed it is heading for.
  const pushing = ground && fwd > 0 && sk.v < topNow - SKATE.pushBelowTopMps;
  const wasPushing = sk.push > 1e-6;
  if (pushing) {
    if (!wasPushing) sk.pushT = 0;
    sk.pushT += dt;
    sk.push = Math.min(1, sk.push + dt / SKATE.pushRiseS);
  } else {
    sk.push = Math.max(0, sk.push - dt / SKATE.pushFallS);
    if (sk.push <= 0) sk.pushT = 0;
    else sk.pushT += dt;     // the leg finishes its stroke while the weight fades
  }
  sk.pushPhase = (sk.pushT / SKATE.pushPeriodS) % 1;

  // The crouch of an ollie.
  sk.tuck = ground ? Math.max(0, sk.tuck - dt / SKATE.tuckFallS) : Math.min(1, sk.tuck + dt / SKATE.tuckRiseS);
  return sk;
}
