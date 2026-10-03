#!/usr/bin/env node
// Station-building compiler (sprint 02Oct26f, lane B; D-048 items 2 to 4).
//
// Turns a pinned Overpass answer and the baked map payload into
// public/data/station-buildings.json: for every station SITE (a distinct
// cleanStationName over the sources the app reads) one building record, either
// the real OpenStreetMap building in its true outline or a standard pavilion,
// with its height, its roundels and its street-exit pose. The rules are the
// ones in Working/sprint-02Oct26f/B/design.md sections 1 to 4 and 6.
//
// Run: node scripts/prepare-station-buildings.mjs [--out <file>] [--review <file> | --no-review] [--refetch]
//
// DETERMINISTIC: two runs write byte-identical files. The Overpass answer is a
// pinned cache (scripts/.cache/station-buildings-overpass.json, untracked and
// rsynced like the surface store); any other sha256 is refused unless
// --refetch. The baked store (public/data/surface/baked/buildings.bin) is only
// read, never written.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
import { cleanStationName } from '../src/stations.js';
import { cleanName } from '../src/modes/pedestrian-tunnels.js';
import { siteKeyOf } from '../src/station-buildings.js';
import { ROUNDEL } from '../src/platform-tunnel.js';
import { initThamesMask, isInThames } from '../src/thames-mask.js';
import { LANDMARKS } from './landmarks.mjs';
import {
  orient, ringArea, centroid, bounds, pointInRing, nearestOnRing, distToRing, nearestOnSegment, simplifyRing, edgeNormal,
  minAreaRect, labelPoint, rectRing, convexOverlap, boxRing, createFootprintGrid, yawFacing,
} from '../src/station-building-geometry.js';

const ROOT = path.resolve(import.meta.dirname, '..');
export const PINNED_SHA256 = '884400d1e7da4b2be6ad3e9591721e3de5d8e5d22c33b45f17bdfb64ec1c0ed2';
export const OVERPASS_FILE = path.join(ROOT, 'scripts/.cache/station-buildings-overpass.json');
export const DEFAULT_OUT = path.join(ROOT, 'public/data/station-buildings.json');
export const DEFAULT_REVIEW = '/Users/macstudio_1/Wisdom/WORK/PROJECTS/UnderGround/Working/sprint-02Oct26f/B/assignments-review.md';
const OVERPASS_QUERY = `[out:json][timeout:240];
(
  way["building"="train_station"](51.25,-0.65,51.75,0.35);
  relation["building"="train_station"](51.25,-0.65,51.75,0.35);
  way["railway"="station"](51.25,-0.65,51.75,0.35);
  relation["railway"="station"](51.25,-0.65,51.75,0.35);
  way["public_transport"="station"](51.25,-0.65,51.75,0.35);
  relation["public_transport"="station"](51.25,-0.65,51.75,0.35);
  node["railway"="subway_entrance"](51.25,-0.65,51.75,0.35);
  node["railway"="train_station_entrance"](51.25,-0.65,51.75,0.35);
);
out tags geom;
`;

// ── Constants of the design ───────────────────────────────────────────────
export const RULES = Object.freeze({
  minBuildingAreaM2: 80, bigAreaM2: 5000, nameRadiusM: 150, nameFarRadiusM: 400, distRadiusM: 150, distLowConfM: 60, distMinAreaM2: 200,
  thamesFraction: 0.1, heightMin: 6, heightMax: 30, heightDefault: 10,
  smallPickM2: 200, riseClearM: 4, pavilion: { w: 16, d: 12, h: 7 }, placementClearM: 1.5, viaductOffsetM: 12.5, viaductMinDeckM: 4.5,
  frontMinM: 6, frontProbeM: 3, boxClearM: 0.5, exitOutM: 6,
  roundel: { wallFrac: 0.8, wallMaxD: 12, fitFrac: 0.85, roofShortFrac: 0.6, roofEdgeFrac: 1.8, roofMaxD: 80, proud: 0.05, maxPerFront: 6, maxPerBuilding: 32 },
});
const TERRAIN_BNG = [490000, 151093.75, 560000, 205000]; // [minE, minN, maxE, maxN], the terrain grid
const NETS = ['dlr', 'og', 'tube'];
const TOKEN_DROP = /\b(underground|dlr|rail|railway|overground|tube|station|stations|london|international|the|main|line|entrance|for)\b/g;
const EXCLUDED_BUILDING = new Set(['roof', 'bus_station', 'bus_garage', 'stand', 'no']);

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

