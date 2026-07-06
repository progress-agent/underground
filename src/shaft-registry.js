// Shaft Registry — collects station data during line loading,
// then provides a unified view for creating one shaft per physical station.

const UNDERGROUND_LINE_IDS = new Set([
  'bakerloo', 'central', 'circle', 'district', 'hammersmith-city',
  'jubilee', 'metropolitan', 'northern', 'piccadilly', 'victoria',
  'waterloo-city', 'dlr',
]);

// naptanId -> { name, x, z, lines: Set<lineId>, deepestDepthM, lineCount }
const registry = new Map();

/**
 * Register a station for shaft creation. Call once per station per line during loading.
 * The registry deduplicates by naptanId and tracks which lines serve each station,
 * keeping the deepest depth across all lines for shaft height calculation.
 */
export function registerStationForShafts({ naptanId, name, x, z, lineId, depthM, tflLineCount }) {
  if (!naptanId) return;
  const key = String(naptanId).trim();

  if (registry.has(key)) {
    const entry = registry.get(key);
    if (lineId) entry.lines.add(lineId);
    // Keep the deepest depth across all lines (shafts reach the lowest platform)
    if (depthM > entry.deepestDepthM) entry.deepestDepthM = depthM;
    // Update lineCount if TfL provides a higher count
    if (tflLineCount > entry.lineCount) entry.lineCount = tflLineCount;
    return entry;
  }

  const entry = {
    name: name || key,
    x,
    z,
    lines: new Set(lineId ? [lineId] : []),
    deepestDepthM: depthM || 0,
    lineCount: tflLineCount || 1,
  };
  registry.set(key, entry);
  return entry;
}

/** Get the full registry Map for shaft creation. */
export function getShaftRegistry() {
  return registry;
}

