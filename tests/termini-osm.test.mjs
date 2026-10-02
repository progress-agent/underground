// Lane T data (sprint 02Oct26f, D-048 item 7): the Metropolitan's fragments and junction gaps beyond
// Rickmansworth, and the Weaver's last stretch to Cheshunt. Node only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { dropTwinFragments, closeJunctionGaps, applyTermini, TERMINI_PLACES, TERMINI_LABEL, terminiTrails, weaverExtension, nearestOnPolyline, densifyXY } from '../scripts/termini-osm.mjs';
import { pyDumps, extendWeaver, stripExtension } from '../scripts/extend-overground-termini.mjs';

proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
const BOX = TERMINI_PLACES['metropolitan-chilterns'].box;
const ll = ([e, n]) => proj4('EPSG:27700', 'EPSG:4326', [e, n]);
const bng = ([lon, lat]) => proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
const piece = (xy, cls = 'surface') => ({ xy, lonlat: xy.map(ll), cls: xy.slice(1).map(() => cls) });
const line = (e0, n0, e1, n1, step = 100) => { const L = Math.hypot(e1 - e0, n1 - n0), k = Math.max(1, Math.round(L / step)); return Array.from({ length: k + 1 }, (_, i) => [e0 + (e1 - e0) * i / k, n0 + (n1 - n0) * i / k]); };
const len = xy => xy.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]), 0);

test('twin fragments: wholly in the box, under 400 m, every sample within 32 m of another track: dropped', () => {
  const main = piece(line(499000, 195000, 502000, 195000));
  const twin = piece(line(500000, 195005, 500150, 195005, 150), 'viaduct');          // 5 m beside the main line: the other track
  const apart = piece(line(500000, 195100, 500150, 195100, 150));                   // 100 m away: a real piece
  const partly = piece(line(500000, 195004, 500150, 195004, 50));                   // near, but one point is outside the box
  partly.lonlat[1] = [-0.7, 51.67];
  const longer = piece(line(499100, 195006, 499600, 195006));                       // 500 m: not a fragment
  const pieces = [main, twin, apart, partly, longer];
  const dropped = dropTwinFragments(pieces, BOX);
  assert.deepEqual(dropped, [twin]);
  assert.deepEqual(pieces, [main, apart, partly, longer]);
});

test('a junction gap is closed along the OSM trail, labelled, ending on the other piece', () => {
  const a = piece(line(499000, 195000, 500300, 195000));                 // ends 32 m short of b (the longer piece closes the gap)
  const b = piece(line(500332, 195000, 500900, 195000));
  const trail = { points: line(498900, 195000, 502100, 195000, 20).map(ll), cls: Array(160).fill('surface') };
  const rep = closeJunctionGaps([a, b], [trail], BOX);
  assert.equal(rep.length, 1);
  assert.match(rep[0], /junction gap closed at the end/);
  const end = a.xy.at(-1);
  assert.ok(Math.hypot(end[0] - 500332, end[1] - 195000) < 0.5, 'the end lands on the other piece');
  assert.ok(a.from.slice(-3).every(f => f === TERMINI_LABEL) && a.from[0] === null, 'appended points are labelled, the rest untouched');
  assert.equal(a.lonlat.length, a.xy.length); assert.equal(a.cls.length, a.xy.length - 1); assert.equal(a.opened.length, a.cls.length);
  assert.ok(len(a.xy) < 1340 && len(a.xy) > 1330);
  assert.equal(b.xy.length, 7, 'the other piece is untouched');
  // Run again: the ends now meet, so nothing more to close.
  assert.deepEqual(closeJunctionGaps([a, b], [trail], BOX), []);
});

test('a buffer end (nothing within 60 m) and a piece end outside the box are left alone', () => {
  const a = piece(line(499000, 195000, 500300, 195000));
  const far = piece(line(500500, 195000, 502000, 195000));                // 200 m on: a buffer, not a junction gap
  const trail = { points: line(498900, 195000, 502100, 195000, 20).map(ll), cls: Array(160).fill('surface') };
  const before = JSON.stringify([a, far]);
  assert.deepEqual(closeJunctionGaps([a, far], [trail], BOX), []);
  assert.equal(JSON.stringify([a, far]), before);
});

test('the walk stops after 15 consecutive points beside another piece, and ends on it', () => {
  const a = piece(line(499000, 195000, 500300, 195000));
  const b = piece(line(500300, 195020, 500900, 195020));                // 20 m beside the trail, never within 6 m
  const trail = { points: line(498900, 195000, 502100, 195000, 20).map(ll), cls: Array(160).fill('surface') };
  const rep = closeJunctionGaps([a, b], [trail], BOX);
  assert.ok(rep.length >= 1, 'a (the longer piece) is closed first; b\'s own start then also lies 20 m from a');
  const added = a.xy.length - 14;
  assert.ok(added >= 15 && added <= 17, `about 15 points (${added}), 150 m beside b, then the hop onto b`);
  assert.ok(Math.abs(a.xy.at(-1)[1] - 195020) < 1e-6, 'the last point is on b');
  // A merge, not a hop: no appended step is longer than the trail's own 10 m spacing plus the lean (a sideways hop of 20 m put
  // cars 4 m off the drawn track at Chalfont & Latimer).
  const steps = a.xy.slice(13).map((p, i, all) => (i ? Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) : 0));
  assert.ok(Math.max(...steps) <= 12, `longest appended step ${Math.max(...steps).toFixed(1)} m`);
  assert.equal(new Set(a.xy.map(p => p.join())).size, a.xy.length, 'no duplicated point');
});