export { siteKeyOf };
export const nameTokens = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/\bst\./g, 'st ')
  .replace(/['’]/g, '').replace(TOKEN_DROP, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const contains = (big, small) => small.length > 0 && small.every(t => big.includes(t));

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
export function llToXZ(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return [e - BNG_REF_E, -(n - BNG_REF_N)];
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── Sources ───────────────────────────────────────────────────────────────

/** The sites: one per distinct cleaned name over the TfL route sequences, the DLR profile and overground.json. */
export async function loadSites(root = ROOT) {
  const sites = new Map();
  const add = (raw, lat, lon, net, line) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const name = cleanStationName(raw), key = siteKeyOf(raw);
    let s = sites.get(key);
    if (!s) sites.set(key, s = { key, name, pts: [], nets: new Set(), raw: new Set(), lines: new Set(), dlrKind: null });
    else if (s.name !== name) throw new Error(`site key ${key} is shared by two names: ${s.name} and ${name}`);
    s.pts.push([lat, lon]); s.nets.add(net); s.raw.add(raw); s.lines.add(line);
  };
  const dir = path.join(root, 'public/data/tfl/route-sequence');
  for (const f of (await readdir(dir)).sort()) {
    if (f === 'index.json') continue;
    const d = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    const net = d.lineId === 'dlr' ? 'dlr' : 'tube';
    for (const seq of d.stopPointSequences || []) for (const st of seq.stopPoint || []) add(st.name, st.lat, st.lon, net, d.lineId);
  }
  const dlr = JSON.parse(await readFile(path.join(root, 'src/dlr-profile-data.json'), 'utf8')).stations;
  const dlrKind = new Map();
  for (const s of Object.values(dlr)) { add(s.name, s.lat, s.lon, 'dlr', 'dlr'); dlrKind.set(siteKeyOf(s.name), s.kind); }
  const og = JSON.parse(await readFile(path.join(root, 'public/data/overground.json'), 'utf8'));
  for (const l of og.lines) for (const st of l.stations) add(st.name, st.lat, st.lon, 'og', l.id);
  for (const s of sites.values()) {
    s.p = llToXZ(s.pts.reduce((a, p) => a + p[0], 0) / s.pts.length, s.pts.reduce((a, p) => a + p[1], 0) / s.pts.length);
    s.dlrKind = dlrKind.get(s.key) ?? null;
    s.toks = nameTokens(s.name);
  }
  return sites;
}

/** The drawn DLR track (tube-surface.json), as projected polylines: the centreline a viaduct pavilion stands beside. */
export async function loadDlrTrack(root = ROOT) {
  const d = JSON.parse(await readFile(path.join(root, 'public/data/tube-surface.json'), 'utf8'));
  const line = d.lines.find(l => l.id === 'dlr');
  return (line?.branches || []).map(b => (b.points || []).map(([lon, lat]) => llToXZ(lat, lon))).filter(p => p.length >= 2);
}

/** The baked boxes within `reach` metres of any point (x, z, h, side, base: metres), plus the payload hash. */
export async function loadBakedBoxes(points, reach = 700, root = ROOT) {
  const file = path.join(root, 'public/data/surface/baked/buildings.bin');
  const buf = await readFile(file);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint32(0, true) !== 0x31424755) throw new Error('buildings.bin is not UGB1');
  const tiles = v.getUint16(6, true);
  const cell = 256, wanted = new Set();
  const nc = Math.ceil(reach / cell);
  for (const [x, z] of points) {
    for (let i = -nc; i <= nc; i++) for (let j = -nc; j <= nc; j++) wanted.add(`${Math.floor(x / cell) + i},${Math.floor(z / cell) + j}`);
  }
  const boxes = [];
  for (let t = 0; t < tiles; t++) {
    const d = 12 + t * 16, minX = v.getInt32(d, true), minZ = v.getInt32(d + 4, true), off = v.getUint32(d + 8, true), cnt = v.getUint32(d + 12, true);
    for (let k = 0, o = off; k < cnt; k++, o += 10) {
      const x = minX + v.getUint16(o, true) * 0.1, z = minZ + v.getUint16(o + 2, true) * 0.1;
      if (!wanted.has(`${Math.floor(x / cell)},${Math.floor(z / cell)}`)) continue;
      boxes.push({ x, z, h: v.getUint16(o + 4, true) * 0.1, side: v.getUint16(o + 6, true) * 0.1, hidden: false });
    }
  }
  let meta = {};
  try { meta = JSON.parse(await readFile(path.join(root, 'public/data/surface/baked/meta.json'), 'utf8')); } catch { /* optional */ }
  return { boxes, payloadSha256: meta.payloadSha256 ?? sha256(buf), total: v.getUint32(8, true) };
}

function stitch(ways) {
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  const rings = [], segs = ways.map(w => w.slice()).filter(w => w.length >= 2);
  while (segs.length) {
    let cur = segs.shift(), guard = 0;
    while (!eq(cur[0], cur.at(-1)) && guard++ < 2000) {
      const end = cur.at(-1);
      let found = -1, rev = false;
      for (let i = 0; i < segs.length; i++) {
        if (eq(segs[i][0], end)) { found = i; break; }
        if (eq(segs[i].at(-1), end)) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let s = segs.splice(found, 1)[0];
      if (rev) s = s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur.length >= 4 && eq(cur[0], cur.at(-1))) rings.push(cur.slice(0, -1));
  }
  return rings;
}

/** Candidate buildings, other station-ish areas and entrance nodes from the Overpass answer, in scene metres. */
export function parseOverpass(answer) {
  const blds = [], areas = [], ents = [];
  for (const e of answer.elements) {
    const t = e.tags || {};
    if (e.type === 'node') { ents.push({ id: 'n' + e.id, p: llToXZ(e.lat, e.lon), name: t.name || '', toks: nameTokens(t.name) }); continue; }
    let rings;
    if (e.type === 'way') rings = e.geometry ? stitch([e.geometry.map(g => llToXZ(g.lat, g.lon))]) : [];
    else rings = stitch((e.members || []).filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(g => llToXZ(g.lat, g.lon))));
    if (!rings.length) continue;
    const ring = orient(rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a)));
    const rec = { id: e.type[0] + e.id, name: t.name || '', toks: nameTokens(t.name), ring, area: ringArea(ring), tags: t, bounds: bounds(ring) };
    const b = t.building;
    if (b && !EXCLUDED_BUILDING.has(b) && !/elizabeth|\bbus\b/i.test(rec.name)) blds.push(rec); else areas.push(rec);
  }
  blds.sort((a, b) => (a.id < b.id ? -1 : 1));
  areas.sort((a, b) => (a.id < b.id ? -1 : 1));
  ents.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { blds, areas, ents };
}

// ── The build ─────────────────────────────────────────────────────────────

/**
 * @param {{ sites: Map, overpass: object, boxes: object[], bakedSha: string, overpassSha: string, dlrTrack: number[][][],
 *           docks?: object[], inThames?: (x,z)=>boolean }} src
 * @returns {{ json: object, review: object[], counts: object, hidden: number }}
 */
