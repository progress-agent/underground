// thames-mask.js — River corridor exclusion for surface buildings
//
// Uses Thames waypoint data (BNG centreline with per-point width) to define
// a river corridor buffer. Buildings whose centroids fall within 90% of
// the local river half-width are excluded from rendering.
//
// Performance: 114 segments × ~2000 buildings/tile ≈ 228k distance checks
// per tile load. Each check is 2 dot products + 1 sqrt — <1ms per tile.

// BNG reference — must match terrain.js, thames.js, m25.js
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Width safety margin: use 90% of actual river width to avoid clipping
// riverside buildings that sit right on the bank
const WIDTH_FACTOR = 0.9;

// Cached segment data after init
let segments = null;

/**
 * Initialise the Thames mask from thames.json waypoint data.
 *
 * @param {Array} points  Array of { e, n, w, d } — BNG easting, northing,
 *                        width (metres), depth (metres)
 */
export function initThamesMask(points) {
  if (!points || points.length < 2) {
    console.warn('Thames mask: insufficient points, disabled');
    return;
  }

  segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    // Convert BNG to scene coords
    const ax = a.e - BNG_REF_E;
    const az = -(a.n - BNG_REF_N);
    const bx = b.e - BNG_REF_E;
    const bz = -(b.n - BNG_REF_N);

    // Half-width at each endpoint, averaged for this segment, with safety margin
    const halfW = ((a.w + b.w) / 2 / 2) * WIDTH_FACTOR;

    // Pre-compute segment vector and squared length for distance test
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;

    segments.push({ ax, az, bx, bz, dx, dz, lenSq, halfW });
  }

  console.log(`Thames mask: ${segments.length} segments initialised`);
}

/**
 * Test whether a point (scene coords) falls within the Thames river corridor.
 *
 * @param {number} x  Scene X coordinate
 * @param {number} z  Scene Z coordinate
 * @returns {boolean}  true if point is inside the river corridor
 */
export function isInThames(x, z) {
  if (!segments) return false;

  for (const seg of segments) {
    // Distance from point to line segment
    let t;
    if (seg.lenSq < 1e-8) {
      t = 0; // degenerate segment
    } else {
      t = ((x - seg.ax) * seg.dx + (z - seg.az) * seg.dz) / seg.lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }

    const projX = seg.ax + t * seg.dx;
    const projZ = seg.az + t * seg.dz;
    const ex = x - projX;
    const ez = z - projZ;
    const distSq = ex * ex + ez * ez;

    if (distSq <= seg.halfW * seg.halfW) {
      return true;
    }
  }

  return false;
}
