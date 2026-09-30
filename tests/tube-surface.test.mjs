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
  profileTrails, dlrHeightAt, lengthOf, TWIN_NEAR_M, DLR_TWIN_DECK_TOL_M, DLR_SHARE_MAX_DECK_M, DLR_MIN_DECK_PIECE_M,
} from '../scripts/prepare-tube-surface.mjs';
import { deckFromSection, envelope, resolveProfile, denseGraph } from '../scripts/prepare-dlr-deck-heights.mjs';
import { createDlrProfile, DECK_BASIS, dlrHeightLabel } from '../src/dlr-profile.js';

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

// Fix round 1 (verifier, 30Sep26w): the DLR hover printed (y - ground) / VE,
// which is the deck x structureScale (1 / Master): a LiDAR deck of 7.92 m,
// drawn at 7.92 m, read "~7.2m above ground (LiDAR)" at Master 1.1 and
// "~2.6m" at Master 3. The profile now reports heights in true metres and the
// hover reads a deck as its deck. These pin the values, not only the basis.
const bng = () => {
  const origin = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);
  return (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - origin[0], z: origin[1] - n }; };
};
// The verifier's four LiDAR viaduct decks.
const VERIFIER_DECKS = { 1752319982: 7.92, 1752475286: 9.14, 1752783321: 6.73, 1752475204: 6.56 };

test('DLR hover: a measured deck reads as its measurement at every Master (the verifier\'s four decks)', () => {
  const project = bng();
  for (const master of [1, 1.1, 3, 10]) {
    const p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
    p.refresh({ structureScale: 1 / master });
    for (const [id, m] of Object.entries(VERIFIER_DECKS)) {
      assert.equal(deck.nodes[id].m, m); assert.equal(deck.nodes[id].source, 'lidar');
      const i = profileData.nodes.findIndex(n => String(n.id) === id), n = profileData.nodes[i];
      const at = project(n.lat, n.lon);
      // At the node itself, and as the hover samples it (nearest track to a hit point).
      for (const q of [p.sample({ x: 0, z: 0, nodeIndex: i }), p.sample({ x: at.x, z: at.z })]) {
        const d = q._dlrProfile;
        assert.equal(d.deckM, m);
        // Drawn at true size: canonical rise / VE / structureScale, flat ground at 0.
        assert.ok(Math.abs(q.y / 5 * master - d.groundRelativeM) < 1e-9);
        assert.equal(dlrHeightLabel(d), `~${m.toFixed(1)}m above ground (LiDAR)`, `node ${id} at Master ${master}`);
      }
    }
  }
});

test('DLR decks are drawn at their real height at every Master: the 1 m minimum is true size too (D-039)', () => {
  // Before fix round 1 the minimum clearance was not scaled, so it floored
  // every deck at Master metres: at Master 10, 6.9% of the LiDAR decks were
  // drawn at their height, the rest at 10 m.
  const project = bng();
  for (const master of [1.1, 3, 10]) {
    const p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
    p.refresh({ structureScale: 1 / master });
    let lidar = 0, atDeck = 0;
    profileData.nodes.forEach((n, i) => {
      const d = deck.nodes[n.id]; if (d?.source !== 'lidar') return;
      lidar++;
      const q = p.sample({ x: 0, z: 0, nodeIndex: i });
      if (Math.abs(q.y / 5 * master - Math.max(profileData.heightModel.surfaceM, d.m)) < 0.05) atDeck++;
    });
    // The rest are eased by the 8% grade or a portal approach (flat ground here).
    assert.ok(atDeck / lidar > 0.95, `Master ${master}: ${atDeck} of ${lidar} drawn at their deck`);
    for (const s of ['EIN', 'BLA']) {
      const q = p.station({ id: `940GZZDL${s}` });
      assert.ok(Math.abs(q._dlrProfile.groundRelativeM - q._dlrProfile.deckM) < 1e-9, `${s} at Master ${master}`);
    }
  }
});

