// Sprint 01Oct26h, Lane R (D-042 item 4, D-043 item 4): the open-air track the
// v2 delivery lacked, from OpenStreetMap; tunnel stubs beside open track; the
// stations under a road bridge or their own building; the Overground's viaduct
// decks and piers; the map edge; the Tower Gateway deck under its canopy.
// The builders on synthetic track, and the invariants of the tracked data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { earthworksClass, stitchTrails, clipWay, encodeClasses, RELATION_NAME, lineWays } from '../scripts/fetch-tube-surface-osm.mjs';
import {
  collapseLine, supplementFromOsm, dropTunnelStubs, openStationCoveredWays, openCoveredWays, toBng, lengthOf, SegmentIndex,
  STUB_TUNNEL_MAX_M, STUB_NEAR_M, segmentClasses, realTunnelFromProbe, stubKey, OSM_GAPS, JUNCTION_SNAP_M,
} from '../scripts/prepare-tube-surface.mjs';
import { normaliseForMerge, buildCorridor, drawnOpenFlags, DECK_HALF_W, PIER_SIDE_M } from '../src/surface-rail.js';
import { CANOPIES, CANOPY_QUANTILE } from '../scripts/prepare-dlr-deck-heights.mjs';

const data = JSON.parse(readFileSync(new URL('../public/data/tube-surface.json', import.meta.url)));
const deck = JSON.parse(readFileSync(new URL('../src/dlr-deck-heights.json', import.meta.url)));
const profileData = JSON.parse(readFileSync(new URL('../src/dlr-profile-data.json', import.meta.url)));

// Synthetic track in lon/lat about Trafalgar: metres -> degrees.
const M_LON = 1 / (111320 * Math.cos(51.5 * Math.PI / 180)), M_LAT = 1 / 110540;
const ll = (x, y) => [-0.1278 + x * M_LON, 51.5074 + y * M_LAT];
const line = (x0, y0, x1, y1, n = 40) => Array.from({ length: n + 1 }, (_, i) => ll(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n));
const trailOf = (pts, cls = 'surface', extra = {}) => ({ points: pts, segments: [{ i0: 0, i1: pts.length - 1, class: cls }], ...extra });
const prep = t => { const xy = t.points.map(toBng); return { lonlat: t.points, xy, cls: segmentClasses(t.points.length, t.segments), len: lengthOf(xy), ...(t.source ? { source: t.source } : {}), ...(t.place ? { place: t.place } : {}) }; };
const indexOf = pieces => { const idx = new SegmentIndex(); for (const p of pieces) idx.addPolyline(p.xy, i => ({ cls: p.cls[i] })); return idx; };
const near = (xy, [e, n]) => { let d = Infinity; for (let i = 0; i < xy.length - 1; i++) { const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dy) / l2)); d = Math.min(d, Math.hypot(e - a[0] - dx * t, n - a[1] - dy * t)); } return d; };

test('OSM classes follow pipeline-v2.py earthworks_class exactly', () => {
  assert.equal(earthworksClass({ tunnel: 'yes' }), 'tunnel');
  assert.equal(earthworksClass({ tunnel: 'building_passage' }), 'tunnel');
  assert.equal(earthworksClass({ covered: 'yes', bridge: 'viaduct' }), 'tunnel'); // Heron Quays: a station building over the viaduct
  assert.equal(earthworksClass({ bridge: 'viaduct', layer: '1' }), 'viaduct');
  assert.equal(earthworksClass({ layer: '1' }), 'viaduct');
  assert.equal(earthworksClass({ embankment: 'yes' }), 'embankment');
  assert.equal(earthworksClass({ cutting: 'yes' }), 'cutting');
  assert.equal(earthworksClass({ tunnel: 'no', layer: '-1' }), 'surface');
  assert.equal(earthworksClass({}), 'surface');
});

