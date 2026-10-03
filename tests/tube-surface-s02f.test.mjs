// Lane F (sprint 02Oct26f): the two named data rules of scripts/prepare-tube-surface.mjs,
// LOOP_GAP_JOINS (train-hainault-gaps), LOOP_JOG_SMOOTH (its fix round 2) and STRATFORD_1617_OPEN (train-stratford-1617),
// on synthetic track and on the tracked public/data/tube-surface.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { joinLoopGaps, smoothLoopJogs, openStratford1617, LOOP_GAP_JOINS, LOOP_JOG_SMOOTH, STRATFORD_1617_OPEN, toBng, lengthOf, segmentClasses } from '../scripts/prepare-tube-surface.mjs';

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

test('a gap with a 10 m lateral jog gets a connector that runs on into the other piece, which is trimmed to start where it lands', () => {
  // A heads east and ends at x = 545000; B starts 26 m on and 10 m north of it, heading east too: an S-bend of
  // 10 m over 26 m turns 40 degrees in 8 m, which the train map would re-fair 10 m off the drawn track.
  const A = piece(line(544000, 192000, 545000, 192000, 10)), B = piece(line(545026, 192010, 546200, 192010, 10));
  const bBefore = B.xy.length, bStart = B.xy[0].slice();
  const joins = joinLoopGaps([A, B]);
  assert.equal(joins.length, 1);
  assert.ok(joins[0].advanceM >= 10, `advance ${joins[0].advanceM}`);
  assert.ok(joins[0].maxTurnDeg <= LOOP_GAP_JOINS.maxTurnDeg + 1e-6, `turn ${joins[0].maxTurnDeg}`);
  assert.deepEqual(A.xy.at(-1), B.xy[0], 'A ends exactly where the trimmed B begins');
  assert.ok(B.xy.length < bBefore && B.xy[0][0] > bStart[0] + 9, 'B no longer holds the stretch the connector replaced');
  assert.ok(B.cls.length === B.xy.length - 1 && B.lonlat.length === B.xy.length);
  // Independent check of the joined line: resampled every 2 m, no 8 m stretch turns more than 20 degrees (the train map's kink).
  const pts = [...A.xy.filter(p => p[0] > 544960), ...B.xy.slice(1, 12)];   // A's end and B's start are the same point
  let worst = 0;
  for (let k = 4; k < pts.length - 4; k++) {
    const a = [pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]], b = [pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]];
    worst = Math.max(worst, Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180 / Math.PI);
  }
  assert.ok(worst < 20, `vertex turn ${worst}`);
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

// ── LOOP_JOG_SMOOTH: a dogleg the train map would fair 8 m off the drawn track is smoothed in the drawn track ──
// The turn, in degrees, between the k metres either side, worst over a polyline resampled every 2 m.
const worstTurn = (xy, k = 8) => {
  const P = []; let carry = 0; P.push(xy[0]);
  for (let i = 1; i < xy.length; i++) { const a = xy[i - 1], b = xy[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 2 - carry; d <= L + 1e-9; d += 2) P.push([a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]); carry = (carry + L) % 2; }
  const h = k / 2; let worst = 0;
  for (let i = h; i < P.length - h; i++) {
    const a = [P[i][0] - P[i - h][0], P[i][1] - P[i - h][1]], b = [P[i + h][0] - P[i][0], P[i + h][1] - P[i][1]];
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))))) * 180 / Math.PI);
  }
  return worst;
};
// Grange Hill's shape: a loop track heading west-north-west, a 28 m dogleg north, then on west-north-west (e0675d7's vertices).
const dogleg = () => [...line(546000, 192000, 545128, 192000 + 0, 40), [545100, 192000], [545099, 192028.6], [545080, 192040], ...line(545060, 192052, 544000, 192052, 40)];
const withTags = p => ({ ...p, from: p.xy.map(() => 'central-hainault'), opened: p.cls.map(() => 0) });

test('LOOP_JOG_SMOOTH replaces a dogleg the train map would fair off the track, and keeps the piece\'s ends and arrays in step', () => {
  const p = withTags(piece(dogleg()));
  const before = p.xy.map(q => [...q]), ends = [before[0], before.at(-1)];
  assert.ok(worstTurn(before) > LOOP_JOG_SMOOTH.kinkDeg, `the dogleg turns ${worstTurn(before)} degrees in 8 m before`);
  const out = smoothLoopJogs([p]);
  assert.equal(out.length, 1);
  assert.ok(out[0].strayM > LOOP_JOG_SMOOTH.minStrayM && out[0].strayM < 15, `stray ${out[0].strayM}`);
  assert.deepEqual([p.xy[0], p.xy.at(-1)], ends, 'the piece\'s ends do not move');
  assert.ok(consistent(p), 'xy, lonlat, cls, from and opened stay in step');
  assert.ok(p.cls.every(c => c === 'surface') && p.from.every(f => f === 'central-hainault') && p.opened.every(o => o === 0));
  assert.ok(worstTurn(p.xy) < LOOP_JOG_SMOOTH.kinkDeg, `turn after ${worstTurn(p.xy)} degrees in 8 m, under the train map's kink`);
  assert.ok(Math.abs(lengthOf(p.xy) / lengthOf(before) - 1) < 0.02, `the drawn length changes by under 2 percent (${lengthOf(p.xy)} against ${lengthOf(before)})`);
  assert.deepEqual(smoothLoopJogs([p]), [], 'idempotent: a second run finds no kink to move');
});

