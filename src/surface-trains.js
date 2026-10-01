// Surface trains: the Tube and DLR trains on the open-air track (sprint
// 30Sep26w, D-041 item 2, Lane T). Jordan, 30Sep26w: the open-air Tube and DLR
// are drawn exactly like the Overground, trains included.
//
// They are the SAME trains as the underground timetable: every surface train
// is a tube train of trains.js (trainSystem.allTrains), placed by
// trainStateAt(ud, simT) and mapped from its station-chord curve onto the
// open-air track (src/surface-train-map.js, which documents the mapping and
// its error bound). So a train leaving a portal carries on along the surface,
// two loads at the same simulation time draw the same trains in the same
// places, trains advance while offscreen (their position is a function of the
// clock, never of the frames drawn), and the shared pause and speed apply
// (trainSystem.simTime is the clock updateTrains advances).
//
// Drawn in the Overground trains' style (overground-trains.js): instanced
// bodies, roofs and windows in the Overground's own colours (body and roof in
// its light grey, Jordan 23Sep26w; line identity stays on the track stripe),
// at true size (D-039, trueHeadingBasis), with each line's stock profile:
//   * subsurface: S7 and S8 Stock (Metropolitan, District, Circle, Hammersmith
//     & City), full-height sides;
//   * deep: the small deep-tube profile (1972, 1973, 1992, 1995 and 1996
//     Stock: Bakerloo, Piccadilly, Central and Waterloo & City, Northern,
//     Jubilee), sides curving in to the roof;
//   * dlr: B07 two-section articulated units, three to a train.
// Dimensions and sources: surface-train-map.js STOCK. Variants are separate
// meshes, one InstancedMesh per profile and part (body with its roof, and
// windows: six draws at most): no per-instance colour
// (D-015); a stock's exact width, height and car length are its instance
// matrix's scale, which is not colour.
//
// One TOP-LEVEL group, `surface-trains`, never `line:` (D-040's cull hides
// every `line:*` group from above-ground cameras; the underground trains stay
// in theirs and stay hidden from above). A car is drawn only where its centre
// is on open track: in a tunnel the underground train is the one drawn.
//
// Economies (as overground-trains.js with every economy on, always): live cars
// are written to the front of each mesh and only that range is uploaded; trains
// more than VISIBLE_DISTANCE away in plan are not written (the Overground's
// distance cull), nor trains whose bounding sphere (half the train's length
// plus TRAIN_SPHERE_MARGIN_M) is outside the camera's frustum (the M25's
// test, conservative: no car that could be in view is left out); a hidden
// layer or line writes nothing. Each train is first tested at its underground
// position, which is within TRACK_ERROR_BOUND_M of its surface twin, so a
// train that cannot be in view costs no mapping work (the five standard views:
// 0.03 to 0.10 ms a frame on the M2 Max). None of these changes a pixel.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trainStateAt } from './trains.js';
import { trueHeadingBasis } from './true-proportion.js';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { BODY_GREY } from './overground-trains.js';
import { pathRange } from './tube-surface-rail.js';
import { BASE_LIFT } from './surface-rail.js';
import {
  PROFILES, STOCK, LINE_STOCK, carLayout, buildNetwork, buildSegmentIndex, mapTubeCurve, mapSnapCurve,
  runAt, sAt, sampleRun, laneOffset, laneDistance, computeCrossSlopes, profileGeometries, TRACK_ERROR_BOUND_M, LANE_SPACING_M,
} from './surface-train-map.js';

const VE = VERTICAL_EXAGGERATION;
export const SURFACE_TRAINS_NAME = 'surface-trains';
export const VISIBLE_DISTANCE = 12000; // overground-trains.js
const BUILD_BUDGET_MS = 6;             // curve mappings computed per frame at most (load and resnaps)
export const TRAIN_SPHERE_MARGIN_M = 25; // lanes, body height and a curve's sagitta over half a train

// ── Networks (from Lane R's built paths) ─────────────────────────────────────
function canonicalOverground(p) { return { x: p.x, z: p.z, terrainY: p.terrainY, y: p.terrainY + p.liftM * VE, cls: p.cls }; }

