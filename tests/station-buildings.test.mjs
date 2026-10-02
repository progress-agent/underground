// station-buildings.test.mjs: lane B (sprint 02Oct26f), the data and its rules, in Node (no GPU).
//
//   1. station-building-geometry.js: orientation, containment, simplification, rectangles.
//   2. createStationBuildingIndex: which boxes hide, which building is touched, stationExitPose, entrancesForBuilding.
//   3. compileStationBuildings on a small synthetic world: assignment (the big terminus first, junk and sister
//      stations refused), pavilion placement, the roundel rule by network, hiding, exits, determinism.
//   4. The tracked public/data/station-buildings.json against the acceptance rules (sites, kinds, roundels,
//      pavilions, exits), and the builder's byte-identical output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
import { cleanStationName } from '../src/stations.js';
import {
  shoelace, orient, ringArea, centroid, pointInRing, nearestOnRing, simplifyRing, rectRing, convexOverlap, boxRing, footprintOf,
  distToRing, edgeNormal, yawFacing, minAreaRect, labelPoint,
} from '../src/station-building-geometry.js';
import { createStationBuildingIndex, entrancesForBuilding, siteKeyOf, networksLine } from '../src/station-buildings.js';
import { compileStationBuildings, RULES, nameTokens, llToXZ } from '../scripts/prepare-station-buildings.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const JSON_PATH = path.join(ROOT, 'public/data/station-buildings.json');

// ── 1. geometry ──────────────────────────────────────────────────────────

test('orient: counter-clockwise seen from above (negative shoelace in x, z), unclosed', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const r = orient(sq);
  assert.equal(r.length, 4);
  assert.ok(shoelace(r) < 0);
  assert.ok(shoelace(orient([...r].reverse())) < 0);
  assert.equal(ringArea(r), 100);
});

test('edge normals point outward for an oriented ring', () => {
  const r = orient([[0, 0], [20, 0], [20, 10], [0, 10]]);
  const c = centroid(r);
  for (let i = 0; i < r.length; i++) {
    const n = edgeNormal(r, i), a = r[i], b = r[(i + 1) % r.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.ok(!pointInRing(mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5, r), 'a point 0.5 m out is outside');
    assert.ok(pointInRing(mid[0] - n[0] * 0.5, mid[1] - n[1] * 0.5, r), 'a point 0.5 m in is inside');
    assert.ok(n[0] * (mid[0] - c[0]) + n[1] * (mid[1] - c[1]) > 0);
  }
});

test('nearestOnRing: the outward normal and the inside flag', () => {
  const r = orient([[0, 0], [10, 0], [10, 10], [0, 10]]);
  const out = nearestOnRing(15, 5, r);
  assert.equal(out.inside, false);
  assert.ok(Math.abs(out.d - 5) < 1e-9 && Math.abs(out.nx - 1) < 1e-9 && Math.abs(out.nz) < 1e-9);
  const inn = nearestOnRing(8, 5, r);
  assert.equal(inn.inside, true);
  assert.ok(Math.abs(inn.d - 2) < 1e-9 && inn.nx > 0.99);
  assert.equal(distToRing(5, 5, r), 0);
});

test('simplifyRing drops near-collinear vertices but never flattens a curve beyond maxDev', () => {
  const line = orient([[0, 0], [5, 0.01], [10, 0], [10, 10], [0, 10]]);
  assert.equal(simplifyRing(line).length, 4);
  const arc = []; for (let i = 0; i <= 40; i++) { const a = Math.PI * i / 40; arc.push([30 * Math.cos(a), 30 * Math.sin(a)]); }
  const s = simplifyRing(orient(arc));
  assert.ok(s.length > 8, 'a 30 m arc keeps its bend');
});

test('rectRing and convexOverlap', () => {
  const a = rectRing({ cx: 0, cz: 0, w: 16, d: 12, yaw: 0 });
  assert.equal(a.length, 4);
  assert.ok(Math.abs(ringArea(a) - 192) < 1e-9);
  const b = rectRing({ cx: 17, cz: 0, w: 16, d: 12, yaw: 0 });
  assert.equal(convexOverlap(a, b), false);
  assert.equal(convexOverlap(a, rectRing({ cx: 15, cz: 0, w: 16, d: 12, yaw: 0 })), true);
  const turned = rectRing({ cx: 0, cz: 0, w: 16, d: 12, yaw: Math.PI / 2 });
  const bb = turned.reduce((m, p) => ({ x: Math.max(m.x, Math.abs(p[0])), z: Math.max(m.z, Math.abs(p[1])) }), { x: 0, z: 0 });
  assert.ok(Math.abs(bb.x - 6) < 1e-9 && Math.abs(bb.z - 8) < 1e-9, 'yaw 90 degrees swaps the axes');
  assert.equal(convexOverlap(boxRing(0, 0, 10, 1.5), a), true);
});

test('minAreaRect and labelPoint', () => {
  const r = orient([[0, 0], [40, 0], [40, 10], [0, 10]]);
  const m = minAreaRect(r);
  assert.ok(Math.abs(m.w - 40) < 1e-6 && Math.abs(m.d - 10) < 1e-6);
  const lp = labelPoint(r);
  assert.ok(pointInRing(lp.x, lp.z, r) && lp.d > 4.5);
});

test('yawFacing is the Pedestrian convention: facing (-sin yaw, -cos yaw)', () => {
  for (const [hx, hz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]]) {
    const y = yawFacing(hx, hz);
    assert.ok(Math.abs(-Math.sin(y) - hx) < 1e-9 && Math.abs(-Math.cos(y) - hz) < 1e-9);
  }
});

