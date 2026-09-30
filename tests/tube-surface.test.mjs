// Surface railway data for the Tube and the DLR (sprint 30Sep26w, D-041,
// Lane R): the builder's transforms on synthetic track, and the invariants of
// the tracked public/data/tube-surface.json and src/dlr-deck-heights.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import {
  ID_MAP, EXCLUDED, LINE_ORDER, collapseLine, splitShared, SegmentIndex, openCoveredWays, elementaryBands,
  cleanRuns, segmentClasses, encodeSegments, findPortals, inferBandsFromStops, toBng,
} from '../scripts/prepare-tube-surface.mjs';
import { deckFromSection, envelope, resolveProfile, denseGraph } from '../scripts/prepare-dlr-deck-heights.mjs';
import { createDlrProfile, DECK_BASIS } from '../src/dlr-profile.js';

const data = JSON.parse(readFileSync(new URL('../public/data/tube-surface.json', import.meta.url)));
const overground = JSON.parse(readFileSync(new URL('../public/data/overground.json', import.meta.url)));
const deck = JSON.parse(readFileSync(new URL('../src/dlr-deck-heights.json', import.meta.url)));
const profileData = JSON.parse(readFileSync(new URL('../src/dlr-profile-data.json', import.meta.url)));

// Synthetic track in lon/lat about Trafalgar: metres -> degrees.
const M_LON = 1 / (111320 * Math.cos(51.5 * Math.PI / 180)), M_LAT = 1 / 110540;
const line = (x0, y0, x1, y1, n = 40) => Array.from({ length: n + 1 }, (_, i) => [-0.1278 + (x0 + (x1 - x0) * i / n) * M_LON, 51.5074 + (y0 + (y1 - y0) * i / n) * M_LAT]);
const branch = (pts, cls = 'surface') => ({ points: pts, segments: [{ i0: 0, i1: pts.length - 1, class: cls }] });

test('twins: two running tracks 12 m apart collapse to one centreline, a branch survives', () => {
  const up = line(0, 0, 3000, 0), down = line(0, 12, 3000, 12), spur = line(3000, 0, 3000, 2000);
  const { pieces } = collapseLine([branch(up), branch(down), branch(spur)]);
  const km = pieces.reduce((s, p) => s + p.xy.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - p.xy[i][0], q[1] - p.xy[i][1]), 0), 0) / 1000;
  assert.ok(Math.abs(km - 5) < 0.1, `kept ${km} km, want the 3 km line plus the 2 km branch`);
});

test('shared track: a parallel line within 30 m is shared; a crossing and a raised line beside a surface one are not', () => {
  const owners = new SegmentIndex(), owner = line(0, 0, 4000, 0);
  const ownerXY = owner.map(toBng);
  owners.addPolyline(ownerXY, i => ({ key: 'tube:a:0', cls: 'surface' }));
  const piece = (pts, cls) => { const xy = pts.map(toBng); return { lonlat: pts, xy, cls: new Array(xy.length - 1).fill(cls) }; };
  const parallel = splitShared('b', [piece(line(500, 20, 3500, 20), 'surface')], owners);
  assert.equal(parallel.own.length, 0);
  assert.equal(parallel.shared.length, 1);
  const crossing = splitShared('c', [piece(line(2000, -1000, 2000, 1000), 'surface')], owners);
  assert.equal(crossing.shared.length, 0, 'a crossing is not shared track');
  const viaduct = splitShared('d', [piece(line(500, 20, 3500, 20), 'viaduct')], owners);
  assert.equal(viaduct.shared.length, 0, 'a long viaduct beside surface track is its own corridor');
  const tunnel = splitShared('e', [piece(line(500, 5, 3500, 5), 'tunnel')], owners);
  assert.equal(tunnel.shared.length, 0, 'tunnels are never shared');
});

test('covered ways: a tunnel under 60 m between open track is drawn open; a real tunnel stays', () => {
  const xy = line(0, 0, 1000, 0, 100).map(toBng);
  const cls = new Array(100).fill('surface');
  for (let i = 40; i < 44; i++) cls[i] = 'tunnel';   // 40 m under a road bridge
  for (let i = 70; i < 100; i++) cls[i] = 'tunnel';  // into a real tunnel at the end
  const piece = { xy, cls };
  const opened = openCoveredWays(piece);
  assert.equal(opened.length, 1);
  assert.equal(piece.cls[41], 'surface');
  assert.equal(piece.cls[80], 'tunnel');
});

