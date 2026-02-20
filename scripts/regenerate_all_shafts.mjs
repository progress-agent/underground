#!/usr/bin/env node
// Regenerate shafts.json for ALL lines using all inbound branches (not just longest).
// Reads from bundled TfL route-sequence cache in public/data/tfl/.

import fs from 'node:fs/promises';
import path from 'node:path';

const LINES = [
  'bakerloo', 'central', 'circle', 'district', 'dlr',
  'hammersmith-city', 'jubilee', 'metropolitan', 'northern',
  'piccadilly', 'victoria', 'waterloo-city',
];

// Line-specific heuristic depths (metres) when no anchor is available
const LINE_DEPTH_DEFAULTS = {
  bakerloo: 25, central: 28, circle: 8, district: 10, dlr: 6,
  'hammersmith-city': 9, jubilee: 32, metropolitan: 10, northern: 30,
  piccadilly: 30, victoria: 33, 'waterloo-city': 35,
};

const ORIGIN = { lat: 51.5074, lon: -0.1278 };
const METRES_PER_DEG_LAT = 111_320;
const toRad = x => x * Math.PI / 180;
const metresPerDegLonAt = (latDeg) => 111_320 * Math.cos(toRad(latDeg));
const llToXZ = (lat, lon) => {
  const dLon = lon - ORIGIN.lon;
  const dLat = lat - ORIGIN.lat;
  const x = dLon * metresPerDegLonAt(ORIGIN.lat);
  const z = -(dLat * METRES_PER_DEG_LAT);
  return { x, z };
};

// Must match VERTICAL_EXAGGERATION in src/terrain.js
const verticalScale = 5.0;
const groundY = -6.0;

// Load depth anchors
const anchors = new Map();
try {
  const csv = await fs.readFile('public/data/station_depths.csv', 'utf8');
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  lines.shift(); // header
  for (const line of lines) {
    const cols = line.split(',');
    const id = cols[0].trim();
    const depthStr = (cols[2] || '').trim();
    const depth = depthStr ? Number(depthStr) : NaN;
    if (id && Number.isFinite(depth)) anchors.set(id, depth);
  }
} catch (err) {
  console.warn('Could not load station_depths.csv:', err.message);
}

console.log(`Loaded ${anchors.size} depth anchors\n`);

for (const lineId of LINES) {
  const cachePath = `public/data/tfl/route-sequence/${lineId}.json`;
  let data;
  try {
    data = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    console.warn(`  SKIP ${lineId}: no cached route-sequence`);
    continue;
  }

  const sequences = data.stopPointSequences || [];
  const inbound = sequences.filter(s => s.direction === 'inbound');
  const branches = (inbound.length > 0 ? inbound : sequences)
    .map(s => s.stopPoint || [])
    .filter(arr => arr.length > 0);

  // Deduplicate stops by ID
  const seen = new Set();
  const allStops = [];
  for (const branch of branches) {
    for (const sp of branch) {
      if (sp.id && !seen.has(sp.id) && Number.isFinite(sp.lat) && Number.isFinite(sp.lon)) {
        seen.add(sp.id);
        allStops.push(sp);
      }
    }
  }

  const fallbackDepth = LINE_DEPTH_DEFAULTS[lineId] || 15;
  const shafts = allStops.map(sp => {
    const { x, z } = llToXZ(sp.lat, sp.lon);
    const depth = anchors.get(sp.id) ?? fallbackDepth;
    const y = -depth * verticalScale;
    return { id: sp.id, name: sp.name, x, z, groundY, platformY: y, depth_m: depth };
  });

  const outDir = `public/data/${lineId}`;
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'shafts.json'), JSON.stringify({
    line: lineId,
    origin: ORIGIN,
    verticalScale,
    groundY,
    shafts,
  }, null, 2));

  console.log(`  ${lineId}: ${shafts.length} shafts (was using longest-only)`);
}

console.log('\nDone.');
