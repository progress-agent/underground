import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudLayout, cloudDrift, cloudPosition, sampleEdgeFade } from '../src/clouds-field.js';

// s14:F (sprint 14Oct26w, D-053 item 9): the cause of the flaky climb in tests/clouds-no-pop.spec.js, as numbers. The set of
// clouds drawn is every cloud whose M25 edge fade is above 0 at the world clock (D-043), so it differs between the clock the
// page runs on when it boots (about 0 s) and the 900 s the test freezes: 887 clouds and 4,145 puffs against 875 and 4,150. A
// climb that starts under ground leaves the instance buffer as the last frame above ground wrote it, so whichever of the two
// the buffer held decided whether five puffs "joined" at the first frame above ground. The test's boot() now writes the 900 s
// set itself. Pure model, no GPU.
function inside(t) {
  const layout = buildCloudLayout(), d = cloudDrift(t, layout.preset), p = { x: 0, z: 0 };
  let clouds = 0, puffs = 0;
  for (const c of layout.clouds) { cloudPosition(c, d, p); if (sampleEdgeFade(layout, p.x, p.z) > 0) { clouds++; puffs += c.puffs.length; } }
  return { clouds, puffs };
}

test('the drawn set at the page clock (0 s) and at the test clock (900 s) differ by exactly the five puffs that "joined"', () => {
  assert.deepEqual(inside(0), { clouds: 887, puffs: 4145 });
  assert.deepEqual(inside(900), { clouds: 875, puffs: 4150 });
});

test('the set is a pure function of the clock: the same at 900 s however often it is asked', () => {
  assert.deepEqual(inside(900), inside(900));
  assert.deepEqual(inside(0), inside(0));
});
