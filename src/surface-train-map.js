// Surface trains: the mapping from the underground timetable to the open-air
// track (sprint 30Sep26w, D-041, Lane T). Pure functions, no scene: the
// renderer is src/surface-trains.js; tests/surface-trains.test.mjs runs these
// in node.
//
// THE PROBLEM. A Tube train's position is trains.js trainStateAt(ud, simT): a
// parameter u along a CatmullRom curve through the line's STATIONS (the
// station-chord curve, the same as the tunnel network's bores). Between two
// stations that curve is a smooth chord, not the railway: on the open-air
// Metropolitan it can cut a bend by a few hundred metres. The open-air track is
// Lane R's surface railway (public/data/tube-surface.json, built into paths by
// src/tube-surface-rail.js), which follows the real alignment and, for every
// line but the Elizabeth, covers the whole route, tunnels included.
//
// THE MAPPING (Tube lines). For each curve (one per branch and direction):
//   1. Anchors. Every control point of the curve that is one of the line's
//      stations (within STATION_MATCH_M of a TfL stop of that line; the
//      river hold-down points snapAllTubesToTerrain inserts are not) is an
//      anchor at its own curve parameter u_i (the timetable's stop).
//   2. Track between stations. Each station is placed on the line's track
//      network (nearest track node within STATION_TRACK_M), and consecutive
//      stations are joined by the shortest route over it (A*). The network is
//      the line's own corridors plus every stretch of another line's corridor
//      (Tube or Overground) its colour is laid on as a shared-track band, the
//      pieces joined end to nearest node within JOIN_M. A route much longer or
//      shorter than the chord between the same stations (outside
//      ROUTE_RATIO_MAX / MIN, plus ROUTE_SLACK_M) is refused, and so is a route
//      wholly in tunnel (nothing to draw).
//   3. Progress. Between two stations a train's progress along the route is
//      linear in u: s = s_A + (u - u_A) / (u_B - u_A) x (s_B - s_A), so it
//      runs at constant speed between stations, dwells exactly at each
//      station's place on the track, and is a pure function of u, hence of
//      simT (deterministic, offscreen included, paused and sped up with the
//      shared clock).
//   4. Portals. Every change between tunnel and open track along a route adds
//      an anchor: u_P is the point of the chord curve nearest the portal in
//      plan, so at the moment a surface train's centre reaches the mouth the
//      underground train is at the chord point nearest it. The along-track
//      part of the jump at a portal is therefore zero; what is left is the
//      chord's distance from the portal (cross-track) plus the two lanes'
//      offsets. Anchors that would break monotonicity are dropped (counted).
//   Adjacent intervals join into runs (a continuous polyline with its anchor
//   table); a run ending at a station on open track is extended straight by
//   RUN_END_EXTENSION_M, so a train dwelling at a terminus is drawn whole.
//
// THE MAPPING (DLR). The DLR's curve is not a chord: it is built from the DLR
// profile (dlr-profile.js buildBranch), which follows the mapped track node by
// node and carries the measured decks. Each curve is sampled every
// SNAP_STEP_M and every sample is snapped to the nearest drawn DLR track (its
// own corridors and its shared-track bands, in three dimensions so a flyover
// and the track beneath it are told apart, preferring the piece it was on).
// Where nothing is drawn within SNAP_MAX_M, the curve point itself is used.
//
// THE ERROR BOUND (metres, plan, both train positions as drawn, lanes
// included): measured by mappingErrors() (src/surface-trains.js) over every
// curve of the app, 01Oct26h, bundled route data; the figures per line are in
// docs/surface-trains.md and pinned in tests/surface-trains.spec.js.
//   * At a portal, the moment a train's centre reaches the mouth: Tube at
//     most 490 m (Metropolitan; p95 per line 99 to 413 m), DLR at most 20 m.
//     For the Tube this is the chord curve's own distance from the tunnel
//     mouth (its cross-track error), which no mapping onto the drawn track can
//     remove: the underground train is on the chord. The along-track part is
//     zero by construction (the portal anchor).
//   * Anywhere on open track, the underground train against the surface train
//     at the same moment: Tube at most 848 m (the Chesham branch, where the
//     chord cuts a 6 km curve; p95 per line 80 to 643 m), DLR at most 36 m.
// From above ground neither shows as a jump: only the surface train is drawn
// there (D-040 hides the underground one). From below ground both are drawn,
// and the underground train runs on in its bore while its surface twin runs
// on the track.
//
// No Math.random, no wall clock: everything here is a function of its inputs.
import * as THREE from 'three';

export const PORTAL_ERROR_BOUND_M = { tube: 500, dlr: 25 };
export const TRACK_ERROR_BOUND_M = { tube: 900, dlr: 45 };

