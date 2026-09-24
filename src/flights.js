import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import airportData from './airport-data.json' with { type: 'json' };
import motorwayData from './m25-motorway-data.json' with { type: 'json' };
import { aircraftParts, AIRCRAFT_PALETTE, AIRCRAFT_REFERENCE_LENGTH_M } from './aircraft-model.js';

// flights.js: living air traffic (sprint 23Sep26w, D-037, lane F).
//
// "Trains in invisible tunnels": nothing here is mapped or live. Each airport
// stream owns a small set of generated 3D paths (holding stack -> join ->
// 3 degree final -> rollout; takeoff roll -> climb -> fanned exit; light
// aircraft circuits), and every aircraft is a pure function of elapsed time:
//
//   flight k of a stream is anchored at  a_k = offset + k * period + jitter(k)
//   (landing time for arrivals, brake release for departures and circuits),
//   and its position at time t is its path sampled at (t - a_k).
//
// Jitter, aircraft type, stack, hold level and departure fan are hashed from
// (stream, k), never Math.random, so a pinned time always yields the same sky.
// Runway direction is chosen from the shared surface wind AT THE ANCHOR TIME,
// so a flight never changes runway mid-path and a veering wind hands over
// cleanly, flight by flight. The pattern is a fixed midday flow: it is not
// driven by any sun or time-of-day control.
//
// Coordinates: canonical scene space. x east, z south (metres), y canonical
// VE5 (real metres x VE). Master height is applied by the camera; this module
// never rescales a layer. Aircraft models share airports.js's recipe and its
// vertical structure stretch (VE x structure scale), exactly like parked ones.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const GLIDESLOPE_DEG = 3;
export const FINAL_APPROACH_M = 18000;
export const AIM_POINT_M = 300;          // glide path origin beyond the threshold
export const EDGE_INSET_M = 250;         // aircraft vanish this far inside the motorway ring
export const HEADING_TAILWIND_LIMIT_MPS = 2.5; // preferred-direction tolerance (about 5 kt)
const GROUND_LIFT = 1.5;                 // canonical lift, matching parked aircraft
const G = 9.81;

// ── Shared wind ─────────────────────────────────────────────────────────────
// fn(tSec) -> { dirRad, speedMps }: the bearing the wind blows FROM, radians
// clockwise from north (meteorological), matching src/wind.js getSurfaceWind.
export const DEFAULT_WIND = Object.freeze({ dirRad: 270 * DEG, speedMps: 5 });
let windSource = () => DEFAULT_WIND;
let windVersion = 0;
/** Wire the world wind. The integrator passes getSurfaceWind from src/wind.js. */
export function setWindSource(fn) {
  windSource = typeof fn === 'function' ? fn : () => DEFAULT_WIND;
  windVersion++;
}
export function getFlightWind(tSec) {
  let w;
  try { w = windSource(tSec); } catch { w = null; }
  return w && Number.isFinite(w.dirRad) && Number.isFinite(w.speedMps) ? w : DEFAULT_WIND;
}

// ── Deterministic hashing ───────────────────────────────────────────────────
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Uniform [0,1) from (seed, k, salt); integer-only, stable across engines. */
export function hash01(seed, k, salt = 0) {
  let h = (seed ^ Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pickWeighted = (list, u) => { let acc = 0; for (const [v, w] of list) { acc += w; if (u < acc) return v; } return list.at(-1)[0]; };

// ── Geometry helpers ────────────────────────────────────────────────────────
const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) % TAU) + TAU) % TAU; // clockwise from north
const dirOf = b => [Math.sin(b), -Math.cos(b)];
const angDiff = (a, b) => { const d = ((a - b) % TAU + TAU) % TAU; return d > Math.PI ? d - TAU : d; };

// ── Aircraft types (illustrative, never a real type claim) ─────────────────
export const AIRCRAFT_TYPES = Object.freeze({
  heavy:    { length: 60, label: 'Wide-body airliner' },
  narrow:   { length: 43, label: 'Narrow-body airliner' },
  regional: { length: 32, label: 'Regional jet' },
  bizjet:   { length: 23, label: 'Business jet' },
  light:    { length: 10, label: 'Light aircraft' },
  glider:   { length: 8,  label: 'Glider', glider: true },
});

// ── Holding stacks (representative placement near the published beacons) ──
// Scene coordinates from WGS84 via the Trafalgar BNG origin (coordinates.js):
// Bovingdon 51.7261,-0.5500; Lambourne 51.6461,0.1517; Biggin 51.3308,0.0325;
// Ockham 51.3050,-0.4472. A beacon outside or near the edge is pulled inward
// until the whole racetrack is visible.
export const HOLDING_STACKS = Object.freeze({
  BNN: { name: 'Bovingdon', x: -29782, z: -23657 },
  LAM: { name: 'Lambourne', x: 18942, z: -15957 },
  BIG: { name: 'Biggin', x: 11669, z: 19341 },
  OCK: { name: 'Ockham', x: -21688, z: 23027 },
});

