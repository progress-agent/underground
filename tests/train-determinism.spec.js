// Sprint 25Sep26f (D-039, Lane H): two loads of the app give identical tube
// train positions at the same simulation time. Trains used Math.random for
// their phases and dwell, and stepped frame by frame, so every load (and every
// frame rate) ran a different timetable. Now each train is seeded by its id and
// placed by a pure function of the train system's clock.
import { test, expect } from '@playwright/test';

async function trainsAt(browser, simT) {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  // Line topology comes from the live TfL API when reachable, and its answers can
  // differ between two loads minutes apart (seen: the Northern line's branch
  // split). Pin both loads to the bundled route data, so this checks the trains.
  await context.route('https://api.tfl.gov.uk/**', route => route.abort());
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.trainSystem?.allTrains.length > 100, null, { timeout: 180000 });
  // The terrain resnap rebuilds the tube branches and their trains (same ids,
  // new curves): wait until ids and curve lengths have held still for 3 s, then
  // run the (idempotent) resnap once more so both loads are surely snapped.
  await page.waitForFunction(() => {
    const key = window.__ug.trainSystem.allTrains.map(t => `${t.userData.id}=${t.userData.curveLengthM.toFixed(3)}`).sort().join('|');
    const now = performance.now(), w = window;
    if (w.__trainKey !== key) { w.__trainKey = key; w.__trainKeySince = now; return false; }
    return now - w.__trainKeySince > 3000;
  }, null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => window.__ug.snapAllTubesToTerrain());
  const out = await page.evaluate(async simT => {
    // Import the exact URL the app loaded (after an HMR update Vite adds ?t=...).
    const loaded = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/src\/trains\.js(\?|$)/.test(n)).pop();
    const mod = await import(loaded ?? '/src/trains.js');
    const u = window.__ug, sys = u.trainSystem;
    // Same module instance as the app's (the batch stats object is shared).
    const sameModule = mod.trainBatchStats === u.trainBatchStats;
    // Synchronous: no frame can run between setting the clock and reading back.
    const liveClock = sys.simTime;
    sys.simTime = simT;
    mod.updateTrains(sys, { paused: true, timeScale: 1 }, null, 0);
    const trains = {};
    for (const t of sys.allTrains) {
      const ud = t.userData, w = new window.__ugTHREE.Vector3();
      t.getWorldPosition(w);
      trains[ud.id] = { t: ud.t, dwell: ud.dwellSec, left: ud._pausedLeft, p: t.position.toArray(), w: w.toArray() };
    }
    return { sameModule, liveClock, count: sys.allTrains.length, trains };
  }, simT);
  await context.close();
  return { ...out, errors };
}

test('two loads place every tube train identically at the same simulation time', async ({ browser }) => {
  test.setTimeout(420000);
  const T = 1234.5;
  const a = await trainsAt(browser, T);
  const b = await trainsAt(browser, T);
  expect(a.sameModule).toBe(true);
  expect(b.sameModule).toBe(true);
  // The live clock ran on each load before being set, so the check is not trivially at zero.
  expect(a.liveClock).toBeGreaterThan(0);
  expect(a.count).toBeGreaterThan(100);
  const idsA = Object.keys(a.trains).sort(), idsB = Object.keys(b.trains).sort();
  expect(idsA.length).toBe(a.count); // ids are unique
  expect(idsB).toEqual(idsA);
  let worst = 0, dwelling = 0; const differ = [];
  for (const id of idsA) {
    const x = a.trains[id], y = b.trains[id];
    const d = Math.hypot(x.w[0] - y.w[0], x.w[1] - y.w[1], x.w[2] - y.w[2]);
    worst = Math.max(worst, d);
    if (x.t !== y.t || x.dwell !== y.dwell || x.left !== y.left) differ.push(id);
    if (x.left > 0) dwelling++;
  }
  expect(differ).toEqual([]);
  expect(worst).toBe(0);
  expect(dwelling).toBeGreaterThan(0);
});
