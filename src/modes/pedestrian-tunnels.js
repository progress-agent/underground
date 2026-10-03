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
//                                             over by travel sense); returns { stopped, crossed, portal }
//   nearestStopOnPath(net, path, s, maxD)  -> stop within maxD metres of arc, or null
//
// Sprint 30Sep26w (D-041, Lane P):
//   path.stations    [{ s, id, name }] every station on the path (platform or not), for "towards X"
//   crossed          advance() reports each platform it passes as [{ stop, at }] (`at` = metres into
//                    the move). Arrival is the CROSSING of a platform's position along s, found inside
//                    the move itself, so no speed can step over it (a 30 m radius check at 200 m/s and
//                    a 50 ms frame is 10 m a frame; at 60 m/s it was a one-second window).
//   path.open        [[s0, s1], ...] arc intervals where the bore is in the open (markOpenSections):
//                    advance() stops at the first one it would enter and reports it as `portal`.
//   nextStation(path, s, dir)             -> the next station along the path from s, or null
//   markOpenSections(net, { groundY, isWater, VE }) -> finds each Tube line's portals geometrically
//   markOpenSectionsFromTrack(net, { classAt })  -> sprint 30Sep26w integration: portals from the drawn
//                                             railway (Lane R's data), preferred wherever it exists
//
// Sprint 01Oct26h (D-042 item 1, D-043 item 4, Lane P): the walk rides on to the ends of the lines, above
// ground too, and stops only at stations.
//   * every station vertex is a stop, surface and elevated stations included (stop.shallow marks one
//     shallower than MIN_PLATFORM_DEPTH_M, which used to be skipped); platforms are no longer forced
//     underground inside an open run;
//   * advance(net, pos, dist, want, { holdAtPortals, headingOf }): holdAtPortals (default true) keeps the
//     old hold at the mouth of an open interval, which the bore's lining (tube-interior.js
//     sampleBoreWindow) needs to draw its daylight cap; the walk passes false and crosses the mouth.
//     headingOf(path, s, dir) replaces headingAt for the direction of travel and the branch choice (the
//     open-air walk passes the drawn track's heading, open-air-map.js drawnHeading);
//   * path.edge [[s0, s1]]: stretches beyond the M25 map edge (markMapEdge); advance() always holds at
//     their start, whatever holdAtPortals, and reports { edge: true }.

// ── s02:O ── the Overground joins the network (overground-network.js builds its branches)
import { isOgLine, ogNameKeys } from './overground-network.js';
// ── /s02:O ──