// ── Traffic streams: a fixed midday pattern ────────────────────────────────
// period = mean seconds between movements. Heathrow runs segregated mode
// (one runway landing, the other departing), London City a steady regional
// flow, the small airfields an occasional circuit.
export const STREAMS = Object.freeze([
  { id: 'heathrow-arrivals', airport: 'heathrow', kind: 'arrival', period: 90, jitter: 12, fleet: [['heavy', .3], ['narrow', .7]], stacks: ['BNN', 'LAM', 'BIG', 'OCK'] },
  { id: 'heathrow-departures', airport: 'heathrow', kind: 'departure', period: 90, offset: 45, jitter: 12, fleet: [['heavy', .3], ['narrow', .7]], fan: [-100, -50, 45, 95, 160] },
  { id: 'london-city-arrivals', airport: 'london-city', kind: 'arrival', period: 300, offset: 40, jitter: 40, fleet: [['regional', 1]], stacks: ['LAM', 'BIG'] },
  { id: 'london-city-departures', airport: 'london-city', kind: 'departure', period: 300, offset: 190, jitter: 40, fleet: [['regional', 1]], fan: [-60, 40, 150] },
  { id: 'northolt-arrivals', airport: 'northolt', kind: 'arrival', period: 1500, offset: 600, jitter: 200, fleet: [['bizjet', 1]], stacks: ['BNN', 'OCK'] },
  { id: 'northolt-departures', airport: 'northolt', kind: 'departure', period: 1500, offset: 1300, jitter: 200, fleet: [['bizjet', 1]], fan: [-70, 60] },
  { id: 'biggin-hill-circuits', airport: 'biggin-hill', kind: 'circuit', period: 480, offset: 60, jitter: 90, fleet: [['light', 1]] },
  { id: 'elstree-circuits', airport: 'elstree', kind: 'circuit', period: 540, offset: 200, jitter: 100, fleet: [['light', 1]] },
  { id: 'denham-circuits', airport: 'denham', kind: 'circuit', period: 600, offset: 330, jitter: 110, fleet: [['light', 1]] },
  { id: 'stapleford-circuits', airport: 'stapleford', kind: 'circuit', period: 660, offset: 20, jitter: 120, fleet: [['light', 1]] },
  { id: 'damyns-hall-circuits', airport: 'damyns-hall', kind: 'circuit', period: 780, offset: 410, jitter: 130, fleet: [['light', 1]] },
  { id: 'kenley-circuits', airport: 'kenley', kind: 'circuit', period: 720, offset: 500, jitter: 120, fleet: [['glider', 1]] },
]);

// Heathrow: preferred westerly operations (the procession along the Thames),
// switching to easterly only beyond a small tailwind. Segregated runways.
const AIRPORT_OPS = Object.freeze({
  heathrow: { preferred: 27, runways: { 27: { land: '27L', depart: '27R' }, 9: { land: '09L', depart: '09R' } } },
});

/** Runway ends from mapped runways. Each end: the direction an aircraft
 * travels when landing or taking off on that designator. */
export function runwayEnds(site) {
  const ends = [];
  for (const r of site.runways) {
    const p = r.points, a = p[0], b = p.at(-1), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 50) continue;
    const brg = bearingOf(b[0] - a[0], b[1] - a[1]);
    for (const token of String(r.name).split(/[\/-]/)) {
      const n = parseInt(token, 10); if (!Number.isFinite(n)) continue;
      const forward = Math.abs(angDiff(brg, n * 10 * DEG)) < Math.PI / 2;
      const [t, f] = forward ? [a, b] : [b, a];
      const bearing = bearingOf(f[0] - t[0], f[1] - t[1]);
      ends.push({ designator: token.trim(), number: n, runway: r.name, surface: r.surface, threshold: [t[0], t[1]], far: [f[0], f[1]], length: len, bearing, dir: dirOf(bearing) });
    }
  }
  return ends;
}

const headwind = (wind, bearing) => wind.speedMps * Math.cos(angDiff(wind.dirRad, bearing));

/** Which runway ends are in use for landing and departure under this wind. */
export function chooseRunways(site, wind) {
  const ends = runwayEnds(site), ops = AIRPORT_OPS[site.id];
  if (ops) {
    const numbers = Object.keys(ops.runways).map(Number);
    const pref = ops.preferred, prefEnd = ends.find(e => e.number === pref);
    let n = pref;
    if (!prefEnd || headwind(wind, prefEnd.bearing) < -HEADING_TAILWIND_LIMIT_MPS) {
      n = numbers.map(k => [k, headwind(wind, ends.find(e => e.number === k).bearing)]).sort((a, b) => b[1] - a[1])[0][0];
    }
    const cfg = ops.runways[n];
    return { land: ends.find(e => e.designator === cfg.land), depart: ends.find(e => e.designator === cfg.depart), group: n };
  }
  // Single-runway logic: most headwind, paved preferred within a small margin.
  const score = e => headwind(wind, e.bearing) + (/grass/i.test(e.surface) ? 0 : .5);
  const best = [...ends].sort((a, b) => score(b) - score(a) || a.designator.localeCompare(b.designator))[0];
  return { land: best, depart: best, group: best.number };
}