/** Track pieces of `lineId`: its own corridors and every shared-track stretch of another owner its colour is on. */
export function linePieces({ lineId, data, ownerPaths, overground }) {
  const pieces = [];
  const isDlr = lineId === 'dlr';
  for (const path of ownerPaths.get(lineId) || []) if (path && path.length >= 2) pieces.push({ pts: path, morph: !isDlr, own: true });
  for (const line of data.lines) {
    if (line.id === lineId) continue;
    const paths = ownerPaths.get(line.id) || [];
    line.branches.forEach((b, bi) => {
      for (const band of b.bands || []) {
        if (!band.lines.includes(lineId) || !paths[bi]) continue;
        const r = pathRange(paths[bi], band.j0, band.j1);
        // A Tube owner's corridor: this line runs outside the owner's lanes, one LANE_SPACING_M per band (surface-train-map.js).
        if (r) pieces.push({ pts: paths[bi].slice(r[0], r[1] + 1), morph: line.id !== 'dlr', owner: line.id, laneExtra: LANE_SPACING_M * Math.max(1, band.lines.indexOf(lineId)) });
      }
    });
  }
  for (const og of data.overgroundShared || []) {
    if (!og.lines.includes(lineId)) continue;
    const path = overground?.userData.linePaths?.get(og.overground)?.[og.branch];
    if (!path) continue;
    const r = pathRange(path, og.j0, og.j1);
    // The Overground's corridor: the Tube line runs on the Overground's own rails, in its lanes.
    if (r) pieces.push({ pts: path.slice(r[0], r[1] + 1).map(canonicalOverground), morph: true, owner: og.overground, laneExtra: 0 });
  }
  return pieces;
}

