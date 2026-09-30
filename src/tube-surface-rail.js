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
//     so the line, trains, markers, shafts, hover and this railway agree. Where
//     the profile and this railway differ, by design: a cutting or a portal
//     approach the profile sinks below ground is drawn at grade here (D-024).
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
  llToScene, branchClasses, createRailMorph,
} from './surface-rail.js';
import { createStationMarkers } from './stations.js';

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

// DLR: the v2 class of a surface-rail sample -> the profile track kinds that
// may carry it (nearest first), and the profile kind -> the archetype drawn.
const DLR_KINDS = {
  viaduct: ['elevated'], embankment: ['embankment', 'surface', 'elevated'], surface: ['surface', 'embankment', 'cutting'],
  cutting: ['cutting', 'surface'], tunnel: ['tunnel', 'cutting'],
};
const PROFILE_CLASS = { elevated: 'viaduct', embankment: 'embankment', surface: 'surface', cutting: 'cutting', tunnel: 'tunnel' };
export const DLR_MATCH_M = 40;

/** Surface-rail path for the DLR, its height taken from the shared DLR profile. */
export function buildDlrPath(branch, getY, dlrProfile, structureScale) {
  const pts = branch.points, classes = branchClasses(branch), path = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = llToScene(...pts[i]), b = llToScene(...pts[i + 1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SAMPLE_STEP_M));
    for (let j = 0; j < steps + (i === pts.length - 2 ? 1 : 0); j++) {
      const t = j / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const terrainY = getY({ x, z }); if (!Number.isFinite(terrainY)) continue;
      const v2 = CLASS_LIFT_M[classes[i]] === undefined ? 'surface' : classes[i];
      const s = dlrProfile.sample({ x, z, structureScale, kinds: DLR_KINDS[v2], maxDistance: DLR_MATCH_M })
        ?? dlrProfile.sample({ x, z, structureScale, maxDistance: DLR_MATCH_M });
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
        deck = { source: cls === 'viaduct' || cls === 'embankment' ? 'fallback' : null, surveyed: false, basis: 'Illustrative class estimate; no profiled DLR track within 40 m', unprofiled: true };
      }
      // D-024: only a tunnel may sit below ground.
      if (cls !== 'tunnel') y = Math.max(y, terrainY + BASE_LIFT * structureScale);
      path.push({ x, z, terrainY, cls, y, src: i, deck });
    }
  }
  return path;
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
    const open = path[i].cls !== 'tunnel';
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
      out.push({ lineId: lines[k], geometry: stripGeometry(ea, eb), samples: path.slice(a, b + 1) });
    }
  }
  return out;
}

