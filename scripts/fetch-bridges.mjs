// Build public/data/bridges.json: Thames bridge crossings inside the M25.
//
// Modelled on Working/thames-course-10Jul26f/build-thames-v2.mjs conventions:
// Overpass fetch (cached, rerunnable) -> WGS84 to BNG via the repo's proj4 ->
// crossings located by segment intersection against the thames.json
// centreline (which is already clipped to the M25 boundary crossings).
//
// Per locked decision D-019 bridges are archetype-based: coherent and
// recognisable rather than fully accurate. OSM supplies location, axis
// bearing and (where present) width; a curated table supplies canonical
// names, archetypes and clearances. Tunnels are out of scope.
//
// Output record shape (one record per structure; parallel structures at the
// same crossing carry a shared `group`):
//   name        canonical display name
//   kind        road | rail | foot | rail+foot
//   archetype   suspension | arch | beam-girder | cantilever | bascule | cable-stayed
//   group       shared slug when parallel structures exist at one crossing (else null)
//   chainM      chainage (m) along the thames.json centreline at the crossing midpoint
//   axis        { a:{e,n}, b:{e,n}, bearingDeg } BNG endpoints, bank to bank
//               plus overshoot onto land; a is the southern-ish end
//   deckWidthM  deck width (OSM width/lanes, curated override, or archetype default)
//   spanM       local river width from thames.json at the crossing
//   clearanceM  deck height above water (curated / archetype default)
//   source      { osmWayIds, nameFrom }
//
// Usage: node scripts/fetch-bridges.mjs [--refresh]
//   --refresh forces a new Overpass fetch (otherwise scripts/.cache is used).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, '..');
const req = createRequire(path.join(REPO, 'package.json'));
const proj4 = req('proj4');

const BNG = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs';

const CACHE_DIR = path.join(SCRIPT_DIR, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'bridges-overpass.json');
const OUT_FILE = path.join(REPO, 'public/data/bridges.json');
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Scene origin (Trafalgar Square) for reference; axis endpoints are emitted in
// raw BNG (EPSG:27700). Consumers convert with x = e - 530000, z = -(n - 180400)
// exactly as thames-zones.js does. 1 unit = 1 m in X/Z.
const ORIGIN_E = 530000;
const ORIGIN_N = 180400;

