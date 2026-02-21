// Phase 2.5 verification — Labels, Shafts, Surfaces
// Single test that loads the app once and checks all assertions.
// Run: npx playwright test

import { test, expect } from '@playwright/test';

test('Phase 2.5: all streams verified', async ({ page }) => {
  // Collect console errors for debugging
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  // Wait for loading bar to complete — generous timeout for TfL API + terrain
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );
  // Extra settle time for terrain + shaft creation
  await page.waitForTimeout(3000);

  // Report any console errors for debugging
  if (consoleErrors.length > 0) {
    console.log('Console errors:', consoleErrors.slice(0, 5));
  }

  // ── Stream A: Labels ────────────────────────────────────────────

  // A1: Railway Sans font declared
  const fontFamily = await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily,
  );
  expect(fontFamily).toContain('Railway Sans');

  // A2: Station labels exist
  const labelCount = await page.evaluate(() =>
    document.querySelectorAll('.station-label').length,
  );
  expect(labelCount).toBeGreaterThan(100);

  // A3: Font sizes vary by station importance (surface labels)
  const sizes = await page.evaluate(() => {
    const labels = document.querySelectorAll('.station-label-surface');
    const sizeSet = new Set();
    for (const el of labels) {
      const fs = el.style.fontSize;
      if (fs) sizeSet.add(fs);
    }
    return [...sizeSet];
  });
  expect(sizes.length).toBeGreaterThanOrEqual(2);

  // ── Stream B: Shafts ────────────────────────────────────────────

  // B1: Unified shaft layer exists
  const shaftInfo = await page.evaluate(() => {
    const ug = window.__ug;
    if (!ug?.unifiedShaftLayer) return null;
    return {
      hasGroup: !!ug.unifiedShaftLayer.group,
      stationCount: ug.unifiedShaftLayer.byId?.size ?? 0,
      visible: ug.unifiedShaftLayer.group?.visible,
    };
  });
  expect(shaftInfo).not.toBeNull();
  expect(shaftInfo.hasGroup).toBe(true);
  expect(shaftInfo.stationCount).toBeGreaterThan(100);

  // B2: Shaft radii scale with interchange complexity
  const radii = await page.evaluate(() => {
    const ug = window.__ug;
    if (!ug?.unifiedShaftLayer?.byId) return null;
    const result = {};
    for (const [id, parts] of ug.unifiedShaftLayer.byId) {
      const name = parts.entry?.name || '';
      if (name.includes("King's Cross")) result.kingsCross = parts.radius;
      if (name.includes('Pimlico')) result.pimlico = parts.radius;
    }
    return result;
  });
  if (radii?.kingsCross && radii?.pimlico) {
    expect(radii.kingsCross).toBeGreaterThan(radii.pimlico);
  }

  // B3: Frosted glass material
  const matType = await page.evaluate(() => {
    const ug = window.__ug;
    const first = ug?.unifiedShaftLayer?.byId?.values().next().value;
    return first?.mesh?.material?.type;
  });
  expect(matType).toBe('MeshPhysicalMaterial');

  // ── Stream C: Surfaces ──────────────────────────────────────────

  // C1: Two terrain meshes exist
  const terrainMeshes = await page.evaluate(() => {
    const ug = window.__ug;
    const names = [];
    ug?.scene?.traverse(obj => {
      if (obj.name === 'terrainMesh') names.push('top');
      if (obj.name === 'terrainUnderside') names.push('underside');
    });
    return names;
  });
  expect(terrainMeshes).toContain('top');
  expect(terrainMeshes).toContain('underside');
});
