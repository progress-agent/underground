// thames-zones.js — Named reach zones for Thames hover tooltips.
//
// 10 zones spanning the Thames centreline (Wave 1 plan locked), addressed by
// CHAINAGE (metres along the centreline polyline) rather than waypoint index,
// so the zone table survives centreline re-densification (10Jul26f: thames.json
// went 126 → 393 points when the course was rebuilt from the OSM centreline).
// Tooltip width/depth values quote MHWS (Mean High Water Springs) — the tide
// convention chosen for visual intuition (matches the "fat" Thames a viewer
// sees from a London bridge in daylight).
//
// IMPORTANT: This file does NOT modify river geometry. The flat water surface
// in thames.js stays at WATER_LEVEL_M=2 (~ mean tide level). The values below
// are quoted *at MHWS* in the tooltip text only — geometry is untouched.
//
// Data provenance:
//   - mean/max width derived from the per-waypoint w values in
//     public/data/thames.json (already curated against PLA charts).
//   - mean/max depth derived from per-waypoint d values in thames.json,
//     interpreted as charted depth at the tideway midline (representative
//     of MHWS-corrected mean fairway depth: charted depth + ~7m tide range
//     at central London gives total water column at MHWS, but the published
//     "depth" figure for a reach is conventionally the MHWS mean fairway
//     depth — which is what thames.json values approximate).
//   - Cross-checks (Apr 2026):
//       PLA Port Information Guide (pla.co.uk, 2024 ed.) — confirms Pool of
//         London ~150-200m wide at MHWS, Greenwich Reach ~250m, Woolwich
//         Reach ~270m, Gallions ~340m.
//       Wikipedia "River Thames" + "Tideway" — Teddington 100m at the weir,
//         estuary 800m+ at Dartford crossing.
//       EA Thames Bathymetric Data Analysis (rbwm.moderngov.co.uk) —
//         depth profile monotonically increasing W->E from ~2m at Teddington
//         to ~16m at Sea Reach.
//
// All values rounded to natural reading precision (no fake-precision decimals).
// "max" depth values reflect deepest single waypoint in the zone range,
// rounded UP to nearest metre.

// ---------- Zone Table ----------
//
// Schema:
//   id          string  - kebab-case identifier (stable, used as React key etc.)
//   name        string  - human-readable reach name (rendered in tooltip)
//   chainStartM number  - zone start, metres of chainage along the centreline (inclusive)
//   chainEndM   number  - zone end, metres of chainage (exclusive; Infinity on the last zone)
//   meanWidth   number  - representative width in metres (at MHWS)
//   meanDepth   number  - representative mean fairway depth in metres (at MHWS)
//   maxDepth    number  - deepest fairway sounding in metres (at MHWS)
//   landmark    string  - anchor landmark for the zone
//
// Boundary provenance (10Jul26f): the original zone boundaries were defined as
// v1 waypoint index ranges; each boundary point was projected onto the rebuilt
// OSM-derived centreline and its chainage taken (all projections landed within
// ~400m of the new course, monotonic). Zone width/depth/landmark stats are
// per-reach real-world facts and carry over unchanged.
//
// Coverage: chainage 0 → Infinity with no gaps (verified by getZoneAt fallthrough).
//
// Endpoint alignment (10Jul26f, second pass): the course was re-clipped to the
// M25 boundary crossings (west end extended ~2.5km to the ring, east end
// trimmed ~2.7km back to it, both inset 25m so the waterfall ray-cast hits
// cleanly). The west extension moved the chainage origin, so every finite
// boundary below carries a constant +2467m shift (old v2 origin projected
// onto the re-clipped course by build-thames-v2.mjs).