test('LOOP_JOG_SMOOTH leaves a mild sidestep, a kink under the stray gate, a kink in tunnel, a window at a piece end, and track outside the box alone', () => {
  const keep = p => JSON.stringify(p.xy);
  // A 2 m sidestep over 10 m of track: the train map keeps its cars within a metre of it, so it stays as drawn.
  const mild = withTags(piece([...line(545600, 192000, 545110, 192000, 10), [545105, 192000], [545100, 192002], ...line(545095, 192002, 544500, 192002, 10)])), mb = keep(mild);
  assert.equal(smoothLoopJogs([mild]).length, 0); assert.equal(keep(mild), mb, 'a sidestep the cars keep within a metre of is not touched');
  // The stray gate itself: the same dogleg, with the gate raised above its stray, is left as drawn.
  const gated = withTags(piece(dogleg())), gb = keep(gated);
  assert.equal(smoothLoopJogs([gated], { ...LOOP_JOG_SMOOTH, minStrayM: 100 }).length, 0); assert.equal(keep(gated), gb);
  const tun = withTags(piece(dogleg(), 'tunnel')), tb = keep(tun);
  assert.equal(smoothLoopJogs([tun]).length, 0); assert.equal(keep(tun), tb, 'a kink in tunnel is not touched');
  const atEnd = withTags(piece([...line(545200, 192000, 545100, 192000, 20), [545099, 192028.6], [545080, 192040]])), ab = keep(atEnd);
  assert.equal(smoothLoopJogs([atEnd]).length, 0); assert.equal(keep(atEnd), ab, 'a window reaching the piece end is the train map\'s');
  const away = withTags(piece(dogleg().map(([x, y]) => [x - 20000, y - 20000]))), ob = keep(away);
  assert.equal(smoothLoopJogs([away]).length, 0); assert.equal(keep(away), ob, 'outside the Hainault box nothing moves');
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
  // At each of the three gap sites (north of Hainault, by Grange Hill, by Roding Valley; e0675d7 had gaps of
  // 26.9, 27.4 and 26.0 m there) the track now meets: some piece end within 90 m of the site lies exactly
  // (0.01 m) on another piece, an end or the line itself, and the end of the piece it joined is no longer a loose end.
  const sites = { 'north of Hainault': [545077, 191531], 'by Grange Hill': [545089, 192394], 'by Roding Valley': [541462, 192827] };
  const all = central.branches.map(b => ({ xy: b.points.map(toBng), joined: (b.extended || []).some(e => e.from === 'gap-join') }));
  for (const [name, [e, n]] of Object.entries(sites)) {
    const meets = all.filter(x => x.joined).some(x => [x.xy[0], x.xy.at(-1)].some(p => Math.hypot(p[0] - e, p[1] - n) <= 90
      && all.some(y => y !== x && distToLine(y.xy, p) < 0.01)));
    assert.ok(meets, `${name}: a joined piece end meets the other track`);
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

test('dataset: no kink on the Hainault loop would carry a train more than a metre off the drawn track (Grange Hill and north of Hainault smoothed)', () => {
  const pieces = central.branches.map(b => { const xy = b.points.map(toBng); const cls = Array(xy.length - 1).fill('tunnel'); for (const sg of b.segments) for (let i = sg.i0; i < sg.i1; i++) cls[i] = sg.class; return { xy, lonlat: b.points.map(p => [...p]), cls }; });
  assert.deepEqual(smoothLoopJogs(pieces), [], 'a second run of the rule moves nothing: the tracked data is already smoothed');
  // e0675d7 had a 28.6 m dogleg at (14917, -12179) scene (BNG 545025 192358, v2 piece joined to OSM track), cars off by 8 m,
  // and a vertex 6.7 m out of line at scene (15085, -11307) (cars off by 1.9 m). Neither stretch kinks any more.
  for (const [name, [e, n]] of Object.entries({ 'Grange Hill': [545025, 192358], 'north of Hainault': [545090, 191600] })) {
    const near = pieces.filter(p => p.xy.some(q => Math.hypot(q[0] - e, q[1] - n) < 150));
    assert.ok(near.length, name);
    for (const p of near) {
      const seg = []; p.xy.forEach((q, i) => { if (Math.hypot(q[0] - e, q[1] - n) < 120) seg.push(q); });
      if (seg.length > 3) assert.ok(worstTurn(seg) < LOOP_JOG_SMOOTH.kinkDeg, `${name}: worst turn ${worstTurn(seg)} degrees in 8 m`);
    }
  }
});
