// wind.js: ONE shared world wind (sprint 23Sep26w, D-037, lane A1).
//
// Consumers: Balloon (lane A3) steers by choosing an altitude layer; aeroplanes
// (lane F) pick runway direction from the surface wind; future clouds drift on
// it. There is exactly one wind in the world, so everything that reads it
// agrees. Do not fork a private copy in a consumer.
//
// EXPORTS (the whole public surface, deliberately small):
//
//   getWindAt(altitudeM, tSec) -> { dirRad, speedMps }
//   getSurfaceWind(tSec)       -> { dirRad, speedMps }
//
// CONVENTIONS
//
//   altitudeM  real metres above ground (NOT scene units: divide scene Y by the
//              vertical exaggeration first). Negative values clamp to 0.
//   tSec       elapsed seconds. Pure function of its inputs: no randomness, no
//              clock, no state, so tests and every consumer can pin it.
//   dirRad     the bearing the wind blows FROM, meteorological convention:
//              radians clockwise from north. A westerly (wind from the west)
//              is 3π/2 (270°). Always normalised to [0, 2π).
//   speedMps   metres per second, always > 0.
//
//   Scene axes: +X is east, -Z is north (llToXZ). The velocity the air moves
//   WITH, in scene metres per second, is therefore
//       vx = -sin(dirRad) * speedMps
//       vz =  cos(dirRad) * speedMps
//   (westerly: vx = +speed, vz = 0, i.e. drifting east.)
//
// MODEL
//
//   Four layers by altitude, each with its own base direction and speed, each
//   veering slowly on its own incommensurate periods (tens of minutes) so the
//   layers never lock together and altitude choice is a real steering
//   decision. Between layers a short blend band mixes the velocity VECTORS
//   (not the angles, which would spin through the long way round), so a
//   climbing balloon feels the new layer take hold over ~100m rather than a
//   step. Drift is representative of London: 5 to 15 m/s aloft.
//
//   The surface layer veers only ±12°, so a consumer choosing a runway from it
//   never flips mid-session: the prevailing westerly always wins.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// top: upper boundary of the layer in real metres (last layer unbounded).
// dir: base FROM bearing (degrees). veer: amplitude (degrees). Periods in
// seconds are mutually incommensurate so the pattern never visibly repeats.
const LAYERS = Object.freeze([
  Object.freeze({ name: 'surface', top: 350,      dir: 270, veer: 12, veerPeriod: 2400, phase: 0.0,
    speed: 6,  gust: 0.18, gustPeriod: 170 }),
  Object.freeze({ name: 'low',     top: 1100,     dir: 230, veer: 28, veerPeriod: 1530, phase: 4.0,
    speed: 9,  gust: 0.22, gustPeriod: 230 }),
  Object.freeze({ name: 'mid',     top: 2300,     dir: 305, veer: 35, veerPeriod: 1910, phase: 2.9,
    speed: 12, gust: 0.20, gustPeriod: 310 }),
  Object.freeze({ name: 'high',    top: Infinity, dir: 175, veer: 30, veerPeriod: 2770, phase: 0.3,
    speed: 14, gust: 0.12, gustPeriod: 410 }),
]);
const BLEND_M = 120; // full width of the band either side of a boundary mix

function normAngle(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

function layerWind(layer, t) {
  const dir = (layer.dir + layer.veer * Math.sin(TAU * t / layer.veerPeriod + layer.phase)) * DEG;
  // Two sines so the speed breathes without a single obvious period.
  const breathe = 0.65 * Math.sin(TAU * t / layer.gustPeriod + layer.phase * 1.7)
    + 0.35 * Math.sin(TAU * t / (layer.gustPeriod * 2.618) + layer.phase * 0.6);
  const speed = layer.speed * (1 + layer.gust * breathe);
  return { dir, speed };
}

function toVec(w) {
  return { vx: -Math.sin(w.dir) * w.speed, vz: Math.cos(w.dir) * w.speed };
}

function fromVec(vx, vz) {
  const speed = Math.hypot(vx, vz);
  // Invert vx = -sin(dir)*s, vz = cos(dir)*s.
  const dir = speed > 1e-9 ? Math.atan2(-vx, vz) : 3 * Math.PI / 2;
  return { dirRad: normAngle(dir), speedMps: Math.max(speed, 0.05) };
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Wind at a real altitude and time.
 * @param {number} altitudeM real metres above ground
 * @param {number} tSec elapsed seconds
 * @returns {{dirRad:number, speedMps:number}}
 */
export function getWindAt(altitudeM, tSec) {
  const alt = Number.isFinite(altitudeM) ? Math.max(0, altitudeM) : 0;
  const t = Number.isFinite(tSec) ? tSec : 0;
  let i = 0;
  while (i < LAYERS.length - 1 && alt >= LAYERS[i].top) i++;
  const here = toVec(layerWind(LAYERS[i], t));
  // Blend with the neighbour whose boundary is within half a band.
  const half = BLEND_M / 2;
  let nb = -1, k = 0;
  if (i < LAYERS.length - 1 && alt > LAYERS[i].top - half) {
    nb = i + 1; k = smoothstep(LAYERS[i].top - half, LAYERS[i].top + half, alt);
  } else if (i > 0 && alt < LAYERS[i - 1].top + half) {
    nb = i - 1; k = 1 - smoothstep(LAYERS[i - 1].top - half, LAYERS[i - 1].top + half, alt);
  }
  if (nb < 0 || k <= 0) return fromVec(here.vx, here.vz);
  const there = toVec(layerWind(LAYERS[nb], t));
  return fromVec(here.vx + (there.vx - here.vx) * k, here.vz + (there.vz - here.vz) * k);
}

/**
 * Surface wind (the layer runways and ground-level effects read). Westerly by
 * default, i.e. blowing FROM the west, veering only a few degrees.
 * @param {number} tSec elapsed seconds
 * @returns {{dirRad:number, speedMps:number}}
 */
export function getSurfaceWind(tSec) {
  const w = layerWind(LAYERS[0], Number.isFinite(tSec) ? tSec : 0);
  return { dirRad: normAngle(w.dir), speedMps: w.speed };
}
