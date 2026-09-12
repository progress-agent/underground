import * as THREE from 'three';
import UPNG from 'upng-js';
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import {
  generateTerrainGrainTexture,
  generateTerrainRoughnessTexture,
  generateTerrainNormalMap,
  generateUndersideGrainTexture,
  generateUndersideNormalMap,
} from './textures.js';
import { RENDER_ORDER, WATER_LIFT } from './render-layers.js';

export const TERRAIN_ORIGIN_BNG = [BNG_REF_E, BNG_REF_N];

// Unified vertical exaggeration for terrain AND underground depth.
// VE=5 splits the difference: terrain hills pronounced, underground depth visible,
// no "diving" artefacts at hilly areas like Hampstead.
export const VERTICAL_EXAGGERATION = 5;

// Terrain configuration
export const TERRAIN_CONFIG = {
  // Source files (tried in order)
  metaPath: '/data/terrain/london_full_height.json',
  fallbackMetaPath: '/data/terrain/victoria_dtm_u16.json',

  // Geometry resolution — 512 segments gives ~27m per vertex on a 14km tile
  segments: 512,

  // Vertical exaggeration for terrain elevation.
  // London's real relief (~0–130m) is invisible at 1:1 on a 14km plane.
  // VE=5 makes hills clearly visible and matches underground depth scaling.
  verticalExaggeration: VERTICAL_EXAGGERATION,

  // Material
  opacity: 1.0,
  roughness: 0.8,
  metalness: 0.1,

  // Legacy — kept so old callers don't break; no longer used for displacement
  size: 28000,
  baseY: -6.0,
  displacementScale: 120,
  displacementBias: -60,
};

// Module-level terrain state — set by tryCreateTerrainMesh, read by helper functions
let terrainState = null;

export const TERRAIN_CORRECTION_URL = '/data/terrain/stratford-dtm.json';
export const SOUTHERN_TERRAIN_URL = '/data/terrain/southern-dtm.json';
export const AIRPORT_TERRAIN_URL = '/data/terrain/airport-dtm.json';
const AIRPORT_CORRECTION_BOUNDS={
  'heathrow':[504000,173000,511000,178000],
  'london-city':[541000,179000,544000,181000],
  'biggin-hill':[540000,159000,543000,163000],
  'northolt':[508000,184000,511000,186000],
  'elstree':[515000,195000,517000,198000],
  'denham':[502000,188000,504000,190000],
  'stapleford':[548000,196000,551000,199000],
 'kenley':[531000,156000,535000,160000],
 'damyns-hall':[554000,181000,558000,185000],
};
export function validateAirportTerrainCorrections(data){
  if(data?.version!==1||!Array.isArray(data.patches)||data.patches.length!==Object.keys(AIRPORT_CORRECTION_BOUNDS).length)throw Error('Invalid or missing physical airport DTM corrections');
  const ids=new Set();
  for(const p of data.patches){
    const bounds=AIRPORT_CORRECTION_BOUNDS[p.id];
    if(!bounds||ids.has(p.id)||p.version!==1||p.crs!=='EPSG:27700'||p.units!=='metres'||p.datum!=='Ordnance Datum Newlyn'
      ||JSON.stringify(p.bounds_m)!==JSON.stringify(bounds)||p.pixel_size_m!==25||p.boundaryBlendM!==250
      ||p.width!==(bounds[2]-bounds[0])/25||p.height!==(bounds[3]-bounds[1])/25||!Array.isArray(p.elevations)
      ||p.elevations.length!==p.width*p.height||p.elevations.some(y=>!Number.isFinite(y)||y < -1000||y > 1400)
      ||!/^[a-f0-9]{64}$/.test(p.sourceSha256))throw Error(`Invalid physical airport DTM correction: ${p.id}`);
    ids.add(p.id);
  }
  return data;
}
export function applyAirportTerrainCorrections(hm,meta,data){
  validateAirportTerrainCorrections(data);
  return data.patches.map(p=>({id:p.id,source:p.source,sourceSha256:p.sourceSha256,bounds_m:p.bounds_m,
    boundaryBlendM:p.boundaryBlendM,correctedSamples:applyPhysicalTerrainCorrection(hm,meta,p)}));
}

export function validateSouthernTerrain(data) {
  if(data?.version!==1||data.crs!=='EPSG:27700'||data.units!=='metres'||data.datum!=='Ordnance Datum Newlyn'
    ||data.width!==1400||data.height!==100||data.pixel_size_m!==50
    ||JSON.stringify(data.bounds_m)!=='[490000,151000,560000,156000]'
    ||!Array.isArray(data.elevations)||data.elevations.length!==140000
    ||data.elevations.some(y=>!Number.isFinite(y)||y < -1000||y > 1400))throw new Error('Invalid or missing physical southern DTM extension');
  return data;
}
export function getTerrainBounds() {
  if(!terrainState)return null;
  const {swSceneX,swSceneZ,neSceneX,neSceneZ,terrainW,terrainH,segments,segmentsY}=terrainState;
  return {minX:swSceneX,maxX:neSceneX,minZ:neSceneZ,maxZ:swSceneZ,widthM:terrainW,heightM:terrainH,width:terrainW,height:terrainH,
    bounds_m:[swSceneX+BNG_REF_E,BNG_REF_N-swSceneZ,neSceneX+BNG_REF_E,BNG_REF_N-neSceneZ],
    columns:segments+1,rows:segmentsY+1,originBNG:[...TERRAIN_ORIGIN_BNG]};
}


