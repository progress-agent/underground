// clouds-no-pop.spec.js: Lane C, sprint 01Oct26h (D-043). No cloud appears or
// vanishes as the camera moves.
//
// Jordan (D-042 item 2, 01Oct26h): "The clouds look great, but they are
// appearing and disappearing quite unnaturally": climbing out after the
// opening, about half the clouds vanished abruptly as he rose, and while
// flying, clouds kept appearing within view as he approached them. D-043 item
// 1: every cloud inside the map is always drawn; "thin to a third above them"
// is one smooth fade of the whole layer.
//
// Three flights, each one fixed step of 1/30 s per frame at Deity speed (the
// keyboard's speed regime, src/modes/deity-speed.js), so the path is the same
// on any machine; 1/30 s is the slowest frame the weak-machine bar allows, so
// each frame's change is the largest a viewer could see:
//   - the climb from the opening's landing pose (37 m under Marylebone) straight
//     up to 3 km on the altimeter, holding E;
//   - 20 km level at about 1 km, through the cloud bases, holding W;
//   - 20 km at street height (15 m over the ground), holding W and Shift.
// Every frame the cloud system's probe reads back, from the GPU, the opacity the
// vertex shader gave every drawn puff (tests/helpers/cloud-flight.js). Pinned:
//   1. The drawn set never steps: the same puffs of the same clouds in the
//      instance buffer in every frame (read as clouds.spec.js reads it).
//   2. No cloud's opacity (the fade above the layer, the M25 edge, the far
//      plane) changes by more than 0.03 in a frame.
//   3. A puff's own dissolve as the camera nears it never changes faster than
//      the camera's approach allows (its smoothstep over 1.6 radii).
//   4. The air weight (nothing underground) changes only as the camera
//      crosses the ground.
// A fourth run holds the camera still and lets the world clock run: clouds
// drift on the wind across the M25 edge, joining and leaving the drawn set
// only where the edge fade has made them invisible.
//
// On 387dff0 these flights fail every check (scripts/count-cloud-pops.mjs,
// which mirrors that build's vertex shader on the CPU, since it has no probe):
// on the climb the drawn set took 6 sizes and over 600 puffs joined and 700
// left it, and cloud opacities jumped by more than 0.03 in a frame about
// 20,000 times, by up to 1.16, as each cloud dropped half its puffs passing
// its top; each level flight changed the drawn set 14 times at the 25.5 km cull
// and dropped puffs whole (jumps of 1.24) at the distance detail's 5 to 15 km.
//
// Deliberately NOT measured: frames per second (the GPU is shared during the
// sprint; the integrator measures serially).

import { test, expect } from '@playwright/test';
import { waitForSceneLoaded } from './helpers/scene-loaded.js';
import { installTickHooks, flyLeg } from './helpers/cloud-flight.js';

const DT = 1 / 30;
const MAX_CLOUD_STEP = 0.03;

async function boot(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installTickHooks(page);
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ugClouds && window.__ug.groundReady && window.__ug.intro),
    null, { timeout: 120000 });
  await waitForSceneLoaded(page, 120000);
  await page.evaluate(() => {
    const u = window.__ug;
    u.fpsControls.enabled = false; u.controls.enableDamping = false;
    // The world clock stands still: drift is not under test here (see the last test).
    window.__ugClouds.setTimeOverride(900);
    // A cloud's opacity no longer depends on the quality level (D-043), so render
    // cheaply: the probe reads the shader's own decision, not the picture.
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 0.5, samples: 0 });
  });
  return errors;
}

