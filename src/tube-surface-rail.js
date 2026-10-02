// Open-air Tube and DLR as surface railway (sprint 30Sep26w, D-041 item 2,
// Lane R). Jordan, 27Sep26u: "yes to the dlr, much of which is elevated above
// ground level which should be represented accurately, and yes the overground
// parts of the underground lines should appear like the other overground
// lines"; 30Sep26w: drawn exactly like the Overground, stripe included; shared
// track drawn once with both colours side by side; below-ground sections keep
// the underground look and stay hidden from above ground.
//
// Renders public/data/tube-surface.json (scripts/prepare-tube-surface.mjs)
// with the Overground's own archetypes (surface-rail.js):
//   * one TOP-LEVEL group per line, named `surface-rail-<line>`. Never `line:`:
//     D-040's cull (underground-cull.js) hides every `line:*` group and all
//     under it from above-ground cameras; this railway is what an above-ground
//     camera should see;
//   * tunnels are skipped (skipTunnel): the underground layer draws them, and
//     the cull keeps hiding them from above;
//   * D-024 holds: only a tunnel may sit below ground; buildPath floors every
//     other sample on the terrain after smoothing;
//   * shared track is drawn ONCE, by its owner (the Overground, or the first
//     Tube line in the data's order), with every other line's colour laid as a
//     band across the owner's stripe: N lines split the 9 m stripe into N
//     side-by-side bands, owner first (left). The Overground's own geometry is
//     untouched; its bands are this module's meshes;
//   * the DLR's height comes from dlr-profile.js, which now carries the deck
//     measured from the Environment Agency LiDAR (src/dlr-deck-heights.json),
//     so the line, trains, markers, shafts and this railway stand on the same
//     decks. Where this railway draws something else, by design: a cutting or
//     a portal approach the profile sinks below ground is drawn at grade here
//     (D-024), and the DLR's at-grade track shared with the Jubilee or the
//     Mildmay is drawn at the owner's height. The hover (describe) reads the
//     geometry under the pointer and says so wherever the two differ;
//   * fix round 2: the DLR's raised track is never shared (the data builder
//     reads its level from the profile's decks), and a flyover beside a lower
//     viaduct is drawn, not collapsed into it as a twin.
//   * surface station markers are `surfaceOnly` (drawn from above ground);
//   * no per-instance colour anywhere (D-015): each line has its own materials.
//
// True proportions (D-039): Tube corridors are built at canonical VE5 lifts and
// morphed exactly as the Overground (createRailMorph); the DLR is rebuilt from
// the profile at the current structure scale, which is how the profile itself
// follows Master.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { RENDER_ORDER } from './render-layers.js';
import {
  MATS, BASE_LIFT, STRIPE_LIFT, STRIPE_HALF_W, CLASS_LIFT_M, SAMPLE_STEP_M,
  buildPath, buildCorridor, stationOnRail, createStripeMaterial, stripGeometry, offsetBand,
  llToScene, branchClasses, createRailMorph, normaliseForMerge, drawnOpenFlags,
} from './surface-rail.js';
import { createStationMarkers } from './stations.js';
import { sampleForSurfaceRail, SURFACE_RAIL_DLR_MATCH_M } from './dlr-profile.js';
// s01:R: no deck or pier stands in the Thames.
// s02:T: the drawn track no longer stops at the map edge (src/m25-edge.js is not read here any more).
import { isInThames } from './thames-mask.js';

/**
 * s01:R (sprint 01Oct26h) flagged every sample beyond the map edge (the outer
 * face of the M25's outer barrier, m25-edge.js, where the ground ends in a
 * cliff) so that buildCorridor (skipTunnel) and drawnOpenFlags left it undrawn:
 * the Central towards Epping and the Metropolitan beyond Rickmansworth stopped
 * where the map does.
 *
 * s02:T (sprint 02Oct26f, D-048 item 7, Jordan: "beyond the m25 they're just a
 * tunnel or track in empty space"): the Central, the Metropolitan and the
 * Weaver run on to their termini, so the default predicate is now "no ground":
 * a sample is flagged only where the terrain grid has none (a sample with no
 * finite terrainY). buildPath already skips such samples, so nothing in
 * today's data is flagged; the rule stands for any future track that runs off
 * the ground, and keeps the clip wherever no real ground exists. A caller may
 * pass its own predicate. The path keeps every sample; buildCorridor and
 * drawnOpenFlags read `offMap`. Returns the number flagged.
 */
