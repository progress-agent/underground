// station-buildings.js: every station is one white building with big roundels (sprint 02Oct26f, lane B).
//
// D-048 items 2 to 4: "the real building where OpenStreetMap marks one, a
// standard white pavilion elsewhere, big termini included"; the red-and-blue
// Underground roundel wherever the Underground calls, the Overground's orange
// and the DLR's teal only where nothing else serves; touching a station
// building stops the walker and opens the platform card, and "Up to the street"
// puts the walker outside, facing the street.
//
// DATA. public/data/station-buildings.json is compiled offline by
// scripts/prepare-station-buildings.mjs (rules in Working/sprint-02Oct26f/B/
// design.md). This module has three layers, so Node can test the first alone:
//   1. createStationBuildingIndex(json): pure lookups (which map boxes to
//      hide, which building is touched, the exit pose, label anchors).
//   2. loadStationBuildings(url) and the shared module state.
//   3. createStationBuildingMeshes({ data, getStructuralY, VE }): the two merged
//      meshes (walls and roundels), the name atlas, the height law.
//
// WHITE WITHOUT PER-INSTANCE COLOUR. Nothing here is instanced: the walls are
// one merged BufferGeometry on a plain white MeshStandardMaterial. Never
// setColorAt or instanceColor (the M5 driver renders those buildings black).
//
// THE HEIGHT LAW. Geometry is authored canonical (true metres x VE, base to
// roof) and patched with surface-geometry.js's patchBuildingHeight: y =
// aBaseY + (y - aBaseY) x uHeightScale, the same uniform the map's boxes read,
// so a box and a station building of equal height stay equal at every Master.
//
// ROUND TWO (sprint 14Oct26w, lane B). (1) Two sites, Fulham Broadway and North Greenwich, are a `box-entrance` building: a
// 24 x 7 m entrance block against the face of the big map box (the `host`, which stays an ordinary grey box); roundels with
// `host: true` stand on the host's wall or roof. (2) ON A SLOPE a station keeps, at every Master, the wall it has above its highest
// street at Master 1.1: its roof rises with the street above 1.1 by `riseM` (true metres at Master 1) x (Master - 1.1), a wall
// ring by its own street `gM` the same way, so nothing dips and no street stands over a roof; at 1.1 nothing moves. (3) The name
// is read from the atlas in uniform control flow (the grey outline on the bar was a mip level picked at the name's edges).

import * as THREE from 'three';
import { cleanStationName } from './stations.js';
import { ROUNDEL } from './platform-tunnel.js';
import { patchBuildingHeight, getBuildingHeightScale } from './surface-geometry.js';
import {
  pointInRing, nearestOnRing, distToRing, rectRing, bounds, createFootprintGrid, footprintOf, centroid,
} from './station-building-geometry.js';

export const STATION_BUILDINGS_URL = '/data/station-buildings.json';