// ── Map edge ────────────────────────────────────────────────────────────────
function createEdge(ring, inset) {
  const pts = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  const cell = 2000, buckets = new Map();
  const key = (i, j) => i * 65536 + j;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const i0 = Math.floor((Math.min(a[0], b[0]) - inset) / cell), i1 = Math.floor((Math.max(a[0], b[0]) + inset) / cell);
    const j0 = Math.floor((Math.min(a[1], b[1]) - inset) / cell), j1 = Math.floor((Math.max(a[1], b[1]) + inset) / cell);
    for (let x = i0; x <= i1; x++) for (let z = j0; z <= j1; z++) { const k = key(x, z); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
  }
  const insideRing = (x, z) => { let hit = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit; } return hit; };
  const nearEdge = (x, z) => {
    const list = buckets.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (!list) return false;
    for (const i of list) {
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < inset) return true;
    }
    return false;
  };
  let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
  // A cell no boundary segment touches (within the inset) is uniformly inside or
  // outside, so one ring test per such cell answers every point in it.
  const uniform = new Map();
  const contains = (x, z) => {
    const i = Math.floor(x / cell), j = Math.floor(z / cell), k = key(i, j);
    if (!buckets.has(k)) { let v = uniform.get(k); if (v === undefined) { v = insideRing((i + .5) * cell, (j + .5) * cell); uniform.set(k, v); } return v; }
    return insideRing(x, z) && !nearEdge(x, z);
  };
  return { ring: pts, inset, centre: [cx, cz], insideRing, contains };
}

// ── Paths ───────────────────────────────────────────────────────────────────
// A path is a list of nodes {x, z, alt (real m above datum) | ground:true, v}
// densified into samples with canonical y, horizontal arc length s and time t.
// Air legs are straight between nodes (turns carry their own arc nodes), so air
// samples can be sparse; ground rolls follow the terrain closely.
function buildPath(nodes, { sample, VE, edge, step = 1000, groundStep = 40, meta = {} }) {
  // Ground nodes take the terrain's altitude, so a climb or flare interpolates
  // from the runway surface rather than from the datum.
  for (const n of nodes) if (n.ground && !Number.isFinite(n.alt)) n.alt = sample(n.x, n.z) / VE;
  const out = [];
  let s = 0, t = 0;
  const push = (x, z, alt, ground, v) => {
    const surfaceY = sample(x, z);
    const y = ground ? surfaceY + GROUND_LIFT : Math.max(alt * VE, surfaceY + GROUND_LIFT);
    if (out.length) {
      const p = out.at(-1), ds = Math.hypot(x - p.x, z - p.z);
      if (ds < 1e-6) return;
      s += ds; t += ds / Math.max(1, (p.v + v) / 2);
    }
    out.push({ x, y, z, s, t, v, ground, alt: y / VE, inside: edge.contains(x, z) });
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (i === 0) { push(n.x, n.z, n.alt, !!n.ground, n.v); continue; }
    const m = nodes[i - 1], len = Math.hypot(n.x - m.x, n.z - m.z);
    const count = Math.max(1, Math.ceil(len / (n.ground && m.ground ? groundStep : step)));
    for (let j = 1; j <= count; j++) {
      const f = j / count;
      const alt = (m.alt ?? 0) + ((n.alt ?? 0) - (m.alt ?? 0)) * f;
      push(m.x + (n.x - m.x) * f, m.z + (n.z - m.z) * f, alt, !!(n.ground && (m.ground || j === count)), m.v + (n.v - m.v) * f);
    }
  }
  return { samples: out, duration: t, length: s, ...meta };
}

function sampleIndexBy(samples, key, value) {
  let lo = 0, hi = samples.length - 1;
  if (value <= samples[0][key]) return 0;
  if (value >= samples[hi][key]) return hi - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid][key] <= value) lo = mid; else hi = mid; }
  return lo;
}
function lerpSample(samples, key, value, out = {}) {
  const i = sampleIndexBy(samples, key, value), a = samples[i], b = samples[Math.min(i + 1, samples.length - 1)];
  const span = b[key] - a[key], f = span > 0 ? Math.max(0, Math.min(1, (value - a[key]) / span)) : 0;
  out.x = a.x + (b.x - a.x) * f; out.y = a.y + (b.y - a.y) * f; out.z = a.z + (b.z - a.z) * f;
  out.s = a.s + (b.s - a.s) * f; out.t = a.t + (b.t - a.t) * f; out.v = a.v + (b.v - a.v) * f;
  out.alt = a.alt + (b.alt - a.alt) * f; out.ground = a.ground && b.ground; out.inside = f < .5 ? a.inside : b.inside;
  return out;
}

function arc(nodes, cx, cz, r, b0, sweep, alt0, alt1, v, steps) {
  // Circle about (cx, cz) by compass bearing from the centre; sweep > 0 clockwise.
  for (let i = 1; i <= steps; i++) {
    const f = i / steps, b = b0 + sweep * f, [dx, dz] = dirOf(b);
    nodes.push({ x: cx + dx * r, z: cz + dz * r, alt: alt0 + (alt1 - alt0) * f, v });
  }
}

/** Glide-path altitude (real metres) at a distance from the aim point. */
export function glidePathAltitude(elevationM, distanceFromAimM) {
  return elevationM + Math.max(0, distanceFromAimM) * Math.tan(GLIDESLOPE_DEG * DEG);
}