export const SAMPLE_STEP_M = 10;
export const MIN_PLATFORM_DEPTH_M = 3;   // shallower stations (elevated DLR, surface Met) are stops marked `shallow` (s01:P)
export const HEADING_PROBE_M = 6;
const STATION_SNAP_M = 3;                // a station's position vs its branch vertex (both come from the same registry)
const ENTRANCE_MERGE_M = 40;             // stops closer than this share one entrance (interchanges)
// ── s02:O ──
export const INTERCHANGE_NAME_M = 400;   // an Overground stop also joins an entrance this near that carries its name
// ── /s02:O ──

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
  // ── s02:O ── an Overground path is the drawn track: every vertex (the drawn 12 m samples) is a sample, joined
  // by straight segments exactly as the walker is shown on them (overground-walk.js), with no spline between.
  if (isOgLine(lineId)) {
    const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = V[i].x; ys[i] = V[i].y; zs[i] = V[i].z;
      if (i > 0) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], (ys[i] - ys[i - 1]) / VE, zs[i] - zs[i - 1]);
    }
    return { id, lineId, n, x: xs, y: ys, z: zs, s, left: null, right: null, length: s[n - 1], vertexS: Array.from(s), vertices: V,
      junctions: [], stops: [], stations: [], open: [], edge: [] };
  }
  // ── /s02:O ──
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
    stations: [],    // [{ s, id, name }] every station vertex (s30:P), platform or not
    open: [],        // [[s0, s1]] in-the-open arc intervals (s30:P, markOpenSections)
    edge: [],        // [[s0, s1]] beyond the map edge (s01:P, markMapEdge): the walk holds at s0
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
      // s02:O an Overground path is the drawn track itself: one bore on its centreline, whatever the twin spacing.
      const path = samplePath(THREE, lineId, pts, VE, paths.length, sampleStep, isOgLine(lineId) ? 0 : hs);
      if (!(path.length > 0)) continue;
      // s02:O per-vertex record of where each vertex came from in the drawn data (overground-walk.js).
      // The filter above drops array properties, so it is read from `branch` and kept only while no vertex was dropped.
      if (branch?.og && branch.og.length === pts.length) { path.og = branch.og; path.branchRef = branch; }
      paths.push(path);
      path.vertices.forEach((v, i) => {
        // s02:O an Overground path meets another only where its network source says so (ogJunction): not at every one of its 12 m samples.
        if (path.og && branch.ogJunction && !branch.ogJunction[i]) return;
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
        // s02:O a station placed on a known vertex of a known branch (overground-network.js `ref`) is that vertex's: no scan.
        const only = st.ref ? (p.branchRef === st.ref.branch ? st.ref.vi : -1) : null;
        if (only === -1) continue;
        for (let i = only ?? 0, last = only === null ? p.vertices.length : only + 1; i < last; i++) {
          const v = p.vertices[i];
          if (Math.hypot(v.x - pos.x, v.z - pos.z) > STATION_SNAP_M) continue;
          // s30:P every station on the path, platform or not (the chooser's next station).
          if (!p.stations.some(x => Math.abs(x.s - p.vertexS[i]) < 1e-6)) {
            p.stations.push({ s: p.vertexS[i], id: st.id ?? null, name: st.name ?? st.id ?? '',
              ...(st.ids ? { ids: st.ids } : {}) });   // s02:O every naptan of a station listed twice
          }
          const platformY = v.y;
          const surfaceY = Number.isFinite(st.surfaceY) ? st.surfaceY : null;
          const depthM = surfaceY !== null ? (surfaceY - platformY) / VE
            : (Number.isFinite(st.depthM) ? st.depthM : null);
          // s01:P every station is a stop (D-042 item 1: "only possible to exit them at stations"),
          // surface and elevated ones too; `shallow` marks those that used to be skipped here.
          if (p.stops.some(x => Math.abs(x.s - p.vertexS[i]) < 1e-6)) continue;
          const shallow = depthM === null || depthM < minDepthM;
          const stop = { path: p.id, s: p.vertexS[i], lineId, name: st.name ?? st.id ?? '', id: st.id ?? null,
            x: v.x, z: v.z, platformY, surfaceY, depthM: depthM ?? 0, shallow };
          // s02:O an Overground stop stands where its station does (the street, the shaft and the interchange rule
          // read the site); its platform is the track vertex, at `s`. Naptans: every id of a station listed twice.
          if (st.site) { stop.x = st.site.x; stop.z = st.site.z; stop.site = { x: st.site.x, z: st.site.z }; stop.ids = st.ids ? st.ids.slice() : (st.id ? [st.id] : []); }
          p.stops.push({ s: stop.s, stop });
          stops.push(stop);
        }
      }
    }
  }
  for (const p of paths) { p.stops.sort((a, b) => a.s - b.s); p.stations.sort((a, b) => a.s - b.s); }
  const links = linkStations(paths, junctionAt);
  const ogLinks = linkOvergroundStations(paths, junctionAt, stops);   // s02:O

  const entrances = [];
  for (const stop of stops) {
    if (isOgLine(stop.lineId)) continue;   // s02:O the Overground's stops join after the Tube's and DLR's (below)
    let e = entrances.find(en => Math.hypot(en.x - stop.x, en.z - stop.z) < ENTRANCE_MERGE_M);
    if (!e) {
      e = { name: cleanName(stop.name), x: stop.x, z: stop.z, surfaceY: stop.surfaceY, stops: [] };
      entrances.push(e);
    }
    e.stops.push(stop);
  }
  // ── s02:O ── Interchanges with the Overground (D-048 item 5). An Overground stop, measured from its SITE,
  // joins every entrance within ENTRANCE_MERGE_M, or within INTERCHANGE_NAME_M that carries its name
  // (case, parentheticals, apostrophes and "&" ignored, a leading "London " optional): Overground
  // stations often sit further than 40 m from the Tube station they serve (Seven Sisters 220 m,
  // Liverpool Street 140 m). None founds a new entrance at the site; one is joined; several are MERGED into
  // the nearest (their stops move to it; it keeps its name, x, z and surfaceY), so the DLR's Stratford and
  // the Central's, or Liverpool Street's two, are one card with the Overground's rows too. Only entrances
  // an Overground stop matched are touched; every pair formed is listed in stats.ogInterchanges.
  const ogPairs = [], ogMerges = [];
  const keysOf = new WeakMap();
  const entranceKeys = (en) => {
    let k = keysOf.get(en);
    if (!k || k.n !== en.stops.length) { k = { n: en.stops.length, set: new Set(en.stops.flatMap(st => ogNameKeys(st.name))) }; keysOf.set(en, k); }
    return k.set;
  };
  for (const stop of stops) {
    if (!isOgLine(stop.lineId)) continue;
    const site = stop.site ?? { x: stop.x, z: stop.z };
    const mine = ogNameKeys(stop.name);
    const near = [];
    for (const en of entrances) {
      const d = Math.hypot(en.x - site.x, en.z - site.z);
      if (d < ENTRANCE_MERGE_M) near.push({ en, d, rule: 'distance' });
      else if (d <= INTERCHANGE_NAME_M && mine.some(k => entranceKeys(en).has(k))) near.push({ en, d, rule: 'name' });
    }
    if (!near.length) {
      entrances.push({ name: cleanName(stop.name), x: site.x, z: site.z, surfaceY: stop.surfaceY, stops: [stop] });
      continue;
    }
    near.sort((a, b) => a.d - b.d);
    const into = near[0].en;
    into.stops.push(stop);
    for (const { en, d, rule } of near) {
      ogPairs.push({ og: cleanName(stop.name), ogLine: stop.lineId, with: en.name, m: +d.toFixed(1), rule });
      if (en === into) continue;
      for (const st of en.stops) if (!into.stops.includes(st)) into.stops.push(st);
      entrances.splice(entrances.indexOf(en), 1);
      ogMerges.push({ og: cleanName(stop.name), keep: into.name, merged: en.name, m: +d.toFixed(1) });
    }
  }
  // Every entrance lists the cleaned names of all its stops (additive: `name` keeps its meaning).
  for (const en of entrances) en.names = [...new Set(en.stops.map(st => cleanName(st.name)))];
  // ── /s02:O ──
  return { paths, entrances, junctionAt, VE, halfSpacing: hs, stats: { paths: paths.length, stops: stops.length, entrances: entrances.length,
    junctions: [...byKey.values()].filter(x => x.length > 1).length, links,
    ...(ogPairs.length || ogLinks ? { ogLinks, ogInterchanges: ogPairs, ogMerges } : {}) } };
}

