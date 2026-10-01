// Sprint 30Sep26w Lane M (D-040 item 3, D-041): the Microsoft footprints merged
// into Park Royal and West Acton reach the screen on BOTH render paths, and the
// licence credit is on the page. Sprint 01Oct26h (D-043): the same for North and
// East Acton and Harlesden/Willesden Junction; every target tile of the tracked
// summary is checked, inside the union of those tiles' scene boxes. The data-level checks (no overlap with OSM,
// counts, payload verification) are in tests/microsoft-footprints.test.mjs.
//
// Each added record must be an instance at its own centre with its own size:
// live at the exact source centre, baked within the payload's half-decimetre
// quantisation. The only records allowed to be absent are those whose dedup
// hash (5 m grid + rounded height, shared by the loader and the bake) repeats
// an earlier record's; both paths drop those by design.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const summary = JSON.parse(await readFile(new URL('../scripts/microsoft-footprints.json', import.meta.url), 'utf8'));
const TARGETS = Object.keys(summary.tiles);
// Park Royal from the south-east, 450 m up (Lane M's park-royal-overview capture);
// all four target tiles lie well inside the live loader's 12 km radius.
const VIEW = '-9466.5,2398.3,-389.8,-11037.3,168.9,-2244.3';
const TOL = 0.06; // half a decimetre plus float slack

/** Added records and the ones the dedup rule may drop, from the served tiles. */
const expected = (targets) => (async () => {
  const hash = (b) => `${Math.round(b.cx / 5) * 5},${Math.round(b.cz / 5) * 5},${Math.round(b.height)}`;
  const neighbours = new Set();
  for (const f of targets) {
    const [, c, r] = /^tile_(\d+)_(\d+)\.json$/.exec(f).map(Number);
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++)
      neighbours.add(`tile_${String(c + dc).padStart(2, '0')}_${String(r + dr).padStart(2, '0')}.json`);
  }
  const count = new Map(), added = [];
  for (const f of neighbours) {
    const res = await fetch(`/data/surface/tiles/${f}`);
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
    for (const b of (await res.json()).buildings || []) {
      count.set(hash(b), (count.get(hash(b)) || 0) + 1);
      if (b.source === 'microsoft' && targets.includes(f)) added.push({ cx: b.cx, cz: b.cz, height: b.height, area: b.area, h: hash(b) });
    }
  }
  return added.map((b) => ({ ...b, mayDrop: count.get(b.h) > 1 }));
})();

/** The union of the target tiles' scene boxes from the served manifest, 60 m wider each way. */
const targetBox = (targets) => (async () => {
  const m = await (await fetch('/data/surface/tiles/manifest.json')).json();
  const boxes = m.tiles.filter((t) => targets.includes(t.file)).map((t) => t.sceneBBox);
  return { minX: Math.min(...boxes.map((b) => b.minX)) - 60, maxX: Math.max(...boxes.map((b) => b.maxX)) + 60,
           minZ: Math.min(...boxes.map((b) => b.minZ)) - 60, maxZ: Math.max(...boxes.map((b) => b.maxZ)) + 60, tiles: boxes.length };
})();

/** Instances of one render path inside the target tiles' box, keyed by rounded centre. */
const instances = ([prefix, box]) => {
  const out = new Map(), g = window.__ug.surfaceGeometryGroup;
  g.traverse((o) => {
    if (!o.isInstancedMesh || !o.name?.startsWith(prefix)) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const p = i * 16, x = a[p + 12], z = a[p + 14];
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      const k = `${Math.round(x)},${Math.round(z)}`;
      (out.get(k) || out.set(k, []).get(k)).push([x, z, a[p], a[p + 5]]);
    }
  });
  return [...out.entries()];
};