/** The key of a site: its cleaned name, lower case, ASCII, `&` as "and", apostrophes and dots dropped, other runs as `-`. */
export function siteKeyOf(name) {
  return cleanStationName(String(name)).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const cleanName = (name) => String(name || '').replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();

export const NET_LABEL = Object.freeze({ tube: 'London Underground', og: 'London Overground', dlr: 'Docklands Light Railway' });
export const CONTACT_REACH_M = 30;   // contactAt looks this far for a footprint

// ── 1. The pure index ──────────────────────────────────────────────────────

export function createStationBuildingIndex(json) {
  if (!json || json.version !== 1 || !Array.isArray(json.buildings) || !json.sites) throw new Error('station-buildings.json: unexpected shape');
  const byKey = new Map(json.buildings.map(b => [b.key, b]));
  const items = json.buildings.map((b, i) => {
    const ring = footprintOf(b);
    return { ring, building: b, index: i, bounds: bounds(ring) };
  });
  const grid = createFootprintGrid(items, 32);
  // A flat cell table for the hot path (every map box asks once as its tile builds).
  const cell = 32, cells = new Map();
  const ck = (i, j) => (i + 8192) * 16384 + (j + 8192);
  for (const it of items) {
    for (let i = Math.floor(it.bounds.x0 / cell); i <= Math.floor(it.bounds.x1 / cell); i++) {
      for (let j = Math.floor(it.bounds.z0 / cell); j <= Math.floor(it.bounds.z1 / cell); j++) {
        const k = ck(i, j); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(it);
      }
    }
  }
  const byName = new Map();
  for (const b of json.buildings) for (const n of b.names) if (!byName.has(n)) byName.set(n, b);

  function hidesBox(b) {
    const x = b.x ?? b.cx, z = b.z ?? b.cz;
    const a = cells.get(ck(Math.floor(x / cell), Math.floor(z / cell)));
    if (!a) return false;
    for (const it of a) {
      const q = it.bounds;
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      if (pointInRing(x, z, it.ring)) return true;
    }
    return false;
  }

  /** The nearest footprint within `reach` metres: { building, d, nx, nz, x, z } (d = 0 inside; n outward). */
  function contactAt(x, z, reach = CONTACT_REACH_M) {
    let best = null;
    for (const it of grid.near(x - reach, z - reach, x + reach, z + reach)) {
      const q = it.bounds;
      if (x < q.x0 - reach || x > q.x1 + reach || z < q.z0 - reach || z > q.z1 + reach) continue;
      const r = nearestOnRing(x, z, it.ring);
      const d = r.inside ? 0 : r.d;
      if (d > reach) continue;
      if (!best || d < best.d) best = { building: it.building, d, nx: r.nx, nz: r.nz, x: r.x, z: r.z, inside: r.inside };
    }
    return best;
  }

  const ringByKey = new Map(items.map(it => [it.building.key, it.ring]));
  /** Distance from (x, z) to a building's footprint (0 inside). */
  const distanceTo = (building, x, z) => { const r = ringByKey.get(building.key); return r ? distToRing(x, z, r) : Infinity; };
  const buildingForSite = (siteKey) => { const s = json.sites[siteKey]; return s ? byKey.get(s.building) ?? null : null; };
  const buildingForName = (name) => buildingForSite(siteKeyOf(name)) ?? byName.get(name) ?? null;

  /** The exit pose of a site's building: { x, z, yaw }, or null for an unknown key. Pure. */
  function stationExitPose(siteKey) {
    const b = buildingForSite(siteKey);
    return b ? { x: b.exit.x, z: b.exit.z, yaw: b.exit.yaw } : null;
  }

  // ── s14:B ── (sprint 14Oct26w, fix round 1) The host box of a box-entrance station is a map box that stands on the ground under
  // its centre, so on a slope its base floats over the street on the low side (2.85 m at Fulham Broadway's north face) and a
  // walker's 1.7 m passes under it, where only the host's grey skirt (visual) closes the gap. collision.js reads the instanced
  // box and is not this lane's file, so the walker is held out of the host's square HERE, as it is held out of the footprint:
  // never closer than `margin` to the square's face, unless it is up on the roof.
  const hosted = json.buildings.filter(b => b.host);
  /**
   * If (x, z) at height y (world units) is inside a host's square grown by `margin`, and below its roof, the nearest point
   * `margin` outside the face: { building, x, z, nx, nz } (n = the face's outward normal), else null. Pure.
   * `scale` is the building-height scale (1 / Master, as collision.js reads it): the box is DRAWN to baseM x VE + h x VE x scale,
   * and a walker standing on that roof is not held, at any Master (fix round 2: the roof was tested at the plain height, so at
   * Master 1.5 the roof the walker stood on counted as "below it" and threw him off).
   */
  function hostPushAt(x, z, y, VE = 5, margin = 0.36, scale = 1) {
    for (const b of hosted) {
      const h = b.host, half = h.side / 2;
      if (y >= h.baseM * VE + h.h * VE * scale - 0.2 * VE) continue;   // up on the roof (jetpack): not held
      const dx = x - h.x, dz = z - h.z, ox = Math.abs(dx) - half, oz = Math.abs(dz) - half;
      if (Math.max(ox, oz) >= margin) continue;
      if (ox >= oz) { const s = dx < 0 ? -1 : 1; return { building: b, x: h.x + s * (half + margin), z, nx: s, nz: 0 }; }
      const s = dz < 0 ? -1 : 1;
      return { building: b, x, z: h.z + s * (half + margin), nx: 0, nz: s };
    }
    return null;
  }
  // ── /s14:B ──

  return { json, buildings: json.buildings, byKey, items, hidesBox, contactAt, distanceTo, buildingForSite, buildingForName, stationExitPose, siteKeyOf, hostPushAt };
}

/**
 * The entrances of a pedestrian network (net.entrances, each { name (cleaned), x, z, stops })
 * that belong to a building: the cleaned name is one of the building's names and the entrance is
 * within 300 m of its footprint. Overground rows appear once lane O's network carries them.
 */
export function entrancesForBuilding(net, building) {
  if (!net?.entrances || !building) return [];
  const names = new Set(building.names);
  const ring = footprintOf(building);
  return net.entrances.filter(e => (names.has(cleanStationName(e.name)) || names.has(e.name) || names.has(cleanName(e.name)))
    && distToRing(e.x, e.z, ring) <= 300);
}

/** The line shown under a station's name on hover: "London Underground · London Overground". */
export function networksLine(building) {
  return (building?.nets ?? []).slice().sort((a, b) => ['tube', 'og', 'dlr'].indexOf(a) - ['tube', 'og', 'dlr'].indexOf(b)).map(n => NET_LABEL[n]).filter(Boolean).join(' · ');
}

// ── Occlusion for hover ────────────────────────────────────────────────────
// A station is named only where its building is DRAWN: a ray that reaches the building's prism only after passing
// through the ground or an ordinary box (or a landmark) points at that object, not at the station behind it.
// Everything is in canonical world space (the space the hover raycaster works in; see vertical-scale.js).

const _boxBounds = new WeakMap();
/** The plan bounds { x0, x1, z0, z1 } of an InstancedMesh of axis-aligned boxes, cached per instance count. */
function boxMeshBounds(mesh) {
  const n = mesh.count, c = _boxBounds.get(mesh);
  if (c && c.n === n) return c;
  const a = mesh.instanceMatrix.array;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0, o = 12; i < n; i++, o += 16) {
    const h = Math.max(Math.abs(a[o - 12]), Math.abs(a[o - 2])) / 2, x = a[o], z = a[o + 2];
    if (x - h < x0) x0 = x - h; if (x + h > x1) x1 = x + h; if (z - h < z0) z0 = z - h; if (z + h > z1) z1 = z + h;
  }
  const b = { n, x0, x1, z0, z1 };
  _boxBounds.set(mesh, b);
  return b;
}

/** The slab test of the segment (o + t d, t in [t0, t1]) against [lo, hi] on one axis: the narrowed [t0, t1] or null. */
function slab(o, d, lo, hi, t0, t1) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi ? [t0, t1] : null;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  a = Math.max(a, t0); b = Math.min(b, t1);
  return a <= b ? [a, b] : null;
}

/**
 * Does any drawn map box (the instances of `meshes`, base-pivoted boxes whose height is scaled by `scale`, the
 * building-height law) stand across the ray before distance `tMax`? A box that starts within `slackM` of `tMax`
 * is the station's own neighbour overlapping its wall, not something in front of it.
 */