test('bands: owner first, then the data order; ranges split where the set of lines changes', () => {
  const bands = elementaryBands('jubilee', [{ lineId: 'metropolitan', j0: 10, j1: 50 }, { lineId: 'bakerloo', j0: 30, j1: 60 }]);
  assert.deepEqual(bands.map(b => [b.j0, b.j1, b.lines.join('+')]),
    [[10, 30, 'jubilee+metropolitan'], [30, 50, 'jubilee+bakerloo+metropolitan'], [50, 60, 'jubilee+bakerloo']]);
});

test('clean runs: a short brush is not shared, a short sliver inside shared track is', () => {
  const xy = Array.from({ length: 101 }, (_, i) => [i * 10, 0]);
  const keys = Array.from({ length: 100 }, (_, i) => (i >= 10 && i < 20) ? 'k' : (i >= 40 && i < 90 && !(i >= 60 && i < 64)) ? 'k' : null);
  const out = cleanRuns(keys, xy, { minCovered: 150, gapFill: 80 });
  assert.equal(out[15], null, '100 m brush dropped');
  assert.equal(out[61], 'k', '40 m gap filled');
});

test('the tracked dataset: the eleven Tube lines and the DLR, app ids, no Elizabeth', () => {
  assert.deepEqual(data.lines.map(l => l.id), LINE_ORDER);
  assert.ok(!data.lines.some(l => EXCLUDED.has(l.id) || l.id === 'elizabeth'));
  for (const [from, to] of Object.entries(ID_MAP)) { assert.ok(!data.lines.some(l => l.id === from)); assert.ok(data.lines.some(l => l.id === to)); }
  for (const l of data.lines) for (const b of l.branches) {
    assert.ok(b.points.length >= 2);
    for (const s of b.segments) assert.ok(['surface', 'tunnel', 'viaduct', 'cutting', 'embankment'].includes(s.class));
    const cls = segmentClasses(b.points.length, b.segments);
    assert.deepEqual(encodeSegments(cls), b.segments, 'segments are run-length encoded per source segment');
    for (const band of b.bands || []) {
      assert.ok(band.j0 >= 0 && band.j1 <= b.points.length - 1 && band.j1 > band.j0);
      assert.equal(band.lines[0], l.id, 'owner first');
      assert.ok(band.lines.length >= 2 && band.lines.every(x => LINE_ORDER.includes(x)));
    }
  }
});

test('shared with the Overground: Bakerloo with Lioness to Harrow & Wealdstone, District with Mildmay to Richmond', () => {
  const km = (id, og) => (data.lines.find(l => l.id === id).summary.sharedM[`overground:${og}`] ?? 0) / 1000;
  assert.ok(km('bakerloo', 'lioness') > 10, `Bakerloo-Lioness ${km('bakerloo', 'lioness')} km`);
  assert.ok(km('district', 'mildmay') > 4, `District-Mildmay ${km('district', 'mildmay')} km`);
  const ogIds = new Set(overground.lines.map(l => l.id));
  for (const b of data.overgroundShared) {
    assert.ok(ogIds.has(b.overground));
    const og = overground.lines.find(l => l.id === b.overground).branches[b.branch];
    assert.ok(og && b.j0 >= 0 && b.j1 <= og.points.length - 1 && b.j1 > b.j0);
    assert.equal(b.lines[0], b.overground);
  }
  // Tube lines sharing Tube track: the Metropolitan on the Jubilee's (Finchley
  // Road to Wembley Park), the Hammersmith & City on the District's and Circle's.
  const tubeShared = (id, owner) => (data.lines.find(l => l.id === id).summary.sharedM[`tube:${owner}`] ?? 0) / 1000;
  assert.ok(tubeShared('metropolitan', 'jubilee') > 6);
  assert.ok(tubeShared('hammersmith-city', 'district') > 5);
});

