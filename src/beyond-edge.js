// The corridor round the lines that run beyond the M25 (sprint 02Oct26f, lane T,
// D-048 item 7).
//
// Jordan, 02Oct26f: beyond the ring the lines "are just a tunnel or track in
// empty space", and a bore out there must look and sound underground. Today's
// underground regimes (audio, station labels, the environment's insideness) key
// on M25 insideness, which is 0 out there, so a camera in a bore beyond the
// edge is treated as daylight surface. But the map's cliff, clay skirt, chalk
// column and waterfalls are seen from OUTSIDE the ring, from cameras below the
// surrounding terrain (tests/geology-exterior.spec.js): making every point
// below ground outside the ring "underground" would turn those exterior views
// into underground fog. So the underground regime is scoped to a CORRIDOR: the
// plan distance to a beyond-ring centreline, weight 1 within 150 m and 0 beyond
// 200 m (smoothstep), and 0 unless the point is beyond the barrier ring.
//
// COST (O(1) per frame): built once from the centrelines densified to 10 m, as
// a sparse set of 1 km tiles of 40 x 40 bytes, each byte the distance in metres
// (capped 255) at a 25 m cell. A query is one tile lookup and one byte, and, only
// where the byte is inside the corridor, one isOffMapEdge raster read. No
// allocation. Pure and deterministic (no randomness, no clocks).

export const CORRIDOR_FULL_M = 150;
export const CORRIDOR_ZERO_M = 200;
export const CORRIDOR_CELL_M = 25;
export const CORRIDOR_TILE_M = 1000;
const CELLS = CORRIDOR_TILE_M / CORRIDOR_CELL_M; // 40
const CAP = 255;

const smooth01 = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Weight from a distance in metres: 1 within FULL, 0 from ZERO, smoothstep between. */
export function corridorWeightFromDistance(d) {
  return smooth01((CORRIDOR_ZERO_M - d) / (CORRIDOR_ZERO_M - CORRIDOR_FULL_M));
}

/**
 * The runs of consecutive points of a polyline that lie beyond the ring.
 * `pts` are {x, z} (any extra fields ignored); a run of one point is kept as
 * a point (it is still a place the line is).
 */
export function beyondRuns(pts, isOff) {
  const runs = [];
  let cur = null;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) { cur = null; continue; }
    if (isOff({ x: p.x, z: p.z })) { if (!cur) { cur = []; runs.push(cur); } cur.push({ x: p.x, z: p.z }); }
    else cur = null;
  }
  return runs;
}

