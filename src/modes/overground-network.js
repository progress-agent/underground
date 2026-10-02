// overground-network.js: the London Overground's entry into the Pedestrian walk
// network (sprint 02Oct26f, lane O, D-048 item 5; Jordan: "all six lines join
// the walk network, every Overground station is a stop, with changes to and
// from the Tube and DLR at interchanges, riding on the drawn track").
//
// Pure: no THREE, no DOM, no clock, no randomness. tests/overground-network.test.mjs pins it
// in node on synthetic data; the real network is read through `overgroundGroup.userData`
// (main.js s02:O hands it in).
//
// THE SHAPE. The Tube and DLR walk on station chords and are SHOWN on the drawn track
// (open-air-map.js). The Overground's network paths are built FROM the drawn track itself
// (overground.js `userData.linePaths`: 12 m samples with live `y`), so the walker is shown on
// them directly (overground-walk.js) and a station chord is never needed. Ids are `og:<line>`.
//
// WHAT IT BUILDS, per line, once per `linePaths` identity (topology; each `input()` call
// reads only `y` afresh, so Master follows with no rebuild):
//   1. JOINS   a drawn piece whose end lies within JOIN_M of another piece of the same line is
//              joined at the nearest point Q on that piece. Q is inserted there as a vertex (or
//              an existing vertex within VERTEX_MERGE_M is used) and Q's EXACT coordinates are
//              appended to the joining end, so the junction keys (rounded metres) match.
//   2. GAPS    while a line has more than one connected component, the shortest link from a
//              component's end vertex to any vertex of another component, if GAP_MAX_M or less,
//              becomes a connector branch walked in the bore at the drawn tunnel's own depth
//              (kind 'gap'). On the real data that is one gap: the Weaver's, about 825 m between
//              the Liverpool Street fragment and the Hackney trunk, carrying Bethnal Green.
//   3. STATIONS (deduplicated by cleaned name within DEDUPE_M: Mildmay lists Clapham Junction
//              twice). The nearest point Q over all of the line's pieces, at distance d:
//                 * Q a piece END and STUB_MIN_M < d <= STUB_MAX_M: a straight STUB from that
//                   end to the site (kind 'stub'); the station is the stub's last vertex, so a
//                   terminus is reached on foot, not by projection;
//                 * otherwise d <= ON_TRACK_M: Q becomes a vertex of the nearest piece, and of
//                   every other piece of the line whose own nearest point is within d + EXTRA_M
//                   and is not that piece's end (Hackney Downs sits on both Weaver trunks);
//                 * otherwise it is not a stop: 'stub-too-long' (a piece end, d > STUB_MAX_M) or
//                   'no-track' (d > ON_TRACK_M and not at an end).
//   4. Each placement is a synthetic station record { id, ids, name, pos, site, surfaceY }
//              whose pos IS the vertex, so buildTunnelNetwork's 3 m station snap makes it a stop.
//
// Every branch array carries `.og`, a record per vertex of where it came from in the drawn
// data (kind 'track' | 'mix' | 'stub' | 'gap'); `liveY(rec)` is its height now. `.ogJunction` flags the
// vertices where it meets another piece.

export const OG_PREFIX = 'og:';
export const isOgLine = (lineId) => typeof lineId === 'string' && lineId.startsWith(OG_PREFIX);

export const JOIN_M = 30;            // a piece end this near another piece of its line is joined to it
export const GAP_MAX_M = 1000;       // the longest gap bridged by a connector in the bore
export const ON_TRACK_M = 250;       // a station this near the track goes on it as a stop
export const STUB_MIN_M = 15;        // a station this far past a piece end is reached by a stub
export const STUB_MAX_M = 450;
export const EXTRA_M = 30;           // other pieces of a line within d + this of a station also carry it
export const DEDUPE_M = 100;         // one station listed twice by name within this is one
export const VERTEX_MERGE_M = 2.5;   // an inserted vertex this near an existing one uses it (under buildTunnelNetwork's 3 m station snap)
export const JOIN_END_SNAP_M = 12;   // a join that would land this near the END of the other piece lands on the end (the Mildmay's three pieces meet at Willesden Junction within 8 m)
export const STEP_M = 12;            // connector and stub sampling (the drawn track's own step)
// The drawn tunnel's own height formula (surface-rail.js BASE_LIFT and CLASS_LIFT_M.tunnel; a node
// test reads the source and pins that these are still those numbers): ground + BASE_LIFT + (-20 m) * VE.
export const BASE_LIFT = 5;
export const TUNNEL_LIFT_M = -20;