export const STATION_MATCH_M = 60;   // curve control point -> TfL stop of the line (Euston's two stop records are 35 to 45 m apart)
export const STATION_TRACK_M = 300;  // station -> nearest node of the line's track (Lane R's surface flag uses the same reach)
export const JOIN_M = 60;            // a piece's end joins the nearest node of another piece (twin collapse leaves junction gaps up to ~32 m)
export const ROUTE_RATIO_MAX = 1.6, ROUTE_RATIO_MIN = 0.6, ROUTE_SLACK_M = 300;
export const RUN_END_EXTENSION_M = 80;
export const SNAP_STEP_M = 10, SNAP_MAX_M = 35, SNAP_KEEP_PIECE_M = 5;
/** A snap clamped onto a segment's end point is taken only this close: past the end of a drawn piece the track the curve is on is not drawn (a data gap, such as Lane R's undrawn 160 m by Pudding Mill Lane), and every sample would pile onto one end point, the train halting and then leaping. */
export const SNAP_PIECE_END_M = 10;
/** A snap more than this far above or below the curve (real metres) is refused: a viaduct sample must not land on a tunnel bored beside it (Tower Gateway, found 01Oct26h). A flyover and the deck beneath it, 4 to 5 m apart, stay within reach and are told apart by the score. */
export const SNAP_MAX_RISE_M = 8;
/** Lateral offset of each running line from the corridor's centreline, left-hand running (the Overground's own, overground-trains.js). */
export const LANE_OFFSET_M = 2.6;
/**
 * Shared corridors. Lane R draws track two lines share as ONE corridor with
 * both colours side by side. On the Overground's corridors the Tube line
 * really runs on the Overground's rails (the Bakerloo on the Lioness, the
 * District on the Mildmay), so its trains keep the Overground's lanes. On a
 * Tube owner's corridor the lines are often separate pairs of a four-track
 * railway (the Metropolitan beside the Jubilee, the District beside the
 * Piccadilly, the DLR beside the Jubilee to Stratford): there each line after
 * the owner runs LANE_SPACING_M further out per band, so two lines' trains
 * side by side do not merge (found 01Oct26h, a Metropolitan and a Jubilee train
 * drawn as one). The extra offset eases in and out at LANE_EASE (lateral metres
 * per metre along) beyond the band's ends, so no car jumps sideways.
 */
export const LANE_SPACING_M = 3.4, LANE_EASE = 1 / 15;
/**
 * Steepest grade a run's track lift (height above the ground under it) may
 * change at, real metres per metre. Within a corridor Lane R's earthwork taper
 * holds 4%, but a route crosses junctions from one drawn piece to another, and
 * there a ground-level piece can meet the end of a viaduct piece 8 m up (the
 * drawn deck simply ends): a car spanning that hop stood at up to 64 degrees
 * (the Piccadilly by Acton Town, found 01Oct26h). The lower side is raised to
 * this grade, as the real railway climbs on an embankment the drawn ground
 * piece does not show.
 */
export const RUN_MAX_LIFT_GRADE = 0.12;

// ── Rolling stock (sourced) ─────────────────────────────────────────────────
// Dimensions over couplers, width over body, height rail to roof, from the
// Wikipedia infoboxes (retrieved 01Oct26h): London Underground S7 and S8
// Stock, 1972 Stock, 1992 Stock, 1995 Stock, 1996 Stock, 1973 Stock, and
// Docklands Light Railway B07 Stock. The S Stock infobox gives no height; the
// figure used is the sub-surface loading gauge height of the C69/C77 stock it
// replaced on the same lines (3.68 m, London Underground C69 and C77 Stock),
// flagged `heightFromGauge`. Cars are spaced evenly over the sourced train
// length (CAR_GAP_M between bodies); the S Stock's longer driving cars are
// kept (2 x 18.139 m plus 16.234 m middle cars, which sum to the train).
export const CAR_GAP_M = 0.6;
export const PROFILES = {
  // Half profiles, rail head at y = 0, from the body's foot to the roof centre (metres).
  // deep: the small tube profile, sides curving in to fit a 3.56 m bore.
  deep: { widthM: 2.63, heightM: 2.88, half: [[1.315, 0.30], [1.315, 1.45], [1.29, 1.80], [1.21, 2.15], [1.06, 2.45], [0.83, 2.68], [0.52, 2.83], [0, 2.88]], roofHalfM: 0.55, windows: [1.0, 1.9] },
  // subsurface: the S Stock, full-height straight sides, rounded cant rail.
  subsurface: { widthM: 2.92, heightM: 3.68, half: [[1.46, 0.35], [1.46, 2.80], [1.43, 3.10], [1.33, 3.36], [1.13, 3.56], [0.80, 3.66], [0, 3.68]], roofHalfM: 0.95, windows: [1.35, 2.35] },
  // dlr: the B07 articulated unit.
  dlr: { widthM: 2.65, heightM: 3.51, half: [[1.325, 0.40], [1.325, 2.75], [1.30, 3.05], [1.20, 3.30], [0.98, 3.46], [0.60, 3.51], [0, 3.51]], roofHalfM: 0.75, windows: [1.35, 2.45] },
};
export const STOCK = {
  S8: { name: 'S8 Stock', profile: 'subsurface', cars: [18.139, 16.234, 16.234, 16.234, 16.234, 16.234, 16.234, 18.139], trainM: 133.682, widthM: 2.92, heightM: 3.68, heightFromGauge: true },
  S7: { name: 'S7 Stock', profile: 'subsurface', cars: [18.139, 16.234, 16.234, 16.234, 16.234, 16.234, 18.139], trainM: 117.448, widthM: 2.92, heightM: 3.68, heightFromGauge: true },
  '1972': { name: '1972 Stock', profile: 'deep', carCount: 7, trainM: 113.552, widthM: 2.641, heightM: 2.875 },
  '1992': { name: '1992 Stock', profile: 'deep', carCount: 8, trainM: 8 * 16.25, widthM: 2.62, heightM: 2.87 },
  '1992-wc': { name: '1992 Stock', profile: 'deep', carCount: 4, trainM: 4 * 16.25, widthM: 2.62, heightM: 2.87 },
  '1996': { name: '1996 Stock', profile: 'deep', carCount: 7, trainM: 126.492, widthM: 2.629, heightM: 2.875 },
  '1995': { name: '1995 Stock', profile: 'deep', carCount: 6, trainM: 108.472, widthM: 2.630, heightM: 2.875 },
  '1973': { name: '1973 Stock', profile: 'deep', carCount: 6, trainM: 106.810, widthM: 2.629, heightM: 2.888 },
  // Two-section articulated units, 28 m over couplers, three to a train.
  B07: { name: 'B07 Stock', profile: 'dlr', units: 3, unitM: 28, sectionsPerUnit: 2, articulationGapM: 0.3, trainM: 84, widthM: 2.65, heightM: 3.51 },
};
/** The stock each line runs (the Victoria's 2009 Stock is not listed: the line has no open air). */
export const LINE_STOCK = {
  metropolitan: 'S8', district: 'S7', circle: 'S7', 'hammersmith-city': 'S7',
  bakerloo: '1972', central: '1992', 'waterloo-city': '1992-wc', jubilee: '1996', northern: '1995', piccadilly: '1973',
  dlr: 'B07',
};