test('portals: every one is a tunnel-to-open change on its line, with lengths, bearing and nearest station', () => {
  let major = 0;
  for (const l of data.lines) for (const p of l.portals) {
    assert.equal(p.lineId, l.id);
    assert.match(p.id, new RegExp(`^${l.id}-\\d+$`));
    assert.ok(p.tunnelM > 0 && p.openM > 0 && p.bearingIntoOpenDeg >= 0 && p.bearingIntoOpenDeg < 360);
    assert.ok(['surface', 'viaduct', 'cutting', 'embankment'].includes(p.openClass));
    assert.ok(p.nearestStation?.name);
    if (!p.minor) major++;
  }
  assert.ok(major > 40, `${major} portals`);
  const met = data.lines.find(l => l.id === 'metropolitan').portals.filter(p => !p.minor && p.nearestStation.name.startsWith('Finchley Road'));
  assert.ok(met.length >= 1, 'the Metropolitan comes out of tunnel at Finchley Road');
  assert.equal(data.lines.find(l => l.id === 'victoria').portals.length, 0);
});

test('stations: open-air stops are surface; the Metropolitan\'s Uxbridge stops sit on the Piccadilly\'s track', () => {
  const met = data.lines.find(l => l.id === 'metropolitan');
  const ux = met.stations.find(s => s.name.startsWith('Uxbridge'));
  assert.equal(ux.surface, true);
  assert.equal(ux.trackInferredFrom, 'piccadilly');
  const pic = data.lines.find(l => l.id === 'piccadilly');
  assert.ok(pic.branches.some(b => b.bands?.some(x => x.lines.includes('metropolitan') && x.inferred?.includes('metropolitan'))));
  assert.equal(data.lines.find(l => l.id === 'victoria').stations.filter(s => s.surface).length, 0);
  assert.ok(data.lines.find(l => l.id === 'dlr').stations.filter(s => s.surface).length > 30);
});

test('inferred bands need at least three orphan stops on one corridor', () => {
  const xy = line(0, 0, 3000, 0).map(toBng);
  const st = (x, y) => { const [e, n] = toBng([-0.1278 + x * M_LON, 51.5074 + y * M_LAT]); return { name: `s${x}`, e, n, trackClass: null }; };
  assert.equal(inferBandsFromStops({ id: 'x', stations: [st(100, 20), st(1500, 30)] }, [['tube:y:0', xy]]).length, 0);
  const r = inferBandsFromStops({ id: 'x', stations: [st(100, 20), st(1500, 30), st(2900, 10)] }, [['tube:y:0', xy]]);
  assert.equal(r.length, 1);
  assert.ok(r[0].j0 <= 2 && r[0].j1 >= 38);
});

// ── DLR deck heights (EA LiDAR) ─────────────────────────────────────────────
test('every DLR elevated or embankment node has a measured, interpolated or flagged fallback deck', () => {
  const kinds = profileData.nodes.map(() => new Set());
  for (const e of profileData.edges) { kinds[e.a].add(e.kind); kinds[e.b].add(e.kind); }
  let raised = 0;
  const counts = { lidar: 0, interpolated: 0, fallback: 0 };
  profileData.nodes.forEach((n, i) => {
    if (!kinds[i].has('elevated') && !kinds[i].has('embankment')) return;
    raised++;
    const d = deck.nodes[n.id];
    assert.ok(d, `node ${n.id} has a deck record`);
    assert.ok(['lidar', 'interpolated', 'fallback'].includes(d.source));
    assert.ok(Number.isFinite(d.m) && d.m >= 0 && d.m <= 22, `deck ${d.m} m`);
    if (d.source !== 'lidar') assert.ok(d.reason, 'a non-measured deck says why');
    if (d.source === 'fallback') assert.equal(d.m, d.kind === 'elevated' ? profileData.heightModel.elevatedM : profileData.heightModel.embankmentM);
    counts[d.source]++;
  });
  assert.equal(Object.keys(deck.nodes).length, raised);
  assert.ok(counts.lidar / raised > 0.8, `measured ${counts.lidar} of ${raised}`);
  const elevated = Object.values(deck.nodes).filter(d => d.kind === 'elevated' && d.source === 'lidar').map(d => d.m).sort((a, b) => a - b);
  const med = elevated[elevated.length >> 1];
  assert.ok(med > 4 && med < 12, `median measured viaduct ${med} m`);
  assert.match(deck.sources.dsm.coverageId, /LZ_DSM_1m$/);
  assert.match(deck.sources.dtm.coverageId, /DTM_1m$/);
});