// ---------------------------------------------------------------------------
// Curated knowledge table (D-019: archetypes and clearances from knowledge,
// not OSM). Keys are matched against normalised OSM names. `foot: true`
// marks the footbridges we deliberately keep; unmatched foot-only crossings
// (lock and weir walkways etc.) are dropped as minor service crossings.
// Clearances are plausible deck-above-water figures, not navigational data.
// ---------------------------------------------------------------------------
const CURATED = [
  { slug: 'runnymede', match: /runnymede|^m25$/i, name: 'M25 Runnymede Bridge', archetype: 'arch', clearanceM: 6, deckWidthM: 34 },
  { slug: 'staines-rail', match: /staines railway/i, nearBng: { e: 503592, n: 171231 }, name: 'Staines Railway Bridge', archetype: 'beam-girder', clearanceM: 5.5 },
  { slug: 'staines', match: /staines bridge/i, name: 'Staines Bridge', archetype: 'arch', clearanceM: 5 },
  { slug: 'm3', match: /^m3$|m3 thames/i, nearBng: { e: 505394, n: 167203 }, name: 'M3 Thames Bridge', archetype: 'beam-girder', clearanceM: 6, deckWidthM: 34 },
  { slug: 'chertsey', match: /chertsey/i, name: 'Chertsey Bridge', archetype: 'arch', clearanceM: 4.5 },
  { slug: 'walton', match: /walton/i, name: 'Walton Bridge', archetype: 'arch', clearanceM: 5.5 },
  { slug: 'hampton-court', match: /hampton court/i, name: 'Hampton Court Bridge', archetype: 'arch', clearanceM: 4.5 },
  { slug: 'kingston-rail', match: /kingston railway/i, nearBng: { e: 517732, n: 169634 }, name: 'Kingston Railway Bridge', archetype: 'arch', clearanceM: 5 },
  { slug: 'kingston', match: /kingston bridge/i, name: 'Kingston Bridge', archetype: 'arch', clearanceM: 4.8 },
  { slug: 'teddington-foot', match: /teddington/i, name: 'Teddington Lock Footbridges', archetype: 'suspension', clearanceM: 4, foot: true, deckWidthM: 3 },
  { slug: 'richmond-lock-foot', match: /richmond (lock|footbridge)/i, name: 'Richmond Lock & Footbridge', archetype: 'arch', clearanceM: 8, foot: true, deckWidthM: 4 },
  { slug: 'richmond-rail', match: /richmond railway/i, nearBng: { e: 517268, n: 174811 }, name: 'Richmond Railway Bridge', archetype: 'arch', clearanceM: 5.3 },
  { slug: 'twickenham', match: /twickenham/i, name: 'Twickenham Bridge', archetype: 'arch', clearanceM: 5.5 },
  { slug: 'richmond', match: /richmond bridge/i, name: 'Richmond Bridge', archetype: 'arch', clearanceM: 5.2 },
  { slug: 'kew-rail', match: /kew railway/i, nearBng: { e: 519567, n: 177512 }, name: 'Kew Railway Bridge', archetype: 'beam-girder', clearanceM: 5.5 },
  { slug: 'kew', match: /kew bridge/i, name: 'Kew Bridge', archetype: 'arch', clearanceM: 5.3 },
  { slug: 'chiswick', match: /chiswick/i, name: 'Chiswick Bridge', archetype: 'arch', clearanceM: 5.3 },
  { slug: 'barnes-rail', match: /barnes/i, name: 'Barnes Railway Bridge', archetype: 'arch', clearanceM: 5.4 },
  // Hammersmith is tagged highway=cycleway in OSM (closed to motor traffic
  // since 2019) but reads as a road bridge; kind forced per D-019.
  { slug: 'hammersmith', match: /hammersmith bridge/i, name: 'Hammersmith Bridge', archetype: 'suspension', clearanceM: 3.7, deckWidthM: 13, kind: 'road' },
  { slug: 'fulham-rail', match: /fulham railway|putney railway/i, name: 'Fulham Railway Bridge', archetype: 'beam-girder', clearanceM: 5.9 },
  { slug: 'putney', match: /putney bridge/i, name: 'Putney Bridge', archetype: 'arch', clearanceM: 5.5 },
  { slug: 'wandsworth', match: /wandsworth/i, name: 'Wandsworth Bridge', archetype: 'cantilever', clearanceM: 5.9 },
  { slug: 'battersea-rail', match: /cremorne|battersea railway/i, name: 'Battersea Railway Bridge', archetype: 'arch', clearanceM: 6.7 },
  { slug: 'battersea', match: /battersea bridge/i, name: 'Battersea Bridge', archetype: 'arch', clearanceM: 5.4 },
  { slug: 'albert', match: /albert/i, name: 'Albert Bridge', archetype: 'suspension', clearanceM: 4.9, deckWidthM: 12 },
  { slug: 'chelsea', match: /chelsea/i, name: 'Chelsea Bridge', archetype: 'suspension', clearanceM: 6.8 },
  { slug: 'grosvenor-rail', match: /grosvenor|victoria railway/i, name: 'Grosvenor Railway Bridge', archetype: 'arch', clearanceM: 5.9, deckWidthM: 30 },
  { slug: 'vauxhall', match: /vauxhall/i, name: 'Vauxhall Bridge', archetype: 'arch', clearanceM: 5.6 },
  { slug: 'lambeth', match: /lambeth/i, name: 'Lambeth Bridge', archetype: 'arch', clearanceM: 6.5 },
  { slug: 'westminster', match: /westminster/i, name: 'Westminster Bridge', archetype: 'arch', clearanceM: 5.4, deckWidthM: 26 },
  { slug: 'hungerford-rail', match: /hungerford|charing cross/i, name: 'Hungerford Bridge', archetype: 'beam-girder', clearanceM: 8.4 },
  { slug: 'golden-jubilee-foot', match: /golden jubilee/i, name: 'Golden Jubilee Bridges', archetype: 'cable-stayed', clearanceM: 8.4, foot: true, deckWidthM: 4.7 },
  { slug: 'waterloo', match: /waterloo/i, name: 'Waterloo Bridge', archetype: 'arch', clearanceM: 8.7 },
  { slug: 'blackfriars-rail', match: /blackfriars railway/i, name: 'Blackfriars Railway Bridge', archetype: 'arch', clearanceM: 7, deckWidthM: 25 },
  { slug: 'blackfriars', match: /blackfriars bridge/i, name: 'Blackfriars Bridge', archetype: 'arch', clearanceM: 7 },
  { slug: 'millennium-foot', match: /millennium/i, name: 'Millennium Bridge', archetype: 'suspension', clearanceM: 10.5, foot: true, deckWidthM: 4 },
  { slug: 'southwark', match: /southwark/i, name: 'Southwark Bridge', archetype: 'arch', clearanceM: 7.4 },
  { slug: 'cannon-street-rail', match: /cannon street/i, name: 'Cannon Street Railway Bridge', archetype: 'beam-girder', clearanceM: 7 },
  { slug: 'london', match: /^london bridge/i, name: 'London Bridge', archetype: 'beam-girder', clearanceM: 8.9 },
  { slug: 'tower', match: /tower bridge/i, name: 'Tower Bridge', archetype: 'bascule', clearanceM: 8.6, deckWidthM: 18 },
  { slug: 'qe2', match: /queen elizabeth|qe ?2|dartford/i, name: 'Queen Elizabeth II Bridge', archetype: 'cable-stayed', clearanceM: 54, deckWidthM: 20 },
];