/** Car (or articulated section) centres and body lengths along the train, centred on its middle (metres). */
export function carLayout(stock) {
  const out = [];
  if (stock.units) {
    const sec = (stock.unitM - CAR_GAP_M - stock.articulationGapM) / stock.sectionsPerUnit;
    for (let k = 0; k < stock.units; k++) {
      const uc = (k - (stock.units - 1) / 2) * stock.unitM;
      for (let j = 0; j < stock.sectionsPerUnit; j++) out.push({ offset: uc + (j - (stock.sectionsPerUnit - 1) / 2) * (sec + stock.articulationGapM), length: sec });
    }
    return out;
  }
  const pitches = stock.cars ?? new Array(stock.carCount).fill(stock.trainM / stock.carCount);
  let at = -pitches.reduce((a, b) => a + b, 0) / 2;
  for (const p of pitches) { out.push({ offset: at + p / 2, length: p - CAR_GAP_M }); at += p; }
  return out;
}

// ── Geometry (real metres; rail head at y = 0; unit length along z) ─────────
function profileBody(profile) {
  const right = profile.half, left = right.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
  const ring = [...right, ...left]; // closed: last left point joins the first right point along the floor
  const pos = [];
  const quad = (a, b, z0, z1) => { pos.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1); };
  // The ring runs anticlockwise seen from +z (up the right side, down the left,
  // back along the floor), so a -> b with z rising faces outward. (Fixed
  // 01Oct26h: b -> a wound every side wall inward, and front-face culling
  // showed the inside of the far wall instead of the outside of the near one.)
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; quad(a, b, -0.5, 0.5); }
  const cx = 0, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    pos.push(cx, cy, 0.5, a[0], a[1], 0.5, b[0], b[1], 0.5);   // front cap
    pos.push(cx, cy, -0.5, b[0], b[1], -0.5, a[0], a[1], -0.5); // back cap
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function halfWidthAt(profile, y) {
  const h = profile.half;
  for (let i = 1; i < h.length; i++) if (y <= h[i][1]) { const t = (y - h[i - 1][1]) / ((h[i][1] - h[i - 1][1]) || 1); return h[i - 1][0] + (h[i][0] - h[i - 1][0]) * Math.max(0, Math.min(1, t)); }
  return h[h.length - 1][0];
}
export function profileGeometries(profile) {
  const body = profileBody(profile);
  const roof = new THREE.BoxGeometry(2 * profile.roofHalfM, 0.1, 0.96).translate(0, profile.heightM - 0.04, 0);
  const [w0, w1] = profile.windows;
  const windows = new THREE.BoxGeometry(2 * (halfWidthAt(profile, (w0 + w1) / 2) + 0.035), w1 - w0, 0.82).translate(0, (w0 + w1) / 2, 0);
  return { body, roof, windows };
}

// ── Track network ───────────────────────────────────────────────────────────
// pieces: [{ pts: [{x, z, terrainY, y, cls}], morph }]. `y` is canonical (VE5
// lifts, drawn through the rail morph: y' = base + (y - base) x ratio above
// the terrain, untouched below it) when morph is true, or already at the
// current structure scale when false (the DLR's own corridors).
export function buildNetwork(pieces, { joinM = JOIN_M, cell = 100 } = {}) {
  let n = 0;
  for (const p of pieces) n += p.pts.length;
  const x = new Float64Array(n), z = new Float64Array(n), base = new Float64Array(n), y0 = new Float64Array(n);
  const morph = new Uint8Array(n), open = new Uint8Array(n), piece = new Int32Array(n), slope = new Float64Array(n), extra = new Float64Array(n);
  const adj = Array.from({ length: n }, () => []);
  const ends = [];
  let k = 0;
  pieces.forEach((p, pi) => {
    const first = k;
    for (const s of p.pts) {
      x[k] = s.x; z[k] = s.z; base[k] = s.terrainY; y0[k] = s.y; morph[k] = p.morph ? 1 : 0;
      open[k] = s.cls === 'tunnel' ? 0 : 1; piece[k] = pi; extra[k] = p.laneExtra || 0;
      if (k > first) { const d = Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]); adj[k].push(k - 1, d); adj[k - 1].push(k, d); }
      k++;
    }
    if (k - first >= 1) ends.push(first, k - 1);
  });
  const grid = new Map(), key = (cx, cz) => `${cx},${cz}`;
  for (let i = 0; i < n; i++) { const g = key(Math.floor(x[i] / cell), Math.floor(z[i] / cell)); if (!grid.has(g)) grid.set(g, []); grid.get(g).push(i); }
  const net = { n, x, z, base, y0, morph, open, piece, slope, extra, adj, grid, cell, pieces: pieces.length, joins: 0 };
  // Junctions: each piece end to the nearest node of every other piece within joinM.
  for (const e of ends) {
    const best = new Map(); // piece -> [node, d]
    forNear(net, x[e], z[e], joinM, i => {
      if (piece[i] === piece[e]) return;
      const d = Math.hypot(x[i] - x[e], z[i] - z[e]);
      if (d <= joinM && (!best.has(piece[i]) || d < best.get(piece[i])[1])) best.set(piece[i], [i, d]);
    });
    for (const [i, d] of best.values()) { adj[e].push(i, Math.max(d, 1e-3)); adj[i].push(e, Math.max(d, 1e-3)); net.joins++; }
  }
  net.hasOpen = open.some(v => v === 1);
  return net;
}