test('OSM ways: a line\'s own route relations only, clipped to the box, stitched only through two-way nodes', () => {
  const osm = { elements: [
    { type: 'way', id: 1, nodes: [1, 2, 3], geometry: [ll(0, 0), ll(100, 0), ll(200, 0)].map(([lon, lat]) => ({ lon, lat })), tags: { railway: 'subway' } },
    { type: 'way', id: 2, nodes: [3, 4, 5], geometry: [ll(200, 0), ll(300, 0), ll(400, 0)].map(([lon, lat]) => ({ lon, lat })), tags: { railway: 'subway', bridge: 'yes' } },
    { type: 'way', id: 3, nodes: [5, 6], geometry: [ll(400, 0), ll(500, 100)].map(([lon, lat]) => ({ lon, lat })), tags: { railway: 'subway' } },
    { type: 'way', id: 4, nodes: [5, 7], geometry: [ll(400, 0), ll(500, -100)].map(([lon, lat]) => ({ lon, lat })), tags: { railway: 'subway' } },
    { type: 'way', id: 9, nodes: [8, 9], geometry: [ll(0, 50), ll(400, 50)].map(([lon, lat]) => ({ lon, lat })), tags: { railway: 'subway' } },
    { type: 'relation', id: 100, tags: { name: 'Central line: Ealing Broadway → Hainault' }, members: [1, 2, 3, 4].map(ref => ({ type: 'way', ref, role: '' })) },
    { type: 'relation', id: 101, tags: { name: 'Central Line (sidings and rails between switches)' }, members: [{ type: 'way', ref: 9, role: '' }] },
  ] };
  assert.ok(RELATION_NAME.central.test('Central line: White City → Hainault') && !RELATION_NAME.central.test('Central Line (sidings and rails between switches)'));
  const ways = lineWays(osm, 'central');
  assert.deepEqual([...ways.keys()].sort(), [1, 2, 3, 4], 'the sidings relation\'s way is not a running line');
  // Node 5 is a junction (three way ends): 1+2 is one trail, 3 and 4 their own.
  const trails = stitchTrails([...ways.values()]);
  assert.deepEqual(trails.map(t => t.osmWays.join('+')).sort(), ['1+2', '3', '4']);
  const main = trails.find(t => t.osmWays.length === 2);
  assert.deepEqual(encodeClasses(main.cls), [{ i0: 0, i1: 2, class: 'surface' }, { i0: 2, i1: 4, class: 'viaduct' }]);
  // Clipping keeps the runs inside the box, each at least two nodes.
  const [S, W] = ll(-10, -10), [N, E] = ll(250, 10);
  const clipped = clipWay(ways.get(2), [W, S, E, N].map((v, k) => [S, W, N, E][k]));
  assert.equal(clipped.length, 0, 'way 2 has one node inside the box');
  assert.equal(clipWay(ways.get(1), [ll(-10, -10)[1], ll(-10, -10)[0], ll(250, 10)[1], ll(250, 10)[0]])[0].coords.length, 3);
});

test('OSM supplement: a branch is added and reaches its junction, a line runs on to its buffers as one piece, a twin adds nothing', () => {
  const pieces = [prep(trailOf(line(0, 0, 3000, 0, 60)))];
  const index = indexOf(pieces);
  const trails = [
    trailOf(line(0, 12, 3000, 12, 60)),                                                                     // the other running track
    trailOf([...line(1200, 2, 1500, 2, 6), ...line(1500, 2, 1500, 2000, 40).slice(1)], 'surface', { place: 't-branch' }), // leaves the main line at 1500
    trailOf(line(2950, 3, 3240, 3, 29), 'surface', { place: 't-buffers' }),                                 // on past the end, to the buffers
  ].map(t => ({ ...prep(t), place: t.place }));
  trails.sort((a, b) => b.len - a.len);
  const rep = supplementFromOsm(pieces, index, trails);
  assert.equal(rep.added.length, 1, 'the branch, and not the twin');
  const branch = pieces.find(p => p.place === 't-branch');
  assert.ok(branch && lengthOf(branch.xy) > 1950, `branch ${branch && lengthOf(branch.xy)} m`);
  // Its first point is at the junction, on the main line (not 32 m short).
  assert.ok(near(pieces[0].xy, branch.xy[0]) <= JUNCTION_SNAP_M + 0.5, `branch starts ${near(pieces[0].xy, branch.xy[0]).toFixed(1)} m from the main line`);
  // The main line is extended to the buffers, one piece, its old points kept.
  assert.equal(rep.extended.length, 1);
  assert.ok(Math.abs(pieces[0].xy.at(-1)[0] - toBng(ll(3240, 3))[0]) < 1, 'runs on to the buffers');
  assert.ok(pieces[0].from.slice(0, 61).every(f => f === null) && pieces[0].from.at(-1) === 't-buffers');
  assert.equal(pieces.length, 2);
});

