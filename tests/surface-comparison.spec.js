// Surface A/B comparison screenshots — texture vs geometry approaches
// Run: npx playwright test tests/surface-comparison.spec.js
// Produces 6 PNGs in tests/screenshots/ (2 approaches × 3 altitudes)

import { test, expect } from '@playwright/test';

test('Surface A/B comparison screenshots', async ({ page }) => {
  // Collect console output for debugging
  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('/', { waitUntil: 'networkidle' });

  // Wait for loading bar to complete (terrain + TfL data)
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    { timeout: 90000 },
  );

  // Wait for __ug exposure (camera, controls, scene)
  await page.waitForFunction(() => {
    return window.__ug && window.__ug.camera && window.__ug.controls;
  }, { timeout: 30000 });

  // Extra settle time for terrain mesh + shafts + surface data
  await page.waitForTimeout(5000);

  const soloSelect = page.locator('#soloLine');

  // Verify the dropdown has surface options
  const optionValues = await soloSelect.locator('option').evaluateAll(
    opts => opts.map(o => o.value)
  );
  console.log('Dropdown options:', optionValues.join(', '));
  expect(optionValues).toContain('surface-texture');
  expect(optionValues).toContain('surface-geometry');

  // Helper: position camera at a specific altitude above Hyde Park
  async function setCameraAltitude(y) {
    await page.evaluate((altitude) => {
      const { camera, controls } = window.__ug;
      // Hyde Park centre in scene coordinates
      const target = { x: -2578, y: 0, z: -12 };
      controls.target.set(target.x, target.y, target.z);
      camera.position.set(target.x + 500, altitude, target.z + 500);
      controls.update();
    }, y);
    // Let the renderer settle (LOD, fog, bloom)
    await page.waitForTimeout(2000);
  }

  const altitudes = [
    { y: 3000, label: 'high' },
    { y: 500,  label: 'mid' },
    { y: 100,  label: 'low' },
  ];

  const approaches = [
    { value: 'surface-texture',  label: 'texture' },
    { value: 'surface-geometry', label: 'geometry' },
  ];

  const screenshotDir = '/Users/jc/repos/underground/tests/screenshots';

  for (const approach of approaches) {
    // Select the approach from dropdown — triggers applySoloSelection + camera move
    await soloSelect.selectOption(approach.value);
    // Wait for features to render and auto-camera to settle
    await page.waitForTimeout(3000);

    for (const alt of altitudes) {
      await setCameraAltitude(alt.y);

      const filename = `surface-${approach.label}-${alt.label}-${alt.y}m.png`;
      await page.screenshot({
        path: `${screenshotDir}/${filename}`,
        fullPage: false,
      });
      console.log(`Captured: ${filename}`);
    }
  }

  // Log any errors for debugging
  const errors = consoleMsgs.filter(m => m.startsWith('[error]'));
  if (errors.length > 0) {
    console.log('Console errors during capture:', errors.slice(0, 10));
  }

  console.log('All 6 screenshots captured successfully.');
});
