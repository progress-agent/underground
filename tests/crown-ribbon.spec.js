// crown-ribbon.spec.js — Item A: crown ribbon line-colour device.
//
// Every tube line (11 + DLR) carries ONE merged opaque colour ribbon along
// its tunnel crowns (`ribbon:<lineId>` in the line group); dark lines
// (northern, jubilee) also carry ONE merged white casing mesh
// (`ribbon-casing:<lineId>`). Crossrail carries per-branch ribbons named
// `ribbon:elizabeth` in canonical purple (0x6950a1), NOT the gold body colour.
//
// Load-bearing invariants guarded here:
//   - material.transparent === false (transparent:true would re-enter the
//     transparent queue and re-open the glow-through-terrain bug class)
//   - emissiveIntensity <= 0.3 (AgX + bloom threshold 0.88 must never bloom
//     a ribbon above terrain from altitude)
//   - exactly ONE ribbon mesh per line group after boot (boot already runs
//     the snapAllTubesToTerrain rebuild — duplicates mean the 4b disposal /
//     registry bookkeeping leaked)
//   - a forced second rebuild keeps all invariants (idempotence)

import { test, expect } from '@playwright/test';

const BASE = '/?skipintro=1';

async function gotoAndWaitForNetwork(page) {
  await page.goto(BASE);
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    null, { timeout: 90000 }
  );
  // Terrain load triggers the snap rebuild; wait until it has landed so we
  // assert the REBUILT ribbons, then settle two frames.
  await page.waitForFunction(
    () => !!window.__ug && window.__ug.lineRibbonsById.size >= 10,
    null, { timeout: 30000 }
  );
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

function collectRibbonState(page) {
  return page.evaluate(() => {
    const u = window.__ug;
    const out = {};
    for (const [lineId, meshes] of u.lineRibbonsById.entries()) {
      out[lineId] = meshes.map(m => ({
        name: m.name,
        parent: m.parent?.name ?? null,
        transparent: m.material.transparent,
        depthWrite: m.material.depthWrite,
        depthTest: m.material.depthTest,
        emissiveIntensity: m.material.emissiveIntensity,
        colorHex: m.material.color.getHexString(),
        inScene: (() => { let o = m; while (o.parent) o = o.parent; return o === u.scene; })(),
      }));
    }
    // Per-group ribbon child counts (duplicate/leak detector).
    const groupCounts = {};
    u.scene.traverse(o => {
      if (o.name && o.name.startsWith('line:')) {
        const id = o.name.slice(5);
        groupCounts[id] = o.children.filter(c => c.name === `ribbon:${id}`).length;
      }
    });
    return { ribbons: out, groupCounts };
  });
}

test('crown ribbons: one opaque canonical-colour ribbon per line, casing on dark lines', async ({ page }) => {
  await gotoAndWaitForNetwork(page);
  const { ribbons, groupCounts } = await collectRibbonState(page);

  const lineIds = Object.keys(ribbons);
  expect(lineIds.length).toBeGreaterThanOrEqual(11);
  for (const id of ['northern', 'jubilee', 'central', 'victoria', 'dlr']) {
    expect(lineIds).toContain(id);
  }

  for (const [id, meshes] of Object.entries(ribbons)) {
    const colour = meshes.find(m => m.name === `ribbon:${id}`);
    expect(colour, `ribbon:${id} missing`).toBeTruthy();
    expect(colour.parent).toBe(`line:${id}`);
    expect(colour.inScene).toBe(true);
    // Exactly one colour ribbon per group — boot already ran the snap
    // rebuild, so >1 means the 4b disposal/bookkeeping leaked.
    expect(groupCounts[id], `duplicate ribbon:${id}`).toBe(1);

    for (const m of meshes) {
      expect(m.transparent, `${m.name} must stay opaque`).toBe(false);
      expect(m.depthWrite).toBe(true);
      expect(m.depthTest).toBe(true);
      expect(m.emissiveIntensity).toBeLessThanOrEqual(0.3);
    }
  }

  // White casing edges on the Jordan-named dark lines only.
  for (const id of ['northern', 'jubilee']) {
    const casing = ribbons[id].find(m => m.name === `ribbon-casing:${id}`);
    expect(casing, `ribbon-casing:${id} missing`).toBeTruthy();
    expect(casing.colorHex).toBe('ffffff');
  }
  for (const id of ['central', 'circle', 'victoria', 'dlr']) {
    expect(ribbons[id].find(m => m.name.startsWith('ribbon-casing'))).toBeFalsy();
  }

  // Canonical colours survive (no brightenIfTooDark on ribbons): Northern
  // stays black; DLR gets the new canonical teal (LINE_COLOURS addition).
  expect(ribbons.northern.find(m => m.name === 'ribbon:northern').colorHex).toBe('000000');
  expect(ribbons.dlr.find(m => m.name === 'ribbon:dlr').colorHex).toBe('00a4a7');
});

test('crown ribbons: survive a forced tube rebuild without duplication or stomp', async ({ page }) => {
  await gotoAndWaitForNetwork(page);
  await page.evaluate(() => window.__ug.snapAllTubesToTerrain());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const { ribbons, groupCounts } = await collectRibbonState(page);

  for (const [id, meshes] of Object.entries(ribbons)) {
    expect(groupCounts[id], `duplicate ribbon:${id} after rebuild`).toBe(1);
    for (const m of meshes) {
      expect(m.transparent).toBe(false);
      expect(m.inScene).toBe(true);
      expect(m.emissiveIntensity).toBeLessThanOrEqual(0.3);
    }
  }
  const casing = ribbons.northern.find(m => m.name === 'ribbon-casing:northern');
  expect(casing).toBeTruthy();
});

test('crossrail crown ribbon: canonical Elizabeth purple, opaque, pickable as crossrail', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(
    () => !!window.__ug?.scene?.getObjectByName('crossrail-tunnel'),
    null, { timeout: 30000 }
  );
  const state = await page.evaluate(() => {
    const g = window.__ug.scene.getObjectByName('crossrail-tunnel');
    return g.children
      .filter(c => c.name === 'ribbon:elizabeth')
      .map(m => ({
        transparent: m.material.transparent,
        colorHex: m.material.color.getHexString(),
        emissiveIntensity: m.material.emissiveIntensity,
        type: m.userData.type,
        name: m.userData.name,
      }));
  });
  // One ribbon per built branch (main + abbey-wood + shenfield when data has all three).
  expect(state.length).toBeGreaterThanOrEqual(2);
  for (const r of state) {
    expect(r.transparent).toBe(false);
    expect(r.colorHex).toBe('6950a1'); // canonical purple, NOT gold ffd300
    expect(r.emissiveIntensity).toBeLessThanOrEqual(0.3);
    expect(r.type).toBe('crossrail');
    expect(r.name).toContain('Crossrail');
  }
});