function forNear(net, px, pz, r, fn) {
  const c = net.cell, cx = Math.floor(px / c), cz = Math.floor(pz / c), R = Math.ceil(r / c);
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (const i of net.grid.get(`${cx + dx},${cz + dz}`) || []) fn(i);
}

/** Nearest network node to (x, z) within maxM, or -1. */
export function nearestNode(net, px, pz, maxM) {
  let best = -1, bd = Infinity;
  forNear(net, px, pz, maxM, i => { const d = Math.hypot(net.x[i] - px, net.z[i] - pz); if (d < bd) { bd = d; best = i; } });
  return bd <= maxM ? best : -1;
}

/**
 * The terrain's cross-slope at each node, across its piece (rise per metre to
 * the piece's left, the side offsetRails calls left). The rail morph
 * (surface-rail.js createRailMorph) pivots each vertex on the terrain under
 * THAT vertex, so off the centreline the drawn stripe's height is
 * r x y0 + (1 - r) x terrain there; a car in its lane, 2.6 m out, is placed
 * the same way (sampleRun's `lateral`), so it rides the stripe at every Master
 * however the ground slopes across the track. Measured before this: a Central
 * line car 1.5 m off the stripe at Master 10 on a cross-slope.
 */
export function computeCrossSlopes(net, getY, half = LANE_OFFSET_M) {
  for (let i = 0; i < net.n; i++) {
    if (!net.morph[i]) { net.slope[i] = 0; continue; }
    const a = i > 0 && net.piece[i - 1] === net.piece[i] ? i - 1 : i, b = i + 1 < net.n && net.piece[i + 1] === net.piece[i] ? i + 1 : i;
    let nx = -(net.z[b] - net.z[a]), nz = net.x[b] - net.x[a];
    const len = Math.hypot(nx, nz);
    if (!(len > 0)) { net.slope[i] = 0; continue; }
    nx /= len; nz /= len;
    const yl = getY({ x: net.x[i] + nx * half, z: net.z[i] + nz * half }), yr = getY({ x: net.x[i] - nx * half, z: net.z[i] - nz * half });
    net.slope[i] = Number.isFinite(yl) && Number.isFinite(yr) ? (yl - yr) / (2 * half) : 0;
  }
  return net;
}

/** Shortest route between two nodes (A* on plan length), bounded by maxCost; node indices or null. */
export function route(net, from, to, maxCost = Infinity) {
  if (from === to) return [from];
  const st = net._astar ??= { g: new Float64Array(net.n), prev: new Int32Array(net.n), stamp: new Int32Array(net.n), gen: 0, closed: new Int32Array(net.n) };
  const gen = ++st.gen, { g, prev, stamp, closed } = st;
  const hx = net.x[to], hz = net.z[to], h = i => Math.hypot(net.x[i] - hx, net.z[i] - hz);
  const heapN = [], heapF = [];
  const push = (i, f) => { let j = heapN.length; heapN.push(i); heapF.push(f); while (j > 0) { const p = (j - 1) >> 1; if (heapF[p] <= f) break; heapN[j] = heapN[p]; heapF[j] = heapF[p]; j = p; } heapN[j] = i; heapF[j] = f; };
  const pop = () => { const top = heapN[0], ln = heapN.pop(), lf = heapF.pop(); if (heapN.length) { let j = 0; const m = heapN.length; for (;;) { let c = 2 * j + 1; if (c >= m) break; if (c + 1 < m && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lf) break; heapN[j] = heapN[c]; heapF[j] = heapF[c]; j = c; } heapN[j] = ln; heapF[j] = lf; } return top; };
  stamp[from] = gen; g[from] = 0; prev[from] = -1; push(from, h(from));
  while (heapN.length) {
    const i = pop();
    if (closed[i] === gen) continue;
    closed[i] = gen;
    if (i === to) break;
    const a = net.adj[i];
    for (let q = 0; q < a.length; q += 2) {
      const j = a[q], ng = g[i] + a[q + 1];
      if (ng > maxCost) continue;
      if (stamp[j] !== gen || ng < g[j]) { stamp[j] = gen; g[j] = ng; prev[j] = i; push(j, ng + h(j)); }
    }
  }
  if (stamp[to] !== gen) return null;
  const out = [];
  for (let i = to; i >= 0; i = prev[i]) { out.push(i); if (i === from) break; }
  out.reverse();
  return out[0] === from ? out : null;
}

// ── Runs ──────────────────────────────────────────────────────────────────────
/** Drawn rail-head height of a network or run vertex at structure ratio. */
export function drawnY(y0, base, morph, ratio) { return morph && y0 >= base ? base + (y0 - base) * ratio : y0; }