function check(added, inst, VE) {
  const map = new Map(inst);
  let present = 0, dropped = 0;
  const missing = [];
  for (const b of added) {
    const side = Math.max(Math.sqrt(b.area), 0.1), h = Math.max(b.height, 0.5) * VE;
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dz = -1; dz <= 1 && !hit; dz++)
      for (const [x, z, s, y] of map.get(`${Math.round(b.cx) + dx},${Math.round(b.cz) + dz}`) || [])
        if (Math.hypot(x - b.cx, z - b.cz) <= TOL && Math.abs(s - side) <= TOL && Math.abs(y - h) <= TOL * VE) { hit = true; break; }
    if (hit) present++;
    else if (b.mayDrop) dropped++;
    else missing.push(b);
  }
  return { present, dropped, missing: missing.length, examples: missing.slice(0, 3) };
}

test('live path: every added footprint in the four Microsoft tiles is drawn', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(`/?buildings=live&view=${VIEW}`);
  await page.waitForFunction((targets) => {
    const g = window.__ug?.surfaceGeometryGroup, s = window.__ug?.surfaceLoaderStats;
    return g && s && s.loading === 0 && targets.every((f) => g.getObjectByName(`buildings-${f}`));
  }, TARGETS, { timeout: 200000 });
  const added = await page.evaluate(expected, TARGETS);
  expect(added.length).toBe(TARGETS.reduce((a, f) => a + summary.tiles[f].added, 0));
  const box = await page.evaluate(targetBox, TARGETS);
  expect(box.tiles).toBe(TARGETS.length);
  const r = check(added, await page.evaluate(instances, ['buildings-', box]), await page.evaluate(() => window.__ug.VERTICAL_EXAGGERATION));
  console.log('live:', JSON.stringify(r));
  expect(r.missing, JSON.stringify(r.examples)).toBe(0);
  expect(r.present).toBeGreaterThan(added.length - 6);
});

test('baked path: every added footprint is in the payload and drawn', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(`/?buildings=baked&view=${VIEW}`);
  await page.waitForFunction(() => window.__ug?.bakedStats && window.__ug.bakedStats.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal, null, { timeout: 200000 });
  const stats = await page.evaluate(() => window.__ug.bakedStats);
  const added = await page.evaluate(expected, TARGETS);
  expect(added.length, 'served tiles carry the merged Microsoft records').toBe(TARGETS.reduce((a, f) => a + summary.tiles[f].added, 0));
  const box = await page.evaluate(targetBox, TARGETS);
  expect(box.tiles).toBe(TARGETS.length);
  const r = check(added, await page.evaluate(instances, ['baked-buildings-', box]), await page.evaluate(() => window.__ug.VERTICAL_EXAGGERATION));
  console.log('baked:', JSON.stringify({ ...r, buildingsTotal: stats.buildingsTotal }));
  expect(r.missing, JSON.stringify(r.examples)).toBe(0);
  expect(r.present).toBeGreaterThan(added.length - 6);
});

test('the Data credits show the Microsoft Building Footprints line with its licence', async ({ page }) => {
  await page.goto('/?skip=1');
  const line = page.locator('#creditMicrosoftFootprints');
  await expect(line).toHaveCount(1);
  // It sits inside the Data credits disclosure of the HUD.
  expect(await line.evaluate((el) => el.closest('details')?.querySelector('summary')?.textContent)).toBe('Data credits');
  await page.evaluate(() => { document.getElementById('hudDetails').open = true; document.querySelector('#creditMicrosoftFootprints').closest('details').open = true; });
  await expect(line).toBeVisible();
  await expect(line).toContainText('Microsoft Building Footprints');
  await expect(line).toContainText('ODbL');
  for (const area of ['Park Royal', 'West Acton', 'North Acton', 'East Acton', 'Harlesden', 'Willesden Junction']) await expect(line).toContainText(area);
  await expect(line.locator('a[href="https://github.com/microsoft/GlobalMLBuildingFootprints"]')).toHaveCount(1);
  await expect(line.locator('a[href="https://opendatacommons.org/licenses/odbl/"]')).toHaveCount(1);
});