export function validateTerrainCorrection(data) {
  if (data?.version !== 1 || data.crs !== 'EPSG:27700' || data.units !== 'metres' || data.datum !== 'Ordnance Datum Newlyn'
    || data.width !== 80 || data.height !== 80 || data.pixel_size_m !== 25
    || JSON.stringify(data.bounds_m) !== '[537000,183000,539000,185000]'
    || !Array.isArray(data.elevations) || data.elevations.length !== data.width * data.height
    || data.elevations.some(y => !Number.isFinite(y) || y < -1000 || y > 1400)
    || !Number.isFinite(data.boundaryBlendM) || data.boundaryBlendM <= 0) {
    throw new Error('Invalid or missing physical Stratford DTM correction');
  }
  return data;
}

// Authoritative Float32 DTM is an area raster. Sample at pixel centres, unlike
// the legacy full-city PNG's endpoint grid. Never extrapolate outside coverage.
export function sampleTerrainCorrection(data, easting, northing) {
  const [west, south, east, north] = data.bounds_m;
  if (easting < west || easting > east || northing < south || northing > north) return null;
  const x = THREE.MathUtils.clamp((easting - west) / data.pixel_size_m - .5, 0, data.width - 1);
  const z = THREE.MathUtils.clamp((north - northing) / data.pixel_size_m - .5, 0, data.height - 1);
  const x0 = Math.floor(x), z0 = Math.floor(z), x1 = Math.min(x0 + 1, data.width - 1), z1 = Math.min(z0 + 1, data.height - 1);
  const u = x - x0, v = z - z0, row = data.width, a = data.elevations;
  const elevation = a[z0 * row + x0] * (1 - u) * (1 - v) + a[z0 * row + x1] * u * (1 - v)
    + a[z1 * row + x0] * (1 - u) * v + a[z1 * row + x1] * u * v;
  const edgeDistance = Math.min(easting - west, east - easting, northing - south, north - northing);
  const weight = THREE.MathUtils.smoothstep(edgeDistance, 0, data.boundaryBlendM);
  return { elevation, weight };
}

export function applyTerrainCorrection(hm, meta, correction) {
  validateTerrainCorrection(correction);
  return applyPhysicalTerrainCorrection(hm,meta,correction);
}

function applyPhysicalTerrainCorrection(hm, meta, correction) {
  const [west, south, east, north] = meta.bounds_m;
  const minimum = meta.elev_min_m ?? hm.minRaw;
  const range = (meta.elev_max_m ?? hm.minRaw + hm.rawRange) - minimum;
  if (!Number.isFinite(range) || range <= 0) throw new Error('Terrain has no physical elevation scale');
  let changed = 0;
  for (let row = 0; row < hm.height; row++) {
    const n = north - row / (hm.height - 1) * (north - south);
    if (n < correction.bounds_m[1] || n > correction.bounds_m[3]) continue;
    for (let col = 0; col < hm.width; col++) {
      const e = west + col / (hm.width - 1) * (east - west);
      const sample = sampleTerrainCorrection(correction, e, n);
      if (!sample || sample.weight === 0) continue;
      const index = row * hm.width + col, original = hm.floats[index] * range + minimum;
      hm.floats[index] = (THREE.MathUtils.lerp(original, sample.elevation, sample.weight) - minimum) / range;
      changed++;
    }
  }
  return changed;
}

/**
 * Decode a 16-bit PNG heightmap properly, bypassing the browser's <img> element
 * which destroys 16-bit precision by quantising to 8-bit.
 *
 * Returns { floats: Float32Array (normalised 0..1), width, height, minRaw, rawRange }.
 */
