// Same-camera ABBA isolates the cost of drawing landmarks from city/quality
// changes. Geometry stays resident; only visibility changes between samples.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.argv[2];
if (!out) throw new Error('Usage: node scripts/measure-landmark-cost.mjs <output-dir>');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:5173/?buildings=baked&skip=1');
  await page.waitForFunction(() => window.__ug?.landmarkGroup && window.__ug.bakedStats?.tilesBuilt === window.__ug.bakedStats?.tilesTotal);
  await page.waitForFunction(() => document.getElementById('loadingBar')?.classList.contains('done'), null, { timeout: 90000 });
  const info = await page.evaluate(() => {
    const u = window.__ug, gl = u.composer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    u.setRenderQualityMode('manual');u.renderQuality.set({ scale: 1, samples: 4 });
    u.controls.enableDamping = false;u.camera.position.set(0, 20000, 18000);u.controls.target.set(0, 0, 0);u.controls.update();
    let meshes = 0, triangles = 0;
    u.landmarkGroup.traverse(o => { if (o.isMesh) { meshes++;triangles += o.geometry.attributes.position.count / 3; } });
    return { gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), meshes, triangles };
  });
  const rows = [];
  for (const visible of [false, true, true, false]) {
    await page.evaluate(visible => { window.__ug.landmarkGroup.visible = visible; }, visible);
    await page.waitForTimeout(1200);
    const ms = await page.evaluate(() => new Promise(resolve => {
      const frames = [];let last, start;
      function sample(t) { start ??= t;if (last) frames.push(t - last);last = t;if (t - start < 5000) requestAnimationFrame(sample);else resolve(frames); }
      requestAnimationFrame(sample);
    }));
    ms.sort((a, b) => a - b);
    const row = { visible, fps: ms.length * 1000 / ms.reduce((a, b) => a + b, 0), p95: ms[Math.floor(ms.length * .95)] };
    rows.push(row);console.log(JSON.stringify(row));
  }
  await page.evaluate(() => { window.__ug.landmarkGroup.visible = true;window.__ug.setRenderQualityMode('auto'); });
  await page.waitForTimeout(15000);
  const automatic = await page.evaluate(() => ({ quality: window.__ug.renderQuality.get(), mode: window.__ug.renderQualityMode }));
  await writeFile(`${out}/landmark-cost.json`, JSON.stringify({ info, rows, automatic }, null, 2));
} finally { await browser.close(); }
