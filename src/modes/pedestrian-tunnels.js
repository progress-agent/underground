// pedestrian-tunnels.js: stations, shafts and tunnel-locked walking for the
// Pedestrian mode (sprint 23Sep26w, D-037, lane A2). Pure logic plus
// THREE.CatmullRomCurve3; no DOM, so node tests pin it.
//
// Jordan: "Going underground only at stations, and then only moving within
// tunnels whilst underground." So below ground a pedestrian is a point on the
// centreline of one of the RENDERED bores, never a free body:
//   - topology and arc length come from the line's shared centreline (a
//     centripetal CatmullRomCurve3 through each branch's snapped centre points),
//     sampled every ~10m into a polyline with real-metre arc length;
//   - the tunnels main.js actually draws are twin bores either side of that
//     centreline (buildOffsetCurvesFromCenterline, offset `halfSpacing`, 6m by
//     default, with a 4.5m tube radius), so the shared centreline itself runs
//     through solid ground between them. Each sample therefore also carries the
//     matching point on both bore curves, built exactly as main.js builds them
//     (boreVertices below), and the walker is placed on the bore it is in
//     (`side` +1 = main.js leftCurve, -1 = rightCurve, 0 = the shared centreline);
//   - a walker keeps to its bore: turning round does not teleport it into the
//     other one, and at a junction the bore carries over by travel sense;
//   - W / S walk along it, in whichever direction the view faces;
//   - at a junction (a vertex shared by two or more branches of the same line)
//     the continuation that best matches the facing direction wins;
//   - platforms are the branch vertices at underground stations, at their true
//     modelled depth (the same snapped Y the station markers and shafts use).
//
// ─── API ────────────────────────────────────────────────────────────────────
//
//   const net = buildTunnelNetwork({ THREE, branchesByLine, stationLayers, VE, halfSpacing })
//     halfSpacing     main.js twin-bore half spacing in metres (0 = single bore on the centreline)
//     branchesByLine  Map lineId -> [[{x,y,z}, ...], ...]   (main.js lineBranchCenterPts)
//     stationLayers   Map lineId -> { stationsLayer: { stations: [{ id, name, pos, surfaceY, depthM }] } }
//   net.paths         [{ id, lineId, n, x, y, z, s, length, junctions, stops }]
//   net.entrances     [{ name, x, z, surfaceY, stops: [stop] }]   one per station site
//   stop              { path, s, lineId, name, platformY, surfaceY, depthM }
//
//   pointAt(path, s, out?, side?)          -> {x, y, z} on the centreline (side 0) or a bore (+1 / -1)
//   boreVertices(THREE, pts, halfSpacing)  -> { left, right } offset vertices, as main.js builds them
//   headingAt(path, s, dir)                -> {x, z} unit horizontal direction of travel
//   nearestEntrance(net, x, z, maxR)       -> entrance or null
//   chooseStop(net, entrance, facing)      -> { stop, dir } best matching the facing direction
//   travelDir(path, s, want, prevDir)      -> +1 / -1 along the path for a desired direction
//   advance(net, pos, dist, want)          -> moves pos {path, s, dir, side?} dist metres toward `want`
//                                             (unit {x,z}), choosing at junctions (the bore side carries
//                                             over by travel sense); returns { stopped }
//   nearestStopOnPath(net, path, s, maxD)  -> stop within maxD metres of arc, or null

export const SAMPLE_STEP_M = 10;
export const MIN_PLATFORM_DEPTH_M = 3;   // shallower "stations" (elevated DLR, surface Met) have no shaft
export const HEADING_PROBE_M = 6;
const STATION_SNAP_M = 3;                // a station's position vs its branch vertex (both come from the same registry)
const ENTRANCE_MERGE_M = 40;             // stops closer than this share one entrance (interchanges)

const key = (lineId, x, z) => `${lineId}:${Math.round(x)}:${Math.round(z)}`;

/**
 * The twin-bore control points, built EXACTLY as main.js
 * buildOffsetCurvesFromCenterline builds them (keep the two in step; the
 * Playwright tunnel spec measures the walker against the rendered tube meshes,
 * so a drift here fails it): per vertex, the XZ chord from the previous to the
 * next vertex, its perpendicular (x, z) -> (-z, x), offset +/- halfSpacing.
 * main.js runs a centripetal CatmullRomCurve3 through each list.
 */