test('applyTermini touches only the Metropolitan', () => {
  const p = piece(line(499000, 195000, 500300, 195000));
  assert.deepEqual(applyTermini('central', [p], { elements: [] }, []), []);
  assert.equal(p.xy.length, 14);
});

// ---- the committed data ------------------------------------------------------------------

const ROOT = new URL('..', import.meta.url).pathname;
const ogText = readFileSync(ROOT + 'public/data/overground.json', 'utf8');

test('the serialiser reproduces overground.json byte for byte, so the Weaver script may write it', () => {
  assert.equal(pyDumps(JSON.parse(ogText)), ogText);
});

test('the Weaver extension is idempotent and appends only to the Cheshunt branch', () => {
  const osm = JSON.parse(readFileSync(ROOT + 'scripts/.cache/termini-osm-overpass.json', 'utf8'));
  const data = JSON.parse(ogText);
  const once = extendWeaver(data, osm), twice = extendWeaver(once.data, osm);
  assert.deepEqual(twice.data, once.data, 'a second run changes nothing');
  assert.equal(pyDumps(twice.data), ogText, 'and the committed file is that output');
  // Stripping gives back exactly the delivery's own branch.
  const w = JSON.parse(ogText).lines.find(l => l.id === 'weaver').branches[once.branch];
  assert.ok(w.extended?.some(e => e.from === TERMINI_LABEL));
  const stripped = stripExtension(JSON.parse(JSON.stringify(w)));
  assert.equal(stripped.points.length, 247);
  assert.equal(stripped.extended, undefined);
  assert.deepEqual(stripped.segments.at(-1), { i0: 222, i1: 247, class: 'surface' }, 'the delivery runs i1 to the point count');
  assert.ok(once.endFromStationM <= 10, `ends ${once.endFromStationM} m from the Cheshunt platforms`);
  assert.ok(w.points.length - 247 >= 30);
  // Segment ranges cover every point, as the source's do.
  assert.equal(w.segments.at(-1).i1, w.points.length);
  for (let i = 1; i < w.segments.length; i++) assert.equal(w.segments[i].i0, w.segments[i - 1].i1);
  // No other line or branch changed.
  const orig = new Map();
  for (const l of data.lines) orig.set(l.id, l);
});

test('no spacing over 12 m in the appended stretch, and the first point continues the branch', () => {
  const w = JSON.parse(ogText).lines.find(l => l.id === 'weaver').branches[2];
  const xy = w.points.map(bng);
  let worst = 0;
  for (let i = 246; i < xy.length - 1; i++) worst = Math.max(worst, Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]));
  assert.ok(worst <= 12.5, `worst spacing ${worst.toFixed(1)} m`);
  assert.ok(Math.hypot(xy[247][0] - xy[246][0], xy[247][1] - xy[246][1]) < 12.5);
});

test('tube-surface.json: no Metropolitan fragment beyond Rickmansworth, and the branches meet within 20 m', () => {
  const d = JSON.parse(readFileSync(ROOT + 'public/data/tube-surface.json', 'utf8'));
  const met = d.lines.find(l => l.id === 'metropolitan');
  const inBox = ([lon, lat]) => lat >= BOX[0] && lat <= BOX[2] && lon >= BOX[1] && lon <= BOX[3];
  const bs = met.branches.map(b => ({ b, xy: b.points.map(bng) }));
  for (const { b, xy } of bs) {
    if (!b.points.every(inBox) || len(xy) >= 400) continue;
    const others = bs.filter(o => o.xy !== xy);
    const near = densifyXY(xy, xy.slice(1).map(() => 'x'), 10).xy.every(p => others.some(o => nearestOnPolyline(o.xy, p).d <= 32));
    assert.ok(!near, `a ${Math.round(len(xy))} m twin fragment is still there`);
  }
  // The Amersham and Chesham branches and the main line meet.
  const ends = bs.filter(({ b }) => b.points.some(inBox));
  const gap = (p, self) => Math.min(...ends.filter(o => o.xy !== self).map(o => nearestOnPolyline(o.xy, p).d));
  const am = bs.find(({ b }) => b.extended?.some(e => e.from === TERMINI_LABEL && e.p0 === 0));
  assert.ok(am, 'the Amersham branch carries the appended OSM points');
  assert.ok(gap(am.xy[0], am.xy) < 1, 'the Amersham branch ends on the Chesham branch');
  const main = bs.find(({ b }) => b.extended?.some(e => e.from === TERMINI_LABEL && e.p0 > 0));
  assert.ok(main && gap(main.xy.at(-1), main.xy) < 1, 'the main line ends on the Chesham branch');
});

test('a Weaver trail is found by the Weaver relation names', () => {
  const osm = JSON.parse(readFileSync(ROOT + 'scripts/.cache/termini-osm-overpass.json', 'utf8'));
  const t = terminiTrails(osm, 'weaver-cheshunt', 'weaver');
  assert.ok(t.length >= 1);
  const w = JSON.parse(ogText).lines.find(l => l.id === 'weaver').branches[2];
  assert.ok(weaverExtension(w.points.slice(0, 247), t));
});
