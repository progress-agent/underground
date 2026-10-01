// Open-air Tube and DLR track the Prog v2 delivery lacks, from OpenStreetMap
// (sprint 01Oct26h, D-043 item 4, Lane R).
//
// The v2 delivery (Working/prog-rail-geometry-11Jul26s/v2/tube-surface-sections.json)
// has no track for the Central's Ealing Broadway branch and Hainault loop, the
// Metropolitan from Harrow-on-the-Hill to Rayners Lane, the DLR's last stretch
// into Stratford and the last metres to the buffers at Watford, Epping and
// Lewisham. This script fetches the railway ways of those places, with the
// route relations they belong to, in one Overpass query in the style of
// scripts/fetch-bridges.mjs (cached under scripts/.cache/, rerunnable offline),
// and turns them into trails in the v2 schema ({points: [[lon,lat]...],
// segments: [{i0,i1,class}]}) that scripts/prepare-tube-surface.mjs merges
// with the v2 trails through the same builder.
//
// Which ways: a way is a line's track when one of that line's route relations
// (route=subway or light_rail, matched by name) lists it with a track role,
// exactly the selection pipeline-v2.py makes; ways are then clipped to the
// place's box and stitched into trails through nodes where exactly two way
// ends meet (pipeline-v2.py stitch_branches). Classes come from the OSM tags by
// pipeline-v2.py's earthworks_class, unchanged: tunnel (tunnel=* or
// covered=yes), viaduct (bridge=* or layer > 0), embankment, cutting, else
// surface.
//
// Usage: node scripts/fetch-tube-surface-osm.mjs [--refresh]
//   --refresh forces a new Overpass fetch (otherwise the cache is used).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_FILE = path.join(SCRIPT_DIR, '.cache', 'tube-surface-osm-overpass.json');
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ROUNDS = 6; // the public servers answer 504 "too busy" at times: try again after a pause

/**
 * The places, as boxes [south, west, north, east] (WGS84). `lines` are the
 * app's line ids whose track is taken from the box; `relation` matches the
 * line's route relations by name.
 */
export const PLACES = {
  'central-ealing': { lines: ['central'], box: [51.5060, -0.3100, 51.5300, -0.2550], note: 'North Acton, West Acton, Ealing Broadway' },
  'central-hainault': { lines: ['central'], box: [51.5600, 0.0000, 51.6250, 0.1050], note: 'Leytonstone to Woodford via Newbury Park and Hainault' },
  'central-epping': { lines: ['central'], box: [51.6650, 0.0950, 51.7000, 0.1220], note: 'Theydon Bois to the Epping buffers' },
  'metropolitan-west-harrow': { lines: ['metropolitan'], box: [51.5700, -0.3800, 51.5850, -0.3300], note: 'Harrow-on-the-Hill, West Harrow, Rayners Lane' },
  'metropolitan-watford': { lines: ['metropolitan'], box: [51.6500, -0.4250, 51.6650, -0.4050], note: 'the Watford buffers' },
  'dlr-stratford': { lines: ['dlr'], box: [51.5330, -0.0160, 51.5480, 0.0030], note: 'Pudding Mill Lane into Stratford' },
  'dlr-lewisham': { lines: ['dlr'], box: [51.4590, -0.0220, 51.4710, -0.0080], note: 'Elverson Road to the Lewisham buffers' },
  // Diagnosis only (the classes at stations the last sprint left without a
  // surface marker); nothing from these boxes is merged unless a gap rule
  // in prepare-tube-surface.mjs asks for it.
  'dlr-greenwich': { lines: ['dlr'], box: [51.4740, -0.0200, 51.4840, -0.0060], diagnosis: true },
  'metropolitan-preston-road': { lines: ['metropolitan', 'jubilee'], box: [51.5670, -0.3020, 51.5770, -0.2880], diagnosis: true },
  'jubilee-wembley-park': { lines: ['metropolitan', 'jubilee'], box: [51.5570, -0.2870, 51.5680, -0.2700], diagnosis: true },
  'jubilee-west-hampstead': { lines: ['jubilee', 'metropolitan'], box: [51.5420, -0.2020, 51.5510, -0.1800], diagnosis: true },
  'piccadilly-hatton-cross': { lines: ['piccadilly'], box: [51.4600, -0.4400, 51.4730, -0.4050], diagnosis: true },
  'dlr-tower-gateway': { lines: ['dlr'], box: [51.5070, -0.0820, 51.5140, -0.0660], diagnosis: true },
};

