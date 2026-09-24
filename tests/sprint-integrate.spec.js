// sprint-integrate.spec.js: the seams between sprint 23Sep26w lanes (D-037).
//
// 1. One world wind: aircraft (lane F) pick runways from the same surface wind
//    the Balloon (lane A3) drifts on (src/wind.js, lane A1).
// 2. Keys: the mode digits 1-4 (lane A1) do not disturb another lane's
//    controls (sun slider and shadows toggle, lane D), and the Balloon's T
//    warp only answers inside Balloon.

import { test, expect } from '@playwright/test';

async function boot(page, url = '/?skip=1') {
  await page.goto(url);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro
    && !window.__ug.intro.isRunning()), null, { timeout: 90000 });
}

test.describe('Sprint 23Sep26w integration seams', () => {
  test('flights read the shared surface wind from wind.js', async ({ page }) => {
    await boot(page);
    const rows = await page.evaluate(() => [0, 377, 1800, 3600, 86400].map(t => ({
      t, flight: window.__ug.getFlightWind(t), surface: window.__ug.getSurfaceWind(t),
    })));
    for (const { t, flight, surface } of rows) {
      expect(flight.dirRad, `dir at t=${t}`).toBe(surface.dirRad);
      expect(flight.speedMps, `speed at t=${t}`).toBe(surface.speedMps);
    }
    // The shared wind is not the flights module's fixed default (5 m/s exactly),
    // so this proves the source was wired rather than coincidentally equal.
    expect(rows.some(r => r.flight.speedMps !== 5)).toBe(true);
    expect(await page.evaluate(() => window.__ug.flightsInitError ?? null)).toBeNull();
  });

  test('mode keys 1-4 and T do not collide with other lanes\' controls', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { document.getElementById('hudDetails').open = true; });
    const state = () => page.evaluate(() => ({
      sun: document.getElementById('sunTime')?.value ?? null,
      shadows: document.getElementById('sunShadows')?.getAttribute('aria-pressed') ?? null,
      mode: window.__ug.modes.activeId,
      hint: document.getElementById('ug-mode-hint')?.textContent ?? '',
    }));
    const before = await state();
    expect(before.sun).not.toBeNull();
    expect(before.shadows).not.toBeNull();

    // T outside Balloon is unbound: nothing changes.
    await page.keyboard.press('t');
    expect(await state()).toEqual(before);

    for (const [key, id] of [['2', 'pedestrian'], ['3', 'drone'], ['4', 'balloon']]) {
      await page.keyboard.press(key);
      const s = await state();
      expect(s.mode).toBe(id);
      expect(s.sun).toBe(before.sun);
      expect(s.shadows).toBe(before.shadows);
    }
    // Inside Balloon, T toggles the warp (and only that).
    await page.keyboard.press('t');
    const warped = await state();
    expect(warped.hint).toMatch(/ON/);
    expect(warped.sun).toBe(before.sun);
    expect(warped.shadows).toBe(before.shadows);
    await page.keyboard.press('1');
    const back = await state();
    expect(back.mode).toBe('deity');
    expect(back.sun).toBe(before.sun);
    expect(back.shadows).toBe(before.shadows);
  });
});