/** s01:P a path end at a station joins the same station on another path of its line within this (plan metres). */
export const STATION_LINK_M = 100;

/**
 * Station links (s01:P). The DLR's branches are resolved node by node from its
 * profile, so one station can sit at a different node on each piece that
 * reaches it (Westferry 86 m apart, West India Quay 58 m, Poplar 10 m, Canning
 * Town 31 m, Stratford 86 m), and pieces that meet only there share no vertex:
 * the walk dead-ended at Westferry on the way from Bank to Lewisham, a stretch
 * the 30Sep26w walk never reached because it stopped at Shadwell's mouth. A
 * path end that is a station and no junction is joined, as a junction, to the
 * same station (by name) on every other path of the line within
 * STATION_LINK_M; advance() then chooses there as at any junction. A different
 * station near a terminus (Tower Gateway beside the Bank branch) is not joined.
 * Returns the number of links made.
 */
function linkStations(paths, junctionAt) {
  const byLine = new Map();
  for (const p of paths) { if (isOgLine(p.lineId)) continue; if (!byLine.has(p.lineId)) byLine.set(p.lineId, []); byLine.get(p.lineId).push(p); }   // s02:O: the Overground links its own (linkOvergroundStations)
  const vertexAt = (p, s) => { const i = p.vertexS.findIndex(v => Math.abs(v - s) < 1e-6); return i >= 0 ? p.vertices[i] : null; };
  const pairs = [];
  for (const P of byLine.values()) {
    if (P.length < 2) continue;
    for (const a of P) {
      for (const endS of [0, a.length]) {
        if (a.junctions.some(j => Math.abs(j - endS) < 1e-6)) continue;
        const st = a.stations.find(x => Math.abs(x.s - endS) < 1e-6);
        const va = st && vertexAt(a, st.s);
        if (!va) continue;
        const name = cleanName(st.name);
        for (const b of P) {
          if (b === a) continue;
          for (const sb of b.stations) {
            if (cleanName(sb.name) !== name) continue;
            const vb = vertexAt(b, sb.s);
            if (vb && Math.hypot(vb.x - va.x, vb.z - va.z) <= STATION_LINK_M) pairs.push([{ path: a.id, s: endS }, { path: b.id, s: sb.s }]);
          }
        }
      }
    }
  }
  return mergeJunctionPairs(paths, junctionAt, pairs);
}

/**
 * Merge pairs of { path, s } ends into junction groups: every member of a group lists all of it
 * (s02:O: split out of linkStations unchanged, so the Overground's station junctions use it too).
 * Returns the number of pairs.
 */