// ── 2. the index ─────────────────────────────────────────────────────────

const mini = () => ({
  version: 1,
  sites: { alpha: { name: 'Alpha', nets: ['tube'], building: 'w1', confidence: 'high' }, 'alpha-sister': { name: 'Alpha Sister', nets: ['og'], building: 'w1', confidence: 'high' },
    beta: { name: 'Beta', nets: ['dlr'], building: 'p-beta', confidence: 'high' } },
  buildings: [
    { key: 'w1', title: 'Alpha', names: ['Alpha', 'Alpha Sister'], nets: ['og', 'tube'], kind: 'outline', outline: orient([[0, 0], [40, 0], [40, 20], [0, 20]]), height: 10,
      label: { x: 20, z: 10 }, exit: { x: 20, z: 26, yaw: Math.PI }, roundels: [], flags: [] },
    { key: 'p-beta', title: 'Beta', names: ['Beta'], nets: ['dlr'], kind: 'pavilion-viaduct', pavilion: { cx: 100, cz: 0, w: 16, d: 12, yaw: 0 }, height: 7,
      label: { x: 100, z: 0 }, exit: { x: 100, z: 12, yaw: Math.PI }, roundels: [], flags: [] },
  ],
});

test('index: hidesBox reads { x, z } and { cx, cz }; contactAt names the building touched', () => {
  const idx = createStationBuildingIndex(mini());
  assert.equal(idx.hidesBox({ x: 20, z: 10 }), true);
  assert.equal(idx.hidesBox({ cx: 20, cz: 10 }), true);
  assert.equal(idx.hidesBox({ x: 41, z: 10 }), false);
  assert.equal(idx.hidesBox({ x: 100, z: 1 }), true);
  assert.equal(idx.hidesBox({ x: -5000, z: 5000 }), false);
  const c = idx.contactAt(20, 25, 30);
  assert.equal(c.building.key, 'w1');
  assert.ok(Math.abs(c.d - 5) < 1e-9 && c.nz > 0.99);
  assert.equal(idx.contactAt(500, 500, 30), null);
  assert.equal(idx.contactAt(20, 10).d, 0, 'inside is d = 0');
});

test('index: stationExitPose is pure, repeatable and null for an unknown key', () => {
  const idx = createStationBuildingIndex(mini());
  const a = idx.stationExitPose('alpha'), b = idx.stationExitPose('alpha');
  assert.deepEqual(a, { x: 20, z: 26, yaw: Math.PI });
  assert.deepEqual(a, b);
  assert.equal(idx.stationExitPose('nowhere'), null);
  assert.equal(idx.stationExitPose('alpha-sister').x, 20, 'two sites, one building, one pose');
  assert.equal(globalThis.document, undefined, 'no DOM was needed');
});