export function flagOffMap(path, offMap = p => !Number.isFinite(p.terrainY)) {
  let n = 0;
  for (const p of path) { let off = false; try { off = offMap(p); } catch { off = false; } if (off) { p.offMap = true; n++; } }
  return n;
}
/** s01:R: no viaduct deck or pier in the Thames (bridges.js draws the railway bridges). */
export const structureClear = (x, z) => !isInThames(x, z);

const VE = VERTICAL_EXAGGERATION;
export const SURFACE_RAIL_PREFIX = 'surface-rail-';
export const SURFACE_RAIL_TYPE = 'surface-rail';
/** Band above the stripe it overlays (scene units), plus a polygon offset. */
export const BAND_LIFT = 0.4;
const DRESSING_PARTS = ['ballast', 'masonry', 'earth', 'cutShadow'];
// The four dressing archetypes share one draw per line: their colours (the
// Overground's MATS colours, exactly) are baked into the vertices, so a line
// costs three draws (dressing, stripe, bands) instead of six. Baked vertex
// colour is not per-instance colour (D-015). Roughness and metalness are the
// ballast's; the Overground's four materials differ by at most 0.1 in each.
const DRESSING_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.05, fog: true, side: THREE.DoubleSide });

// DLR: the profile kind -> the archetype drawn. Which profile track a sample
// of the source is laid on (by its v2 class) is sampleForSurfaceRail in
// dlr-profile.js, shared with the data builder.
const PROFILE_CLASS = { elevated: 'viaduct', embankment: 'embankment', surface: 'surface', cutting: 'cutting', tunnel: 'tunnel' };
export const DLR_MATCH_M = SURFACE_RAIL_DLR_MATCH_M;
/**
 * s01:R: a marker is lifted only when a building box stands over its centre
 * (within MARKER_ROOF_REACH_M of it: inside a station building or under a
 * canopy, where nothing of it shows), not when a building merely stands beside
 * it; its centre then stands MARKER_ROOF_CLEARANCE_M above that roof (true m).
 */
export const MARKER_ROOF_REACH_M = 2, MARKER_ROOF_CLEARANCE_M = 1.5;
/** s01:R: how far an open platform may be from a DLR station's mapped point, and from the drawn track. */
export const DLR_OPEN_PLATFORM_M = 250, DLR_PLATFORM_ON_TRACK_M = 30;
const ESTIMATE_BASIS = 'Illustrative class estimate; no profiled DLR track within 40 m';
const COVERED_WAY_BASIS = 'Covered way drawn at grade (tagged tunnel in OSM; scripts/prepare-tube-surface.mjs)';

/** Where a DLR sample of v2 class `v2` is drawn at (x, z): the profile point, the archetype, the rail-head y. */
function dlrPointAt(x, z, terrainY, v2, dlrProfile, structureScale) {
  const s = sampleForSurfaceRail(dlrProfile, { x, z, cls: v2, structureScale });
  let cls, y, deck;
  if (s) {
    cls = PROFILE_CLASS[s._dlrProfile.classification] ?? v2;
    y = s.y;
    deck = { source: s._dlrProfile.deckSource, surveyed: s._dlrProfile.surveyed, basis: s._dlrProfile.heightBasis };
  } else {
    // Off the profile's mapped track (rare: two OSM vintages). The class
    // estimate, flagged, exactly as the Overground would draw it.
    cls = v2;
    y = terrainY + (BASE_LIFT + Math.max(0, CLASS_LIFT_M[v2]) * VE) * structureScale;
    deck = { source: cls === 'viaduct' || cls === 'embankment' ? 'fallback' : null, surveyed: false, basis: ESTIMATE_BASIS, unprofiled: true };
  }
  // D-024: only a tunnel may sit below ground.
  if (cls !== 'tunnel') y = Math.max(y, terrainY + BASE_LIFT * structureScale);
  return { s, cls, y, deck };
}