test('dlrHeightLabel: the deck first, and where the drawing departs from it, how high it is drawn', () => {
  assert.equal(dlrHeightLabel({ groundRelativeM: 7.92, deckM: 7.92, surveyed: true }), '~7.9m above ground (LiDAR)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 25.61, deckM: 10.62, surveyed: true }), '~10.6m above ground (LiDAR; drawn ~25.6m above the terrain here)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 1, deckM: 0, surveyed: true }), '~0.0m above ground (LiDAR; drawn ~1.0m above the terrain here)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 8, deckM: 8, surveyed: false }), '~8.0m above ground (modelled)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 1, deckM: null, surveyed: false }), '~1.0m above ground (modelled)');
  assert.equal(dlrHeightLabel({ groundRelativeM: -18.3, deckM: null, surveyed: false }), '~18.3m below ground (modelled)');
  assert.equal(dlrHeightLabel({ groundRelativeM: NaN }), null);
  assert.equal(dlrHeightLabel(null), null);
});

test('DLR sample: a surface segment does not borrow the deck of the viaduct it meets', () => {
  const p = createDlrProfile({ project: bng(), sampleSurfaceY: () => 0 });
  let checked = 0, surface = 0;
  for (let i = 0; ; i++) {
    const q = p.sample({ x: 0, z: 0, nodeIndex: i }); if (!q || q._dlrProfile.nodeIndex !== i) break;
    if (q._dlrProfile.classification !== 'elevated') continue;
    // Just off the node along every direction: whatever segment is nearest.
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const s = p.sample({ x: q.x + dx, z: q.z + dz }), d = s._dlrProfile;
      const raised = d.classification === 'elevated' || d.classification === 'embankment';
      if (!raised) { assert.equal(d.deckSource, null); assert.equal(d.deckM, null); surface++; }
      else assert.ok(Number.isFinite(d.deckM));
      checked++;
    }
  }
  assert.ok(checked >= 400);
  assert.ok(surface >= 20, `${surface} samples off a viaduct's end node landed on a surface segment`);
});

// Fix round 2 (verifier, 30Sep26w): north of Canning Town the DLR's flyover
// (OSM ways 156792940 and 694613992, decks to 8.8 m) runs directly over the
// Jubilee, beside a lower viaduct (145452870, to 4.1 m). The twin collapse,
// which compared only plan and source class, took the flyover for the lower
// viaduct's other running track, so its deck was drawn nowhere, and the hover
// of the DLR's band on the Jubilee beneath read it. The DLR's level is now the
// deck the shared profile gives it.
// Which of two parallel synthetic lines a BNG point is on: its offset from
// the first (BNG is not aligned with the lon/lat these are built in).
const offsetFrom = pts => { const a = toBng(pts[0]), b = toBng(pts.at(-1)), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return ([e, n]) => ({ across: Math.abs((b[0] - a[0]) * (n - a[1]) - (b[1] - a[1]) * (e - a[0])) / l, along: ((b[0] - a[0]) * (e - a[0]) + (b[1] - a[1]) * (n - a[1])) / l }); };
const deckBy = (pts, below, above) => { const at = offsetFrom(pts); return p => (at(p).across > 6 ? above : below); };

test('DLR twins only at the same deck: a flyover beside a lower viaduct is drawn, running tracks on one deck collapse', () => {
  const low = line(0, 0, 3000, 0, 100), high = line(0, 12, 3000, 12, 100);
  const km = r => r.pieces.reduce((t, p) => t + lengthOf(p.xy), 0) / 1000, at = offsetFrom(low);
  const viaducts = [branch(low, 'viaduct'), branch(high, 'viaduct')];
  // One deck: the two running tracks of one viaduct, one centreline.
  assert.ok(Math.abs(km(collapseLine(viaducts, { heightAt: () => 4 })) - 3) < 0.05);
  assert.ok(Math.abs(km(collapseLine(viaducts)) - 3) < 0.05, 'without decks (every Tube line) as before');
  // Decks 5 m apart: two structures, both drawn.
  assert.ok(Math.abs(km(collapseLine(viaducts, { heightAt: deckBy(low, 4, 9) })) - 6) < 0.05);
  // Within the tolerance (1.5 m): still twins.
  assert.ok(Math.abs(km(collapseLine(viaducts, { heightAt: deckBy(low, 4, 4 + DLR_TWIN_DECK_TOL_M - 0.1) })) - 3) < 0.05);
  // A flyover only over part of the way: that part is drawn, from 30 m
  // (source segments of 10 m here: coverage is decided per segment).
  const fine = [branch(line(0, 0, 3000, 0, 300), 'viaduct'), branch(line(0, 12, 3000, 12, 300), 'viaduct')];
  for (const [len, kept] of [[600, true], [60, true], [10, false]]) {
    const x0 = 1200, heightAt = p => { const q = at(p); return q.across > 6 && q.along > x0 && q.along < x0 + len ? 9 : 4; };
    const r = collapseLine(fine, { heightAt });
    assert.equal(r.pieces.length === 2, kept, `${len} m flyover`);
    if (kept) assert.ok(Math.abs(lengthOf(r.pieces[1].xy) - len) <= 20 + 1, `${len} m flyover kept as ${lengthOf(r.pieces[1].xy).toFixed(0)} m`);
  }
  assert.equal(DLR_MIN_DECK_PIECE_M, 30);
});

