// M25 traffic: vehicle classes, layout and near geometry (sprint 23Sep26w,
// D-037 Lane B).
//
// Jordan: the traffic moved "in uniformly patterned groups ... leaving big
// gaps between clusters. We need to spread them into a continuous and
// apparently random order ... three vehicle types: cars, vans, and lorries,
// with five colour variants ... with extreme economy."
//
// Root cause of the platoons (m25-motorway.js before this sprint):
//   cluster = floor(initial/3000)*3000 + (initial%3000)*.4
// squeezed every 3km of evenly spaced vehicles into its first 1.2km.
//
// The replacement is a deterministic renewal process per carriageway:
//  - every vehicle keeps its stable identity (13,622 in total);
//  - consecutive vehicles along a carriageway are separated by a hashed gap:
//    a minimum (half of each vehicle's length, a clearance and the room the
//    speed variation needs) plus a hashed exponential share of the spare
//    length, so spacing is continuous, irregular and never overlapping;
//  - each vehicle carries a small, bounded speed variation (a hashed slow
//    oscillation about the common speed). Its displacement is bounded, so no
//    vehicle ever drives through the one ahead, whatever the elapsed time;
//  - type, colour and lane are hashed from the identity: lorries are a
//    minority and keep to the inside lane; vans lean white.
// Everything is a pure function of (identity, elapsed time), so tests can pin
// any vehicle at any moment. No unseeded randomness.
//
// Colour is never per instance (D-015: the M5 driver mis-binds instanceColor
// and renders black). Each type x colour is its own instanced mesh with the
// colour baked into ordinary vertex colours; far silhouettes are one mesh per
// colour with the type's proportions carried by the instance matrix.

import * as THREE from 'three';

export const TRAFFIC_SPEED_MPS = 2.5;
/** Largest along-road displacement of the speed variation, metres. */
export const TRAFFIC_VARIATION_M = 3;
/** Bumper-to-bumper clearance that always remains, metres. */
export const TRAFFIC_CLEARANCE_M = 2;

// Shares are UK motorway-like (DfT traffic counts put HGVs near a tenth of
// M25 flow and light vans near a sixth); what matters here is the reading:
// mostly cars, a visible scatter of vans, lorries a minority.
export const VEHICLE_TYPES = [
  { id: 'car', share: 0.70, length: 4.4, width: 2.0 },
  { id: 'van', share: 0.18, length: 5.6, width: 2.1 },
  { id: 'lorry', share: 0.12, length: 16.5, width: 2.55 },
];
export const VEHICLE_COLOURS = [
  { id: 'white', hex: 0xe6e6e1 },
  { id: 'silver', hex: 0xa6abae },
  { id: 'black', hex: 0x1c1e21 },
  { id: 'darkBlue', hex: 0x22345a },
  { id: 'red', hex: 0xa3282a },
];
// Colour weights by type (white, silver, black, dark blue, red).
const COLOUR_WEIGHTS = {
  car: [0.20, 0.27, 0.22, 0.17, 0.14],
  van: [0.62, 0.16, 0.08, 0.09, 0.05],
  lorry: [0.55, 0.20, 0.10, 0.10, 0.05],
};

/** Deterministic hash of (id, salt) to [0,1). lowbias32 mixer. */
export function hash01(id, salt = 0) {
  let x = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(salt + 0x632be5ab, 0x85ebca77)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const pick = (u, weights) => {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (u < acc) return i; }
  return weights.length - 1;
};

/** Stable class of a vehicle identity: type and colour indices, lane pick. */
export function vehicleClass(id) {
  const type = pick(hash01(id, 1), VEHICLE_TYPES.map(t => t.share));
  const colour = pick(hash01(id, 2), COLOUR_WEIGHTS[VEHICLE_TYPES[type].id]);
  return { type, colour, lanePick: hash01(id, 3) };
}

/**
 * Lane index for a vehicle on a carriageway of `lanes` lanes. Lane 0 is the
 * inside (nearside) lane: the left of the direction of travel.
 * Lorries: inside lane about four times in five, otherwise the next lane out;
 * never the outside lane of a three-lane or wider road (UK rule for HGVs).
 */
