// overground-routes.test.mjs: sprint 02Oct26f, lane O (D-048 item 5), "Line · towards X" for the Overground's
// platforms, from TfL's bundled route sequences (public/data/tfl/route-sequence-overground/), pinned in node on
// synthetic geometry that has the real lines' forks:
//   * the Weaver at Hackney Downs: northbound "towards Chingford" on one trunk and "towards Cheshunt or Enfield
//     Town" on the other, southbound "towards London Liverpool Street"; at Liverpool Street (a stub, past a
//     connector) "towards Cheshunt, Chingford or Enfield Town";
//   * the Windrush's terminus: one row, to all four southern ends; the Liberty's Romford: exactly one row;
//   * a direction with no station ahead has no row; the route data is its own directory, never route-sequence/;
//   * with no route data, the names of the last station each continuation reaches.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createOvergroundNetworkSource } from '../src/modes/overground-network.js';
import { buildTunnelNetwork } from '../src/modes/pedestrian-tunnels.js';
import { platformRows } from '../src/modes/tube-routes.js';
import { ogNextStations, overgroundRows, ogLineName } from '../src/modes/overground-routes.js';

const VE = 5, GROUND = 20;
const dir = new URL('../public/data/tfl/route-sequence-overground/', import.meta.url);
const load = (id) => {
  const seq = JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'));
  const names = new Map();
  for (const sq of seq.stopPointSequences || []) for (const sp of sq.stopPoint || []) if (sp?.id && !names.has(sp.id)) names.set(sp.id, sp.name);
  return { lineName: seq.lineName || id, orderedLineRoutes: seq.orderedLineRoutes || [], names };
};
const idOf = (routes, name) => { for (const [id, n] of routes.names) if (n.replace(/ Rail Station$/, '') === name) return id; throw new Error(`no ${name}`); };

function run(corners) {
  const pts = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 12));
    for (let k = i ? 1 : 0; k <= n; k++) pts.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, terrainY: GROUND, y: GROUND + 5, cls: 'surface' });
  }
  return pts;
}
function netOf(lineKey, branches, stations) {
  const group = { userData: { linePaths: new Map([[lineKey, branches]]), stationSets: [{ id: lineKey, stations }] } };
  const input = createOvergroundNetworkSource({ group, getGroundY: () => GROUND, getStructuralY: () => GROUND, VE }).input();
  return buildTunnelNetwork({ THREE, VE, branchesByLine: input.branches, stationLayers: input.stationLayers, halfSpacing: 6 });
}
const st = (routes, name, x, z) => ({ id: idOf(routes, name), name: `${name} Rail Station`, pos: { x, y: GROUND, z } });
const rowsAt = (net, routes, name) => {
  const e = net.entrances.find(en => en.name === name);
  return platformRows(net, e, { tubeRoutes: new Map([[`og:weaver`, routes], [`og:windrush`, routes], [`og:liberty`, routes]]) }).map(r => r.label);
};

/** The Weaver as the drawn data has it: a fragment at Liverpool Street 1 km west of the trunks, two parallel trunks that fork beyond Hackney Downs. */
function weaver(routes) {
  const frag = run([[-2500, 0], [-1000, 0]]);
  const chingford = run([[0, 0], [6000, 0], [9000, -2500]]);
  const enfield = run([[0, 0], [300, 10], [4000, 10], [4500, 400], [9000, 1500]]);   // the trunks start at one point, as the drawn Weaver's do
  const stations = [
    st(routes, 'London Liverpool Street', -2700, 0),          // 200 m past the fragment's end: a stub
    st(routes, 'Bethnal Green', -500, 150),                   // beside the gap connector
    st(routes, 'Cambridge Heath (London)', 1000, 5), st(routes, 'London Fields', 2000, 5), st(routes, 'Hackney Downs', 3000, 5),
    st(routes, 'Clapton', 5000, 5), st(routes, 'Chingford', 9000, -2420),
    st(routes, 'Rectory Road', 4500, 400), st(routes, 'Enfield Town', 9000, 1520),
  ];
  return netOf('weaver', [frag, chingford, enfield], stations);
}

