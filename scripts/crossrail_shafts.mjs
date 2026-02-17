// Generate shafts.json for Crossrail stations from crossrail_depths.csv
// Run: node scripts/crossrail_shafts.mjs

import fs from 'node:fs/promises';

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

const verticalScale = 3.0;
const groundY = -6.0;

const csv = await fs.readFile('public/data/crossrail_depths.csv', 'utf8');
const lines = csv.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));

const shafts = [];
for (const line of lines) {
  const parts = line.split(',');
  if (parts.length < 6) continue;
  const id = parts[0].trim();
  const name = parts[1].trim();
  const depth = parseFloat(parts[2]);
  const lat = parseFloat(parts[3]);
  const lon = parseFloat(parts[4]);
  if (!id || !Number.isFinite(depth) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

  const { x, z } = llToXZ(lat, lon);
  const platformY = -(depth * verticalScale);
  shafts.push({ id, name, x, z, groundY, platformY, depth_m: depth });
}

await fs.mkdir('public/data/crossrail', { recursive: true });
await fs.writeFile('public/data/crossrail/shafts.json', JSON.stringify({
  line: 'crossrail',
  origin: ORIGIN,
  verticalScale,
  groundY,
  shafts,
}, null, 2));

console.log(`Wrote ${shafts.length} Crossrail shafts`);