export function rayBlockedByBoxes(meshes, ox, oy, oz, dx, dy, dz, tMax, scale = 1, slackM = 0.75) {
  const end = tMax - slackM;
  if (!(end > 0)) return false;
  for (const mesh of meshes) {
    if (!mesh || mesh.visible === false || !mesh.count || !mesh.instanceMatrix) continue;
    const bb = boxMeshBounds(mesh);
    let r = slab(ox, dx, bb.x0, bb.x1, 0, end);
    if (r) r = slab(oz, dz, bb.z0, bb.z1, r[0], r[1]);
    if (!r) continue;
    const a = mesh.instanceMatrix.array;
    for (let i = 0, o = 0; i < mesh.count; i++, o += 16) {
      const hx = Math.abs(a[o]) / 2, hz = Math.abs(a[o + 10]) / 2, x = a[o + 12], y = a[o + 13], z = a[o + 14];
      let q = slab(ox, dx, x - hx, x + hx, r[0], r[1]);
      if (!q) continue;
      q = slab(oz, dz, z - hz, z + hz, q[0], q[1]);
      if (!q) continue;
      q = slab(oy, dy, y, y + Math.abs(a[o + 5]) * scale, q[0], q[1]);
      if (q) return true;
    }
  }
  return false;
}

/** Is the ray below the ground (groundY(x, z) in canonical Y, or null) anywhere before distance `tMax`? */
export function rayBlockedByGround(groundY, ox, oy, oz, dx, dy, dz, tMax, clearM = 0.5) {
  const end = tMax - clearM;
  if (!(end > 0)) return false;
  const step = Math.min(60, Math.max(6, end / 300));
  for (let t = step; ; t += step) {
    const tt = Math.min(t, end), y = groundY(ox + dx * tt, oz + dz * tt);
    if (Number.isFinite(y) && oy + dy * tt < y - 0.05) return true;
    if (tt >= end) return false;
  }
}

// ── 2. Loading and the shared state ────────────────────────────────────────

let _loadPromise = null;
const state = { index: null, meshes: null, ready: false, hidden: { live: 0, baked: 0, missedBeforeReady: 0 }, listeners: new Set() };

/** Fetch and index the data once. Resolves to the index; rejects (and clears) on failure so a retry is possible. */
export function loadStationBuildings(url = STATION_BUILDINGS_URL) {
  if (_loadPromise) return _loadPromise;
  _loadPromise = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error(`${url}: HTML (SPA fallback)`);
    const index = createStationBuildingIndex(await res.json());
    state.index = index;
    for (const fn of state.listeners) { try { fn(index); } catch (e) { console.warn('[station-buildings] listener', e); } }
    return index;
  }).catch((err) => { _loadPromise = null; throw err; });
  return _loadPromise;
}

export const stationBuildingState = state;
/** The loaded index, or null before the data arrives. */
export const getStationBuildingIndex = () => state.index;
export const onStationBuildingsLoaded = (fn) => { state.listeners.add(fn); if (state.index) fn(state.index); return () => state.listeners.delete(fn); };
/** stationExitPose over the loaded data (null before load or for an unknown key). */
export const stationExitPose = (siteKey) => state.index?.stationExitPose(siteKey) ?? null;

/**
 * Wrap a building-record predicate (the baked path's { x, z } or the live path's { cx, cz }) so
 * the boxes under a station building are not built. Counts each hide in state.hidden[path]; a hide
 * asked before the data is ready counts as missedBeforeReady.
 */
export function withStationHides(inner, path) {
  return (b) => {
    if (inner && inner(b)) return true;
    const idx = state.index;
    if (!idx) { state.hidden.missedBeforeReady++; return false; }
    if (idx.hidesBox(b)) { state.hidden[path]++; return true; }
    return false;
  };
}

// ── 3. Meshes ──────────────────────────────────────────────────────────────

const RING_INDEX = { underground: 0, overground: 1, dlr: 2 };
export const RING_COLOUR = { underground: ROUNDEL.red, overground: '#EE7623', dlr: '#00AFAD' };
const NAME_COLOUR = '#d4d4d4';          // under the bloom threshold with room to spare: in sun the street view's lettering read 0.84 at #e6e6e6
const WALL_COLOUR = 0xdcdad4;            // white, kept under the bloom threshold through AgX
const HOST_SKIRT_COLOUR = 0x8a8580;      // the map boxes' own grey (surface-geometry.js)
const SKIRT_M = 0.5;
const ATLAS_W = 4096, ATLAS_CAP_H = 4096;
const BAR_TEXT_FRAC = 0.66, BAR_TEXT_MAX_W = 450;   // the name's em on the bar and its widest extent (roundelTexture's)

/**
 * The single-channel name atlas: one row of text per name, shelf-packed. Returns
 * { texture, rects: Map(name -> { u0, v0, u1, v1, wPx, hPx }), width, height, bytes, ms } or null without a canvas.
 */