class RunBuilder {
  constructor() { this.x = []; this.z = []; this.base = []; this.y0 = []; this.morph = []; this.open = []; this.slope = []; this.extra = []; this.cum = []; this.au = []; this.as = []; this.portal = []; this.station = []; }
  get length() { return this.cum.length ? this.cum[this.cum.length - 1] : 0; }
  vertex(x, z, base, y0, morph, open, slope = 0, extra = 0) {
    const n = this.x.length;
    const s = n ? this.cum[n - 1] + Math.hypot(x - this.x[n - 1], z - this.z[n - 1]) : 0;
    this.x.push(x); this.z.push(z); this.base.push(base); this.y0.push(y0); this.morph.push(morph); this.open.push(open); this.slope.push(slope); this.extra.push(extra); this.cum.push(s);
    return s;
  }
  /** A network node; `along` is +1 where the route runs the way its piece does, -1 against (the piece's left is then the run's right). */
  node(net, i, along = 1) { return this.vertex(net.x[i], net.z[i], net.base[i], net.y0[i], net.morph[i], net.open[i], net.slope[i] * along, net.extra[i]); }
  anchor(u, s, kind) {
    const k = this.au.length;
    if (k && !(u > this.au[k - 1] && s >= this.as[k - 1])) { if (u === this.au[k - 1] && s === this.as[k - 1]) return true; return false; }
    this.au.push(u); this.as.push(s); this.portal.push(kind === 'portal' ? 1 : 0); this.station.push(kind === 'station' ? 1 : 0);
    return true;
  }
  /**
   * ramp: what RUN_MAX_LIFT_GRADE limits (canonical VE5 units, 5 per real metre, for every run).
   *   'lift'     the track's height above the ground under it: Tube runs, whose lift changes only with
   *              the earthwork class (Lane R's 4% taper), so only a hop between pieces trips it;
   *   'absolute' the rail's own height: DLR runs, whose deck the profile grade-limits in absolute
   *              height (8%, dlr-profile.js), level over dips in the ground, where the lift jumps.
   */
  build(meta = {}, { ramp = 'lift' } = {}) {
    const f = a => Float64Array.from(a), b = a => Uint8Array.from(a);
    // Grade-limit across junction hops (RUN_MAX_LIFT_GRADE), on open track only, raising the lower side.
    const y0 = f(this.y0), g = RUN_MAX_LIFT_GRADE * 5, cc = this.cum, op = this.open, bs = ramp === 'lift' ? this.base : this.base.map(() => 0);
    const L = Array.from(y0, (v, i) => v - bs[i]);
    for (let i = 1; i < L.length; i++) if (op[i] && op[i - 1]) L[i] = Math.max(L[i], L[i - 1] - g * (cc[i] - cc[i - 1]));
    for (let i = L.length - 2; i >= 0; i--) if (op[i] && op[i + 1]) L[i] = Math.max(L[i], L[i + 1] - g * (cc[i + 1] - cc[i]));
    for (let i = 0; i < L.length; i++) if (op[i]) y0[i] = bs[i] + L[i];
    // Ease the shared-corridor lane offset in and out (LANE_EASE), outward of each band's ends.
    const e = f(this.extra), c = this.cum;
    for (let i = 1; i < e.length; i++) e[i] = Math.max(e[i], e[i - 1] - LANE_EASE * (c[i] - c[i - 1]));
    for (let i = e.length - 2; i >= 0; i--) e[i] = Math.max(e[i], e[i + 1] - LANE_EASE * (c[i + 1] - c[i]));
    return { x: f(this.x), z: f(this.z), base: f(this.base), y0, morph: b(this.morph), open: b(this.open), slope: f(this.slope), extra: e, cum: f(this.cum),
      au: f(this.au), as: f(this.as), portal: b(this.portal), station: b(this.station), u0: this.au[0], u1: this.au[this.au.length - 1], length: this.length, ...meta };
  }
}

/** Walk `len` metres from node `from` along its piece, away from `toward` (the route's next node): node indices with the distance reached, or null where `from` is not on the same piece as `toward`. */
function walkAway(net, from, toward, len) {
  if (toward < 0 || net.piece[toward] !== net.piece[from] || Math.abs(toward - from) !== 1) return null;
  const step = from - toward, out = [];
  let i = from, d = 0;
  while (d < len) {
    const j = i + step;
    if (j < 0 || j >= net.n || net.piece[j] !== net.piece[from]) break;
    d += Math.hypot(net.x[j] - net.x[i], net.z[j] - net.z[i]);
    out.push({ i: j, d });
    i = j;
  }
  return out;
}

/**
 * Extend a run's ends that are stations on open track (a terminus, or a
 * station whose next interval is not mapped), so a train dwelling there is
 * drawn whole: along the drawn track where it carries on, straight on from the
 * last segment for whatever is left.
 */
function extendEnds(r, getY, len, net = null, ends = null) {
  const n = r.x.length; if (n < 2) return r;
  const vert = (i, along = 1) => ({ x: net.x[i], z: net.z[i], base: net.base[i], y0: net.y0[i], morph: net.morph[i], open: net.open[i], slope: net.slope[i] * along, extra: net.extra[i] });
  const straight = (from, prev, dist) => { // from vertex `from` (a {x,z,...}) away from `prev`, dist metres
    const dx = from.x - prev.x, dz = from.z - prev.z, d = Math.hypot(dx, dz) || 1;
    const x = from.x + dx / d * dist, z = from.z + dz / d * dist;
    const base = getY ? getY({ x, z }) : from.base;
    const b = Number.isFinite(base) ? base : from.base;
    return { x, z, base: b, y0: b + (from.y0 - from.base), morph: from.morph, open: from.open, slope: from.slope, extra: from.extra };
  };
  const runVert = i => ({ x: r.x[i], z: r.z[i], base: r.base[i], y0: r.y0[i], morph: r.morph[i], open: r.open[i], slope: r.slope?.[i] ?? 0, extra: r.extra?.[i] ?? 0 });
  const extension = (endIdx, nextIdx, nodes, atStart) => { // vertices beyond the end, nearest first
    const out = [];
    const walk = net && nodes ? walkAway(net, nodes[0], nodes[1], len) : null;
    let last = runVert(endIdx), prev = runVert(nextIdx), done = 0;
    if (walk) {
      // The walk steps through the piece by (nodes[0] - nodes[1]); appended at the end the run
      // follows that order, prepended at the start it runs against it (the slope's sign follows).
      const along = Math.sign(nodes[0] - nodes[1]) * (atStart ? -1 : 1);
      for (const w of walk) { prev = last; last = vert(w.i, along); out.push(last); done = w.d; }
    }
    if (done < len - 1e-6) out.push(straight(last, prev, len - done));
    return out;
  };
  const out = new RunBuilder();
  const startExt = r.open[0] && r.station[0] ? extension(0, 1, ends?.first, true) : [];
  const endExt = r.open[n - 1] && r.station[r.station.length - 1] ? extension(n - 1, n - 2, ends?.last, false) : [];
  for (const v of [...startExt].reverse()) out.vertex(v.x, v.z, v.base, v.y0, v.morph, v.open, v.slope, v.extra);
  let shift = 0; // where the run's own first vertex lands, past the start extension
  for (let i = 0; i < n; i++) { const sv = out.vertex(r.x[i], r.z[i], r.base[i], r.y0[i], r.morph[i], r.open[i], r.slope?.[i] ?? 0, r.extra?.[i] ?? 0); if (i === 0) shift = sv; }
  for (const v of endExt) out.vertex(v.x, v.z, v.base, v.y0, v.morph, v.open, v.slope, v.extra);
  for (let k = 0; k < r.au.length; k++) out.anchor(r.au[k], r.as[k] + shift, r.portal[k] ? 'portal' : r.station[k] ? 'station' : null);
  return out.build({ extendedStart: startExt.length > 0, extendedEnd: endExt.length > 0 });
}

