// chalk-clarity.spec.js — Item B: clay clarity gradient + inside-chalk clarity.
//
// Three regimes, all keyed on camera height relative to getChalkSurfaceY:
//   1. INSIDE the chalk (chalkClarity=1): fog distances released (near 20000 /
//      far 60000 — beyond scene extent, "perfect clarity at any distance"),
//      ambient lifted to chalkClarityAmbient, ALL station labels hidden while
//      hover tooltips stay active.
//   2. Just ABOVE the chalk surface (chalkClarity=0 by construction): the
//      clay-side white-out regime is preserved — tight fog, no clarity release.
//   3. Mid-clay (clayLift≈0.5): brightness/fog sit between the chalk-boundary
//      darkness and the daylight endpoint — the gradient.
//
// Camera at central London (x=0,z=0) → insideness ≈ 1, not in the Thames.
// The live tick recomputes everything per frame, so each pose sets the camera
// and polls the exposed __ug signals until the regime settles.

import { test, expect } from '@playwright/test';

const BASE = '/?skipintro=1';

async function gotoAndWait(page) {
  await page.goto(BASE);
  await page.waitForFunction(
    () => !!(window.__ug && window.__ug.camera && window.__ug.scene.fog
      && typeof window.__ug.chalkClarity === 'number'),
    null, { timeout: 15000 }
  );
}

// Place the camera dY scene units relative to the LOCAL chalk surface at the
// origin. Looking sideways so controls.update() keeps the position.
function placeRelChalk(page, dY) {
  return page.evaluate((rel) => {
    const u = window.__ug;
    u.fpsControls.enabled = false;
    const cs = u.getChalkSurfaceY(0, 0);
    u.camera.position.set(0, cs + rel, 0);
    u.controls.target.set(0, cs + rel, 500);
    return cs;
  }, dY);
}

function readAtmosphere(page) {
  return page.evaluate(() => {
    const u = window.__ug;
    const f = u.scene.fog;
    return {
      near: f.near, far: f.far,
      r: f.color.r, g: f.color.g, b: f.color.b,
      ambient: u.scene.getObjectByName('ambientLight').intensity,
      clayLift: u.clayLift,
      chalkClarity: u.chalkClarity,
      ssf: u.substrateSpeedFactor,
      chalkOpacity: u.scene.getObjectByName('chalkFloor')?.material.opacity ?? null,
      chalkDepthWrite: u.scene.getObjectByName('chalkFloor')?.material.depthWrite ?? null,
    };
  });
}

test('inside chalk: fog released, ambient lifted, chalk regimes intact', async ({ page }) => {
  await gotoAndWait(page);
  // The chalk floor mesh loads with the async M25 fetch — wait so the sheet
  // release assertions below run against the real material.
  await page.waitForFunction(
    () => !!window.__ug.scene.getObjectByName('chalkFloor'),
    null, { timeout: 30000 }
  );
  await placeRelChalk(page, -50); // 50 below the chalk surface → chalkClarity 1
  await page.waitForFunction(() => window.__ug.chalkClarity > 0.95, null, { timeout: 5000 });
  const a = await readAtmosphere(page);
  // Perfect clarity: fog effectively off for everything visible looking up.
  expect(a.near).toBeGreaterThan(15000);
  expect(a.far).toBeGreaterThan(50000);
  // Fog COLOUR stays chalk white (warm bias r > g > b) — the void reads chalky.
  expect(a.r).toBeGreaterThan(a.g);
  expect(a.g).toBeGreaterThan(a.b);
  expect(a.r).toBeGreaterThan(0.5);
  // Up-view features are lit, not just unfogged (chalkClarityAmbient = 0.55).
  expect(a.ambient).toBeGreaterThan(0.5);
  // Substrate speed regime untouched: chalk still halves movement.
  expect(a.ssf).toBeLessThan(0.7);
  expect(a.ssf).toBeGreaterThanOrEqual(0.5);
  // The chalk sheet itself releases (opacity + depthWrite) so the network
  // above is visible — not just unfogged — when looking up from inside.
  if (a.chalkOpacity !== null) {
    expect(a.chalkOpacity).toBeLessThan(0.2);
    expect(a.chalkDepthWrite).toBe(false);
  }
});