const ARCHETYPE_DEFAULT_CLEARANCE = { road: 6, rail: 6, foot: 6, 'rail+foot': 6 };
const KIND_DEFAULT_DECK = { road: 15, rail: 11, foot: 4.5, 'rail+foot': 13 };

// ---------------------------------------------------------------------------
// Load centreline (already M25-clipped) and pre-compute chainage + lat/lon.
// ---------------------------------------------------------------------------
const thames = JSON.parse(fs.readFileSync(path.join(REPO, 'public/data/thames.json')));
const pts = thames.points; // { e, n, w, d }
const chain = [0];
for (let i = 1; i < pts.length; i++) {
  chain.push(chain[i - 1] + Math.hypot(pts[i].e - pts[i - 1].e, pts[i].n - pts[i - 1].n));
}
const TOTAL = chain[chain.length - 1];

// Extended polyline for intersection tests only: the centreline is clipped
// 25 m inside each M25 boundary crossing, so the boundary bridges themselves
// (Runnymede west, QE2 east) would otherwise just miss it. Extend each end
// by 400 m along the terminal bearing; chainage is clamped to [0, TOTAL].
function extendEnd(a, b, dist) {
  const L = Math.hypot(b.e - a.e, b.n - a.n) || 1;
  return { e: b.e + (b.e - a.e) / L * dist, n: b.n + (b.n - a.n) / L * dist };
}
const EXT = 400;
const extLine = [
  extendEnd(pts[1], pts[0], EXT),
  ...pts,
  extendEnd(pts[pts.length - 2], pts[pts.length - 1], EXT),
];
const extChain = [-EXT];
for (let i = 1; i < extLine.length; i++) {
  extChain.push(extChain[i - 1] + Math.hypot(extLine[i].e - extLine[i - 1].e, extLine[i].n - extLine[i - 1].n));
}

// ---------------------------------------------------------------------------
// Overpass fetch (cached).
// ---------------------------------------------------------------------------
function buildQuery() {
  // around-linestring filter: every centreline point (250 m spacing), 300 m
  // radius, so any way that crosses the river is captured.
  const coords = pts
    .map((p) => {
      const [lon, lat] = proj4(BNG, 'WGS84', [p.e, p.n]);
      return `${lat.toFixed(5)},${lon.toFixed(5)}`;
    })
    .join(',');
  return `[out:json][timeout:180];
(
  way["bridge"]["bridge"!="no"](around:300,${coords});
  way["man_made"="bridge"](around:300,${coords});
);
out tags geom;`;
}

