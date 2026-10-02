// Lane F (sprint 02Oct26f): the two named data rules of scripts/prepare-tube-surface.mjs,
// LOOP_GAP_JOINS (train-hainault-gaps) and STRATFORD_1617_OPEN (train-stratford-1617),
// on synthetic track and on the tracked public/data/tube-surface.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { joinLoopGaps, openStratford1617, LOOP_GAP_JOINS, STRATFORD_1617_OPEN, toBng, lengthOf, segmentClasses } from '../scripts/prepare-tube-surface.mjs';

const data = JSON.parse(readFileSync(new URL('../public/data/tube-surface.json', import.meta.url)));

// A piece from BNG points, inside the Hainault box (about 51.60 N, 0.09 E at 545000, 192000).
const piece = (xy, cls = 'surface') => ({
  xy: xy.map(p => [...p]), lonlat: xy.map(p => proj4('EPSG:27700', 'EPSG:4326', p)), cls: Array(xy.length - 1).fill(cls),
});
const line = (x0, y0, x1, y1, step = 20) => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
};
const consistent = p => p.xy.length === p.lonlat.length && p.cls.length === p.xy.length - 1
  && p.from.length === p.xy.length && p.opened.length === p.cls.length;

test('end to end: a loose piece is extended onto the next piece\'s end, once', () => {
  const A = piece(line(544000, 192000, 545000, 192000)), B = piece(line(545027, 192003, 546000, 192003));
  const joins = joinLoopGaps([A, B]);
  assert.equal(joins.length, 1, 'a pair of ends that qualify towards each other is joined once');
  const j = joins[0];
  assert.equal(j.piece, 0); assert.equal(j.at, 'end');
  assert.ok(j.gapM > 26 && j.gapM < 28);
  assert.deepEqual(A.xy.at(-1), B.xy[0], 'A now ends exactly on B\'s end vertex');
  assert.ok(consistent(A), 'xy, lonlat, cls, from and opened stay in step');
  assert.equal(A.from.at(-1), LOOP_GAP_JOINS.label);
  assert.equal(A.from[0], null);
  // The connector is smooth: no step beyond stepM + a little, no turn above 20 degrees at a joint.
  const first = A.from.findIndex(f => f === LOOP_GAP_JOINS.label), tail = A.xy.slice(first - 1);
  assert.ok(tail.length >= 5);
  for (let i = 1; i < tail.length; i++) assert.ok(Math.hypot(tail[i][0] - tail[i - 1][0], tail[i][1] - tail[i - 1][1]) <= LOOP_GAP_JOINS.stepM + 1.5);
  assert.deepEqual(B.xy.length, line(545027, 192003, 546000, 192003).length, 'B is not touched');
});