test('tunnel stubs: a short tunnel beside the line\'s own open track is dropped; a real tunnel, or one away from open track, stays', () => {
  const open = prep(trailOf(line(0, 0, 3000, 0, 60)));
  const stub = prep(trailOf(line(1000, 15, 1220, 15, 11), 'tunnel'));          // West Hampstead: 220 m, 15 m beside the open track
  const far = prep(trailOf(line(1000, 400, 1300, 400, 15), 'tunnel'));         // 400 m from any open track
  const long = prep(trailOf(line(0, 20, STUB_TUNNEL_MAX_M + 50, 20, 30), 'tunnel')); // too long to be a stub
  const real = prep(trailOf(line(2000, 10, 2200, 10, 10), 'tunnel'));          // OSM has the line in tunnel there
  const pieces = [open, stub, far, long, real];
  const dropped = dropTunnelStubs(pieces, { isRealTunnel: p => (p === real ? 'OSM way 1 (tunnel=yes)' : null) });
  assert.deepEqual(dropped.map(d => d.piece), [stub]);
  assert.deepEqual(dropped.spared.map(s => s.piece), [real]);
  assert.deepEqual(pieces, [open, far, long, real]);
  assert.equal(STUB_NEAR_M, 32);
});

test('the OSM probe decides a real tunnel by a tunnel way of the same line through the stub\'s middle', () => {
  const piece = prep(trailOf(line(0, 0, 200, 0, 10), 'tunnel'));
  const way = (id, name, tunnel, dy) => ({ id, tags: { railway: 'subway', name, ...(tunnel ? { tunnel } : {}) }, geometry: line(-100, dy, 300, dy, 4).map(([lon, lat]) => ({ lon, lat })) });
  const probe = (ways) => ({ candidates: { [stubKey('jubilee', piece)]: {} }, ways });
  assert.match(realTunnelFromProbe('jubilee', piece, probe([way(1, 'Jubilee Line', 'yes', 10)])), /OSM way 1/);
  assert.equal(realTunnelFromProbe('jubilee', piece, probe([way(1, 'Jubilee Line', 'yes', 60)])), null, 'too far from its middle');
  assert.equal(realTunnelFromProbe('jubilee', piece, probe([way(1, 'Metropolitan Line', 'yes', 5)])), null, 'another line\'s tunnel');
  assert.equal(realTunnelFromProbe('jubilee', piece, probe([way(1, 'Jubilee Line', null, 5)])), null, 'open track');
  assert.equal(realTunnelFromProbe('jubilee', piece, { candidates: {}, ways: [] }), undefined, 'not probed');
});

test('station covered ways: a station under a road bridge is open; a station between real tunnels is not; a terminus approach is', () => {
  const piece = (runs) => {
    const pts = [], cls = []; let x = 0;
    for (const [len, c] of runs) { const n = Math.max(1, Math.round(len / 10)); for (let k = 0; k < n; k++) { pts.push(ll(x + len * k / n, 0)); cls.push(c); } x += len; }
    pts.push(ll(x, 0));
    return { lonlat: pts, xy: pts.map(toBng), cls };
  };
  const st = (x) => { const [e, n] = toBng(ll(x, 3)); return { name: 'Stop', e, n }; };
  // Preston Road: open, a 130 m covered way with the stop in it, open.
  let p = piece([[500, 'surface'], [130, 'tunnel'], [500, 'surface']]);
  let out = openStationCoveredWays([p], [st(565)]);
  assert.equal(out.length, 1); assert.ok(p.cls.every(c => c !== 'tunnel')); assert.ok(p.opened.some(Boolean));
  // The same run with no stop beside it stays a tunnel.
  p = piece([[500, 'surface'], [130, 'tunnel'], [500, 'surface']]);
  assert.equal(openStationCoveredWays([p], [st(1500)]).length, 0);
  // A stop in a short daylight gap between real tunnels: the open sides are under 150 m.
  p = piece([[600, 'tunnel'], [100, 'surface'], [130, 'tunnel'], [100, 'surface'], [600, 'tunnel']]);
  assert.equal(openStationCoveredWays([p], [st(765)]).length, 0);
  // Longer than 150 m: a tunnel.
  p = piece([[500, 'surface'], [160, 'tunnel'], [500, 'surface']]);
  assert.equal(openStationCoveredWays([p], [st(580)]).length, 0);
  // Lewisham: open, 85 m under the railway, the platforms to the buffers, the stop at the platforms.
  p = piece([[500, 'surface'], [85, 'tunnel'], [47, 'surface']]);
  out = openStationCoveredWays([p], [st(620)]);
  assert.equal(out.length, 1); assert.equal(out[0].terminus, true);
  // The 60 m rule still opens a road bridge with no stop (unchanged).
  p = piece([[500, 'surface'], [40, 'tunnel'], [500, 'surface']]);
  assert.equal(openCoveredWays(p).length, 1);
});