function expectNoPop(r, { airWeightOnly = false } = {}) {
  console.log(r.name, JSON.stringify({ frames: r.frames, from: r.startAltM, to: r.endAltM, travelledM: r.travelledM,
    instances: r.instances, visibleClouds: r.visibleClouds, rewrites: r.rewrites, layer: r.layer, maxCloudStep: +r.maxCloudStep.toFixed(4),
    worstCloud: r.worstCloud, maxNearExcess: +r.maxNearExcess.toFixed(5), worstNear: r.worstNear, maxEffStep: +r.maxEffStep.toFixed(4),
    airWeightSteps: r.airWeightSteps }));
  expect(r.missing, `${r.name}: every drawn puff read back`).toBe(0);
  // 1. The drawn set never steps.
  expect(r.instances, `${r.name}: puffs drawn`).toHaveLength(1);
  expect(r.visibleClouds, `${r.name}: clouds drawn`).toHaveLength(1);
  expect(r.instances[0]).toBeGreaterThan(3500);   // about 4,150 puffs of about 875 clouds
  expect(r.visibleClouds[0]).toBeGreaterThan(780);
  expect(r.joined, `${r.name}: puffs that appeared`).toBe(0);
  expect(r.left, `${r.name}: puffs that vanished`).toBe(0);
  expect(r.puffsSeen, `${r.name}: the same puffs throughout`).toBe(r.instances[0]);
  // 2. No cloud's opacity jumps.
  expect(r.maxCloudStep, `${r.name}: largest change of a cloud's opacity in a frame`).toBeLessThanOrEqual(MAX_CLOUD_STEP);
  // 3. The dissolve near the camera is never faster than the approach allows.
  expect(r.maxNearExcess, `${r.name}: dissolve faster than the camera`).toBeLessThanOrEqual(1e-3);
  // 4. The air weight: unchanged in the air; on the climb only while crossing the ground
  //    (its ramp is 12 units; one frame of the underground speed is about 17).
  if (airWeightOnly) for (const s of r.airWeightSteps) expect(s.heightAboveGround, JSON.stringify(s)).toBeLessThanOrEqual(12 + 17.5);
  else expect(r.airWeightSteps).toEqual([]);
}

test('the climb out of the opening to 3 km: no cloud appears or vanishes', async ({ page }) => {
  test.setTimeout(300000);
  const errors = await boot(page);
  const r = await page.evaluate(flyLeg, { name: 'climb', kind: 'climb', DT, toAltM: 3000 });
  expectNoPop(r, { airWeightOnly: true });
  // It did start underground and climb through the whole fade above the layer.
  expect(r.startAltM).toBeLessThan(0);
  expect(r.endAltM).toBeGreaterThanOrEqual(3000);
  expect(r.layer[1]).toBe(1);
  expect(r.layer[0]).toBeLessThan(0.08);
  expect(r.airWeightSteps.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('20 km level at about 1 km and at street height: no cloud appears or vanishes', async ({ page }) => {
  test.setTimeout(300000);
  const errors = await boot(page);
  // West to east across the centre, north of the river at ~1 km (through the
  // cloud bases), then south of it at street height with Shift held.
  const high = await page.evaluate(flyLeg, { name: 'level-1km', kind: 'level', DT, start: [-10000, -4000], dir: [1, 0], distM: 20000, altM: 1000 });
  expectNoPop(high);
  expect(high.startAltM).toBeGreaterThan(900);
  const low = await page.evaluate(flyLeg, { name: 'street', kind: 'level', DT, start: [-10000, 2000], dir: [1, 0], distM: 20000, aboveGroundM: 15, sprint: true });
  expectNoPop(low);
  expect(low.startAltM).toBeLessThan(20);
  // Both legs flew their 20 km.
  for (const r of [high, low]) expect(r.travelledM).toBeGreaterThan(19900);
  expect(errors).toEqual([]);
});

test('as the clouds drift across the map edge, they join and leave the drawn set invisibly', async ({ page }) => {
  test.setTimeout(300000);
  const errors = await boot(page);
  // A still camera over the City looking up; the world clock runs 10 s a frame
  // (50 minutes in all), so clouds drift a long way on the wind.
  const r = await page.evaluate(flyLeg, { name: 'drift', kind: 'drift', DT, start: [2952.9, 337.8, -732.9], look: [1900, 3300, -300],
    frames: 300, time0: 900, worldStepS: 10 });
  console.log(r.name, JSON.stringify({ frames: r.frames, instances: r.instances.length, joined: r.joined, left: r.left,
    maxJoinOpacity: +r.maxJoinOpacity.toFixed(4), maxCloudStep: +r.maxCloudStep.toFixed(4), worstCloud: r.worstCloud }));
  expect(r.missing).toBe(0);
  expect(r.joined + r.left, 'clouds did cross the edge').toBeGreaterThan(0);
  // A cloud joins or leaves the drawn set where its edge fade is 0: within one
  // frame of drift (10 s of wind here, 600 frames' worth at 60 fps) and the
  // GPU's 8-bit edge texture, under 1% opacity.
  expect(r.maxJoinOpacity).toBeLessThanOrEqual(0.01);
  // Drifting 10 s a frame, the edge fade moves slowly (its 6.4 km band): about
  // 0.04 a frame at this speeded-up clock, 0.00007 at real speed.
  expect(r.maxCloudStep).toBeLessThanOrEqual(0.06);
  expect(errors).toEqual([]);
});
