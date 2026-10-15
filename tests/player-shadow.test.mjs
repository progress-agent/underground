// The figure's planar shadow, pure parts (sprint 14Oct26w, lane P, fix round 1): the thrown direction is capped so
// the shadow is never a street long, and the plane follows the ground's slope so it does not sink into a rising
// street (the checker's finding at King's Cross: a 16 m flat shadow, 2 cm above the feet, buried past 0.5 m).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW, shadowLight, clampSlope, projectOntoPlane, shadowOpacity } from '../src/player/figure-shadow.js';

const sun = (elevDeg, azDeg = 40) => {
  const e = (elevDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
};
const norm = (v) => Math.hypot(v.x, v.y, v.z);
/** Ground metres a shadow reaches from the feet for a figure of `heightM` displayed metres. */
const reach = (L, ratio, heightM = 1.78) => (heightM / ratio) * Math.hypot(L.x, L.z) / L.y;

test('the canonical noon sun at Master 1 would throw about 16 m; the capped direction throws at most 1.4 heights', () => {
  const raw = sun(28.4926), ratio = 0.2;
  assert.ok(reach(raw, ratio) > 15, 'uncapped reach is the checker\'s 16 m');
  const L = shadowLight(raw, ratio);
  assert.ok(Math.abs(norm(L) - 1) < 1e-9);
  assert.ok(reach(L, ratio) <= SHADOW.maxRunPerHeight * 1.78 + 1e-6, `capped reach ${reach(L, ratio)}`);
  assert.ok(reach(L, ratio) > 2, 'still a visible shadow, not a puddle');
});

test('the cap keeps the sun\'s azimuth and leaves a short shadow alone', () => {
  const raw = sun(28.4926, 123), ratio = 0.2;
  const L = shadowLight(raw, ratio);
  assert.ok(Math.abs(Math.atan2(L.x, L.z) - Math.atan2(raw.x, raw.z)) < 1e-9);
  const high = sun(80), same = shadowLight(high, 1);
  assert.ok(Math.abs(same.x - high.x) < 1e-9 && Math.abs(same.y - high.y) < 1e-9, 'a high sun is untouched');
  assert.deepEqual(shadowLight({ x: 0, y: 1, z: 0 }, 0.2), { x: 0, y: 1, z: 0 }, 'overhead sun');
});

test('a larger Master ratio allows a longer canonical run, so the displayed shadow length is the same', () => {
  for (const ratio of [0.2, 0.5, 1, 1.5]) {
    const L = shadowLight(sun(10), ratio);
    assert.ok(reach(L, ratio) <= SHADOW.maxRunPerHeight * 1.78 + 1e-6, `ratio ${ratio}`);
  }
});

test('on a street rising 0.2 per canonical metre along the sun\'s shadow, the whole figure stays above the ground', () => {
  const ratio = 0.2, L = shadowLight(sun(28.4926, 0), ratio);          // shadow runs along -z
  const rise = 0.2;                                                     // canonical rise per metre, 4 cm/m displayed
  const ground = (z) => 100 + rise * -z;                                // rising the way the shadow is thrown
  const plane = { px: 0, py: 100, pz: 0, gx: 0, gz: -rise };
  const flat = { px: 0, py: 100, pz: 0, gx: 0, gz: 0 };
  const lift = SHADOW.liftM / ratio;
  // the figure: feet, hips, shoulders, head (canonical y = displayed / ratio)
  let sunk = 0, sunkFlat = 0;
  for (const hDisplay of [0.05, 0.5, 0.9, 1.4, 1.75]) {
    const w = { x: 0, y: 100 + hDisplay / ratio, z: 0 };
    const p = projectOntoPlane(w, L, plane, lift), f = projectOntoPlane(w, L, flat, lift);
    if (p.y < ground(p.z) + lift * 0.5) sunk++;
    if (f.y < ground(f.z)) sunkFlat++;
    // the tilted plane keeps the lift above the ground exactly
    assert.ok(Math.abs(p.y - (ground(p.z) + lift)) < 1e-6, `h ${hDisplay}: ${p.y} vs ${ground(p.z) + lift}`);
  }
  assert.equal(sunk, 0, 'tilted plane: no point buried');
  assert.ok(sunkFlat >= 3, `the flat plane buries most of it (${sunkFlat})`);
});

test('projection with no slope is the old flat one, and a point on the plane does not move but for the lift', () => {
  const L = shadowLight(sun(40, 10), 1);
  const plane = { px: 5, py: 20, pz: -3, gx: 0, gz: 0 };
  const p = projectOntoPlane({ x: 7, y: 20, z: 1 }, L, plane, 0.1);
  assert.ok(Math.abs(p.x - 7) < 1e-9 && Math.abs(p.z - 1) < 1e-9 && Math.abs(p.y - 20.1) < 1e-9);
  const q = projectOntoPlane({ x: 5, y: 23, z: -3 }, L, plane, 0);
  assert.ok(Math.abs(q.y - 20) < 1e-9);
});

test('clampSlope bounds a wild probe and refuses a slope that would face the shadow into the sun', () => {
  const L = shadowLight(sun(28.4926, 0), 0.2);
  const c = clampSlope(3, 0, L);
  assert.ok(Math.hypot(c.gx, c.gz) <= SHADOW.maxSlope + 1e-9 || (c.gx === 0 && c.gz === 0));
  // a slope rising towards the sun so steeply that L.y - g.L would vanish falls back to flat
  const steep = clampSlope(0, 0.6, { x: 0, y: 0.1, z: 0.99 });
  assert.deepEqual(steep, { gx: 0, gz: 0 });
  assert.deepEqual(clampSlope(0, -0.2, L), { gx: 0, gz: -0.2 });
});

test('opacity rules are unchanged', () => {
  assert.equal(shadowOpacity({ strengthRatio: 1, heightM: 0, elevationDeg: 7, swimming: false }), 0);
  assert.equal(shadowOpacity({ strengthRatio: 1, heightM: 0, elevationDeg: 30, swimming: true }), 0);
  assert.ok(Math.abs(shadowOpacity({ strengthRatio: 1, heightM: 0, elevationDeg: 30, swimming: false }) - SHADOW.baseOpacity) < 1e-12);
});
