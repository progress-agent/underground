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

  return { json, buildings: json.buildings, byKey, items, hidesBox, contactAt, distanceTo, buildingForSite, buildingForName, stationExitPose, siteKeyOf };
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
const NAME_COLOUR = '#e6e6e6';          // under the bloom threshold, as platform-tunnel.js
const WALL_COLOUR = 0xdcdad4;            // white, kept under the bloom threshold through AgX
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
  for (const [n, r] of layout.rects) rects.set(n, { u0: r.x / W, v0: r.y / H, u1: (r.x + r.w) / W, v1: (r.y + r.h) / H, wPx: r.w - 8, hPx: r.h });
  return { texture, rects, width: W, height: H, glyph: layout.glyph, bytes: Math.round(W * H * 4 / 3), ms: performance.now() - t0 };
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

  // ── Walls and roofs ──
  const wp = [], wn = [], wb = [], wIdx = [], triBuilding = [];
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
      for (let k = 0; k < 4; k++) { wn.push(nx, 0, nz); wb.push(base); }
      wIdx.push(o, o + 1, o + 2, o, o + 2, o + 3); triBuilding.push(bi, bi);
    }
    const o = wp.length / 3;
    for (const [x, z] of fp) { wp.push(x, roof, z); wn.push(0, 1, 0); wb.push(base); }
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
  wallGeo.setIndex(new THREE.BufferAttribute(wp.length / 3 > 65535 ? new Uint32Array(wIdx) : new Uint16Array(wIdx), 1));
  wallGeo.computeBoundingSphere(); wallGeo.computeBoundingBox();
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOUR, roughness: 0.9, metalness: 0 });
  patchBuildingHeight(wallMat, { key: 'station-walls' });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.name = 'station-buildings-walls';
  walls.userData.kind = 'station-buildings';
  walls.userData.triBuilding = Uint16Array.from(triBuilding);
  walls.frustumCulled = false;

  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchBuildingHeight(depthMat, { key: 'station-depth' });
  walls.customDepthMaterial = depthMat;

  // ── Roundels ──
  const rp = [], rn = [], rq = [], rr = [], rrect = [], rsz = [], rb = [], rIdx = [], rTriBuilding = [];
  const wide = ROUNDEL.width / (2 * ROUNDEL.outerR);       // quad width over quad height
  const barH = ROUNDEL.barH / ROUNDEL.height;              // the bar as a fraction of the quad's height
  buildings.forEach((b, bi) => {
    const base = bases.get(b.key);
    const rect = atlas?.rects.get(String(b.title).toUpperCase()) ?? null;
    // The name's extent on the bar in quad units (x across 0..500, y up 0..406.289), aspect kept.
    let nw = 0, nh = 0;
    if (rect) {
      nh = BAR_TEXT_FRAC * ROUNDEL.barH; nw = nh * rect.wPx / rect.hPx;
      if (nw > BAR_TEXT_MAX_W) { nh *= BAR_TEXT_MAX_W / nw; nw = BAR_TEXT_MAX_W; }
    }
    for (const r of b.roundels) {
      const D = r.D, W = D * wide, ring = RING_INDEX[r.ring] ?? 0;
      let rx, rz, ux, uz, uy = 0, nx = 0, ny = 0, nz = 0, cy;
      if (r.on === 'wall') { rx = r.nz; rz = -r.nx; ux = 0; uz = 0; uy = 1; nx = r.nx; nz = r.nz; cy = base + r.yM * VE; }
      else { rx = r.ax; rz = r.az; ux = r.az; uz = -r.ax; ny = 1; cy = base + r.yM * VE + 0.05 * VE; }
      const o = rp.length / 3;
      for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const hx = rx * W * sx + ux * D * sy, hz = rz * W * sx + uz * D * sy, hy = uy * D * VE * sy;
        rp.push(r.x + hx, cy + hy, r.z + hz);
        rn.push(nx, ny, nz); rq.push(sx, sy); rr.push(ring); rb.push(base);
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
attribute vec2 aQuad; attribute float aRing; attribute vec4 aNameRect; attribute vec2 aNameSize;
varying vec2 vRQ; varying float vRRing; varying vec4 vRRect; varying vec2 vRSize;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRQ = aQuad; vRRing = aRing; vRRect = aNameRect; vRSize = aNameSize;`);
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
  vec2 half_ = vRSize * 0.5;
  if (vRSize.x > 0.0 && abs(p.x) < half_.x && abs(p.y) < half_.y) {
    vec2 t = (p + half_) / vRSize;
    vec2 uv = vec2(mix(vRRect.x, vRRect.z, t.x), mix(vRRect.w, vRRect.y, t.y));
    col = mix(col, uName, texture2D(uNames, uv).r * barM);
  }
  diffuseColor = vec4(col, cover);
}`);
  } });
  const roundels = new THREE.Mesh(rGeo, roundelMat);
  roundels.name = 'station-roundels';
  roundels.userData.kind = 'station-roundels';
  roundels.userData.triBuilding = Uint16Array.from(rTriBuilding);
  roundels.frustumCulled = false;
  roundels.customDepthMaterial = depthMat;

  const group = new THREE.Group();
  group.name = 'station-buildings';
  group.add(walls, roundels);

  const triangles = (wIdx.length + rIdx.length) / 3;
  const textureBytes = atlas?.bytes ?? 0;
  const stats = { draws: 2, triangles, textureBytes, atlasMs: atlas?.ms ?? 0, geometryMs: performance.now() - t0, atlas: atlas ? { width: atlas.width, height: atlas.height, glyph: atlas.glyph } : null,
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
    const roofY = base + building.height * VE * scale;
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
    if (a) a.roofY = a.base + a.h * getBuildingHeightScale();
    return a;
  }
  // Hover: the displayed building is a vertical prism over its footprint, from the skirt to the roof at the current
  // Structure scale. The merged geometry is authored at the unscaled height, so a raycast against it would hit air
  // above the roof at Master > 1; this tests the displayed prism exactly instead.
  const prisms = buildings.map((b) => { const ring = footprintOf(b), bb = bounds(ring); return { b, ring, bb, base: bases.get(b.key) ?? 0, h: b.height * VE }; });
  /** The nearest displayed building the ray (canonical world space) enters: { building, t } or null. */
  function pickRay(ox, oy, oz, dx, dy, dz, scale = getBuildingHeightScale()) {
    let best = null;
    for (const p of prisms) {
      const yb = p.base - SKIRT_M * VE * scale, yr = p.base + p.h * scale;
      // the part of the ray inside the slab [yb, yr]
      let t0 = 0, t1 = Infinity;
      if (Math.abs(dy) < 1e-12) { if (oy < yb || oy > yr) continue; }
      else { const a = (yb - oy) / dy, c = (yr - oy) / dy; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
      if (!(t1 > t0)) continue;
      if (t1 === Infinity) t1 = t0 + 1e5;
      if (best && t0 >= best.t) continue;
      const ax = ox + dx * t0, az = oz + dz * t0, bx = ox + dx * t1, bz = oz + dz * t1;
      // the 2D segment must reach the footprint's bounding box at all
      if (Math.max(ax, bx) < p.bb.x0 || Math.min(ax, bx) > p.bb.x1 || Math.max(az, bz) < p.bb.z0 || Math.min(az, bz) > p.bb.z1) continue;
      let t = null;
      if (pointInRing(ax, az, p.ring)) t = t0;
      else {
        const ex = bx - ax, ez = bz - az;
        for (let i = 0, n = p.ring.length; i < n; i++) {
          const q = p.ring[i], r = p.ring[(i + 1) % n], fx = r[0] - q[0], fz = r[1] - q[1];
          const den = ex * fz - ez * fx;
          if (Math.abs(den) < 1e-12) continue;
          const u = ((q[0] - ax) * fz - (q[1] - az) * fx) / den, v = ((q[0] - ax) * ez - (q[1] - az) * ex) / den;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { const tt = t0 + u * (t1 - t0); if (t === null || tt < t) t = tt; }
        }
      }
      if (t !== null && (!best || t < best.t)) best = { building: p.b, t };
    }
    return best;
  }
  function dispose() {
    wallGeo.dispose(); rGeo.dispose(); wallMat.dispose(); roundelMat.dispose(); depthMat.dispose(); blank.dispose(); atlas?.texture.dispose();
  }
  return { group, walls, roundels, bases, stats, buildingAtFace, setRoundelsVisible, roofOf, labelAnchor, pickRay, dispose, atlas, index };
}

/** Asynchronous wrapper: waits for the Railway face (at most 1.5 s), then builds. */
export async function buildStationBuildingsWhenReady(opts) {
  await whenRailwayReady(1500, opts.document);
  return createStationBuildingMeshes(opts);
}