const tidy = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** A station's name without the " Rail Station" style suffix, as tube-routes.js cleanStationName. */
export function ogCleanName(name) {
  return tidy(name).replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
}

/**
 * The keys a station name is matched on: lower case, parentheticals removed ("Stratford (London)"
 * reads "stratford"), apostrophes removed ("Queen's Park" reads "queens park"), "&" read as "and";
 * and, where it starts "London ", the name without it too ("London Euston" reads "euston").
 * Two names match when any of their keys is equal.
 */
const keyMemo = new Map();   // names are a few hundred: remembered, since every network rebuild asks again
export function ogNameKeys(name) {
  const hit = keyMemo.get(name);
  if (hit) return hit;
  const keys = computeKeys(name);
  if (keyMemo.size < 4096) keyMemo.set(name, keys);
  return keys;
}
function computeKeys(name) {
  let k = ogCleanName(name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = [k];
  if (/^london\s+\S/.test(k)) keys.push(k.replace(/^london\s+/, ''));
  return keys;
}
export function ogNamesMatch(a, b) {
  const ka = ogNameKeys(a), kb = ogNameKeys(b);
  return ka.some(x => kb.includes(x));
}

/** The height of a vertex record now (canonical y): the drawn sample's live y, a mix of two, a stub's, a connector's. */
export function liveY(rec) {
  switch (rec.kind) {
    case 'gap': return rec.y0;
    case 'stub': return liveY(rec.base) - rec.gEnd + rec.g;
    case 'mix': { const a = liveY(rec.r0), b = liveY(rec.r1); return a + (b - a) * rec.t; }
    default: return rec.a.y;
  }
}

// ── geometry helpers ───────────────────────────────────────────────────────
/** The nearest point of a vertex polyline to (x, z): { k, t, d, qx, qz, end } (end: the point is the first or last vertex). */
export function nearestOn(verts, x, z) {
  let best = null;
  const n = verts.length;
  for (let k = 0; k + 1 < n; k++) {
    const a = verts[k], b = verts[k + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + dx * t, qz = a.z + dz * t, d = Math.hypot(x - qx, z - qz);
    if (!best || d < best.d) best = { k, t, d, qx, qz, end: (k === 0 && t === 0) || (k === n - 2 && t === 1) };
  }
  return best;
}

const openOf = (rec) => rec.open;
function mixRec(r0, r1, t) {
  return { kind: 'mix', r0, r1, t, open: t < 0.5 ? openOf(r0) : openOf(r1) };
}

/**
 * The vertex of `piece` at the point t along its segment k: an existing vertex within VERTEX_MERGE_M,
 * else a new one spliced in (a mix of its neighbours' records). Returns the vertex object.
 */
function vertexAt(piece, k, t, qx, qz) {
  const V = piece.verts;
  const a = V[k], b = V[k + 1];
  const da = Math.hypot(qx - a.x, qz - a.z), db = Math.hypot(qx - b.x, qz - b.z);
  if (da <= VERTEX_MERGE_M && da <= db) return a;
  if (db <= VERTEX_MERGE_M) return b;
  const v = { x: qx, z: qz, rec: mixRec(a.rec, b.rec, t) };
  V.splice(k + 1, 0, v);
  return v;
}

/**
 * Build one line's topology from its drawn branches and its stations.
 * @param {{ id: string, branches: Array<Array<{x, z, y, cls}>|null>, stations: Array<{id, name, pos: {x, y, z}}> }} line
 * @param {{ groundY: (x, z) => number, structuralY?: (x, z) => number, VE: number }} env
 */
export function buildLineTopology(line, { groundY, structuralY = null, VE = 5 } = {}) {
  const report = { id: line.id, joins: [], gaps: [], stubs: [], nonStops: [], placements: [], stations: 0, pieces: 0 };
  const pieces = [];
  for (const branch of line.branches || []) {
    if (!branch || branch.length < 2) continue;
    const verts = [];
    for (const p of branch) {
      const last = verts.at(-1);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.05) continue;   // a repeated sample is one vertex
      verts.push({ x: p.x, z: p.z, rec: { kind: 'track', a: p, cls: p.cls, open: p.cls !== 'tunnel' } });
    }
    if (verts.length < 2) continue;
    pieces.push({ id: pieces.length, kind: 'track', verts });
  }
  report.pieces = pieces.length;
  const parent = pieces.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  // 1. JOINS
  const ends = [];
  for (const A of pieces) { ends.push([A, 'start']); ends.push([A, 'end']); }
  for (const [A, which] of ends) {
    const E = which === 'start' ? A.verts[0] : A.verts.at(-1);
    let best = null;
    for (const B of pieces) {
      if (B === A) continue;
      const n = nearestOn(B.verts, E.x, E.z);
      if (n && n.d <= JOIN_M && (!best || n.d < best.d)) best = { ...n, B };
    }
    if (!best) continue;
    // Where the join lands within JOIN_END_SNAP_M of the other piece's own end, it lands ON that end: pieces that meet at
    // one real junction (the Richmond and Clapham Junction branches start at one point, the Stratford piece ends 7 m on)
    // then share one vertex, and both branches are ways on from it.
    const endV = [best.B.verts[0], best.B.verts.at(-1)].find(v => Math.hypot(v.x - best.qx, v.z - best.qz) <= JOIN_END_SNAP_M);
    const vq = endV ?? vertexAt(best.B, best.k, best.t, best.qx, best.qz);
    vq.j = true;
    if (Math.hypot(E.x - vq.x, E.z - vq.z) < 0.5) { E.x = vq.x; E.z = vq.z; E.j = true; }
    else {
      const j = { x: vq.x, z: vq.z, rec: vq.rec, j: true };
      if (which === 'start') A.verts.unshift(j); else A.verts.push(j);
    }
    union(A.id, best.B.id);
    report.joins.push({ from: A.id, to: best.B.id, m: +best.d.toFixed(2) });
  }

  // 2. GAPS: connectors between the components, shortest first, up to GAP_MAX_M.
  for (let guard = 0; guard < 16; guard++) {
    const roots = new Set(pieces.map(p => find(p.id)));
    if (roots.size < 2) break;
    let best = null;
    for (const A of pieces) {
      for (const E of [A.verts[0], A.verts.at(-1)]) {
        for (const B of pieces) {
          if (find(B.id) === find(A.id)) continue;
          for (const V of B.verts) {
            const d = Math.hypot(V.x - E.x, V.z - E.z);
            if (d <= GAP_MAX_M && (!best || d < best.d)) best = { d, A, E, B, V };
          }
        }
      }
    }
    if (!best) break;
    const { A, E, B, V, d } = best;
    const steps = Math.max(1, Math.ceil(d / STEP_M));
    E.j = true; V.j = true;
    const verts = [{ x: E.x, z: E.z, rec: E.rec, j: true }];
    for (let j = 1; j < steps; j++) {
      const t = j / steps, x = E.x + (V.x - E.x) * t, z = E.z + (V.z - E.z) * t;
      verts.push({ x, z, rec: { kind: 'gap', open: false, y0: groundY(x, z) + BASE_LIFT + TUNNEL_LIFT_M * VE } });
    }
    verts.push({ x: V.x, z: V.z, rec: V.rec, j: true });
    const piece = { id: pieces.length, kind: 'gap', verts };
    pieces.push(piece);
    parent.push(piece.id);
    union(A.id, B.id); union(piece.id, A.id);
    report.gaps.push({ from: A.id, to: B.id, m: +d.toFixed(1) });
  }

  // 3. STATIONS
  const sites = [];
  for (const st of line.stations || []) {
    const name = ogCleanName(st.name);
    const g = sites.find(s => ogCleanName(s.name) === name && Math.hypot(s.site.x - st.pos.x, s.site.z - st.pos.z) <= DEDUPE_M);
    if (g) { if (st.id && !g.ids.includes(st.id)) g.ids.push(st.id); continue; }
    sites.push({ name: st.name, ids: st.id ? [st.id] : [], site: { x: st.pos.x, z: st.pos.z }, y: st.pos.y });
  }
  report.stations = sites.length;
  const stubs = [];
  const placements = [];   // { site, piece, vertex }
  const trackPieces = pieces.slice();
  for (const S of sites) {
    let best = null;
    for (const P of trackPieces) {
      const n = nearestOn(P.verts, S.site.x, S.site.z);
      if (!n) continue;
      // Nearer wins; at a tie (a piece end that is a join on another piece's body) the body, not the end.
      if (!best || n.d < best.d - 0.5 || (n.d < best.d + 0.5 && best.end && !n.end)) best = { ...n, P };
    }
    if (!best) { report.nonStops.push({ name: ogCleanName(S.name), reason: 'no-track', d: null }); continue; }
    // A station beside a piece's last segment (the nearest point within one step of the end) is a station
    // at the end: Upminster stands 20 m off the side of the Liberty's last 12 m, and the line stops there.
    if (!best.end && best.d > STUB_MIN_M) {
      const V = best.P.verts;
      let before = best.t * Math.hypot(V[best.k + 1].x - V[best.k].x, V[best.k + 1].z - V[best.k].z);
      for (let i = 0; i < best.k; i++) before += Math.hypot(V[i + 1].x - V[i].x, V[i + 1].z - V[i].z);
      let after = (1 - best.t) * Math.hypot(V[best.k + 1].x - V[best.k].x, V[best.k + 1].z - V[best.k].z);
      for (let i = best.k + 1; i + 1 < V.length; i++) after += Math.hypot(V[i + 1].x - V[i].x, V[i + 1].z - V[i].z);
      if (Math.min(before, after) <= STEP_M) {
        const first = before <= after, E = first ? V[0] : V.at(-1);
        best = { ...best, end: true, k: first ? 0 : V.length - 2, t: first ? 0 : 1, qx: E.x, qz: E.z, d: Math.hypot(S.site.x - E.x, S.site.z - E.z) };
      }
    }
    const d = best.d;
    if (best.end && d > STUB_MIN_M && d <= STUB_MAX_M) {
      const E = best.k === 0 && best.t === 0 ? best.P.verts[0] : best.P.verts.at(-1);
      stubs.push({ S, E, d });
    } else if (d <= ON_TRACK_M) {
      const v = vertexAt(best.P, best.k, best.t, best.qx, best.qz);
      placements.push({ S, piece: best.P, vertex: v, d, how: 'insert' });
      for (const P of trackPieces) {
        if (P === best.P) continue;
        const n = nearestOn(P.verts, S.site.x, S.site.z);
        if (!n || n.end || n.d > d + EXTRA_M) continue;
        placements.push({ S, piece: P, vertex: vertexAt(P, n.k, n.t, n.qx, n.qz), d: n.d, how: 'insert' });
      }
    } else {
      report.nonStops.push({ name: ogCleanName(S.name), reason: best.end ? 'stub-too-long' : 'no-track', d: +d.toFixed(1) });
    }
  }
  // Stubs last, so a station never lands on another station's stub.
  for (const { S, E, d } of stubs) {
    const gEnd = groundY(E.x, E.z);
    const steps = Math.max(1, Math.ceil(d / STEP_M));
    E.j = true;
    const verts = [{ x: E.x, z: E.z, rec: E.rec, j: true }];
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const x = j === steps ? S.site.x : E.x + (S.site.x - E.x) * t, z = j === steps ? S.site.z : E.z + (S.site.z - E.z) * t;
      verts.push({ x, z, rec: { kind: 'stub', base: E.rec, gEnd, g: groundY(x, z), open: E.rec.open } });
    }
    const piece = { id: pieces.length, kind: 'stub', verts };
    pieces.push(piece);
    placements.push({ S, piece, vertex: verts.at(-1), d, how: 'stub' });
    report.stubs.push({ name: ogCleanName(S.name), m: +d.toFixed(1) });
  }
  // Pieces of one line that share a vertex to the metre meet there, whatever joined them: the Enfield branch runs on
  // the Cheshunt line's own track for 70 m before it parts from it, and the walker must be able to choose there. These
  // are the keys buildTunnelNetwork would find at every sample, found here once (the topology is cached) so each
  // network rebuild keys only the vertices flagged.
  {
    const seen = new Map();
    for (const P of pieces) for (const v of P.verts) {
      const k = `${Math.round(v.x)}:${Math.round(v.z)}`;
      const hit = seen.get(k);
      if (!hit) seen.set(k, { piece: P.id, vs: [v] });
      else { hit.vs.push(v); if (hit.piece !== P.id) hit.shared = true; }
    }
    for (const h of seen.values()) if (h.shared) for (const v of h.vs) v.j = true;
  }
  for (const p of placements) {
    report.placements.push({ name: ogCleanName(p.S.name), how: p.how, d: +p.d.toFixed(1), piece: p.piece.id });
  }
  const stopNames = new Set(placements.map(p => ogCleanName(p.S.name)));
  report.stops = stopNames.size;
  return { id: line.id, pieces, placements, report, structuralY, groundY, VE };
}

