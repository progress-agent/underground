// Verify the serving surface with actual keyboard flight; __ug is DEV-only.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.argv[2];
const out = process.argv[3] || '/tmp/underground-preview';
if (!url) throw new Error('Usage: node scripts/verify-preview.mjs <preview-url> [output]');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__openingCheck = { done: false, doneAt: null };
    window.addEventListener('ug:intro-done', () => {
      window.__openingCheck = { ...window.__openingCheck, done: true, doneAt: performance.now() };
    });
    // Sprint 24Sep26h (lane O): the loading bar lets go when the descent starts.
    window.addEventListener('ug:opening-reveal', () => {
      window.__openingCheck = { ...window.__openingCheck, revealAt: performance.now() };
    });
  });
  const errors = [], tiles = [], warnings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('request', r => { if (/\/surface\/tiles\/(?!manifest).*\.json/.test(r.url())) tiles.push(r.url()); });
  const ground = page.waitForResponse(r => r.url().includes('/baked/ground.bin'));
  const buildings = page.waitForResponse(r => r.url().includes('/baked/buildings.bin'));
  await page.goto(`${url}/?buildings=baked`, { waitUntil: 'domcontentloaded' });
  // Verify the exact review URL before any key press can skip its opening.
  await page.waitForFunction(() => !window.__openingCheck.done &&
    Number(document.getElementById('ug-readout-alt')?.textContent) > 1000,
    null, { timeout: 15000 });
  await page.screenshot({ path: `${out}/loading.png` });
  // The descent is held behind the loading bar until its readiness set is
  // complete; capture the first moments of the flight once the bar lets go.
  await page.waitForFunction(() => document.getElementById('loadingBar')?.classList.contains('done'),
    null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/opening.png` });
  const assets = await Promise.all([ground, buildings]);
  for (const response of assets) {
    if (!response.ok()) throw new Error(`Asset failed: ${response.url()}`);
    await response.finished();
  }
  await page.waitForFunction(() => window.__openingCheck.done, null, { timeout: 30000 });
  await page.screenshot({ path: `${out}/landing.png` });
  const opening = await page.evaluate(() => window.__openingCheck);
  // The descent itself lasts 9s from the moment the bar lets go.
  if (opening.doneAt < 8000 || (opening.revealAt && opening.doneAt - opening.revealAt < 8500)) {
    throw new Error('Opening was skipped or ended prematurely');
  }
  await page.waitForTimeout(1000);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyE');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowDown');
  await page.screenshot({ path: `${out}/flight.png` });
  // Sprint 02Oct26f (Lane F, D-048 item 6): the baked city is the DEFAULT. A clean profile (a new
  // browser context: no stored settings) opens the bare URL, with no buildings= parameter, and must
  // fetch the baked payload and never a live source tile. window.__ug is absent in production, so
  // this reads the network requests and the HUD toggle.
  const defaultUrl = await (async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const dp = await context.newPage();
      const responses = [], dTiles = [], dWarnings = [], dErrors = [], dPageErrors = [];
      dp.on('response', r => responses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? null }));
      dp.on('request', r => { if (/\/surface\/tiles\/(?!manifest).*\.json/.test(r.url())) dTiles.push(r.url()); });
      dp.on('console', m => { if (m.type() === 'warning') dWarnings.push(m.text()); if (m.type() === 'error') dErrors.push(m.text()); });
      dp.on('pageerror', e => dPageErrors.push(e.message));
      await dp.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
      await dp.waitForFunction(() => document.getElementById('loadingBar')?.classList.contains('done'), null, { timeout: 90000 });
      await dp.waitForTimeout(8000);
      const bin = responses.filter(r => /\/baked\/buildings\.bin/.test(r.url));
      await dp.evaluate(() => { const d = document.getElementById('hudDetails'); if (d) d.open = true; });
      return {
        url: `${url}/`,
        buildingsBin: bin.map(r => ({ status: r.status, type: r.type })),
        tileRequests: dTiles.length,
        bakedUnavailableWarnings: dWarnings.filter(w => /Baked .*unavailable/.test(w)).length,
        bakedSelected: await dp.locator('#bakedBuildings').getAttribute('aria-pressed').catch(() => null),
        debugAbsent: await dp.evaluate(() => !window.__ug),
        consoleErrors: dErrors, pageErrors: dPageErrors,
      };
    } finally { await context.close(); }
  })();
  const result = { url, defaultUrl, errors, warnings, opening, sourceTileRequests: tiles.length,
    debugAbsent: await page.evaluate(() => !window.__ug),
    bakedSelected: await page.locator('#bakedBuildings').getAttribute('aria-pressed').catch(() => null),
    assets: assets.map(r => ({ url: r.url(), status: r.status(), type: r.headers()['content-type'] })) };
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (errors.length || tiles.length || warnings.some(w => /Baked .*unavailable/.test(w)) || !result.debugAbsent || result.bakedSelected !== 'true') {
    throw new Error('Production smoke check failed');
  }
  if (!defaultUrl.buildingsBin.some(r => r.status === 200) || defaultUrl.tileRequests || defaultUrl.bakedUnavailableWarnings
    || defaultUrl.bakedSelected !== 'true' || !defaultUrl.debugAbsent || defaultUrl.pageErrors.length) {
    throw new Error('Production smoke check failed: the default URL (no buildings parameter) does not run the baked city');
  }
} finally { await browser.close(); }
