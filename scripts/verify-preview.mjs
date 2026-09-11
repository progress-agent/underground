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
  const errors = [], tiles = [], warnings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('request', r => { if (/\/surface\/tiles\/(?!manifest).*\.json/.test(r.url())) tiles.push(r.url()); });
  const ground = page.waitForResponse(r => r.url().includes('/baked/ground.bin'));
  const buildings = page.waitForResponse(r => r.url().includes('/baked/buildings.bin'));
  await page.goto(`${url}/?buildings=baked`, { waitUntil: 'domcontentloaded' });
  const assets = await Promise.all([ground, buildings]);
  for (const response of assets) {
    if (!response.ok()) throw new Error(`Asset failed: ${response.url()}`);
    await response.finished();
  }
  await page.waitForTimeout(4000);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyE');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowDown');
  await page.screenshot({ path: `${out}/flight.png` });
  const result = { url, errors, warnings, sourceTileRequests: tiles.length,
    debugAbsent: await page.evaluate(() => !window.__ug),
    bakedSelected: await page.locator('#bakedBuildings').getAttribute('aria-pressed').catch(() => null),
    assets: assets.map(r => ({ url: r.url(), status: r.status(), type: r.headers()['content-type'] })) };
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (errors.length || tiles.length || warnings.some(w => /Baked .*unavailable/.test(w)) || !result.debugAbsent || result.bakedSelected !== 'true') {
    throw new Error('Production smoke check failed');
  }
} finally { await browser.close(); }