/** Surface-rail path for the DLR, its height taken from the shared DLR profile. */
export function buildDlrPath(branch, getY, dlrProfile, structureScale) {
  const pts = branch.points, classes = branchClasses(branch), path = [];
  // s01:R: segments the data opened as covered ways (the Lewisham terminus
  // approach under the main-line railway) are drawn at grade, whatever the
  // profile, which keeps OSM's tunnel there.
  const opened = new Set(); for (const c of branch.coveredWays || []) for (let i = c.i0; i < c.i1; i++) opened.add(i);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = llToScene(...pts[i]), b = llToScene(...pts[i + 1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SAMPLE_STEP_M));
    for (let j = 0; j < steps + (i === pts.length - 2 ? 1 : 0); j++) {
      const t = j / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const terrainY = getY({ x, z }); if (!Number.isFinite(terrainY)) continue;
      const v2 = CLASS_LIFT_M[classes[i]] === undefined ? 'surface' : classes[i];
      if (opened.has(i)) {
        path.push({ x, z, terrainY, cls: v2, y: terrainY + BASE_LIFT * structureScale, src: i, deck: { source: null, surveyed: false, basis: COVERED_WAY_BASIS, coveredWay: true }, v2 });
        continue;
      }
      const { cls, y, deck } = dlrPointAt(x, z, terrainY, v2, dlrProfile, structureScale);
      path.push({ x, z, terrainY, cls, y, src: i, deck, v2 });
    }
  }
  return path;
}

/** Nearest point of the polyline `samples[i0..i1]` to (x, z): its segment and parameter. */
function nearestOn(samples, x, z, i0 = 0, i1 = samples.length - 1) {
  let best = null;
  for (let i = i0; i < i1; i++) {
    const a = samples[i], b = samples[i + 1], vx = b.x - a.x, vz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1)));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (!best || d < best.d) best = { i, t, d };
  }
  if (!best && i0 === i1 && samples[i0]) best = { i: i0, t: 0, d: Math.hypot(x - samples[i0].x, z - samples[i0].z) };
  return best;
}

/** Index range of path samples on owner source segments [j0, j1). */
export function pathRange(path, j0, j1) {
  let i0 = -1, i1 = -1;
  for (let i = 0; i < path.length; i++) {
    if (path[i].src >= j0 && path[i].src < j1) { if (i0 < 0) i0 = i; i1 = i; }
  }
  if (i0 < 0) return null;
  if (i1 + 1 < path.length) i1++; // reach the next source point: bands meet end to end
  return [i0, i1];
}

/** Non-tunnel runs within [i0, i1] (inclusive), as [a, b] index pairs of length >= 2. */
function openRuns(path, i0, i1) {
  const runs = [];
  let start = null;
  for (let i = i0; i <= i1; i++) {
    const open = path[i].cls !== 'tunnel' && !path[i].offMap; // s01:R: nor where flagOffMap says there is no ground (s02:T)
    if (open && start === null) start = i;
    if ((!open || i === i1) && start !== null) { const end = open ? i : i - 1; if (end > start) runs.push([start, end]); start = null; }
  }
  return runs;
}

/** Bands for `lines` (owner first) across the stripe of `path` over [i0, i1]. */
export function bandGeometries(path, i0, i1, lines, yFn) {
  const out = [], N = lines.length, w = 2 * STRIPE_HALF_W / N;
  for (const [a, b] of openRuns(path, i0, i1)) {
    for (let k = 1; k < N; k++) {
      const { a: ea, b: eb } = offsetBand(path, a, b, STRIPE_HALF_W - k * w, STRIPE_HALF_W - (k + 1) * w, yFn);
      out.push({ lineId: lines[k], geometry: stripGeometry(ea, eb), samples: path.slice(a, b + 1), lines });
    }
  }
  return out;
}

// normaliseForMerge moved to surface-rail.js (s01:R): the Overground's masonry
// goes through it too. Re-exported for callers of this module.
export { normaliseForMerge };

/** Uniform grid for "which lines run here" hover lookups. */
class SampleGrid {
  constructor(cell = 100) { this.cell = cell; this.cells = new Map(); }
  add(x, z, lines) { const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push({ x, z, lines }); }
  nearest(x, z, near = 60) {
    const c = this.cell, cx = Math.floor(x / c), cz = Math.floor(z / c); let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const s of this.cells.get(`${cx + dx},${cz + dz}`) || []) {
      const d = Math.hypot(s.x - x, s.z - z); if (d <= near && (!best || d < best.d)) best = { d, s };
    }
    return best?.s ?? null;
  }
}