/**
 * The Overground network source: buildTunnelNetwork's extra inputs under the ids `og:<line>`.
 * @param {object} o
 * @param {() => object|null} o.group      main.js overgroundGroup (userData: linePaths, stationSets)
 * @param {(x, z) => number} o.getGroundY  the terrain (the connectors' and stubs' heights)
 * @param {(x, z) => number} [o.getStructuralY]  the structural ground at a station site (its surfaceY)
 * @param {number} o.VE
 */
export function createOvergroundNetworkSource({ group, getGroundY, getStructuralY = null, VE = 5 } = {}) {
  let cachedFor = null, topo = null, builds = 0;
  const grp = () => (typeof group === 'function' ? group() : group) ?? null;

  function topology() {
    const g = grp();
    const lp = g?.userData?.linePaths;
    if (!lp || !lp.size) return null;
    if (cachedFor === lp && topo) return topo;
    const lines = [];
    for (const set of g.userData.stationSets || []) {
      const branches = lp.get(set.id);
      if (!branches) continue;
      lines.push(buildLineTopology({ id: set.id, branches, stations: set.stations.map(s => ({ id: s.id, name: s.name, pos: s.pos })) },
        { groundY: getGroundY, structuralY: getStructuralY, VE }));
    }
    builds++;
    cachedFor = lp; topo = lines;
    return topo;
  }

  /** The inputs of buildTunnelNetwork: { branches: Map, stationLayers: Map } keyed og:<line>; null until the Overground exists. */
  function input() {
    const lines = topology();
    if (!lines) return null;
    const branches = new Map(), stationLayers = new Map();
    for (const L of lines) {
      const lineId = OG_PREFIX + L.id;
      const arrays = L.pieces.map((P) => {
        const arr = P.verts.map(v => ({ x: v.x, y: liveY(v.rec), z: v.z }));
        arr.og = P.verts.map(v => v.rec);
        // The vertices where this piece meets another (a join, a connector end, a stub's start): the only
        // places buildTunnelNetwork needs to look for a junction, so it keys these and not every sample.
        arr.ogJunction = P.verts.map(v => !!v.j);
        return arr;
      });
      branches.set(lineId, arrays);
      const stations = [];
      for (const pl of L.placements) {
        const v = pl.vertex;
        const sy = L.structuralY ? L.structuralY(pl.S.site.x, pl.S.site.z) : null;
        // ref: the branch array and vertex index it stands on, so buildTunnelNetwork needs no scan for it.
        stations.push({ id: pl.S.ids[0] ?? null, ids: pl.S.ids.slice(), name: pl.S.name,
          pos: { x: v.x, y: liveY(v.rec), z: v.z }, site: { x: pl.S.site.x, z: pl.S.site.z },
          surfaceY: Number.isFinite(sy) ? sy : null, ref: { branch: arrays[pl.piece.id], vi: pl.piece.verts.indexOf(v) } });
      }
      stationLayers.set(lineId, { stationsLayer: { stations } });
    }
    return { branches, stationLayers };
  }

  /** Per line: stations, stops, joins, gaps, stubs and the stations that are not stops, with reasons. */
  function report() {
    const lines = topology();
    if (!lines) return null;
    const out = {};
    for (const L of lines) out[OG_PREFIX + L.id] = JSON.parse(JSON.stringify(L.report));
    return { lines: out, builds };
  }

  return { input, report, topology, get builds() { return builds; } };
}