/** Route relation names per app line id (case-insensitive). */
/** Route relation names per app line id: the service variants ("Central line:
 * Ealing Broadway → Hainault", "DLR: Stratford → Lewisham"), never the
 * "Central Line (sidings and rails between switches)" relation, whose depot
 * and siding tracks are not running lines. */
export const RELATION_NAME = {
  central: /^central line:/i, metropolitan: /^metropolitan line:/i, jubilee: /^jubilee line:/i, piccadilly: /^piccadilly line:/i,
  dlr: /^dlr:/i,
};
const TRACK_ROLES = new Set(['', 'track', 'forward', 'backward', 'outer', 'inner']);
const TRACK_RAILWAY = new Set(['rail', 'subway', 'light_rail']);

export function buildQuery(places = PLACES) {
  const boxes = Object.values(places).map(p => `(${p.box.join(',')})`);
  return `[out:json][timeout:90];
(
${boxes.map(b => `  way["railway"~"^(subway|light_rail|rail)$"]${b};`).join('\n')}
)->.w;
.w out body geom;
rel(bw.w)["route"~"^(subway|light_rail|train)$"];
out body;
`;
}

export async function fetchOverpass({ refresh = false, cacheFile = CACHE_FILE } = {}) {
  if (!refresh && existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));
  const query = buildQuery();
  const json = await overpass(query);
  json.query = query; // what was asked, kept with the answer
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(json));
  console.log('cached', json.elements.length, 'elements to', cacheFile);
  return json;
}

/** POST a query to the public Overpass servers, rounds of retries (they answer 504 when busy). */
export async function overpass(query) {
  let lastErr;
  for (let round = 0; round < ROUNDS; round++) for (const url of OVERPASS_URLS) {
    if (round || url !== OVERPASS_URLS[0]) await new Promise(r => setTimeout(r, 1000 * Math.min(60, 10 * (round + 1))));
    try {
      console.log('fetching Overpass:', url);
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // overpass-api.de answers 406 to UA-less requests; identify ourselves
          'User-Agent': 'underground-tube-surface/1.0 (https://github.com/progress-agent/underground)',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn('overpass mirror failed:', e.message);
    }
  }
  throw lastErr;
}

/** pipeline-v2.py earthworks_class, unchanged. */
export function earthworksClass(tags = {}) {
  const yes = v => v !== undefined && v !== null && v !== '' && v !== 'no' && v !== '0';
  if (yes(tags.tunnel)) return 'tunnel';
  if (tags.covered === 'yes') return 'tunnel';
  const layer = Number.parseInt(tags.layer ?? '0', 10) || 0;
  if (yes(tags.bridge)) return 'viaduct';
  if (layer > 0) return 'viaduct';
  if (yes(tags.embankment)) return 'embankment';
  if (yes(tags.cutting)) return 'cutting';
  return 'surface';
}

