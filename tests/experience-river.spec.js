import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/?fast=1&buildings=baked&mh=1.1&bh=2');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.thamesMesh && window.__ug.parkLabelsGroup);
}
async function setRiverPose(page, nearBed = false) {
  return page.evaluate(nearBed => {
    const u = window.__ug, positions = u.thamesMesh.geometry.attributes.position.array;
    let best = null, score = Infinity;
    for (let i = 0; i < positions.length; i += 12) {
      const x = (positions[i] + positions[i + 3]) / 2, z = (positions[i + 2] + positions[i + 5]) / 2;
      const bed = u.getTerrainMeshSurfaceY({ x, z });
      if (bed === null || u.WATER_TOP_Y - bed < 12) continue;
      const s = Math.abs((u.nearestThamesSegment(x, z) ?? 0) - 53000);
      if (s < score) { score = s; best = { x, z, bed }; }
    }
    if (!best) throw Error('No sufficiently deep sourced Thames pose');
    u.materialResistance.cancel();
    u.controls.enableDamping = false;
    const y = nearBed ? best.bed + 2 : (best.bed + u.WATER_TOP_Y) / 2;
    u.camera.position.set(best.x, y, best.z);
    u.controls.target.set(best.x + 100, y + 70, best.z);
    u.controls.update();
    return best;
  }, nearBed);
}

test('rendered river bed bounds water and external labels restore on exit', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const pose = await setRiverPose(page);
  await expect.poll(() => page.evaluate(() => window.__ug.submergedBlend)).toBe(1);
  const state = await page.evaluate(({ x, z, bed }) => {
    const u = window.__ug;
    return { floor: u.classifySubstrateAt({ x, y: bed - 1, z }),
      ceiling: u.thamesInteriorShell.geometry.index.count,
      parks: u.parkLabelsGroup.visible,
      // Rendered visibility, not the element's own computed display: stations.js
      // hides labels underwater at the LAYER (setLayerDisplay), and a child of a
      // display:none layer keeps its own computed display 'block'. The former
      // own-display count read 193-405 while zero labels were on screen
      // (measured 24Sep26h, and at 9990a5c where this spec was introduced).
      labels: [...document.querySelectorAll('.station-label')].filter(e => e.checkVisibility()).length,
      labelsTotal: document.querySelectorAll('.station-label').length,
      distortion: u.underwaterSurface.uniforms.uUnderwaterAmount.value,
      hasSceneDepth: !!u.composer.renderTarget1.depthTexture,
      samples: [u.composer.renderTarget1.samples, u.composer.renderTarget2.samples],
      above: u.isSubmergedAt(x, u.WATER_TOP_Y + 1, z) };
  }, pose);
  expect(state.floor).toBe('CLAY');
  expect(state.above).toBe(false);
  expect(state.parks).toBe(false);
  expect(state.labelsTotal).toBeGreaterThan(0); // labels exist, so 0 visible is meaningful
  expect(state.labels).toBe(0);
  expect(state.distortion).toBe(1);
  expect(state.hasSceneDepth).toBe(true);
  expect(state.samples[1]).toBe(0);
  // Shell has walls/endcaps only; an opaque 9,004-triangle ceiling would hide sky.
  expect(state.ceiling).toBe(6004 * 3);
  await page.evaluate(() => {
    const u = window.__ug, delta = u.WATER_TOP_Y + 15 - u.camera.position.y;
    u.camera.position.y += delta; u.controls.target.y += delta; u.controls.update();
  });
  await expect.poll(() => page.evaluate(() => window.__ug.parkLabelsGroup.visible)).toBe(true);
  // External station labels restore on exit: the surface label layers display again.
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.station-layer-surface')]
    .some(layer => getComputedStyle(layer).display !== 'none'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ug.underwaterSurface.uniforms.uUnderwaterAmount.value)).toBe(0);
  expect(errors).toEqual([]);
});

test('real held Q input presses against bed, release cancels, then sustained input crosses', async ({ page }) => {
  await ready(page);
  await setRiverPose(page, true);
  await page.keyboard.down('KeyQ');
  await page.waitForFunction(() => window.__ug.materialResistance.state?.kind === 'hold');
  await page.waitForTimeout(220);
  expect(await page.evaluate(() => window.__ug.classifySubstrateAt(window.__ug.camera.position))).toBe('WATER');
  await page.keyboard.up('KeyQ');
  await expect.poll(() => page.evaluate(() => window.__ug.materialResistance.state)).toBe(null);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.__ug.classifySubstrateAt(window.__ug.camera.position))).toBe('WATER');
  await page.keyboard.down('KeyQ');
  await page.waitForFunction(() => window.__ug.classifySubstrateAt(window.__ug.camera.position) === 'CLAY', null, { timeout: 4000 });
  await page.keyboard.up('KeyQ');
  expect(await page.evaluate(() => window.__ug.substrateSpeedFactor)).toBe(1);
});
