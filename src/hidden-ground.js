// The hidden ground beyond the map edge (sprint 02Oct26f, lane T, D-048 item 7).
//
// Beyond the M25 the terrain is never drawn (the mask discards it), but it is
// still there: the grid covers every terminus, and the walker, the "Up to the
// street" step and the track beyond the ring all stand on it. The heightmap is
// the Copernicus 30 m SURFACE model, so it carries tree canopy and roofs: over
// Epping Forest and the Chilterns it is lumpy (up to 37 m of canopy within
// 1.5 km of a station, grades of 32 to 36 % at Chalfont & Latimer, Amersham and
// Chesham). Nobody sees that surface, so it is smoothed for what stands on it.
//
// WHAT: a per-vertex correction on the terrain's own vertex grid.
//   H  the raw vertex height (getStructuralSurfaceY at the vertex);
//   E  a 5 x 5 erode of H (minimum), O a 5 x 5 dilate of E (maximum): a
//      grey-scale OPENING, which removes lumps narrower than about 680 x 490 m
//      (a copse, a roof) and keeps the broad relief (a ridge, a valley);
//   S  the 3 x 3 mean of O, to take the opening's own corners off;
//   w  the weight, from the Chebyshev ring index k of the nearest vertex on the
//      map (isOffMapEdge false), searched to 3: k <= 1 gives 0, k = 2 gives
//      0.5, k >= 3 gives 1, so the correction fades to nothing over one cell
//      at the cliff lip;
//   d  = w (S - H), the correction at the vertex.
// A query ON the map returns the raw sampler's own result, untouched (so the
// hidden ground is bit-identical to the terrain wherever the terrain is
// drawn); beyond the map it returns the raw sampler plus d interpolated with
// the same triangles as terrain.js getStructuralSurfaceY.
//
// LAZY and PURE: E, O and d are memoised per vertex in Float32Arrays with a NaN
// sentinel, computed on first read, so nothing is paid at boot and a value
// never depends on the order of the queries. Nothing here draws anything and
// nothing uses randomness.

/** The walk's soft hold sits this far inside the grid's bounds (metres). */
export const WALK_INSET_M = 200;
/** Opening radius (vertices): 2 gives the 5 x 5 window. */
const R_OPEN = 2;
/** Chebyshev rings searched for the nearest on-map vertex. */
const RING_MAX = 3;