async function load16bitHeightmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch heightmap: ${res.status}`);
  const buf = await res.arrayBuffer();
  const png = UPNG.decode(buf);

  const w = png.width;
  const h = png.height;
  const depth = png.depth;   // bits per channel

  // UPNG.toRGBA8 always converts to 8-bit RGBA — useless for 16-bit data.
  // Instead, read the raw decoded buffer directly.
  // For 16-bit greyscale (ctype 0, depth 16): each pixel is 2 bytes big-endian.
  const raw = new Uint8Array(png.data);

  let floats;
  let minRaw, rawRange;

  if (depth === 16) {
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    let minR = 65535, maxR = 0;
    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      if (val < minR) minR = val;
      if (val > maxR) maxR = val;
    }
    minRaw = minR;
    rawRange = maxR - minR || 1;
    console.log(`Heightmap 16-bit: ${w}x${h}, raw range ${minR}–${maxR}, normalising to 0..1`);

    for (let i = 0; i < pixelCount; i++) {
      const hi = raw[i * 2];
      const lo = raw[i * 2 + 1];
      const val = (hi << 8) | lo;
      floats[i] = (val - minR) / rawRange;
    }
  } else {
    // 8-bit fallback
    const pixelCount = w * h;
    floats = new Float32Array(pixelCount);
    let minR = 255, maxR = 0;
    for (let i = 0; i < pixelCount; i++) {
      if (raw[i] < minR) minR = raw[i];
      if (raw[i] > maxR) maxR = raw[i];
    }
    minRaw = minR;
    rawRange = maxR - minR || 1;
    console.log(`Heightmap 8-bit: ${w}x${h}, raw range ${minR}–${maxR}, normalising to 0..1`);
    for (let i = 0; i < pixelCount; i++) {
      floats[i] = (raw[i] - minR) / rawRange;
    }
  }

  return { floats, width: w, height: h, minRaw, rawRange };
}

/**
 * Extract contour lines from displaced terrain geometry.
 * Marches through each triangle to find edges that cross contour Y-intervals,
 * then interpolates the crossing points to form line segments.
 */
function generateContourLines(geometry, intervalCount = 12) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!idx) return null;

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const step = (maxY - minY) / (intervalCount + 1);
  const intervals = [];
  for (let n = 1; n <= intervalCount; n++) intervals.push(minY + step * n);

  const points = [];
  for (const targetY of intervals) {
    for (let f = 0; f < idx.count; f += 3) {
      const i0 = idx.getX(f), i1 = idx.getX(f + 1), i2 = idx.getX(f + 2);
      const verts = [
        [pos.getX(i0), pos.getY(i0), pos.getZ(i0)],
        [pos.getX(i1), pos.getY(i1), pos.getZ(i1)],
        [pos.getX(i2), pos.getY(i2), pos.getZ(i2)],
      ];
      const crossings = [];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const ya = verts[a][1], yb = verts[b][1];
        if ((ya - targetY) * (yb - targetY) < 0) {
          const t = (targetY - ya) / (yb - ya);
          crossings.push(new THREE.Vector3(
            verts[a][0] + t * (verts[b][0] - verts[a][0]),
            targetY,
            verts[a][2] + t * (verts[b][2] - verts[a][2]),
          ));
        }
      }
      if (crossings.length === 2) points.push(crossings[0], crossings[1]);
    }
  }

  if (points.length === 0) return null;

  const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x8899aa,
    transparent: true,
    opacity: 0.25,
  });
  const lines = new THREE.LineSegments(lineGeom, lineMat);
  lines.name = 'terrainContours';
  console.log('Terrain contours:', points.length / 2, 'segments across', intervals.length, 'levels');
  return lines;
}

/**
 * Carve a river valley into the terrain elevation array.
 * Uses signed-distance-field approach: each vertex checks distance to nearest
 * Thames polyline segment. Within the river width → full carve. Within falloff → smoothstep blend.
 *
 * @param {Float32Array} elevations   Elevation in metres OD, mutated in place
 * @param {number}       vertexCols   Grid columns (segments + 1)
 * @param {number}       vertexRows   Grid rows (segments + 1)
 * @param {number}       swSceneX     West edge scene X
 * @param {number}       neSceneX     East edge scene X
 * @param {number}       swSceneZ     South edge scene Z (positive)
 * @param {number}       neSceneZ     North edge scene Z (negative)
 * @param {Array}        riverSegments [{x, z, halfW, d}, ...] in scene coords
 * @param {object}       [options]
 */
export function carveRiverChannel(
  elevations, vertexCols, vertexRows,
  swSceneX, neSceneX, swSceneZ, neSceneZ,
  riverSegments,
  options = {}
) {
  const {
    riverLevelM = 2,      // water surface in metres OD
    falloffM = 250,       // bank slope width in metres
    channelDepthM = 3,    // fallback depth below water level if point d is absent
    bankFreeboardM = 1,   // falloff floor above the water surface — land outside
                          // the channel must never be carved below water level
  } = options;

  const terrainW = neSceneX - swSceneX;
  const terrainH = swSceneZ - neSceneZ;

  // Edge shelf (10Jul26f "swollen river" fix; re-derived 11Jul26s "water low"
  // fix). The 512^2 grid's ~137x98m cells cannot hold a sharp waterline: the
  // shelf/bank transition cell renders as an artefact on whichever side of the
  // waterline it sits. v1 (shelf inside, bank floor 3m OD at the first outside
  // vertex) smeared 30-70m bands of ABOVE-water terrain INTO the channel —
  // Jordan's "water levels reading low" mudflats. The shelf therefore extends
  // one cell-diagonal BEYOND the waterline so the shelf->bank interpolation
  // cell lies fully OUTSIDE the water volume: the waterline cell renders flat
  // and submerged, and the beach rises outside the volume from just below the
  // surface (worst case ~0.25m of exposed volume side wall vs the old 8-11m
  // "swollen" walls or the 3m OD mud bands).
  //
  // CRITICAL: the shelf is derived from the RENDERED water top — the volume
  // renders at riverLevelM*VE + WATER_LIFT (z-fight lift, render-layers.js),
  // an effective 2.4m OD, not the 2.0m data constant. A shelf pinned to the
  // data plane (v1: 1.85m OD) sat 0.55m under the rendered surface while the
  // 3m bank floor stood 0.6m proud of it.
  // True bathymetric depth still survives only where dist <= halfW - edgeBand.
  const cellW = terrainW / (vertexCols - 1);
  const cellH = terrainH / (vertexRows - 1);
  const edgeBandM = Math.hypot(cellW, cellH);   // one vertex-cell diagonal
  const waterTopMOD = riverLevelM + WATER_LIFT / VERTICAL_EXAGGERATION;
  const shelfElevM = waterTopMOD - 0.25;        // just below the RENDERED surface

  // ── Spatial bucketing: group segments by X-range for O(1) lookup ──
  const BUCKET_SIZE = 500; // metres
  // Slack must cover the full influence radius: halfW + edgeBand + falloff.
  const reachSlackM = falloffM + edgeBandM;
  const minX = swSceneX - reachSlackM;
  const maxX = neSceneX + reachSlackM;
  const bucketCount = Math.ceil((maxX - minX) / BUCKET_SIZE) + 1;
  const buckets = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) buckets[i] = [];

  // Each segment spans two consecutive river points
  for (let s = 0; s < riverSegments.length - 1; s++) {
    const a = riverSegments[s];
    const b = riverSegments[s + 1];
    const segMinX = Math.min(a.x, b.x) - Math.max(a.halfW, b.halfW) - reachSlackM;
    const segMaxX = Math.max(a.x, b.x) + Math.max(a.halfW, b.halfW) + reachSlackM;
    const b0 = Math.max(0, Math.floor((segMinX - minX) / BUCKET_SIZE));
    const b1 = Math.min(bucketCount - 1, Math.floor((segMaxX - minX) / BUCKET_SIZE));
    for (let bi = b0; bi <= b1; bi++) {
      buckets[bi].push(s);
    }
  }

  // Smoothstep: 0→1 over [0,1]
  function smoothstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  // ── Per-vertex carving ──
  let carved = 0;
  for (let row = 0; row < vertexRows; row++) {
    const vFrac = row / (vertexRows - 1);
    const vZ = neSceneZ + vFrac * terrainH; // north → south

    for (let col = 0; col < vertexCols; col++) {
      const uFrac = col / (vertexCols - 1);
      const vX = swSceneX + uFrac * terrainW; // west → east

      // Find closest distance to any river segment
      const bi = Math.floor((vX - minX) / BUCKET_SIZE);
      const segs = (bi >= 0 && bi < bucketCount) ? buckets[bi] : [];
      if (segs.length === 0) continue;

      let bestDist = Infinity;
      let bestHalfW = 0;
      let bestDepthM = channelDepthM;

      for (let si = 0; si < segs.length; si++) {
        const s = segs[si];
        const a = riverSegments[s];
        const b = riverSegments[s + 1];

        // Project vertex onto segment a→b, clamp t to [0,1]
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const abLenSq = abx * abx + abz * abz;
        if (abLenSq < 1e-6) continue;

        let t = ((vX - a.x) * abx + (vZ - a.z) * abz) / abLenSq;
        t = Math.max(0, Math.min(1, t));

        const projX = a.x + t * abx;
        const projZ = a.z + t * abz;
        const dx = vX - projX;
        const dz = vZ - projZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Interpolate halfW at projection point
        const hw = a.halfW + t * (b.halfW - a.halfW);
        const da = Number.isFinite(a.d) ? a.d : channelDepthM;
        const db = Number.isFinite(b.d) ? b.d : channelDepthM;
        const depthM = da + t * (db - da);

        if (dist < bestDist) {
          bestDist = dist;
          bestHalfW = hw;
          bestDepthM = depthM;
        }
      }

      const idx = row * vertexCols + col;
      const orig = elevations[idx];

      if (bestDist <= bestHalfW + edgeBandM) {
        if (bestDist <= bestHalfW - edgeBandM) {
          // Deep channel interior: full carve to the bathymetric bed.
          elevations[idx] = Math.min(orig, riverLevelM - bestDepthM);
        } else {
          // Edge shelf — extends one cell-diagonal PAST the waterline (see
          // header note) so the rise to bank level happens in a cell that is
          // fully outside the water volume. ASSIGN (not Math.min) so raw DEM
          // water pixels that already sit below the plane are lifted too.
          elevations[idx] = shelfElevM;
        }
        carved++;
      } else if (bestDist < bestHalfW + edgeBandM + falloffM) {
        // Falloff zone: blend from BANK level to original — never from the bed.
        // Blending from carveElev here dragged riverside land metres below the
        // water surface (the 10Jul26f "flooded Thames": buildings placed on
        // carved terrain stood waist-deep beside the volume). Bed elevation is
        // exclusive to the channel; outside it the floor is water + freeboard.
        // The blend is TWO-SIDED: it cuts high banks toward bankElev AND fills
        // genuinely low DEM land (raw DEM water strip, low marsh) up to bankElev
        // at the channel edge, tapering to orig at falloffM — a Math.min here
        // left sub-water DEM pixels beside the channel (swollen-river residual).
        const bankElev = riverLevelM + bankFreeboardM;
        const blend = smoothstep((bestDist - (bestHalfW + edgeBandM)) / falloffM);
        const blended = bankElev + blend * (orig - bankElev);
        elevations[idx] = blended;
        carved++;
      }
    }
  }

  console.log(`River channel: carved ${carved} vertices (${(carved / (vertexCols * vertexRows) * 100).toFixed(1)}% of terrain)`);
}

export async function tryCreateTerrainMesh({ opacity = TERRAIN_CONFIG.opacity, wireframe = false, thamesData = null } = {}) {
  // Looks for generated outputs from scripts/build-heightmap.mjs
  // Expected files (served from /public/data):
  // - /data/terrain/london_full_height_u16.png (full London coverage, 10m res)
  // - /data/terrain/london_full_height.json
  // Fallback:
  // - /data/terrain/victoria_dtm_u16.png (Victoria AOI only)
  // - /data/terrain/victoria_dtm_u16.json
  try {
    // Try each metadata file in order. Vite's dev server returns 200 + HTML for
    // missing files (SPA fallback), so we must also catch JSON parse errors.
    let meta = null;
    for (const path of ['/data/terrain/london_full_height.json', '/data/terrain/victoria_dtm_u16.json']) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;  // Skip HTML fallback responses
        const candidate = await res.json();
        // The legacy Victoria PNG has only0–255 intensity values and no
        // metre conversion. Never silently promote those values to elevations.
        if (!Number.isFinite(candidate.elev_min_m) || !Number.isFinite(candidate.elev_max_m)
          || candidate.elev_max_m <= candidate.elev_min_m) continue;
        meta = candidate;
        break;
      } catch { /* not valid JSON, try next */ }
    }
    if (!meta) return null;

    // Decode 16-bit PNG properly — browser <img> destroys 16-bit precision
    const hm = await load16bitHeightmap(`/data/terrain/${meta.heightmap}`);
    // DSM includes roofs. Replace only independently validated Stratford
    // coverage with EA bare-earth elevations, before geometry, normals, colours
    // and all height samplers are built. Missing correction must be visible.
    const correctionResponse = await fetch(TERRAIN_CORRECTION_URL);
    if (!correctionResponse.ok || !(correctionResponse.headers.get('content-type') || '').includes('json')) {
      throw new Error('Required Stratford DTM correction is unavailable');
    }
    const correction = validateTerrainCorrection(await correctionResponse.json());
    const correctedSamples = applyTerrainCorrection(hm, meta, correction);
    meta.terrainCorrection = { source: correction.source, sourceSha256: correction.sourceSha256,
      bounds_m: correction.bounds_m, correctedSamples };

    // Airport terminal/hangar roofs are also present in the legacy DSM. Use
    // complete, validated EA bare-earth patches, blending only inside coverage.
    const airportResponse=await fetch(AIRPORT_TERRAIN_URL);
    if(!airportResponse.ok||!(airportResponse.headers.get('content-type')||'').includes('json'))throw Error('Required airport DTM corrections unavailable');
    const airportCorrections=validateAirportTerrainCorrections(await airportResponse.json());
    meta.airportTerrainCorrections=applyAirportTerrainCorrections(hm,meta,airportCorrections);

    const southernResponse=await fetch(SOUTHERN_TERRAIN_URL);
    if(!southernResponse.ok||!(southernResponse.headers.get('content-type')||'').includes('json'))throw new Error('Required southern DTM extension unavailable');
    const southern=validateSouthernTerrain(await southernResponse.json());
    // Append forty old grid rows, keeping every old BNG grid node in place.
    const sourceBounds=[...meta.bounds_m],segments=TERRAIN_CONFIG.segments,segmentsY=segments+40;
    const rowSpacing=(sourceBounds[3]-sourceBounds[1])/segments;
    meta.sourceBounds_m=sourceBounds;
    meta.bounds_m=[sourceBounds[0],sourceBounds[3]-rowSpacing*segmentsY,sourceBounds[2],sourceBounds[3]];
    meta.renderGrid={columns:segments+1,rows:segmentsY+1,rowSpacingM:rowSpacing,columnSpacingM:(sourceBounds[2]-sourceBounds[0])/segments};
    meta.southernExtension={source:southern.source,sourceSha256:southern.sourceSha256,bounds_m:southern.bounds_m,overlapBlendNorthM:156000,overlapBlendSouthM:155000};

    // ── Geographic alignment ──────────────────────────────────────────
    // Convert BNG bounds from metadata to scene XZ coordinates.
    // Scene uses the same coordinate system as main.js llToXZ():
    //   x = (easting - BNG_REF_E)    [metres east from origin]
    //   z = -(northing - BNG_REF_N)  [metres south from origin]
    const [bngXmin, bngYmin, bngXmax, bngYmax] = meta.bounds_m;

    const swSceneX = bngXmin - BNG_REF_E;                 // west edge
    const swSceneZ = -(bngYmin - BNG_REF_N);              // south edge (positive Z)
    const neSceneX = bngXmax - BNG_REF_E;                 // east edge
    const neSceneZ = -(bngYmax - BNG_REF_N);              // north edge (negative Z)

    const terrainW = neSceneX - swSceneX;                  // east-west extent
    const terrainH = swSceneZ - neSceneZ;                  // north-south extent
    const centerX = (swSceneX + neSceneX) / 2;
    const centerZ = (swSceneZ + neSceneZ) / 2;

    const widthM = bngXmax - bngXmin;
    const heightM = bngYmax - bngYmin;

    console.log(`Terrain: BNG [${bngXmin},${bngYmin}]–[${bngXmax},${bngYmax}] → scene center (${centerX.toFixed(0)}, ${centerZ.toFixed(0)}), ${terrainW.toFixed(0)}×${terrainH.toFixed(0)}m`);

    // ── Geometry ──────────────────────────────────────────────────────
    const VE = TERRAIN_CONFIG.verticalExaggeration;

    const geom = new THREE.PlaneGeometry(terrainW, terrainH, segments, segmentsY);
    geom.rotateX(-Math.PI / 2);
    // After rotation: X spans [-terrainW/2, +terrainW/2], Z spans [-terrainH/2, +terrainH/2]
    // PlaneGeometry UV mapping after rotateX(-PI/2):
    //   UV (0,0) → (X=-w/2, Z=+h/2) → south-west in scene (positive Z = south)
    //   UV (1,1) → (X=+w/2, Z=-h/2) → north-east in scene
    //   UV v=0 → Z=+h/2 (south),  UV v=1 → Z=-h/2 (north)
    //
    // Heightmap image convention (top-left origin):
    //   pixel (0,0) = NW = (bngXmin, bngYmax)
    //   pixel (w-1,h-1) = SE = (bngXmax, bngYmin)
    //
    // Correct sampling: UV v → py = (1-v) * (h-1)
    //   v=0 (south) → py=h-1 (bottom of image = south) ✓
    //   v=1 (north) → py=0 (top of image = north) ✓

    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;

    // ── First pass: compute physical elevation at each vertex ─────────
    // Use metadata bounds when available (properly encoded heightmaps);
    // fall back to raw pixel range for legacy heightmaps without metadata.
    const elevMin = meta.elev_min_m ?? hm.minRaw;
    const elevMax = meta.elev_max_m ?? (hm.minRaw + hm.rawRange);
    const elevRange = elevMax - elevMin;

    const elevations = new Float32Array(pos.count);
    let elevSum = 0;
    for (let i = 0; i < pos.count; i++) {
      const col=i%(segments+1),row=Math.floor(i/(segments+1));
      const e=sourceBounds[0]+col/segments*(sourceBounds[2]-sourceBounds[0]);
      const n=sourceBounds[3]-row*rowSpacing;
      let elevM;
      if(row<=segments){
        const px=Math.round(col/segments*(hm.width-1)),py=Math.round(row/segments*(hm.height-1));
        elevM=hm.floats[py*hm.width+px]*elevRange+elevMin;
      }
      if(n<=156000){
        const sample=sampleTerrainCorrection(southern,e,n);
        if(!sample)throw new Error('Southern terrain vertex exceeds verified coverage');
        const weight=THREE.MathUtils.smoothstep(156000-n,0,1000);
        elevM=row>segments?sample.elevation:THREE.MathUtils.lerp(elevM,sample.elevation,weight);
      }
      if(!Number.isFinite(elevM))throw new Error('Missing physical terrain elevation');
      elevations[i] = elevM;
      elevSum += elevM;
    }
    const meanElev = elevSum / pos.count;

    // ── Pass 1.5: Carve river channel into elevation data ─────────────
    // Must happen BEFORE vertex displacement so contours, vertex colours,
    // and normals all incorporate the carved valley.
    if (thamesData?.points?.length) {
      const riverSegments = thamesData.points.map(pt => ({
        x: pt.e - BNG_REF_E,
        z: -(pt.n - BNG_REF_N),
        halfW: (pt.w || 100) / 2,
        d: Number.isFinite(pt.d) ? pt.d : 3,
      }));
      carveRiverChannel(
        elevations, segments + 1, segmentsY + 1,
        swSceneX, neSceneX, swSceneZ, neSceneZ,
        riverSegments
      );
    }

    // ── Second pass: displace vertices with vertical exaggeration ─────
    // Reference to sea level (0m AOD) so Y=0 = Ordnance Datum.
    // Central London (~10-15m) sits at Y=30-45, matching the camera start (Y=30).
    // Thames (~0m) at Y=0, hills rise above. Physically intuitive.
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, elevations[i] * VE);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // Store module-level state for helper functions (xzToTerrainUV, terrainHeightToWorldY, getTerrainMeshSurfaceY)
    terrainState = {
      swSceneX, swSceneZ, neSceneX, neSceneZ,
      terrainW, terrainH, centerX, centerZ,
      VE,
      elevMin: meta.elev_min_m ?? hm.minRaw,
      elevRange: (meta.elev_max_m ?? (hm.minRaw + hm.rawRange)) - (meta.elev_min_m ?? hm.minRaw),
      segments, segmentsY,   // independent grid dimensions, old spacing retained
    };

    // ── Vertex colours by elevation ───────────────────────────────────
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const yRange = maxY - minY || 1;
    // 5-stop elevation gradient: wider luminance range for visible topographic contrast
    const elevStops = [
      { t: 0.00, color: new THREE.Color(0x3d2e1f) }, // Deep umber (river valleys)
      { t: 0.25, color: new THREE.Color(0x5c4a3a) }, // Warm brown (low areas)
      { t: 0.50, color: new THREE.Color(0x7a6b55) }, // Dusty mid (London clay)
      { t: 0.75, color: new THREE.Color(0x96886e) }, // Sandy tan (exposed earth)
      { t: 1.00, color: new THREE.Color(0xa89e80) }, // Grey-green (hilltops)
    ];
    const colArr = new Float32Array(pos.count * 3);
    const tmpCol = new THREE.Color();
    const normals = geom.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / yRange;
      // Sample 5-stop gradient
      let stopIdx = 0;
      for (let s = 1; s < elevStops.length; s++) {
        if (t >= elevStops[s].t) stopIdx = s;
        else break;
      }
      const s0 = elevStops[stopIdx];
      const s1 = elevStops[Math.min(stopIdx + 1, elevStops.length - 1)];
      const localT = s0.t === s1.t ? 0 : (t - s0.t) / (s1.t - s0.t);
      tmpCol.copy(s0.color).lerp(s1.color, localT);
      // Slope-dependent darkening: steep normals (low Y) get darker
      const ny = Math.abs(normals.getY(i));
      const slopeDarken = 1.0 - (1.0 - ny) * 0.4;
      tmpCol.multiplyScalar(slopeDarken);
      colArr[i * 3] = tmpCol.r;
      colArr[i * 3 + 1] = tmpCol.g;
      colArr[i * 3 + 2] = tmpCol.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    console.log(`Terrain: ${pos.count} vertices, VE=${VE}×, Y range: ${minY.toFixed(1)}–${maxY.toFixed(1)}, mean elev: ${meanElev.toFixed(1)}m`);

    // ── Generate procedural textures ──────────────────────────────────
    const grainTex = generateTerrainGrainTexture();
    const roughnessTex = generateTerrainRoughnessTexture();
    const terrainNormalTex = generateTerrainNormalMap(Float32Array.from(elevations,y=>(y-elevMin)/elevRange), segments+1, segmentsY+1);
    const undersideGrainTex = generateUndersideGrainTexture();
    const undersideNormalTex = generateUndersideNormalMap(undersideGrainTex);

    // ── Topside material (warm earth, viewed from above) ────────────
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: grainTex,
      normalMap: terrainNormalTex,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: roughnessTex,
      roughness: 0.85,
      metalness: 0.05,
      transparent: false,
      opacity: opacity,
      depthWrite: true,
      wireframe: !!wireframe,
      side: THREE.FrontSide,
    });

    // ── Underside geometry + vertex colours (rock face, viewed from below) ─
    // Deepened (~24% darker) so the overhead mass reads as damp soil/rock and
    // sits clearly ABOVE the bright chalk floor in the clay-zone sandwich —
    // dark earth ceiling, glowing white floor. (Geology-vision D4.2.)
    const undersideGeom = geom.clone();
    const undersideLowCol = new THREE.Color(0x5c4834);
    const undersideMidCol = new THREE.Color(0x6b5842);
    const undersideHighCol = new THREE.Color(0x796651);
    const usColArr = new Float32Array(pos.count * 3);
    const usTmpCol = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / yRange;
      if (t < 0.5) {
        usTmpCol.copy(undersideLowCol).lerp(undersideMidCol, t * 2);
      } else {
        usTmpCol.copy(undersideMidCol).lerp(undersideHighCol, (t - 0.5) * 2);
      }
      usColArr[i * 3] = usTmpCol.r;
      usColArr[i * 3 + 1] = usTmpCol.g;
      usColArr[i * 3 + 2] = usTmpCol.b;
    }
    undersideGeom.setAttribute('color', new THREE.BufferAttribute(usColArr, 3));

    // ── Underside material (rock face with normal map for relief) ────
    // emissive keeps exposed earth visible where nothing overdraws it.
    // Underground ambient (0.25) x the dark vertex colours lands near zero
    // through AgX, so buildingless regions (parks, beyond tile radius) read
    // as void-black rectangles from below — Hyde Park was a "black box".
    // Same pattern as the chalk floor's emissive lift; BackSide means this
    // is invisible from above ground.
    const undersideMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      emissive: 0x6b5842,
      emissiveIntensity: 0.2,
      map: undersideGrainTex,
      normalMap: undersideNormalTex,
      normalScale: new THREE.Vector2(1.5, 1.5), // stronger grain — soil texture at grazing angle
      roughness: 0.95,
      metalness: 0.0,
      transparent: false,
      opacity: opacity,
      depthWrite: false,
      wireframe: !!wireframe,
      side: THREE.BackSide,
    });

    // ── Two meshes sharing position, topside renders first ──────────
    const mesh = new THREE.Mesh(geom, topMat);
    mesh.position.set(centerX, 0, centerZ);
    mesh.name = 'terrainMesh';
    mesh.renderOrder = RENDER_ORDER.TERRAIN;

    const undersideMesh = new THREE.Mesh(undersideGeom, undersideMat);
    undersideMesh.position.set(centerX, 0, centerZ);
    undersideMesh.name = 'terrainUnderside';
    undersideMesh.renderOrder = RENDER_ORDER.TERRAIN;

    terrainState.mesh = mesh; // for vertex sampling in getTerrainMeshSurfaceY
    terrainState.undersideMesh = undersideMesh;
    console.log('Terrain mesh created:', {
      position: `(${centerX.toFixed(0)}, 0, ${centerZ.toFixed(0)})`,
      extent: `${terrainW.toFixed(0)}×${terrainH.toFixed(0)}m`,
      vertexCount: pos.count,
      verticalExaggeration: VE,
    });

    // ── Height sampler ────────────────────────────────────────────────
    // Returns normalised height (0..1) from the decoded float data.
    // Used by shaft snapping and altimeter.
    let heightSampler = null;
    try {
      heightSampler = (u, v) => {
        if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)return null;
        const y=getTerrainMeshSurfaceY({x:swSceneX+u*terrainW,z:neSceneZ+v*terrainH});
        return Number.isFinite(y)?(y/VE-elevMin)/elevRange:null;
      };
    } catch {
      // ignore
    }

    // ── Contour lines ─────────────────────────────────────────────────
    const contourLines = generateContourLines(geom);
    if (contourLines) contourLines.position.set(centerX, 0, centerZ);

    return { mesh, undersideMesh, topMat, undersideMat, meta, widthM, heightM, heightSampler, contourLines };
  } catch (err) {
    console.error('Terrain mesh creation failed:', err);
    return null;
  }
}

/**
 * Convert a normalised height (0..1) to world Y coordinate,
 * matching the displacement applied in tryCreateTerrainMesh.
 */
export function terrainHeightToWorldY({ h01 } = {}) {
  if (!terrainState) {
    // Fallback to legacy calculation if terrain hasn't loaded yet
    const h = Number.isFinite(h01) ? h01 : 0;
    return TERRAIN_CONFIG.baseY + (h * TERRAIN_CONFIG.displacementScale + TERRAIN_CONFIG.displacementBias);
  }
  const { VE, elevMin, elevRange } = terrainState;
  const h = Number.isFinite(h01) ? h01 : 0;
  const elevM = h * elevRange + elevMin;
  // Sea-level reference: Y = elevation_metres × vertical_exaggeration
  return elevM * VE;
}

/**
 * Convert world (x, z) to terrain UV coordinates [0..1].
 * Uses the actual terrain bounds computed from BNG metadata.
 */
export function xzToTerrainUV({ x, z } = {}) {
  if (!terrainState) {
    // Fallback to legacy centred-at-origin calculation
    const size = TERRAIN_CONFIG.size;
    const u = (x + size / 2) / size;
    const v = (z + size / 2) / size;
    return { u, v };
  }
  const { swSceneX, neSceneZ, terrainW, terrainH } = terrainState;
  // u: 0 at west edge (swSceneX), 1 at east edge (neSceneX)
  const u = (x - swSceneX) / terrainW;
  // v: 0 at north edge (neSceneZ, negative), 1 at south edge (swSceneZ, positive)
  const v = (z - neSceneZ) / terrainH;
  return {
    u, v,
  };
}

/**
 * Convenience: world (x, z) → terrain surface Y in one call.
 * Composes xzToTerrainUV + heightSampler + terrainHeightToWorldY.
 */
export function getTerrainSurfaceY({ x, z, heightSampler }) {
  // Consumers need the displayed triangle surface, including river carving and
  // the DTM correction, rather than a different higher-resolution raster skin.
  if (terrainState?.mesh) return getTerrainMeshSurfaceY({ x, z });
  if (!heightSampler || !terrainState) return null;
  const { u, v } = xzToTerrainUV({ x, z });
  const h01 = heightSampler(u, v);
  return terrainHeightToWorldY({ h01 });
}

/**
 * Sample the actual terrain mesh vertex Y at a world (x, z) position.
 * Uses barycentric interpolation on the actual PlaneGeometry triangle,
 * so the returned Y matches exactly what the GPU renders — no heightmap/mesh
 * resolution mismatch.
 *
 * Returns world Y (number) or null if (x, z) is outside the mesh bounds.
 * O(1), no allocation — safe for per-frame use.
 */
export function getTerrainMeshSurfaceY({ x, z } = {}) {
  if (!terrainState?.mesh) return null;
  const { mesh, segments, segmentsY, centerX, centerZ, terrainW, terrainH } = terrainState;
  const pos = mesh.geometry.attributes.position;

  // World → mesh-local coordinates
  const localX = x - centerX;
  const localZ = z - centerZ;

  // Map to continuous grid coordinates [0, segments]
  const gridCol = (localX + terrainW / 2) / terrainW * segments;
  const gridRow = (localZ + terrainH / 2) / terrainH * segmentsY;

  // Bounds check (allow a tiny epsilon for floating-point edge cases)
  if (gridCol < -0.001 || gridCol > segments + 0.001 ||
      gridRow < -0.001 || gridRow > segmentsY + 0.001) {
    return null;
  }

  // Integer cell indices (clamp to valid range)
  const col0 = Math.min(Math.max(0, Math.floor(gridCol)), segments - 1);
  const row0 = Math.min(Math.max(0, Math.floor(gridRow)), segmentsY - 1);
  const col1 = col0 + 1;
  const row1 = row0 + 1;

  // Fractional position within the cell [0, 1]
  const u = gridCol - col0;
  const v = gridRow - row0;

  // Row-major vertex indices: index = row * (segments + 1) + col
  const stride = segments + 1;
  const i00 = row0 * stride + col0;
  const i10 = row0 * stride + col1;
  const i01 = row1 * stride + col0;
  const i11 = row1 * stride + col1;

  // PlaneGeometry uses triangles (00,01,10) and (01,11,10), sharing the
  // u+v=1 diagonal. Bilinear interpolation describes a different curved surface
  // and can leave building bases/rails floating over steep DSM cells.
  const y00 = pos.getY(i00);
  const y10 = pos.getY(i10);
  const y01 = pos.getY(i01);
  const y11 = pos.getY(i11);

  return u + v <= 1
    ? y00 + (y10 - y00) * u + (y01 - y00) * v
    : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
}
