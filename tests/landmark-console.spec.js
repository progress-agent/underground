// Sprint 01Oct26h Lane M (D-043 housekeeping): building the landmarks logs no
// "THREE.Object3D.add: object not an instance of THREE.Object3D." error. Before
// the guard in src/landmark-models.js (the assembler's finish), every load
// logged 124 of them, one per landmark building with no separate meshes. That
// the groups are otherwise unchanged is proved object by object in
// tests/landmark-extras.test.mjs.
import { test, expect } from '@playwright/test';

test('the landmarks attach with no Object3D.add console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?buildings=baked&skip=1');
  await page.waitForFunction(() => window.__ug?.landmarkGroup?.parent
    && window.__ug.bakedStats?.tilesBuilt === window.__ug.bakedStats?.tilesTotal, null, { timeout: 150000 });
  const landmarks = await page.evaluate(() => {
    let objects = 0, meshes = 0;
    window.__ug.landmarkGroup.traverse((o) => { objects++; if (o.isMesh) meshes++; });
    return { sites: window.__ug.landmarkGroup.children.length, objects, meshes };
  });
  console.log('landmarks:', JSON.stringify(landmarks), 'console errors:', errors.length);
  // Not vacuous: all eleven sites built, hundreds of objects.
  expect(landmarks.sites).toBe(11);
  expect(landmarks.objects).toBeGreaterThan(200);
  expect(errors.filter((t) => t.includes('Object3D.add'))).toEqual([]);
});
