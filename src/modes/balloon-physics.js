// balloon-physics.js: hot-air balloon flight model (sprint 23Sep26w, D-037,
// lane A3). Pure and deterministic: stepBalloon() is a function of (state,
// input, dt, params, world) only, so node tests pin it without a browser.
//
// Jordan: "Hot air balloon, drifting on the wind." No direct steering: the
// pilot controls only heat, so ALTITUDE is the steering, choosing between the
// shared wind layers (src/wind.js, each with its own direction, slowly
// veering).
//
//   Burner (E / Space) feeds heat through a first-order LAG (seconds), the
//   envelope temperature integrates that heat and cools towards ambient, and
//   buoyancy follows the envelope temperature against vertical drag. Three
//   stacked lags, so a burn is felt several seconds later and keeps lifting
//   after release: the balloon pilot's rhythm. Q vents (dumps heat fast).
//
//   Horizontally the basket relaxes onto the wind velocity at its altitude
//   within a few seconds: it drifts at the air's own 5 to 15 m/s.
//
//   Time warp multiplies simulated time (x10 default), so the same physics,
//   wind veering included, runs ten times faster.
//
//   Buildings are solid: the basket bumps off facades and scrapes along them
//   (the wind keeps pressing), settles on roofs, the ground or the water
//   surface, and lifts off again once the envelope is hot enough.
//
// UNITS. state.pos is the canonical camera position (X/Z metres, Y = metres x
// VE); the eye sits BASKET_EYE_M above the basket floor. Everything else is
// real metres, seconds and kelvin.

export const G = 9.81;
export const BASKET_RADIUS_M = 1.5;
export const BASKET_HEIGHT_M = 3.0;    // basket plus burner frame
export const BASKET_EYE_M = 1.5;
export const EQUILIBRIUM_DT = 60;      // K above ambient at which lift balances weight
const MAX_DT_K = 130;                  // envelope limit above ambient
const MAX_SUBSTEP = 1 / 30;
const SWAY_HZ = 0.22;                  // ~20 m of rigging as a pendulum
const SWAY_ZETA = 0.18;
const SWAY_MAX = 0.08;                  // rad, about 4.6 degrees

export const BALLOON_TUNABLES = Object.freeze([
  { key: 'lag', label: 'Burner lag', unit: 's', min: 0.2, max: 12, step: 0.1, default: 3 },
  { key: 'heat', label: 'Burner heat', unit: 'K/s', min: 0.5, max: 15, step: 0.1, default: 4 },
  { key: 'cool', label: 'Cooling', unit: 's', min: 20, max: 600, step: 5, default: 150 },
  { key: 'vent', label: 'Vent', unit: 'K/s', min: 0.5, max: 15, step: 0.1, default: 3 },
  { key: 'lift', label: 'Buoyancy', unit: 'm/s²/K', min: 0.005, max: 0.2, step: 0.005, default: 0.04 },
  { key: 'damping', label: 'Vertical drag', unit: '/s', min: 0.05, max: 2, step: 0.01, default: 0.35 },
  { key: 'windLag', label: 'Wind coupling', unit: 's', min: 0.5, max: 30, step: 0.5, default: 6 },
  { key: 'warp', label: 'Time warp (T)', unit: '×', min: 2, max: 30, step: 1, default: 10 },
  { key: 'sensitivity', label: 'Drag look', unit: '°/px', min: 0.02, max: 0.6, step: 0.01, default: 0.18 },
]);

export const BALLOON_DEFAULTS = Object.freeze(Object.fromEntries(BALLOON_TUNABLES.map(t => [t.key, t.default])));

/** Wind velocity (scene axes, real m/s) from wind.js's { dirRad, speedMps } (FROM bearing). */
export function windVector(w) {
  return { x: -Math.sin(w.dirRad) * w.speedMps, z: Math.cos(w.dirRad) * w.speedMps };
}

export function createBalloonState({ x = 0, y = 0, z = 0, windTime = 0 } = {}) {
  return {
    pos: { x, y, z },
    vel: { x: 0, z: 0 }, vy: 0,   // real m/s
    heat: 0,                      // lagged burner output, 0..1
    dT: EQUILIBRIUM_DT,           // envelope K above ambient: starts neutral
    burner: false, vent: false,
    grounded: false, scraping: false,
    windTime,                     // seconds on the wind clock (advances x warp)
    simTime: 0,                   // total simulated seconds
    swayRoll: 0, swayRollRate: 0, swayPitch: 0, swayPitchRate: 0,
    bumps: 0, lastBump: 0, altitude: 0,
  };
}

/**
 * Advance the balloon by `dt` REAL seconds; `warp` multiplies simulated time.
 * input: { burner: bool, vent: bool, warp: number (1 = real time) }
 * world: { VE, wind(altM, t) -> {dirRad, speedMps}, groundY(x, z),
 *          collision?: { moveAndSlide, standHeightAt }, waterSurfaceY?(x, z) }
 */