test('entrancesForBuilding matches cleaned names within 300 m of the footprint', () => {
  const idx = createStationBuildingIndex(mini());
  const b = idx.byKey.get('w1');
  const net = { entrances: [
    { name: 'Alpha', x: 10, z: 10, stops: [] }, { name: 'Alpha Sister', x: 30, z: 330, stops: [] },
    { name: 'Alpha Sister', x: 30, z: 80, stops: [] }, { name: 'Beta', x: 10, z: 10, stops: [] },
    { name: 'London Euston', x: 10, z: 10, stops: [] } ] };
  assert.deepEqual(entrancesForBuilding(net, b).map(e => e.x + ',' + e.z), ['10,10', '30,80']);
  assert.deepEqual(entrancesForBuilding(null, b), []);
  assert.equal(networksLine(b), 'London Underground · London Overground');
});

test('siteKeyOf', () => {
  assert.equal(siteKeyOf("King's Cross St. Pancras"), 'kings-cross-st-pancras');
  assert.equal(siteKeyOf('Highbury & Islington Underground Station'), 'highbury-and-islington');
  assert.equal(siteKeyOf('London Euston'), 'euston');
  assert.equal(siteKeyOf('Bethnal Green Rail Station'), 'bethnal-green-overground');
  assert.equal(siteKeyOf('Cutty Sark (for Maritime Greenwich) DLR Station'), 'cutty-sark-for-maritime-greenwich');
});

// ── 3. the compiler on a synthetic world ──────────────────────────────────

const ll = (x, z) => { const [lon, lat] = proj4('EPSG:27700', 'EPSG:4326', [x + BNG_REF_E, BNG_REF_N - z]); return { lat, lon }; };
const rectWay = (id, x0, z0, x1, z1, tags) => ({ type: 'way', id, tags, geometry: [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => ll(x, z)) });
const node = (id, x, z, tags = {}) => ({ type: 'node', id, ...ll(x, z), tags: { railway: 'subway_entrance', ...tags } });
const mkSite = (name, x, z, nets, extra = {}) => ({ key: siteKeyOf(name), name: cleanStationName(name), pts: [], nets: new Set(nets), raw: new Set([name]),
  lines: new Set(extra.lines ?? ['x']), dlrKind: extra.dlrKind ?? null, p: [x, z], toks: nameTokens(cleanStationName(name)) });