test('DLR sharing: a stretch on a deck is never shared, even a viaduct short enough to pass as a bridge', () => {
  const owners = new SegmentIndex(), ownerXY = line(0, 0, 4000, 0, 80).map(toBng);
  owners.addPolyline(ownerXY, () => ({ key: 'tube:jubilee:0', cls: 'surface' }));
  // DLR beside it, at grade except a 150 m viaduct in the middle (under the 200 m bridge rule).
  const pts = line(500, 20, 3500, 20, 300), xy = pts.map(toBng), cls = new Array(300).fill('surface');
  for (let i = 150; i < 165; i++) cls[i] = 'viaduct';
  const piece = { lonlat: pts, xy, cls };
  const onViaduct = ([e]) => { const i = Math.floor((e - xy[0][0]) / 10); return i >= 150 && i < 165 ? 5.2 : 0; };
  const without = splitShared('dlr', [piece], owners);
  assert.equal(without.own.length, 0, 'the source class alone: the short viaduct is a bridge and is shared');
  const withDeck = splitShared('dlr', [piece], owners, { heightAt: (p, c) => (c === 'viaduct' ? onViaduct(p) : 0) });
  assert.equal(withDeck.own.length, 1, 'the deck: the viaduct is the DLR\'s own');
  assert.ok(Math.abs(lengthOf(withDeck.own[0].xy) - 150) < 11, `${lengthOf(withDeck.own[0].xy)} m own`);
  assert.equal(withDeck.shared.length, 2, 'at grade either side: shared');
  // A deck at grade (within DLR_SHARE_MAX_DECK_M): shared as before.
  const low = splitShared('dlr', [piece], owners, { heightAt: () => DLR_SHARE_MAX_DECK_M - 0.5 });
  assert.equal(low.own.length, 0);
});

test('profile supplement: the DLR\'s raised profile track as source trails, chained through two-edge nodes', () => {
  const d = { nodes: [0, 1, 2, 3, 4, 5, 6].map(i => ({ lat: 51.5 + i * 1e-4, lon: 0 })), edges: [
    { a: 0, b: 1, kind: 'elevated' }, { a: 1, b: 2, kind: 'elevated' }, { a: 2, b: 3, kind: 'surface' },
    { a: 3, b: 4, kind: 'embankment' }, { a: 4, b: 5, kind: 'embankment' }, { a: 1, b: 6, kind: 'elevated' }, { a: 5, b: 6, kind: 'tunnel' }] };
  const t = profileTrails(d);
  const key = tr => tr.points.map(p => Math.round((p[1] - 51.5) * 1e4)).join('-');
  assert.deepEqual(t.map(key).sort(), ['0-1', '1-2', '1-6', '3-4-5'].sort(), 'node 1 is a junction; surface and tunnel are not taken');
  for (const tr of t) { assert.equal(tr.source, 'dlr-profile'); for (const s of tr.segments) assert.ok(['viaduct', 'embankment'].includes(s.class)); }
});

