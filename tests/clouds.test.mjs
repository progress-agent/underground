// clouds.test.mjs: Lane C (sprint 25Sep26f, D-039; sprint 30Sep26w, D-041).
// The pure cloud model.
//
// Pinned here:
//   1. Cloud positions are a deterministic function of time (no randomness,
//      no frame history), and they move with the shared wind.
//   2. Coverage is 1.25 oktas (D-041 item 6, Jordan 27Sep26u: "reduce the
//      cloud cover by 50%"; superseded D-039's "2 to 3 oktas", built at 2.5).
//   3. The clouds kept at 1.25 oktas are the first clouds of the 2.5-okta sky
//      of c820ea9, in the same places and at the same sizes.
//   4. Each cloud is fewer, larger, overlapping puffs (D-041, the cotton-wool fix).
//   5. Clouds and their shadows fade out towards the M25 edge.
//   6. Shadows exist above ground, and there are none without air (the air
//      weight is 0 underground and underwater) or with the sun on the horizon.
//   7. Presets are data with a default; the balloon updraft sits under cumulus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_FIELD, buildCloudLayout, cloudDrift, cloudPositionsAt, coverageFraction,
  sampleEdgeFade, coarseEdgeRing, cloudSunFactor, shadowStrengthFor, shadowPlaneY,
  updraftAt, fractionToOktas, sampleCover, cloudPosition,
} from '../src/clouds-field.js';
import { CLOUD_PRESETS, DEFAULT_CLOUD_PRESET, resolveCloudPreset } from '../src/clouds-presets.js';
import { getWindAt } from '../src/wind.js';
import { createBalloonState, stepBalloon, BALLOON_DEFAULTS } from '../src/modes/balloon-physics.js';

const P = resolveCloudPreset(DEFAULT_CLOUD_PRESET);
const L = buildCloudLayout(P);

test('presets: fair-weather cumulus is the default; unknown ids fall back to it', () => {
  assert.equal(DEFAULT_CLOUD_PRESET, 'fairCumulus');
  assert.equal(P.kind, 'cumulus');
  assert.equal(resolveCloudPreset('noSuchWeather'), CLOUD_PRESETS.fairCumulus);
  assert.ok(Object.isFrozen(CLOUD_PRESETS) && Object.isFrozen(P));
});

test('layout is seeded: a fresh build of the same preset is identical', () => {
  const again = buildCloudLayout({ ...P, id: 'fairCumulus-copy' });
  assert.equal(again.clouds.length, L.clouds.length);
  assert.deepEqual(again.clouds.slice(0, 20), L.clouds.slice(0, 20));
  assert.deepEqual(Array.from(again.cover.subarray(0, 5000)), Array.from(L.cover.subarray(0, 5000)));
});

test('positions are a pure function of time, independent of query order', () => {
  const late = cloudPositionsAt(L, 3600.5);
  const early = cloudPositionsAt(L, 123.25);
  assert.deepEqual(Array.from(cloudPositionsAt(L, 3600.5)), Array.from(late));
  assert.deepEqual(Array.from(cloudPositionsAt(L, 123.25)), Array.from(early));
  assert.notDeepEqual(Array.from(early.subarray(0, 10)), Array.from(late.subarray(0, 10)));
  assert.deepEqual(cloudDrift(0, P), { x: 0, z: 0 });
  assert.deepEqual(cloudDrift(-50, P), { x: 0, z: 0 });
});

test('drift is the integral of the shared wind at the cloud layer', () => {
  // Independent fine trapezoid integration of getWindAt.
  const T = 900, dt = 0.05;
  let x = 0, z = 0;
  const v = t => { const w = getWindAt(P.windAltitudeM, t); return [-Math.sin(w.dirRad) * w.speedMps, Math.cos(w.dirRad) * w.speedMps]; };
  for (let t = 0; t < T - 1e-9; t += dt) {
    const a = v(t), b = v(t + dt);
    x += (a[0] + b[0]) / 2 * dt; z += (a[1] + b[1]) / 2 * dt;
  }
  const d = cloudDrift(T, P);
  assert.ok(Math.hypot(d.x - x, d.z - z) < 0.5, `drift ${d.x},${d.z} vs ${x},${z}`);
  // And locally it moves at the wind's velocity.
  const a = cloudDrift(2000, P), b = cloudDrift(2001, P), w = v(2000.5);
  assert.ok(Math.hypot(b.x - a.x - w[0], b.z - a.z - w[1]) < 0.05);
});