function mergeJunctionPairs(paths, junctionAt, pairs) {
  if (!pairs.length) return 0;
  const groupOf = new Map();
  const keyOf = (e) => `${e.path}:${e.s}`;
  const group = (e) => groupOf.get(keyOf(e)) || (() => { const g = (junctionAt.get(keyOf(e)) || [e]).slice(); for (const x of g) groupOf.set(keyOf(x), g); return g; })();
  for (const [a, b] of pairs) {
    const ga = group(a), gb = group(b);
    if (ga === gb) continue;
    for (const x of gb) if (!ga.some(y => y.path === x.path && Math.abs(y.s - x.s) < 1e-6)) ga.push(x);
    for (const x of ga) groupOf.set(keyOf(x), ga);
  }
  for (const [k, g] of groupOf) {
    junctionAt.set(k, g);
    const [pid, ss] = [Number(k.slice(0, k.indexOf(':'))), Number(k.slice(k.indexOf(':') + 1))];
    const p = paths[pid];
    if (!p.junctions.some(j => Math.abs(j - ss) < 1e-6)) { p.junctions.push(ss); p.junctions.sort((x, y) => x - y); }
  }
  return pairs.length;
}

// ── s02:O ── Overground station junctions. A station on two parallel pieces of a line (Hackney Downs
// on both Weaver trunks) is one junction group, so a walker can change track there and reach Rectory
// Road from the Chingford trunk. Pairs every stop of an `og:` station with the first one.
function linkOvergroundStations(paths, junctionAt, stops) {
  const byStation = new Map();
  for (const stop of stops) {
    if (!isOgLine(stop.lineId) || !stop.ids?.length) continue;
    const k = `${stop.lineId}|${stop.ids[0]}`;
    if (!byStation.has(k)) byStation.set(k, []);
    byStation.get(k).push(stop);
  }
  const pairs = [];
  for (const list of byStation.values()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].path === list[0].path) continue;
      pairs.push([{ path: list[0].path, s: list[0].s }, { path: list[i].path, s: list[i].s }]);
    }
  }
  return mergeJunctionPairs(paths, junctionAt, pairs);
}
// ── /s02:O ──