async function fetchOverpass() {
  const refresh = process.argv.includes('--refresh');
  if (!refresh && fs.existsSync(CACHE_FILE)) {
    console.log('using cached Overpass response:', CACHE_FILE);
    return JSON.parse(fs.readFileSync(CACHE_FILE));
  }
  const query = buildQuery();
  let lastErr;
  for (const url of OVERPASS_URLS) {
    try {
      console.log('fetching Overpass:', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // overpass-api.de answers 406 to UA-less requests; identify ourselves
          'User-Agent': 'underground-bridges/1.0 (https://github.com/progress-agent/underground)',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(json));
      console.log('cached', json.elements.length, 'elements to', CACHE_FILE);
      return json;
    } catch (e) {
      lastErr = e;
      console.warn('overpass mirror failed:', e.message);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------
const ROAD_HW = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'road', 'busway']);
const FOOT_HW = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'bridleway']);
const RAIL = new Set(['rail', 'light_rail', 'subway', 'narrow_gauge', 'tram']);

function classify(tags) {
  if (!tags) return null;
  if (tags.man_made === 'bridge') return 'outline';
  if (tags['man_made'] === 'pipeline' || tags.power || tags.waterway) return null;
  if (RAIL.has(tags.railway)) return 'rail';
  if (tags.railway) return null; // abandoned, disused, razed etc.
  if (ROAD_HW.has(tags.highway)) return 'road';
  if (FOOT_HW.has(tags.highway)) return 'foot';
  return null; // service ways, aerialways, anything else: minor crossings
}

// ---------------------------------------------------------------------------
// Geometry helpers (BNG plane; matches build-thames-v2.mjs segInt).
// ---------------------------------------------------------------------------
function segInt(p1, p2, p3, p4) {
  const d1e = p2.e - p1.e, d1n = p2.n - p1.n, d2e = p4.e - p3.e, d2n = p4.n - p3.n;
  const den = d1e * d2n - d1n * d2e;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.e - p1.e) * d2n - (p3.n - p1.n) * d2e) / den;
  const u = ((p3.e - p1.e) * d1n - (p3.n - p1.n) * d1e) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? { t, u } : null;
}

// Find where a way's geometry crosses the (extended) centreline.
// Returns { chainM, point:{e,n}, dir:{e,n} } for the first crossing, or null.
function findCrossing(geomBng) {
  for (let i = 1; i < geomBng.length; i++) {
    const a = geomBng[i - 1], b = geomBng[i];
    for (let j = 1; j < extLine.length; j++) {
      const hit = segInt(a, b, extLine[j - 1], extLine[j]);
      if (hit) {
        const chainM = Math.max(0, Math.min(TOTAL, extChain[j - 1] + hit.u * (extChain[j] - extChain[j - 1])));
        const L = Math.hypot(b.e - a.e, b.n - a.n) || 1;
        return {
          chainM,
          point: { e: a.e + hit.t * (b.e - a.e), n: a.n + hit.t * (b.n - a.n) },
          dir: { e: (b.e - a.e) / L, n: (b.n - a.n) / L },
        };
      }
    }
  }
  return null;
}

// Point + local tangent on the (unclipped) centreline at a given chainage.
function pointAtChain(target) {
  let i = chain.findIndex((c) => c >= target);
  if (i <= 0) i = 1;
  const a = pts[i - 1], b = pts[i];
  const t = (target - chain[i - 1]) / (chain[i] - chain[i - 1] || 1);
  return {
    e: a.e + t * (b.e - a.e),
    n: a.n + t * (b.n - a.n),
    w: a.w + t * (b.w - a.w),
  };
}

function parseWidth(tags) {
  if (tags.width) {
    const m = String(tags.width).match(/[\d.]+/);
    if (m) return parseFloat(m[0]);
  }
  if (tags.lanes) {
    const lanes = parseInt(tags.lanes, 10);
    if (Number.isFinite(lanes) && lanes > 0) return lanes * 3.5 + 3;
  }
  return null;
}