export function createHiddenGround({ getTerrainMeshSurfaceY, getStructuralSurfaceY, getTerrainBounds, isOffMapEdge, walkInsetM = WALK_INSET_M }) {
  let grid = null;       // lazily built from getTerrainBounds(); null until the terrain exists
  const stats = { vertices: 0, deltaQueries: 0, beyondQueries: 0 };

  function ensure() {
    if (grid) return grid;
    const b = getTerrainBounds?.();
    if (!b || !(b.columns > 2) || !(b.rows > 2)) return null;
    const cols = b.columns, rows = b.rows, n = cols * rows;
    grid = {
      minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, cols, rows,
      cellW: (b.maxX - b.minX) / (cols - 1), cellH: (b.maxZ - b.minZ) / (rows - 1),
      H: new Float32Array(n).fill(NaN), E: new Float32Array(n).fill(NaN), O: new Float32Array(n).fill(NaN), D: new Float32Array(n).fill(NaN),
      off: new Uint8Array(n),   // 0 unknown, 1 on the map, 2 beyond it
      ring: new Uint8Array(n),  // 0 unknown, else k + 1
    };
    return grid;
  }

  const clampI = (v, hi) => v < 0 ? 0 : v > hi ? hi : v;

  /** Raw vertex height (a NaN where the sampler has none). */
  function vertexH(g, i, j) {
    const k = j * g.cols + i;
    let h = g.H[k];
    if (h !== h) {
      const y = getStructuralSurfaceY({ x: g.minX + i * g.cellW, z: g.minZ + j * g.cellH });
      g.H[k] = Number.isFinite(y) ? y : 0; stats.vertices++;
      h = g.H[k]; // the stored (Float32) value, always: a first read must equal every later one
    }
    return h;
  }
  function vertexOff(g, i, j) {
    const k = j * g.cols + i;
    let o = g.off[k];
    if (!o) { o = isOffMapEdge({ x: g.minX + i * g.cellW, z: g.minZ + j * g.cellH }) ? 2 : 1; g.off[k] = o; }
    return o === 2;
  }
  /** E: the minimum of H over the 5 x 5 window (indices clamped at the grid's edge). */
  function vertexE(g, i, j) {
    const k = j * g.cols + i;
    let e = g.E[k];
    if (e !== e) {
      e = Infinity;
      for (let dj = -R_OPEN; dj <= R_OPEN; dj++) for (let di = -R_OPEN; di <= R_OPEN; di++) {
        const h = vertexH(g, clampI(i + di, g.cols - 1), clampI(j + dj, g.rows - 1));
        if (h < e) e = h;
      }
      g.E[k] = e; e = g.E[k];
    }
    return e;
  }
  /** O: the maximum of E over the 5 x 5 window. */
  function vertexO(g, i, j) {
    const k = j * g.cols + i;
    let o = g.O[k];
    if (o !== o) {
      o = -Infinity;
      for (let dj = -R_OPEN; dj <= R_OPEN; dj++) for (let di = -R_OPEN; di <= R_OPEN; di++) {
        const e = vertexE(g, clampI(i + di, g.cols - 1), clampI(j + dj, g.rows - 1));
        if (e > o) o = e;
      }
      g.O[k] = o; o = g.O[k];
    }
    return o;
  }
  /** The weight from the ring index of the nearest on-map vertex. */
  function vertexW(g, i, j) {
    const k = j * g.cols + i;
    let r = g.ring[k];
    if (!r) {
      let ring = RING_MAX;
      if (!vertexOff(g, i, j)) ring = 0;
      else search: for (let d = 1; d < RING_MAX; d++) {
        for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= g.cols || jj >= g.rows) continue;
          if (!vertexOff(g, ii, jj)) { ring = d; break search; }
        }
      }
      r = ring + 1; g.ring[k] = r;
    }
    const ring = r - 1;
    return ring <= 1 ? 0 : ring === 2 ? 0.5 : 1;
  }
  /** d at a vertex: w (S - H), S the 3 x 3 mean of O. */
  function vertexD(g, i, j) {
    const k = j * g.cols + i;
    let d = g.D[k];
    if (d !== d) {
      const w = vertexW(g, i, j);
      if (w === 0) d = 0;
      else {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += vertexO(g, clampI(i + di, g.cols - 1), clampI(j + dj, g.rows - 1));
        d = w * (s / 9 - vertexH(g, i, j));
      }
      g.D[k] = d; d = g.D[k];
    }
    return d;
  }

  /** d interpolated at (x, z) with terrain.js's triangles (00,01,10) and (01,11,10). */
  function deltaAt(x, z) {
    const g = ensure();
    if (!g) return 0;
    stats.deltaQueries++;
    const gc = (x - g.minX) / (g.maxX - g.minX) * (g.cols - 1), gr = (z - g.minZ) / (g.maxZ - g.minZ) * (g.rows - 1);
    if (gc < -0.001 || gc > g.cols - 1 + 0.001 || gr < -0.001 || gr > g.rows - 1 + 0.001) return 0;
    const c0 = Math.min(Math.max(0, Math.floor(gc)), g.cols - 2), r0 = Math.min(Math.max(0, Math.floor(gr)), g.rows - 2);
    const u = gc - c0, v = gr - r0;
    const d00 = vertexD(g, c0, r0), d10 = vertexD(g, c0 + 1, r0), d01 = vertexD(g, c0, r0 + 1), d11 = vertexD(g, c0 + 1, r0 + 1);
    return u + v <= 1
      ? d00 + (d10 - d00) * u + (d01 - d00) * v
      : d11 + (d01 - d11) * (1 - u) + (d10 - d11) * (1 - v);
  }

  const beyond = (x, z) => { try { return !!isOffMapEdge({ x, z }); } catch { return false; } };

  /** The rendered-surface sampler (river bed included on the map) with the correction beyond the edge. */
  function terrainY(x, z) {
    const raw = getTerrainMeshSurfaceY({ x, z });
    if (!Number.isFinite(raw) || !beyond(x, z)) return raw;
    stats.beyondQueries++;
    return raw + deltaAt(x, z);
  }
  /** The structural (pre-refinement) sampler with the correction beyond the edge. */
  function structuralY(x, z) {
    const raw = getStructuralSurfaceY({ x, z });
    if (!Number.isFinite(raw) || !beyond(x, z)) return raw;
    stats.beyondQueries++;
    return raw + deltaAt(x, z);
  }

  /** The walk's bounds: the terrain grid inset by walkInsetM (one cached object), or null before the terrain exists. */
  let hold = null;
  function holdBox() {
    if (hold) return hold;
    const g = ensure();
    if (!g) return null;
    hold = { minX: g.minX + walkInsetM, maxX: g.maxX - walkInsetM, minZ: g.minZ + walkInsetM, maxZ: g.maxZ - walkInsetM };
    return hold;
  }
  function insideWalkBounds(x, z) {
    const b = holdBox();
    if (!b) return true;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  return {
    terrainY, structuralY,
    terrainSurfaceY: ({ x, z } = {}) => terrainY(x, z),
    structuralSurfaceY: ({ x, z } = {}) => structuralY(x, z),
    deltaAt, insideWalkBounds,
    get holdBox() { return holdBox(); },
    get stats() { return stats; },
  };
}