const HOLD_TURN_R = 2200;
function racetrackPoints(fx, fz, inbound, leg, r = HOLD_TURN_R) {
  const [ix, iz] = dirOf(inbound), right = [-iz, ix], pts = [[fx, fz]];
  for (let i = 0; i <= 8; i++) { const a = inbound - Math.PI / 2 + Math.PI * i / 8, [dx, dz] = dirOf(a); pts.push([fx + right[0] * r + dx * r, fz + right[1] * r + dz * r]); }
  const ox = fx + right[0] * 2 * r - ix * leg, oz = fz + right[1] * 2 * r - iz * leg;
  for (let i = 0; i <= 8; i++) { const a = inbound + Math.PI / 2 + Math.PI * i / 8, [dx, dz] = dirOf(a); pts.push([ox - right[0] * r + dx * r, oz - right[1] * r + dz * r]); }
  return pts;
}

/** Holding fix: the beacon, pulled towards the map centre until the whole
 * racetrack (inbound towards `towards`) and a margin sit inside the visible map. */
function stackCentre(stack, edge, towards, leg) {
  let x = stack.x, z = stack.z;
  const [cx, cz] = edge.centre, margin = 1200;
  for (let i = 0; i < 120; i++) {
    const inbound = bearingOf(towards[0] - x, towards[1] - z);
    const ok = racetrackPoints(x, z, inbound, leg, HOLD_TURN_R + margin / 2).every(([px, pz]) => edge.contains(px, pz));
    if (ok) break;
    const dx = cx - x, dz = cz - z, d = Math.hypot(dx, dz) || 1;
    x += dx / d * 500; z += dz / d * 500;
  }
  return [x, z];
}

function edgeExit(edge, x, z, b, beyond = 3000) {
  // March from (x,z) along bearing b until outside the visible map, then beyond.
  const [dx, dz] = dirOf(b);
  let d = 0;
  while (d < 120000 && edge.contains(x + dx * d, z + dz * d)) d += 250;
  return [x + dx * (d + beyond), z + dz * (d + beyond)];
}

/** Base-leg join point: 4km beyond the final approach fix, 5km to the side of
 * the extended centreline on which the stack lies. */
function arrivalJoin(end, stack) {
  const [ux, uz] = end.dir, aim = [end.threshold[0] + ux * AIM_POINT_M, end.threshold[1] + uz * AIM_POINT_M];
  const faf = [aim[0] - ux * FINAL_APPROACH_M, aim[1] - uz * FINAL_APPROACH_M];
  const left = [uz, -ux], side = Math.sign((stack.x - faf[0]) * left[0] + (stack.z - faf[1]) * left[1]) || 1;
  return [faf[0] - ux * 4000 + left[0] * side * 5000, faf[1] - uz * 4000 + left[1] * side * 5000];
}

function arrivalNodes({ end, elev, stackXZ, laps, holdAlt, fast }) {
  const [ux, uz] = end.dir, aim = [end.threshold[0] + ux * AIM_POINT_M, end.threshold[1] + uz * AIM_POINT_M];
  const faf = [aim[0] - ux * FINAL_APPROACH_M, aim[1] - uz * FINAL_APPROACH_M];
  const fafAlt = glidePathAltitude(elev, FINAL_APPROACH_M);
  const join = arrivalJoin(end, { x: stackXZ[0], z: stackXZ[1] });
  const holdV = fast ? 115 : 70, finalV = fast ? 75 : 55, touchV = fast ? 70 : 50;
  const nodes = [];
  // Enter from beyond the edge, on the far side of the stack from the airport.
  // The caller moves this first node out beyond the edge along `away`.
  const away = bearingOf(stackXZ[0] - aim[0], stackXZ[1] - aim[1]);
  nodes.push({ x: stackXZ[0], z: stackXZ[1], alt: holdAlt + 300, v: holdV + 10, entry: true });
  nodes.push({ x: stackXZ[0], z: stackXZ[1], alt: holdAlt, v: holdV });
  // Right-hand racetrack: inbound towards the join, 1 minute legs.
  if (laps > 0) {
    const inbound = bearingOf(join[0] - stackXZ[0], join[1] - stackXZ[1]);
    const r = HOLD_TURN_R, leg = holdV * 60, [ix, iz] = dirOf(inbound), right = [-iz, ix];
    for (let lap = 0; lap < laps; lap++) {
      // From the fix turn right onto the outbound leg, fly it, turn right back inbound.
      const c1 = [stackXZ[0] + right[0] * r, stackXZ[1] + right[1] * r];
      arc(nodes, c1[0], c1[1], r, inbound - Math.PI / 2, Math.PI, holdAlt, holdAlt, holdV, 10);
      const outEnd = [nodes.at(-1).x - ix * leg, nodes.at(-1).z - iz * leg];
      nodes.push({ x: outEnd[0], z: outEnd[1], alt: holdAlt, v: holdV });
      const c2 = [outEnd[0] - right[0] * r, outEnd[1] - right[1] * r];
      arc(nodes, c2[0], c2[1], r, inbound + Math.PI / 2, Math.PI, holdAlt, holdAlt, holdV, 10);
      nodes.push({ x: stackXZ[0], z: stackXZ[1], alt: holdAlt, v: holdV });
    }
  }
  nodes.push({ x: join[0], z: join[1], alt: Math.max(fafAlt + 150, Math.min(holdAlt, fafAlt + 450)), v: fast ? 95 : 60 });
  nodes.push({ x: faf[0], z: faf[1], alt: fafAlt, v: finalV + 5, final: true });
  for (let d = FINAL_APPROACH_M - 500; d >= 0; d -= 500) {
    nodes.push({ x: aim[0] - ux * d, z: aim[1] - uz * d, alt: glidePathAltitude(elev, d), v: d > 4000 ? finalV : touchV + (finalV - touchV) * d / 4000 });
  }
  nodes.at(-1).ground = true; nodes.at(-1).touchdown = true;
  const roll = Math.max(200, Math.min(fast ? 1500 : 500, end.length - AIM_POINT_M - 150));
  nodes.push({ x: aim[0] + ux * roll, z: aim[1] + uz * roll, v: 12, ground: true });
  return { nodes, aim, faf, away };
}

