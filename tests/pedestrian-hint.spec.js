// pedestrian-hint.spec.js: Lane F (sprint 02Oct26f, D-047 walk-stopping-hint).
//
// "Stopping at Upminster" used to show for one frame after the arrival card opened: the hint was
// chosen at the top of the platform block ("Stopping at X", the card not yet open) and the card
// opened later in the same frame, so the card and the hint changed together in the wrong order.
//
// Scenario (frame by frame, in a requestAnimationFrame callback, so after the app's tick): the
// walker in the bore facing the stop, hold W at the walking pace, and once the arrival at the stop
// is logged, press E (brake to rest on the platform, then the card opens) and release W. Every
// frame records the hint text and the card kind until the card is `arrival` plus 30 frames.
//
// Pass: some frame reads "Stopping at <stop>" before the card opens (the scenario was exercised),
// and no frame has the card open while the hint starts with "Stopping at". On e0675d7 the same
// probe shows an offending frame (that calibrates it).

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

async function boot(page) {
  await page.goto('/?skip=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const b = window.__ug.bakedStats;
    return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
      && window.__ug.unifiedShaftLayer && window.__ug.trainSystem?.allTrains.length > 100
      && window.__ug.modes.ctx.tubeRoutes?.size > 11 && window.__ug.surfaceRail;
  }, null, { timeout: 180000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
}

const placeAt = (page, lineId, from, toward) => page.evaluate(([lineId, from, toward]) => {
  const m = window.__ug.modes.registry.get('pedestrian');
  const net = m.rebuildNetwork();
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    const st = p.stops.find(x => x.stop.name.startsWith(from));
    if (!st) continue;
    for (const dir of [1, -1]) {
      const nx = dir > 0 ? p.stations.find(x => x.s > st.s + 1e-6) : [...p.stations].reverse().find(x => x.s < st.s - 1e-6);
      if (nx && nx.name.startsWith(toward)) { m.placeInTunnel({ path: p.id, s: st.s, dir }); return { path: p.id, s: st.s, dir }; }
    }
  }
  return null;
}, [lineId, from, toward]);

test.beforeEach(async ({ page }) => { await boot(page); });

for (const [lineId, from, toward, stop] of [['district', 'Upminster Bridge', 'Upminster', 'Upminster'], ['victoria', 'Oxford Circus', 'Green Park', 'Green Park']]) {
  test(`the hint never reads "Stopping at" while the arrival card is open: ${stop}`, async ({ page }) => {
    expect(await placeAt(page, lineId, from, toward)).not.toBeNull();
    const r = await page.evaluate(([stop]) => new Promise((resolve) => {
      const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), hintEl = () => document.getElementById('ug-mode-hint');
      const frames = [], t0 = performance.now();
      const n0 = m.debug().arrivals.length;
      let state = 'walking', after = 0, pressed = false;
      ug.fpsControls.keys.add('w');
      const step = () => {
        const d = m.debug();
        frames.push({ hint: hintEl()?.textContent ?? '', card: d.card?.kind ?? null, state });
        if (state === 'walking' && d.arrivals.length > n0 && d.arrivals.at(-1).name === stop) state = 'arrived';
        if (state === 'arrived' && !pressed && d.tunnel) {
          // On its platform: E (stop here), and W released.
          m.press('use'); ug.fpsControls.keys.delete('w'); pressed = true; state = 'braking';
        }
        if (d.card?.kind === 'arrival') after++;
        if (after >= 30 || performance.now() - t0 > 60000) { ug.fpsControls.keys.delete('w'); resolve({ frames, timedOut: after < 30 }); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), [stop]);
    expect(r.timedOut, 'the card opened').toBe(false);
    const stoppingBefore = r.frames.filter(f => f.card === null && f.hint.startsWith(`Stopping at ${stop}`));
    const offending = r.frames.filter(f => f.card === 'arrival' && f.hint.startsWith('Stopping at'));
    console.log(`[pedestrian-hint] ${stop}: ${r.frames.length} frames, "Stopping at" before the card ${stoppingBefore.length}, offending ${offending.length}`);
    expect(stoppingBefore.length, 'the scenario was exercised: a "Stopping at" frame before the card').toBeGreaterThan(0);
    expect(offending, 'frames with the card open and a "Stopping at" hint').toEqual([]);
    // And once the card is open the hint is the card's own.
    const open = r.frames.filter(f => f.card === 'arrival');
    expect(open.length).toBeGreaterThanOrEqual(30);
    expect(open.every(f => f.hint.includes('choose'))).toBe(true);
  });
}