export const THAMES_ZONES = [
  {
    id: 'upper-tideway',
    name: 'Upper Tideway',
    chainStartM: 0,
    chainEndM: 39191,
    meanWidth: 45,
    meanDepth: 2.5,
    maxDepth: 3,
    landmark: 'Teddington Lock',
  },
  {
    id: 'putney-hammersmith',
    name: 'Putney & Hammersmith Reach',
    chainStartM: 39191,
    chainEndM: 44701,
    meanWidth: 60,
    meanDepth: 4,
    maxDepth: 4,
    landmark: 'Hammersmith Bridge',
  },
  {
    id: 'battersea-reach',
    name: 'Battersea Reach',
    chainStartM: 44701,
    chainEndM: 48888,
    meanWidth: 62,
    meanDepth: 4.5,
    maxDepth: 5,
    landmark: 'Battersea Bridge',
  },
  {
    id: 'westminster-reach',
    name: 'Westminster Reach',
    chainStartM: 48888,
    chainEndM: 53105,
    meanWidth: 82,
    meanDepth: 5.5,
    maxDepth: 6,
    landmark: 'Westminster Bridge',
  },
  {
    id: 'pool-of-london',
    name: 'Pool of London',
    chainStartM: 53105,
    chainEndM: 57038,
    meanWidth: 140,
    meanDepth: 7.5,
    maxDepth: 9,
    landmark: 'Tower Bridge',
  },
  {
    id: 'limehouse-reach',
    name: 'Limehouse Reach',
    chainStartM: 57038,
    chainEndM: 60882,
    meanWidth: 210,
    meanDepth: 10,
    maxDepth: 10,
    landmark: 'Canary Wharf approach',
  },
  {
    id: 'greenwich-reach',
    name: 'Greenwich Reach',
    chainStartM: 60882,
    chainEndM: 66223,
    meanWidth: 255,
    meanDepth: 11.5,
    maxDepth: 13,
    landmark: 'Greenwich Royal Observatory',
  },
  {
    id: 'blackwall-woolwich',
    name: 'Blackwall & Woolwich Reach',
    chainStartM: 66223,
    chainEndM: 71778,
    meanWidth: 285,
    meanDepth: 13.5,
    maxDepth: 14,
    landmark: 'Thames Barrier',
  },
  {
    id: 'gallions-erith',
    name: 'Gallions & Erith Reach',
    chainStartM: 71778,
    chainEndM: 79644,
    meanWidth: 340,
    meanDepth: 15,
    maxDepth: 16,
    landmark: 'Crossness Pumping Station',
  },
  {
    id: 'thames-estuary-mouth',
    name: 'Thames Estuary Mouth',
    chainStartM: 79644,
    chainEndM: Infinity,
    meanWidth: 580,
    meanDepth: 16,
    maxDepth: 16,
    landmark: 'QE2 Bridge (Dartford Crossing)',
  },
];

// ---------- Lookups ----------

/**
 * Map a centreline chainage (metres) to its zone.
 * O(N) over 10 zones — trivially fast, no binary search needed.
 *
 * @param {number} chainM  Metres along the Thames centreline (from nearestThamesSegment)
 * @returns {object|null}  Matching zone, or null if input invalid
 */
export function getZoneAt(chainM) {
  if (typeof chainM !== 'number' || !Number.isFinite(chainM)) return null;
  for (const zone of THAMES_ZONES) {
    if (chainM >= zone.chainStartM && chainM < zone.chainEndM) {
      return zone;
    }
  }
  return null;
}

// ---------- Nearest-segment helper ----------
//
// Refactored from thames-mask.js's isInThames() inner loop. Pre-computed
// at module load for O(N) per-call cost over the centreline segments
// (~50us at 400 segments — fine for hover-rate calls).
//
// BNG reference must match terrain.js / thames.js / thames-mask.js / m25.js.

const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Lazily populated by initThamesZones() (called from main.js once thames.json
// has been fetched). Until then, nearestThamesSegment() returns null.
let _segments = null;

/**
 * Initialise the zones module with thames.json point data.
 * Mirrors thames-mask.js initThamesMask() — same input, same indexing.
 *
 * @param {Array} points  Array of { e, n, w, d } from thames.json
 */
export function initThamesZones(points) {
  if (!points || points.length < 2) {
    console.warn('Thames zones: insufficient points, disabled');
    return;
  }
  const segs = [];
  let chainM = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ax = a.e - BNG_REF_E;
    const az = -(a.n - BNG_REF_N);
    const bx = b.e - BNG_REF_E;
    const bz = -(b.n - BNG_REF_N);
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    const len = Math.sqrt(lenSq);
    segs.push({ ax, az, dx, dz, lenSq, len, startChainM: chainM });
    chainM += len;
  }
  _segments = segs;
  console.log(`Thames zones: ${segs.length} segments initialised (${(chainM / 1000).toFixed(1)}km), ${THAMES_ZONES.length} zones`);
}

/**
 * Find the chainage (metres along the centreline) of the point on the
 * Thames centreline closest to a scene-coordinate position.
 *
 * Use the returned chainage with getZoneAt() to derive the zone.
 *
 * @param {number} x  Scene X coordinate
 * @param {number} z  Scene Z coordinate
 * @returns {number|null}  Chainage in metres of the closest centreline
 *                         point, or null if Thames data unavailable.
 */
export function nearestThamesSegment(x, z) {
  if (!_segments) return null;
  let bestChainM = 0;
  let bestDistSq = Infinity;
  for (const seg of _segments) {
    let t;
    if (seg.lenSq < 1e-8) {
      t = 0;
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
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestChainM = seg.startChainM + t * seg.len;
    }
  }
  return bestChainM;
}
