// geology-atmosphere.spec.js — chalk-entry white-out + D-002 slowdown (Wave 2).
//
// The atmosphere blend (src/environment.js) and the substrate speed factor
// (src/main.js tick) are both driven every frame from chalkBlend — a smoothstep
// over the camera Y crossing the LOCAL displaced chalk surface, gated by M25
// insideness. This spec drives the camera to clay depth then chalk depth and
// asserts the fog colour shifts toward the dusty warm white (0xded6c4) and the
// speed factor halves inside the chalk.
//
// Sprint 16Oct26f (T-baseline, D-054): the speed-factor half of this spec was stale. D-036 (13Sep26u) says "Remove the lasting
// chalk slowdown; ordinary cruising resumes after crossing", and main.js holds `substrateSpeedFactor` at 1 in every
// substrate (the transient 700 ms membranes act on held keys only). So the specs now wait on the FOG itself to settle (the
// state they exist to pin) and assert the factor stays 1; every fog colour, distance and clarity assertion is unchanged.
//
// Camera is placed at central London (0, y, 0) — inside the M25 disc, not in
// the Thames — so insideness ≈ 1 and the chalk regime is fully in effect.
// Uses ?skipintro=1 to bypass the cinematic descent. Live tick overwrites any
// manual state, so we set the camera position and poll for the settled value.

import { test, expect } from '@playwright/test';

const BASE = '/?skipintro=1';

// Expected linear fog channels (three.js ColorManagement converts the sRGB hex).
// Dusty warm white 0xded6c4 → ~(0.730, 0.672, 0.552) linear.
const CHALK_LIN = { r: 0.730, g: 0.672, b: 0.552 };
const TOL = 0.12;

async function gotoAndWait(page) {
  await page.goto(BASE);
  await page.waitForFunction(
    () => !!(window.__ug && window.__ug.camera && window.__ug.scene.fog),
    null, { timeout: 8000 }
  );
}

/** Wait until the fog colour has stopped moving: 10 consecutive frames within 0.01 on every channel (after 3 frames of the new pose). */
function fogSettled(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const f = window.__ug.scene.fog.color;
    let frames = 0, run = 0, last = null;
    const tick = () => {
      frames++;
      const cur = [f.r, f.g, f.b];
      if (frames > 3 && last && cur.every((v, i) => Math.abs(v - last[i]) < 0.01)) run++; else run = 0;
      last = cur;
      if (run >= 10) resolve(true); else if (frames > 600) resolve(false); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

function place(page, y) {
  // Central London, looking sideways so controls.update() keeps the position.
  return page.evaluate((cy) => {
    const u = window.__ug;
    u.fpsControls.enabled = false;
    u.camera.position.set(0, cy, 0);
    u.controls.target.set(0, cy, 500);
  }, y);
}

test('clay depth: fog stays dark and speed factor is 1 (no slowdown)', async ({ page }) => {
  await gotoAndWait(page);
  // -100 scene units: underground (surface ≈ 75), well above any chalk surface
  // (deepest local chalk ≈ -445), so chalkBlend ≈ 0.
  await place(page, -100);
  expect(await fogSettled(page), 'the fog settled').toBe(true);
  const fog = await page.evaluate(() => {
    const c = window.__ug.scene.fog.color;
    return { r: c.r, g: c.g, b: c.b, ssf: window.__ug.substrateSpeedFactor };
  });
  // No slowdown in clay.
  expect(fog.ssf).toBe(1);
  // Clay fog is dark graphite — nowhere near the dusty white.
  expect(fog.r).toBeLessThan(0.15);
  expect(fog.g).toBeLessThan(0.15);
  expect(fog.b).toBeLessThan(0.15);
});

test('chalk depth: fog shifts to dusty white and cruising speed is not slowed (D-036)', async ({ page }) => {
  await gotoAndWait(page);
  // -700 scene units: below the deepest possible local chalk surface, so
  // chalkBlend saturates to 1 regardless of the noise at the origin.
  await place(page, -700);
  expect(await fogSettled(page), 'the fog settled').toBe(true);
  const fog = await page.evaluate(() => {
    const f = window.__ug.scene.fog;
    return {
      r: f.color.r, g: f.color.g, b: f.color.b,
      near: f.near, far: f.far,
      ssf: window.__ug.substrateSpeedFactor,
    };
  });
  // D-036: no lasting chalk slowdown (D-002's lerp toward 0.5 was removed); ordinary cruising continues in the chalk.
  expect(fog.ssf).toBe(1);
  // Fog colour shifted toward dusty warm white (channel-level, with tolerance).
  expect(Math.abs(fog.r - CHALK_LIN.r)).toBeLessThan(TOL);
  expect(Math.abs(fog.g - CHALK_LIN.g)).toBeLessThan(TOL);
  expect(Math.abs(fog.b - CHALK_LIN.b)).toBeLessThan(TOL);
  // Warm bias preserved (r > g > b).
  expect(fog.r).toBeGreaterThan(fog.g);
  expect(fog.g).toBeGreaterThan(fog.b);
  // Item B inside-chalk clarity: -700 is INSIDE the chalk, so fog distances are
  // RELEASED (near 20000 / far 60000) — perfect clarity looking up. The tight
  // white-out (near<80/far<3000) now applies only from ABOVE the chalk surface;
  // that regime is asserted in chalk-clarity.spec.js.
  expect(fog.near).toBeGreaterThan(15000);
  expect(fog.far).toBeGreaterThan(50000);
});

test('crossing clay -> chalk brightens the fog (white-out is a transition)', async ({ page }) => {
  await gotoAndWait(page);
  await place(page, -100);
  expect(await fogSettled(page), 'the clay fog settled').toBe(true);
  const clayR = await page.evaluate(() => window.__ug.scene.fog.color.r);
  await place(page, -700);
  expect(await fogSettled(page), 'the chalk fog settled').toBe(true);
  const chalkR = await page.evaluate(() => window.__ug.scene.fog.color.r);
  // The chalk fog is dramatically brighter than the clay fog.
  expect(chalkR).toBeGreaterThan(clayR + 0.4);
});