export function compileStationBuildings({ sites, overpass, boxes, bakedSha, overpassSha, dlrTrack, docks = [], inThames = () => false, riseOf = null }) {
  const { blds, areas, ents } = parseOverpass(overpass);
  const R = RULES;
  const siteList = [...sites.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const review = [];
  const note = (site, kind, building, detail) => review.push({ site: site.name, key: site.key, kind, building: building?.id ?? '', bname: building?.name ?? '', ...detail });

  // Water: the Thames mask and the dock polygons.
  const inDock = (x, z) => docks.some(d => pointInRing(x, z, d.points));
  const inWater = (x, z) => inDock(x, z) || inThames(x, z);

  // Baked boxes: spatial grid, drawn squares.
  const boxGrid = createFootprintGrid(boxes.map(b => ({ ring: boxRing(b.x, b.z, b.side), box: b })), 32);
  const boxesInRing = (ring, b = bounds(ring)) => boxGrid.near(b.x0, b.z0, b.x1, b.z1).map(i => i.box)
    .filter(q => q.x >= b.x0 && q.x <= b.x1 && q.z >= b.z0 && q.z <= b.z1 && pointInRing(q.x, q.z, ring));

  // ── Sites to buildings (design section 1) ──
  const siteToks = new Map(siteList.map(s => [s.key, s.toks]));
  const nameMatch = (s, b) => b.toks.length > 0 && (contains(b.toks, s.toks) || (b.toks.length >= 2 && contains(s.toks, b.toks)));
  const namedForOther = (b) => siteList.some(s => nameMatch(s, b));
  const distOf = (s, b) => {
    if (s.p[0] < b.bounds.x0 - R.nameFarRadiusM || s.p[0] > b.bounds.x1 + R.nameFarRadiusM || s.p[1] < b.bounds.z0 - R.nameFarRadiusM || s.p[1] > b.bounds.z1 + R.nameFarRadiusM) return Infinity;
    return pointInRing(s.p[0], s.p[1], b.ring) ? 0 : nearestOnRing(s.p[0], s.p[1], b.ring).d;
  };
  const bigBuildings = blds.filter(b => b.area >= R.minBuildingAreaM2);

  const picks = new Map(); // site key -> { b, d, rule, low }
  for (const s of siteList) {
    const c = [];
    for (const b of bigBuildings) { const d = distOf(s, b); if (d <= R.nameFarRadiusM) c.push({ b, d }); }
    let named = c.filter(x => nameMatch(s, x.b) && x.d <= R.nameRadiusM);
    let rule = 'name';
    if (!named.length) { named = c.filter(x => contains(x.b.toks, s.toks)); }
    named.sort((a, b) => ((b.b.area >= R.bigAreaM2) - (a.b.area >= R.bigAreaM2)) || (a.d - b.d) || (b.b.area - a.b.area) || (a.b.id < b.b.id ? -1 : 1));
    if (named.length) { picks.set(s.key, { ...named[0], rule, low: named[0].d > R.nameRadiusM }); continue; }
    // A small unnamed building cannot stand for an interchange or a hub (Bank's 99 m2 kiosk): non-name picks
    // under 200 m2 are for single-network stations of at most two lines only.
    const hub = s.nets.size >= 2 || s.lines.size >= 3;
    const free = c.filter(x => (!namedForOther(x.b) || nameMatch(s, x.b)) && !(hub && x.b.area < R.smallPickM2));
    const cont = free.filter(x => x.d === 0).sort((a, b) => (b.b.area - a.b.area) || (a.b.id < b.b.id ? -1 : 1));
    if (cont.length) { picks.set(s.key, { ...cont[0], rule: 'containment', low: false }); continue; }
    const near = free.filter(x => x.d <= R.distRadiusM).sort((a, b) => (a.d - b.d) || (a.b.id < b.b.id ? -1 : 1));
    if (near.length && (near[0].d <= R.distLowConfM || near[0].b.area >= R.distMinAreaM2)) {
      picks.set(s.key, { ...near[0], rule: 'distance', low: near[0].d > R.distLowConfM });
    }
  }

  // ── Overrides by rule: landmarks and the river ──
  const substituted = new Map(); // site key -> reason
  for (const [key, p] of [...picks]) {
    const s = sites.get(key), b = p.b;
    const [cx, cz] = centroid(b.ring);
    const lm = LANDMARKS.find(L => Math.hypot(cx - L.x, cz - L.z) <= L.suppressRadiusM);
    if (lm) { picks.delete(key); substituted.set(key, `landmark ${lm.id}`); note(s, 'landmark substitution', b, { detail: `centroid inside the ${lm.name} disc` }); continue; }
    const overl = LANDMARKS.find(L => distToRing(L.x, L.z, b.ring) <= L.suppressRadiusM);
    if (overl) p.flag = `landmark-overlap:${overl.id}`;
    // Thames: more than 10 % of the area (5 m sample grid) in the river or a dock.
    const bb = b.bounds;
    let n = 0, wet = 0;
    for (let x = bb.x0 + 2.5; x < bb.x1; x += 5) for (let z = bb.z0 + 2.5; z < bb.z1; z += 5) {
      if (!pointInRing(x, z, b.ring)) continue;
      n++; if (inWater(x, z)) wet++;
    }
    if (n && wet / n > R.thamesFraction) { picks.delete(key); substituted.set(key, 'thames'); note(s, 'river substitution', b, { detail: `${(100 * wet / n).toFixed(0)} % of the outline is in the Thames or a dock` }); }
  }

  // ── Footprints (outlines) ──
  /** @type {Map<string, object>} building id -> building record under construction */
  const buildingsById = new Map();
  const outlineOf = new Map(); // osm id -> building record
  for (const [key, p] of picks) {
    const s = sites.get(key);
    let rec = outlineOf.get(p.b.id);
    if (!rec) {
      const simp = simplifyRing(p.b.ring);
      rec = { key: p.b.id, kind: 'outline', osm: p.b, outline: orient(simp.length >= 3 ? simp : p.b.ring), sites: [], flags: new Set() };
      outlineOf.set(p.b.id, rec); buildingsById.set(rec.key, rec);
    }
    rec.sites.push(s);
    if (p.flag) rec.flags.add(p.flag);
  }
  const outlineRecs = [...outlineOf.values()];
  const footprints = []; // { ring, rec }
  for (const rec of outlineRecs) footprints.push({ ring: rec.outline, rec, bounds: bounds(rec.outline) });

  // ── Pavilions (design section 2) ──
  const pav = R.pavilion;
  const terrainX = [TERRAIN_BNG[0] - BNG_REF_E, TERRAIN_BNG[2] - BNG_REF_E];
  const terrainZ = [-(TERRAIN_BNG[3] - BNG_REF_N), -(TERRAIN_BNG[1] - BNG_REF_N)];
  const inTerrain = (x, z) => x >= terrainX[0] && x <= terrainX[1] && z >= terrainZ[0] && z <= terrainZ[1];
  const ringsOverlap = (A, B) => {
    for (let i = 0; i < A.length; i++) {
      const a0 = A[i], a1 = A[(i + 1) % A.length];
      for (let j = 0; j < B.length; j++) {
        const b0 = B[j], b1 = B[(j + 1) % B.length];
        if (segmentsCross(a0, a1, b0, b1)) return true;
      }
    }
    return pointInRing(A[0][0], A[0][1], B) || pointInRing(B[0][0], B[0][1], A);
  };
  const dlrDist = (x, z, ring) => {
    let best = Infinity;
    for (const line of dlrTrack) for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      if (Math.abs(a[0] - x) > 140 && Math.abs(b[0] - x) > 140) continue;
      for (const q of ring) { const d = nearestOnSegment(q[0], q[1], a[0], a[1], b[0], b[1]).d; if (d < best) best = d; }
      const c = nearestOnSegment(x, z, a[0], a[1], b[0], b[1]).d; if (c < best) best = c;
    }
    return best;
  };
  const placeOk = (cand, others, { dlr = false } = {}) => {
    const ring = rectRing(cand, R.placementClearM);
    const core = rectRing(cand);
    const b = bounds(ring);
    let overlap = 0;
    for (const q of boxGrid.near(b.x0, b.z0, b.x1, b.z1)) {
      if (convexOverlap(ring, q.ring)) overlap++;
    }
    const pts = [[cand.cx, cand.cz], ...core];
    const wet = pts.some(p => inWater(p[0], p[1]));
    const out = pts.some(p => !inTerrain(p[0], p[1]));
    let hit = false;
    for (const f of others) {
      if (f.bounds.x1 < b.x0 || f.bounds.x0 > b.x1 || f.bounds.z1 < b.z0 || f.bounds.z0 > b.z1) continue;
      if (ringsOverlap(core, f.ring)) { hit = true; break; }
    }
    const deck = dlr ? dlrDist(cand.cx, cand.cz, core) : Infinity;
    return { overlap, wet, out, hit, deckOk: !dlr || deck >= R.viaductMinDeckM, clear: overlap === 0 && !wet && !out && !hit && (!dlr || deck >= R.viaductMinDeckM) };
  };
  const dirs = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), -Math.sin(k * Math.PI / 4)]);

  const pavilionSites = siteList.filter(s => !picks.has(s.key));
  const pavilionRecs = [];
  for (const s of pavilionSites) {
    const grp = (x) => (x.named ? 0 : x.e.toks.length === 0 ? 1 : 2);
    const entsNear = ents.filter(e => Math.hypot(e.p[0] - s.p[0], e.p[1] - s.p[1]) <= R.nameRadiusM)
      .map(e => ({ e, d: Math.hypot(e.p[0] - s.p[0], e.p[1] - s.p[1]), named: contains(e.toks, s.toks) }))
      .sort((a, b) => (grp(a) - grp(b)) || (a.d - b.d) || (a.e.id < b.e.id ? -1 : 1));
    const areaOnly = areas.some(a => a.bounds.x0 - R.nameRadiusM <= s.p[0] && a.bounds.x1 + R.nameRadiusM >= s.p[0] && a.bounds.z0 - R.nameRadiusM <= s.p[1] && a.bounds.z1 + R.nameRadiusM >= s.p[1]
      && (pointInRing(s.p[0], s.p[1], a.ring) || nearestOnRing(s.p[0], s.p[1], a.ring).d <= R.nameRadiusM));
    const viaduct = s.nets.size === 1 && s.nets.has('dlr') && (s.dlrKind === 'elevated' || s.dlrKind === 'embankment');
    let kind, candidates = [];
    const rot = [0, Math.PI / 2];
    const around = (ax, az, yaws) => {
      const out = [];
      for (const yaw of yaws) out.push({ cx: ax, cz: az, w: pav.w, d: pav.d, yaw });
      for (const r of [10, 20]) for (const [dx, dz] of dirs) for (const yaw of yaws) out.push({ cx: ax + dx * r, cz: az + dz * r, w: pav.w, d: pav.d, yaw });
      return out;
    };
    // Candidate order for several anchors at once: every anchor at radius 0, then every anchor at 10 m, then at 20 m.
    const aroundAll = (anchors, yaws) => {
      const out = [];
      for (const [r, dl] of [[0, [[0, 0]]], [10, dirs], [20, dirs]]) for (const [ax, az] of anchors) for (const [dx, dz] of dl) for (const yaw of yaws) {
        out.push({ cx: ax + dx * r, cz: az + dz * r, w: pav.w, d: pav.d, yaw });
      }
      return out;
    };
    if (viaduct) {
      kind = 'pavilion-viaduct';
      // The DLR centreline at the station: nearest drawn segment, its heading and the two points 12.5 m either side.
      let best = null;
      for (const line of dlrTrack) for (let i = 0; i + 1 < line.length; i++) {
        const q = nearestOnSegment(s.p[0], s.p[1], line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
        if (!best || q.d < best.d) best = { ...q, a: line[i], b: line[i + 1] };
      }
      if (best) {
        const hx = best.b[0] - best.a[0], hz = best.b[1] - best.a[1], L = Math.hypot(hx, hz) || 1;
        const tx = hx / L, tz = hz / L;
        // Pavilion long axis (w) along the track: u = (cos yaw, -sin yaw) = (tx, tz).
        let yaw = Math.atan2(-tz, tx);
        for (const q of [0, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI]) {
          const diff = Math.abs(Math.atan2(Math.sin(yaw - q), Math.cos(yaw - q)));
          if (diff <= 10 * Math.PI / 180) { yaw = q; break; }
        }
        candidates = aroundAll([1, -1].map(side => [best.x + side * -tz * R.viaductOffsetM, best.z + side * tx * R.viaductOffsetM]), [yaw]);
      }
    } else if (entsNear.length) {
      kind = 'pavilion-entrance';
      candidates = around(entsNear[0].e.p[0], entsNear[0].e.p[1], rot);
      for (const { e } of entsNear.slice(1, 6)) candidates.push(...around(e.p[0], e.p[1], rot).slice(0, 2));
    } else {
      kind = 'pavilion-point';
      candidates = around(s.p[0], s.p[1], rot);
    }
    if (!candidates.length) { candidates = around(s.p[0], s.p[1], rot); kind = viaduct ? 'pavilion-point' : kind; }
    const others = footprints;
    let chosen = null, fallback = null;
    for (const cand of candidates) {
      const t = placeOk(cand, others, { dlr: viaduct });
      if (t.clear) { chosen = { cand, t }; break; }
      if (!t.wet && !t.out && !t.hit && t.deckOk && (!fallback || t.overlap < fallback.t.overlap)) fallback = { cand, t };
    }
    const flags = [];
    if (!chosen) {
      chosen = fallback ?? { cand: candidates[0], t: placeOk(candidates[0], others, { dlr: viaduct }) };
      flags.push('overlap');
    }
    const cand = chosen.cand;
    const rec = { key: `p-${s.key}`, kind, pavilion: { cx: r2(cand.cx), cz: r2(cand.cz), w: cand.w, d: cand.d, yaw: r4(cand.yaw) },
      outline: null, sites: [s], flags: new Set(flags), areaOnly, anchor: [candidates[0].cx, candidates[0].cz], height: pav.h, heightSource: 'pavilion' };
    if (substituted.has(s.key)) rec.flags.add(`substituted:${substituted.get(s.key)}`);
    rec.ring = rectRing(rec.pavilion);
    rec.bounds = bounds(rec.ring);
    rec.pavilionSite = s;
    buildingsById.set(rec.key, rec);
    pavilionRecs.push(rec);
    footprints.push({ ring: rec.ring, rec, bounds: rec.bounds });
    if (chosen.t.overlap) note(s, 'pavilion overlaps map boxes', null, { detail: `${chosen.t.overlap} box(es) within 1.5 m, hidden with the pavilion` });
  }
  for (const f of footprints) { f.bounds ??= bounds(f.ring); }
  for (const rec of outlineRecs) { rec.ring = rec.outline; rec.bounds = bounds(rec.outline); }

  // ── Hide the boxes whose centre is inside a footprint ──
  let hiddenCount = 0;
  for (const rec of buildingsById.values()) {
    rec.hides = boxesInRing(rec.ring ?? rec.outline);
    for (const b of rec.hides) if (!b.hidden) { b.hidden = true; hiddenCount++; }
  }

  // ── Heights ──
  for (const rec of outlineRecs) {
    const tags = rec.osm.tags, area = rec.osm.area;
    const matched = rec.hides.filter(q => q.side * q.side >= 0.5 * area && q.side * q.side <= 2 * area)
      .sort((a, b) => Math.abs(a.side * a.side - area) - Math.abs(b.side * b.side - area) || a.x - b.x || a.z - b.z)[0];
    let h, src;
    const tagH = parseFloat(String(tags.height ?? '').replace(',', '.'));
    const lv = parseFloat(tags['building:levels']);
    if (matched && matched.h > 0) { h = matched.h; src = 'box'; }
    else if (Number.isFinite(tagH) && tagH > 0) { h = tagH; src = 'height-tag'; }
    else if (Number.isFinite(lv) && lv > 0) { h = lv * 3.2; src = 'levels'; }
    else { h = R.heightDefault; src = 'default'; }
    h = Math.min(R.heightMax, Math.max(R.heightMin, h));
    // A building on a slope is buried on its high side (its base is the lowest ground under it): 7 of the 396, all big
    // termini (Waterloo, Victoria, King's Cross, Euston, Paddington...), had the street above their roof at one wall.
    // Where the ground rises more than the building is tall less RISE_CLEAR_M, it is made as tall as the rise plus that,
    // never above heightMax, so its high-side wall still stands RISE_CLEAR_M above the street.
    const rise = riseOf ? riseOf(rec.outline) : null;
    if (rise !== null && rise + R.riseClearM > h) { h = Math.min(R.heightMax, rise + R.riseClearM); src += '+rise'; }
    rec.height = r2(h);
    rec.heightSource = src;
  }

  // ── Fronts, roundels and the exit (design sections 3 and 6) ──
  const footGrid = createFootprintGrid(footprints, 32);
  const remainingBoxes = boxes.filter(b => !b.hidden);
  const remGrid = createFootprintGrid(remainingBoxes.map(b => ({ ring: boxRing(b.x, b.z, b.side), box: b })), 32);
  const clearPoint = (x, z, grow = R.boxClearM) => {
    if (inWater(x, z)) return false;
    for (const q of remGrid.near(x - 1, z - 1, x + 1, z + 1)) {
      const h = q.box.side / 2 + grow;
      if (Math.abs(q.box.x - x) <= h && Math.abs(q.box.z - z) <= h) return false;
    }
    for (const f of footGrid.near(x - 1, z - 1, x + 1, z + 1)) if (pointInRing(x, z, f.ring)) return false;
    return true;
  };
  const frontsOf = (rec) => {
    const ring = rec.ring, out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < R.frontMinM) continue;
      const n = edgeNormal(ring, i);
      let ok = 0;
      for (const t of [0.25, 0.5, 0.75]) if (clearPoint(a[0] + (b[0] - a[0]) * t + n[0] * R.frontProbeM, a[1] + (b[1] - a[1]) * t + n[1] * R.frontProbeM)) ok++;
      if (ok >= 2) out.push({ i, a, b, L, n });
    }
    return out;
  };
  const ringKinds = (rec) => {
    const nets = new Set(rec.sites.flatMap(s => [...s.nets]));
    rec.nets = NETS.filter(n => nets.has(n));
    if (nets.has('tube')) return { rings: ['underground'], dual: false };
    if (nets.has('dlr') && nets.has('og')) return { rings: ['overground', 'dlr'], dual: true };
    if (nets.has('og')) return { rings: ['overground'], dual: false };
    return { rings: ['dlr'], dual: false };
  };
  const RK = R.roundel;
  const widthPerD = ROUNDEL.width / (2 * ROUNDEL.outerR);
  for (const rec of buildingsById.values()) {
    rec.fronts = frontsOf(rec);
    rec.fronts.sort((a, b) => (b.L - a.L) || (a.i - b.i));
    const { rings, dual } = ringKinds(rec);
    if (dual) rec.flags.add('dual-roundel');
    // Title: the site with most nets, then the Tube site, then alphabetical.
    const ordered = rec.sites.slice().sort((a, b) => (b.nets.size - a.nets.size) || ((b.nets.has('tube') ? 1 : 0) - (a.nets.has('tube') ? 1 : 0)) || (a.name < b.name ? -1 : 1));
    rec.title = ordered[0].name;
    rec.names = [...new Set(rec.sites.flatMap(s => [...s.raw].flatMap(r => [cleanStationName(r), cleanName(r)]).concat(s.name)))].sort();
    const H = rec.height;
    const D0 = Math.min(RK.wallFrac * H, RK.wallMaxD);
    const roundels = [];
    // Walls, in the building's own ring order so the alternation is stable.
    const ordFronts = rec.fronts.slice().sort((a, b) => a.i - b.i);
    ordFronts.forEach((f, idx) => {
      const k = f.L >= 60 ? Math.min(RK.maxPerFront, 1 + Math.floor((f.L - 20) / 40)) : 1;
      const Dfit = Math.min(D0, RK.fitFrac * (f.L / k) / widthPerD);
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        roundels.push({ on: 'wall', x: r2(f.a[0] + (f.b[0] - f.a[0]) * t + f.n[0] * RK.proud), z: r2(f.a[1] + (f.b[1] - f.a[1]) * t + f.n[1] * RK.proud),
          yM: r2(H / 2), D: r2(Math.max(3.4, Dfit)), nx: r4(f.n[0]), nz: r4(f.n[1]), ring: dual ? rings[idx % 2] : rings[0] });
      }
    });
    while (roundels.length > RK.maxPerBuilding) roundels.pop();
    // Roof: one, centred on the label point.
    const lp = rec.outline ? labelPoint(rec.outline) : { x: rec.pavilion.cx, z: rec.pavilion.cz, d: Math.min(rec.pavilion.w, rec.pavilion.d) / 2 };
    rec.label = { x: r2(lp.x), z: r2(lp.z) };
    const mar = minAreaRect(rec.ring);
    const longest = rec.fronts[0];
    const roofD = Math.min(RK.roofShortFrac * mar.d, RK.roofEdgeFrac * lp.d, RK.roofMaxD);
    const bar = longest ? [longest.n[1], -longest.n[0]] : [Math.cos(mar.angle), Math.sin(mar.angle)];
    roundels.push({ on: 'roof', x: rec.label.x, z: rec.label.z, yM: H, D: r2(Math.max(3.4, roofD)), ax: r4(bar[0]), az: r4(bar[1]), ring: rings[0] });
    rec.roundels = roundels;
    if (!rec.fronts.length) rec.flags.add('no-walkable-front');
  }

  // Exits.
  const nearestFoot = (x, z, rec) => nearestOnRing(x, z, rec.ring);
  const exitValid = (x, z, rec) => {
    for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      if (!clearPoint(x + dx, z + dz)) return false;
    }
    const np = nearestFoot(x, z, rec);
    if (np.d < 5.5 || np.d > 7) return false;
    return true;
  };
  for (const rec of buildingsById.values()) {
    const site = rec.sites.slice().sort((a, b) => (b.nets.size - a.nets.size) || (a.name < b.name ? -1 : 1))[0];
    const sp = rec.pavilionSite ? rec.pavilionSite.p : site.p;
    let fronts = rec.fronts.slice();
    if (rec.pavilion) {
      // Long fronts first: facing away from the site point (entrance, viaduct) or with the most open ground (point).
      const mid = (f) => [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
      const open = (f) => { let n = 0; const m = mid(f); for (const d of [3, 6, 9]) for (const t of [-0.3, 0, 0.3]) {
        if (clearPoint(m[0] + f.n[0] * d + (f.b[0] - f.a[0]) * t, m[1] + f.n[1] * d + (f.b[1] - f.a[1]) * t)) n++; } return n; };
      fronts.sort((a, b) => {
        const la = a.L >= 15 ? 0 : 1, lb = b.L >= 15 ? 0 : 1;
        if (la !== lb) return la - lb;
        if (rec.kind === 'pavilion-point') return (open(b) - open(a)) || (a.i - b.i);
        const sa = a.n[0] * (mid(a)[0] - sp[0]) + a.n[1] * (mid(a)[1] - sp[1]), sb = b.n[0] * (mid(b)[0] - sp[0]) + b.n[1] * (mid(b)[1] - sp[1]);
        return (sb - sa) || (a.i - b.i);
      });
    } else {
      const dseg = (f) => nearestOnSegment(sp[0], sp[1], f.a[0], f.a[1], f.b[0], f.b[1]).d;
      fronts.sort((a, b) => (dseg(a) - dseg(b)) || (a.i - b.i));
    }
    let exit = null;
    for (const f of fronts) {
      const q = nearestOnSegment(sp[0], sp[1], f.a[0], f.a[1], f.b[0], f.b[1]);
      const ux = (f.b[0] - f.a[0]) / f.L, uz = (f.b[1] - f.a[1]) / f.L;
      const t0 = Math.min(Math.max(q.t * f.L, 2), f.L - 2);
      const startAt = rec.pavilion ? f.L / 2 : t0;
      const tries = [0];
      for (let k = 1; k * 2 <= f.L; k++) tries.push(k * 2, -k * 2);
      for (const dt of tries) {
        const t = startAt + dt;
        if (t < 2 || t > f.L - 2) continue;
        const x = f.a[0] + ux * t + f.n[0] * R.exitOutM, z = f.a[1] + uz * t + f.n[1] * R.exitOutM;
        if (!exitValid(x, z, rec)) continue;
        const np = nearestFoot(x, z, rec);
        const nx = (x - np.x) / (np.d || 1), nz = (z - np.z) / (np.d || 1);
        if (nx * f.n[0] + nz * f.n[1] < 0.8) continue;
        exit = { x, z, yaw: yawFacing(nx, nz) };
        break;
      }
      if (exit) break;
    }
    if (!exit) {
      // A spiral from the site point: 3 m steps to 60 m, 16 directions a ring.
      outer: for (let r = 3; r <= 60; r += 3) for (let k = 0; k < 16; k++) {
        const x = sp[0] + r * Math.cos(k * Math.PI / 8), z = sp[1] + r * Math.sin(k * Math.PI / 8);
        if (!clearPoint(x, z) || !clearPoint(x + 2, z) || !clearPoint(x - 2, z) || !clearPoint(x, z + 2) || !clearPoint(x, z - 2)) continue;
        const np = nearestFoot(x, z, rec);
        if (np.d < 3) continue;
        exit = { x, z, yaw: yawFacing((x - np.x) / np.d, (z - np.z) / np.d) };
        rec.flags.add('exit-fallback');
        break outer;
      }
    }
    if (!exit) {
      const np = nearestFoot(sp[0], sp[1], rec);
      const nx = np.d > 0 ? (sp[0] - np.x) / np.d : 0, nz = np.d > 0 ? (sp[1] - np.z) / np.d : 1;
      exit = { x: np.x + nx * R.exitOutM, z: np.z + nz * R.exitOutM, yaw: yawFacing(nx, nz) };
      rec.flags.add('exit-fallback');
    }
    rec.exit = { x: r2(exit.x), z: r2(exit.z), yaw: r4(exit.yaw) };
  }

  // ── Sites table, review rows, counts ──
  const siteTable = {};
  const lowConf = new Set();
  for (const s of siteList) {
    let rec, conf = 'high';
    const p = picks.get(s.key);
    if (p) {
      rec = outlineOf.get(p.b.id);
      if (p.low || p.rule === 'distance' && p.d > R.distLowConfM) { conf = 'low'; note(s, p.rule === 'name' ? 'name pick beyond 150 m' : 'distance pick beyond 60 m', p.b, { detail: `${Math.round(p.d)} m, ${Math.round(p.b.area)} m2` }); }
      else if (p.rule === 'distance' && p.d > R.distLowConfM) conf = 'low';
    } else rec = pavilionRecs.find(r => r.pavilionSite === s);
    if (!rec) throw new Error(`site ${s.key} has no building`);
    if (rec.areaOnly) { conf = 'low'; note(s, 'area-only site', null, { detail: 'only a public_transport=station area is mapped near it: a pavilion, no hide' }); }
    siteTable[s.key] = { name: s.name, nets: NETS.filter(n => s.nets.has(n)), building: rec.key, confidence: conf };
    if (conf === 'low') lowConf.add(s.key);
  }
  const shared = new Map();
  for (const rec of buildingsById.values()) if (rec.sites.length > 1) shared.set(rec.key, rec);
  for (const rec of shared.values()) note(rec.sites[0], 'building shared by sites', rec.osm, { detail: rec.sites.map(s => s.name).join(', ') });
  for (const rec of buildingsById.values()) for (const f of rec.flags) {
    if (/^(landmark-overlap|no-walkable-front|exit-fallback|dual-roundel|overlap|substituted)/.test(f)) note(rec.sites[0], `flag ${f}`, rec.osm, { detail: `building ${rec.key}` });
  }

  const outBuildings = [...buildingsById.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map(rec => {
    const o = { key: rec.key, title: rec.title, names: rec.names, nets: rec.nets, kind: rec.kind, areaOnly: !!rec.areaOnly };
    if (rec.outline) o.outline = rec.outline.map(p => [r2(p[0]), r2(p[1])]); else o.pavilion = rec.pavilion;
    o.height = rec.height; o.heightSource = rec.heightSource;
    o.label = rec.label; o.exit = rec.exit; o.roundels = rec.roundels; o.flags = [...rec.flags].sort();
    if (rec.osm) o.source = { osm: rec.osm.id, name: rec.osm.name || undefined, areaM2: Math.round(rec.osm.area) };
    return o;
  });
  const counts = { sites: siteList.length, buildings: outBuildings.length, outlineSites: 0, outlineBuildings: outlineRecs.length, 'pavilion-entrance': 0, 'pavilion-point': 0, 'pavilion-viaduct': 0, areaOnly: 0 };
  for (const s of siteList) {
    const b = buildingsById.get(siteTable[s.key].building);
    if (b.kind === 'outline') counts.outlineSites++; else counts[b.kind]++;
    if (b.areaOnly) counts.areaOnly++;
  }
  const json = {
    version: 1,
    source: { overpassSha256: overpassSha, overpassTimestamp: overpass.osm3s?.timestamp_osm_base ?? null, bakedPayloadSha256: bakedSha,
      generatedBy: 'scripts/prepare-station-buildings.mjs', attribution: '© OpenStreetMap contributors, ODbL 1.0' },
    conventions: {
      coordinates: 'scene metres (x east, z south), the origin of src/coordinates.js',
      outline: 'unclosed ring; negative shoelace sum in (x, z) = counter-clockwise seen from above with north up; the outward normal of edge (dx, dz) is (-dz, dx) / length',
      pavilion: 'cx, cz, w along u = (cos yaw, -sin yaw), d along v = (sin yaw, cos yaw), metres; yaw in radians',
      height: 'true metres above the base (the lowest terrain sample over the footprint)',
      roundel: 'wall: centre (x, z) 0.05 m proud, yM above the base, diameter D (ring), normal (nx, nz); roof: ax, az the bar direction as read from outside the longest front',
      exit: 'x, z on the ground outside the building; yaw in the Pedestrian convention (facing (-sin yaw, -cos yaw)), away from the building',
    },
    sites: siteTable,
    buildings: outBuildings,
    stats: { ...counts, hiddenBakedBoxes: hiddenCount, lowConfidenceSites: lowConf.size },
  };
  return { json, review, counts, hidden: hiddenCount };
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

export function reviewMarkdown(review, counts, json) {
  const rows = review.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.kind < b.kind ? -1 : 1));
  const esc = (s) => String(s ?? '').replace(/\|/g, '/');
  const lines = [
    '# Lane B: low-confidence and flagged station assignments',
    '',
    'Written by `scripts/prepare-station-buildings.mjs` (deterministic; do not edit by hand).',
    `Overpass source sha256 \`${json.source.overpassSha256}\`; baked payload \`${json.source.bakedPayloadSha256}\`.`,
    '',
    `Sites ${counts.sites}; buildings ${counts.buildings}; sites on a true outline ${counts.outlineSites} (${counts.outlineBuildings} distinct buildings); entrance pavilions ${counts['pavilion-entrance']}; point pavilions ${counts['pavilion-point']}; viaduct pavilions ${counts['pavilion-viaduct']}; area-only sites ${counts.areaOnly}; baked boxes hidden ${json.stats.hiddenBakedBoxes}.`,
    '',
    '| Site | Kind | Building | Name | Detail |', '|---|---|---|---|---|',
    ...rows.map(r => `| ${esc(r.site)} | ${esc(r.kind)} | ${esc(r.building)} | ${esc(r.bname)} | ${esc(r.detail)} |`),
    '',
  ];
  return lines.join('\n');
}