test('coverage is 1.25 oktas, over the field and inside the map (D-041)', () => {
  // Jordan, 27Sep26u: "Let's reduce the cloud cover by 50%" (Reader item
  // 01M3FX4EVNFFKK6K5Z9SXTNGRN), ruled as 2.5 -> 1.25 oktas in D-041 item 6,
  // superseding D-039's "2 to 3 oktas" (this test's bound until c820ea9).
  // The generator stops at the target on the raw footprints; the shadow blur
  // then moves the whole field to 1.20 and the map's interior to 1.25.
  assert.equal(P.oktas, 1.25);
  const all = fractionToOktas(coverageFraction(L));
  const inner = fractionToOktas(coverageFraction(L, { minEdge: 0.95 }));
  for (const o of [all, inner]) assert.ok(Math.abs(o - 1.25) <= 0.08, `oktas ${o.toFixed(3)}`);
});

// The first clouds of c820ea9's 2.5-okta sky (clouds-field.js there, preset
// fairCumulus), millimetre-rounded: [index, cx, cz, base, width, height, depth].
// Taken on 30Sep26w from c820ea9 before any change in this lane.
const C820_SAMPLE = [
  [0, 14158.071, 1510.009, 1006.633, 1823.092, 1134.482, 1272.364],
  [1, -4216.546, 34770.964, 952.657, 1770.757, 1047.915, 1524.363],
  [2, -22759.507, -5519.861, 784.1, 1202.156, 687.93, 952.233],
  [500, -17647.407, 3467.482, 1005.297, 1519.191, 1130.552, 1231.537],
  [999, -9426.419, 23474.754, 794.974, 1056.801, 760.737, 962.707],
  [1500, -16632.604, 28939.553, 965.161, 1518.683, 986.854, 960.045],
  [1953, -4834.459, -23466.236, 1002.163, 1965.071, 1272.812, 1820.537],
];
// FNV-1a over the same rounded identities of its first 1,954 clouds (the
// number c820ea9's generator keeps at 1.25 oktas).
const C820_FIRST_1954_FNV = 'bb575d2';
const r3 = v => Math.round(v * 1000) / 1000;
const ident = c => [c.cx, c.cz, c.base, c.width, c.height, c.depth].map(r3);

test('the kept clouds are the first clouds of the 2.5-okta sky, unmoved (D-041)', () => {
  // About half as many clouds: the new puffs' footprints need a handful more
  // (7 today) to reach the same cover, all of them the old sky's next clouds.
  assert.ok(L.clouds.length >= 1954 && L.clouds.length <= 2010, `clouds ${L.clouds.length}`);
  for (const [i, ...want] of C820_SAMPLE) assert.deepEqual(ident(L.clouds[i]), want, `cloud ${i}`);
  let h = 0x811c9dc5;
  for (let i = 0; i < 1954; i++) {
    for (const ch of ident(L.clouds[i]).join(',') + ';') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  }
  assert.equal(h.toString(16), C820_FIRST_1954_FNV);
  // And at any time: every kept cloud drifts from its old place on the one wind.
  const p = cloudPositionsAt(L, 1800), d = cloudDrift(1800, P), q = { x: 0, z: 0 };
  for (const [i, cx, cz] of C820_SAMPLE) {
    cloudPosition({ cx, cz }, d, q);
    assert.ok(Math.abs(p[2 * i] - q.x) < 0.01 && Math.abs(p[2 * i + 1] - q.z) < 0.01, `cloud ${i} at 1800 s`);
  }
});

test('each cloud is a few large, overlapping puffs (D-041)', () => {
  // c820ea9 drew 5 to 11 puffs a cloud (7.6 on average) of 0.15 to 0.3 of its
  // width, each lit as its own ball; now 3 to 7, a quarter to a third wide.
  let puffs = 0, relR = 0;
  for (const c of L.clouds) {
    assert.ok(c.puffs.length >= 3 && c.puffs.length <= 7, `puffs ${c.puffs.length}`);
    puffs += c.puffs.length;
    for (const p of c.puffs) {
      relR += p.r / c.width;
      assert.ok(p.r >= 0.22 * c.width - 1e-6 && p.r <= 0.36 * c.width + 1e-6);
      // Every puff overlaps another by at least a third of the smaller radius.
      const overlaps = c.puffs.some(q => q !== p
        && Math.hypot(p.dx - q.dx, p.dy - q.dy, p.dz - q.dz) < p.r + q.r - Math.min(p.r, q.r) / 3);
      assert.ok(overlaps, 'an isolated puff');
    }
  }
  assert.ok(puffs / L.clouds.length < 5.5, `mean puffs ${puffs / L.clouds.length}`);
  assert.ok(relR / puffs > 0.27, `mean radius ${relR / puffs} of the width`);
  // Deterministic: the puffs come from each cloud's own seeded stream.
  const again = buildCloudLayout({ ...P, id: 'fairCumulus-puffs' });
  assert.deepEqual(again.clouds[1234].puffs, L.clouds[1234].puffs);
});