/** Nearest curve parameter in [ua, ub] to plan point (px, pz): sampled every ~stepM then refined on the bracketing chords. */
export function projectOnCurve(curve, px, pz, ua, ub, { stepM = 8, length = curve.getLength(), tmp = null } = {}) {
  const n = Math.max(4, Math.min(2000, Math.ceil((ub - ua) * length / stepM)));
  const p = tmp ?? { x: 0, y: 0, z: 0 };
  const P = (u, o) => { const v = curve.getPointAt(Math.min(1, Math.max(0, u))); o.x = v.x; o.z = v.z; return o; };
  let best = 0, bd = Infinity; const xs = new Float64Array(n + 1), zs = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { P(ua + (ub - ua) * i / n, p); xs[i] = p.x; zs[i] = p.z; const d = Math.hypot(p.x - px, p.z - pz); if (d < bd) { bd = d; best = i; } }
  let bu = ua + (ub - ua) * best / n, bdist = bd;
  for (const [i, j] of [[best - 1, best], [best, best + 1]]) {
    if (i < 0 || j > n) continue;
    const vx = xs[j] - xs[i], vz = zs[j] - zs[i], t = Math.max(0, Math.min(1, ((px - xs[i]) * vx + (pz - zs[i]) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(px - xs[i] - vx * t, pz - zs[i] - vz * t);
    if (d < bdist) { bdist = d; bu = ua + (ub - ua) * (i + t) / n; }
  }
  return { u: bu, d: bdist };
}

/**
 * Map one Tube curve onto its line's track network.
 * stations: [{key, x, z}] of the line (TfL stops, scene metres).
 * cache: per network {routes: Map, stationNode: Map} shared by every curve of the line.
 * Returns { runs, stats }.
 */
export function mapTubeCurve({ curve, stationUs, stations, net, cache, getY = null, extendM = RUN_END_EXTENSION_M }) {
  const stats = { anchors: 0, intervals: 0, mapped: 0, tunnelOnly: 0, offTrack: 0, noRoute: 0, implausible: 0, portals: 0, portalsDropped: 0 };
  const runs = [];
  if (!net?.hasOpen || !curve?.points?.length) return { runs, stats };
  const L = curve.getLength();
  const anchors = [];
  // A stop's u is its control point's share of the polyline length (main.js
  // stationUsFromPolyline). stationUs is NOT one per control point when the
  // branch carries _stationIndices (the District's Fulham bridge points, the
  // DLR), so each stop finds its control point by that same fraction.
  const pts = curve.points, frac = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) frac[i] = frac[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  const total = frac[pts.length - 1] || 1;
  for (let i = 0; i < pts.length; i++) frac[i] /= total;
  for (const u of stationUs) {
    if (!Number.isFinite(u)) continue;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frac[m] <= u) lo = m; else hi = m; }
    const p = Math.abs(frac[lo] - u) <= Math.abs(frac[hi] - u) ? pts[lo] : pts[hi];
    let best = null, bd = STATION_MATCH_M;
    for (const s of stations) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d <= bd) { bd = d; best = s; } }
    if (!best) continue;
    const last = anchors[anchors.length - 1];
    if (last && (last.st.key === best.key || u <= last.u)) continue;
    anchors.push({ u, st: best });
  }
  stats.anchors = anchors.length;
  const nodeOf = st => {
    if (!cache.stationNode.has(st.key)) cache.stationNode.set(st.key, nearestNode(net, st.x, st.z, STATION_TRACK_M));
    return cache.stationNode.get(st.key);
  };
  let cur = null, curEnd = -1, curU = NaN, ends = null;
  const flush = () => { if (cur && cur.au.length >= 2) runs.push(extendM > 0 ? extendEnds(cur.build(), getY, extendM, net, ends) : cur.build()); cur = null; curEnd = -1; ends = null; };
  for (let k = 0; k + 1 < anchors.length; k++) {
    const A = anchors[k], B = anchors[k + 1];
    stats.intervals++;
    const na = nodeOf(A.st), nb = nodeOf(B.st);
    if (na < 0 || nb < 0) { stats.offTrack++; flush(); continue; }
    const Lc = (B.u - A.u) * L;
    const rk = `${na}>${nb}`;
    let path = cache.routes.get(rk);
    if (path === undefined) { path = route(net, na, nb, ROUTE_RATIO_MAX * Lc + ROUTE_SLACK_M + 1); cache.routes.set(rk, path); }
    if (!path) { stats.noRoute++; flush(); continue; }
    let Lr = 0; for (let j = 1; j < path.length; j++) Lr += Math.hypot(net.x[path[j]] - net.x[path[j - 1]], net.z[path[j]] - net.z[path[j - 1]]);
    if (Lr > ROUTE_RATIO_MAX * Lc + ROUTE_SLACK_M || Lr < ROUTE_RATIO_MIN * Lc - ROUTE_SLACK_M) { stats.implausible++; flush(); continue; }
    if (!path.some(i => net.open[i])) { stats.tunnelOnly++; flush(); continue; }
    stats.mapped++;
    // Continue the current run if it ended at this interval's first station.
    // Which way the route runs along each node's piece (consecutive node indices within a piece).
    const along = j => { const i = path[j], nx = path[j + 1], pv = path[j - 1];
      if (nx !== undefined && net.piece[nx] === net.piece[i] && Math.abs(nx - i) === 1) return nx > i ? 1 : -1;
      if (pv !== undefined && net.piece[pv] === net.piece[i] && Math.abs(i - pv) === 1) return i > pv ? 1 : -1;
      return 1; };
    if (!(cur && curEnd === na && curU === A.u)) { flush(); cur = new RunBuilder(); cur.node(net, path[0], along(0)); cur.anchor(A.u, 0, 'station'); ends = { first: [path[0], path[1] ?? -1] }; }
    ends.last = [path[path.length - 1], path.length > 1 ? path[path.length - 2] : -1];
    const s0 = cur.length;
    let s = s0;
    for (let j = 1; j < path.length; j++) {
      const a = path[j - 1], b = path[j];
      if (net.open[a] !== net.open[b]) {
        // A portal between a and b: its place on the route and on the chord.
        const mx = (net.x[a] + net.x[b]) / 2, mz = (net.z[a] + net.z[b]) / 2;
        const sp = s + Math.hypot(mx - net.x[a], mz - net.z[a]);
        const pu = projectOnCurve(curve, mx, mz, A.u, B.u, { length: L });
        stats.portals++;
        if (!(pu.u > A.u && pu.u < B.u) || !cur.anchor(pu.u, sp, 'portal')) stats.portalsDropped++;
      }
      s = cur.node(net, b, along(j));
    }
    cur.anchor(B.u, s, 'station'); // portal anchors lie strictly inside (A.u, B.u), so this always holds
    curEnd = nb; curU = B.u;
  }
  flush();
  return { runs, stats };
}