test('the route data is its own directory of six lines and an index, and the Tube\'s directory is untouched', () => {
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, ['index.json', 'liberty.json', 'lioness.json', 'mildmay.json', 'suffragette.json', 'weaver.json', 'windrush.json']);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  assert.deepEqual(Object.keys(index.lines).sort(), ['liberty', 'lioness', 'mildmay', 'suffragette', 'weaver', 'windrush']);
  // route-sequence/ (the Tube's: main.js builds a Tube line for every key of its index) holds no Overground line.
  const tube = JSON.parse(readFileSync(new URL('../public/data/tfl/route-sequence/index.json', import.meta.url), 'utf8'));
  for (const id of ['liberty', 'lioness', 'mildmay', 'suffragette', 'weaver', 'windrush']) {
    assert.equal(id in tube.lines, false, id);
    assert.equal(existsSync(new URL(`../public/data/tfl/route-sequence/${id}.json`, import.meta.url)), false, id);
  }
  assert.equal(ogLineName('og:weaver'), 'Weaver');
});

test('the Weaver at Hackney Downs: Chingford one way, Cheshunt or Enfield Town the other, London Liverpool Street back', () => {
  const routes = load('weaver');
  const net = weaver(routes);
  const rows = rowsAt(net, routes, 'Hackney Downs');
  assert.ok(rows.includes('Weaver · towards Chingford'), JSON.stringify(rows));
  assert.ok(rows.includes('Weaver · towards Cheshunt or Enfield Town'), JSON.stringify(rows));
  assert.ok(rows.includes('Weaver · towards London Liverpool Street'), JSON.stringify(rows));
  // Two parallel trunks, two southbound platforms to the same next station: one row (the key is the next station).
  assert.equal(rows.filter(r => r === 'Weaver · towards London Liverpool Street').length, 1);
  assert.equal(rows.length, 3);
});

test('the Weaver at Liverpool Street (a stub past a connector): towards Cheshunt, Chingford or Enfield Town; one row, no way out the other side', () => {
  const routes = load('weaver');
  const net = weaver(routes);
  assert.ok(net.paths.some(p => p.og.some(r => r.kind === 'gap')), 'the connector is in the network');
  assert.ok(net.paths.some(p => p.og.some(r => r.kind === 'stub')), 'and the stub');
  assert.deepEqual(rowsAt(net, routes, 'London Liverpool Street'), ['Weaver · towards Cheshunt, Chingford or Enfield Town']);
});

test('the Windrush at its terminus Highbury & Islington: one row, to all four southern ends; the Liberty\'s Romford: exactly one row', () => {
  const w = load('windrush');
  const wnet = netOf('windrush', [run([[0, 0], [5000, 0]])], [
    st(w, 'Highbury & Islington', -200, 0), st(w, 'Canonbury', 600, 5), st(w, 'Dalston Junction', 1500, 5), st(w, 'Haggerston', 2500, 5)]);
  assert.deepEqual(rowsAt(wnet, w, 'Highbury & Islington'), ['Windrush · towards Clapham Junction, Crystal Palace, New Cross ELL or West Croydon']);
  // Mid-line, northbound: towards Highbury & Islington.
  assert.ok(rowsAt(wnet, w, 'Dalston Junction').includes('Windrush · towards Highbury & Islington'));
  const l = load('liberty');
  const lnet = netOf('liberty', [run([[0, 0], [6000, 0]])], [st(l, 'Romford', -70, 0), st(l, 'Emerson Park', 3000, 5), st(l, 'Upminster', 5990, 20)]);
  assert.deepEqual(rowsAt(lnet, l, 'Romford'), ['Liberty · towards Upminster']);
  assert.deepEqual(rowsAt(lnet, l, 'Upminster'), ['Liberty · towards Romford'], 'the far end: nothing leaves it eastwards');
});

test('ogNextStations looks past a junction to every continuation (except straight back) and not past a station', () => {
  const routes = load('weaver');
  const net = weaver(routes);
  // The first path with Clapton: from London Fields northbound the next station is Hackney Downs only (a station ends the look).
  const lf = net.paths.flatMap(p => p.stops).find(x => x.stop.name.startsWith('London Fields')).stop;
  const next = ogNextStations(net, lf.path, lf.s, 1);
  assert.deepEqual(next.map(n => n.name.replace(' Rail Station', '')), ['Hackney Downs']);
  // Past the fragment's end (west of the connector): the walk from the fragment's start reaches Bethnal Green via the connector.
  const ls = net.paths.flatMap(p => p.stops).find(x => x.stop.name.startsWith('London Liverpool Street')).stop;
  const n2 = ogNextStations(net, ls.path, ls.s, -1);
  assert.deepEqual(n2.map(n => n.name.replace(' Rail Station', '')), ['Bethnal Green']);
  // The direction beyond a stub's end has nothing.
  assert.deepEqual(ogNextStations(net, ls.path, ls.s, 1), []);
});