const inBox = ([lon, lat], [s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e;

/**
 * The ways of `lineId` in the Overpass answer: members with a track role of
 * any route relation whose name matches, railway in TRACK_RAILWAY. Returns
 * Map wayId -> {id, nodes, coords [[lon,lat]], tags, cls, relations}.
 */
export function lineWays(osm, lineId) {
  const ways = new Map(osm.elements.filter(e => e.type === 'way').map(w => [w.id, w]));
  const out = new Map();
  for (const r of osm.elements) {
    if (r.type !== 'relation' || !RELATION_NAME[lineId]?.test(r.tags?.name ?? '')) continue;
    for (const m of r.members || []) {
      if (m.type !== 'way' || !TRACK_ROLES.has(m.role ?? '')) continue;
      const w = ways.get(m.ref);
      if (!w || !TRACK_RAILWAY.has(w.tags?.railway)) continue;
      if (!out.has(w.id)) out.set(w.id, { id: w.id, nodes: w.nodes, coords: w.geometry.map(g => [g.lon, g.lat]), tags: w.tags, cls: earthworksClass(w.tags), relations: [] });
      out.get(w.id).relations.push(r.id);
    }
  }
  return out;
}

/**
 * Clip a way to a box: the runs of consecutive nodes inside it (a run keeps
 * its node ids), each at least two nodes long.
 */
export function clipWay(way, box) {
  const runs = [];
  let cur = null;
  way.coords.forEach((c, i) => {
    if (inBox(c, box)) { if (!cur) { cur = { nodes: [], coords: [] }; runs.push(cur); } cur.nodes.push(way.nodes[i]); cur.coords.push(c); }
    else cur = null;
  });
  return runs.filter(r => r.coords.length >= 2).map((r, k) => ({ ...way, id: `${way.id}${runs.length > 1 ? `#${k}` : ''}`, osmId: way.id, nodes: r.nodes, coords: r.coords }));
}

/**
 * pipeline-v2.py stitch_branches: maximal non-branching trails. A trail
 * extends through a node only where exactly two way ends meet and the node is
 * interior to no other way. Points [lon,lat]; segments per source segment
 * (run-length encoded {i0,i1,class}); osmWays lists the ways in order.
 */
export function stitchTrails(ways) {
  const list = [...ways];
  const ends = new Map(), interior = new Set();
  for (const w of list) {
    for (const n of [w.nodes[0], w.nodes.at(-1)]) { if (!ends.has(n)) ends.set(n, []); ends.get(n).push(w); }
    for (const n of w.nodes.slice(1, -1)) interior.add(n);
  }
  const junction = n => (ends.get(n)?.length ?? 0) > 2 || (interior.has(n) && (ends.get(n)?.length ?? 0) >= 1);
  const used = new Set();
  const next = n => { if (junction(n)) return null; const c = (ends.get(n) || []).filter(w => !used.has(w)); return c.length === 1 ? c[0] : null; };
  const orient = (w, from) => w.nodes[0] === from ? { coords: w.coords, exit: w.nodes.at(-1) } : { coords: [...w.coords].reverse(), exit: w.nodes[0] };
  const trails = [];
  for (const seed of list) {
    if (used.has(seed)) continue;
    used.add(seed);
    const legs = [{ coords: seed.coords, w: seed }];
    let node = seed.nodes.at(-1);
    for (let w = next(node); w; w = next(node)) { used.add(w); const o = orient(w, node); legs.push({ coords: o.coords, w }); node = o.exit; }
    const back = [];
    node = seed.nodes[0];
    for (let w = next(node); w; w = next(node)) { used.add(w); const o = orient(w, node); back.push({ coords: [...o.coords].reverse(), w }); node = o.exit; }
    const all = [...back.reverse(), ...legs];
    const points = [], cls = [], osmWays = [];
    for (const { coords, w } of all) {
      const start = points.length ? 1 : 0; // shared node with the previous leg
      for (let i = start; i < coords.length; i++) {
        if (points.length) cls.push(w.cls);
        points.push(coords[i]);
      }
      osmWays.push(w.osmId ?? w.id);
    }
    if (points.length >= 2) trails.push({ points, cls, osmWays });
  }
  return trails;
}

/** Run-length encode per-segment classes into {i0,i1,class}. */
export function encodeClasses(cls) {
  const out = [];
  for (let i = 0; i < cls.length; i++) {
    if (out.length && out.at(-1).class === cls[i] && out.at(-1).i1 === i) out.at(-1).i1 = i + 1;
    else out.push({ i0: i, i1: i + 1, class: cls[i] });
  }
  return out;
}

/**
 * Trails for one place: the line's ways inside its box, stitched. With
 * `exclude` (other line ids), ways that also belong to one of those lines'
 * relations are left out (shared track is that line's).
 */
export function placeTrails(osm, placeKey, lineId, { exclude = [] } = {}) {
  const place = PLACES[placeKey];
  const ways = lineWays(osm, lineId);
  const others = new Set(exclude.flatMap(l => [...lineWays(osm, l).keys()]));
  const clipped = [...ways.values()].filter(w => !others.has(w.id)).flatMap(w => clipWay(w, place.box));
  return stitchTrails(clipped).map(t => ({ points: t.points, segments: encodeClasses(t.cls), source: 'osm', place: placeKey, osmWays: t.osmWays }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const osm = await fetchOverpass({ refresh: process.argv.includes('--refresh') });
  const ways = osm.elements.filter(e => e.type === 'way').length, rels = osm.elements.filter(e => e.type === 'relation');
  console.log(`${ways} ways, ${rels.length} route relations: ${[...new Set(rels.map(r => r.tags?.name))].sort().join(' | ')}`);
  for (const [key, place] of Object.entries(PLACES)) for (const lineId of place.lines) {
    const t = placeTrails(osm, key, lineId);
    const len = t.reduce((s, tr) => s + tr.points.length, 0);
    console.log(`${key.padEnd(28)} ${lineId.padEnd(13)} ${t.length} trails, ${len} points; classes ${[...new Set(t.flatMap(tr => tr.segments.map(s => s.class)))].join(',')}`);
  }
}
