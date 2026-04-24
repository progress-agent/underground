// landscape-lock.spec.js — Week-1 Steps 3 + 4.
//
// Verifies:
// - Portrait + narrow viewport shows the rotate-device overlay
// - Landscape viewport hides it
// - matchMedia transitions update overlay visibility live
// - Desktop-width portrait does NOT trigger (aspect-based, not orientation-alone)
// - controls.touches config matches D-001 §4 (ONE=PAN, TWO=DOLLY_ROTATE)

import { test, expect } from '@playwright/test';

test('landscape-lock overlay hides in landscape (default desktop test viewport)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?skipintro=1');
  await expect(page.locator('#ug-landscape-lock')).toBeHidden({ timeout: 6000 });
});

test('landscape-lock overlay shows in narrow portrait (phone)', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/?skipintro=1');

  const overlay = page.locator('#ug-landscape-lock');
  await expect(overlay).toBeVisible({ timeout: 6000 });
  await expect(overlay).toHaveClass(/locked/);
  await expect(overlay).toContainText('Rotate your device');
});

test('landscape-lock does NOT trigger on desktop-width portrait (> 900px)', async ({ page }) => {
  // Tall window but plenty wide — user has agency, don't gate them.
  await page.setViewportSize({ width: 1100, height: 1400 });
  await page.goto('/?skipintro=1');
  await expect(page.locator('#ug-landscape-lock')).toBeHidden({ timeout: 6000 });
});

test('rotating from portrait to landscape hides the overlay', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/?skipintro=1');
  await expect(page.locator('#ug-landscape-lock')).toBeVisible({ timeout: 6000 });

  // Flip to landscape — matchMedia listener should react.
  await page.setViewportSize({ width: 800, height: 400 });
  await expect(page.locator('#ug-landscape-lock')).toBeHidden({ timeout: 2000 });
});

test('rotating from landscape to portrait shows the overlay', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 });
  await page.goto('/?skipintro=1');
  await expect(page.locator('#ug-landscape-lock')).toBeHidden({ timeout: 6000 });

  await page.setViewportSize({ width: 400, height: 800 });
  await expect(page.locator('#ug-landscape-lock')).toBeVisible({ timeout: 2000 });
});

test('controls.touches matches D-001 §4 mobile spec (ONE=PAN, TWO=DOLLY_ROTATE)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?skipintro=1');

  // Wait for __ug debug surface.
  await page.waitForFunction(() => window.__ug && window.__ug.controls, null, { timeout: 6000 });

  const touches = await page.evaluate(() => {
    // THREE.TOUCH enum: ROTATE=0, PAN=1, DOLLY_PAN=2, DOLLY_ROTATE=3
    // (https://threejs.org/docs/?q=TOUCH#api/en/constants/CustomBlendingEquations)
    return {
      ONE: window.__ug.controls.touches.ONE,
      TWO: window.__ug.controls.touches.TWO,
    };
  });
  // PAN = 1, DOLLY_ROTATE = 3 in three.js r161 THREE.TOUCH.
  expect(touches.ONE).toBe(1);
  expect(touches.TWO).toBe(3);
});