function departureNodes({ end, elev, fanDeg, fast }) {
  const [ux, uz] = end.dir, t = end.threshold;
  const rollLen = Math.min(fast ? 1800 : 900, end.length - 150);
  const rotate = fast ? 80 : 60;
  const nodes = [{ x: t[0], z: t[1], v: 2, ground: true }];
  nodes.push({ x: t[0] + ux * rollLen, z: t[1] + uz * rollLen, v: rotate, ground: true, liftoff: true });
  const straight = 4000, gradient = fast ? .08 : .07;
  let alt = elev, along = rollLen;
  alt += (straight - rollLen) * gradient; along = straight;
  nodes.push({ x: t[0] + ux * straight, z: t[1] + uz * straight, alt, v: rotate + 20 });
  // Turn onto the fan bearing, then straight out past the edge.
  const r = 3500, sweep = fanDeg * DEG, sign = Math.sign(sweep) || 1;
  const centre = [nodes.at(-1).x + (sign > 0 ? -uz : uz) * r, nodes.at(-1).z + (sign > 0 ? ux : -ux) * r];
  const b0 = bearingOf(nodes.at(-1).x - centre[0], nodes.at(-1).z - centre[1]);
  const turnLen = Math.abs(sweep) * r, steps = Math.max(2, Math.ceil(Math.abs(fanDeg) / 10));
  if (Math.abs(fanDeg) > 1) { arc(nodes, centre[0], centre[1], r, b0, sweep, alt, alt + turnLen * gradient, rotate + 40, steps); alt += turnLen * gradient; }
  const exitBearing = end.bearing + sweep, [ex, ez] = dirOf(exitBearing), cap = fast ? 4500 : 2400, run = 80000;
  const last = nodes.at(-1);
  nodes.push({ x: last.x + ex * run, z: last.z + ez * run, alt: Math.min(cap, alt + run * gradient), v: fast ? 150 : 110 });
  return { nodes, exitBearing };
}

function circuitNodes({ end, elev, glider }) {
  const [ux, uz] = end.dir, t = end.threshold, left = [uz, -ux];
  const H = glider ? 250 : 300, v = glider ? 28 : 45, wide = glider ? 900 : 1300;
  const at = (along, lateral) => [t[0] + ux * along + left[0] * lateral, t[1] + uz * along + left[1] * lateral];
  const rollLen = Math.min(glider ? 200 : 350, end.length * .6), up = Math.max(end.length, 500) + 900;
  const nodes = [{ x: t[0], z: t[1], v: 2, ground: true }];
  const lift = at(rollLen, 0); nodes.push({ x: lift[0], z: lift[1], v: v * .8, ground: true, liftoff: true });
  const p1 = at(up, 0); nodes.push({ x: p1[0], z: p1[1], alt: elev + H * .7, v });
  const p2 = at(up + 300, wide); nodes.push({ x: p2[0], z: p2[1], alt: elev + H, v });
  const p3 = at(-900, wide); nodes.push({ x: p3[0], z: p3[1], alt: elev + H, v });
  const baseD = 2400, p4 = at(-baseD + 300, wide * .6); nodes.push({ x: p4[0], z: p4[1], alt: glidePathAltitude(elev, baseD + 200), v: v * .95 });
  const p5 = at(-baseD, 0); nodes.push({ x: p5[0], z: p5[1], alt: glidePathAltitude(elev, baseD + AIM_POINT_M * .5), v: v * .9, final: true });
  for (let d = baseD - 400; d >= 0; d -= 400) { const p = at(AIM_POINT_M * .5 - d, 0); nodes.push({ x: p[0], z: p[1], alt: glidePathAltitude(elev, d), v: v * .85 }); }
  nodes.at(-1).ground = true; nodes.at(-1).touchdown = true;
  const stop = at(AIM_POINT_M * .5 + Math.min(300, end.length * .5), 0); nodes.push({ x: stop[0], z: stop[1], v: 6, ground: true });
  return { nodes };
}

// ── Traffic planner (pure; no rendering) ────────────────────────────────────
/** Build the deterministic traffic model. getSurfaceY({x,z}) returns canonical
 * pre-master Y (terrain already x VE). */