export function laneFor(type, lanePick, lanes) {
  if (lanes <= 1) return 0;
  if (VEHICLE_TYPES[type].id === 'lorry') return lanePick < 0.8 || lanes === 2 ? 0 : 1;
  return Math.min(lanes - 1, Math.floor(lanePick * lanes));
}

/**
 * Cyclic piecewise-linear map from the reference route's chainage to another
 * route's chainage, anchored at the start of every way both routes share. Two
 * directed circuits that differ only at the Dartford bores then agree to the
 * metre on their shared road, so a joint layout never double-books a place.
 */
export function chainageMap(refRoute, route, wayLength) {
  const starts = r => { const m = new Map(); let d = 0; for (const id of r.wayIds) { if (!m.has(id)) m.set(id, d); d += wayLength(id); } return { m, length: d }; };
  const a = starts(refRoute), b = starts(route);
  if (refRoute === route) return { refLength: a.length, length: a.length, map: d => d };
  const pairs = [];
  for (const [id, d] of a.m) if (b.m.has(id)) pairs.push([d, b.m.get(id)]);
  pairs.sort((p, q) => p[0] - q[0]);
  // Keep a monotone chain in both coordinates (drop any out-of-order anchor).
  const chain = [];
  for (const p of pairs) if (!chain.length || p[1] > chain.at(-1)[1]) chain.push(p);
  if (chain.length < 2) throw new Error('Routes share too little road for a joint layout');
  const refs = chain.map(p => p[0]), own = chain.map(p => p[1]), n = chain.length;
  const La = a.length, Lb = b.length;
  function map(d) {
    d = ((d % La) + La) % La;
    let lo = 0, hi = n - 1;
    if (d < refs[0] || d >= refs[n - 1]) {
      // Wrap segment between the last and first anchors.
      const r0 = refs[n - 1], o0 = own[n - 1], r1 = refs[0] + La, o1 = own[0] + Lb;
      const x = d < refs[0] ? d + La : d;
      const v = o0 + (x - r0) * (o1 - o0) / (r1 - r0);
      return ((v % Lb) + Lb) % Lb;
    }
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (refs[m] <= d) lo = m; else hi = m; }
    return own[lo] + (d - refs[lo]) * (own[hi] - own[lo]) / (refs[hi] - refs[lo]);
  }
  return { refLength: La, length: Lb, map };
}

/**
 * Build the joint layout for carriers that share one carriageway direction.
 *
 * @param {Array<{route, count, idOffset}>} carriers  same direction; the first
 *                                                    is the chainage reference
 * @param {(wayId)=>number} wayLength
 * @returns per-carrier { base, amp, omega, phase, type, colour, lanePick, map }
 */
export function buildTrafficLayout(carriers, wayLength) {
  const ref = carriers[0].route;
  const maps = carriers.map(c => chainageMap(ref, c.route, wayLength));
  const L = maps[0].refLength;
  const total = carriers.reduce((n, c) => n + c.count, 0);
  // Interleave identities into one sequence along the carriageway, keeping each
  // carrier's share even along the ring (largest remaining fraction first).
  const taken = carriers.map(() => 0), slots = new Array(total);
  for (let k = 0; k < total; k++) {
    let best = 0, score = -Infinity;
    carriers.forEach((c, j) => { const s = (c.count - taken[j]) / c.count; if (s > score + 1e-12) { score = s; best = j; } });
    slots[k] = [best, taken[best]++];
  }
  const out = carriers.map(c => ({
    base: new Float64Array(c.count), amp: new Float32Array(c.count), omega: new Float32Array(c.count),
    phase: new Float32Array(c.count), type: new Uint8Array(c.count), colour: new Uint8Array(c.count),
    lanePick: new Float32Array(c.count),
  }));
  const ids = slots.map(([j, i]) => carriers[j].idOffset + i);
  const classes = ids.map(vehicleClass);
  const len = classes.map(c => VEHICLE_TYPES[c.type].length);
  const minGap = k => (len[k] + len[(k + 1) % total]) / 2 + TRAFFIC_CLEARANCE_M + 2 * TRAFFIC_VARIATION_M;
  let sumMin = 0, sumE = 0;
  const e = new Float64Array(total);
  for (let k = 0; k < total; k++) {
    sumMin += minGap(k);
    e[k] = -Math.log(1 - hash01(ids[k], 4));
    sumE += e[k];
  }
  const spare = L - sumMin;
  if (!(spare > 0)) throw new Error('Motorway too short for its traffic identities');
  let d = hash01(ids[0] + total, 5) * L;
  for (let k = 0; k < total; k++) {
    const [j, i] = slots[k], id = ids[k], o = out[j], cls = classes[k];
    o.base[i] = d;
    // Bounded speed variation: amplitude up to TRAFFIC_VARIATION_M, period
    // 45-150s, so speed wanders by up to about +/-0.4 m/s around 2.5 m/s.
    o.amp[i] = TRAFFIC_VARIATION_M * (0.35 + 0.65 * hash01(id, 6));
    o.omega[i] = (2 * Math.PI) / (45 + 105 * hash01(id, 7));
    o.phase[i] = 2 * Math.PI * hash01(id, 8);
    o.type[i] = cls.type; o.colour[i] = cls.colour; o.lanePick[i] = cls.lanePick;
    d += minGap(k) + spare * e[k] / sumE;
  }
  out.forEach((o, j) => { o.map = maps[j].map; o.length = maps[j].length; o.refLength = L; });
  return out;
}

