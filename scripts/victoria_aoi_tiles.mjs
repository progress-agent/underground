import { fetchRouteSequence } from '../src/tfl.js';
import { execSync } from 'node:child_process';

// Compute a square AOI around the Victoria line (as discussed):
// half-span = max(N-S, E-W)/2 from station bbox.

const seq = await fetchRouteSequence('victoria');
const all = [];
for (const s of seq.stopPointSequences || []) for (const sp of s.stopPoint || []) all.push(sp);
const map = new Map();
for (const sp of all) map.set(sp.id, sp);
const stations = [...map.values()];

const lats = stations.map(s => s.lat);
const lons = stations.map(s => s.lon);
const minLat = Math.min(...lats), maxLat = Math.max(...lats);
const minLon = Math.min(...lons), maxLon = Math.max(...lons);
const centerLat = (minLat + maxLat) / 2;
const centerLon = (minLon + maxLon) / 2;

// Approx span in metres (haversine on axis)
const R = 6371000;
const toRad = x => x * Math.PI / 180;
function hav(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const northSouth = hav(minLat, centerLon, maxLat, centerLon);
const eastWest = hav(centerLat, minLon, centerLat, maxLon);
const halfSpanM = Math.max(northSouth, eastWest) / 2;

// Convert the AOI bbox corners into British National Grid (EPSG:27700)
// using gdaltransform (expects lon lat order for EPSG:4326).
function lonLatToBNG(lon, lat) {
  const input = `${lon} ${lat}\n`;
  const out = execSync('gdaltransform -s_srs EPSG:4326 -t_srs EPSG:27700', { input, encoding: 'utf8' }).trim();
  const [e, n] = out.split(/\s+/).map(Number);
  return { e, n };
}

// Build square AOI in lat/lon by converting metre offsets around center using local approx.
// Use small-angle: dLat = metres / 111320, dLon = metres / (111320*cos(lat)).
const metresPerDegLat = 111320;
const metresPerDegLon = 111320 * Math.cos(toRad(centerLat));
const dLat = halfSpanM / metresPerDegLat;
const dLon = halfSpanM / metresPerDegLon;

const aoi = {
  center: { lat: centerLat, lon: centerLon },
  halfSpanM,
  bboxWgs84: {
    minLat: centerLat - dLat,
    maxLat: centerLat + dLat,
    minLon: centerLon - dLon,
    maxLon: centerLon + dLon,
  }
};

const sw = lonLatToBNG(aoi.bboxWgs84.minLon, aoi.bboxWgs84.minLat);
const ne = lonLatToBNG(aoi.bboxWgs84.maxLon, aoi.bboxWgs84.maxLat);

// EA tiles are 5km aligned to OS grid. We'll list tile origins in BNG:
// For each 5km tile, define its lower-left corner at multiples of 5000m.
const TILE = 5000;
const eMin = Math.floor(sw.e / TILE) * TILE;
const nMin = Math.floor(sw.n / TILE) * TILE;
const eMax = Math.floor(ne.e / TILE) * TILE;
const nMax = Math.floor(ne.n / TILE) * TILE;

const tiles = [];
for (let e = eMin; e <= eMax; e += TILE) {
  for (let n = nMin; n <= nMax; n += TILE) {
    tiles.push({ e, n });
  }
}

console.log(JSON.stringify({
  stationBBox: { minLat, maxLat, minLon, maxLon },
  aoi,
  bboxBNG: { eMin, nMin, eMax, nMax },
  tiles_5km: tiles,
  tileCount: tiles.length,
}, null, 2));
