// clouds.test.mjs: Lane C (sprint 25Sep26f, D-039). The pure cloud model.
//
// Pinned here:
//   1. Cloud positions are a deterministic function of time (no randomness,
//      no frame history), and they move with the shared wind.
//   2. Coverage is 2 to 3 oktas (Jordan's fair-weather default).
//   3. Clouds and their shadows fade out towards the M25 edge.
//   4. Shadows exist above ground, and there are none without air (the air
//      weight is 0 underground and underwater) or with the sun on the horizon.
//   5. Presets are data with a default; the balloon updraft sits under cumulus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_FIELD, buildCloudLayout, cloudDrift, cloudPositionsAt, coverageFraction,
  sampleEdgeFade, coarseEdgeRing, cloudSunFactor, shadowStrengthFor, shadowPlaneY,
  updraftAt, fractionToOktas, sampleCover,
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

test('coverage is 2 to 3 oktas, over the field and inside the map', () => {
  const all = fractionToOktas(coverageFraction(L));
  const inner = fractionToOktas(coverageFraction(L, { minEdge: 0.95 }));
  for (const o of [all, inner]) assert.ok(o >= 2 && o <= 3, `oktas ${o.toFixed(2)}`);
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
  const shaded = 1 - sum / n;
  assert.ok(shaded > 0.05 && shaded < 0.4, `mean shade ${shaded}`);
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
