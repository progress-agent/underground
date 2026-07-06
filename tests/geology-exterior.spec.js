// geology-exterior.spec.js — the exterior tapered column (Geology Vision D1).
//
// Covers the clay disc skirt + fading chalk column (src/geology-exterior.js) and
// the camera-following "abyss cap" sky dome change (src/environment.js). Uses
// ?fast=1 to skip the intro; waits for the async M25/geology build to land the
// 'geology-exterior' group in the scene.

import { test, expect } from '@playwright/test';

async function gotoAndWait(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => !!(window.__ug && window.__ug.scene &&
             window.__ug.scene.getObjectByName('geology-exterior')),
    null, { timeout: 30000 }
  );
}

test('geology-exterior group has a clay skirt and a chalk column', async ({ page }) => {
  await gotoAndWait(page);
  const names = await page.evaluate(() => {
    const g = window.__ug.scene.getObjectByName('geology-exterior');
    return g.children.map(c => c.name);
  });
  expect(names).toContain('clayDiscSkirt');
  expect(names).toContain('chalkColumn');
});

test('chalk column is FrontSide, transparent, fogged, with a vertex-alpha ramp', async ({ page }) => {
  await gotoAndWait(page);
  const m = await page.evaluate(() => {
    const col = window.__ug.scene.getObjectByName('chalkColumn');
    return {
      side: col.material.side,            // THREE.FrontSide === 0
      transparent: col.material.transparent,
      fog: col.material.fog,
      hasAlpha: !!col.geometry.getAttribute('alpha'),
      vertexColors: col.material.vertexColors,
    };
  });
  expect(m.side).toBe(0);                 // FrontSide — invisible from inside the disc
  expect(m.transparent).toBe(true);
  expect(m.fog).toBe(true);
  expect(m.hasAlpha).toBe(true);
  expect(m.vertexColors).toBe(true);
});

test('chalk column spans chalk top (~-300) down to the fade-out depth (~-19000)', async ({ page }) => {
  await gotoAndWait(page);
  const bb = await page.evaluate(() => {
    const col = window.__ug.scene.getObjectByName('chalkColumn');
    col.geometry.computeBoundingBox();
    const b = col.geometry.boundingBox;
    return { minY: b.min.y, maxY: b.max.y };
  });
  expect(bb.maxY).toBeGreaterThan(-400);  // top ring at CHALK_TOP_Y = -300
  expect(bb.maxY).toBeLessThan(-200);
  expect(bb.minY).toBeLessThan(-18000);   // descends toward -19000 (deep column)
  expect(bb.minY).toBeGreaterThan(-20000);
});

test('clay skirt is FrontSide and vertex-coloured (strata banding)', async ({ page }) => {
  await gotoAndWait(page);
  const m = await page.evaluate(() => {
    const s = window.__ug.scene.getObjectByName('clayDiscSkirt');
    return { side: s.material.side, vertexColors: s.material.vertexColors };
  });
  expect(m.side).toBe(0);                 // FrontSide — invisible from inside the disc
  expect(m.vertexColors).toBe(true);
});

test('sky dome is the camera-following abyss cap (radius < far plane, tracks camera)', async ({ page }) => {
  await gotoAndWait(page);
  const r = await page.evaluate(() => {
    const sky = window.__ug.scene.getObjectByName('skyDome');
    return sky.geometry.parameters.radius;
  });
  expect(r).toBeLessThan(50000);          // within the 50000 far plane (was 80000, clipped)
  expect(r).toBeGreaterThan(20000);

  // Move the camera above ground and let a couple of frames run; the dome must
  // recentre on the camera (its equator tracks the true horizon).
  await page.evaluate(() => {
    const { camera, controls } = window.__ug;
    camera.position.set(12345, 800, -6789);
    controls.target.set(12345, 700, -1000);
    camera.updateMatrixWorld(true);
  });
  await page.waitForTimeout(250);
  const d = await page.evaluate(() => {
    const { camera, scene } = window.__ug;
    const sky = scene.getObjectByName('skyDome');
    return Math.hypot(
      sky.position.x - camera.position.x,
      sky.position.y - camera.position.y,
      sky.position.z - camera.position.z
    );
  });
  expect(d).toBeLessThan(50);             // dome sits on the camera each frame
});
