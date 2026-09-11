import { test, expect } from '@playwright/test';

for (const query of ['buildings=baked', 'ground=baked', 'buildings=baked&ground=live']) {
  test(`render settings preserve the opening: ${query}`, async ({ page }) => {
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => window.__ug?.intro);
    const state = await page.evaluate(() => {
      const u=window.__ug;
      return { running:u.intro.isRunning(), y:u.camera.position.y, orbit:u.controls.enabled, keyboard:u.fpsControls.enabled };
    });
    expect(state.running).toBe(true);
    expect(state.y).toBeGreaterThan(1000);
    expect(state.orbit).toBe(false);
    expect(state.keyboard).toBe(false);
  });
}

test('the exact review URL completes its opening at the tuned underground pose', async ({ page }) => {
  await page.goto('/?buildings=baked');
  await page.waitForFunction(() => window.__ug?.intro?.isRunning());
  await page.waitForFunction(() => !window.__ug.intro.isRunning(), null, {timeout:30000});
  const state = await page.evaluate(() => {
    const u=window.__ug, p=u.intro.getParams();
    return {position:u.camera.position.toArray(),expected:[p.endX,p.endY,p.endZ],terrain:u.getTerrainMeshSurfaceY({x:p.endX,z:p.endZ}),orbit:u.controls.enabled,keyboard:u.fpsControls.enabled};
  });
  for(let i=0;i<3;i++)expect(state.position[i]).toBeCloseTo(state.expected[i],4);
  // The intentional underground landing is well below the earth ceiling,
  // rather than the shallow fallback view looking into a hillside.
  expect(state.terrain-state.position[1]).toBeGreaterThan(50);
  expect(state.orbit).toBe(true);expect(state.keyboard).toBe(true);
});

for (const query of ['fast=1&buildings=baked', 'skip=1&buildings=baked', 'hx=5&buildings=baked']) {
  test(`explicit skip/deep link still bypasses opening: ${query}`, async ({ page }) => {
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => window.__ug?.intro);
    expect(await page.evaluate(() => window.__ug.intro.isRunning())).toBe(false);
  });
}