/** Position + normal (and a baked colour), non-indexed: the attribute set every strip geometry has. */
export function normaliseForMerge(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (out !== g) g.dispose();
  return out;
}

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
  const bandOut = new Map(); // lineId -> [{geometry}]
  const pushBand = (lineId, g) => { if (!bandOut.has(lineId)) bandOut.set(lineId, []); bandOut.get(lineId).push(g); };
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
      pushBand(g.lineId, g.geometry);
      if (!bandPaths.has(g.lineId)) bandPaths.set(g.lineId, []);
      bandPaths.get(g.lineId).push(g.samples);
      for (const s of g.samples) gridFor(g.lineId).add(s.x, s.z, band.lines);
    }
    if (!bandSpans.has(owner)) bandSpans.set(owner, []);
    bandSpans.get(owner).push({ path, i0: range[0], i1: range[1], lines: band.lines });
  }

  // ── Build meshes ─────────────────────────────────────────────────────────────
  const addMerged = (info, geos, mat, part, { morphed = true, colours = null } = {}) => {
    if (!geos.length) return null;
    if (colours) geos = geos.map((g, k) => { const n = normaliseForMerge(g), c = colours[k], a = new Float32Array(n.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); return n; });
    // The viaduct piers are indexed BoxGeometry with uv; the deck strips are
    // not. mergeGeometries refuses the mix and returns null, which silently
    // drops the whole masonry mesh (deck and piers): that is why the
    // Overground has drawn no viaduct deck since a095a84 (its merge fails the
    // same way; left as it is, since the Overground must stay pixel-identical;
    // reported for a ruling). Here every piece is made position + normal,
    // non-indexed, so the Tube and DLR viaducts stand on their piers.
    const merged = mergeGeometries(colours ? geos : geos.map(normaliseForMerge), false);
    for (const g of geos) g.dispose();
    if (!merged) { console.warn(`surface rail: ${info.line.id} ${part} did not merge`); return null; }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;
    mesh.userData = { type: SURFACE_RAIL_TYPE, lineId: info.line.id, name: names.get(info.line.id), part };
    info.group.add(mesh);
    info.meshes.push(mesh);
    if (morphed) morph.add(mesh);
    return mesh;
  };
  const buildOwn = (info) => {
    const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
    for (const path of info.paths) buildCorridor(path, out, { skipTunnel: true });
    addMerged(info, out.stripe, info.stripeMat, 'stripe', { morphed: !info.isDlr });
    const geos = DRESSING_PARTS.flatMap(part => out[part]), colours = DRESSING_PARTS.flatMap(part => out[part].map(() => MATS[part].color));
    addMerged(info, geos, DRESSING_MAT, 'dressing', { morphed: !info.isDlr, colours });
  };
  for (const info of lineInfo.values()) {
    await breathe();
    buildOwn(info);
    addMerged(info, bandOut.get(info.line.id) || [], info.bandMat, 'band');
    // Hover grid: own track, lines on it where a band says so.
    const spans = bandSpans.get(info.line.id) || [];
    for (const path of info.paths) path.forEach((p, i) => {
      if (p.cls === 'tunnel') return;
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
  const markerStations = new Map(); // lineId -> stations
  const seen = new Set();
  for (const line of data.lines) {
    const info = lineInfo.get(line.id), stations = [];
    if (info.isDlr) {
      if (!dlrProfile) continue;
      for (const [id, s] of Object.entries(dlrProfile.data.stations)) {
        if (s.kind === 'tunnel' || seen.has(id)) continue;
        seen.add(id);
        const p = dlrProfile.station({ id, structureScale });
        stations.push({ id, name: s.name, pos: p.clone(), surfaceY: p.y, dlrProfile: p._dlrProfile, network: 'dlr', lineId: 'dlr', lineCount: 1, isTerminus: false, surfaceRail: true });
      }
    } else {
      const paths = [...info.paths, ...(bandPaths.get(line.id) || [])];
      for (const s of line.stations) {
        if (!s.surface || seen.has(s.naptan)) continue;
        const st = stationOnRail(s, paths, getY, projectStation, 'tube-surface');
        if (!st) continue;
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
      const byBranch = dlr.line.branches.map(b => { const p = buildDlrPath(b, getY, dlrProfile, ratio); return p.length >= 2 ? p : null; });
      ownerPaths.set('dlr', byBranch); dlr.paths = byBranch.filter(Boolean);
      buildOwn(dlr);
    }
    for (const [lineId, stations] of markerStations) for (const st of stations) {
      if (lineId === 'dlr' && dlrProfile) { const p = dlrProfile.station({ id: st.id, structureScale: ratio }); st.pos.copy(p); st.surfaceY = p.y; st.dlrProfile = p._dlrProfile; }
      else { st.pos.y = st.groundY + st.liftM * VE * ratio; st.surfaceY = st.pos.y; }
    }
    writeMarkers();
  }

  const api = {
    groups, stationLayers, data, names,
    /** Line ids sharing the track at a point of `lineId`'s surface railway (or of `overground:<id>`). */
    linesAt(lineId, x, z) { return gridFor(lineId).nearest(x, z)?.lines ?? [lineId]; },
    /** Hover text parts for a surface-rail mesh hit. */
    describe(mesh, hitPoint) {
      const ud = mesh.userData, lines = hitPoint ? api.linesAt(ud.lineId, hitPoint.x, hitPoint.z) : [ud.lineId];
      const ordered = [ud.lineId, ...lines.filter(l => l !== ud.lineId)];
      const shared = ordered.length > 1, withOverground = ordered.some(l => overgroundIds.has(l));
      let dlrPoint = null;
      if (ud.lineId === 'dlr' && hitPoint && dlrProfile) dlrPoint = dlrProfile.sample({ x: hitPoint.x, z: hitPoint.z, structureScale, maxDistance: DLR_MATCH_M });
      return {
        lines: ordered, title: ordered.map(l => names.get(l) ?? l).join(' · '), dlrPoint,
        subtitle: shared ? `Shared track · ${withOverground ? 'London Underground and London Overground' : 'London Underground'}`
          : ud.lineId === 'dlr' ? 'Docklands Light Railway' : 'London Underground · surface railway',
      };
    },
    setHeightScale,
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