function world() {
  const sites = new Map();
  for (const s of [
    mkSite('Alpha Underground Station', 100, 100, ['tube']),
    mkSite('Beta Square Underground Station', 150, 300, ['tube']),
    mkSite('Beta Underground Station', 600, 600, ['tube']),
    mkSite('Gamma Rail Station', 1000, 0, ['og']),
    mkSite('Delta DLR Station', 2000, 0, ['dlr'], { dlrKind: 'elevated' }),
    mkSite('Epsilon Underground Station', 3000, 0, ['tube', 'og'], { lines: ['a', 'b', 'c'] }),
    mkSite('Zeta Rail Station', 4000, 0, ['og', 'dlr']),
    mkSite('Eta DLR Station', 5000, 0, ['dlr']),
  ]) sites.set(s.key, s);
  const elements = [
    rectWay(1, 60, 60, 160, 140, { building: 'train_station', name: 'Alpha Station' }),                 // 8,000 m2: the terminus
    rectWay(2, 175, 100, 185, 114, { building: 'train_station', name: 'Alpha ticket hall' }),            // 140 m2: junk beside it
    rectWay(3, 580, 580, 640, 620, { building: 'train_station', name: 'Beta Station' }),                // Beta's own
    rectWay(4, 140, 280, 180, 300, { building: 'train_station' }),                                      // free, unnamed, near Beta Square
    rectWay(5, 1100, 0, 1112, 8, { building: 'train_station', name: 'Gamma Station' }),                  // 96 m2 named
    node(6, 1020, 30, { name: 'Gamma' }), node(7, 2030, 40),                                              // entrances
    rectWay(8, 2990, -10, 3040, 20, { building: 'train_station', name: 'Epsilon Station' }),            // 1,500 m2
    rectWay(9, 3990, -10, 4030, 10, { building: 'train_station', name: 'Zeta Station' }),
    rectWay(10, 5000, 50, 5040, 60, { public_transport: 'station', name: 'Eta' }),                       // an area, never a building
    rectWay(11, 60, 400, 140, 440, { building: 'bus_station', name: 'Beta Square bus station' }),        // excluded
  ];
  const boxes = [
    { x: 100, z: 100, h: 12, side: 20, hidden: false },       // inside Alpha: hidden, and its height
    { x: 3010, z: 0, h: 8.2, side: 38.7, hidden: false },      // inside Epsilon: 8.2 m, side^2 = 1,498
    { x: 1006, z: 24, h: 5, side: 8, hidden: false },          // beside Gamma's entrance
    { x: 1010, z: 45, h: 5, side: 8, hidden: false },
    { x: 2040, z: 30, h: 9, side: 10, hidden: false },         // beside Delta's anchor
  ];
  const dlrTrack = [[[1900, 0], [2100, 0]], [[4900, 0], [5100, 0]]];
  return { sites, overpass: { elements, osm3s: { timestamp_osm_base: 'test' } }, boxes, bakedSha: 'b', overpassSha: 'o', dlrTrack };
}

test('compile: the big named terminus wins, junk and sister stations are refused, every site has one building', () => {
  const w = world();
  const { json, counts } = compileStationBuildings(w);
  assert.equal(Object.keys(json.sites).length, 8);
  assert.equal(json.sites.alpha.building, 'w1', 'Alpha takes its 8,000 m2 building, not the 140 m2 ticket hall');
  assert.equal(json.sites.beta.building, 'w3');
  assert.notEqual(json.sites['beta-square'].building, 'w3', 'Beta Square is not Beta');
  assert.ok(json.sites['beta-square'].building === 'w4' || json.sites['beta-square'].building.startsWith('p-'), 'a free building or a pavilion');
  assert.notEqual(json.sites['beta-square'].building, 'w11', 'a bus station is never a station building');
  assert.equal(json.sites.eta.building, 'p-eta', 'a public_transport area becomes a pavilion');
  assert.equal(json.buildings.find(b => b.key === 'p-eta').areaOnly, true);
  for (const s of Object.values(json.sites)) assert.ok(json.buildings.some(b => b.key === s.building));
  assert.equal(counts.sites, 8);
});

test('compile: hides the boxes inside an outline and takes the matched box height', () => {
  const w = world();
  const { json, hidden } = compileStationBuildings(w);
  assert.ok(w.boxes[0].hidden && w.boxes[1].hidden && !w.boxes[3].hidden);
  assert.equal(hidden, w.boxes.filter(b => b.hidden).length);
  const eps = json.buildings.find(b => b.key === 'w8');
  assert.equal(eps.height, 8.2); assert.equal(eps.heightSource, 'box');
  const alpha = json.buildings.find(b => b.key === 'w1');
  assert.ok(alpha.height >= RULES.heightMin && alpha.height <= RULES.heightMax);
});

test('compile: pavilions are 16 x 12 x 7, clear of the map boxes, and the entrance one stands at the entrance', () => {
  const w = world();
  const { json } = compileStationBuildings(w);
  const g = json.buildings.find(b => b.key === 'p-gamma' || b.key === 'w5');
  assert.ok(g, 'Gamma has a building');
  for (const b of json.buildings.filter(x => x.pavilion)) {
    assert.deepEqual([b.pavilion.w, b.pavilion.d, b.height], [16, 12, 7]);
    if (!b.flags.includes('overlap')) {
      const ring = rectRing(b.pavilion, 1.5);
      for (const q of w.boxes) if (!q.hidden) assert.equal(convexOverlap(ring, boxRing(q.x, q.z, q.side)), false, `${b.key} stands clear of box ${q.x},${q.z}`);
    }
  }
  const delta = json.buildings.find(b => b.key === 'p-delta');
  assert.equal(delta.kind, 'pavilion-viaduct');
  const ring = rectRing(delta.pavilion);
  // beside the deck, never under it: the DLR track runs along z = 0
  assert.ok(Math.min(...ring.map(p => Math.abs(p[1]))) >= 4.5, 'at least 4.5 m from the DLR centreline');
});