/**
 * The ground's rise under a footprint in true metres (highest minus lowest structural-surface sample over its vertices and
 * an 8 m grid), read from the app's OWN terrain code under the bake's Node shim, exactly as the bake does.
 */
async function terrainRise() {
  const { installNodeEnv } = await import('./bake-node-env.mjs');
  installNodeEnv();
  const terrain = await import('../src/terrain.js');
  const thames = JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
  const mesh = await terrain.tryCreateTerrainMesh({ thamesData: thames });
  if (!mesh) throw new Error('terrain mesh failed to build: cannot read the ground under the footprints');
  const VE = terrain.VERTICAL_EXAGGERATION;
  return (ring) => {
    const bb = bounds(ring);
    let mn = Infinity, mx = -Infinity;
    const take = (x, z) => { const y = terrain.getStructuralSurfaceY({ x, z }); if (Number.isFinite(y)) { if (y < mn) mn = y; if (y > mx) mx = y; } };
    for (const [x, z] of ring) take(x, z);
    for (let x = bb.x0; x <= bb.x1; x += 8) for (let z = bb.z0; z <= bb.z1; z += 8) if (pointInRing(x, z, ring)) take(x, z);
    return Number.isFinite(mn) ? (mx - mn) / VE : null;
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : null; };
  const out = arg('--out') ? path.resolve(arg('--out')) : DEFAULT_OUT;
  const reviewPath = argv.includes('--no-review') ? null : (arg('--review') ?? DEFAULT_REVIEW);
  let raw;
  if (argv.includes('--refetch')) {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(OVERPASS_QUERY), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
    raw = Buffer.from(await res.arrayBuffer());
    await writeFile(OVERPASS_FILE, raw);
  } else {
    raw = await readFile(OVERPASS_FILE).catch((e) => { throw new Error(`${OVERPASS_FILE} is missing (${e.message}); copy the pinned answer there or pass --refetch`); });
  }
  const overpassSha = sha256(raw);
  if (!argv.includes('--refetch') && overpassSha !== PINNED_SHA256) throw new Error(`${OVERPASS_FILE} has sha256 ${overpassSha}, not the pinned ${PINNED_SHA256}; pass --refetch to use a new answer`);
  const overpass = JSON.parse(raw.toString('utf8'));
  const sites = await loadSites();
  const thames = JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8'));
  initThamesMask(thames.points);
  const docks = JSON.parse(await readFile(path.join(ROOT, 'src/airport-docks-data.json'), 'utf8')).docks;
  const dlrTrack = await loadDlrTrack();
  const { boxes, payloadSha256 } = await loadBakedBoxes([...sites.values()].map(s => s.p));
  const riseOf = await terrainRise();
  const res = compileStationBuildings({ sites, overpass, boxes, bakedSha: payloadSha256, overpassSha, dlrTrack, docks, inThames: isInThames, riseOf });
  await writeFile(out, JSON.stringify(res.json) + '\n');
  if (reviewPath) await writeFile(reviewPath, reviewMarkdown(res.review, res.counts, res.json));
  console.log('sites', res.counts.sites, JSON.stringify(res.counts));
  console.log('hidden baked boxes', res.hidden, '; wrote', out, `(${(JSON.stringify(res.json).length / 1024).toFixed(0)} KiB)`);
  if (reviewPath) console.log('review', reviewPath, res.review.length, 'rows');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