test('Overground viaducts: the masonry merges once normalised; no deck or pier in the river; stripes untouched; short runs get a pier', () => {
  const path = Array.from({ length: 84 }, (_, i) => ({ x: i * 12, z: 0, terrainY: 0, y: 45, cls: 'viaduct' }));
  const river = (x) => x > 400 && x < 500;
  const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
  buildCorridor(path, out, { pierShortRuns: true, structureClear: (x) => !river(x) });
  const plain = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
  buildCorridor(path, plain);
  // The stripe is built exactly as before.
  assert.deepEqual(out.stripe.map(g => [...g.attributes.position.array]), plain.stripe.map(g => [...g.attributes.position.array]));
  // The mix of indexed piers and strips does not merge as it is (the fault since a095a84)...
  const err = console.error; console.error = () => {};
  try { assert.equal(mergeGeometries(plain.masonry, false), null); } finally { console.error = err; }
  // ...and does once normalised.
  const merged = mergeGeometries(out.masonry.map(normaliseForMerge), false);
  assert.ok(merged && !merged.index && merged.attributes.position.count > 0);
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i++) assert.ok(!river(pos.getX(i)), `masonry vertex at x ${pos.getX(i).toFixed(1)} is in the river`);
  // Piers stand on the ground either side.
  let pierFeet = 0; for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= 0.01) pierFeet++;
  assert.ok(pierFeet >= 8, `${pierFeet} pier-foot vertices`);
  // A viaduct shorter than the pier spacing stands on one pier (as on the DLR).
  const short = Array.from({ length: 6 }, (_, i) => ({ x: i * 12, z: 0, terrainY: 0, y: 45, cls: i > 0 && i < 5 ? 'viaduct' : 'surface' }));
  const o2 = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
  buildCorridor(short, o2, { pierShortRuns: true });
  assert.equal(o2.masonry.filter(g => g.index).length, 1);
  assert.equal(DECK_HALF_W, 10.5); assert.equal(PIER_SIDE_M, 5);
});

test('the map edge: samples beyond it are neither drawn nor counted as drawn open track', () => {
  const path = Array.from({ length: 60 }, (_, i) => ({ x: i * 12, z: 0, terrainY: 0, y: 5, cls: 'surface', offMap: i >= 40 }));
  const out = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
  buildCorridor(path, out, { skipTunnel: true });
  let maxX = -Infinity; for (const g of out.stripe) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) maxX = Math.max(maxX, p.getX(i)); }
  assert.ok(maxX <= 39 * 12 + 1e-6, `stripe reaches x ${maxX}`);
  const f = drawnOpenFlags(path);
  assert.equal(f.slice(0, 40).every(Boolean), true); assert.equal(f.slice(40).some(Boolean), false);
  // The Overground never flags samples, so its runs are untouched by the flag.
  const og = { stripe: [], ballast: [], masonry: [], earth: [], cutShadow: [] };
  buildCorridor(path.map(({ offMap, ...p }) => p), og);
  assert.equal(og.stripe.length, 1);
});

// ── The tracked dataset ────────────────────────────────────────────────────────
const lineOf = id => data.lines.find(l => l.id === id);
const stop = (id, name) => lineOf(id).stations.find(s => s.name.startsWith(name));
/** The line's own corridors' segments, with classes, as BNG polylines. */
const segs = id => lineOf(id).branches.flatMap(b => { const xy = b.points.map(toBng), cls = segmentClasses(b.points.length, b.segments); return cls.map((c, i) => ({ a: xy[i], b: xy[i + 1], c })); });
/** The line's drawn track: its own corridors, and its bands on other lines' corridors. */
const bandSegs = id => data.lines.flatMap(l => l.branches.flatMap(b => (b.bands || []).filter(x => x.lines.includes(id) && l.id !== id).flatMap(x => {
  const xy = b.points.map(toBng), cls = segmentClasses(b.points.length, b.segments), out = [];
  for (let i = x.j0; i < x.j1; i++) out.push({ a: xy[i], b: xy[i + 1], c: cls[i] });
  return out;
})));
const nearestTrack = (id, s, open) => { const p = toBng([s.lon, s.lat]); let d = Infinity; for (const g of [...segs(id), ...bandSegs(id)]) if (open === undefined || (g.c !== 'tunnel') === open) d = Math.min(d, near([g.a, g.b], p)); return d; };

