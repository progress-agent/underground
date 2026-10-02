// measure-night.mjs: render-cost harness for the night research proof (sprint 02Oct26f, lane R). THROWAWAY.
//
// scripts/measure-setups.mjs measures what Automatic settles at, which hides a
// small shader cost behind a rung and the display's 60 Hz cap. This harness
// measures the render itself: the page's own loop is held, the pose is fixed,
// and N times it calls composer.render() then reads one pixel back (which waits
// for the GPU), timing the pair. Result: milliseconds per frame with no vsync
// quantisation, for one URL variant, on the weak or the as-lived setup.
//
//   node scripts/measure-night.mjs <origin> --setup <weak|as-lived> --label <name> [--query "night=1"]
//        [--views overview,streetBank,riverGreenwich] [--frames 60] [--shadow-refresh 1] [--shadows 1] [--out file.json]
//
//   weak      DPR 1, CPU throttled 4x through CDP (the project's weak setup)
//   as-lived  DPR 2, no throttle (the M5 protocol's other setup; here on the Studio's M2 Max)
//
// Needs a DEV server (window.__ug). Run through ug-gpu.sh. Quality is held at
// Manual 100% with MSAA 4 so Automatic cannot move a rung mid-measurement.
// --shadows 0 turns the sun/moon shadow toggle off after load (the existing HUD toggle, not persisted).
// --shadow-refresh 1 sets renderer.shadowMap.needsUpdate before every render
// (the moving-camera case: the shadow map is redrawn each frame); 0 leaves it
// to the shadow cache (the settled case).
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const VIEWS = {
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  streetBank: { p: [2952.9, 337.8, -732.9], t: [1910.1, 196.2, -783.7] },
  riverGreenwich: { p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
};
const SETUPS = { weak: { dpr: 1, cpuThrottle: 4 }, 'as-lived': { dpr: 2, cpuThrottle: 1 } };

function stats(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  const mean = a.reduce((x, y) => x + y, 0) / n;
  return { mean, median: s[Math.floor(n / 2)], p95: s[Math.min(n - 1, Math.floor(n * 0.95))], min: s[0], max: s[n - 1], n };
}

export async function run({ origin, setup, label, query = '', views = Object.keys(VIEWS), frames = 60, shadowRefresh = 1, shadows = 1 }) {
  const { chromium } = await import('@playwright/test');
  const S = SETUPS[setup]; if (!S) throw new Error(`unknown setup ${setup}`);
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: S.dpr });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window); const held = [];
      window.__paused = false;
      window.requestAnimationFrame = cb => { if (window.__paused && cb.name === 'tick') { held.push(cb); return 0; } return raf(cb); };
      window.__resume = () => { window.__paused = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
    });
    const t0 = Date.now();
    await page.goto(`${origin}/?fast=1&buildings=baked${query ? '&' + query : ''}`);
    await page.waitForFunction(() => window.__ug, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
      && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup && window.__ug.landmarkGroup?.children.length, null, { timeout: 240000 });
    const loadMs = Date.now() - t0;
    const info = await page.evaluate(({ shadows }) => {
      const u = window.__ug; u.controls.enableDamping = false;
      u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
      if (!shadows) window.__ugSun?.setShadowsEnabled(false, { persist: false });
      const gl = u.composer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, dpr: devicePixelRatio, night: u.night ?? null, shadowsEnabled: window.__ugSun?.shadowsEnabled ?? null };
    }, { shadows });
    if (S.cpuThrottle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle }); }
    const results = {};
    for (const name of views) {
      const pose = VIEWS[name]; if (!pose) { results[name] = { error: 'unknown view' }; continue; }
      await page.evaluate(pose => { const u = window.__ug; u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update(); }, pose);
      await page.waitForTimeout(4000);      // let the world settle (tiles, clouds, quality)
      const r = await page.evaluate(async ({ frames, shadowRefresh }) => {
        const u = window.__ug, r = u.composer.renderer, gl = r.getContext(), px = new Uint8Array(4);
        window.__paused = true; await new Promise(res => setTimeout(res, 150));   // let the in-flight tick finish
        u.camera.updateMatrixWorld();
        const once = () => {
          // The app redraws the shadow map only while the sun system says shadows are active (altitude, toggle).
          if (shadowRefresh && window.__ugSun?.status.active) r.shadowMap.needsUpdate = true;
          // The app's own render call: the underground cull wraps the composer for above-ground cameras (D-040).
          u.undergroundCull.render(u.aboveGroundView, () => u.composer.render(0.016));
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        for (let i = 0; i < 12; i++) once();                                     // warm-up (programs, uploads)
        const ms = [];
        for (let i = 0; i < frames; i++) { const a = performance.now(); once(); ms.push(performance.now() - a); }
        const info = r.info; const out = { ms, calls: info.render.calls, triangles: info.render.triangles };
        window.__resume();
        return out;
      }, { frames, shadowRefresh });
      results[name] = { ...stats(r.ms), calls: r.calls, triangles: r.triangles };
      console.log(`${label} ${setup} ${name.padEnd(15)} mean ${results[name].mean.toFixed(2)} ms  median ${results[name].median.toFixed(2)}  p95 ${results[name].p95.toFixed(2)}  (calls ${r.calls})`);
    }
    return { tool: 'measure-night', version: 1, label, setup, query, origin, when: new Date().toISOString(), dpr: S.dpr, cpuThrottle: S.cpuThrottle,
      frames, shadowRefresh, shadows, loadMs, info, errors, views: results };
  } finally { await browser.close(); }
}

function arg(argv, key, fallback) {
  const i = argv.indexOf(`--${key}`);
  return i < 0 ? fallback : argv[i + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  const origin = argv[0];
  if (!origin || origin.startsWith('--')) { console.log('usage: see the header of scripts/measure-night.mjs'); process.exitCode = 2; return; }
  const out = await run({
    origin, setup: arg(argv, 'setup', 'weak'), label: arg(argv, 'label', origin), query: arg(argv, 'query', ''),
    views: arg(argv, 'views', Object.keys(VIEWS).join(',')).split(','), frames: +arg(argv, 'frames', 60), shadowRefresh: +arg(argv, 'shadow-refresh', 1), shadows: +arg(argv, 'shadows', 1),
  });
  const file = arg(argv, 'out', null);
  if (file) await writeFile(file, JSON.stringify(out, null, 1));
  if (out.errors.length) console.log(`errors: ${out.errors.length}\n` + out.errors.slice(0, 5).join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}
