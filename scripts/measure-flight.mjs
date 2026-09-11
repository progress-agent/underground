// Repeatable real-GPU flight benchmark. Default DPR 2 matches Retina rendering.
// Compares ground paths with BAKED BUILDINGS ON in both; no visual quality cut.
// Usage: npm run bench:flight -- /absolute/output [dpr=2] [cpuSlowdown=1]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.argv[2] || '/tmp/underground-flight';
const dpr = Number(process.argv[3] || 2);
const cpuSlowdown = Number(process.argv[4] || 1);
const origin = process.env.UG_BENCH_URL || 'http://localhost:5173';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const results = [];
function stats(values) {
  const a = [...values].sort((a, b) => a - b);
  const q = p => +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1);
  return { frames: a.length, fps: +(1000 * a.length / a.reduce((s, x) => s + x, 0)).toFixed(1),
    p50: q(.5), p95: q(.95), p99: q(.99), max: q(1), over33: a.filter(x => x > 33.4).length,
    over50: a.filter(x => x > 50).length, over100: a.filter(x => x > 100).length };
}
try {
  // ABBA controls for machine drift; each visit uses a fresh browser context.
  for (const [index, ground] of ['live', 'baked', 'baked', 'live'].entries()) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [], tileRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/\/surface\/tiles\/.*\.json/.test(r.url()) && !r.url().includes('manifest')) tileRequests.push(r.url()); });
    const cdp = await context.newCDPSession(page);
    if (cpuSlowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
    const bootAt = Date.now();
    await page.goto(`${origin}/?fast=1&buildings=baked&ground=${ground}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.bakedStats && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal,
      null, { timeout: 120000 });
    const residentMs = Date.now() - bootAt;
    // Release all live tiles and start outside their radius, then fly across
    // the city. Returning visits exercise reload work as well as first arrivals.
    await page.evaluate(() => {
      const { camera, controls } = window.__ug;
      camera.position.set(-40000, 900, 0); controls.target.set(-39000, 850, 0); controls.update();
    });
    await page.waitForTimeout(3500);
    const info = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { dpr: devicePixelRatio, pixels: [canvas.width, canvas.height],
        gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        buildings: window.__ug.bakedStats, groundPath: window.__ug.groundPath };
    });
    if (info.groundPath !== ground) throw new Error(`requested ${ground}, received ${info.groundPath}`);
    const beforeRequests = tileRequests.length;
    await page.evaluate(() => window.__ug.clearArrivalCosts());
    const routes = {};
    for (const [name, from, to, y] of [
      ['outward', -22000, 18000, 900], ['return', 18000, -22000, 900],
      ['underground', -2000, 2000, -120],
    ]) {
      const frames = await page.evaluate(({ from, to, y }) => new Promise(resolve => {
        const { camera, controls } = window.__ug;
        const duration = 12000, start = performance.now(), values = [];
        let last;
        function step(now) {
          if (last !== undefined) values.push(now - last);
          last = now;
          const t = Math.min(1, (now - start) / duration);
          camera.position.set(from + (to - from) * t, y, 0);
          controls.target.set(camera.position.x + Math.sign(to - from) * 1000, y - 100, 0);
          controls.update(); camera.updateMatrixWorld(true);
          if (t < 1) requestAnimationFrame(step); else resolve(values);
        }
        requestAnimationFrame(step);
      }), { from, to, y });
      routes[name] = stats(frames);
    }
    // Real key events test the control path too, rather than only pose setters.
    await page.evaluate(() => {
      const { camera, controls } = window.__ug;
      camera.position.set(0, 900, 800); controls.target.set(1000, 850, 800); controls.update();
      window.__flightFrames = []; window.__flightSampling = true;
      let last;
      function step(now) {
        if (!window.__flightSampling) return;
        if (last !== undefined) window.__flightFrames.push(now - last);
        last = now; requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(4000);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');
    routes.keyboard = stats(await page.evaluate(() => { window.__flightSampling = false; return window.__flightFrames; }));
    await page.evaluate(() => {
      window.__flightFrames = []; window.__flightSampling = true;
      let last;
      function step(now) {
        if (!window.__flightSampling) return;
        if (last !== undefined) window.__flightFrames.push(now - last);
        last = now; requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    await page.mouse.move(650, 350);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(650 + i * 4, 350 + Math.sin(i / 8) * 40);
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
    routes.mouse = stats(await page.evaluate(() => { window.__flightSampling = false; return window.__flightFrames; }));
    const arrivals = await page.evaluate(() => window.__ug.arrivalCosts);
    const row = { index, ground, residentMs, info, routes, errors, tileRequestsDuringFlight: tileRequests.length - beforeRequests,
      arrivals: { count: arrivals.length, rasteriseMs: Math.round(arrivals.reduce((s, a) => s + a.rasteriseMs, 0)) } };
    results.push(row);
    await page.screenshot({ path: `${out}/${index}-${ground}.png` });
    await writeFile(`${out}/report.json`, JSON.stringify({ at: new Date().toISOString(), dpr, cpuSlowdown, origin, results }, null, 2));
    console.log(JSON.stringify(row));
    await context.close();
  }
} finally { await browser.close(); }