/** Route chainage of vehicle i of a laid-out carrier at elapsed time t. */
export function vehicleChainage(layout, i, t) {
  const d = layout.base[i] + TRAFFIC_SPEED_MPS * t + layout.amp[i] * Math.sin(layout.omega[i] * t + layout.phase[i]);
  return layout.map(d);
}

// ── Near geometry: one merged, vertex-coloured body per type x colour ──────
// Local frame: x across, y up (real metres, scaled by VE x Structure through
// the instance matrix), z forward. Origin sits 0.88m above the road, the lift
// the traffic has always used, so instance positions keep their contract.
const LIFT = 0.88;
const GLASS = 0x2a3036, TYRE = 0x2c3136;

function boxes(spec) {
  const pos = [], nor = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const [w, h, l, cx, cy, cz, hex] of spec) {
    const g = new THREE.BoxGeometry(w, h, l);
    g.translate(cx, cy - LIFT, cz);
    // `hex` is one colour, or six per face in BoxGeometry order
    // (+x, -x, +y, -y, +z, -z; four vertices each), so glass and roof can
    // share one box.
    const faces = Array.isArray(hex) ? hex : [hex, hex, hex, hex, hex, hex];
    const base = pos.length / 3, p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) { c.setHex(faces[Math.floor(i / 4)]); col.push(c.r, c.g, c.b); }
    for (const k of g.index.array) idx.push(base + k);
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Merged vertex-coloured geometry for a vehicle type in one body colour. */
export function buildVehicleGeometry(typeId, bodyHex) {
  switch (typeId) {
    case 'car': return boxes([
      [2.0, 0.78, 4.4, 0, 0.73, 0, bodyHex],             // body
      // glasshouse: glass sides, body-coloured roof (what reads from above)
      [1.66, 0.55, 2.2, 0, 1.39, -0.25, [GLASS, GLASS, bodyHex, GLASS, GLASS, GLASS]],
      [2.08, 0.62, 3.2, 0, 0.36, 0, TYRE],               // wheels
    ]);
    case 'van': return boxes([
      [2.1, 1.95, 5.6, 0, 1.33, 0, bodyHex],             // box body
      [2.12, 0.62, 0.9, 0, 1.78, 2.37, [GLASS, GLASS, bodyHex, GLASS, GLASS, GLASS]], // windscreen band
      [2.14, 0.62, 4.0, 0, 0.36, 0, TYRE],
    ]);
    case 'lorry': return boxes([
      // tractor cab with a glazed front face
      [2.5, 2.75, 2.35, 0, 1.95, 7.05, [bodyHex, bodyHex, bodyHex, bodyHex, GLASS, bodyHex]],
      [2.55, 2.95, 13.3, 0, 2.3, -1.4, bodyHex],         // trailer
      [2.54, 0.9, 15.6, 0, 0.48, -0.1, TYRE],            // chassis and axles
    ]);
    default: throw new Error(`Unknown vehicle type ${typeId}`);
  }
}