export async function createTubeSurfaceRail({ scene, getTerrainMeshSurfaceY, projectStation, heightScale = 1, overground = null, dlrProfile = null, url = '/data/tube-surface.json' }) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) throw new Error('tube-surface.json unavailable');
  const data = await res.json();

  const getY = getTerrainMeshSurfaceY;
  const morph = createRailMorph(getY);
  // About 200 ms of building on the M2 Max (0.8 s at the weak setup's 4x CPU
  // throttle), during the opening: yield between lines so no frame carries it.
  const breathe = () => new Promise(r => setTimeout(r, 0));
  const groups = new Map(), lineInfo = new Map(), grids = new Map(), stationLayers = new Map();
  const names = new Map(data.lines.map(l => [l.id, l.id === 'dlr' ? 'DLR' : `${l.name} line`]));
  for (const [id, r] of overground?.userData.registry ?? []) names.set(id, `${r.name} line`);
  const overgroundIds = new Set(overground?.userData.registry?.keys() ?? []);
  let structureScale = heightScale;

  const gridFor = id => { if (!grids.has(id)) grids.set(id, new SampleGrid()); return grids.get(id); };
  const bandOut = new Map(); // lineId -> [geometry]
  const bandSrc = new Map(); // lineId -> [{samples, lines}] parallel to bandOut: what each band geometry was built on
  const pushBand = (lineId, g, src) => {
    if (!bandOut.has(lineId)) { bandOut.set(lineId, []); bandSrc.set(lineId, []); }
    bandOut.get(lineId).push(g); bandSrc.get(lineId).push(src);
  };
  const bandPaths = new Map(); // lineId -> [sample arrays] (canonical y) for station placement

  // ── Per line: owned corridors ──────────────────────────────────────────────
  const ownerPaths = new Map(); // lineId -> path by branch index
  for (const line of data.lines) {
    const group = new THREE.Group();
    group.name = `${SURFACE_RAIL_PREFIX}${line.id}`;
    group.userData = { kind: 'surface-rail', lineId: line.id };
    groups.set(line.id, group);
    const stripeMat = createStripeMaterial(line.colour);
    const bandMat = stripeMat.clone();
    bandMat.polygonOffset = true; bandMat.polygonOffsetFactor = -1; bandMat.polygonOffsetUnits = -4;
    const info = { line, group, stripeMat, bandMat, meshes: [], paths: [], isDlr: line.id === 'dlr' };
    lineInfo.set(line.id, info);
    const byBranch = line.branches.map(b => {
      const path = info.isDlr ? buildDlrPath(b, getY, dlrProfile, structureScale) : buildPath(b, getY);
      if (path.length >= 2) flagOffMap(path); // s01:R
      return path.length >= 2 ? path : null;
    });
    ownerPaths.set(line.id, byBranch);
    info.paths = byBranch.filter(Boolean);
    await breathe();
  }

  // ── Shared-track bands: on Tube owners, then on Overground owners ────────────
  const canonicalOverground = p => ({ ...p, y: p.terrainY + p.liftM * VE });
  const bandSpecs = [];
  for (const line of data.lines) line.branches.forEach((b, bi) => {
    for (const band of b.bands || []) bandSpecs.push({ owner: line.id, path: ownerPaths.get(line.id)[bi], band });
  });
  for (const og of data.overgroundShared || []) {
    const path = overground?.userData.linePaths?.get(og.overground)?.[og.branch];
    bandSpecs.push({ owner: og.overground, path: path ? path.map(canonicalOverground) : null, band: og, overground: true });
  }
  const bandSpans = new Map(); // owner lineId -> [{path, i0, i1, lines}]
  for (const { owner, path, band } of bandSpecs) {
    if (!path) continue;
    const range = pathRange(path, band.j0, band.j1);
    if (!range) continue;
    // The DLR owns nothing shared (it is last in the order), so every owner
    // path here is canonical and the band morphs with the generic morph.
    for (const g of bandGeometries(path, range[0], range[1], band.lines, p => p.y + STRIPE_LIFT + BAND_LIFT)) {
      pushBand(g.lineId, g.geometry, { samples: g.samples, lines: g.lines, morphed: true });
      if (!bandPaths.has(g.lineId)) bandPaths.set(g.lineId, []);
      bandPaths.get(g.lineId).push(g.samples);
      for (const s of g.samples) gridFor(g.lineId).add(s.x, s.z, band.lines);
    }
    if (!bandSpans.has(owner)) bandSpans.set(owner, []);
    bandSpans.get(owner).push({ path, i0: range[0], i1: range[1], lines: band.lines });
  }

  // ── Build meshes ─────────────────────────────────────────────────────────────
  // `sources` (fix round 2), one per geometry: what it was built on. The mesh
  // keeps, per merged piece, its first face and its source, so a hover hit's
  // faceIndex names the path (or the shared-track span) under the pointer: at a
  // flyover the upper and the lower track are different paths.
  const addMerged = (info, geos, mat, part, { morphed = true, colours = null, sources = null } = {}) => {
    if (!geos.length) return null;
    // The viaduct piers are indexed BoxGeometry with uv; the deck strips are
    // not. mergeGeometries refuses the mix and returns null, which silently
    // drops the whole masonry mesh (deck and piers): that is why the
    // Overground drew no viaduct deck from a095a84 until sprint 01Oct26h
    // (D-042 item 4), when its masonry went through the same normaliseForMerge
    // (surface-rail.js). Every piece is made position + normal, non-indexed,
    // so the viaducts stand on their piers.
    const norm = geos.map(normaliseForMerge);
    if (colours) norm.forEach((n, k) => { const c = colours[k], a = new Float32Array(n.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); });
    const firstFace = new Int32Array(norm.length);
    for (let k = 1; k < norm.length; k++) firstFace[k] = firstFace[k - 1] + norm[k - 1].attributes.position.count / 3;
    const merged = mergeGeometries(norm, false);
    for (const g of norm) g.dispose();
    if (!merged) { console.warn(`surface rail: ${info.line.id} ${part} did not merge`); return null; }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;
    mesh.userData = { type: SURFACE_RAIL_TYPE, lineId: info.line.id, name: names.get(info.line.id), part };
    if (sources) faceSources.set(mesh, { firstFace, sources });
    info.group.add(mesh);
    info.meshes.push(mesh);
    if (morphed) morph.add(mesh);
    return mesh;
  };
  const faceSources = new WeakMap(); // mesh -> { firstFace, sources }
  const buildOwn = (info) => {
    const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
    const from = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] }; // the path each geometry came from
    for (const path of info.paths) {
      const before = Object.fromEntries(Object.keys(out).map(k => [k, out[k].length]));
      buildCorridor(path, out, { skipTunnel: true, pierShortRuns: info.isDlr, structureClear });
      for (const k of Object.keys(out)) for (let j = before[k]; j < out[k].length; j++) from[k].push({ samples: path, own: true, morphed: !info.isDlr });
    }
    addMerged(info, out.stripe, info.stripeMat, 'stripe', { morphed: !info.isDlr, sources: from.stripe });
    const geos = DRESSING_PARTS.flatMap(part => out[part]), colours = DRESSING_PARTS.flatMap(part => out[part].map(() => MATS[part].color));
    addMerged(info, geos, DRESSING_MAT, 'dressing', { morphed: !info.isDlr, colours, sources: DRESSING_PARTS.flatMap(part => from[part]) });
  };
  for (const info of lineInfo.values()) {
    await breathe();
    buildOwn(info);
    addMerged(info, bandOut.get(info.line.id) || [], info.bandMat, 'band', { sources: bandSrc.get(info.line.id) });
    // Hover grid: own track, lines on it where a band says so.
    const spans = bandSpans.get(info.line.id) || [];
    for (const path of info.paths) path.forEach((p, i) => {
      if (p.cls === 'tunnel' || p.offMap) return;
      const span = spans.find(s => s.path === path && i >= s.i0 && i <= s.i1);
      gridFor(info.line.id).add(p.x, p.z, span ? span.lines : [info.line.id]);
    });
  }
  // Overground-owned spans: the Overground's own hover names only its line;
  // this lookup lets a caller ask which lines share a point of it.
  for (const [owner, spans] of bandSpans) if (overgroundIds.has(owner)) for (const s of spans) {
    for (let i = s.i0; i <= s.i1; i++) gridFor(`overground:${owner}`).add(s.path[i].x, s.path[i].z, s.lines);
  }

  // ── Surface station markers (surfaceOnly) ───────────────────────────────────
  await breathe();
  // s02:T: a marker is dropped only where there is no ground under it (nothing today), not beyond the map edge:
  // Epping, Chorleywood, Chalfont & Latimer, Amersham and Chesham are ordinary surface stations with markers.
  const offMap = p => { try { return !Number.isFinite(getY({ x: p.x, z: p.z })); } catch { return true; } };
  // s01:R: a DLR station whose mapped anchor platform is in tunnel (Stratford:
  // platform 16, on a way OSM tags tunnel under the station) is still an
  // open-air station when another of its platforms is open and the drawn
  // track reaches it (platforms 4a and 4b, where the line from Pudding Mill
  // Lane now ends): its surface marker stands on the nearest such platform.
  const dlrDrawn = () => (lineInfo.get('dlr')?.paths ?? []).flatMap(path => { const f = drawnOpenFlags(path); return path.filter((_, i) => f[i]); });
  let dlrDrawnSamples = null;
  function dlrSurfaceStation(id, s) {
    if (s.kind !== 'tunnel') return dlrProfile.station({ id, structureScale });
    dlrDrawnSamples ??= dlrDrawn();
    for (const c of [...s.candidates].sort((a, b) => a.distance - b.distance)) {
      if (c.distance > DLR_OPEN_PLATFORM_M) break;
      const q = dlrProfile.station({ id, nodeIndex: c.node, structureScale });
      if (q._dlrProfile.classification === 'tunnel') continue;
      if (!dlrDrawnSamples.some(p => Math.hypot(p.x - q.x, p.z - q.z) <= DLR_PLATFORM_ON_TRACK_M)) continue;
      q.openPlatform = true;
      return q;
    }
    return null;
  }
  const markerStations = new Map(); // lineId -> stations
  const seen = new Set();
  for (const line of data.lines) {
    const info = lineInfo.get(line.id), stations = [];
    if (info.isDlr) {
      if (!dlrProfile) continue;
      for (const [id, s] of Object.entries(dlrProfile.data.stations)) {
        if (seen.has(id)) continue;
        const p = dlrSurfaceStation(id, s);
        if (!p || offMap(p)) continue; // s01:R: wholly in tunnel; s02:T: or with no ground under it
        seen.add(id);
        stations.push({ id, name: s.name, pos: p.clone(), surfaceY: p.y, dlrProfile: p._dlrProfile, nodeIndex: p._dlrProfile.nodeIndex, openPlatform: !!p.openPlatform,
          network: 'dlr', lineId: 'dlr', lineCount: 1, isTerminus: false, surfaceRail: true });
      }
    } else {
      const paths = [...info.paths, ...(bandPaths.get(line.id) || [])];
      for (const s of line.stations) {
        if (!s.surface || seen.has(s.naptan)) continue;
        const st = stationOnRail(s, paths, getY, projectStation, 'tube-surface');
        if (!st || offMap(st.pos)) continue; // s02:T: only where there is no ground (the termini beyond the M25 keep their markers)
        seen.add(s.naptan);
        st.lineId = line.id; st.isTerminus = false; st.surfaceRail = true;
        st.groundY = getY(st.pos); st.liftM = (st.pos.y - st.groundY) / VE;
        stations.push(st);
      }
    }
    if (!stations.length) continue;
    markerStations.set(line.id, stations);
    const layer = createStationMarkers({ scene, stations, colour: line.colour, size: 6, labels: false, surfaceOnly: true });
    layer.mesh.userData.surfaceRail = line.id;
    stationLayers.set(`surface:${line.id}`, { stationsLayer: layer });
  }
  const writeMarkers = () => {
    const dummy = new THREE.Object3D();
    for (const [lineId, stations] of markerStations) {
      const mesh = stationLayers.get(`surface:${lineId}`)?.stationsLayer.mesh; if (!mesh) continue;
      stations.forEach((st, i) => { dummy.position.copy(st.pos); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    }
  };

  // ── Master (true proportions) ────────────────────────────────────────────────
  function setHeightScale(ratio, { rebuildDlr = true } = {}) {
    structureScale = ratio;
    morph.apply(ratio);
    const dlr = lineInfo.get('dlr');
    if (rebuildDlr && dlr && dlrProfile) {
      // Rebuild the DLR's own meshes from the profile at this scale.
      for (const m of [...dlr.meshes]) if (m.userData.part !== 'band') { dlr.group.remove(m); m.geometry.dispose(); dlr.meshes.splice(dlr.meshes.indexOf(m), 1); }
      const byBranch = dlr.line.branches.map(b => { const p = buildDlrPath(b, getY, dlrProfile, ratio); if (p.length >= 2) flagOffMap(p); return p.length >= 2 ? p : null; });
      ownerPaths.set('dlr', byBranch); dlr.paths = byBranch.filter(Boolean);
      buildOwn(dlr);
    }
    for (const [lineId, stations] of markerStations) for (const st of stations) placeMarker(lineId, st, ratio);
    writeMarkers();
  }
  // A marker's height at a structure scale: on its track (the DLR: the
  // profile), and s01:R above the roof of any building box over it (roofM, true
  // metres, liftMarkersOverRoofs), so a station under its own building or a
  // canopy (Greenwich and Lewisham DLR, 41 Overground stations among others)
  // still shows its marker from above. True size at every Master (D-039).
  function placeMarker(lineId, st, ratio) {
    const roof = st.roofM > 0 ? st.roofM + MARKER_ROOF_CLEARANCE_M : 0;
    if (lineId === 'dlr' && dlrProfile) {
      const p = dlrProfile.station({ id: st.id, nodeIndex: st.nodeIndex, structureScale: ratio });
      st.pos.copy(p); st.dlrProfile = p._dlrProfile;
      if (roof) { const g = getY({ x: p.x, z: p.z }); if (Number.isFinite(g)) st.pos.y = Math.max(st.pos.y, g + roof * VE * ratio); }
    } else {
      st.pos.y = st.groundY + Math.max(st.liftM, roof) * VE * ratio;
    }
    st.surfaceY = st.pos.y;
  }

  // ── Hover: what is drawn under the pointer (fix round 2) ─────────────────────
  // The verifier (30Sep26w): the DLR hover sampled the profile's nearest track
  // in plan, so over a flyover it read the other deck, and over the DLR's band
  // on the Jubilee it read the flyover above it. Now the hit's face names the
  // piece it belongs to (faceSources), the point is read on that piece's own
  // centreline, and the height printed as drawn is that geometry's.
  /** The drawn piece under a hit: its source, segment, parameter, centreline point and current rail-head y. */
  function locate(mesh, hit, faceIndex) {
    const fs = faceSources.get(mesh); if (!fs || !hit) return null;
    const at = (src, n) => {
      const a = src.samples[n.i], b = src.samples[Math.min(n.i + 1, src.samples.length - 1)], t = n.t;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      // Canonical samples (Tube corridors, every band) are drawn through the
      // morph, whose base is the terrain under the vertex (createRailMorph);
      // the DLR's own paths are rebuilt at the current scale.
      const base = src.morphed ? getY({ x, z }) : null;
      return { src, i: n.i, t, x, z, yCur: src.morphed ? base + (y - base) * structureScale : y };
    };
    if (Number.isInteger(faceIndex) && faceIndex >= 0) {
      let lo = 0, hi = fs.firstFace.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fs.firstFace[mid] <= faceIndex) lo = mid; else hi = mid - 1; }
      const src = fs.sources[lo], n = nearestOn(src.samples, hit.x, hit.z);
      return n ? at(src, n) : null;
    }
    // No face (a caller with a point only): the nearest drawn piece in three dimensions.
    let best = null;
    const seen = new Set();
    for (const src of fs.sources) {
      if (seen.has(src.samples)) continue; seen.add(src.samples);
      const n = nearestOn(src.samples, hit.x, hit.z); if (!n) continue;
      const c = at(src, n), score = Number.isFinite(hit.y) ? Math.hypot(n.d, hit.y - c.yCur) : n.d;
      if (!best || score < best.score) best = { score, c };
    }
    return best?.c ?? null;
  }
  /** The DLR as drawn at a located point: the profile's reading there, with `drawnM` the height drawn (true metres). */
  function dlrDrawnAt(at) {
    const ground = getY({ x: at.x, z: at.z });
    const drawnM = (at.yCur - ground) / (VE * structureScale);
    let info;
    if (at.src.own) {
      // The profile track this railway laid the point on (the same choice buildDlrPath made).
      const a = at.src.samples[at.i], { s } = dlrPointAt(at.x, at.z, ground, a.v2 ?? 'surface', dlrProfile, structureScale);
      info = s ? { ...s._dlrProfile } : {
        classification: { viaduct: 'elevated', embankment: 'embankment', cutting: 'cutting' }[a.cls] ?? 'surface',
        groundRelativeM: drawnM, deckM: a.cls === 'viaduct' || a.cls === 'embankment' ? CLASS_LIFT_M[a.cls] : null,
        deckSource: a.cls === 'viaduct' || a.cls === 'embankment' ? 'fallback' : null, surveyed: false, heightBasis: ESTIMATE_BASIS,
      };
    } else {
      // A band: the DLR's at-grade track on another line's corridor (a raised
      // DLR stretch is never shared, scripts/prepare-tube-surface.mjs).
      const s = dlrProfile.sample({ x: at.x, z: at.z, structureScale, kinds: ['surface', 'cutting', 'embankment'], maxDistance: DLR_MATCH_M });
      info = s ? { ...s._dlrProfile } : { classification: 'surface', groundRelativeM: drawnM, deckM: null, surveyed: false };
    }
    info.drawnM = drawnM;
    return { _dlrProfile: info, x: at.x, z: at.z, yDrawn: at.yCur };
  }

  const api = {
    groups, stationLayers, data, names,
    /** Line ids sharing the track at a point of `lineId`'s surface railway (or of `overground:<id>`). */
    linesAt(lineId, x, z) { return gridFor(lineId).nearest(x, z)?.lines ?? [lineId]; },
    /**
     * Hover text parts for a surface-rail mesh hit. With the hit's faceIndex,
     * the lines and (for the DLR) the height are those of the piece of track
     * the face was built from, not of whatever runs nearest in plan.
     */
    describe(mesh, hitPoint, faceIndex = null) {
      const ud = mesh.userData, at = hitPoint ? locate(mesh, hitPoint, faceIndex) : null;
      let lines;
      if (at?.src.own) lines = (bandSpans.get(ud.lineId) || []).find(s => s.path === at.src.samples && at.i >= s.i0 && at.i < s.i1)?.lines ?? [ud.lineId];
      else if (at) lines = at.src.lines;
      else lines = hitPoint ? api.linesAt(ud.lineId, hitPoint.x, hitPoint.z) : [ud.lineId];
      const ordered = [ud.lineId, ...lines.filter(l => l !== ud.lineId)];
      const shared = ordered.length > 1, withOverground = ordered.some(l => overgroundIds.has(l));
      const dlrPoint = ud.lineId === 'dlr' && at && dlrProfile ? dlrDrawnAt(at) : null;
      return {
        lines: ordered, title: ordered.map(l => names.get(l) ?? l).join(' · '), dlrPoint, shared,
        subtitle: shared ? `Shared track · ${withOverground ? 'London Underground and London Overground' : 'London Underground'}`
          : ud.lineId === 'dlr' ? 'Docklands Light Railway' : 'London Underground · surface railway',
      };
    },
    setHeightScale,
    /**
     * s01:R: lift surface station markers above the building boxes over them.
     * `roofHeightAt(x, z, r)` gives the true height (m) of the tallest
     * building box within r of (x, z), 0 where there is none. With
     * `near(x, z)` (fix round 1), only the markers it accepts are read again
     * (main.js: those within the plan bounds of a building tile that arrived,
     * left or changed); every other marker keeps the roof it had. A marker
     * whose building has gone returns to its track. Returns { lifted, lowered
     * (this pass), checked (read again), roofed (markers a building box stands
     * over now, all lines) }.
     */
    liftMarkersOverRoofs(roofHeightAt, near = null) {
      let lifted = 0, lowered = 0, checked = 0, roofed = 0;
      for (const [lineId, stations] of markerStations) for (const st of stations) {
        if (!near || near(st.pos.x, st.pos.z)) {
          checked++;
          const r = roofHeightAt(st.pos.x, st.pos.z, MARKER_ROOF_REACH_M);
          st.roofM = Number.isFinite(r) && r > 0 ? r : 0;
          const before = st.pos.y;
          placeMarker(lineId, st, structureScale);
          if (st.pos.y > before + 1e-6) lifted++;
          else if (st.pos.y < before - 1e-6) lowered++;
        }
        if (st.roofM > 0) roofed++;
      }
      if (checked) writeMarkers();
      return { lifted, lowered, checked, roofed };
    },
    /** s01:R: every surface marker station, by line (tests and hover). */
    markerStations,
    setLineVisible(lineId, visible) {
      const g = groups.get(lineId); if (g) g.visible = visible;
      const layer = stationLayers.get(`surface:${lineId}`); if (layer) layer.stationsLayer.mesh.visible = visible;
    },
    /** Every surface-rail mesh, for the hover picker. */
    pickables() { const out = []; for (const g of groups.values()) if (g.visible) for (const m of g.children) if (m.isMesh) out.push(m); return out; },
    /** Built paths per line (canonical for Tube lines, current scale for the DLR): Lane T lays trains on these. */
    paths: ownerPaths,
  };
  // The DLR was just built from the profile at this scale; the Tube corridors
  // and markers take it now.
  setHeightScale(heightScale, { rebuildDlr: false });
  // Lines wholly in tunnel (Victoria, Waterloo & City) have nothing to draw.
  for (const g of groups.values()) if (g.children.length) scene.add(g);
  return api;
}
