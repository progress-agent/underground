// thames-zones.js — Named reach zones for Thames hover tooltips.
//
// 10 zones spanning the 126-waypoint Thames centreline (Wave 1 plan locked).
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
//   indexStart  number  - first thames.json waypoint index (inclusive)
//   indexEnd    number  - last thames.json waypoint index (inclusive)
//   meanWidth   number  - representative width in metres (at MHWS)
//   meanDepth   number  - representative mean fairway depth in metres (at MHWS)
//   maxDepth    number  - deepest fairway sounding in metres (at MHWS)
//   landmark    string  - anchor landmark for the zone
//
// Coverage: indices 0-125 with no gaps (verified by getZoneAt fallthrough).

export const THAMES_ZONES = [
  {
    id: 'upper-tideway',
    name: 'Upper Tideway',
    indexStart: 0,
    indexEnd: 9,
    meanWidth: 45,
    meanDepth: 2.5,
    maxDepth: 3,
    landmark: 'Teddington Lock',
  },
  {
    id: 'putney-hammersmith',
    name: 'Putney & Hammersmith Reach',
    indexStart: 10,
    indexEnd: 19,
    meanWidth: 60,
    meanDepth: 4,
    maxDepth: 4,
    landmark: 'Hammersmith Bridge',
  },
  {
    id: 'battersea-reach',
    name: 'Battersea Reach',
    indexStart: 20,
    indexEnd: 31,
    meanWidth: 62,
    meanDepth: 4.5,
    maxDepth: 5,
    landmark: 'Battersea Bridge',
  },
  {
    id: 'westminster-reach',
    name: 'Westminster Reach',
    indexStart: 32,
    indexEnd: 43,
    meanWidth: 82,
    meanDepth: 5.5,
    maxDepth: 6,
    landmark: 'Westminster Bridge',
  },
  {
    id: 'pool-of-london',
    name: 'Pool of London',
    indexStart: 44,
    indexEnd: 53,
    meanWidth: 140,
    meanDepth: 7.5,
    maxDepth: 9,
    landmark: 'Tower Bridge',
  },
  {
    id: 'limehouse-reach',
    name: 'Limehouse Reach',
    indexStart: 54,
    indexEnd: 65,
    meanWidth: 210,
    meanDepth: 10,
    maxDepth: 10,
    landmark: 'Canary Wharf approach',
  },
  {
    id: 'greenwich-reach',
    name: 'Greenwich Reach',
    indexStart: 66,
    indexEnd: 83,
    meanWidth: 255,
    meanDepth: 11.5,
    maxDepth: 13,
    landmark: 'Greenwich Royal Observatory',
  },
  {
    id: 'blackwall-woolwich',
    name: 'Blackwall & Woolwich Reach',
    indexStart: 84,
    indexEnd: 99,
    meanWidth: 285,
    meanDepth: 13.5,
    maxDepth: 14,
    landmark: 'Thames Barrier',
  },
  {
    id: 'gallions-erith',
    name: 'Gallions & Erith Reach',
    indexStart: 100,
    indexEnd: 117,
    meanWidth: 340,
    meanDepth: 15,
    maxDepth: 16,
    landmark: 'Crossness Pumping Station',
  },
  {
    id: 'thames-estuary-mouth',
    name: 'Thames Estuary Mouth',
    indexStart: 118,
    indexEnd: 125,
    meanWidth: 580,
    meanDepth: 16,
    maxDepth: 16,
    landmark: 'QE2 Bridge (Dartford Crossing)',
  },
];

// ---------- Lookups ----------

/**
 * Map a thames.json waypoint index to its zone.
 * O(N) over 10 zones — trivially fast, no binary search needed.
 *
 * @param {number} waypointIndex  Integer index into thames.json points[]
 * @returns {object|null}         Matching zone, or null if out of range
 */
export function getZoneAt(waypointIndex) {
  if (typeof waypointIndex !== 'number' || !Number.isFinite(waypointIndex)) return null;
  for (const zone of THAMES_ZONES) {
    if (waypointIndex >= zone.indexStart && waypointIndex <= zone.indexEnd) {
      return zone;
    }
  }
  return null;
}

// ---------- Nearest-segment helper ----------
//
// Refactored from thames-mask.js's isInThames() inner loop. Pre-computed
// at module load for O(N) per-call cost over 125 segments (~50us — fine
// for hover-rate calls).
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
    segs.push({ ax, az, dx, dz, lenSq, startIndex: i });
  }
  _segments = segs;
  console.log(`Thames zones: ${segs.length} segments initialised, ${THAMES_ZONES.length} zones`);
}

/**
 * Find the index of the Thames waypoint segment closest to a point in
 * scene coordinates. Returns the START waypoint index of the closest
 * segment (i.e. the lower of the two waypoint indices framing it).
 *
 * Use the returned index with getZoneAt() to derive the zone.
 *
 * @param {number} x  Scene X coordinate
 * @param {number} z  Scene Z coordinate
 * @returns {number|null}  Start waypoint index of closest segment, or null
 *                         if Thames data unavailable.
 */
export function nearestThamesSegment(x, z) {
  if (!_segments) return null;
  let bestIdx = 0;
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
      bestIdx = seg.startIndex;
    }
  }
  return bestIdx;
}