export function stepBalloon(state, input, dt, params = BALLOON_DEFAULTS, world = {}) {
  if (!(dt > 0)) return state;
  const warp = Math.max(1, Number(input.warp) || 1);
  const sim = dt * warp;
  const n = Math.max(1, Math.ceil(sim / MAX_SUBSTEP));
  const h = sim / n;
  state.burner = !!input.burner;
  state.vent = !!input.vent;
  for (let i = 0; i < n; i++) substep(state, h, params, world);
  return state;
}

function spring(x, v, hz, zeta, dt) {
  const w = 2 * Math.PI * hz;
  const nv = v + (-w * w * x - 2 * zeta * w * v) * dt;
  return [x + nv * dt, nv];
}

function substep(s, dt, P, world) {
  const VE = world.VE ?? 5;
  const eye = BASKET_EYE_M * VE;

  // 1. Heat: burner -> lagged heat -> envelope temperature, cooling to ambient.
  s.heat += ((s.burner ? 1 : 0) - s.heat) * (1 - Math.exp(-dt / P.lag));
  s.dT += (P.heat * s.heat - s.dT / P.cool - (s.vent ? P.vent : 0)) * dt;
  s.dT = Math.min(MAX_DT_K, Math.max(0, s.dT));

  // 2. Vertical: buoyancy against weight, linear drag.
  s.vy += (P.lift * (s.dT - EQUILIBRIUM_DT) - P.damping * s.vy) * dt;

  // 3. Horizontal: relax onto the wind at this altitude (above the terrain).
  const ground = world.groundY?.(s.pos.x, s.pos.z);
  const feet = s.pos.y - eye;
  const altM = Number.isFinite(ground) ? Math.max(0, (feet - ground) / VE) : Math.max(0, feet / VE);
  s.altitude = altM;
  const w = windVector(world.wind ? world.wind(altM, s.windTime) : { dirRad: 0, speedMps: 0 });
  const k = 1 - Math.exp(-dt / P.windLag);
  s.vel.x += (w.x - s.vel.x) * k;
  s.vel.z += (w.z - s.vel.z) * k;
  if (s.grounded) { // resting basket: friction holds it against the breeze
    const f = Math.exp(-dt / 0.4);
    s.vel.x *= f; s.vel.z *= f;
  }
  const accX = (w.x - s.vel.x) / P.windLag, accZ = (w.z - s.vel.z) / P.windLag;

  // 4. Horizontal move: the basket bumps off and scrapes along facades.
  const dx = s.vel.x * dt, dz = s.vel.z * dt;
  const col = world.collision;
  s.scraping = false;
  if (col?.moveAndSlide && (dx || dz)) {
    const r = col.moveAndSlide({ x: s.pos.x, y: feet, z: s.pos.z }, { x: dx, y: 0, z: dz },
      { radius: BASKET_RADIUS_M, height: BASKET_HEIGHT_M * VE, step: 0.3 * VE });
    s.pos.x = r.x; s.pos.z = r.z;
    if (r.hit) {
      const vn = s.vel.x * r.normalX + s.vel.z * r.normalZ;
      if (vn < 0) {
        s.vel.x -= 1.15 * vn * r.normalX; s.vel.z -= 1.15 * vn * r.normalZ; // 0.15 restitution
        const impact = -vn;
        if (impact > 0.4) { s.bumps++; s.lastBump = impact; }
        s.swayRollRate += Math.min(0.12, impact * 0.03) * (r.normalX >= 0 ? 1 : -1);
        s.swayPitchRate += Math.min(0.12, impact * 0.03) * (r.normalZ >= 0 ? 1 : -1);
      }
      s.scraping = true;
    }
  } else {
    s.pos.x += dx; s.pos.z += dz;
  }

  // 5. Vertical move; ground, roofs and the water surface are floors.
  let y = s.pos.y + s.vy * dt * VE;
  let floor = col?.standHeightAt ? col.standHeightAt(s.pos.x, s.pos.z, feet, 0.3 * VE)
    : (Number.isFinite(ground) ? ground : null);
  const water = world.waterSurfaceY?.(s.pos.x, s.pos.z);
  if (Number.isFinite(water) && (floor === null || water > floor)) floor = water;
  if (Number.isFinite(floor) && y - eye <= floor + 1e-6) {
    y = floor + eye;
    if (s.vy < 0) {
      const impact = -s.vy;
      if (impact > 1) { s.vy = impact * 0.15; s.bumps++; s.lastBump = impact; s.swayPitchRate += Math.min(0.12, impact * 0.04); }
      else s.vy = 0;
    }
    s.grounded = s.vy <= 0;
  } else {
    s.grounded = false;
  }
  s.pos.y = y;

  // 6. Basket sway: rigging pendulum driven by the drift's acceleration.
  s.swayRollRate += -accX * 0.02 * dt;
  s.swayPitchRate += accZ * 0.02 * dt;
  [s.swayRoll, s.swayRollRate] = spring(s.swayRoll, s.swayRollRate, SWAY_HZ, SWAY_ZETA, dt);
  [s.swayPitch, s.swayPitchRate] = spring(s.swayPitch, s.swayPitchRate, SWAY_HZ, SWAY_ZETA, dt);
  s.swayRoll = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, s.swayRoll));
  s.swayPitch = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, s.swayPitch));

  s.windTime += dt;
  s.simTime += dt;
}
