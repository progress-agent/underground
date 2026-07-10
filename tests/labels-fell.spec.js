// labels-fell.spec.js — Item C: station label rework.
//
//   1. IM Fell English at half scale, chipless (no background/border; stacked
//      dark text-shadow halo instead — NO backdrop-filter, trap-listed).
//   2. Per-priority distance tiers (PRIO_DIST_MULT [0.55, 1.0, 1.45]):
//      termini / 3+-line hubs visible from LONGER distances than the shared
//      cutoff, single-line stations culled at SHORTER distances. Both the
//      surface path and the underground path.
//   3. Declutter grid halved with the label scale (56x28, was 92x46).
//
// In-chalk label hiding + tooltip liveness is covered by chalk-clarity.spec.js.
//
// Tier proof strategy: Cockfosters (Piccadilly terminus, priority 2) and
// Oakwood (single-line neighbour, priority 0) are ~1.6km apart and roughly
// collinear with the line. Placing the camera on the far side of Oakwood puts
// Cockfosters BEYOND the shared cutoff (visible only via the 1.45x boost) while
// Oakwood sits INSIDE it (hidden only via the 0.55x cull) — each assertion
// fails against the pre-Item-C shared-cutoff behaviour.

import { test, expect } from '@playwright/test';

async function gotoLoaded(page) {
  await page.goto('/?fast=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    null, { timeout: 90000 },
  );
  await page.waitForFunction(
    () => window.__ug && window.__ug.camera && window.__ug.labelPolicy
      && document.querySelectorAll('.station-label-surface').length > 0,
    null, { timeout: 30000 },
  );
  // Settle terrain snap + surfaceY resolution for the labels.
  await page.waitForTimeout(4000);
}

const labelState = (page, selector, name) => page.evaluate(({ selector, name }) => {
  const el = [...document.querySelectorAll(selector)]
    .find(e => e.textContent === name);
  if (!el) return { found: false };
  const s = getComputedStyle(el);
  return {
    found: true,
    visible: s.display !== 'none' && parseFloat(s.opacity || '0') > 0.05,
  };
}, { selector, name });

// Find the terminus/single pair and return their scene data.
const findPair = (page) => page.evaluate(() => {
  const u = window.__ug;
  const all = [];
  for (const [, layers] of u.lineShaftLayers) {
    for (const st of (layers.stationsLayer?.stations || [])) all.push(st);
  }
  const cock = all.find(s => /Cockfosters/i.test(s.name) && s.isTerminus);
  const oak = all.find(s => /Oakwood/i.test(s.name));
  return { haveCock: !!cock, haveOak: !!oak };
});

test('labels are IM Fell English, chipless, halo-cushioned, half scale', async ({ page }) => {
  await gotoLoaded(page);
  const style = await page.evaluate(() => {
    const el = document.querySelector('.station-label-surface');
    const s = getComputedStyle(el);
    const sizes = [...document.querySelectorAll('.station-label-surface')]
      .map(e => parseFloat(e.style.fontSize));
    return {
      fontFamily: s.fontFamily,
      background: s.backgroundColor,
      borderWidth: s.borderTopWidth,
      textShadow: s.textShadow,
      backdrop: s.backdropFilter || 'none',
      minPx: Math.min(...sizes),
      maxPx: Math.max(...sizes),
    };
  });
  expect(style.fontFamily.startsWith('"IM Fell English"')).toBe(true);
  // Chip removed: transparent background, no border.
  expect(style.background).toBe('rgba(0, 0, 0, 0)');
  expect(style.borderWidth).toBe('0px');
  // Halo cushion present (stacked shadows), backdrop-filter absent.
  expect(style.textShadow).not.toBe('none');
  expect(style.backdrop).toBe('none');
  // Half scale: was 16.5/11/8.25px, now 8.25/6/6px.
  expect(style.minPx).toBeGreaterThanOrEqual(6);
  expect(style.maxPx).toBeLessThanOrEqual(8.5);
});

test('declutter grid + priority multipliers match the Item C policy', async ({ page }) => {
  await gotoLoaded(page);
  const policy = await page.evaluate(() => window.__ug.labelPolicy);
  expect(policy.cellW).toBe(56);
  expect(policy.cellH).toBe(28);
  expect(policy.prioDistMult).toEqual([0.55, 1.0, 1.45]);
});