const cleanMemo = new Map();   // s02:O station names are a few hundred and every network rebuild cleans them all again
export function cleanName(name) {
  const hit = typeof name === 'string' ? cleanMemo.get(name) : undefined;
  if (hit !== undefined) return hit;
  const out = String(name || '').replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
  if (typeof name === 'string' && cleanMemo.size < 4096) cleanMemo.set(name, out);
  return out;
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

/** +1 / -1 along the path that best matches a desired horizontal direction (s01:P headingOf: see advance). */
export function travelDir(path, s, want, prevDir = 1, headingOf = headingAt) {
  const h = headingOf(path, s, 1);
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

/**
 * Pick the continuation at a junction that best matches `want`. s01:P
 * `headingOf` (default headingAt, the chord) is how each continuation heads:
 * the open-air walk passes the drawn track's heading, so a fork in the open is
 * taken by the railway the walker sees, not by the station chords.
 */
export function chooseAt(net, pathId, s, dir, want, headingOf = headingAt) {
  const entries = net.junctionAt.get(`${pathId}:${s}`);
  const here = net.paths[pathId];
  const current = { path: pathId, s, dir };
  const canGo = (p, ss, d) => (d > 0 ? ss < p.length - 1e-6 : ss > 1e-6);
  const score = (p, ss, d) => { const h = headingOf(p, ss, d); return h.x * want.x + h.z * want.z; };
  if (!entries) return current;
  const back = headingOf(here, s, -dir); // where we came from
  let best = null, bestScore = -Infinity;
  const curScore = canGo(here, s, dir) ? score(here, s, dir) : -Infinity;
  for (const e of entries) {
    const p = net.paths[e.path];
    for (const d of [1, -1]) {
      if (!canGo(p, e.s, d)) continue;
      const h = headingOf(p, e.s, d);
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
 * Platforms on `p` passed when moving from `from` to `to` (s30:P): the half-open
 * interval that excludes the start and includes the end, so a walker standing
 * on a platform does not "arrive" as it leaves, and a platform at a junction
 * vertex is counted once, at the end of the move that reaches it.
 */
function crossedOn(p, from, to, travelled, out) {
  if (to === from || !p.stops.length) return;
  const lo = Math.min(from, to), hi = Math.max(from, to), up = to > from;
  for (const { s, stop } of p.stops) {
    if (up ? (s > lo + 1e-9 && s <= hi + 1e-9) : (s >= lo - 1e-9 && s < hi - 1e-9)) {
      out.push({ stop, at: travelled + Math.abs(s - from) });
    }
  }
  if (!up) out.sort((a, b) => a.at - b.at);
}

/**
 * Where a move from `from` toward `limit` in direction `dir` is held short of
 * an in-the-open interval (s30:P portals): `inset` metres inside the tunnel
 * before its mouth, or null when nothing is in the way. A walker already
 * inside an open interval is not held (it can always walk back out); one
 * already within the inset of a mouth cannot go nearer to it.
 */
function portalAhead(p, from, dir, limit, inset = 0) {
  const O = p.open;
  if (!O || !O.length) return null;
  for (const [a, b] of O) if (from > a + 1e-6 && from < b - 1e-6) return null;
  let best = null;
  for (const [a, b] of O) {
    const mouth = dir > 0 ? a : b;
    if (dir > 0 ? mouth < from - 1e-9 : mouth > from + 1e-9) continue;   // behind the walker
    const hold = dir > 0 ? Math.max(from, a - inset) : Math.min(from, b + inset);
    if (dir > 0 ? hold > limit : hold < limit) continue;                   // beyond this move
    if (best === null || (dir > 0 ? hold < best.hold : hold > best.hold)) best = { hold, mouth };
  }
  return best;
}

/**
 * Where a move from `from` toward `limit` in direction `dir` is held at the
 * map edge (s01:P): the start of the first edge interval ahead (path.edge,
 * markMapEdge), or null. A walker already beyond it (placed there) is held
 * where it is, except walking back toward the map.
 */
function edgeAhead(p, from, dir, limit) {
  const E = p.edge;
  if (!E || !E.length) return null;
  let best = null;
  for (const [a, b] of E) {
    if (from > a + 1e-9 && from < b - 1e-9) {
      // Beyond the hold already: only the way back to the map is open.
      const back = a > 1e-6 ? -1 : 1;   // an edge at the path's start opens the other way
      if (dir === back) continue;
      return from;
    }
    const hold = dir > 0 ? a : b;
    if (dir > 0 ? hold < from - 1e-9 : hold > from + 1e-9) continue;   // behind the walker
    if (dir > 0 ? hold > limit : hold < limit) continue;               // beyond this move
    if (best === null || (dir > 0 ? hold < best : hold > best)) best = hold;
  }
  return best;
}

/**
 * Move `pos` ({ path, s, dir }) `dist` metres toward the desired horizontal
 * direction `want`. Mutates pos. Returns { stopped, crossed, portal, edge }:
 * stopped at a line end, a portal or the map edge; crossed = platforms passed
 * [{ stop, at }]; portal = { path, s, mouth } when the move was held
 * `portalInset` metres short of the mouth of a tunnel (mouth = the mouth's own
 * arc); edge = true when it was held at the map edge (s01:P).
 * s01:P options: holdAtPortals (default true: the bore's lining relies on the
 * hold to draw its daylight cap; the open-air walk passes false and walks on
 * out of the tunnel), headingOf(path, s, dir) (default headingAt) for the
 * direction of travel, branchHeadingOf (default headingOf) for the choice at
 * junctions.
 */
export function advance(net, pos, dist, want, { portalInset = 0, holdAtPortals = true, headingOf = headingAt, branchHeadingOf = headingOf } = {}) {
  let remaining = Math.max(0, dist);
  let stopped = false;
  let guard = 0;
  let travelled = 0;
  let portal = null;
  let edge = false;
  const crossed = [];
  const path0 = net.paths[pos.path];
  pos.dir = travelDir(path0, pos.s, want, pos.dir, headingOf);
  while (remaining > 1e-9 && guard++ < 64) {
    const p = net.paths[pos.path];
    const target = pos.s + pos.dir * remaining;
    const j = nextJunction(p, pos.s, pos.dir, target);
    let reach = j === null ? Math.min(p.length, Math.max(0, target)) : j;
    // s01:P the map edge holds every walk, whatever holdAtPortals.
    const e = edgeAhead(p, pos.s, pos.dir, reach);
    if (e !== null) {
      crossedOn(p, pos.s, e, travelled, crossed);
      travelled += Math.abs(e - pos.s);
      pos.s = e;
      stopped = true;
      edge = true;
      break;
    }
    const held = holdAtPortals ? portalAhead(p, pos.s, pos.dir, reach, portalInset) : null;
    if (held !== null) {
      crossedOn(p, pos.s, held.hold, travelled, crossed);
      travelled += Math.abs(held.hold - pos.s);
      pos.s = held.hold;
      stopped = true;
      portal = { path: pos.path, s: held.hold, mouth: held.mouth };
      break;
    }
    if (j === null) {
      const clamped = reach;
      if (clamped !== target) stopped = true;
      crossedOn(p, pos.s, clamped, travelled, crossed);
      travelled += Math.abs(clamped - pos.s);
      pos.s = clamped;
      remaining = 0;
      break;
    }
    crossedOn(p, pos.s, j, travelled, crossed);
    travelled += Math.abs(j - pos.s);
    remaining -= Math.abs(j - pos.s);
    pos.s = j;
    const next = chooseAt(net, pos.path, j, pos.dir, want, branchHeadingOf);
    // The bore side is relative to each path's own orientation; carry it over
    // by travel sense (side x dir), so a branch drawn the other way round keeps
    // the walker in the same physical bore.
    if (pos.side && next.path !== pos.path) pos.side = pos.side * pos.dir * next.dir;
    pos.path = next.path; pos.s = next.s; pos.dir = next.dir;
  }
  return { stopped, crossed, portal, edge };
}

/** The next station along `path` from `s` in direction `dir` (s30:P), or null. */
export function nextStation(path, s, dir) {
  const S = path?.stations || [];
  if (dir > 0) { for (const st of S) if (st.s > s + 1e-6) return st; }
  else { for (let i = S.length - 1; i >= 0; i--) if (S[i].s < s - 1e-6) return S[i]; }
  return null;
}

export const OPEN_CLEARANCE_M = 0.5;  // the track is "in the open" within this of the surface (or above it)
export const OPEN_MIN_RUN_M = 60;     // shorter surfacings are noise in the depth model, not portals
export const OPEN_GROUND_SMOOTH_M = 120; // ground averaged over +/- this along the line (the terrain grid is ~137 x 98 m a cell)

/**
 * Portals, found geometrically (s30:P). Tube lines carry no open-air classes,
 * so a path is "in the open" wherever its centreline (the track, at the depth
 * the network draws it) comes within OPEN_CLEARANCE_M of the ground or rises
 * above it; each run at least OPEN_MIN_RUN_M long becomes an interval in
 * path.open, whose ends are the portals where the line leaves its tunnel.
 * The ground is averaged along the line over +/- OPEN_GROUND_SMOOTH_M, so a
 * dip narrower than a terrain cell or two (a buried valley in the City, a
 * dock) does not open a tunnel that is only near it. Over water the track is
 * in the open only when it is above the water (a bridge); under it (the
 * tubes' bed clearance puts the crown near the carved bed) it is not.
 * `groundY(x, z)` is canonical ground Y (or null where unknown, which counts
 * as underground); `waterY(x, z)` the water top where there is water, else
 * null. Returns the number of portals, or -1 when the ground is not available
 * yet (nothing is marked).
 */
export function markOpenSections(net, { groundY, isWater = null, waterY = null, VE = net?.VE || 5,
  clearanceM = OPEN_CLEARANCE_M, minRunM = OPEN_MIN_RUN_M, smoothM = OPEN_GROUND_SMOOTH_M } = {}) {
  if (!net || typeof groundY !== 'function') return -1;
  // The ground must exist somewhere on the network before anything is marked.
  let known = 0;
  for (const p of net.paths) {
    for (let j = 0; j < p.n && known < 8; j += Math.max(1, Math.floor(p.n / 4))) if (Number.isFinite(groundY(p.x[j], p.z[j]))) known++;
  }
  if (!known) return -1;
  let portals = 0;
  for (const p of net.paths) {
    if (p.og) continue;   // s02:O the Overground's open stretches come from its drawn track (overground-walk.js)
    const raw = new Float64Array(p.n), known = new Uint8Array(p.n);
    for (let j = 0; j < p.n; j++) { const g = groundY(p.x[j], p.z[j]); if (Number.isFinite(g)) { raw[j] = g; known[j] = 1; } }
    // Box average over +/- smoothM of arc (two pointers).
    const ground = new Float64Array(p.n);
    let lo = 0, hi = -1, sum = 0, cnt = 0;
    for (let j = 0; j < p.n; j++) {
      while (hi + 1 < p.n && p.s[hi + 1] <= p.s[j] + smoothM) { hi++; if (known[hi]) { sum += raw[hi]; cnt++; } }
      while (p.s[lo] < p.s[j] - smoothM) { if (known[lo]) { sum -= raw[lo]; cnt--; } lo++; }
      ground[j] = known[j] && cnt ? sum / cnt : NaN;
    }
    const isOpen = (j) => {
      const g = ground[j];
      if (!Number.isFinite(g)) return false;
      const w = waterY ? waterY(p.x[j], p.z[j]) : (isWater && isWater(p.x[j], p.z[j]) ? Infinity : null);
      if (w !== null && w !== undefined) return p.y[j] >= w;   // on a bridge, or under the water
      return p.y[j] >= g - clearanceM * VE;
    };
    const flags = new Array(p.n);
    for (let j = 0; j < p.n; j++) flags[j] = isOpen(j);
    portals += setOpenIntervals(p, flags, minRunM);
  }
  net.openMarked = true;
  net.openSource = 'ground';
  net.stats.portals = portals;
  return portals;
}

/**
 * path.open from per-sample in-the-open flags (shared by both portal finders):
 * each run of open samples at least minRunM long becomes an interval, its
 * boundaries half-way between an underground sample and an open one. Returns
 * the number of portals (interval ends inside the path). (s01:P: platforms are
 * no longer forced underground: a surface station is a stop inside its open
 * run, D-042 item 1.)
 */
function setOpenIntervals(p, flags, minRunM) {
  const open = [];
  let start = null;
  for (let j = 0; j <= p.n; j++) {
    const f = j < p.n && flags[j];
    if (f && start === null) start = j;
    if (!f && start !== null) {
      const end = j - 1;
      const s0 = start > 0 ? (p.s[start - 1] + p.s[start]) / 2 : 0;
      const s1 = end < p.n - 1 ? (p.s[end] + p.s[end + 1]) / 2 : p.length;
      if (s1 - s0 >= minRunM) open.push([s0, s1]);
      start = null;
    }
  }
  p.open = open;
  let portals = 0;
  for (const [a, b] of open) portals += (a > 1e-6 ? 1 : 0) + (b < p.length - 1e-6 ? 1 : 0);
  return portals;
}

// A bore sample takes the class of its line's nearest drawn track within this, in plan: the reach Lane R's
// surface-station flag and Lane T's station matching use. Measured against Lane R's portal records (01Oct26h,
// 150 tunnel mouths, platform gaps excluded): median 56 m, p90 389 m (120 m reach: p90 586 m).
export const TRACK_MATCH_M = 300;

/**
 * Portals from the drawn railway (sprint 30Sep26w integration; supersedes
 * markOpenSections wherever Lane R's surface railway exists). The geometric
 * finder above asks whether the bore reaches the ground, but the app's depth
 * model draws most open-air Tube stretches 7 to 32 m underground (Epping,
 * Loughton and Leytonstone 28 m, Rayners Lane 30 m), so it found no portal at
 * all on six lines (the lane verifier's blocking finding). The surface railway
 * (public/data/tube-surface.json, src/tube-surface-rail.js) carries each
 * line's real open-air classes, shared track included.
 *
 * `classAt(lineId, x, z, reachM)` -> 1 where the line's nearest drawn track
 * within reachM is open, 0 where it is tunnel, null where none of its track is
 * that near (src/modes/open-track.js builds it). A bore is a station-chord
 * curve, so on long open stretches it can run hundreds of metres from the
 * real track: a sample with no match takes the class of the matched samples
 * either side of it along the path, split half-way where the two differ (a
 * portal between them). A path with no match at all is left underground and
 * counted (stats.unmatchedPaths). Platforms stay underground, as in the
 * geometric finder: at a surface station the walk ends at once and the street
 * is offered. Returns the number of portals; stats.openShare is each line's
 * share of bore length marked open.
 */
export function markOpenSectionsFromTrack(net, { classAt, reachM = TRACK_MATCH_M, minRunM = OPEN_MIN_RUN_M } = {}) {
  if (!net || typeof classAt !== 'function') return -1;
  let portals = 0, unmatched = 0;
  const share = {};
  for (const p of net.paths) {
    if (p.og) continue;   // s02:O see markOpenSections
    const c = new Int8Array(p.n);
    let known = 0;
    for (let j = 0; j < p.n; j++) {
      const k = classAt(p.lineId, p.x[j], p.z[j], reachM);
      c[j] = k === null || k === undefined ? -1 : (k ? 1 : 0);
      if (c[j] >= 0) known++;
    }
    if (!known) { unmatched++; p.open = []; continue; }
    for (let j = 0; j < p.n;) {
      if (c[j] >= 0) { j++; continue; }
      let k = j;
      while (k < p.n && c[k] < 0) k++;
      const L = j > 0 ? c[j - 1] : -1, R = k < p.n ? c[k] : -1;
      const mid = L >= 0 && R >= 0 ? (p.s[j - 1] + p.s[k]) / 2 : null;
      for (let q = j; q < k; q++) c[q] = L < 0 ? R : R < 0 ? L : (p.s[q] <= mid ? L : R);
      j = k;
    }
    const flags = Array.from(c, v => v === 1);
    portals += setOpenIntervals(p, flags, minRunM);
    const sh = share[p.lineId] ||= { open: 0, length: 0 };
    sh.length += p.length;
    for (const [a, b] of p.open) sh.open += b - a;
  }
  net.openMarked = true;
  net.openSource = 'track';
  net.stats.portals = portals;
  net.stats.unmatchedPaths = unmatched;
  net.stats.openShare = Object.fromEntries(Object.entries(share).map(([l, v]) => [l, v.length ? v.open / v.length : 0]));
  return portals;
}

// ── s01:P the map edge ───────────────────────────────────────────────────────
export const EDGE_HOLD_M = 150;   // the walk holds this far (arc) inside where its line leaves the map
const EDGE_STEP_M = 10;
const OG_EDGE_STEP_M = 80;   // s02:O

/**
 * The M25 map edge (s01:P; D-043 item 4: "the walk stops at the M25 edge. The
 * Central's last stop is Theydon Bois and the Metropolitan's is Rickmansworth").
 * `inside(x, z)` says whether a point is on the map (s01:P: main.js isInsideM25;
 * s02:T, D-048 item 7: the walk's bounds, the terrain grid inset 200 m, so the lines
 * run on to their termini and nothing is held; call this only once it is loaded,
 * inside(1e6, 1e6) === false). Each stretch
 * of a path whose point is off the map becomes path.edge [s0, s1], s0 holdM of
 * arc inside the first point off it, so advance() holds the walk there. Stops
 * in an edge stretch are dropped (Epping, Chorleywood): from path.stops, from
 * their entrance, and the entrance itself when it has none left; path.stations
 * is untouched, so "towards Epping" still reads as TfL names it.
 * `positionsAt(path, s)` (optional) returns more points to test at s (the
 * open-air walk adds the drawn track it shows there): off the map if any is.
 * `only` (optional Set of path ids): mark just those paths (the others keep theirs).
 * Returns the number of stops dropped, or -1 when `inside` is missing.
 */
export function markMapEdge(net, { inside, holdM = EDGE_HOLD_M, stepM = EDGE_STEP_M, positionsAt = null, only = null } = {}) {
  if (!net || typeof inside !== 'function') return -1;
  const tmp = {};
  const offAt = (p, s) => {
    pointAt(p, s, tmp, 0);
    if (!inside(tmp.x, tmp.z)) return true;
    // s02:O an Overground path IS the drawn track: no second point is shown there to test.
    if (p.og) return false;
    for (const q of positionsAt ? (positionsAt(p, s) || []) : []) if (q && !inside(q.x, q.z)) return true;
    return false;
  };
  let dropped = 0;
  const gone = new Set();
  for (const p of net.paths) {
    if (only && !only.has(p.id)) { if (!p.edge) p.edge = []; continue; }
    // s02:O the Overground's 210 km are stepped coarsely (a pass over the polygon a step costs a microsecond);
    // each boundary is still bisected to a metre, and the edge is a smooth ring, not a saw.
    const n = Math.max(2, Math.ceil(p.length / (p.og ? OG_EDGE_STEP_M : stepM)) + 1);
    const S = (k) => (p.length * k) / (n - 1);
    const runs = [];
    let start = null;
    for (let k = 0; k <= n; k++) {
      const off = k < n && offAt(p, S(k));
      if (off && start === null) start = k;
      if (!off && start !== null) { runs.push([start, k - 1]); start = null; }
    }
    // Refine each boundary to a metre by bisection between an on-map and an off-map sample.
    const refine = (lo, hi) => { let a = S(lo), b = S(hi); const offA = offAt(p, a);
      for (let i = 0; i < 12 && Math.abs(b - a) > 1; i++) { const m = (a + b) / 2; if (offAt(p, m) === offA) a = m; else b = m; } return b; };
    const edge = [];
    for (const [k0, k1] of runs) {
      const a = k0 > 0 ? refine(k0 - 1, k0) : 0;
      const b = k1 < n - 1 ? refine(k1 + 1, k1) : p.length;
      edge.push([Math.max(0, a - (k0 > 0 ? holdM : 0)), Math.min(p.length, b + (k1 < n - 1 ? holdM : 0))]);
    }
    // Merge overlapping stretches.
    edge.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const e of edge) { const last = merged.at(-1); if (last && e[0] <= last[1]) last[1] = Math.max(last[1], e[1]); else merged.push(e.slice()); }
    p.edge = merged;
    const keep = [];
    for (const x of p.stops) {
      // Off the map itself, or inside the stretch held back from it (a stop at the path's very end included).
      const beyond = offAt(p, x.s) || merged.some(([a, b]) => (x.s > a + 1e-6 || a <= 1e-6) && (x.s < b - 1e-6 || b >= p.length - 1e-6));
      if (beyond) { gone.add(x.stop); dropped++; }
      else keep.push(x);
    }
    p.stops = keep;
  }
  if (gone.size) {
    for (const e of net.entrances) e.stops = e.stops.filter(st => !gone.has(st));
    net.entrances = net.entrances.filter(e => e.stops.length);
    net.stats.stops -= gone.size;
    net.stats.entrances = net.entrances.length;
  }
  net.edgeMarked = true;
  net.stats.edgeStops = dropped;
  return dropped;
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