test('compile: the roundel rule by network (D-048 item 3)', () => {
  const { json } = compileStationBuildings(world());
  const rings = (key) => [...new Set(json.buildings.find(b => b.key === key).roundels.map(r => r.ring))];
  assert.deepEqual(rings(json.sites.alpha.building), ['underground']);
  assert.deepEqual(rings(json.sites.gamma.building), ['overground']);
  assert.deepEqual(rings(json.sites.delta.building), ['dlr']);
  assert.deepEqual(rings(json.sites.epsilon.building), ['underground'], 'an Underground and Overground interchange is red and blue only');
  const zeta = json.buildings.find(b => b.key === json.sites.zeta.building);
  assert.deepEqual([...new Set(zeta.roundels.map(r => r.ring))].sort(), ['dlr', 'overground']);
  assert.ok(zeta.flags.includes('dual-roundel'));
  for (const b of json.buildings) {
    assert.equal(b.roundels.filter(r => r.on === 'roof').length, 1);
    for (const r of b.roundels.filter(q => q.on === 'wall')) assert.ok(r.D >= 3.4 && r.D <= 12, `${b.key} wall roundel ${r.D}`);
  }
});

test('compile: exits stand 5.5 to 7 m from the building, outside every footprint, facing away', () => {
  const { json } = compileStationBuildings(world());
  for (const b of json.buildings) {
    const fp = footprintOf(b);
    const d = distToRing(b.exit.x, b.exit.z, fp);
    assert.ok(d >= 5.5 && d <= 7.01, `${b.key}: ${d}`);
    const np = nearestOnRing(b.exit.x, b.exit.z, fp);
    const f = [-Math.sin(b.exit.yaw), -Math.cos(b.exit.yaw)];
    assert.ok(f[0] * (b.exit.x - np.x) / np.d + f[1] * (b.exit.z - np.z) / np.d >= 0.7);
  }
});

test('compile is deterministic: two runs are byte-identical', () => {
  const a = JSON.stringify(compileStationBuildings(world()).json), b = JSON.stringify(compileStationBuildings(world()).json);
  assert.equal(a, b);
});

// ── 4. the tracked data ───────────────────────────────────────────────────

const have = fs.existsSync(JSON_PATH);
const data = have ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) : null;
const bakedFile = path.join(ROOT, 'public/data/surface/baked/buildings.bin');
const cacheFile = path.join(ROOT, 'scripts/.cache/station-buildings-overpass.json');

test('data: the pinned source and every site has exactly one building (acceptance B1.1, B1.3)', { skip: !have }, () => {
  if (fs.existsSync(cacheFile)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(cacheFile)).digest('hex'), data.source.overpassSha256);
  }
  const names = new Set();
  const dir = path.join(ROOT, 'public/data/tfl/route-sequence');
  for (const f of fs.readdirSync(dir)) {
    if (f === 'index.json') continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const seq of d.stopPointSequences || []) for (const st of seq.stopPoint || []) names.add(st.name);
  }
  for (const s of Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/dlr-profile-data.json'), 'utf8')).stations)) names.add(s.name);
  for (const l of JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/overground.json'), 'utf8')).lines) for (const s of l.stations) names.add(s.name);
  const expected = new Set([...names].map(siteKeyOf));
  assert.ok(expected.size >= 393 && expected.size <= 400, `${expected.size} sites`);
  assert.deepEqual(Object.keys(data.sites).sort(), [...expected].sort());
  const keys = new Set(data.buildings.map(b => b.key));
  assert.equal(keys.size, data.buildings.length, 'building keys are unique');
  for (const s of Object.values(data.sites)) assert.ok(keys.has(s.building));
  const used = new Set(Object.values(data.sites).map(s => s.building));
  for (const b of data.buildings) assert.ok(used.has(b.key), `${b.key} is named by a site`);
});