export function boreVertices(THREE, pts, halfSpacing) {
  const left = [], right = [];
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], pPrev = pts[Math.max(0, i - 1)], pNext = pts[Math.min(pts.length - 1, i + 1)];
    tangent.subVectors(pNext, pPrev);
    tangent.y = 0;
    tangent.normalize();
    normal.set(-tangent.z, 0, tangent.x).normalize();
    left.push(new THREE.Vector3().copy(p).addScaledVector(normal, halfSpacing));
    right.push(new THREE.Vector3().copy(p).addScaledVector(normal, -halfSpacing));
  }
  return { left, right };
}

function samplePath(THREE, lineId, pts, VE, id, sampleStep, halfSpacing) {
  const V = pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
  const n = V.length;
  const curve = new THREE.CatmullRomCurve3(V);
  const bores = halfSpacing > 0 ? boreVertices(THREE, V, halfSpacing) : null;
  const lCurve = bores ? new THREE.CatmullRomCurve3(bores.left) : null;
  const rCurve = bores ? new THREE.CatmullRomCurve3(bores.right) : null;
  const xs = [], ys = [], zs = [], vIdx = new Array(n), us = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n - 1; i++) {
    const segH = Math.hypot(V[i + 1].x - V[i].x, V[i + 1].z - V[i].z);
    const m = Math.max(1, Math.ceil(segH / sampleStep));
    for (let k = 0; k < m; k++) {
      if (k === 0) vIdx[i] = xs.length;
      const u = (i + k / m) / (n - 1);
      us.push(u);
      curve.getPoint(u, tmp);
      xs.push(tmp.x); ys.push(tmp.y); zs.push(tmp.z);
    }
  }
  vIdx[n - 1] = xs.length;
  us.push(1);
  xs.push(V[n - 1].x); ys.push(V[n - 1].y); zs.push(V[n - 1].z);
  // Vertices land exactly on their input point (CatmullRom interpolates them).
  for (let i = 0; i < n; i++) { xs[vIdx[i]] = V[i].x; ys[vIdx[i]] = V[i].y; zs[vIdx[i]] = V[i].z; }
  const count = xs.length;
  const s = new Float64Array(count);
  for (let j = 1; j < count; j++) {
    s[j] = s[j - 1] + Math.hypot(xs[j] - xs[j - 1], (ys[j] - ys[j - 1]) / VE, zs[j] - zs[j - 1]);
  }
  // The matching point on each rendered bore, at the same curve parameter: the
  // bore curves have the same vertex count, so parameter u sits at the same
  // place along both (a vertex lands exactly on its offset vertex).
  const boreArrays = (c, verts) => {
    const bx = new Float64Array(count), by = new Float64Array(count), bz = new Float64Array(count);
    for (let j = 0; j < count; j++) { c.getPoint(us[j], tmp); bx[j] = tmp.x; by[j] = tmp.y; bz[j] = tmp.z; }
    for (let i = 0; i < n; i++) { const j = vIdx[i]; bx[j] = verts[i].x; by[j] = verts[i].y; bz[j] = verts[i].z; }
    return { x: bx, y: by, z: bz };
  };
  return {
    id, lineId, n: count,
    x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs), s,
    left: lCurve ? boreArrays(lCurve, bores.left) : null,
    right: rCurve ? boreArrays(rCurve, bores.right) : null,
    length: s[count - 1],
    vertexS: vIdx.map(j => s[j]),
    vertices: V,
    junctions: [],   // sorted arc positions of junction vertices
    stops: [],       // [{ s, stop }]
  };
}