test('the tracked dataset: every measured DLR deck is drawn by the DLR\'s own track at its height', () => {
  // The drawn DLR (its own corridors, sampled every 5 m) at the deck the
  // renderer lays it on (dlrHeightAt: sampleForSurfaceRail, as
  // src/tube-surface-rail.js); every LiDAR node raised more than 1.5 m must
  // have drawn track within the collapse's reach (32 m, a twin running track)
  // at its deck (within DLR_TWIN_DECK_TOL_M). Before fix round 2, 71 of 1,430
  // were not, among them the Canning Town flyover, the West India Quay flyover
  // and the Tower Gateway viaduct (missing from the v2 source, now taken from
  // the shared profile). What remains is three single nodes where ways meet.
  const project = bng(), H = dlrHeightAt(), p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
  const dlr = data.lines.find(l => l.id === 'dlr'), own = [];
  for (const b of dlr.branches) {
    const cls = segmentClasses(b.points.length, b.segments);
    for (let i = 0; i < b.points.length - 1; i++) {
      if (cls[i] === 'tunnel') continue;
      const a = toBng(b.points[i]), c = toBng(b.points[i + 1]), n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 5));
      for (let j = 0; j <= n; j++) { const q = [a[0] + (c[0] - a[0]) * j / n, a[1] + (c[1] - a[1]) * j / n]; own.push({ e: q[0], n: q[1], h: H(q, cls[i]) }); }
    }
  }
  const missing = [];
  let checked = 0;
  profileData.nodes.forEach((nd, i) => {
    const d = deck.nodes[nd.id]; if (d?.source !== 'lidar' || !(d.m > DLR_SHARE_MAX_DECK_M)) return;
    if (!p.sample({ x: 0, z: 0, nodeIndex: i })._dlrProfile.deckSource) return; // a portal node, drawn at grade
    checked++;
    const [e, n] = toBng([nd.lon, nd.lat]);
    if (!own.some(o => Math.hypot(o.e - e, o.n - n) <= TWIN_NEAR_M + 3 && Math.abs(o.h - d.m) <= DLR_TWIN_DECK_TOL_M)) missing.push(nd.id);
  });
  assert.ok(checked > 1400, `${checked} measured decks`);
  assert.ok(missing.length <= 3, `${missing.length} measured decks drawn nowhere at their height: ${missing.join(', ')}`);
  for (const id of missing) {
    const i = profileData.nodes.findIndex(n => n.id === id);
    assert.ok(new Set(profileData.edges.filter(e => e.a === i || e.b === i).map(e => e.way)).size >= 2, `node ${id} is not where ways meet`);
  }
  // The flyover the verifier found (ways 156792940 and 694613992): drawn
  // through every node of it that stands above the lower viaduct beside it
  // (145452870, 4.1 m at most), at its deck; its lowest ends converge with
  // that viaduct's deck and are drawn as its twin (checked above).
  const fly = profileData.edges.filter(e => e.way === 156792940 || e.way === 694613992).flatMap(e => [e.a, e.b]);
  let over = 0;
  for (const i of new Set(fly)) {
    const nd = profileData.nodes[i], d = deck.nodes[nd.id]; if (!(d?.m > 5)) continue;
    over++;
    const [e, n] = toBng([nd.lon, nd.lat]);
    assert.ok(own.some(o => Math.hypot(o.e - e, o.n - n) < 3 && Math.abs(o.h - d.m) < 0.3), `flyover node ${nd.id} (${d.m} m) drawn through it at its deck`);
  }
  assert.ok(over >= 12, `${over} flyover nodes above 5 m`);
  // Open DLR track the v2 source lacks, from the shared profile: flagged, raised, and not much.
  const fromProfile = dlr.branches.filter(b => b.source === 'dlr-profile');
  assert.ok(fromProfile.length >= 3 && fromProfile.length <= 8, `${fromProfile.length} corridors from the profile`);
  for (const b of fromProfile) for (const s of b.segments) assert.ok(['viaduct', 'embankment'].includes(s.class));
  assert.ok(dlr.summary.fromProfileM > 300 && dlr.summary.fromProfileM < 1000, `${dlr.summary.fromProfileM} m from the profile`);
  // The stretches added on another deck: real structures, not a second deck for every running track.
  assert.ok(dlr.summary.deckSeparatedM > 1000 && dlr.summary.deckSeparatedM < 3000, `${dlr.summary.deckSeparatedM} m added on another deck`);
});