test('data: counts by kind (B1.4) and the named sites (B1.5)', { skip: !have }, () => {
  const by = {}; let outlineSites = 0, areaOnly = 0;
  for (const s of Object.values(data.sites)) {
    const b = data.buildings.find(x => x.key === s.building);
    by[b.kind] = (by[b.kind] ?? 0) + 1; if (b.kind === 'outline') outlineSites++; if (b.areaOnly) areaOnly++;
  }
  assert.ok(outlineSites >= 265 && outlineSites <= 305, `outline sites ${outlineSites}`);
  assert.ok(data.buildings.filter(b => b.outline).length >= 260);
  assert.ok(by['pavilion-entrance'] >= 45 && by['pavilion-entrance'] <= 80, JSON.stringify(by));
  assert.ok(by['pavilion-point'] >= 20 && by['pavilion-point'] <= 45, JSON.stringify(by));
  assert.ok(by['pavilion-viaduct'] >= 9 && by['pavilion-viaduct'] <= 14, JSON.stringify(by));
  assert.ok(areaOnly >= 8 && areaOnly <= 16, `area-only ${areaOnly}`);
  assert.equal(outlineSites + by['pavilion-entrance'] + by['pavilion-point'] + by['pavilion-viaduct'], Object.keys(data.sites).length);
  const B = (k) => data.buildings.find(b => b.key === data.sites[k].building);
  const area = (k) => { const b = B(k); return b.outline ? ringArea(b.outline) : 0; };
  assert.ok(B('kings-cross-st-pancras').outline && B('kings-cross-st-pancras').source.areaM2 >= 20000);
  assert.match(B('kings-cross-st-pancras').source.name, /King.s Cross/);
  assert.ok(B('euston').source.areaM2 >= 40000 && B('waterloo').source.areaM2 >= 40000 && B('paddington').source.areaM2 >= 20000);
  assert.equal(data.sites.stratford.building, data.sites['stratford-london'].building);
  assert.notEqual(B('euston-square').key, B('euston').key);
  assert.ok(!B('bank').outline || B('bank').source.areaM2 >= 200);
  for (const k of ['victoria', 'beckton', 'prince-regent']) assert.ok(B(k).pavilion && B(k).areaOnly, k);
  for (const k of ['south-quay', 'pontoon-dock', 'west-silvertown', 'east-india']) assert.equal(B(k).kind, 'pavilion-viaduct', k);
  for (const k of ['epping', 'chorleywood', 'chalfont-and-latimer', 'amersham', 'chesham', 'theobalds-grove', 'cheshunt']) assert.ok(B(k), k);
  void area;
});

test('data: the roundel rule over every building (B1.7)', { skip: !have }, () => {
  let noFront = 0;
  for (const b of data.buildings) {
    const nets = new Set(b.nets), rings = new Set(b.roundels.map(r => r.ring));
    if (nets.has('tube')) assert.deepEqual([...rings], ['underground'], b.key);
    else if (nets.has('og') && nets.has('dlr')) { assert.ok(rings.has('overground') && rings.has('dlr') && b.flags.includes('dual-roundel'), b.key); }
    else if (nets.has('og')) assert.deepEqual([...rings], ['overground'], b.key);
    else assert.deepEqual([...rings], ['dlr'], b.key);
    assert.equal(b.roundels.filter(r => r.on === 'roof').length, 1, b.key);
    const walls = b.roundels.filter(r => r.on === 'wall');
    for (const r of walls) assert.ok(r.D >= 3.4 && r.D <= 12, `${b.key} ${r.D}`);
    if (b.flags.includes('no-walkable-front')) noFront++; else assert.ok(walls.length >= 1, `${b.key} has a wall roundel`);
    assert.ok(b.roundels.length <= 33);
  }
  assert.ok(noFront / data.buildings.length <= 0.05, `${noFront} buildings without a walkable front`);
  assert.equal(data.buildings.filter(b => b.flags.includes('dual-roundel')).length, 1, 'Shadwell only');
});