function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const osm = await fetchOverpass();

// Per-way crossing detection.
const crossings = [];
for (const el of osm.elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  const kind = classify(el.tags);
  if (!kind) continue;
  const geomBng = el.geometry.map((g) => {
    const [e, n] = proj4('WGS84', BNG, [g.lon, g.lat]);
    return { e, n };
  });
  const hit = findCrossing(geomBng);
  if (!hit) continue;
  crossings.push({
    id: el.id,
    kind,
    tags: el.tags,
    name: el.tags['bridge:name'] || el.tags.name || null,
    widthM: parseWidth(el.tags),
    lengthM: geomBng.reduce((s, p, i) => (i ? s + Math.hypot(p.e - geomBng[i - 1].e, p.n - geomBng[i - 1].n) : 0), 0),
    ...hit,
  });
}
console.log('crossing ways:', crossings.length, 'of', osm.elements.length, 'fetched elements');

// Cluster by chainage: sort, then break where the gap exceeds 120 m.
crossings.sort((a, b) => a.chainM - b.chainM || a.id - b.id);
const clusters = [];
for (const c of crossings) {
  const cur = clusters[clusters.length - 1];
  if (cur && c.chainM - cur[cur.length - 1].chainM < 120) cur.push(c);
  else clusters.push([c]);
}
console.log('clusters:', clusters.length);

// Merge each cluster into one record per kind (outlines contribute names only).
// Name candidates must look like BRIDGE names: outline names, bridge:name
// tags, way names containing "bridge", or a bare motorway ref. Plain way
// names (road names, railway line names like "Waterloo to Reading Line")
// would mis-key the curated table, so they are never used.
function nameCandidates(members, outlines, meanChain) {
  const cands = [];
  for (const m of members) if (m.tags['bridge:name']) cands.push(m.tags['bridge:name']);
  // Outlines are shared across the cluster; only borrow ones that cross
  // within 50 m of this record. Twickenham road and Richmond rail sit 68 m
  // apart in one cluster: a looser threshold leaks the Twickenham outline
  // name onto the rail record (Richmond rail resolves via nearBng instead).
  for (const o of outlines) {
    if (o.name && Math.abs(o.chainM - meanChain) < 50) cands.push(o.name);
  }
  for (const m of members) if (m.name && /bridge/i.test(m.name)) cands.push(m.name);
  for (const m of members) {
    if (!m.name && m.tags.ref && /^(motorway|trunk)$/.test(m.tags.highway || '')) cands.push(m.tags.ref);
  }
  return [...new Set(cands)];
}

function curatedFor(cands, point, footOnly) {
  const pool = footOnly ? CURATED.filter((c) => c.foot) : CURATED;
  for (const c of pool) {
    for (const cand of cands) {
      if (c.match.test(cand) || c.match.test(normName(cand))) return c;
    }
  }
  // Location fallback for structures OSM leaves unnamed (rail bridges whose
  // ways carry only the line name, the ref-less M3 viaduct sections).
  if (!cands.length && point) {
    for (const c of pool) {
      if (c.nearBng && Math.hypot(c.nearBng.e - point.e, c.nearBng.n - point.n) < 400) return c;
    }
  }
  return null;
}

