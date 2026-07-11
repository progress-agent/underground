// bridges.spec.js: Thames bridge layer coverage.
//
// Guards the archetype bridge layer built from public/data/bridges.json:
//   - all 41 records become registry entries under the single `bridges` group
//   - deck heights are scaled from the Thames water level and sit above water
//   - Tower Bridge reads as a landmark above neighbouring beam bridges
//   - QE2 carries the high-clearance cable-stayed outlier
//   - BNG axis midpoint conversion stays aligned with the dataset convention

import { test, expect } from '@playwright/test';

const BASE = '/?skipintro=1&fast=1';

async function gotoAndWaitForBridges(page) {
  await page.goto(BASE);
  await page.waitForFunction(
    () => document.querySelector('#loadingBar')?.classList.contains('done'),
    null, { timeout: 90000 }
  );
  await page.waitForFunction(
    () => !!window.__ug?.bridgesGroup && window.__ug.bridgeRegistry?.size === 41,
    null, { timeout: 90000 }
  );
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function bridgeState(page) {
  return page.evaluate(() => {
    const u = window.__ug;
    const entries = {};
    for (const [slug, rec] of u.bridgeRegistry.entries()) {
      entries[slug] = {
        name: rec.data.name,
        kind: rec.data.kind,
        archetype: rec.data.archetype,
        clearanceM: rec.data.clearanceM,
        deckY: rec.deckY,
        waterSurfaceY: rec.waterSurfaceY,
        midpoint: rec.midpoint,
        deckUserData: rec.deckMesh?.userData ?? null,
        groupChildCount: rec.group?.children?.length ?? 0,
      };
    }
    return {
      groupName: u.bridgesGroup.name,
      groupChildren: u.bridgesGroup.children.length,
      registrySize: u.bridgeRegistry.size,
      verticalExaggeration: u.VERTICAL_EXAGGERATION,
      entries,
    };
  });
}

async function objectWorldBounds(page, bridgeSlug) {
  return page.evaluate((slug) => {
    const rec = window.__ug.bridgeRegistry.get(slug);
    const proto = window.__ug.camera.position;
    const v = proto.clone();
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    rec.group.updateWorldMatrix(true, true);
    rec.group.traverse(obj => {
      const pos = obj.geometry?.attributes?.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        obj.localToWorld(v);
        min.x = Math.min(min.x, v.x);
        min.y = Math.min(min.y, v.y);
        min.z = Math.min(min.z, v.z);
        max.x = Math.max(max.x, v.x);
        max.y = Math.max(max.y, v.y);
        max.z = Math.max(max.z, v.z);
      }
    });

    return { min, max };
  }, bridgeSlug);
}

test('bridges: group and registry contain all 41 prepared records', async ({ page }) => {
  await gotoAndWaitForBridges(page);
  const state = await bridgeState(page);

  expect(state.groupName).toBe('bridges');
  expect(state.groupChildren).toBe(41);
  expect(state.registrySize).toBe(41);
  expect(state.entries.tower.name).toBe('Tower Bridge');
  expect(state.entries.qe2.archetype).toBe('cable-stayed');

  for (const [slug, entry] of Object.entries(state.entries)) {
    expect(entry.groupChildCount, `${slug} should render at least one mesh`).toBeGreaterThan(0);
    expect(entry.deckUserData?.type, `${slug} deck userData.type`).toBe('bridge');
    expect(entry.deckUserData?.name, `${slug} deck userData.name`).toBe(entry.name);
    expect(entry.deckUserData?.kind, `${slug} deck userData.kind`).toBe(entry.kind);
    expect(entry.deckUserData?.archetype, `${slug} deck userData.archetype`).toBe(entry.archetype);
  }
});

test('bridges: decks sit above Thames water and landmark heights read correctly', async ({ page }) => {
  await gotoAndWaitForBridges(page);
  const state = await bridgeState(page);

  for (const [slug, entry] of Object.entries(state.entries)) {
    expect(entry.deckY, `${slug} deck above water`).toBeGreaterThan(entry.waterSurfaceY);
  }

  const towerBounds = await objectWorldBounds(page, 'tower');
  const londonDeckY = state.entries.london.deckY;
  expect(towerBounds.max.y - londonDeckY).toBeGreaterThan(25 * state.verticalExaggeration);

  const centralClearance = (
    state.entries.westminster.clearanceM +
    state.entries.blackfriars.clearanceM +
    state.entries.london.clearanceM
  ) / 3;
  expect(state.entries.qe2.clearanceM).toBeGreaterThan(centralClearance * 5);
});

test('bridges: registry midpoint follows dataset BNG axis convention', async ({ page }) => {
  await gotoAndWaitForBridges(page);
  const dataset = await page.evaluate(async () => {
    const res = await fetch('/data/bridges.json', { cache: 'no-store' });
    return await res.json();
  });
  const state = await bridgeState(page);

  for (const slug of ['westminster', 'tower', 'qe2']) {
    const bridge = dataset.bridges.find(b => b.curatedSlug === slug);
    const expected = {
      x: ((bridge.axis.a.e - 530000) + (bridge.axis.b.e - 530000)) / 2,
      z: (-(bridge.axis.a.n - 180400) + -(bridge.axis.b.n - 180400)) / 2,
    };
    const actual = state.entries[slug].midpoint;
    const dist = Math.hypot(actual.x - expected.x, actual.z - expected.z);
    expect(dist, `${slug} midpoint drift`).toBeLessThan(60);
  }
});