test('the tracked dataset: the Central to Ealing Broadway and round the Hainault loop, open where it is open', () => {
  for (const name of ['West Acton', 'Ealing Broadway', 'Newbury Park', 'Barkingside', 'Fairlop', 'Hainault', 'Grange Hill', 'Chigwell', 'Roding Valley']) {
    const s = stop('central', name);
    assert.equal(s.surface, true, name);
    assert.ok(nearestTrack('central', s, true) < 60, `${name}: own open track ${nearestTrack('central', s, true).toFixed(0)} m away`);
  }
  for (const name of ['Wanstead', 'Redbridge', 'Gants Hill']) {
    const s = stop('central', name);
    assert.equal(s.trackClass, 'tunnel', `${name} stays in tunnel`);
    assert.ok(nearestTrack('central', s, false) < 60, name);
  }
  const c = lineOf('central');
  assert.ok(c.branches.some(b => b.source === 'osm' && b.place === 'central-ealing'));
  // Into Ealing Broadway the Central runs beside the District, inside one
  // corridor: the District's track (drawn before) carries the Central's band.
  assert.ok(lineOf('district').branches.some(b => b.bands?.some(x => x.lines.includes('central'))));
  assert.ok(c.summary.osmAddedM > 2000 && c.summary.osmExtendedM > 10000, JSON.stringify(c.summary));
  assert.deepEqual(OSM_GAPS.central.map(([p]) => p), ['central-ealing', 'central-hainault', 'central-epping']);
});

test('the tracked dataset: the Metropolitan from Harrow-on-the-Hill to Rayners Lane, and the Uxbridge branch on the Piccadilly as before', () => {
  const met = lineOf('metropolitan'), s = stop('metropolitan', 'West Harrow');
  assert.equal(s.surface, true);
  assert.ok(nearestTrack('metropolitan', s, true) < 60, `West Harrow ${nearestTrack('metropolitan', s, true).toFixed(0)} m from the Metropolitan`);
  assert.ok(met.branches.some(b => b.source === 'osm' && b.place === 'metropolitan-west-harrow'));
  // Rayners Lane to Uxbridge is still the Piccadilly's track with the Metropolitan inferred on it.
  assert.equal(stop('metropolitan', 'Rayners Lane').trackInferredFrom, 'piccadilly');
  assert.equal(stop('metropolitan', 'Uxbridge').trackInferredFrom, 'piccadilly');
});

test('the tracked dataset: the DLR into Stratford and to the Lewisham buffers, the Central to the Epping buffers', () => {
  const dlr = lineOf('dlr');
  // Stratford: track to the profile's platform 4a buffers (node 1243926398, raised 3.9 m), 0.2 km v2 lacked.
  const n = profileData.nodes.find(x => x.id === 1243926398), p = toBng([n.lon, n.lat]);
  let best = Infinity; for (const g of segs('dlr')) if (g.c !== 'tunnel') best = Math.min(best, near([g.a, g.b], p));
  assert.ok(best < 5, `Stratford 4a buffers ${best.toFixed(1)} m from drawn DLR track`);
  // Lewisham: the last stretch is open to the buffers (the 85 m under the main line opened as a covered way).
  const lew = stop('dlr', 'Lewisham');
  assert.equal(lew.surface, true);
  const piece = dlr.branches.find(b => { const e = toBng(b.points.at(-1)); return Math.hypot(e[0] - toBng([lew.lon, lew.lat])[0], e[1] - toBng([lew.lon, lew.lat])[1]) < 60; });
  assert.ok(piece, 'a DLR corridor ends at Lewisham');
  const cls = segmentClasses(piece.points.length, piece.segments);
  const xy = piece.points.map(toBng); let openTail = 0;
  for (let i = cls.length - 1; i >= 0 && cls[i] !== 'tunnel'; i--) openTail += Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
  assert.ok(openTail > 400, `open for ${openTail.toFixed(0)} m back from the Lewisham buffers`);
  assert.ok(piece.coveredWays?.length >= 1);
  // Epping: the Central runs on to within 60 m of the station (beyond the map edge, drawn only to the edge).
  const ep = stop('central', 'Epping');
  assert.ok(nearestTrack('central', ep, true) < 60, `Epping ${nearestTrack('central', ep, true).toFixed(0)} m from the Central`);
  // Watford: v2 already ends at the buffers (OSM's track ends there too; the stop point is the building beyond).
  assert.ok(nearestTrack('metropolitan', stop('metropolitan', 'Watford'), true) < 30);
});