const records = [];
const judgementCalls = [];
for (const cluster of clusters) {
  const outlines = cluster.filter((c) => c.kind === 'outline');
  const byKind = { road: [], rail: [], foot: [] };
  for (const c of cluster) if (byKind[c.kind]) byKind[c.kind].push(c);

  const meanChainOf = (members) => members.reduce((s, m) => s + m.chainM, 0) / members.length;
  const clusterRecords = [];
  let footConsumed = false;

  for (const kind of ['road', 'rail', 'foot']) {
    const members = byKind[kind];
    if (!members.length) continue;
    const meanChain = meanChainOf(members);
    const cands = nameCandidates(members, outlines, meanChain);
    const point = members[0].point;

    if (kind === 'foot') {
      // Curated footbridges (Teddington, Richmond Lock, Golden Jubilee,
      // Millennium) become records. A foot-ONLY cluster matching any curated
      // entry is a closed-to-traffic road bridge (Hammersmith). Everything
      // else is a lock or weir walkway, or a road/rail bridge pavement:
      // excluded.
      const footCurated = curatedFor(cands, point, true);
      if (footCurated) {
        clusterRecords.push({ kind: 'foot', members, curated: footCurated, name: footCurated.name });
        footConsumed = true;
        continue;
      }
      if (!byKind.road.length && !byKind.rail.length) {
        const general = curatedFor(cands, point, false);
        if (general) {
          clusterRecords.push({ kind: general.kind || 'foot', members, curated: general, name: general.name });
          judgementCalls.push(`"${general.name}" is foot-tagged in OSM (closed to motor traffic); kept as kind "${general.kind || 'foot'}" per curated table`);
        } else {
          judgementCalls.push(`dropped foot-only crossing at chain ${Math.round(meanChain)}m (${cands[0] || 'unnamed'}) - minor walkway`);
        }
      }
      continue;
    }
    const curated = curatedFor(cands, point, false);
    clusterRecords.push({ kind, members, curated, name: curated ? curated.name : (cands[0] || null) });
  }
  if (!clusterRecords.length) continue;

  for (const r of clusterRecords) {
    const chainM = meanChainOf(r.members);
    const at = pointAtChain(chainM);
    // rail+foot: a walkway bolted to the rail structure itself (Fulham,
    // Barnes). Foot ways qualify only if they crossed within 40 m of the
    // rail crossing, were not consumed by a curated foot record (Golden
    // Jubilee), and are not the pavements of a nearer road record.
    let kind = r.kind;
    if (kind === 'rail' && !footConsumed && byKind.foot.length) {
      const roadChain = byKind.road.length ? meanChainOf(byKind.road) : null;
      const attached = byKind.foot.some((f) => {
        const dRail = Math.abs(f.chainM - chainM);
        return dRail < 40 && (roadChain === null || dRail < Math.abs(f.chainM - roadChain));
      });
      if (attached) kind = 'rail+foot';
    }
    r.finalKind = kind;
    // Axis bearing from the longest crossing member (most representative of
    // the deck), centred on the centreline point at the crossing chainage.
    const longest = r.members.reduce((a, b) => (b.lengthM > a.lengthM ? b : a));
    const spanM = Math.round(at.w);
    const overshoot = Math.max(30, spanM * 0.15);
    const half = spanM / 2 + overshoot;
    let d = longest.dir;
    // Orient a -> b so that a is the southern-ish end (deterministic).
    if (d.n > 0 || (d.n === 0 && d.e < 0)) d = { e: -d.e, n: -d.n };
    const a = { e: Math.round(at.e + d.e * half), n: Math.round(at.n + d.n * half) };
    const b = { e: Math.round(at.e - d.e * half), n: Math.round(at.n - d.n * half) };
    const bearingDeg = Math.round(((Math.atan2(b.e - a.e, b.n - a.n) * 180) / Math.PI + 360) % 360);

    // Deck width: curated override > widest OSM member > kind default.
    const osmWidth = Math.max(0, ...r.members.map((m) => m.widthM || 0));
    const deckWidthM = r.curated?.deckWidthM ?? (osmWidth >= 3 ? Math.round(osmWidth * 10) / 10 : KIND_DEFAULT_DECK[kind] ?? KIND_DEFAULT_DECK[r.kind]);

    // Archetype: curated first, then OSM bridge:structure, then default.
    let archetype = r.curated?.archetype || null;
    if (!archetype) {
      const bs = r.members.map((m) => m.tags['bridge:structure']).find(Boolean);
      if (bs === 'suspension') archetype = 'suspension';
      else if (bs === 'arch') archetype = 'arch';
      else if (bs === 'cable-stayed') archetype = 'cable-stayed';
      else archetype = 'beam-girder';
      judgementCalls.push(`archetype defaulted (${archetype}) for "${r.name || 'unnamed'}" at chain ${Math.round(chainM)}m - not in curated table`);
    }

    records.push({
      name: r.name || `Unnamed ${kind} bridge`,
      kind,
      archetype,
      group: null, // assigned in the post-pass below
      curatedSlug: r.curated ? r.curated.slug : null,
      chainM: Math.round(chainM),
      axis: { a, b, bearingDeg },
      deckWidthM,
      spanM,
      clearanceM: r.curated?.clearanceM ?? ARCHETYPE_DEFAULT_CLEARANCE[kind] ?? 6,
      source: {
        osmWayIds: r.members.map((m) => m.id).sort((x, y) => x - y),
        nameFrom: r.curated ? 'curated' : 'osm',
      },
    });
  }
}