export function createSurfaceTrains({ scene, trainSystem, surfaceRail, overground = null, dlrProfile = null, getTerrainMeshSurfaceY, projectStation, heightScale = 1 }) {
  const data = surfaceRail.data;
  const group = new THREE.Group();
  group.name = SURFACE_TRAINS_NAME;
  group.userData = { kind: 'surface-trains' };
  let ratio = heightScale;

  // Materials: the Overground fleet's own (overground-trains.js), shared by every profile.
  // Body and roof are one geometry, drawn with the body's material: they share
  // its grey (Jordan, 23Sep26w), and the roof's own material differed by 0.05
  // in roughness and metalness; one draw fewer per profile, which the weak
  // machine needs (at the street view nine draws tipped Automatic off its
  // shadow rung against Lane R's head; measured 01Oct26h).
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: BODY_GREY, roughness: .65, metalness: .15 }),
    windows: new THREE.MeshBasicMaterial({ color: 0x24384b, toneMapped: false }),
  };
  const PARTS = ['body', 'windows'];
  const profiles = new Map(); // profile id -> { geos, meshes, capacity, slot }
  for (const [id, profile] of Object.entries(PROFILES)) {
    const { body, roof, windows } = profileGeometries(profile);
    const r = roof.toNonIndexed(); r.deleteAttribute('uv'); roof.dispose();
    const shell = mergeGeometries([body, r], false); body.dispose(); r.dispose();
    profiles.set(id, { id, profile, geos: { body: shell, windows }, meshes: null, capacity: 0, slot: 0 });
  }
  function ensureCapacity(p, need) {
    if (need <= p.capacity) return;
    const capacity = Math.max(64, need, p.capacity * 2);
    if (p.meshes) for (const m of p.meshes) { group.remove(m); m.dispose(); }
    p.meshes = PARTS.map(part => {
      const m = new THREE.InstancedMesh(p.geos[part], materials[part], capacity);
      m.name = `surface-train-${part === 'body' ? 'bodies' : 'windows'}-${p.id}`; // bodies: body and roof
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // instances span the map; bounds would go stale (as the Overground)
      m.count = 0; m.visible = false;
      m.userData = { kind: 'surface-train', profile: p.id };
      group.add(m);
      return m;
    });
    p.capacity = capacity;
  }

  // Stock per line, with its car layout and its scale against its profile.
  const stockOf = new Map();
  for (const [lineId, key] of Object.entries(LINE_STOCK)) {
    const s = STOCK[key], prof = PROFILES[s.profile];
    stockOf.set(lineId, { key, ...s, layout: carLayout(s), sx: s.widthM / prof.widthM, sy: s.heightM / prof.heightM });
  }

  // ── Networks and mappings ──────────────────────────────────────────────────
  const stationsOf = new Map(); // lineId -> [{key, x, z}]
  for (const line of data.lines) stationsOf.set(line.id, line.stations.map(s => { const p = projectStation(s.lat, s.lon); return { key: s.naptan, x: p.x, z: p.z, name: s.name }; }));
  const nets = new Map(); // lineId -> { net, cache, dlrPaths, index }
  function networkFor(lineId) {
    const own = surfaceRail.paths.get(lineId);
    let n = nets.get(lineId);
    if (n && n.ownPaths === own && n.ratio === (lineId === 'dlr' ? ratio : n.ratio)) return n;
    const net = computeCrossSlopes(buildNetwork(linePieces({ lineId, data, ownerPaths: surfaceRail.paths, overground })), getTerrainMeshSurfaceY);
    n = { net, cache: { routes: new Map(), stationNode: new Map() }, ownPaths: own, ratio, index: lineId === 'dlr' ? buildSegmentIndex(net) : null };
    nets.set(lineId, n);
    return n;
  }
  const mappings = new WeakMap(); // curve -> { runs, stats, lineId, ratio }
  const pendingStats = { pending: 0, built: 0, buildMs: 0 };
  function dlrFallback(x, y, z) {
    const base = getTerrainMeshSurfaceY({ x, z });
    const b = Number.isFinite(base) ? base : y;
    const s = dlrProfile?.sample({ x, z, y, maxDistance: 60 });
    const open = s ? s._dlrProfile.classification !== 'tunnel' : y >= b - 1;
    return { base: b, y: open ? Math.max(y, b + BASE_LIFT * ratio) : y, open };
  }
  function buildMapping(ud) {
    const lineId = ud.lineId;
    const { net, cache, index } = networkFor(lineId);
    const t0 = performance.now();
    const m = lineId === 'dlr'
      ? mapSnapCurve({ curve: ud.curve, net, index, ratio, fallback: dlrFallback, ve: VE })
      : mapTubeCurve({ curve: ud.curve, stationUs: ud.stationUs, stations: stationsOf.get(lineId) || [], net, cache, getY: getTerrainMeshSurfaceY });
    m.lineId = lineId; m.ratio = ratio; m.net = net;
    pendingStats.built++; pendingStats.buildMs += performance.now() - t0;
    mappings.set(ud.curve, m);
    return m;
  }
  // While a curve's mapping waits for the frame budget (a resnap replaces the
  // curves; the DLR's are rebuilt at every Master change), its train keeps its
  // last one: the plan is unchanged by either, only heights move a little.
  const lastByTrain = new Map(); // train id -> its last fresh mapping
  let staleUsed = 0;
  function freshMapping(ud) {
    const m = mappings.get(ud.curve);
    // The DLR's own track is drawn at the current structure scale: its mapping follows Master.
    if (m && ud.lineId === 'dlr' && (m.ratio !== ratio || m.net !== networkFor('dlr').net)) return null;
    return m ?? null;
  }
  function mappingOf(ud, budgetEnd = Infinity) {
    let m = freshMapping(ud);
    if (!m && performance.now() <= budgetEnd) m = buildMapping(ud);
    if (m) { lastByTrain.set(ud.id, m); return m; }
    staleUsed++;
    return lastByTrain.get(ud.id) ?? null;
  }

  // ── Placement (pure in simT) ───────────────────────────────────────────────
  const pt = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, open: 0, inside: false, extra: 0, run: null, seg: -1 };
  const dir = new THREE.Vector3(), basis = { side: new THREE.Vector3(), up: new THREE.Vector3(), forward: new THREE.Vector3() };
  /** The train's place on the surface at simT: { run, s, u, sign } or null (underground, unmapped, or no stock). */
  function placeAt(train, simT, budgetEnd) {
    const ud = train.userData;
    if (!stockOf.has(ud.lineId) || !ud.curve) return null;
    const m = mappingOf(ud, budgetEnd);
    if (!m || !m.runs.length) return null;
    const u = trainStateAt(ud, simT).t;
    const run = runAt(m.runs, u);
    if (!run) return null;
    return { run, s: sAt(run, u), u, sign: ud.dir > 0 ? 1 : -1, stock: stockOf.get(ud.lineId) };
  }
  /** Each car's pose: calls fn(carIndex, matrixElements16) for cars on open track (or writes them at `write`, a slot writer). */
  const els = new Float64Array(16);
  function forEachCar(place, fn) {
    const { run, s, sign, stock } = place;
    const k = VE * ratio; // canonical vertical factor of one real metre (5 / Master), as the Overground
    for (let c = 0; c < stock.layout.length; c++) {
      const car = stock.layout[c];
      // The lane is left of travel (north when heading east); offsetRails' "left" normal, which
      // the cross-slopes use, is (-dz, dx), south when heading east: so the lane lies at -sign x lane on it.
      sampleRun(run, s + sign * car.offset, ratio, pt, 0, -sign);
      if (!pt.inside || !pt.open) continue;
      const { ox, oz } = laneOffset(pt, sign);
      dir.set(pt.dx * sign, pt.dy * sign, pt.dz * sign);
      trueHeadingBasis(dir, k, basis);
      const sd = basis.side, up = basis.up, fw = basis.forward, L = car.length;
      els[0] = sd.x * stock.sx; els[1] = sd.y * stock.sx; els[2] = sd.z * stock.sx; els[3] = 0;
      els[4] = up.x * stock.sy; els[5] = up.y * stock.sy; els[6] = up.z * stock.sy; els[7] = 0;
      els[8] = fw.x * L; els[9] = fw.y * L; els[10] = fw.z * L; els[11] = 0;
      els[12] = pt.x + ox; els[13] = pt.y; els[14] = pt.z + oz; els[15] = 1;
      fn(c, els);
    }
  }

  const lineShown = lineId => surfaceRail.groups.get(lineId)?.visible !== false;
  const shown = () => { for (let o = group; o; o = o.parent) if (o.visible === false) return false; return true; };
  const stats = { trains: 0, cars: 0, lines: {}, written: 0, skippedHidden: 0, syncMs: 0, pending: 0, outOfView: 0, far: 0, stale: 0 };
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), sphere = new THREE.Sphere();
  let capacityKey = null;
  // The slot writer for update(): one function, no per-train closure.
  let writeTo = null, written = 0;
  const writeCar = (c, e) => {
    const p = writeTo, o = p.slot * 16;
    for (const m of p.meshes) { const a = m.instanceMatrix.array; for (let q = 0; q < 16; q++) a[o + q] = e[q]; }
    p.slot++; written++;
  };

  function update(camera, { frustumCull = true } = {}) {
    const t0 = performance.now();
    if (!shown()) { stats.skippedHidden++; return; }
    const simT = trainSystem.simTime ?? 0;
    const budgetEnd = t0 + BUILD_BUDGET_MS;
    for (const p of profiles.values()) p.slot = 0;
    let trains = 0, cars = 0, pending = 0, outOfView = 0, far = 0;
    staleUsed = 0;
    const cx = camera?.position.x, cz = camera?.position.z;
    const lines = {};
    // Capacity: every car of every train that could be shown, per profile (the fleet changes only when lines are rebuilt).
    const all = trainSystem.allTrains;
    if (capacityKey !== all.length) {
      const need = new Map();
      for (const train of all) { const st = stockOf.get(train.userData.lineId); if (st) need.set(st.profile, (need.get(st.profile) || 0) + st.layout.length); }
      for (const [id, n] of need) ensureCapacity(profiles.get(id), n);
      capacityKey = all.length;
    }
    const cull = frustumCull && !!camera?.projectionMatrix;
    if (cull) { viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(viewProjection); }
    for (const train of all) {
      const ud = train.userData;
      const stock = stockOf.get(ud.lineId);
      if (!stock || !lineShown(ud.lineId)) continue;
      // Mappings are built for every train, in view or not, within the frame budget.
      if (!freshMapping(ud)) { if (performance.now() <= budgetEnd) lastByTrain.set(ud.id, buildMapping(ud)); else pending++; }
      // Pre-cull at the underground train's own position (trains.js keeps it at
      // its curve point for this clock, hidden lines included): its surface twin
      // is within TRACK_ERROR_BOUND_M of it, so a train that fails here cannot be
      // in view, and costs no mapping work.
      if (camera) {
        const bound = (ud.lineId === 'dlr' ? TRACK_ERROR_BOUND_M.dlr : TRACK_ERROR_BOUND_M.tube) + stock.trainM / 2 + TRAIN_SPHERE_MARGIN_M;
        const p = train.position;
        if (Math.hypot(cx - p.x, cz - p.z) > VISIBLE_DISTANCE + bound) { far++; continue; }
        if (cull) { sphere.center.copy(p); sphere.radius = bound; if (!frustum.intersectsSphere(sphere)) { outOfView++; continue; } }
      }
      const place = placeAt(train, simT, budgetEnd);
      if (!place) continue;
      sampleRun(place.run, place.s, ratio, pt);
      if (camera && Math.hypot(camera.position.x - pt.x, camera.position.z - pt.z) > VISIBLE_DISTANCE) { far++; continue; }
      if (cull) { sphere.center.set(pt.x, pt.y, pt.z); sphere.radius = place.stock.trainM / 2 + TRAIN_SPHERE_MARGIN_M; if (!frustum.intersectsSphere(sphere)) { outOfView++; continue; } }
      writeTo = profiles.get(place.stock.profile); written = 0;
      forEachCar(place, writeCar);
      const drawn = written;
      if (drawn) { trains++; cars += drawn; const l = lines[ud.lineId] ||= { trains: 0, cars: 0 }; l.trains++; l.cars += drawn; }
    }
    for (const p of profiles.values()) {
      if (!p.meshes) continue;
      for (const m of p.meshes) {
        m.count = p.slot; m.visible = p.slot > 0;
        m.instanceMatrix.clearUpdateRanges();
        if (p.slot) { m.instanceMatrix.addUpdateRange(0, p.slot * 16); m.instanceMatrix.needsUpdate = true; }
      }
    }
    Object.assign(stats, { trains, cars, lines, pending, outOfView, far, stale: staleUsed, written: stats.written + 1, syncMs: performance.now() - t0 });
  }

  /** Pure query for tests: every surface car at simT, keyed by train id (world matrices' translation and the matrix). */
  function snapshot(simT = trainSystem.simTime ?? 0, { lineId = null } = {}) {
    const out = {};
    for (const train of trainSystem.allTrains) {
      const ud = train.userData;
      if (lineId && ud.lineId !== lineId) continue;
      const place = placeAt(train, simT);
      if (!place) continue;
      const cars = [];
      forEachCar(place, (c, e) => cars.push({ c, m: Array.from(e) }));
      if (cars.length) out[ud.id] = { lineId: ud.lineId, u: place.u, s: place.s, cars };
    }
    return out;
  }

  function setHeightScale(next) { ratio = next; }

  /** Mapping figures over every curve (for the documented error bound): plan distances in metres. */
  function mappingErrors({ stepM = 25 } = {}) {
    const res = {};
    const seen = new Set();
    const P = new THREE.Vector3();
    for (const train of trainSystem.allTrains) {
      const ud = train.userData;
      if (!stockOf.has(ud.lineId) || seen.has(ud.curve)) continue;
      seen.add(ud.curve);
      const m = mappingOf(ud);
      const r = res[ud.lineId] ||= { curves: 0, runs: 0, openM: 0, track: [], portals: [], stats: {} };
      r.curves++; r.runs += m.runs.length;
      for (const [k, v] of Object.entries(m.stats)) if (typeof v === 'number') r.stats[k] = (r.stats[k] || 0) + v;
      const sign = ud.dir > 0 ? 1 : -1, L = ud.curve.getLength();
      for (const run of m.runs) {
        // Portals: the underground train at u_P against the surface train there.
        for (let k = 0; k < run.au.length; k++) if (run.portal[k]) {
          ud.curve.getPointAt(run.au[k], P); sampleRun(run, run.as[k], ratio, pt);
          const { ox, oz } = laneOffset(pt, sign);
          r.portals.push(Math.hypot(P.x - pt.x - ox, P.z - pt.z - oz));
        }
        // Along the open track.
        const n = Math.max(2, Math.ceil((run.u1 - run.u0) * L / stepM));
        for (let i = 0; i <= n; i++) {
          const u = run.u0 + (run.u1 - run.u0) * i / n;
          sampleRun(run, sAt(run, u), ratio, pt);
          if (!pt.open) continue;
          ud.curve.getPointAt(u, P);
          const { ox, oz } = laneOffset(pt, sign);
          r.track.push(Math.hypot(P.x - pt.x - ox, P.z - pt.z - oz));
          r.openM += (run.u1 - run.u0) * L / n;
        }
      }
    }
    const summarise = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / s.length, p50: q(.5), p95: q(.95), max: s[s.length - 1] }; };
    for (const r of Object.values(res)) { r.track = summarise(r.track); r.portals = summarise(r.portals); }
    return res;
  }

  scene.add(group);
  group.userData = { kind: 'surface-trains', update, snapshot, setHeightScale, mappingErrors, stats, stockOf, profiles, pendingStats };
  return { group, update, snapshot, setHeightScale, mappingErrors, stats, stockOf, profiles, pendingStats, placeAt, mappingOf, networkFor, get ratio() { return ratio; } };
}