export function buildTunnelNetwork({ THREE, branchesByLine, stationLayers, VE = 5,
  sampleStep = SAMPLE_STEP_M, minDepthM = MIN_PLATFORM_DEPTH_M, halfSpacing = 0 } = {}) {
  const hs = Number.isFinite(halfSpacing) && halfSpacing > 0 ? halfSpacing : 0;
  const paths = [];
  const byKey = new Map(); // junction key -> [{ path, s }]
  for (const [lineId, branches] of branchesByLine || []) {
    for (const branch of branches || []) {
      const pts = (branch || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      if (pts.length < 2) continue;
      const path = samplePath(THREE, lineId, pts, VE, paths.length, sampleStep, hs);
      if (!(path.length > 0)) continue;
      paths.push(path);
      path.vertices.forEach((v, i) => {
        const k = key(lineId, v.x, v.z);
        if (!byKey.has(k)) byKey.set(k, []);
        const list = byKey.get(k);
        // One entry per (path, s): consecutive duplicates in a branch are one vertex.
        if (!list.some(e => e.path === path.id && Math.abs(e.s - path.vertexS[i]) < 1e-6)) {
          list.push({ path: path.id, s: path.vertexS[i] });
        }
      });
    }
  }
  const junctionAt = new Map(); // `${path}:${s}` -> entries
  for (const entries of byKey.values()) {
    if (entries.length < 2) continue;
    for (const e of entries) {
      paths[e.path].junctions.push(e.s);
      junctionAt.set(`${e.path}:${e.s}`, entries);
    }
  }
  for (const p of paths) p.junctions.sort((a, b) => a - b);

  // Platforms: station positions matched to branch vertices of their own line.
  const stops = [];
  for (const [lineId, layer] of stationLayers || []) {
    const stations = layer?.stationsLayer?.stations || [];
    const linePaths = paths.filter(p => p.lineId === lineId);
    if (!linePaths.length) continue;
    for (const st of stations) {
      const pos = st?.pos;
      if (!pos || !Number.isFinite(pos.x)) continue;
      for (const p of linePaths) {
        for (let i = 0; i < p.vertices.length; i++) {
          const v = p.vertices[i];
          if (Math.hypot(v.x - pos.x, v.z - pos.z) > STATION_SNAP_M) continue;
          const platformY = v.y;
          const surfaceY = Number.isFinite(st.surfaceY) ? st.surfaceY : null;
          const depthM = surfaceY !== null ? (surfaceY - platformY) / VE
            : (Number.isFinite(st.depthM) ? st.depthM : null);
          if (depthM === null || depthM < minDepthM) continue;
          if (p.stops.some(x => Math.abs(x.s - p.vertexS[i]) < 1e-6)) continue;
          const stop = { path: p.id, s: p.vertexS[i], lineId, name: st.name ?? st.id ?? '', id: st.id ?? null,
            x: v.x, z: v.z, platformY, surfaceY, depthM };
          p.stops.push({ s: stop.s, stop });
          stops.push(stop);
        }
      }
    }
  }
  for (const p of paths) p.stops.sort((a, b) => a.s - b.s);

  const entrances = [];
  for (const stop of stops) {
    let e = entrances.find(en => Math.hypot(en.x - stop.x, en.z - stop.z) < ENTRANCE_MERGE_M);
    if (!e) {
      e = { name: cleanName(stop.name), x: stop.x, z: stop.z, surfaceY: stop.surfaceY, stops: [] };
      entrances.push(e);
    }
    e.stops.push(stop);
  }
  return { paths, entrances, junctionAt, VE, halfSpacing: hs, stats: { paths: paths.length, stops: stops.length, entrances: entrances.length,
    junctions: [...byKey.values()].filter(x => x.length > 1).length } };
}

export function cleanName(name) {
  return String(name || '').replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
}

function indexAt(path, s) {
  const arr = path.s;
  if (s <= 0) return 0;
  if (s >= path.length) return path.n - 2;
  let lo = 0, hi = path.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= s) lo = mid; else hi = mid; }
  return Math.min(lo, path.n - 2);
}

export function pointAt(path, s, out = {}, side = 0) {
  const c = Math.min(path.length, Math.max(0, s));
  const i = indexAt(path, c);
  const span = path.s[i + 1] - path.s[i];
  const t = span > 0 ? (c - path.s[i]) / span : 0;
  const a = (side > 0 ? path.left : side < 0 ? path.right : null) || path;
  out.x = a.x[i] + (a.x[i + 1] - a.x[i]) * t;
  out.y = a.y[i] + (a.y[i + 1] - a.y[i]) * t;
  out.z = a.z[i] + (a.z[i + 1] - a.z[i]) * t;
  return out;
}

const _a = {}, _b = {};
/** Unit horizontal heading when travelling from s in direction dir (+1 / -1). */
export function headingAt(path, s, dir) {
  let s0 = s, s1 = s + dir * HEADING_PROBE_M;
  if (s1 > path.length) { s1 = path.length; s0 = Math.max(0, s1 - HEADING_PROBE_M); }
  if (s1 < 0) { s1 = 0; s0 = Math.min(path.length, HEADING_PROBE_M); }
  pointAt(path, s0, _a); pointAt(path, s1, _b);
  let x = _b.x - _a.x, z = _b.z - _a.z;
  // Near an end the probe is clamped: keep the travel sense.
  if ((dir > 0 && s1 < s0) || (dir < 0 && s1 > s0)) { x = -x; z = -z; }
  const len = Math.hypot(x, z);
  return len > 1e-9 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
}

/** +1 / -1 along the path that best matches a desired horizontal direction. */
export function travelDir(path, s, want, prevDir = 1) {
  const h = headingAt(path, s, 1);
  const d = h.x * want.x + h.z * want.z;
  if (Math.abs(d) < 0.05) return prevDir || 1;
  return d > 0 ? 1 : -1;
}

