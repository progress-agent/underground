// baked-buildings.js — loads the offline-compiled building payload (UGB1)
//
// The counterpart to scripts/bake-surface.mjs. That compiler resolves, offline,
// every piece of work the live JSON path does on the main thread on each tile
// arrival — terrain lookup, M25 clip, river exclusion, dedup, degenerate-data
// guards, landmark suppression — and packs the result into 10-byte records.
// This module decodes them straight into InstancedMesh matrices.
//
// WHY IT EXISTS. The live path's per-tile building step is measured at 7-106ms
// (median ~46, p95 150, p99 220) and fires 362 times in a 15s flight, because
// tiles leaving UNLOAD_RADIUS are disposed and rebuilt from scratch when the
// camera returns. That recurring cost is the flying stutter. Here the whole
// city is built once and never disposed, so the mechanism that stutters is gone
// rather than made faster.
//
// WHAT IT DOES NOT REPLACE. The bake covers buildings only. Parks and roads are
// still rasterised into the persistent surface texture from the JSON tiles by
// surface-loader.js, so the loader keeps running when this path is active — it
// just stops creating building meshes. rasteriseTile has no already-done guard,
// so that cost recurs on every reload too; only its EFFECT is idempotent. This
// module removes one of the two per-arrival costs. The ground-artwork bake is
// what removes the other.
//
// THREE THINGS THE FORMAT GUARANTEES, each a decision rather than a detail:
//
//  1. REAL METRES, NEVER SCENE-Y. Every vertical value in the payload is real
//     metres x 10. This module multiplies by VE at build time. A payload is
//     therefore NOT invalidated by a VERTICAL_EXAGGERATION change (D-023 §5).
//     It IS invalidated by a terrain change, because base elevations were
//     sampled from the terrain mesh — see the bake script's RE-RUN WHEN.
//
//  2. TILE-RELATIVE COORDINATES. cx/cz are u16 decimetre offsets from the
//     tile's own integer minX/minZ in the directory. That is what buys 10 bytes
//     a building; it also means a record is meaningless without its directory
//     entry, so the two are decoded together and never separately.
//
//  3. ALREADY FILTERED. Nothing in the payload needs an M25 test, a river test,
//     a dedup hash or a finite-height guard. Re-applying any of them here would
//     be duplicated work on 1.2M records and would silently diverge from the
//     compiler the day one side changed.
//
// The build is INCREMENTAL and frame-budgeted. 1.2M instance matrices is a
// ~200ms hitch if written in one go, which would land in the middle of the
// cinematic intro. pump() spends a bounded slice per frame and finishes in
// well under a second of wall clock, after which nothing happens ever again.

import * as THREE from 'three';

const MAGIC = 0x31424755;   // 'UGB1' little-endian
const REC_BYTES = 10;
const DIR_BYTES = 16;
const HEADER_BYTES = 12;

export const BAKED_URL = '/data/surface/baked/buildings.bin';

// ─── Load ───────────────────────────────────────────────────────────────────

/**
 * Fetch and validate the baked payload.
 *
 * Validation is deliberately strict and fails loudly: a truncated or
 * wrong-version payload that decoded "mostly fine" would scatter 1.2M boxes
 * across London with no error, and the failure mode would look like a rendering
 * bug rather than a data one.
 *
 * @param {string} [url]
 * @returns {Promise<{buffer: ArrayBuffer, view: DataView, tiles: Array, buildings: number, version: number, bytes: number}>}
 */
export async function fetchBakedBuildings(url = BAKED_URL) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`baked payload: HTTP ${resp.status}`);

  // SPA-fallback trap, same one surface-loader.js guards: a dev server or a
  // Pages catch-all answers a missing file with index.html at HTTP 200.
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error('baked payload: got HTML (SPA fallback) — payload not deployed');

  const buffer = await resp.arrayBuffer();
  return parseBakedBuildings(buffer);
}

/**
 * Parse an already-fetched payload. Split out from the fetch so tests and the
 * verifier can drive it from a Buffer without a server.
 */
export function parseBakedBuildings(buffer) {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('baked payload: shorter than its header');
  const view = new DataView(buffer);

  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`baked payload: bad magic 0x${magic.toString(16)} (expected UGB1)`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`baked payload: format version ${version}, this build reads 1`);

  const tileCount = view.getUint16(6, true);
  const buildings = view.getUint32(8, true);

  const expected = HEADER_BYTES + tileCount * DIR_BYTES + buildings * REC_BYTES;
  if (buffer.byteLength !== expected) {
    throw new Error(`baked payload: ${buffer.byteLength} bytes, header implies ${expected} (${tileCount} tiles, ${buildings} buildings) — truncated or corrupt`);
  }

  const tiles = new Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    const d = HEADER_BYTES + i * DIR_BYTES;
    tiles[i] = {
      minX: view.getInt32(d, true),
      minZ: view.getInt32(d + 4, true),
      offset: view.getUint32(d + 8, true),
      count: view.getUint32(d + 12, true),
    };
  }

  return { buffer, view, tiles, buildings, version, bytes: buffer.byteLength };
}

// ─── Build ──────────────────────────────────────────────────────────────────