test('clouds fade out towards the M25 edge and are gone beyond it', () => {
  assert.equal(sampleEdgeFade(L, 0, 0), 1); // Trafalgar Square
  const ring = coarseEdgeRing();
  let worst = 0;
  for (const [x, z] of ring) worst = Math.max(worst, sampleEdgeFade(L, x, z));
  assert.ok(worst < 0.05, `fade on the edge ring up to ${worst}`);
  // 3 km inside the northern edge: partly faded (neither full nor gone).
  const mid = sampleEdgeFade(L, 4000, -17800);
  assert.ok(mid > 0.05 && mid < 0.95, `fade 3km inside the edge ${mid}`);
  // Outside the map entirely.
  assert.equal(sampleEdgeFade(L, 0, CLOUD_FIELD.originZ + 500), 0);
});

test('shadows: present above ground, none without air or with the sun on the horizon', () => {
  const sunDir = { x: 0, y: Math.sin(28 * Math.PI / 180), z: Math.cos(28 * Math.PI / 180) };
  const drift = cloudDrift(600, P);
  const planeY = shadowPlaneY(L, 1.1 / 5);
  const strength = shadowStrengthFor(P, { airWeight: 1, elevationDeg: 28 });
  assert.equal(strength, P.shadowStrength);
  let min = 1, max = 0, sum = 0, n = 0;
  for (let x = -12000; x <= 12000; x += 500) {
    for (let z = -12000; z <= 12000; z += 500) {
      const f = cloudSunFactor(L, x, 40, z, { drift, sunDir, strength, planeY });
      min = Math.min(min, f); max = Math.max(max, f); sum += f; n++;
    }
  }
  assert.ok(min < 1 - 0.6 * P.shadowStrength, `deepest shade ${min}`);
  assert.equal(max, 1);
  // Recalibrated for 1.25 oktas (D-041): the mean shade over central London
  // is 0.10 to 0.12 across the first two hours (0.20 to 0.23 at 2.5 oktas,
  // when this band was 0.05 to 0.4): about the cover times the strength.
  const shaded = 1 - sum / n;
  assert.ok(shaded > 0.07 && shaded < 0.17, `mean shade ${shaded}`);
  // Underground or underwater the air weight is 0; so is the switch.
  assert.equal(shadowStrengthFor(P, { airWeight: 0, elevationDeg: 28 }), 0);
  assert.equal(shadowStrengthFor(P, { airWeight: 1, elevationDeg: 28, enabled: false }), 0);
  assert.equal(shadowStrengthFor(P, { airWeight: 1, elevationDeg: 1.5 }), 0);
  assert.equal(cloudSunFactor(L, 0, 40, 0, { drift, sunDir, strength: 0, planeY }), 1);
  // Nothing above the cloud plane is shaded.
  assert.equal(cloudSunFactor(L, 0, planeY + 1, 0, { drift, sunDir, strength, planeY }), 1);
});

test('altitude follows Master, the cloud body keeps its true size', () => {
  // Canonical plane = mean base x VE (Master via the display transform) plus
  // the true half-height divided by the ratio: display height of the plane is
  // mean base x Master + half-height.
  for (const master of [1, 1.1, 2, 5]) {
    const ratio = master / 5;
    const displayed = shadowPlaneY(L, ratio) * ratio;
    assert.ok(Math.abs(displayed - (L.meanBaseM * master + L.meanHalfHeightM)) < 1e-6);
  }
});

test('balloon lift: an updraft under cumulus below the base, none above or aloft', () => {
  const drift = cloudDrift(0, P);
  // Find a point under full cover near the centre.
  let spot = null;
  for (let x = -8000; x <= 8000 && !spot; x += 100) {
    for (let z = -8000; z <= 8000 && !spot; z += 100) if (sampleCover(L, x, z, drift) > 0.95) spot = [x, z];
  }
  assert.ok(spot, 'a point under a cloud');
  assert.ok(updraftAt(L, spot[0], spot[1], 300, drift) > 0.8 * P.updraftMps);
  assert.equal(updraftAt(L, spot[0], spot[1], 2000, drift), 0);
  assert.equal(updraftAt(L, spot[0], spot[1], 5, drift), 0);
  // Physics: the drag acts relative to the rising air, so after the drag's
  // settling time a basket in a 1.2 m/s thermal climbs 1.2 m/s faster than
  // the same basket in still air.
  const world = { VE: 5, wind: () => ({ dirRad: 0, speedMps: 1 }), groundY: () => 0 };
  const still = createBalloonState({ x: 0, y: 5000, z: 0 }), lifted = createBalloonState({ x: 0, y: 5000, z: 0 });
  for (let i = 0; i < 300; i++) {
    stepBalloon(still, { burner: false, vent: false }, 0.1, BALLOON_DEFAULTS, world);
    stepBalloon(lifted, { burner: false, vent: false }, 0.1, BALLOON_DEFAULTS, { ...world, updraft: () => 1.2 });
  }
  assert.ok(Math.abs(lifted.vy - still.vy - 1.2) < 0.15, `vy ${lifted.vy} vs ${still.vy}`);
});