test('end to side: a piece ending beside a long piece is extended onto it, beyond the foot', () => {
  const A = piece(line(544000, 192000, 545000, 192000));
  // B passes 20 m north of A's end, 15 degrees off, and is 3 km long.
  const a = 15 * Math.PI / 180, B = piece(line(544900, 192020 - 100 * Math.tan(a), 544900 + 3000 * Math.cos(a), 192020 - 100 * Math.tan(a) + 3000 * Math.sin(a), 50));
  const joins = joinLoopGaps([A, B]);
  assert.equal(joins.length, 1);
  assert.ok(joins[0].angleDeg < 20);
  const Q = A.xy.at(-1), d = Math.hypot(Q[0] - 545000, Q[1] - 192000);
  assert.ok(d > 30, 'the connector runs on along B by at least 30 m');
  // Q lies on B.
  let best = Infinity;
  for (let i = 0; i < B.xy.length - 1; i++) {
    const p = B.xy[i], q = B.xy[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], t = Math.max(0, Math.min(1, ((Q[0] - p[0]) * dx + (Q[1] - p[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(Q[0] - p[0] - dx * t, Q[1] - p[1] - dy * t));
  }
  assert.ok(best < 0.01);
  assert.ok(consistent(A));
});

test('a heading more than 35 degrees off is not joined', () => {
  const A = piece(line(544000, 192000, 545000, 192000));
  const a = 60 * Math.PI / 180, B = piece(line(544990, 192020, 544990 + 3000 * Math.cos(a), 192020 + 3000 * Math.sin(a), 50));
  assert.equal(joinLoopGaps([A, B]).length, 0);
});

test('a short twin remnant beside the end is left alone (not an end vertex, under 2 km)', () => {
  const A = piece(line(544000, 192000, 545000, 192000));
  const remnant = piece(line(544950, 192020, 545150, 192020));   // 200 m, its nearest point to A's end is mid-piece
  assert.equal(joinLoopGaps([A, remnant]).length, 0);
});

test('a gap over 35 m, or under 1 m, is left alone; a piece under 300 m is never extended', () => {
  assert.equal(joinLoopGaps([piece(line(544000, 192000, 545000, 192000)), piece(line(545040, 192000, 546000, 192000))]).length, 0);
  assert.equal(joinLoopGaps([piece(line(544000, 192000, 545000, 192000)), piece(line(545000.5, 192000, 546000, 192000))]).length, 0);
  const short = piece(line(544900, 192000, 545000, 192000)), long = piece(line(545020, 192000, 548000, 192000));
  const joins = joinLoopGaps([short, long]);
  assert.ok(joins.every(j => j.piece !== 0), 'the 100 m piece is not extended');
});

test('outside the Hainault box nothing is joined', () => {
  const away = (x, y) => piece(line(x, y, x + 1000, y)), A = away(520000, 182000), B = piece(line(521027, 182000, 522000, 182000));
  assert.equal(joinLoopGaps([A, B]).length, 0);
});

test('a join at a piece\'s start prepends the connector', () => {
  const A = piece(line(545000, 192000, 546000, 192000)), B = piece(line(544000, 192003, 544973, 192003));
  const joins = joinLoopGaps([A, B]);
  assert.equal(joins.length, 1);
  assert.equal(joins[0].at, 'start');
  assert.deepEqual(A.xy[0], B.xy.at(-1));
  assert.equal(A.from[0], LOOP_GAP_JOINS.label); assert.equal(A.from.at(-1), null);
  assert.ok(consistent(A));
});

test('STRATFORD_1617_OPEN opens the tunnel around the stop and nothing else', () => {
  const xy = line(538000, 184400, 538800, 184400, 20);
  const p = { xy, lonlat: xy.map(q => proj4('EPSG:27700', 'EPSG:4326', q)), cls: xy.slice(1).map((_, i) => (i < 5 ? 'surface' : 'tunnel')) };
  const tunnelBefore = p.cls.filter(c => c === 'tunnel').length;
  const out = openStratford1617([p], [{ name: 'Stratford DLR Station', e: 538400, n: 184430 }, { name: 'Elsewhere', e: 538700, n: 184400 }]);
  assert.equal(out.length, 1);
  const half = STRATFORD_1617_OPEN.halfM;
  assert.ok(out[0].lengthM >= half * 2 - 25 && out[0].lengthM <= half * 2 + 25);
  const opened = p.cls.map((c, i) => p.opened[i] ? i : -1).filter(i => i >= 0);
  assert.ok(opened.length > 0 && opened.every(i => p.cls[i] === 'surface'));
  assert.ok(p.cls.filter(c => c === 'tunnel').length === tunnelBefore - opened.length, 'only opened segments changed');
  assert.ok(p.cls.slice(0, 5).every(c => c === 'surface'));
  const midArc = (i) => (i + 0.5) * 20 - 0;   // segment i midpoint, metres from the start
  for (const i of opened) assert.ok(Math.abs(midArc(i) - 400) <= half + 1);
});

test('STRATFORD_1617_OPEN leaves a stop on open track, or far from any track, alone', () => {
  const xy = line(538000, 184400, 538800, 184400, 20);
  const open = { xy, lonlat: xy.map(q => proj4('EPSG:27700', 'EPSG:4326', q)), cls: Array(xy.length - 1).fill('surface') };
  assert.equal(openStratford1617([open], [{ name: 'Stratford DLR Station', e: 538400, n: 184430 }]).length, 0);
  const tun = { ...open, cls: Array(xy.length - 1).fill('tunnel') };
  assert.equal(openStratford1617([tun], [{ name: 'Stratford DLR Station', e: 538400, n: 184600 }]).length, 0, 'more than 100 m from the track');
});

// ── the tracked dataset ──
const central = data.lines.find(l => l.id === 'central'), dlr = data.lines.find(l => l.id === 'dlr');
const ends = b => { const xy = b.points.map(toBng); return { xy, start: xy[0], end: xy.at(-1) }; };
const distToLine = (xy, p) => { let best = Infinity; for (let i = 0; i < xy.length - 1; i++) { const a = xy[i], b = xy[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-9))); best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)); } return best; };