test('the tracked dataset: the DLR shares only its at-grade track', () => {
  // Every DLR band lies on another line's corridor where the DLR's own track
  // is at grade in the shared profile: sampled every 10 m along the owner's
  // centreline, at-grade DLR track (surface or cutting) is within reach of
  // the band (30 m of shared corridor plus 10 m), and the DLR track nearest
  // the owner's centreline with a deck above DLR_SHARE_MAX_DECK_M is never
  // what the band stands for: it is drawn by the DLR itself (previous test).
  const project = bng(), p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
  const ranges = [];
  for (const l of data.lines) l.branches.forEach(b => { for (const band of b.bands || []) if (band.lines.includes('dlr')) ranges.push({ pts: b.points, j0: band.j0, j1: band.j1 }); });
  for (const o of data.overgroundShared) if (o.lines.includes('dlr')) ranges.push({ pts: overground.lines.find(l => l.id === o.overground).branches[o.branch].points, j0: o.j0, j1: o.j1 });
  assert.ok(ranges.length >= 3);
  let n = 0, atGrade = 0;
  for (const { pts, j0, j1 } of ranges) for (let j = j0; j < j1; j++) {
    const a = project(pts[j][1], pts[j][0]), b = project(pts[j + 1][1], pts[j + 1][0]), k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
    for (let i = 0; i < k; i++) {
      const x = a.x + (b.x - a.x) * i / k, z = a.z + (b.z - a.z) * i / k;
      n++; if (p.sample({ x, z, kinds: ['surface', 'cutting'], maxDistance: 40 })) atGrade++;
    }
  }
  assert.ok(n > 300 && atGrade === n, `${atGrade} of ${n} band samples have the DLR's at-grade track within reach`);
});

test('DLR profile sample with a height reads the deck it is on: the Canning Town flyover and the track beneath', () => {
  const project = bng(), p = createDlrProfile({ project, sampleSurfaceY: () => 0 });
  p.refresh({ structureScale: 1 / 1.1 });
  const i = profileData.nodes.findIndex(n => n.id === 18037891), nd = profileData.nodes[i], at = project(nd.lat, nd.lon);
  assert.equal(deck.nodes[18037891].m, 8.83);
  const top = p.sample({ x: at.x, z: at.z, y: 8.83 * 5 / 1.1 });
  assert.deepEqual(top._dlrProfile.sourceWayIds, [156792940]);
  assert.ok(Math.abs(top._dlrProfile.deckM - 8.83) < 1e-9);
  // At rail-head height (1 m) the same plan position reads a track below the flyover.
  const low = p.sample({ x: at.x, z: at.z, y: 1 * 5 / 1.1 });
  assert.notDeepEqual(low._dlrProfile.sourceWayIds, [156792940]);
  assert.ok(low.y < top.y - 3 * 5 / 1.1, `${low.y} under ${top.y}`);
  // Without a height, the nearest in plan, as before.
  assert.deepEqual(p.sample({ x: at.x, z: at.z })._dlrProfile.sourceWayIds, [156792940]);
});

test('dlrHeightLabel with the drawn height: a cutting or shared track drawn at grade says so; rounding is not a departure', () => {
  assert.equal(dlrHeightLabel({ groundRelativeM: -2, deckM: null, drawnM: 1, surveyed: false }), '~2.0m below ground (modelled; drawn ~1.0m above the terrain here)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 3.3, deckM: null, drawnM: 1.0, surveyed: false }), '~3.3m above ground (modelled; drawn ~1.0m above the terrain here)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 1, deckM: null, drawnM: 1, surveyed: false }), '~1.0m above ground (modelled)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 8.83, deckM: 8.83, drawnM: 8.83, surveyed: false }), '~8.8m above ground (modelled)');
  // drawnM takes the place of the profile's height as what is drawn.
  assert.equal(dlrHeightLabel({ groundRelativeM: 5.36, deckM: 5.36, drawnM: 5.82, surveyed: true }), '~5.4m above ground (LiDAR; drawn ~5.8m above the terrain here)');
  // A deck of 7.35 m drawn at 7.35 m: floating point puts one either side of
  // the printed 0.05 ((7.35).toFixed(1) is 7.3, 7.350000000000001 gives 7.4).
  assert.equal(dlrHeightLabel({ groundRelativeM: 7.350000000000001, deckM: 7.35, surveyed: true }), '~7.3m above ground (LiDAR)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 6.65, deckM: 6.649999999999999, surveyed: true }), '~6.6m above ground (LiDAR)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 7.31, deckM: 7.26, surveyed: true }), '~7.3m above ground (LiDAR)');
  assert.equal(dlrHeightLabel({ groundRelativeM: 7.36, deckM: 7.31, surveyed: true }), '~7.3m above ground (LiDAR; drawn ~7.4m above the terrain here)');
});