export function buildNameAtlas(names, { document = globalThis.document, family = "'Railway Sans', 'Helvetica Neue', Arial, sans-serif" } = {}) {
  if (!document?.createElement) return null;
  const t0 = performance.now();
  const unique = [...new Set(names.map(n => String(n).toUpperCase()))].sort();
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) return null;
  let glyph = 64, layout = null;
  for (; glyph >= 32; glyph -= 8) {
    probe.font = `${glyph}px ${family}`;
    const rowH = glyph + 8;
    const rects = new Map();
    let x = 0, y = 0;
    for (const n of unique) {
      const w = Math.ceil(probe.measureText(n).width) + 8;
      if (x + w > ATLAS_W) { x = 0; y += rowH; }
      rects.set(n, { x, y, w, h: glyph });
      x += w + 4;
    }
    const height = Math.ceil((y + rowH) / 256) * 256;
    if (height <= ATLAS_CAP_H) { layout = { rects, height, glyph }; break; }
  }
  if (!layout) return null;
  const W = ATLAS_W, H = layout.height;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.font = `${layout.glyph}px ${family}`;
  for (const [n, r] of layout.rects) c.fillText(n, r.x + 4, r.y + r.h / 2 + layout.glyph * 0.04);
  const rgba = c.getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = rgba[j];
  const texture = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4; texture.unpackAlignment = 1; texture.needsUpdate = true;
  texture.name = 'station-name-atlas';
  const rects = new Map();
  // (Sprint 14Oct26w: each rectangle is inset by half a texel, so a sample clamped to its edge never reads a neighbour.)
  for (const [n, r] of layout.rects) rects.set(n, { u0: (r.x + 0.5) / W, v0: (r.y + 0.5) / H, u1: (r.x + r.w - 0.5) / W, v1: (r.y + r.h - 0.5) / H, wPx: r.w - 8, hPx: r.h });
  return { texture, rects, width: W, height: H, glyph: layout.glyph, bytes: Math.round(W * H * 4 / 3), ms: performance.now() - t0 };
}

/**
 * The displayed roof of a building in canonical Y at height scale `scale` (= 1 / Master): the base plus the true height x VE x scale,
 * plus, on a slope above the design Master, `riseM` x (Master - design Master) true metres (the street rises, the roof with it).
 * Pure; the roof and the walls' top share it with the vertex shader.
 */
export function displayedRoofY(building, base, scale, { VE = 5, designMaster = 1.1 } = {}) {
  return base + building.height * VE * scale + (building.riseM ?? 0) * Math.max(0, 1 / Math.max(scale, 0.05) - designMaster) * VE * scale;
}

/**
 * The drawn extent of one roundel quad, canonical Y at height scale `scale`, by the same formula as the vertex shader:
 * { bottomY, topY } (for a wall ring, vertically; for a roof roundel, both the flat quad's Y). `base` is the building's own base
 * (a `host` roundel stands on `building.host.baseM x VE`, the map box's own).
 */
export function roundelExtent(building, r, base, scale, { VE = 5, designMaster = 1.1 } = {}) {
  const M = 1 / Math.max(scale, 0.05), hostBase = building.host ? building.host.baseM * VE : base;
  const b = r.host ? hostBase : base;
  if (r.on === 'wall') {
    const lift = r.host
      ? Math.min((r.gM ?? 0) * (M - designMaster), Math.max(0, building.host.h - (r.yM + r.D / 2))) * VE * scale
      : (r.gM ?? 0) * (M - designMaster) * VE * scale;
    const c = b + r.yM * VE * scale + lift;
    return { bottomY: c - r.D * VE * scale / 2, topY: c + r.D * VE * scale / 2 };
  }
  const y = b + (r.yM * VE + 0.05 * VE) * scale + (r.host ? 0 : (building.riseM ?? 0) * Math.max(0, M - designMaster) * VE * scale);
  return { bottomY: y, topY: y };
}

/** Wait for the Railway face (at most `ms`), so the atlas measures with it. */
export async function whenRailwayReady(ms = 1500, document = globalThis.document) {
  try {
    if (!document?.fonts?.load) return false;
    const done = document.fonts.load("64px 'Railway Sans'").then(() => true, () => false);
    return await Promise.race([done, new Promise(r => setTimeout(() => r(false), ms))]);
  } catch { return false; }
}

function triangulateRoof(fp) {
  const contour = fp.map(p => new THREE.Vector2(p[0], p[1]));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch { faces = null; }
  if (!faces?.length) { faces = []; for (let i = 1; i + 1 < fp.length; i++) faces.push([0, i, i + 1]); }
  return faces;
}

/**
 * Build the walls and the roundels for every building in `data`.
 * @param {{ data: object, getStructuralY: (x:number,z:number)=>number|null, VE?: number, atlas?: object|null, document?: Document }} opts
 */