test('with no route data the label is the last station each continuation reaches (and a terminus direction still has no row)', () => {
  const routes = load('weaver');
  const net = weaver(routes);
  const e = net.entrances.find(en => en.name === 'Hackney Downs');
  const rows = platformRows(net, e, { tubeRoutes: new Map() }).map(r => r.label);
  assert.ok(rows.some(r => /towards Chingford$/.test(r)), JSON.stringify(rows));
  assert.ok(rows.some(r => /towards Enfield Town$/.test(r)), JSON.stringify(rows));
  assert.ok(rows.some(r => /towards London Liverpool Street$/.test(r)), JSON.stringify(rows));
  assert.ok(rows.every(r => r.startsWith('Weaver')), 'the line name from the id when no data names it');
  const ls = net.entrances.find(en => en.name === 'London Liverpool Street');
  assert.equal(platformRows(net, ls, { tubeRoutes: new Map() }).length, 1);
});

test('every Overground row has a non-empty towards list and a label that is more than the line name', () => {
  const routes = load('weaver');
  const net = weaver(routes);
  for (const e of net.entrances) {
    for (const r of platformRows(net, e, { tubeRoutes: new Map([['og:weaver', routes]]) })) {
      assert.ok(r.towards.length > 0, `${e.name}: ${r.label}`);
      assert.notEqual(r.label, r.lineName);
      assert.ok(r.label.startsWith('Weaver · towards '));
    }
  }
  assert.equal(typeof overgroundRows, 'function');
});

test('a branch point: both branches are ways on (Willesden Junction: Clapham Junction or Richmond), a twin track beside the walker going back is not', () => {
  const routes = load('mildmay');
  const main = run([[6000, -2000], [60, -60], [0, 0]]);                   // the Stratford piece arrives from the north-east and ends at the branch point
  const richmond = run([[0, 0], [-800, 800]]);                           // the two branches leave it, one south-west, one south-east
  const clapham = run([[0, 0], [500, 900]]);
  const stations = [
    st(routes, 'Stratford (London)', 6040, -2030), st(routes, 'Kensal Rise', 3000, -1000), st(routes, 'Willesden Junction', 200, -200),
    st(routes, 'Acton Central', -300, 300), st(routes, 'Shepherds Bush', 250, 450),
  ];
  const net = netOf('mildmay', [main, richmond, clapham], stations);
  const labels = rowsAt(net, routes, 'Willesden Junction').map(l => l.replace('Mildmay', 'Mildmay'));
  const wj = net.entrances.find(en => en.name === 'Willesden Junction');
  const rows = platformRows(net, wj, { tubeRoutes: new Map([['og:mildmay', routes]]) }).map(r => r.label);
  assert.deepEqual(rows.sort(), ['Mildmay · towards Clapham Junction or Richmond (London)', 'Mildmay · towards Stratford (London)'], JSON.stringify(rows));
  assert.ok(labels.length === 2);
});

test('a twin track that heads back over the track just walked is not a way on: a station behind the walker is never "ahead"', () => {
  const routes = load('weaver');
  // Two parallel pieces 10 m apart that share a station: the walker on one, going east, must not see the other's stations to the west.
  const a = run([[0, 0], [5000, 0]]), b = run([[0, 10], [5000, 10]]);
  const stations = [st(routes, 'London Fields', 1000, 5), st(routes, 'Hackney Downs', 3000, 5), st(routes, 'Clapton', 4000, 5)];
  const net = netOf('weaver', [a, b], stations);
  const hd = net.paths.flatMap(p => p.stops).find(x => x.stop.name.startsWith('Hackney Downs')).stop;
  const east = ogNextStations(net, hd.path, hd.s, 1).map(n => n.name.replace(' Rail Station', ''));
  assert.deepEqual([...new Set(east)], ['Clapton']);
  const west = ogNextStations(net, hd.path, hd.s, -1).map(n => n.name.replace(' Rail Station', ''));
  assert.deepEqual([...new Set(west)], ['London Fields']);
});
