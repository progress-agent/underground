// Depth handling (MVP)
//
// We support two sources:
// 1) Curated per-station depth anchors (data/station_depths.csv)
// 2) Heuristic per-line depths (fallback) to make the network layered immediately.

// Heuristic depths in "metres below ground" for each line id.
// Deep-level tubes lower; sub-surface lines shallower.
export const LINE_DEPTH_M = {
  // sub-surface
  circle: 8,
  district: 10,
  metropolitan: 10,
  'hammersmith-city': 9,

  // deep-level
  bakerloo: 25,
  central: 28,
  jubilee: 32,
  northern: 30,
  piccadilly: 30,
  victoria: 33,
  'waterloo-city': 35,
};

// Very simple CSV parser for our small curated file.
// Expects header: naptan_id,name,depth_m,source_url,notes
export async function loadStationDepthAnchors() {
  try {
    // Vite serves static assets from /public at the site root.
    const res = await fetch('/data/station_depths.csv');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    // first non-comment is header
    const header = lines.shift();
    if (!header) return new Map();

    const map = new Map();
    for (const line of lines) {
      const cols = line.split(',');
      const naptanId = (cols[0] || '').trim();
      const depthStr = (cols[2] || '').trim();
      const depth = depthStr ? Number(depthStr) : NaN;
      if (!naptanId || !Number.isFinite(depth)) continue;
      map.set(naptanId, depth);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function depthForStation({ naptanId, lineId, anchors }) {
  // DLR uses sourced rail typology/portals through dlr-profile.js. No generic
  // underground estimate may silently put an elevated railway below ground.
  if (lineId === 'dlr') return null;
  if (anchors && naptanId && anchors.has(naptanId)) return anchors.get(naptanId);
  if (lineId && lineId in LINE_DEPTH_M) return LINE_DEPTH_M[lineId];
  return 18; // generic underground
}

// Build interpolator for a line's stations given known depth anchors
// stopPoints: [{id, lat, lon}] in line order
// Returns function(naptanId) -> interpolated depth
export function buildDepthInterpolator(stopPoints, anchors) {
  // Find anchor points (stations with known depths) in order along the line
  const anchorPoints = [];
  for (let i = 0; i < stopPoints.length; i++) {
    const sp = stopPoints[i];
    if (anchors && anchors.has(sp.id)) {
      anchorPoints.push({
        index: i,
        naptanId: sp.id,
        depth: anchors.get(sp.id),
        cumulativeDistance: 0 // Will calculate
      });
    }
  }

  // Calculate cumulative distances along the line
  let totalDist = 0;
  const cumulativeDists = [0];
  for (let i = 1; i < stopPoints.length; i++) {
    const d = haversineDistance(
      stopPoints[i - 1].lat, stopPoints[i - 1].lon,
      stopPoints[i].lat, stopPoints[i].lon
    );
    totalDist += d;
    cumulativeDists.push(totalDist);
  }

  // Assign cumulative distances to anchor points
  for (const ap of anchorPoints) {
    ap.cumulativeDistance = cumulativeDists[ap.index];
  }

  // Return interpolator function
  return function(naptanId) {
    // Find station index
    const idx = stopPoints.findIndex(sp => sp.id === naptanId);
    if (idx === -1) return null;

    // If it's an anchor point, return exact depth
    const anchorMatch = anchorPoints.find(ap => ap.naptanId === naptanId);
    if (anchorMatch) return anchorMatch.depth;

    const stationDist = cumulativeDists[idx];

    // Find nearest anchors before and after
    let before = null;
    let after = null;

    for (const ap of anchorPoints) {
      if (ap.cumulativeDistance <= stationDist) {
        before = ap;
      } else if (!after) {
        after = ap;
        break;
      }
    }

    // Interpolate or extrapolate
    if (before && after) {
      // Linear interpolation between two anchors
      const t = (stationDist - before.cumulativeDistance) / (after.cumulativeDistance - before.cumulativeDistance);
      return before.depth + t * (after.depth - before.depth);
    } else if (before) {
      // After last anchor - use last anchor depth
      return before.depth;
    } else if (after) {
      // Before first anchor - use first anchor depth
      return after.depth;
    }

    return null;
  };
}

// Haversine distance in metres
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function debugDepthStats({ lineId, stopPoints, anchors }) {
  const vals = [];
  for (const sp of stopPoints || []) {
    const depthM = depthForStation({ naptanId: sp.id, lineId, anchors });
    vals.push(depthM);
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { count: vals.length, min, max };
}