test('the tracked dataset: West Hampstead, Wembley Park, Preston Road, Hillingdon and Lewisham are open-air stations; Hatton Cross is in tunnel', () => {
  for (const [id, name] of [['jubilee', 'West Hampstead'], ['jubilee', 'Wembley Park'], ['metropolitan', 'Preston Road'], ['metropolitan', 'Wembley Park'], ['piccadilly', 'Hillingdon'], ['dlr', 'Lewisham']]) {
    assert.equal(stop(id, name).surface, true, `${id} ${name}`);
  }
  // The Jubilee's 227 m tunnel stub beside West Hampstead is gone: no tunnel of the Jubilee within 150 m of the station.
  assert.ok(nearestTrack('jubilee', stop('jubilee', 'West Hampstead'), false) > 150);
  // Hatton Cross: the Piccadilly enters cut-and-cover tunnel about 600 m east of
  // the station and runs on in it to Heathrow (OSM, both vintages): an
  // underground station, which keeps no surface marker like every other.
  assert.equal(stop('piccadilly', 'Hatton Cross').trackClass, 'tunnel');
  const jub = lineOf('jubilee');
  assert.deepEqual(jub.summary.tunnelStubsDropped, [226, 102]);
});

test('the tracked dataset: the tunnel stubs dropped, and those kept as real tunnels on OSM\'s evidence', () => {
  // Dropped (built 01Oct26h): the Jubilee at West Hampstead (226 m) and
  // Wembley Park (102 m); the Circle and District east of South Kensington
  // (121 m, one stub on both lines' data) and the District north of
  // Southfields (125 m), where today's OSM has the line in the open; the DLR at
  // Heron Quays (111 m: covered=yes, the station building over its viaduct).
  const dropped = Object.fromEntries(data.lines.filter(l => l.summary.tunnelStubsDropped).map(l => [l.id, l.summary.tunnelStubsDropped]));
  assert.deepEqual(dropped, { circle: [121], district: [121, 125], jubilee: [226, 102], dlr: [111] });
  // Kept: each is a tunnel in today's OSM, the way named.
  let kept = 0;
  for (const l of data.lines) for (const k of l.summary.tunnelStubsKept || []) {
    kept++;
    assert.match(k.evidence, /^OSM way \d+ \(.+tunnel=yes\) \d+ m from its middle$/, `${l.id} ${k.at}`);
  }
  assert.ok(kept >= 8, `${kept} kept`);
  assert.ok(lineOf('bakerloo').summary.tunnelStubsKept.some(k => /Kensal Green Tunnel/.test(k.evidence)));
  // And no tunnel stub of the West Hampstead kind is left on the Jubilee.
  const pieces = lineOf('jubilee').branches.map(b => ({ xy: b.points.map(toBng), cls: segmentClasses(b.points.length, b.segments) }));
  const open = new SegmentIndex(); for (const p of pieces) p.cls.forEach((c, i) => { if (c !== 'tunnel') open.add(p.xy[i], p.xy[i + 1], {}); });
  for (const p of pieces) if (p.cls.every(c => c === 'tunnel') && lengthOf(p.xy) < STUB_TUNNEL_MAX_M) assert.ok(!p.xy.every(q => open.nearest(q, null, STUB_NEAR_M)), 'a Jubilee tunnel stub beside its open track');
});

test('Tower Gateway: the deck under the station canopy is the canopy-free LiDAR reading, about 9 m, not the roof', () => {
  const c = deck.canopies?.find(x => x.name === 'Tower Gateway canopy');
  assert.ok(c, 'the canopy record is in the data');
  assert.equal(CANOPIES[0].bufferNode, 1536019947); assert.equal(CANOPY_QUANTILE, 0.02);
  const under = Object.entries(deck.nodes).filter(([, v]) => v.canopy === c.name);
  assert.ok(under.length >= 5);
  for (const [id, v] of under) {
    assert.equal(v.source, 'lidar', id);
    assert.ok(v.m > 8.5 && v.m < 9.5, `${id} deck ${v.m} m`);
    assert.ok(v.rawDeckOD - v.deckOD > 3, `${id}: the roof (${v.rawDeckOD} m OD) stands over the deck (${v.deckOD})`);
  }
  // Continuous with the deck measured where the canopy begins (8.6 m, a 3% ramp).
  const edge = deck.nodes['1536019913'];
  assert.equal(edge.source, 'lidar'); assert.ok(!edge.canopy);
  assert.ok(Math.abs(c.deckOD - edge.deckOD) < 1, `${c.deckOD} against ${edge.deckOD} m OD`);
});