test('inside chalk: all station label layers hidden', async ({ page }) => {
  await gotoAndWait(page);
  // Wait for at least one line's label layers to exist.
  await page.waitForFunction(
    () => document.querySelectorAll('.station-overlay-layer').length > 0,
    null, { timeout: 30000 }
  );
  await placeRelChalk(page, -50);
  await page.waitForFunction(() => window.__ug.chalkClarity > 0.95, null, { timeout: 5000 });
  // Two rAF ticks so the label update loop has applied hideForChalk.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const layers = await page.evaluate(() =>
    [...document.querySelectorAll('.station-overlay-layer')].map(el => el.style.display));
  expect(layers.length).toBeGreaterThan(0);
  for (const d of layers) expect(d).toBe('none');

  // ...and they restore when the camera leaves the chalk (mid-clay pose).
  await placeRelChalk(page, 150);
  await page.waitForFunction(() => window.__ug.chalkClarity === 0, null, { timeout: 5000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const anyVisible = await page.evaluate(() =>
    [...document.querySelectorAll('.station-overlay-layer')].some(el => el.style.display !== 'none'));
  expect(anyVisible).toBe(true);
});

test('inside chalk: hover tooltips remain active', async ({ page }) => {
  await gotoAndWait(page);
  // Tube lines must be loaded for the hover cascade to have pickables.
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    null, { timeout: 90000 }
  );
  await page.waitForTimeout(2000);
  // Inside chalk, tilted up toward the tube network above central London.
  await page.evaluate(() => {
    const u = window.__ug;
    u.fpsControls.enabled = false;
    const cs = u.getChalkSurfaceY(0, 0);
    u.camera.position.set(0, cs - 60, 400);
    u.controls.target.set(0, -100, -600);
  });
  await page.waitForFunction(() => window.__ug.chalkClarity > 0.95, null, { timeout: 5000 });
  await page.waitForTimeout(500);

  // Sweep the pointer over a coarse screen grid; ANY tooltip firing proves the
  // #hoverTip path is alive while labels are felled.
  const vp = page.viewportSize();
  let tipShown = false;
  outer:
  for (let gy = 2; gy <= 7 && !tipShown; gy++) {
    for (let gx = 1; gx <= 9; gx++) {
      await page.mouse.move((vp.width * gx) / 10, (vp.height * gy) / 10, { steps: 2 });
      await page.waitForTimeout(120);
      tipShown = await page.evaluate(
        () => document.getElementById('hoverTip')?.style.display === 'block');
      if (tipShown) break outer;
    }
  }
  expect(tipShown).toBe(true);
});

test('just above chalk surface: white-out preserved, no clarity release', async ({ page }) => {
  await gotoAndWait(page);
  await placeRelChalk(page, 10); // clay side, inside the white-out smoothstep band
  await page.waitForFunction(
    () => window.__ug.chalkClarity === 0 && window.__ug.clayLift < 0.1,
    null, { timeout: 5000 }
  );
  const a = await readAtmosphere(page);
  // No clarity release from the clay side — fog stays tight, nothing near 20000.
  expect(a.near).toBeLessThan(1000);
  expect(a.far).toBeLessThan(25000);
  expect(a.chalkClarity).toBe(0);
  // From-above white-out sheet untouched: full opacity, depth-writing.
  if (a.chalkOpacity !== null) {
    expect(a.chalkOpacity).toBeCloseTo(0.92, 2);
    expect(a.chalkDepthWrite).toBe(true);
  }
});

test('mid-clay: brightness gradient sits between boundary darkness and daylight', async ({ page }) => {
  await gotoAndWait(page);

  // At the chalk boundary (+10): today's darkness (clayLift ≈ 0).
  await placeRelChalk(page, 10);
  await page.waitForFunction(() => window.__ug.clayLift < 0.1, null, { timeout: 5000 });
  const boundary = await readAtmosphere(page);

  // Mid-clay (+150, half the default 300-unit ramp): clayLift ≈ 0.5.
  await placeRelChalk(page, 150);
  await page.waitForFunction(
    () => window.__ug.clayLift > 0.4 && window.__ug.clayLift < 0.6,
    null, { timeout: 5000 }
  );
  const mid = await readAtmosphere(page);
  // Ambient ≈ lerp(ambientBelow 0.25, ambientAbove 0.6, ~0.5) ≈ 0.42.
  expect(mid.ambient).toBeGreaterThan(0.36);
  expect(mid.ambient).toBeLessThan(0.5);
  // Monotonic: mid-clay is brighter and clearer than the chalk boundary.
  expect(mid.ambient).toBeGreaterThan(boundary.ambient + 0.05);
  expect(mid.near).toBeGreaterThan(boundary.near);
});

test('clarity ramps are runtime-tunable via __ug', async ({ page }) => {
  await gotoAndWait(page);
  await placeRelChalk(page, 150);
  await page.waitForFunction(
    () => window.__ug.clayLift > 0.4 && window.__ug.clayLift < 0.6,
    null, { timeout: 5000 }
  );
  // Halve the ramp → +150 saturates to full daylight lift.
  await page.evaluate(() => { window.__ug.clayClarityRamp = 150; });
  await page.waitForFunction(() => window.__ug.clayLift > 0.95, null, { timeout: 5000 });
  const lifted = await page.evaluate(() => window.__ug.clayLift);
  expect(lifted).toBeGreaterThan(0.95);
  await page.evaluate(() => { window.__ug.clayClarityRamp = 300; });
  await page.waitForFunction(
    () => window.__ug.clayLift > 0.4 && window.__ug.clayLift < 0.6,
    null, { timeout: 5000 }
  );
});