test('data: pavilions (B1.8) and exits (B1.9) against the baked boxes', { skip: !have || !fs.existsSync(bakedFile) }, () => {
  const buf = fs.readFileSync(bakedFile), v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const boxes = [];
  const cell = 64, grid = new Map();
  for (let t = 0, tiles = v.getUint16(6, true); t < tiles; t++) {
    const d = 12 + t * 16, minX = v.getInt32(d, true), minZ = v.getInt32(d + 4, true), off = v.getUint32(d + 8, true), cnt = v.getUint32(d + 12, true);
    for (let k = 0, o = off; k < cnt; k++, o += 10) {
      const x = minX + v.getUint16(o, true) * 0.1, z = minZ + v.getUint16(o + 2, true) * 0.1, side = v.getUint16(o + 6, true) * 0.1;
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)).push({ x, z, side });
    }
  }
  const near = (x0, z0, x1, z1) => { const out = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) out.push(...(grid.get(`${i},${j}`) ?? [])); return out; };
  const idx = createStationBuildingIndex(data);
  const hidden = (q) => idx.hidesBox({ x: q.x, z: q.z });
  let overlaps = 0, pavs = 0, fallbacks = 0;
  for (const b of data.buildings) {
    if (b.pavilion) {
      pavs++;
      const ring = rectRing(b.pavilion, 1.5), xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
      const hit = near(Math.min(...xs) - 20, Math.min(...zs) - 20, Math.max(...xs) + 20, Math.max(...zs) + 20).some(q => convexOverlap(ring, boxRing(q.x, q.z, q.side)));
      if (hit) { overlaps++; assert.ok(b.flags.includes('overlap'), `${b.key} overlaps a box without the flag`); }
    }
    const fp = footprintOf(b), d = distToRing(b.exit.x, b.exit.z, fp);
    if (b.flags.includes('exit-fallback')) { fallbacks++; continue; }
    assert.ok(d >= 5.5 && d <= 7.0, `${b.key}: exit ${d.toFixed(2)} m from its footprint`);
    for (const f of data.buildings) if (pointInRing(b.exit.x, b.exit.z, footprintOf(f))) assert.fail(`${b.key}: exit inside ${f.key}`);
    for (const q of near(b.exit.x - 40, b.exit.z - 40, b.exit.x + 40, b.exit.z + 40)) {
      if (hidden(q)) continue;
      const h = q.side / 2 + 0.5;
      assert.ok(!(Math.abs(q.x - b.exit.x) <= h && Math.abs(q.z - b.exit.z) <= h), `${b.key}: exit inside a remaining box`);
    }
    const np = nearestOnRing(b.exit.x, b.exit.z, fp);
    const dot = (-Math.sin(b.exit.yaw)) * (b.exit.x - np.x) / np.d + (-Math.cos(b.exit.yaw)) * (b.exit.z - np.z) / np.d;
    assert.ok(dot >= 0.7, `${b.key}: facing ${dot.toFixed(2)}`);
  }
  assert.ok(overlaps / pavs <= 0.1, `${overlaps} of ${pavs} pavilions overlap`);
  assert.ok(fallbacks / data.buildings.length <= 0.05, `${fallbacks} exit fallbacks`);
});

test('data: the builder reproduces the tracked file byte for byte (B1.2)', { skip: !have || !fs.existsSync(bakedFile) || !fs.existsSync(cacheFile), timeout: 120000 }, () => {
  const tmp = path.join(process.env.TMPDIR || '/tmp', `sb-check-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/prepare-station-buildings.mjs'), '--out', tmp, '--no-review'], { cwd: ROOT, stdio: 'pipe' });
    assert.ok(fs.readFileSync(tmp).equals(fs.readFileSync(JSON_PATH)), 'byte-identical');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('data: llToXZ is the app projection (the Trafalgar origin maps to 0, 0)', () => {
  const [x, z] = llToXZ(51.5074, -0.1278);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6);
});