test('dataset: the Hainault loop\'s three gaps are joined (3 to 6 joins in the box)', () => {
  const joined = central.branches.filter(b => (b.extended || []).some(e => e.from === 'gap-join'));
  assert.ok(joined.length >= 3 && joined.length <= 6, `joined pieces: ${joined.length}`);
  const sites = { 'north of Hainault': [545077, 191531], 'by Grange Hill': [545089, 192394], 'by Roding Valley': [541462, 192827] };
  for (const [name, [e, n]] of Object.entries(sites)) {
    // Some Central branch ends on a vertex of, or on, another Central branch within 0.5 m of where a gap was.
    const near = central.branches.map(b => ends(b)).filter(x => Math.hypot(x.end[0] - e, x.end[1] - n) < 60 || Math.hypot(x.start[0] - e, x.start[1] - n) < 60);
    assert.ok(near.length >= 1, name);
    let closed = false;
    for (const x of near) for (const p of [x.start, x.end]) {
      if (Math.hypot(p[0] - e, p[1] - n) > 60) continue;
      for (const y of near) if (y !== x && distToLine(y.xy, p) < 0.5) closed = true;
      for (const b of central.branches) { const xy = b.points.map(toBng); if (xy !== x.xy && xy.length !== x.xy.length && distToLine(xy, p) < 0.5) closed = true; }
    }
    assert.ok(closed, `${name}: a piece end now meets the other track`);
  }
});

test('dataset: the gap-join connectors keep the class of the piece they extend, and are labelled', () => {
  for (const b of central.branches) for (const e of b.extended || []) if (e.from === 'gap-join') {
    const n = e.p1 - e.p0 + 1;
    assert.ok(n >= 2 && n <= 40, `connector of ${n} points`);
    const cls = new Set(); for (const s of b.segments) for (let i = s.i0; i < s.i1; i++) if (i >= e.p0 - 1 && i < e.p1) cls.add(s.class);
    assert.ok(cls.size <= 2);
  }
});

test('dataset: Stratford 16/17 is a covered way of 150 to 300 m on the DLR branch beside the stop', () => {
  const stop = toBng([dlr.stations.find(s => /^Stratford DLR Station/.test(s.name)).lon, dlr.stations.find(s => /^Stratford DLR Station/.test(s.name)).lat]);
  let best = null;
  for (const b of dlr.branches) { const xy = b.points.map(toBng), d = distToLine(xy, stop); if (!best || d < best.d) best = { b, xy, d }; }
  assert.ok(best.d < 100);
  const ranges = best.b.coveredWays || [];
  const lens = ranges.map(r => lengthOf(best.xy.slice(r.i0, r.i1 + 1)));
  assert.ok(lens.some(m => m >= 150 && m <= 300), `covered-way lengths: ${lens.map(Math.round)}`);
  // Opened segments are drawn as surface in the data.
  const cls = segmentClasses(best.b.points.length, best.b.segments);
  for (const r of ranges) for (let i = r.i0; i < r.i1; i++) if (lens.some(m => m >= 150)) assert.notEqual(cls[i], 'tunnel');
});