test('surface tiers: terminus visible beyond shared cutoff, single culled inside it', async ({ page }) => {
  await gotoLoaded(page);
  expect(await findPair(page)).toEqual({ haveCock: true, haveOak: true });

  const pose = await page.evaluate(() => new Promise((resolve) => {
    const u = window.__ug;
    const all = [];
    for (const [, layers] of u.lineShaftLayers) {
      for (const st of (layers.stationsLayer?.stations || [])) all.push(st);
    }
    const cock = all.find(s => /Cockfosters/i.test(s.name) && s.isTerminus);
    const oak = all.find(s => /Oakwood/i.test(s.name));
    // Horizontal axis running Cockfosters -> Oakwood (roughly along the line,
    // toward central London); camera goes on the far side of Oakwood.
    let dx = oak.pos.x - cock.pos.x, dz = oak.pos.z - cock.pos.z;
    const sep = Math.hypot(dx, dz);
    dx /= sep; dz /= sep;
    u.fpsControls.enabled = false;

    const place = (distFromOak) => {
      const cx = oak.pos.x + dx * distFromOak;
      const cz = oak.pos.z + dz * distFromOak;
      const sy = u.getTerrainMeshSurfaceY({ x: cx, z: cz }) ?? 0;
      // ~287 scene units above ground puts the shared cutoff near 4000 —
      // small enough that the 1.6km station separation spans the tier bands.
      u.camera.position.set(cx, sy + 287, cz);
      u.controls.target.set(
        (oak.pos.x + cock.pos.x) / 2, 0, (oak.pos.z + cock.pos.z) / 2);
      u.controls.update();
      u.camera.updateMatrixWorld(true);
    };
    place(3400);
    // Two frames so beginLabelFrameIfNeeded recomputes the shared policy.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c1 = u.labelPolicy.surfCutoff;
      place(0.85 * c1); // altitude unchanged -> cutoff stable
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({
          cutoff: u.labelPolicy.surfCutoff,
          dOak: u.camera.position.distanceTo(oak.pos),
          dCock: u.camera.position.distanceTo(cock.pos),
        });
      }));
    }));
  }));

  // Geometry sanity: each station sits in the band that isolates its tier rule.
  expect(pose.dOak).toBeGreaterThan(pose.cutoff * 0.55);   // 0.55x cull applies
  expect(pose.dOak).toBeLessThan(pose.cutoff);             // old rule would SHOW it
  expect(pose.dCock).toBeGreaterThan(pose.cutoff);         // old rule would HIDE it
  expect(pose.dCock).toBeLessThan(pose.cutoff * 1.45);     // 1.45x boost applies

  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cockState = await labelState(page, '.station-label-surface', 'Cockfosters');
  const oakState = await labelState(page, '.station-label-surface', 'Oakwood');
  expect(cockState).toEqual({ found: true, visible: true });
  expect(oakState).toEqual({ found: true, visible: false });
});

test('underground tiers: terminus visible beyond old 9000, single culled', async ({ page }) => {
  await gotoLoaded(page);
  expect(await findPair(page)).toEqual({ haveCock: true, haveOak: true });

  const pose = await page.evaluate(() => new Promise((resolve) => {
    const u = window.__ug;
    const all = [];
    for (const [, layers] of u.lineShaftLayers) {
      for (const st of (layers.stationsLayer?.stations || [])) all.push(st);
    }
    const cock = all.find(s => /Cockfosters/i.test(s.name) && s.isTerminus);
    const oak = all.find(s => /Oakwood/i.test(s.name));
    let dx = oak.pos.x - cock.pos.x, dz = oak.pos.z - cock.pos.z;
    const sep = Math.hypot(dx, dz);
    dx /= sep; dz /= sep;
    u.fpsControls.enabled = false;
    // 8200 beyond Oakwood toward town: dOak ~ 8200 (inside the old 9000 —
    // hidden only by the 0.55x cull at 4950), dCock ~ 9800 (beyond the old
    // 9000 — visible only via the 1.45x boost to 13050). Camera 150 units
    // below the local surface (well above the chalk at ~-300).
    const cx = oak.pos.x + dx * 8200;
    const cz = oak.pos.z + dz * 8200;
    const sy = u.getTerrainMeshSurfaceY({ x: cx, z: cz }) ?? 0;
    u.camera.position.set(cx, sy - 150, cz);
    u.controls.target.copy(cock.pos);
    u.controls.update();
    u.camera.updateMatrixWorld(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        max: u.labelPolicy.labelMaxDistance,
        dOak: u.camera.position.distanceTo(oak.pos),
        dCock: u.camera.position.distanceTo(cock.pos),
        chalkClarity: u.chalkClarity,
        ugLayerShown: [...document.querySelectorAll('.station-layer-underground')]
          .some(el => el.style.display !== 'none'),
      });
    }));
  }));

  expect(pose.chalkClarity).toBe(0);          // above the chalk: labels active
  expect(pose.ugLayerShown).toBe(true);       // underground path engaged
  expect(pose.dOak).toBeGreaterThan(pose.max * 0.55);  // 0.55x cull applies
  expect(pose.dOak).toBeLessThan(pose.max);            // old rule would SHOW it
  expect(pose.dCock).toBeGreaterThan(pose.max);        // old rule would HIDE it
  expect(pose.dCock).toBeLessThan(pose.max * 1.45);    // 1.45x boost applies

  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cockState = await labelState(page, '.station-label-underground', 'Cockfosters');
  const oakState = await labelState(page, '.station-label-underground', 'Oakwood');
  expect(cockState).toEqual({ found: true, visible: true });
  expect(oakState).toEqual({ found: true, visible: false });
});