function nextJunction(path, s, dir, limit) {
  const J = path.junctions;
  if (dir > 0) {
    for (let i = 0; i < J.length; i++) if (J[i] > s + 1e-9) return J[i] <= limit ? J[i] : null;
  } else {
    for (let i = J.length - 1; i >= 0; i--) if (J[i] < s - 1e-9) return J[i] >= limit ? J[i] : null;
  }
  return null;
}

/** Pick the continuation at a junction that best matches `want`. */
export function chooseAt(net, pathId, s, dir, want) {
  const entries = net.junctionAt.get(`${pathId}:${s}`);
  const here = net.paths[pathId];
  const current = { path: pathId, s, dir };
  const canGo = (p, ss, d) => (d > 0 ? ss < p.length - 1e-6 : ss > 1e-6);
  const score = (p, ss, d) => { const h = headingAt(p, ss, d); return h.x * want.x + h.z * want.z; };
  if (!entries) return current;
  const back = headingAt(here, s, -dir); // where we came from
  let best = null, bestScore = -Infinity;
  const curScore = canGo(here, s, dir) ? score(here, s, dir) : -Infinity;
  for (const e of entries) {
    const p = net.paths[e.path];
    for (const d of [1, -1]) {
      if (!canGo(p, e.s, d)) continue;
      const h = headingAt(p, e.s, d);
      if (h.x * back.x + h.z * back.z > 0.9) continue; // straight back the way we came
      const sc = h.x * want.x + h.z * want.z;
      if (sc > bestScore) { bestScore = sc; best = { path: e.path, s: e.s, dir: d }; }
    }
  }
  // Stay on the current branch unless another is clearly better: overlapping
  // branches (shared track) must not flicker between each other.
  if (!best || curScore >= bestScore - 0.05) return current;
  return best;
}

/**
 * Move `pos` ({ path, s, dir }) `dist` metres toward the desired horizontal
 * direction `want`. Mutates pos. Returns { stopped } (true at a line end).
 */
export function advance(net, pos, dist, want) {
  let remaining = Math.max(0, dist);
  let stopped = false;
  let guard = 0;
  const path0 = net.paths[pos.path];
  pos.dir = travelDir(path0, pos.s, want, pos.dir);
  while (remaining > 1e-9 && guard++ < 64) {
    const p = net.paths[pos.path];
    const target = pos.s + pos.dir * remaining;
    const j = nextJunction(p, pos.s, pos.dir, target);
    if (j === null) {
      const clamped = Math.min(p.length, Math.max(0, target));
      if (clamped !== target) stopped = true;
      pos.s = clamped;
      remaining = 0;
      break;
    }
    remaining -= Math.abs(j - pos.s);
    pos.s = j;
    const next = chooseAt(net, pos.path, j, pos.dir, want);
    // The bore side is relative to each path's own orientation; carry it over
    // by travel sense (side x dir), so a branch drawn the other way round keeps
    // the walker in the same physical bore.
    if (pos.side && next.path !== pos.path) pos.side = pos.side * pos.dir * next.dir;
    pos.path = next.path; pos.s = next.s; pos.dir = next.dir;
  }
  return { stopped };
}

export function nearestEntrance(net, x, z, maxR) {
  let best = null, bd = maxR;
  for (const e of net?.entrances || []) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (d <= bd) { bd = d; best = e; }
  }
  return best;
}

/** The platform and travel direction at an entrance that best match the facing direction. */
export function chooseStop(net, entrance, facing) {
  let best = null, bestScore = -Infinity;
  for (const stop of entrance?.stops || []) {
    const p = net.paths[stop.path];
    for (const d of [1, -1]) {
      if (d > 0 ? stop.s >= p.length - 1e-6 : stop.s <= 1e-6) continue;
      const h = headingAt(p, stop.s, d);
      const sc = h.x * facing.x + h.z * facing.z;
      if (sc > bestScore) { bestScore = sc; best = { stop, dir: d }; }
    }
  }
  if (!best && entrance?.stops?.length) best = { stop: entrance.stops[0], dir: 1 };
  return best;
}

export function nearestStopOnPath(net, pathId, s, maxD) {
  const p = net.paths[pathId];
  let best = null, bd = maxD;
  for (const { s: ss, stop } of p?.stops || []) {
    const d = Math.abs(ss - s);
    if (d <= bd) { bd = d; best = stop; }
  }
  return best;
}