export function createTrafficModel({ getSurfaceY, VE = 5, boundary = motorwayData.boundary.points, inset = EDGE_INSET_M, streams = STREAMS, airports = airportData.airports } = {}) {
  if (typeof getSurfaceY !== 'function') throw new Error('Flights require getSurfaceY');
  const sample = (x, z) => { const y = getSurfaceY({ x, z }); return Number.isFinite(y) ? y : 0; };
  const edge = createEdge(boundary, inset);
  const sites = new Map(airports.map(a => [a.id, a]));
  const live = streams.filter(s => sites.has(s.airport)).map(s => ({ ...s, seed: strHash(s.id), site: sites.get(s.airport), offset: s.offset || 0 }));
  const pathCache = new Map();
  const choiceCache = new Map();
  let cacheWindVersion = windVersion;

  function endElevation(end) { return sample(end.threshold[0], end.threshold[1]) / VE; }

  function pathFor(stream, variant) {
    const key = `${stream.id}|${variant.key}`;
    let p = pathCache.get(key);
    if (p) return p;
    const end = variant.end, elev = endElevation(end), fast = stream.kind !== 'circuit';
    let built;
    if (stream.kind === 'arrival') {
      const st = HOLDING_STACKS[variant.stack];
      const holdV = fast ? 115 : 70, towards = arrivalJoin(end, st);
      const stackXZ = stackCentre(st, edge, towards, holdV * 60);
      const r = arrivalNodes({ end, elev, stackXZ, laps: variant.laps, holdAlt: variant.holdAlt, fast });
      // Push the entry node out beyond the edge so aircraft emerge from it.
      const [ox, oz] = edgeExit(edge, stackXZ[0], stackXZ[1], r.away);
      r.nodes[0].x = ox; r.nodes[0].z = oz;
      built = buildPath(r.nodes, { sample, VE, edge, meta: { stackXZ } });
      const td = built.samples.findIndex(s => s.ground);
      built.anchorT = built.samples[td].t;       // touchdown time along the path
      built.aimS = built.samples[td].s;
      built.fafS = built.aimS - FINAL_APPROACH_M;
      built.aim = r.aim; built.elevation = elev;
    } else if (stream.kind === 'departure') {
      const r = departureNodes({ end, elev, fanDeg: variant.fan, fast });
      built = buildPath(r.nodes, { sample, VE, edge });
      trimAfterExit(built);
      built.anchorT = 0; built.elevation = elev;
    } else {
      const r = circuitNodes({ end, elev, glider: variant.model === 'glider' });
      built = buildPath(r.nodes, { sample, VE, edge, step: 300, groundStep: 25 });
      built.anchorT = 0; built.elevation = elev;
    }
    built.end = end;
    pathCache.set(key, built);
    return built;
  }

  function trimAfterExit(path) {
    // Stop evaluating a departure once it has left the visible map for good.
    const s = path.samples; let lastInside = -1;
    for (let i = 0; i < s.length; i++) if (s[i].inside) lastInside = i;
    const cut = Math.min(s.length - 1, lastInside + 5);
    if (lastInside >= 0 && cut < s.length - 1) { path.samples = s.slice(0, cut + 1); path.duration = path.samples.at(-1).t; path.length = path.samples.at(-1).s; }
  }

  function flightVariant(stream, k) {
    if (cacheWindVersion !== windVersion) { choiceCache.clear(); cacheWindVersion = windVersion; }
    const u = i => hash01(stream.seed, k, i);
    const anchor = stream.offset + k * stream.period + (u(1) * 2 - 1) * stream.jitter;
    const ck = `${stream.id}|${k}`;
    let runways = choiceCache.get(ck);
    if (!runways) {
      runways = chooseRunways(stream.site, getFlightWind(anchor));
      if (choiceCache.size > 4000) choiceCache.clear();
      choiceCache.set(ck, runways);
    }
    const model = pickWeighted(stream.fleet, u(2));
    const v = { k, anchor, model, id: `${stream.id}-${k}` };
    if (stream.kind === 'arrival') {
      v.end = runways.land; v.stack = stream.stacks[Math.floor(u(3) * stream.stacks.length)];
      v.laps = Math.floor(u(4) * 3); v.level = Math.floor(u(5) * 4); v.holdAlt = 2130 + v.level * 305;
      v.key = `${v.end.designator}|${v.stack}|${v.laps}|${v.level}|${model === 'bizjet' ? 'b' : 'j'}`;
    } else if (stream.kind === 'departure') {
      v.end = runways.depart; v.fan = stream.fan[Math.floor(u(3) * stream.fan.length)];
      v.key = `${v.end.designator}|${v.fan}`;
    } else {
      v.end = runways.land; v.key = `${v.end.designator}|${model}`;
    }
    return v;
  }

  const MAX_BEFORE = { arrival: 2400, departure: 0, circuit: 0 };
  const MAX_AFTER = { arrival: 150, departure: 1200, circuit: 600 };
  const tmp = {}, tmpA = {}, tmpB = {};

  function stateAt(path, tau, out) {
    lerpSample(path.samples, 't', tau, out);
    out.inside = edge.contains(out.x, out.z); // exact, not the nearest sample's flag
    // Heading and bank from positions either side (rounds polyline corners).
    const d = out.ground ? 30 : 450;
    const a = lerpSample(path.samples, 's', out.s - d, tmpA), b = lerpSample(path.samples, 's', out.s + d, tmpB);
    const hx = b.x - a.x, hz = b.z - a.z;
    out.heading = bearingOf(hx, hz);
    const h0 = bearingOf(out.x - a.x, out.z - a.z), h1 = bearingOf(b.x - out.x, b.z - out.z);
    const dt = Math.max(1e-3, (b.s - a.s) / Math.max(1, out.v));
    const turnRate = (out.s - d > 0 && out.s + d < path.length) ? angDiff(h1, h0) / (dt / 2) : 0;
    out.bank = out.ground ? 0 : Math.max(-.5, Math.min(.5, Math.atan(out.v * turnRate / G)));
    const climb = (b.alt - a.alt) / Math.max(1, b.s - a.s);
    out.pitch = out.ground ? 0 : Math.atan(climb) + 2 * DEG;
    return out;
  }

  /** Every aircraft in the air or on a runway at elapsed time t (seconds). */
  function flightsAt(t, { includeHidden = false } = {}) {
    const list = [];
    for (const stream of live) {
      const before = MAX_BEFORE[stream.kind] + stream.jitter, after = MAX_AFTER[stream.kind] + stream.jitter;
      const k0 = Math.floor((t - after - stream.offset) / stream.period) - 1;
      const k1 = Math.ceil((t + before - stream.offset) / stream.period) + 1;
      for (let k = k0; k <= k1; k++) {
        const v = flightVariant(stream, k);
        const path = pathFor(stream, v);
        const tau = t - v.anchor + path.anchorT;
        if (tau < 0 || tau > path.duration) continue;
        const st = stateAt(path, tau, {});
        if (!st.inside && !includeHidden) continue;
        const type = AIRCRAFT_TYPES[v.model];
        list.push({
          id: v.id, stream: stream.id, kind: stream.kind, airport: stream.site.id, airportName: stream.site.name,
          model: v.model, typeLabel: type.label, length: type.length, runway: v.end.designator, stack: v.stack || null,
          anchor: v.anchor, tau, x: st.x, y: st.y, z: st.z, altM: st.alt, speedMps: st.v, heading: st.heading,
          pitch: st.pitch, bank: st.bank, onGround: st.ground, visible: st.inside,
          onFinal: stream.kind === 'arrival' && st.s >= path.fafS && st.s <= path.aimS,
          distanceToAimM: stream.kind === 'arrival' ? path.aimS - st.s : null, elevationM: path.elevation,
        });
      }
    }
    return list;
  }

  return { flightsAt, edge, chooseRunways: (id, wind) => chooseRunways(sites.get(id), wind), pathFor, flightVariant, streams: live, VE };
}