export function createStationBuildingMeshes({ data, getStructuralY, VE = 5, atlas = undefined, document = globalThis.document }) {
  const index = data.items ? data : createStationBuildingIndex(data);
  const json = index.json;
  const buildings = json.buildings;
  if (atlas === undefined) atlas = buildNameAtlas(buildings.map(b => b.title), { document });
  const t0 = performance.now();

  // The roof follows the street above the design Master (see displayedRoofY): after the height law, in true metres.
  const designMaster = Number.isFinite(json.roundelDesignMaster) ? json.roundelDesignMaster : 1.1;
  const riseExtend = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRise;')
      .replace('transformed.y = aBaseY + ( transformed.y - aBaseY ) * uHeightScale;', `transformed.y = aBaseY + ( transformed.y - aBaseY ) * uHeightScale;
\ttransformed.y += aRise * max( 0.0, 1.0 / max( uHeightScale, 0.05 ) - ${designMaster.toFixed(4)} ) * ${VE.toFixed(1)} * uHeightScale;`);
  };

  // ── Walls and roofs ──
  const wp = [], wn = [], wb = [], wr = [], wIdx = [], triBuilding = [];
  const bases = new Map();
  const pushTri = (a, b, c, bi) => { const n = wp.length / 3; wIdx.push(n + a, n + b, n + c); triBuilding.push(bi); };
  buildings.forEach((b, bi) => {
    const fp = footprintOf(b);
    let base = Infinity;
    const probe = [...fp, centroid(fp)];
    for (const [x, z] of probe) { const y = getStructuralY?.(x, z); if (Number.isFinite(y) && y < base) base = y; }
    if (!Number.isFinite(base)) base = 0;
    bases.set(b.key, base);
    const roof = base + b.height * VE, bottom = base - SKIRT_M * VE;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], c = fp[(i + 1) % fp.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = -dz / L, nz = dx / L;
      const o = wp.length / 3;
      // a-bottom, c-bottom, c-top, a-top: counter-clockwise seen from outside
      wp.push(a[0], bottom, a[1], c[0], bottom, c[1], c[0], roof, c[1], a[0], roof, a[1]);
      for (let k = 0; k < 4; k++) { wn.push(nx, 0, nz); wb.push(base); wr.push(k < 2 ? 0 : (b.riseM ?? 0)); }   // aRise: the top follows the street above Master 1.1
      wIdx.push(o, o + 1, o + 2, o, o + 2, o + 3); triBuilding.push(bi, bi);
    }
    const o = wp.length / 3;
    for (const [x, z] of fp) { wp.push(x, roof, z); wn.push(0, 1, 0); wb.push(base); wr.push(b.riseM ?? 0); }
    for (const f of triangulateRoof(fp)) {
      let [i, j, k] = f;
      const A = fp[i], B = fp[j], C = fp[k];
      if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) { const t = j; j = k; k = t; }
      wIdx.push(o + i, o + j, o + k); triBuilding.push(bi);
    }
  });
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wp), 3));
  wallGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(wn), 3));
  wallGeo.setAttribute('aBaseY', new THREE.BufferAttribute(new Float32Array(wb), 1));
  wallGeo.setAttribute('aRise', new THREE.BufferAttribute(new Float32Array(wr), 1));
  wallGeo.setIndex(new THREE.BufferAttribute(wp.length / 3 > 65535 ? new Uint32Array(wIdx) : new Uint16Array(wIdx), 1));
  wallGeo.computeBoundingSphere(); wallGeo.computeBoundingBox();
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOUR, roughness: 0.9, metalness: 0 });
  patchBuildingHeight(wallMat, { key: 'station-walls', extend: riseExtend });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.name = 'station-buildings-walls';
  walls.userData.kind = 'station-buildings';
  walls.userData.triBuilding = Uint16Array.from(triBuilding);
  walls.frustumCulled = false;

  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchBuildingHeight(depthMat, { key: 'station-depth', extend: riseExtend });
  walls.customDepthMaterial = depthMat;

  // ── Roundels ──
  const rp = [], rn = [], rq = [], rr = [], rrect = [], rsz = [], rb = [], rg = [], rroom = [], rrise = [], rIdx = [], rTriBuilding = [];
  const wide = ROUNDEL.width / (2 * ROUNDEL.outerR);       // quad width over quad height
  const barH = ROUNDEL.barH / ROUNDEL.height;              // the bar as a fraction of the quad's height
  buildings.forEach((b, bi) => {
    const base = bases.get(b.key);
    const hostBase = b.host ? b.host.baseM * VE : base;     // a `host` roundel stands on the map box's own base
    const rect = atlas?.rects.get(String(b.title).toUpperCase()) ?? null;
    // The name's extent on the bar in quad units (x across 0..500, y up 0..406.289), aspect kept.
    let nw = 0, nh = 0;
    if (rect) {
      nh = BAR_TEXT_FRAC * ROUNDEL.barH; nw = nh * rect.wPx / rect.hPx;
      if (nw > BAR_TEXT_MAX_W) { nh *= BAR_TEXT_MAX_W / nw; nw = BAR_TEXT_MAX_W; }
    }
    for (const r of b.roundels) {
      const D = r.D, W = D * wide, ring = RING_INDEX[r.ring] ?? 0;
      // A wall ring keeps its clearance from the street as Master moves (see the vertex shader): gM is the street's rise
      // above the base at Master 1, room the wall left above the ring at the design Master.
      // (Sprint 14Oct26w: a station ring rises with its street uncapped, since its roof rises at least as much; room is huge. A
      // `host` ring hangs on a box that does not grow, so it keeps the wall left above it as its cap. aRise: the roof roundel's.)
      const gM = r.on === 'wall' ? (r.gM ?? 0) : 0;
      const room = r.on !== 'wall' ? 0 : r.host ? Math.max(0, b.host.h - (r.yM + D / 2)) : 1e3;
      const rise = r.on === 'roof' && !r.host ? (b.riseM ?? 0) : 0;
      const rBase = r.host ? hostBase : base;
      let rx, rz, ux, uz, uy = 0, nx = 0, ny = 0, nz = 0, cy;
      if (r.on === 'wall') { rx = r.nz; rz = -r.nx; ux = 0; uz = 0; uy = 1; nx = r.nx; nz = r.nz; cy = rBase + r.yM * VE; }
      else { rx = r.ax; rz = r.az; ux = r.az; uz = -r.ax; ny = 1; cy = rBase + r.yM * VE + 0.05 * VE; }
      const o = rp.length / 3;
      for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const hx = rx * W * sx + ux * D * sy, hz = rz * W * sx + uz * D * sy, hy = uy * D * VE * sy;
        rp.push(r.x + hx, cy + hy, r.z + hz);
        rn.push(nx, ny, nz); rq.push(sx, sy); rr.push(ring); rb.push(rBase); rg.push(gM); rroom.push(room); rrise.push(rise);
        // Atlas rectangle as (u0, vTop, u1, vBottom): canvas row 0 is texture row 0 (the DataTexture is not flipped).
        if (rect) rrect.push(rect.u0, rect.v0, rect.u1, rect.v1); else rrect.push(0, 0, 0, 0);
        rsz.push(nw, nh);
      }
      rIdx.push(o, o + 1, o + 2, o, o + 2, o + 3); rTriBuilding.push(bi, bi);
    }
  });
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp), 3));
  rGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rn), 3));
  rGeo.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array(rq), 2));
  rGeo.setAttribute('aRing', new THREE.BufferAttribute(new Float32Array(rr), 1));
  rGeo.setAttribute('aNameRect', new THREE.BufferAttribute(new Float32Array(rrect), 4));
  rGeo.setAttribute('aNameSize', new THREE.BufferAttribute(new Float32Array(rsz), 2));
  rGeo.setAttribute('aBaseY', new THREE.BufferAttribute(new Float32Array(rb), 1));
  rGeo.setAttribute('aStreet', new THREE.BufferAttribute(new Float32Array(rg), 1));
  rGeo.setAttribute('aRoom', new THREE.BufferAttribute(new Float32Array(rroom), 1));
  rGeo.setAttribute('aRise', new THREE.BufferAttribute(new Float32Array(rrise), 1));
  rGeo.setIndex(new THREE.BufferAttribute(rp.length / 3 > 65535 ? new Uint32Array(rIdx) : new Uint16Array(rIdx), 1));
  rGeo.computeBoundingSphere();
  const blank = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); blank.needsUpdate = true;
  const names = { value: atlas?.texture ?? blank };
  const colours = {
    uRingRed: { value: new THREE.Color(RING_COLOUR.underground) }, uRingOrange: { value: new THREE.Color(RING_COLOUR.overground) },
    uRingTeal: { value: new THREE.Color(RING_COLOUR.dlr) }, uBar: { value: new THREE.Color(ROUNDEL.blue) }, uName: { value: new THREE.Color(NAME_COLOUR) },
  };
  const roundelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, alphaToCoverage: true, alphaTest: 0.5 });
  roundelMat.polygonOffset = true; roundelMat.polygonOffsetFactor = -1; roundelMat.polygonOffsetUnits = -1;
  patchBuildingHeight(roundelMat, { key: 'station-roundels', extend: (shader) => {
    Object.assign(shader.uniforms, colours, { uNames: names });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aQuad; attribute float aRing; attribute vec4 aNameRect; attribute vec2 aNameSize; attribute float aStreet; attribute float aRoom; attribute float aRise;
varying vec2 vRQ; varying float vRRing; varying vec4 vRRect; varying vec2 vRSize;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRQ = aQuad; vRRing = aRing; vRRect = aNameRect; vRSize = aNameSize;`)
      // After the height law (patchBuildingHeight's line): the street under a wall ring rises with Master (the ground
      // relief is stretched, the building is not), so the ring moves with it, in true metres. A station's ring is not capped
      // (aRoom is huge: its roof rises with the street too); a `host` ring is capped at the wall left on a box that does not grow.
      // A roof roundel follows the roof by aRise (above the design Master only).
      .replace('transformed.y = aBaseY + ( transformed.y - aBaseY ) * uHeightScale;', `transformed.y = aBaseY + ( transformed.y - aBaseY ) * uHeightScale;
\ttransformed.y += min( aStreet * ( 1.0 / max( uHeightScale, 0.05 ) - ${designMaster.toFixed(4)} ), aRoom ) * ${VE.toFixed(1)} * uHeightScale;
\ttransformed.y += aRise * max( 0.0, 1.0 / max( uHeightScale, 0.05 ) - ${designMaster.toFixed(4)} ) * ${VE.toFixed(1)} * uHeightScale;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRingRed; uniform vec3 uRingOrange; uniform vec3 uRingTeal; uniform vec3 uBar; uniform vec3 uName; uniform sampler2D uNames;
varying vec2 vRQ; varying float vRRing; varying vec4 vRRect; varying vec2 vRSize;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vRQ * vec2(${ROUNDEL.width.toFixed(1)}, ${ROUNDEL.height.toFixed(3)});
  float r = length(p);
  float aa = max(fwidth(r), 0.001);
  float ringM = smoothstep(${ROUNDEL.outerR.toFixed(4)} + aa, ${ROUNDEL.outerR.toFixed(4)} - aa, r) * smoothstep(${ROUNDEL.innerR.toFixed(4)} - aa, ${ROUNDEL.innerR.toFixed(4)} + aa, r);
  float barM = smoothstep(${(ROUNDEL.barH / 2).toFixed(4)} + aa, ${(ROUNDEL.barH / 2).toFixed(4)} - aa, abs(p.y));
  float cover = max(ringM, barM);
  vec3 ringCol = vRRing < 0.5 ? uRingRed : (vRRing < 1.5 ? uRingOrange : uRingTeal);
  vec3 col = mix(ringCol, uBar, barM);
  // The name is read from the atlas in UNIFORM control flow (sprint 14Oct26w). Sampled inside the old
  // "if the pixel is on the name" branch, the 2 x 2 quads that straddled the name's edge had undefined derivatives and the GPU
  // picked a coarse mip (the atlas average, grey): a thin grey outline all round the name on the bar. The coordinates are
  // derived outside any branch, the gradients come from the unclamped ones, and the ink is masked afterwards.
  vec2 half_ = vRSize * 0.5;
  vec2 tRaw = (p + half_) / max(vRSize, vec2(1e-3));
  vec2 tIn = clamp(tRaw, 0.0, 1.0);
  vec2 uvRaw = vec2(mix(vRRect.x, vRRect.z, tRaw.x), mix(vRRect.w, vRRect.y, tRaw.y));
  vec2 uvIn = vec2(mix(vRRect.x, vRRect.z, tIn.x), mix(vRRect.w, vRRect.y, tIn.y));
  float ink = textureGrad(uNames, uvIn, dFdx(uvRaw), dFdy(uvRaw)).r;
  float inside = step(abs(p.x), half_.x) * step(abs(p.y), half_.y) * step(0.5, vRSize.x);
  col = mix(col, uName, ink * inside * barM);
  diffuseColor = vec4(col, cover);
}`);
  } });
  const roundels = new THREE.Mesh(rGeo, roundelMat);
  roundels.name = 'station-roundels';
  roundels.userData.kind = 'station-roundels';
  roundels.userData.triBuilding = Uint16Array.from(rTriBuilding);
  roundels.frustumCulled = false;
  roundels.customDepthMaterial = depthMat;

  // ── Host skirts (sprint 14Oct26w) ──
  // A baked map box stands at the ground under its CENTRE, so a 90 m box on a slope floats over the street on its low side: Fulham
  // Broadway's host is 2.8 m above the street at its north face (and North Greenwich's 0.7 m at its west). Where a building has a
  // `host`, a thin wall in the map boxes' grey closes the gap, from the host's base down to the ground along each face. Its vertices
  // are in canonical Y with no height law, so it follows Master exactly as the terrain and the box's own base do.
  const skirtP = [], skirtN = [];
  for (const b of buildings) {
    if (!b.host) continue;
    const h = b.host, half = h.side / 2, top = h.baseM * VE, sx = [-1, 1, 1, -1], sz = [-1, -1, 1, 1];
    for (let f = 0; f < 4; f++) {
      const ax = h.x + sx[f] * half, az = h.z + sz[f] * half, bx = h.x + sx[(f + 1) % 4] * half, bz = h.z + sz[(f + 1) % 4] * half;
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 3)), nx = (bz - az) / L, nz = -(bx - ax) / L;   // outward (the ring runs clockwise in x, z)
      const pt = (t) => { const x = ax + (bx - ax) * t, z = az + (bz - az) * t, g = getStructuralY?.(x, z); return { x, z, y: Number.isFinite(g) ? g - 0.3 * VE : top }; };
      let prev = pt(0);
      for (let i = 1; i <= n; i++) {
        const cur = pt(i / n);
        if (prev.y < top - 1e-6 || cur.y < top - 1e-6) {
          const y0 = Math.min(prev.y, top), y1 = Math.min(cur.y, top);
          // two triangles, counter-clockwise seen from outside (the ring runs x, then z, so outside is -z on the first face)
          skirtP.push(prev.x, y0, prev.z, cur.x, top, cur.z, cur.x, y1, cur.z, prev.x, y0, prev.z, prev.x, top, prev.z, cur.x, top, cur.z);
          for (let k = 0; k < 6; k++) skirtN.push(nx, 0, nz);
        }
        prev = cur;
      }
    }
  }
  let skirts = null, skirtGeo = null, skirtMat = null;
  if (skirtP.length) {
    skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skirtP), 3));
    skirtGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(skirtN), 3));
    skirtGeo.computeBoundingSphere();
    skirtMat = new THREE.MeshStandardMaterial({ color: HOST_SKIRT_COLOUR, roughness: 0.9, metalness: 0 });
    skirts = new THREE.Mesh(skirtGeo, skirtMat);
    skirts.name = 'station-host-skirts';
    skirts.userData.kind = 'station-host-skirts';
    skirts.frustumCulled = false;
  }

  const group = new THREE.Group();
  group.name = 'station-buildings';
  group.add(walls, roundels);
  if (skirts) group.add(skirts);

  const triangles = (wIdx.length + rIdx.length) / 3 + skirtP.length / 9;
  const textureBytes = atlas?.bytes ?? 0;
  const stats = { draws: skirts ? 3 : 2, triangles, textureBytes, atlasMs: atlas?.ms ?? 0, geometryMs: performance.now() - t0, atlas: atlas ? { width: atlas.width, height: atlas.height, glyph: atlas.glyph } : null,
    walls: wIdx.length / 3, roundelTriangles: rIdx.length / 3 };

  function buildingAtFace(mesh, faceIndex) {
    const tb = mesh?.userData?.triBuilding;
    const i = tb && Number.isInteger(faceIndex) ? tb[faceIndex] : undefined;
    return i === undefined ? null : buildings[i] ?? null;
  }
  function setRoundelsVisible(v) { roundels.visible = !!v; }

  /** Roof Y (canonical, at the current Structure scale) and the footprint's bounding corners at the roof, or null. */
  function roofOf(building, scale = getBuildingHeightScale()) {
    const base = bases.get(building.key);
    if (base === undefined) return null;
    const roofY = displayedRoofY(building, base, scale, { VE, designMaster });
    const b = bounds(footprintOf(building));
    return { x: building.label.x, z: building.label.z, roofY, base, corners: [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]] };
  }
  // The label anchor is read for every surface label every frame: one shared object per name, its roof refreshed in place.
  const anchorByName = new Map();
  /** The label anchor for a cleaned station name (stations.js setSurfaceLabelAnchor), or null. */
  function labelAnchor(name) {
    let a = anchorByName.get(name);
    if (a === undefined) {
      const b = index.buildingForName(name);
      const r = b ? roofOf(b) : null;
      a = r ? { ...r, building: b, h: b.height * VE } : null;
      anchorByName.set(name, a);
    }
    if (a) a.roofY = displayedRoofY(a.building, a.base, getBuildingHeightScale(), { VE, designMaster });
    return a;
  }
  // Hover: the displayed building is a vertical prism over its footprint, from the skirt to the roof at the current
  // Structure scale. The merged geometry is authored at the unscaled height, so a raycast against it would hit air
  // above the roof at Master > 1; this tests the displayed prism exactly instead.
  const prisms = buildings.map((b) => { const ring = footprintOf(b), bb = bounds(ring); return { b, ring, bb, base: bases.get(b.key) ?? 0, h: b.height * VE, rise: b.riseM ?? 0 }; });
  /** The distance at which the ray (canonical world space) first enters prism `p` before `tMax`, or null. */
  function prismEntry(p, ox, oy, oz, dx, dy, dz, scale, tMax = Infinity) {
    const Mrise = Math.max(0, 1 / Math.max(scale, 0.05) - designMaster);
    const yb = p.base - SKIRT_M * VE * scale, yr = p.base + p.h * scale + p.rise * Mrise * VE * scale;
    // the part of the ray inside the slab [yb, yr]
    let t0 = 0, t1 = tMax;
    if (Math.abs(dy) < 1e-12) { if (oy < yb || oy > yr) return null; }
    else { const a = (yb - oy) / dy, c = (yr - oy) / dy; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
    if (!(t1 > t0)) return null;
    if (t1 === Infinity) t1 = t0 + 1e5;
    const ax = ox + dx * t0, az = oz + dz * t0, bx = ox + dx * t1, bz = oz + dz * t1;
    // the 2D segment must reach the footprint's bounding box at all
    if (Math.max(ax, bx) < p.bb.x0 || Math.min(ax, bx) > p.bb.x1 || Math.max(az, bz) < p.bb.z0 || Math.min(az, bz) > p.bb.z1) return null;
    if (pointInRing(ax, az, p.ring)) return t0;
    let t = null;
    const ex = bx - ax, ez = bz - az;
    for (let i = 0, n = p.ring.length; i < n; i++) {
      const q = p.ring[i], r = p.ring[(i + 1) % n], fx = r[0] - q[0], fz = r[1] - q[1];
      const den = ex * fz - ez * fx;
      if (Math.abs(den) < 1e-12) continue;
      const u = ((q[0] - ax) * fz - (q[1] - az) * fx) / den, v = ((q[0] - ax) * ez - (q[1] - az) * ex) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { const tt = t0 + u * (t1 - t0); if (t === null || tt < t) t = tt; }
    }
    return t;
  }
  /** The nearest displayed building the ray (canonical world space) enters, ignoring what stands in front of it: { building, t } or null. */
  function pickRayRaw(ox, oy, oz, dx, dy, dz, scale = getBuildingHeightScale()) {
    let best = null;
    for (const p of prisms) {
      const t = prismEntry(p, ox, oy, oz, dx, dy, dz, scale);
      if (t !== null && (!best || t < best.t)) best = { building: p.b, t };
    }
    return best;
  }
  /**
   * Does the segment (origin o, unit direction d, length tMax) enter the displayed prism of any station building other than
   * `excludeKey`? (Sprint 14Oct26w: the name occluder's first test; prismEntry is pickRayRaw's own, with a length and a skip.)
   */
  function segmentHitsStation(ox, oy, oz, dx, dy, dz, tMax, excludeKey = null, scale = getBuildingHeightScale()) {
    for (const p of prisms) {
      if (p.b.key === excludeKey) continue;
      // (A prism the segment STARTS inside is the building the viewer stands in or under, as at a platform in the open: it is not in front.)
      const t = prismEntry(p, ox, oy, oz, dx, dy, dz, scale, tMax);
      if (t !== null && t > 1e-6) return true;
    }
    return false;
  }
  // What is drawn in front of a station building hides it from hover: the app registers the test (ground, boxes, landmarks, and,
  // since 14Oct26w, bridges, trains and aircraft). It returns false, true (something unnamed) or a descriptor { kind, name? }.
  let occluder = null;
  function setOccluder(fn) { occluder = typeof fn === 'function' ? fn : null; }
  const meshesApi = { lastOcclusion: null };
  /** The nearest displayed building the ray (canonical world space) enters and can SEE: { building, t } or null. */
  function pickRay(ox, oy, oz, dx, dy, dz, scale = getBuildingHeightScale()) {
    const hit = pickRayRaw(ox, oy, oz, dx, dy, dz, scale);
    if (hit && occluder) {
      const occ = occluder(ox, oy, oz, dx, dy, dz, hit.t, scale);
      if (occ) { meshesApi.lastOcclusion = typeof occ === 'object' ? occ : { kind: 'map' }; return null; }
    }
    return hit;
  }
  /**
   * Every roundel quad as it is drawn at the current Master, canonical Y (the vertex shader's own formula, roundelExtent):
   * [{ key, title, on, host, x, z, nx, nz, D, W, bottomY, topY }]. For the checker.
   */
  function roundelExtents(scale = getBuildingHeightScale()) {
    const out = [];
    for (const b of buildings) {
      const base = bases.get(b.key) ?? 0;
      for (const r of b.roundels) {
        const e = roundelExtent(b, r, base, scale, { VE, designMaster });
        out.push({ key: b.key, title: b.title, on: r.on, host: !!r.host, x: r.x, z: r.z, nx: r.nx ?? 0, nz: r.nz ?? 0, D: r.D, W: r.D * wide, bottomY: e.bottomY, topY: e.topY });
      }
    }
    return out;
  }
  /** Running totals of the label occluder (written by the app's occluder, main.js): frames, tests, ms, labels hidden. */
  const labelOcclusion = { frames: 0, tests: 0, ms: 0, hidden: 0 };
  function dispose() {
    wallGeo.dispose(); rGeo.dispose(); wallMat.dispose(); roundelMat.dispose(); depthMat.dispose(); blank.dispose(); atlas?.texture.dispose(); skirtGeo?.dispose(); skirtMat?.dispose();
  }
  const api = { group, walls, roundels, bases, stats, buildingAtFace, setRoundelsVisible, roofOf, labelAnchor, pickRay, pickRayRaw, segmentHitsStation, setOccluder, roundelExtents, labelOcclusion, dispose, atlas, index };
  Object.defineProperty(api, 'lastOcclusion', { get: () => meshesApi.lastOcclusion, set: (v) => { meshesApi.lastOcclusion = v; }, enumerable: true });
  return api;
}

/** Asynchronous wrapper: waits for the Railway face (at most 1.5 s), then builds. */
export async function buildStationBuildingsWhenReady(opts) {
  await whenRailwayReady(1500, opts.document);
  return createStationBuildingMeshes(opts);
}
