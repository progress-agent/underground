import { fetchRouteSequence } from '../src/tfl.js';
import fs from 'node:fs/promises';

const LINE_ID = 'victoria';

async function loadRouteSequence(lineId) {
  // Prefer live fetch (TfL), but fall back to the repo-bundled cache so this script
  // works offline and in CI without network.
  try {
    return await fetchRouteSequence(lineId);
  } catch (err) {
    const p = `public/data/tfl/route-sequence/${lineId}.json`;
    const raw = await fs.readFile(p, 'utf8');
    console.warn(`TfL fetch failed; using bundled ${p}`);
    return JSON.parse(raw);
  }
}

const seq = await loadRouteSequence(LINE_ID);
const sequences = seq.stopPointSequences || [];
const longest = sequences.reduce((best, cur) => (!best || (cur.stopPoint?.length || 0) > (best.stopPoint?.length || 0)) ? cur : best, null);
const sps = longest?.stopPoint || [];

// load anchors from public/data/station_depths.csv (same parser as app)
const csv = await fs.readFile('public/data/station_depths.csv','utf8');
const lines = csv.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));
lines.shift();
const anchors = new Map();
for (const line of lines){
  const cols=line.split(',');
  const id=cols[0].trim();
  const depth=Number((cols[2]||'').trim());
  if (id && Number.isFinite(depth)) anchors.set(id, depth);
}

const ORIGIN = { lat: 51.5074, lon: -0.1278 };
const METRES_PER_DEG_LAT = 111_320;
const toRad = x => x*Math.PI/180;
const metresPerDegLonAt = (latDeg)=>111_320*Math.cos(toRad(latDeg));
const llToXZ=(lat,lon)=>{
  const dLon=lon-ORIGIN.lon;
  const dLat=lat-ORIGIN.lat;
  const x=dLon*metresPerDegLonAt(ORIGIN.lat);
  const z=dLat*METRES_PER_DEG_LAT;
  return {x, z:-z};
};

const verticalScale = 3.0;
const groundY = -6.0;

const out = [];
for (const sp of sps){
  const {x,z}=llToXZ(sp.lat, sp.lon);
  const depth = anchors.get(sp.id) ?? null;
  if (depth == null) continue;
  const y = -depth * verticalScale;
  out.push({ id: sp.id, name: sp.name, x, z, groundY, platformY: y, depth_m: depth });
}

await fs.mkdir('public/data/victoria', { recursive: true });
await fs.writeFile('public/data/victoria/shafts.json', JSON.stringify({
  line: LINE_ID,
  origin: ORIGIN,
  verticalScale,
  groundY,
  shafts: out,
}, null, 2));
console.log('wrote', out.length, 'shafts');