// One box for the entire city. The live path allocates a BoxGeometry per tile
// because it disposes them per tile; nothing here is ever disposed, so 619
// identical geometries would be 619 pointless GPU buffers.
//
// Base-pivoted exactly as surface-geometry.js does it, because the D-023 height
// shader multiplies local y and expects 0..1 to run footprint-to-roof.
let sharedBoxGeo = null;
function getSharedBoxGeometry() {
  if (!sharedBoxGeo) {
    sharedBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    sharedBoxGeo.translate(0, 0.5, 0);
    sharedBoxGeo.name = 'baked-building-box';
  }
  return sharedBoxGeo;
}

/**
 * Build one tile's InstancedMesh directly from the payload.
 *
 * Matrices are written straight into instanceMatrix.array rather than through
 * Object3D + updateMatrix + setMatrixAt. For an axis-aligned box carrying only
 * scale and translation the matrix is seven non-zero terms in a zero-filled
 * buffer, so the whole Object3D round trip is avoidable — measured worth having
 * across 1.2M instances, and it is the difference between one budgeted frame
 * and several.
 *
 * Column-major layout, matching THREE.Matrix4.elements:
 *   [0]=sx  [5]=sy  [10]=sz  [12]=x [13]=y [14]=z  [15]=1
 */
export function buildBakedTile(payload, tileIndex, VE, material) {
  const t = payload.tiles[tileIndex];
  if (!t || t.count === 0) return null;

  const { view } = payload;
  const mesh = new THREE.InstancedMesh(getSharedBoxGeometry(), material, t.count);
  const m = mesh.instanceMatrix.array;   // Float32Array, zero-filled

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let off = t.offset;
  for (let i = 0; i < t.count; i++, off += REC_BYTES) {
    const x = t.minX + view.getUint16(off, true) * 0.1;
    const z = t.minZ + view.getUint16(off + 2, true) * 0.1;
    const h = view.getUint16(off + 4, true) * 0.1 * VE;
    const side = view.getUint16(off + 6, true) * 0.1;
    const y = view.getInt16(off + 8, true) * 0.1 * VE;

    const o = i * 16;
    m[o] = side;
    m[o + 5] = h;
    m[o + 10] = side;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;

    // Track extents as we go. The alternative is InstancedMesh's own lazy
    // computeBoundingSphere(), which walks all 1.2M matrices again on the first
    // frame they are frustum-tested — a hitch outside any budget we set here.
    const hx = side * 0.5;
    if (x - hx < minX) minX = x - hx;
    if (x + hx > maxX) maxX = x + hx;
    if (z - hx < minZ) minZ = z - hx;
    if (z + hx > maxZ) maxZ = z + hx;
    if (y < minY) minY = y;
    if (y + h > maxY) maxY = y + h;
  }

  mesh.instanceMatrix.needsUpdate = true;

  // Bounds from the AABB we just accumulated. Conservative (a sphere around the
  // box, not the minimal sphere) which is the safe direction: it can cost a
  // frustum test, never a missing building.
  //
  // NOTE the same caveat D-023 records for the live path: these bounds encode
  // UNSCALED height, so the height shader may only scale DOWN. Raising the
  // slider cap above 1.0 means inflating maxY here too.
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  const dx = maxX - cx, dy = maxY - cy, dz = maxZ - cz;
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(cx, cy, cz),
    Math.sqrt(dx * dx + dy * dy + dz * dz),
  );
  mesh.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  );

  mesh.name = `baked-buildings-${tileIndex}`;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/**
 * Frame-budgeted builder over the whole payload.
 *
 * @param {object}   payload   from fetchBakedBuildings / parseBakedBuildings
 * @param {object}   opts
 * @param {number}   opts.VE         vertical exaggeration to apply at build time
 * @param {THREE.Material} opts.material  shared building material (carries the D-023 uniform)
 * @param {Function} opts.onMesh     (mesh) => void, called per completed tile
 * @returns {{pump: Function, isDone: Function, stats: Function}}
 */
export function createBakedBuildingBuilder(payload, { VE, material, onMesh }) {
  let next = 0;
  let placed = 0;
  let meshes = 0;
  let elapsedMs = 0;

  return {
    /**
     * Build tiles until the budget is spent. Returns true when everything is
     * resident. Budget is checked per tile, so one very large tile can overrun
     * it; tiles average ~2000 instances and the largest is nowhere near a frame.
     */
    pump(budgetMs = 6) {
      if (next >= payload.tiles.length) return true;
      const t0 = performance.now();
      while (next < payload.tiles.length && performance.now() - t0 < budgetMs) {
        const mesh = buildBakedTile(payload, next, VE, material);
        if (mesh) {
          placed += mesh.count;
          meshes++;
          onMesh(mesh);
        }
        next++;
      }
      elapsedMs += performance.now() - t0;
      return next >= payload.tiles.length;
    },
    isDone: () => next >= payload.tiles.length,
    stats: () => ({
      tilesBuilt: next,
      tilesTotal: payload.tiles.length,
      meshes,
      buildings: placed,
      buildingsTotal: payload.buildings,
      buildMs: Math.round(elapsedMs),
    }),
  };
}