/** Segment index for DLR snapping: every consecutive node pair within a piece. */
export function buildSegmentIndex(net, cell = 50) {
  const grid = new Map(), segs = [];
  for (let i = 0; i + 1 < net.n; i++) {
    if (net.piece[i] !== net.piece[i + 1]) continue;
    const k = segs.length; segs.push(i);
    const x0 = Math.floor(Math.min(net.x[i], net.x[i + 1]) / cell), x1 = Math.floor(Math.max(net.x[i], net.x[i + 1]) / cell);
    const z0 = Math.floor(Math.min(net.z[i], net.z[i + 1]) / cell), z1 = Math.floor(Math.max(net.z[i], net.z[i + 1]) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const g = `${cx},${cz}`; if (!grid.has(g)) grid.set(g, []); grid.get(g).push(k); }
  }
  return { grid, segs, cell };
}

/**
 * Map one DLR curve onto the drawn DLR track by snapping (see the header).
 * ratio: the structure scale the network's morphed pieces are drawn at.
 * fallback(x, y, z) -> { base, y, open } for a sample with no drawn track near.
 */
export function mapSnapCurve({ curve, net, index, ratio, fallback, stepM = SNAP_STEP_M, maxM = SNAP_MAX_M, ve = 5 }) {
  const maxDy = SNAP_MAX_RISE_M * ve * ratio; // scene units at this structure scale
  const L = curve.getLength(), n = Math.max(2, Math.ceil(L / stepM) + 1);
  const r = new RunBuilder();
  const stats = { samples: n, snapped: 0, fallback: 0, maxSnapM: 0, sumSnapM: 0 };
  let prevPiece = -1;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1), P = curve.getPointAt(u);
    let best = null, keep = null;
    const c = index.cell, cx = Math.floor(P.x / c), cz = Math.floor(P.z / c), R = Math.ceil(maxM / c), seen = new Set();
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (const sk of index.grid.get(`${cx + dx},${cz + dz}`) || []) {
      if (seen.has(sk)) continue; seen.add(sk);
      const i = index.segs[sk], j = i + 1;
      const vx = net.x[j] - net.x[i], vz = net.z[j] - net.z[i], t = Math.max(0, Math.min(1, ((P.x - net.x[i]) * vx + (P.z - net.z[i]) * vz) / (vx * vx + vz * vz || 1)));
      const qx = net.x[i] + vx * t, qz = net.z[i] + vz * t, d = Math.hypot(P.x - qx, P.z - qz);
      if (d > maxM) continue;
      // Clamped onto a segment's end (the curve has run past the drawn piece, or this
      // segment is not the one beside it): only close by (SNAP_PIECE_END_M).
      if ((t <= 0 || t >= 1) && d > SNAP_PIECE_END_M) continue;
      const yi = drawnY(net.y0[i], net.base[i], net.morph[i], ratio), yj = drawnY(net.y0[j], net.base[j], net.morph[j], ratio);
      const dy = yi + (yj - yi) * t - P.y;
      if (Math.abs(dy) > maxDy) continue;
      const score = Math.hypot(d, dy);
      const cand = { i, j, t, qx, qz, d, score, piece: net.piece[i] };
      if (!best || score < best.score) best = cand;
      if (cand.piece === prevPiece && (!keep || score < keep.score)) keep = cand;
    }
    if (keep && best && keep.score <= best.score + SNAP_KEEP_PIECE_M) best = keep;
    if (best) {
      const { i, j, t } = best;
      // Interpolate the drawn quantities; the vertex is stored as already drawn (morph 0) at this ratio.
      const yi = drawnY(net.y0[i], net.base[i], net.morph[i], ratio), yj = drawnY(net.y0[j], net.base[j], net.morph[j], ratio);
      const open = net.open[i] && net.open[j] ? 1 : (t < 0.5 ? net.open[i] : net.open[j]);
      const y = net.open[i] !== net.open[j] ? (net.open[i] ? yi : yj) : yi + (yj - yi) * t;
      const s = r.vertex(best.qx, best.qz, net.base[i] + (net.base[j] - net.base[i]) * t, y, 0, open, 0, net.extra[i] + (net.extra[j] - net.extra[i]) * t);
      r.anchor(u, s, null);
      stats.snapped++; stats.maxSnapM = Math.max(stats.maxSnapM, best.d); stats.sumSnapM += best.d;
      prevPiece = best.piece;
    } else {
      const f = fallback(P.x, P.y, P.z);
      const s = r.vertex(P.x, P.z, f.base, f.y, 0, f.open ? 1 : 0);
      r.anchor(u, s, null);
      stats.fallback++; prevPiece = -1;
    }
  }
  // Portal flags on the anchors where the drawn track changes between tunnel and open.
  // The ramp limits the rail's absolute height in canonical units, as the DLR profile's own
  // 8% grade limit does (dlr-profile.js refresh); a lift-based ramp, or one scaled by the
  // structure ratio, lifted whole decks over dips (Master 10, found 01Oct26h by
  // tests/surface-trains.spec.js and the unit test beside it).
  const run = r.build({}, { ramp: 'absolute' });
  for (let k = 1; k < run.open.length; k++) if (run.open[k] !== run.open[k - 1]) run.portal[k] = 1;
  return { runs: run.au.length >= 2 ? [run] : [], stats };
}