/** A polyline densified so that no two consecutive points are further than stepM apart. */
export function densify(pts, stepM = 10) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i + 1 >= pts.length) break;
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(len / stepM);
    for (let k = 1; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

export function createBeyondEdgeCorridor({ isOffMapEdge }) {
  let tiles = null, nx = 0, nz = 0, ox = 0, oz = 0, ready = false;
  const stats = { points: 0, tiles: 0, buildMs: 0 };
  const off = (x, z) => { try { return !!isOffMapEdge({ x, z }); } catch { return false; } };

  /**
   * Build from polylines of {x, z} (the beyond-ring samples are taken here, so a
   * caller may pass whole paths). Replaces any earlier build.
   */
  function build(polylines) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const dense = [];
    // Densified first: a sparse polyline (the bores run station to station) crosses the ring between two points.
    for (const pl of polylines) {
      const pts = pl.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z));
      for (const run of beyondRuns(densify(pts, 10), p => off(p.x, p.z))) dense.push(...run);
    }
    stats.points = dense.length;
    if (!dense.length) { tiles = null; ready = true; return; }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of dense) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; }
    const pad = CORRIDOR_ZERO_M + CORRIDOR_CELL_M;
    ox = Math.floor((minX - pad) / CORRIDOR_TILE_M) * CORRIDOR_TILE_M;
    oz = Math.floor((minZ - pad) / CORRIDOR_TILE_M) * CORRIDOR_TILE_M;
    nx = Math.floor((maxX + pad - ox) / CORRIDOR_TILE_M) + 1;
    nz = Math.floor((maxZ + pad - oz) / CORRIDOR_TILE_M) + 1;
    tiles = new Array(nx * nz).fill(null);
    stats.tiles = 0;
    const reach = Math.ceil((CORRIDOR_ZERO_M + CORRIDOR_CELL_M) / CORRIDOR_CELL_M);
    for (const p of dense) {
      const cx = Math.floor((p.x - ox) / CORRIDOR_CELL_M), cz = Math.floor((p.z - oz) / CORRIDOR_CELL_M);
      for (let j = cz - reach; j <= cz + reach; j++) for (let i = cx - reach; i <= cx + reach; i++) {
        if (i < 0 || j < 0) continue;
        const tx = Math.floor(i / CELLS), tz = Math.floor(j / CELLS);
        if (tx >= nx || tz >= nz) continue;
        const dx = ox + (i + 0.5) * CORRIDOR_CELL_M - p.x, dz = oz + (j + 0.5) * CORRIDOR_CELL_M - p.z;
        const d = Math.round(Math.hypot(dx, dz));
        if (d > CORRIDOR_ZERO_M + CORRIDOR_CELL_M) continue;
        let tile = tiles[tz * nx + tx];
        if (!tile) { tile = tiles[tz * nx + tx] = new Uint8Array(CELLS * CELLS).fill(CAP); stats.tiles++; }
        const k = (j - tz * CELLS) * CELLS + (i - tx * CELLS);
        if (d < tile[k]) tile[k] = d;
      }
    }
    ready = true;
    stats.buildMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  /** Plan distance to the nearest beyond-ring centreline in metres, 255 where none is within reach. */
  function distanceAt(x, z) {
    if (!tiles) return CAP;
    const fx = (x - ox) / CORRIDOR_CELL_M, fz = (z - oz) / CORRIDOR_CELL_M;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0) return CAP;
    const tx = (i / CELLS) | 0, tz = (j / CELLS) | 0;
    if (tx >= nx || tz >= nz) return CAP;
    const tile = tiles[tz * nx + tx];
    if (!tile) return CAP;
    return tile[(j - tz * CELLS) * CELLS + (i - tx * CELLS)];
  }

  /** The corridor weight at (x, z): 0 unless beyond the ring and within 200 m of a beyond-ring centreline. */
  function weightAt(x, z) {
    const d = distanceAt(x, z);
    if (d >= CORRIDOR_ZERO_M) return 0;
    if (!off(x, z)) return 0;
    return d <= CORRIDOR_FULL_M ? 1 : corridorWeightFromDistance(d);
  }

  return { build, weightAt, distanceAt, get ready() { return ready; }, get stats() { return stats; } };
}

/**
 * The per-frame regime from the corridor (main.js s02:T). `weight` is
 * corridor.weightAt at the camera. The corridor applies only to a camera below
 * the ground and out of the water; everything else keeps today's rules.
 *   corridor           the weight at the camera's plan position (0 to 1, whatever its height);
 *   underWeight        the weight when the camera is below the ground and not submerged, else 0;
 *   under              underWeight >= 0.5: the camera is underground in the corridor;
 *   audioUnderground   exactly what the audio is told: (inside the M25 or under) and below ground;
 *   labelsUnderground  the station labels' underground mode: (inside the M25 or under) and below ground;
 *   regimeInsideness   what the environment and the light read: the larger of the real insideness and underWeight.
 */
export function regimeFrom({ weight, belowSurface, submerged, insideness, cameraInsideM25 }) {
  const underWeight = belowSurface && !submerged ? weight : 0;
  const under = underWeight >= 0.5;
  const audioUnderground = !!((cameraInsideM25 || under) && belowSurface);
  return {
    corridor: weight,
    underWeight,
    under,
    audioUnderground,
    labelsUnderground: audioUnderground,
    regimeInsideness: Math.max(insideness, underWeight),
  };
}

/** Plan-view polylines of every beyond-ring line source (for build()): Tube surface-rail paths, Overground linePaths and bores. */
export function corridorSources({ surfaceRailPaths, overgroundLinePaths, boreBranches }) {
  const out = [];
  const addMapOfLists = (m) => { if (!m) return; for (const lists of m.values()) for (const p of lists || []) if (p && p.length) out.push(p); };
  addMapOfLists(surfaceRailPaths);
  addMapOfLists(overgroundLinePaths);
  addMapOfLists(boreBranches);
  return out;
}
