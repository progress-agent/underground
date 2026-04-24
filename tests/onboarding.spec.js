// onboarding.spec.js — Week-1 Step 2 Playwright coverage.
//
// Fires intro via URL-skip (?skipintro=1 — any non-whitelisted query triggers
// the fast path in intro.js that dispatches ug:intro-done immediately), so
// tests don't wait out the 9-second cinematic every run.

import { test, expect } from '@playwright/test';

const FRESH = '/?skipintro=1';

async function gotoFreshOnboarding(page) {
  // Start clean — clear localStorage before the page script runs so the hint
  // is in first-time-visitor state.
  await page.addInitScript(() => {
    try { localStorage.removeItem('ug:onboarding-seen'); } catch (e) {}
  });
  await page.goto(FRESH);
}

async function gotoSeenOnboarding(page) {
  // Pre-set the seen flag — simulates returning visitor.
  await page.addInitScript(() => {
    try { localStorage.setItem('ug:onboarding-seen', '1'); } catch (e) {}
  });
  await page.goto(FRESH);
}

test('hint card appears after ug:intro-done for fresh visitor', async ({ page }) => {
  await gotoFreshOnboarding(page);

  const hint = page.locator('#ug-onboarding-hint');
  await expect(hint).toBeVisible({ timeout: 6000 });

  // Content sanity — matches Step 1 control scheme.
  await expect(hint).toContainText('Forward');
  await expect(hint).toContainText('Strafe');
  await expect(hint).toContainText('sprint');
});

test('persistent ? icon appears after ug:intro-done', async ({ page }) => {
  await gotoFreshOnboarding(page);
  const icon = page.locator('#ug-help-icon');
  await expect(icon).toBeVisible({ timeout: 6000 });
});

test('hint does NOT appear for returning visitor (localStorage flag set)', async ({ page }) => {
  await gotoSeenOnboarding(page);

  // Give ug:intro-done ample time to fire.
  await page.waitForFunction(() => document.getElementById('ug-help-icon')?.classList.contains('ready'), null, { timeout: 6000 });

  const hint = page.locator('#ug-onboarding-hint');
  await expect(hint).toBeHidden();

  // Icon still visible — persistent regardless of seen flag.
  await expect(page.locator('#ug-help-icon')).toBeVisible();
});

test('first keydown dismisses hint and writes localStorage flag', async ({ page }) => {
  await gotoFreshOnboarding(page);
  await expect(page.locator('#ug-onboarding-hint')).toBeVisible({ timeout: 6000 });

  await page.keyboard.press('Space');

  // Hint removed from DOM after fade.
  await expect(page.locator('#ug-onboarding-hint')).toHaveCount(0, { timeout: 2000 });

  // Flag persisted.
  const flag = await page.evaluate(() => localStorage.getItem('ug:onboarding-seen'));
  expect(flag).toBe('1');
});

test('clicking ? icon opens modal with Basics tab active by default', async ({ page }) => {
  await gotoFreshOnboarding(page);
  await expect(page.locator('#ug-help-icon')).toBeVisible({ timeout: 6000 });

  await page.locator('#ug-help-icon').click();

  const modal = page.locator('#ug-help-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveClass(/visible/);

  const basicsPanel = modal.locator('[data-panel="basics"]');
  const allPanel = modal.locator('[data-panel="all"]');
  await expect(basicsPanel).toBeVisible();
  await expect(allPanel).toBeHidden();

  // Default tab button aria state.
  await expect(modal.locator('.tab.active')).toHaveText(/Basics/i);
});

test('tab switch shows All Controls panel', async ({ page }) => {
  await gotoSeenOnboarding(page);  // skip hint noise
  await expect(page.locator('#ug-help-icon')).toBeVisible({ timeout: 6000 });
  await page.locator('#ug-help-icon').click();

  const modal = page.locator('#ug-help-modal');
  await modal.locator('.tab[data-tab="all"]').click();

  await expect(modal.locator('[data-panel="all"]')).toBeVisible();
  await expect(modal.locator('[data-panel="basics"]')).toBeHidden();
  await expect(modal).toContainText('Orbit');  // unique to All Controls
  await expect(modal.locator('.tab.active')).toHaveText(/All Controls/i);
});

test('Escape key closes open modal', async ({ page }) => {
  await gotoSeenOnboarding(page);
  await expect(page.locator('#ug-help-icon')).toBeVisible({ timeout: 6000 });
  await page.locator('#ug-help-icon').click();
  await expect(page.locator('#ug-help-modal')).toBeVisible();

  await page.keyboard.press('Escape');

  // After FADE_MS (300) the modal's display flips to none.
  await expect(page.locator('#ug-help-modal')).toBeHidden({ timeout: 1000 });
});

test('backdrop click closes open modal; panel click does not', async ({ page }) => {
  await gotoSeenOnboarding(page);
  await expect(page.locator('#ug-help-icon')).toBeVisible({ timeout: 6000 });
  await page.locator('#ug-help-icon').click();

  // Click panel — should stay open.
  await page.locator('#ug-help-modal .panel').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#ug-help-modal')).toBeVisible();

  // Click backdrop — should close.
  await page.locator('#ug-help-modal .backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#ug-help-modal')).toBeHidden({ timeout: 1000 });
});

test('clicking ? icon does not dismiss the hint', async ({ page }) => {
  await gotoFreshOnboarding(page);
  await expect(page.locator('#ug-onboarding-hint')).toBeVisible({ timeout: 6000 });

  // Open modal via icon — hint should still be present (icon click is
  // explicitly filtered out of the first-input dismiss path).
  await page.locator('#ug-help-icon').click();
  await expect(page.locator('#ug-help-modal')).toBeVisible();
  await expect(page.locator('#ug-onboarding-hint')).toBeVisible();
});