test('deck from a DSM section: centre on the structure, at grade whatever stands beside, else the wide median', () => {
  const g = 3;
  //                 -6  -5  -4  -3  -2  -1   0   1   2   3   4   5   6
  assert.equal(deckFromSection([3, 3, 12, 12, 12, 12, 12, 12, 12, 12, 16, 16, 16], g), 12);   // canopy over the outer samples
  assert.equal(deckFromSection([9, 9, 9, 3.2, 3.1, 3, 3, 3.1, 3.2, 3, 9, 9, 9], g), 3.1);     // track at grade, walls beside
  assert.equal(deckFromSection([14, 14, 14, 14, 14, 14, 3, 3, 3, 3, 3, 3, 3], g), 14);        // OSM line at the deck's edge: three central samples on it
  assert.equal(deckFromSection([14, 14, 14, 14, 14, null, null, null, 3, 3, 3, 3, 3], g), 14); // centre undecided: the wide median on the structure
  assert.equal(deckFromSection([14, 14, 14, 14, 3, 3, 3, 3, 3, 3, 3, 3, 3], g), 3);           // centre mostly on the ground: at grade
  assert.equal(deckFromSection([null, null, null, null, null, null, null, null, null, null, null, null, null], g), null);
});

test('occlusion: a roof over a level deck is bridged; a real ramp is kept', () => {
  // A chain of samples 3 m apart: a 10 m deck with a 60 m roof at 20 m over it,
  // then a 5% ramp down to the ground.
  const n = 120, samples = [], adj = [];
  for (let i = 0; i < n; i++) {
    const deckOD = i < 60 ? 10 : Math.max(0, 10 - (i - 60) * 3 * 0.05);
    const roof = i >= 20 && i < 40;
    samples.push({ section: Array(13).fill(roof ? 20 : deckOD), groundRaw: 0 });
    adj.push([]); if (i) { adj[i].push([i - 1, 3]); adj[i - 1].push([i, 3]); }
  }
  const out = resolveProfile(samples, adj);
  for (let i = 20; i < 40; i++) { assert.equal(out[i].source, 'interpolated'); assert.ok(Math.abs(out[i].deck - 10) < 0.01, `roof bridged at ${i}: ${out[i].deck}`); }
  for (let i = 70; i < 110; i++) { assert.equal(out[i].source, 'lidar'); assert.ok(Math.abs(out[i].deck - Math.max(0, 10 - (i - 60) * 0.15)) < 0.2, `ramp kept at ${i}`); }
});

test('envelope: the grade-limited lower envelope over a graph', () => {
  const adj = [[[1, 10]], [[0, 10], [2, 10]], [[1, 10]]];
  const e = envelope(3, adj, Float64Array.from([5, Infinity, 20]), 0.1);
  assert.deepEqual([...e], [5, 6, 7]);
});

test('the shared DLR profile reads the measured decks: surveyed where measured, flagged where not', () => {
  const origin = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);
  const project = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - origin[0], z: origin[1] - n }; };
  const p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
  const ein = p.station({ id: '940GZZDLEIN', structureScale: 1 });
  assert.equal(ein._dlrProfile.surveyed, true);
  assert.equal(ein._dlrProfile.heightBasis, DECK_BASIS.lidar);
  assert.ok(ein.y / 5 > 5 && ein.y / 5 < 13, `East India deck ${ein.y / 5} m`);
  // Without the measurement the profile falls back to the illustrative 8 m.
  const flat = createDlrProfile({ project, sampleSurfaceY: () => 0, deckHeights: null });
  const ein0 = flat.station({ id: '940GZZDLEIN', structureScale: 1 });
  assert.equal(ein0._dlrProfile.surveyed, false);
  assert.equal(ein0._dlrProfile.deckSource, 'fallback');
  assert.equal(ein0.y / 5, profileData.heightModel.elevatedM);
});

test('dense sample graph: node samples are shared by their edges', () => {
  const d = { nodes: [{}, {}, {}], edges: [{ a: 0, b: 1, kind: 'elevated' }, { a: 1, b: 2, kind: 'elevated' }, { a: 0, b: 2, kind: 'surface' }] };
  const { samples, adj, nodeSample } = denseGraph(d, [[0, 0], [30, 0], [60, 0]]);
  assert.equal(nodeSample.size, 3);
  assert.equal(samples.length, 3 + 9 + 9);
  assert.equal(adj[nodeSample.get(1)].length, 2);
});
