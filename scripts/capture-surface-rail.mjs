// Before/after captures for the open-air Tube and DLR (sprint 30Sep26w,
// D-041, Lane R), and the Overground pixel-identity check. Exact cameras, so
// the same frames come from any build (the before build, c820ea9, has no
// surface railway to aim at). Needs a DEV server (window.__ug).
//
//   node scripts/capture-surface-rail.mjs <origin> <outDir> <tag> [--poses a,b] [--isolate-overground]
//
// Frames: 1440x900 at DPR 1, Manual quality at 100% and MSAA 4, time paused,
// the tick frozen and two frames stepped before the render that is read back,
// `?fast=1&buildings=baked&mh=1.1`. --isolate-overground hides everything but
// the Overground and the lights (and the Overground's trains, whose phase is
// elapsed time): run it on two builds and compare the PNGs pixel by pixel.
// Run-to-run noise on one build is a handful of pixels at 1 level, in fogged
// distance near the horizon (30Sep26w: 1, 3 and 25 pixels at OG1 to OG3).
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

export const POSES = {
  'R1-metropolitan-finchley-road': { cam: [-5205.7, 728.2, -4019], target: [-4769.8, 260.6, -4205.5] },
  'R2-district-upminster': { cam: [25171.6, 511.6, -6183.4], target: [24505.6, 142.2, -6079.1] },
  'R3-dlr-mudchute': { cam: [7554.6, 326.1, 1533.3], target: [7988.2, 21.7, 1784.1] },
  'R3b-dlr-mudchute-d040-pose': { cam: [7599.2, 168.8, 1861.3], target: [7899.2, 27.6, 1661.3] },
  'R4-dlr-canary-wharf': { cam: [7682.2, 192.7, -342.8], target: [7448, 24.5, -110.1] },
  'R5-bakerloo-lioness': { cam: [-12871.5, 441, -6798.9], target: [-12639.2, 250, -6515] },
  'R5b-bakerloo-lioness-close': { cam: [-12770.2, 314.9, -6721], target: [-12672.7, 234.9, -6598.5] },
  'R6-docklands-overview': { cam: [6385, 3303, -1137.6], target: [8185, 17.9, 162.4] },
  // Fix round 2: DLR decks the round-1 data drew nowhere (see docs/tube-surface-rail.md, transform 5).
  'R8-dlr-canning-town-flyover': { cam: [9590, 230, -790], target: [9414, 45, -965] },
  'R9-dlr-tower-gateway': { cam: [3930, 260, -300], target: [3790, 150, -462] },
  'R10-dlr-poplar-flyover': { cam: [7600, 200, -80], target: [7440, 80, -235] },
  'OG1-highbury': { cam: [1282.1, 668.1, -4010.2], target: [1729.1, 182.9, -4416.5] },
  'OG2-surrey-quays': { cam: [6000.3, 472.5, 1609], target: [5507.6, 43.8, 1259.4] },
  'OG3-kew-shared': { cam: [-10507.9, 469.7, 2468.7], target: [-10581.6, 26, 3068.4] },
};

if (process.argv[1]?.endsWith('capture-surface-rail.mjs')) {
  const [origin, outDir, tag] = process.argv.slice(2);
  if (!origin || !outDir || !tag) throw new Error('usage: capture-surface-rail.mjs <origin> <outDir> <tag> [--poses a,b] [--isolate-overground]');
  const flag = k => process.argv.includes(k);
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const isolate = flag('--isolate-overground');
  const names = arg('--poses', Object.keys(POSES).join(',')).split(',');
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window); const held = []; let lastTs = 0;
    window.requestAnimationFrame = cb => { if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; } return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); }); };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
  });
  await page.goto(`${origin}/?fast=1&buildings=baked&mh=1.1`);
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.overground?.userData.stationsAttached && ('surfaceRail' in window.__ug ? !!window.__ug.surfaceRail : true), null, { timeout: 180000 });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
  for (const name of names) {
    const P = POSES[name];
    await page.evaluate(async ({ P }) => {
      window.__thaw();
      const u = window.__ug; u.camera.position.fromArray(P.cam); u.controls.target.fromArray(P.target); u.controls.update();
      await new Promise(r => setTimeout(r, 2500));
      window.__freeze = true; await new Promise(r => setTimeout(r, 100)); window.__step(3);
    }, { P });
    const png = await page.evaluate(({ isolate }) => {
      const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext(), restore = [];
      if (isolate) {
        for (const c of u.scene.children) if (c !== u.overground && !c.isLight) { restore.push([c, c.visible]); c.visible = false; }
        u.overground.traverse(o => { if (o.name?.startsWith('overground-trains-')) { restore.push([o, o.visible]); o.visible = false; } });
      }
      u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0));
      rr.setRenderTarget(null);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      for (const [o, v] of restore) o.visible = v;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'), img = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(b.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      cx.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    }, { isolate });
    await writeFile(`${outDir}/${tag}-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${tag}-${name}.png`);
  }
  await browser.close();
}
