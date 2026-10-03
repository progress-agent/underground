// DLR deck joins (sprint 02Oct26f, Lane F): src/dlr-deck-blend.js on synthetic paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendDeckJoins, DEFAULTS } from '../src/dlr-deck-blend.js';

const U = 5;   // canonical units per true metre (structure scale 1)
const path = (x0, z0, x1, z1, y, cls = 'viaduct', n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + (x1 - x0) * i / n, z: z0 + (z1 - z0) * i / n, y: typeof y === 'function' ? y(i / n) : y, cls }));
const stepOf = (a, b) => Math.abs(a - b) / U;
// A path starting at (x0, z0) and running len metres at 15 degrees to the x axis (a flyover leaving a deck that runs along x).
const leave = (x0, z0, len, y, cls = 'viaduct', n = 20) => path(x0, z0, x0 + len * Math.cos(Math.PI / 12), z0 + len * Math.sin(Math.PI / 12), y, cls, n);

test('a flyover starting 9 m beside a viaduct, 1.5 m off, ends up under 0.1 m off, and the through deck is unmoved', () => {
  const through = path(0, 0, 400, 0, 20 * U);                  // the viaduct, 20 m up, 400 m long
  const leaving = leave(200, 9, 300, 21.5 * U, 'viaduct', 60);  // the flyover leaves 9 m beside it, 21.5 m up, a sample every 5 m
  // A 1.5 m step blends over the 30 m minimum.
  const before = through.map(s => s.y);
  const blends = blendDeckJoins([through, leaving], { unitsPerTrueM: U });
  assert.equal(blends.length, 1);
  assert.equal(blends[0].path, 1); assert.equal(blends[0].end, 'start');
  assert.ok(stepOf(leaving[0].y, 20 * U) < 0.1, `step ${stepOf(leaving[0].y, 20 * U)}`);
  assert.deepEqual(through.map(s => s.y), before, 'the through deck is never moved');
  // The blend ends at blendM: samples beyond it keep their height; the one at blendM-ish is nearly unchanged.
  assert.equal(leaving.at(-1).y, 21.5 * U);
  // And it is smooth: a smoothstep over 30 m of a 1.5 m shift never climbs more than 0.08 m per metre
  // (so under 0.04 m between the 0.5 m ray samples of the acceptance probe).
  for (let i = 1; i < leaving.length; i++) assert.ok(Math.abs(leaving[i].y - leaving[i - 1].y) / U / 5 < 0.08);
});

test('a step over 4 m is a different structure and is left alone', () => {
  const through = path(0, 0, 400, 0, 4.1 * U), flyover = leave(200, 8, 300, 11.0 * U);
  assert.equal(blendDeckJoins([through, flyover], { unitsPerTrueM: U }).length, 0);
  assert.equal(flyover[0].y, 11.0 * U);
});

test('the Canning Town case: a 3.4 m step is closed over a longer ramp (15 m of track a metre of step), never over half the path', () => {
  const through = path(0, 0, 400, 0, 0.6 * U);
  const leaving = leave(200, 9.3, 152, 4.0 * U, 'viaduct', 152);   // 152 m long, a sample every 1 m, 3.4 m above the deck at its start
  const blends = blendDeckJoins([through, leaving], { unitsPerTrueM: U });
  assert.equal(blends.length, 1);
  assert.ok(Math.abs(blends[0].stepM + 3.4) < 1e-6 || Math.abs(blends[0].stepM - 3.4) < 1e-6);
  assert.ok(blends[0].lengthM >= 49 && blends[0].lengthM <= 51.5, `ramp ${blends[0].lengthM}`);
  assert.ok(Math.abs(leaving[0].y - 0.6 * U) < 1e-9, 'it starts on the deck');
  assert.equal(leaving.at(-1).y, 4.0 * U);
  // 0.1 m jump limit between the 0.5 m ray samples: at most 1.5 x 3.4 / 51 = 0.1 m per metre, 0.05 m per 0.5 m.
  for (let i = 1; i < leaving.length; i++) assert.ok(Math.abs(leaving[i].y - leaving[i - 1].y) / U <= 0.101);   // samples 1 m apart: the ramp climbs 0.1 m per metre at most
  // A short path is blended over half its length at most.
  const stub = leave(200, 9.3, 50, 4.0 * U, 'viaduct', 50);
  const b2 = blendDeckJoins([path(0, 0, 400, 0, 0.6 * U), stub], { unitsPerTrueM: U });
  assert.ok(b2[0].lengthM <= 25 + 1e-6);
});