// ── Hover label: flight-like, never a claim about a real flight ─────────────
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function formatFlightLabel(f) {
  const role = f.kind === 'arrival' ? 'arrival' : f.kind === 'departure' ? 'departure' : 'circuit';
  const where = f.onGround ? (f.kind === 'arrival' ? 'landing roll' : 'take-off roll') : `about ${Math.max(0, Math.round((f.altM - f.elevationM) / 10) * 10)}m above the runway`;
  return `<b>${esc(f.typeLabel)}</b><div class="sub">${esc(f.airportName)} ${role} · runway ${esc(f.runway)}</div>`
    + `<div class="sub">${esc(where)}</div>`
    + `<div class="sub muted">Illustrative traffic pattern, not a real flight</div>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function buildTypeGeometry(model) {
  const type = AIRCRAFT_TYPES[model], scale = type.length / AIRCRAFT_REFERENCE_LENGTH_M, color = new THREE.Color();
  const parts = aircraftParts(type.length, { glider: !!type.glider }).map(([g, mat]) => {
    let geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose();
    geo.deleteAttribute('uv'); if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.scale(scale, scale, scale);
    color.setHex(AIRCRAFT_PALETTE[mat]);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  });
  const merged = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Scene group of flying aircraft. update(dt, camera) advances elapsed time;
 * setElapsed(t) pins it for tests. One InstancedMesh per aircraft type with
 * baked vertex colour (never instanceColor, D-015). */
// Far aircraft are held at a minimum on-screen length so they read as specks in
// the sky rather than vanishing below a pixel (true scale is kept whenever the
// aircraft is larger than this). 0 disables the floor.
export const MIN_ON_SCREEN_PX = 6;

export function createFlights({ getSurfaceY, VE = 5, getHeightScale = () => 1, capacity = 48, model: trafficModel, minPixels = MIN_ON_SCREEN_PX } = {}) {
  const traffic = trafficModel || createTrafficModel({ getSurfaceY, VE });
  const root = new THREE.Group(); root.name = 'flights';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: .05, fog: true });
  const meshes = {};
  for (const model of Object.keys(AIRCRAFT_TYPES)) {
    const mesh = new THREE.InstancedMesh(buildTypeGeometry(model), material, capacity);
    mesh.name = `flights-${model}`; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData = { type: 'flight', model };
    meshes[model] = mesh; root.add(mesh);
  }
  let elapsed = 0, current = [], lastCamera = null, floorPx = minPixels;
  // ── s24:R ── economies, switched on by the app (sprint 24Sep26h, D-038)
  const economies = { ranges: false, skipHidden: false };
  const shown = () => { for (let o = root; o; o = o.parent) if (o.visible === false) return false; return true; };
  // ── /s24:R ──
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), m = new THREE.Matrix4();
  const stats = { flights: 0, visible: 0, drawCalls: Object.keys(meshes).length };

  const viewPos = new THREE.Vector3();
  function focalPx(camera) {
    const h = typeof window === 'undefined' ? 900 : window.innerHeight;
    return camera?.isPerspectiveCamera ? (h / 2) / Math.tan(camera.fov * DEG / 2) : 0;
  }
  function render(camera = lastCamera) {
    if (camera) lastCamera = camera;
    current = traffic.flightsAt(elapsed);
    const k = VE * Math.max(.05, Number(getHeightScale()) || 1);
    const focal = floorPx > 0 && camera?.matrixWorldInverse ? focalPx(camera) : 0;
    const masterRatio = camera?.userData?.masterHeightController?.ratio ?? 1;
    const counts = {};
    for (const key in meshes) counts[key] = 0;
    for (const f of current) {
      const mesh = meshes[f.model], i = counts[f.model];
      if (i >= capacity) continue;
      // Model nose is -z: yaw so -z points along the heading; bank right = right wing down.
      e.set(f.pitch, Math.atan2(-Math.sin(f.heading), Math.cos(f.heading)), -f.bank);
      q.setFromEuler(e); m.makeRotationFromQuaternion(q);
      let grow = 1;
      if (focal > 0) {
        const depth = -viewPos.set(f.x, f.y, f.z).applyMatrix4(camera.matrixWorldInverse).z;
        if (depth > 0) grow = Math.min(40, Math.max(1, floorPx * depth / (f.length * focal)));
      }
      f.displayScale = grow;
      const el = m.elements;
      for (let c = 0; c < 12; c++) el[c] *= grow;
      // World-vertical structure stretch. A far speck keeps true proportions on
      // screen (undoing Master's flattening) so it reads as an aircraft, not a hair.
      const kv = grow > 1 && masterRatio > 0 ? Math.max(k, 1 / masterRatio) : k;
      el[1] *= kv; el[5] *= kv; el[9] *= kv;
      el[12] = f.x; el[13] = f.y; el[14] = f.z;
      mesh.setMatrixAt(i, m); counts[f.model] = i + 1;
    }
    for (const key in meshes) {
      const mesh = meshes[key], was = mesh.count;
      mesh.count = counts[key];
      // ── s24:R ── upload only the live range; an empty mesh that was already
      // empty has nothing to upload (sprint 24Sep26h, D-038).
      if (economies.ranges) {
        if (!mesh.count && !was) continue;
        mesh.instanceMatrix.clearUpdateRanges();
        if (mesh.count) mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      }
      // ── /s24:R ──
      mesh.instanceMatrix.needsUpdate = true;
    }
    stats.flights = current.length; stats.visible = current.length;
  }

  const ndc = new THREE.Vector3(), view = new THREE.Vector3();
  /** Screen-space pick: nearest aircraft whose marker radius covers the pointer. */
  function pick(pointerNdc, camera, rect) {
    if (!camera || !current.length) return null;
    const w = rect?.width || 1, h = rect?.height || 1;
    const focal = camera.isPerspectiveCamera ? (h / 2) / Math.tan(camera.fov * DEG / 2) : h;
    let best = null, bestScore = Infinity;
    for (const f of current) {
      view.set(f.x, f.y + f.length * .1 * VE, f.z).applyMatrix4(camera.matrixWorldInverse);
      if (view.z >= -1) continue;
      ndc.copy(view).applyMatrix4(camera.projectionMatrix);
      const px = (ndc.x - pointerNdc.x) * w / 2, py = (ndc.y - pointerNdc.y) * h / 2, dist = Math.hypot(px, py);
      const radius = Math.max(10, Math.min(80, f.length * (f.displayScale || 1) * .6 * focal / -view.z));
      if (dist <= radius && dist < bestScore) { best = f; bestScore = dist; }
    }
    return best;
  }

  root.userData = {
    update(dt, camera) {
      if (Number.isFinite(dt) && dt > 0) elapsed += dt;
      // ── s24:R ── a hidden fleet keeps its clock but builds no list or matrices
      if (economies.skipHidden && !shown()) { if (camera) lastCamera = camera; stats.skippedHidden = (stats.skippedHidden || 0) + 1; return; }
      // ── /s24:R ──
      render(camera);
    },
    // ── s24:R ──
    setEconomies(next = {}) { for (const k of Object.keys(economies)) if (k in next) economies[k] = !!next[k]; },
    economies,
    // ── /s24:R ──
    setElapsed(t) { elapsed = Number(t) || 0; render(); },
    setMinPixels(px) { floorPx = Math.max(0, Number(px) || 0); render(); },
    get minPixels() { return floorPx; },
    getElapsed: () => elapsed,
    get flights() { return current; },
    flightsAt: (t, opts) => traffic.flightsAt(t, opts),
    // The module's own setter, so dev tooling reaches the same module instance
    // the scene imported (a fresh dynamic import can be a separate HMR copy).
    setWindSource,
    traffic, meshes, stats, pick, formatLabel: formatFlightLabel,
    dispose() { for (const mesh of Object.values(meshes)) { mesh.geometry.dispose(); mesh.dispose?.(); } material.dispose(); root.removeFromParent(); },
  };
  render();
  return root;
}