// ── Sampling a run ────────────────────────────────────────────────────────────
/** The run covering u (runs sorted by u0), or null. */
export function runAt(runs, u) {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, r = runs[m];
    if (u < r.u0) hi = m - 1; else if (u > r.u1) lo = m + 1; else return r;
  }
  return null;
}
/** Arc length along a run at curve parameter u (piecewise linear through the anchors). */
export function sAt(run, u) {
  const au = run.au, as = run.as;
  let lo = 0, hi = au.length - 1;
  if (u <= au[0]) return as[0];
  if (u >= au[hi]) return as[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (au[m] <= u) lo = m; else hi = m; }
  return as[lo] + (u - au[lo]) / (au[hi] - au[lo]) * (as[hi] - as[lo]);
}
/**
 * Point on a run at arc length s, drawn at structure ratio: writes out.{x, y, z, dx, dy, dz, open, inside}.
 * Across a tunnel/open boundary the height is the open vertex's (nothing is
 * drawn dipping into the ground at a portal); `open` is the nearer vertex's.
 */
export function sampleRun(run, s, ratio, out, lateral = 0, laneSign = 0) {
  const cum = run.cum, n = cum.length;
  out.inside = s >= cum[0] && s <= cum[n - 1];
  const sc = Math.max(cum[0], Math.min(cum[n - 1], s));
  // The segment: from out.seg (the last sample's, when it was on this run: a train's cars are
  // consecutive along it), stepping a few segments, else a binary search.
  let lo = 0, hi = n - 1;
  const h = out.run === run ? out.seg : -1;
  if (h >= 0 && h < n - 1 && Math.abs(sc - cum[h]) < 200) {
    lo = h;
    while (lo > 0 && cum[lo] > sc) lo--;
    while (lo < n - 2 && cum[lo + 1] <= sc) lo++;
    hi = lo + 1;
  } else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= sc) lo = m; else hi = m; }
  out.run = run; out.seg = lo;
  const seg = cum[hi] - cum[lo], t = seg > 0 ? (sc - cum[lo]) / seg : 0;
  out.extra = run.extra ? run.extra[lo] + (run.extra[hi] - run.extra[lo]) * t : 0;
  // `lateral` (metres along the run's (-dz, dx) normal, offsetRails' "left"): the rail morph pivots on the terrain there
  // (computeCrossSlopes). With laneSign, the lateral is the train's lane on that side: laneSign x (LANE_OFFSET_M + extra).
  if (laneSign) lateral = laneSign * (LANE_OFFSET_M + out.extra);
  const sl = run.slope, ba = run.base[lo] + (sl ? sl[lo] * lateral : 0), bb = run.base[hi] + (sl ? sl[hi] * lateral : 0);
  const ya = drawnY(run.y0[lo], ba, run.morph[lo], ratio), yb = drawnY(run.y0[hi], bb, run.morph[hi], ratio);
  const oa = run.open[lo], ob = run.open[hi];
  out.x = run.x[lo] + (run.x[hi] - run.x[lo]) * t;
  out.z = run.z[lo] + (run.z[hi] - run.z[lo]) * t;
  out.y = oa === ob ? ya + (yb - ya) * t : (oa ? ya : yb);
  out.open = t < 0.5 ? oa : ob;
  out.dx = run.x[hi] - run.x[lo]; out.dz = run.z[hi] - run.z[lo]; out.dy = oa === ob ? yb - ya : 0;
  return out;
}

/** A train's lane: its distance from the corridor's centreline (LANE_OFFSET_M, plus a shared corridor's extra from a sample). */
export function laneDistance(out) { return LANE_OFFSET_M + (out?.extra || 0); }
/** Signed lateral offset (left of travel) for a train: left-hand running, laneDistance() out. */
export function laneOffset(out, travelSign) {
  const h = Math.hypot(out.dx, out.dz) || 1, L = laneDistance(out);
  // Travel direction d = travelSign x (dx, dz); left of it (left-hand running, as the Overground): (d.z, -d.x).
  return { ox: travelSign * out.dz / h * L, oz: -travelSign * out.dx / h * L };
}