records.sort((a, b) => a.chainM - b.chainM || a.name.localeCompare(b.name));

// Group post-pass: parallel structures of one crossing (Hungerford rail +
// Golden Jubilee walkways) sit within 50 m of each other; they share a group
// slug taken from the first record. Distinct adjacent bridges (Blackfriars
// road vs rail, ~75 m) stay ungrouped.
for (let i = 1; i < records.length; i++) {
  const a = records[i - 1], b = records[i];
  if (b.chainM - a.chainM < 50 && a.name !== b.name) {
    const slug = (a.group) || a.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').replace(/-(bridge|bridges)$/, '');
    a.group = slug;
    b.group = slug;
  }
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------
let failures = 0;
console.log('\n=== VALIDATION ===');

// 1. chainM strictly increasing (ties/near-duplicates allowed only within a group).
let dedupeFails = 0;
for (let i = 1; i < records.length; i++) {
  const a = records[i - 1], b = records[i];
  if (b.chainM - a.chainM < 50 && (a.group === null || a.group !== b.group)) {
    console.error(`FAIL near-duplicate: "${a.name}" and "${b.name}" ${b.chainM - a.chainM}m apart without shared group`);
    dedupeFails++;
    failures++;
  }
  if (b.chainM - a.chainM < 50 && a.name === b.name) {
    console.error(`FAIL duplicate record: "${a.name}" appears twice within 50m`);
    dedupeFails++;
    failures++;
  }
}
console.log('chainage monotonic + 50m dedupe rule:', dedupeFails === 0 ? 'PASS' : 'CHECK ABOVE');

// 1b. Every curated slug appears at most once; the full curated set is the
// expected census of named crossings, so report any that are missing.
const slugCount = new Map();
for (const r of records) if (r.curatedSlug) slugCount.set(r.curatedSlug, (slugCount.get(r.curatedSlug) || 0) + 1);
for (const [slug, n] of slugCount) {
  if (n > 1) { console.error(`FAIL curated slug "${slug}" matched ${n} records`); failures++; }
}
const missing = CURATED.filter((c) => !slugCount.has(c.slug));
if (missing.length) {
  console.error('FAIL curated bridges missing from output:', missing.map((c) => c.slug).join(', '));
  failures++;
} else {
  console.log(`curated census: all ${CURATED.length} expected bridges present exactly once: PASS`);
}

// 2. Every axis must cross the centreline.
let axisFails = 0;
for (const r of records) {
  let crosses = false;
  for (let j = 1; j < extLine.length && !crosses; j++) {
    if (segInt(r.axis.a, r.axis.b, extLine[j - 1], extLine[j])) crosses = true;
  }
  if (!crosses) {
    console.error(`FAIL axis does not cross centreline: ${r.name}`);
    axisFails++;
    failures++;
  }
}
console.log(`axis-crosses-centreline: ${records.length - axisFails}/${records.length}`, axisFails === 0 ? 'PASS' : 'FAIL');

// 3. Count sanity.
console.log(`count: ${records.length} (plausible band 35-45 named Thames crossings inside the M25)`);
if (records.length < 35 || records.length > 45) {
  console.error('FAIL count outside plausible band');
  failures++;
}

// 4. Anchor cross-checks: chainM of known bridges against the chainage of
// their known real-world BNG position projected onto the centreline.
// NOTE: the THAMES_ZONES chainage bands in src/thames-zones.js are NOT used
// here - probing them shows the zone boundaries are inconsistent with the
// current thames.json centreline (Tower Bridge projects to ~63.9km but the
// Pool of London band is 53.1-57.0km). That is a pre-existing zone-table
// issue, not a bridges issue; flagged in the 11Jul26s session summary.
function chainOfBng(E, N) {
  let bd = Infinity, bc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const de = b.e - a.e, dn = b.n - a.n, L2 = de * de + dn * dn || 1;
    let t = ((E - a.e) * de + (N - a.n) * dn) / L2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(E - (a.e + t * de), N - (a.n + t * dn));
    if (d < bd) { bd = d; bc = chain[i - 1] + t * Math.hypot(de, dn); }
  }
  return bc;
}
const anchors = [
  { name: /^Teddington/, e: 516720, n: 171450, label: 'Teddington Lock' },
  { name: /^Hammersmith Bridge/, e: 522980, n: 178330, label: 'Hammersmith Bridge' },
  { name: /^Tower Bridge/, e: 533600, n: 180150, label: 'Tower Bridge' },
  { name: /^Queen Elizabeth II/, e: 557125, n: 176391, label: 'QE2 Dartford' },
];
for (const a of anchors) {
  const r = records.find((x) => a.name.test(x.name));
  if (!r) { console.error(`FAIL anchor missing: ${a.label}`); failures++; continue; }
  const expect = Math.round(chainOfBng(a.e, a.n));
  const diff = Math.abs(r.chainM - expect);
  console.log(`anchor ${a.label}: record @ ${r.chainM}m vs known position @ ${expect}m (diff ${diff}m):`, diff < 500 ? 'PASS' : 'FAIL');
  if (diff >= 500) failures++;
}
// West-to-east order of a canonical landmark sequence.
const orderCheck = ['hampton-court', 'kingston', 'richmond', 'kew', 'hammersmith', 'putney', 'battersea', 'westminster', 'tower', 'qe2'];
const orderIdx = orderCheck.map((s) => records.findIndex((r) => r.curatedSlug === s));
const orderOk = orderIdx.every((v, i) => v >= 0 && (i === 0 || v > orderIdx[i - 1]));
console.log('canonical west-to-east landmark order:', orderOk ? 'PASS' : 'FAIL ' + JSON.stringify(orderIdx));
if (!orderOk) failures++;

