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
  if (anchors && naptanId && anchors.has(naptanId)) return anchors.get(naptanId);
  if (lineId && lineId in LINE_DEPTH_M) return LINE_DEPTH_M[lineId];
  return 18; // generic underground
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