test('a step under 5 cm is noise and is left alone; a path beyond reach is left alone', () => {
  const through = path(0, 0, 400, 0, 20 * U);
  const tiny = leave(200, 9, 300, 20 * U + 0.2);            // 0.04 m
  assert.equal(blendDeckJoins([through, tiny], { unitsPerTrueM: U }).length, 0);
  const far = leave(200, 40, 300, 21.5 * U);
  assert.equal(blendDeckJoins([through, far], { unitsPerTrueM: U }).length, 0);
});

test('only raised ends are blended', () => {
  const through = path(0, 0, 400, 0, 2 * U, 'surface'), other = leave(200, 9, 300, 3.5 * U, 'surface');
  assert.equal(blendDeckJoins([through, other], { unitsPerTrueM: U }).length, 0);
  const embank = leave(200, 9, 300, 3.5 * U, 'embankment');
  assert.equal(blendDeckJoins([path(0, 0, 400, 0, 2 * U, 'embankment'), embank], { unitsPerTrueM: U }).length, 1);
});

test('where two paths end at each other, the shorter one moves', () => {
  const long = path(0, 0, 400, 0, 20 * U), short = path(404, 0, 504, 0, 22 * U);
  const blends = blendDeckJoins([long, short], { unitsPerTrueM: U });
  assert.equal(blends.length, 1);
  assert.equal(blends[0].path, 1);
  assert.ok(stepOf(short[0].y, long.at(-1).y) < 0.01);
  assert.equal(long.at(-1).y, 20 * U);
  // Same result whichever order they are given.
  const long2 = path(0, 0, 400, 0, 20 * U), short2 = path(404, 0, 504, 0, 22 * U);
  assert.equal(blendDeckJoins([short2, long2], { unitsPerTrueM: U })[0].path, 0);
});

test('the true-metre step scales with the structure scale (units per true metre)', () => {
  const mk = () => [path(0, 0, 400, 0, 20 * 2.2), leave(200, 9, 300, 21.5 * 2.2)];
  const [a, b] = mk();
  assert.equal(blendDeckJoins([a, b], { unitsPerTrueM: 2.2 }).length, 1);
  assert.ok(Math.abs(b[0].y - 20 * 2.2) / 2.2 < 0.1);
});

test('a step under 1 m is the ordinary junction disagreement and is left alone', () => {
  const through = path(0, 0, 400, 0, 20 * U), near = leave(200, 9, 300, 20.7 * U);
  assert.equal(blendDeckJoins([through, near], { unitsPerTrueM: U }).length, 0);
  assert.equal(near[0].y, 20.7 * U);
});

test('a path that ends across another (a crossing, not a junction) is left alone; one leaving along it is blended', () => {
  const through = path(0, 0, 400, 0, 4 * U);
  const crossing = path(200, 9, 200, 300, 7.5 * U);                  // runs at right angles to the deck it ends beside
  assert.equal(blendDeckJoins([through, crossing], { unitsPerTrueM: U }).length, 0);
  assert.equal(crossing[0].y, 7.5 * U);
  const along = leave(200, 9, 300, 7.5 * U);
  assert.equal(blendDeckJoins([through, along], { unitsPerTrueM: U }).length, 1);
  assert.ok(along[0].deckBlended && Math.abs(along[0].deckBlendStepM) > 3);
});

test('missing or short paths are tolerated; unitsPerTrueM is required', () => {
  assert.deepEqual(blendDeckJoins([null, [{ x: 0, z: 0, y: 0, cls: 'viaduct' }]], { unitsPerTrueM: U }), []);
  assert.throws(() => blendDeckJoins([], {}), RangeError);
  assert.equal(DEFAULTS.blendM, 30);
});