// West-to-east listing.
console.log('\n=== BRIDGES WEST -> EAST ===');
for (const r of records) {
  console.log(
    String(r.chainM).padStart(6) + 'm  ' +
    r.name.padEnd(34) +
    r.kind.padEnd(11) +
    r.archetype.padEnd(13) +
    `span ${String(r.spanM).padStart(4)}m  clr ${r.clearanceM}m` +
    (r.group ? `  [${r.group}]` : '')
  );
}

if (judgementCalls.length) {
  console.log('\n=== JUDGEMENT CALLS ===');
  for (const j of judgementCalls) console.log('-', j);
}

if (failures) {
  console.error(`\n${failures} validation failure(s) - NOT writing output`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------
const out = {
  name: 'Thames bridges',
  source: 'OSM bridge ways crossing the thames.json centreline (Overpass, cached in scripts/.cache/); archetypes, canonical names and clearances from curated table per D-019 (coherent and recognisable, not survey-accurate)',
  crs: 'EPSG:27700',
  description: 'Bridge crossings of the River Thames inside the M25, west to east. chainM is metres along the thames.json centreline (same datum as THAMES_ZONES). Axis endpoints are BNG; convert to scene via x = e - ' + ORIGIN_E + ', z = -(n - ' + ORIGIN_N + ').',
  // Dated from the cached Overpass snapshot, not the run time, so reruns
  // against the same cache are byte-identical (deterministic).
  osmSnapshot: (osm.osm3s && osm.osm3s.timestamp_osm_base) || null,
  count: records.length,
  bridges: records,
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log('\nwrote', OUT_FILE, '-', records.length, 'bridges');
