// Before/after captures for the open-air Tube and DLR (sprint 30Sep26w,
// D-041, Lane R), and the Overground pixel-identity check. Exact cameras, so
// the same frames come from any build (the before build, c820ea9, has no
// surface railway to aim at). Needs a DEV server (window.__ug).
//
//   node scripts/capture-surface-rail.mjs <origin> <outDir> <tag> [--poses a,b] [--isolate-overground] [--jpg] [--live]
//
// Frames: 1440x900 at DPR 1, Manual quality at 100% and MSAA 4, time paused,
// the tick frozen and two frames stepped before the render that is read back,
// `?fast=1&buildings=baked&mh=1.1`. --isolate-overground hides everything but
// the Overground and the lights (and the Overground's trains, whose phase is
// elapsed time): run it on two builds and compare the PNGs pixel by pixel.
// Run-to-run noise on one build is a handful of pixels at 1 level, in fogged
// distance near the horizon (30Sep26w: 1, 3 and 25 pixels at OG1 to OG3).
//
// --live (sprint 01Oct26h, fix round 1): the default buildings path instead,
// `?buildings=live`, whose tiles stream in by camera proximity. The page first
// waits until no tile has arrived or left for 20 s (the round-1 build stopped
// lifting markers over roofs after 15 s without a new tile), and each pose
// waits for a building tile over its target and 5 s more, so the markers there
// have had their chance to be lifted.
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
  // Sprint 01Oct26h (Lane R): the track OSM adds, the Overground viaducts, the
  // Tower Gateway deck and the stations given surface markers. Computed once
  // from each place (camera offset east and south, metres up) on 387dff0 and
  // fixed here, so before and after are the same frames.
  'S1-central-west-acton': { cam: [-10909.1, 1045.6, -568], target: [-10659.1, 167.8, -918] },
  'S2-central-newbury-park': { cam: [14640.8, 1090.5, -7581.7], target: [14890.8, 105.2, -7981.7] },
  'S3-central-hainault': { cam: [14788.8, 1168.3, -10646.5], target: [15038.8, 198.8, -11046.5] },
  'S4-metropolitan-west-harrow': { cam: [-16029.3, 1300.4, -7241.9], target: [-15829.3, 282.7, -7641.9] },
  'S5-overground-hackney-central-wick': { cam: [5621.4, 639.1, -4060.8], target: [5771.4, 60.8, -4390.8] },
  'S6-overground-shoreditch-haggerston': { cam: [3829.4, 688.5, -2357], target: [3549.4, 106.8, -2607] },
  'S7-kew-railway-bridge': { cam: [-10721.2, 481.2, 3168.6], target: [-10461.2, -10, 2868.6] },
  'S8-battersea-railway-bridge': { cam: [-3745.2, 460.8, 4195.6], target: [-3485.2, -25, 3895.6] },
  'S9-dlr-tower-gateway': { cam: [3930, 260, -300], target: [3790, 150, -462] },
  'S10-jubilee-west-hampstead': { cam: [-4616.7, 777.5, -4023], target: [-4466.7, 284.5, -4283] },
  'S11-dlr-lewisham': { cam: [7899.8, 607.4, 4765.8], target: [8059.8, 53, 4505.8] },
  'S12-metropolitan-preston-road': { cam: [-11920.4, 742.2, -6650.4], target: [-11770.4, 220.7, -6900.4] },
  'S13-dlr-stratford': { cam: [8252.9, 718.7, -3718.1], target: [8452.9, 36.1, -4018.1] },
  'S14-central-epping-map-edge': { cam: [15243.7, 2390.9, -18425.1], target: [15743.7, 258.8, -19525.1] },
  'S15-metropolitan-watford': { cam: [-20608.7, 877, -15979.2], target: [-20458.7, 342, -16229.2] },
  'S16-piccadilly-hatton-cross': { cam: [-20559.7, 665, 5237], target: [-20409.7, 112.8, 4987] },
  'S17-district-fulham-railway-bridge': { cam: [-5825.2, 484.4, 5055.6], target: [-5565.2, -15, 4755.6] },
  'S18-jubilee-wembley-park': { cam: [-10824.3, 723.1, -5741.4], target: [-10674.3, 196.1, -5991.4] },
  'S19-dlr-greenwich': { cam: [7835.5, 588.1, 3300], target: [7985.5, 36.1, 3050] },
  // Closer frames where the first ones are lost among the buildings: the
  // viaduct decks and piers, the Tower Gateway terminus and the Lewisham buffers.
  'S5b-overground-hackney-wick-viaduct': { cam: [6827.2, 520.9, -3998.2], target: [6677.2, 65.2, -4248.2] },
  'S6b-overground-haggerston-viaduct': { cam: [3697.7, 540.3, -3111.8], target: [3537.7, 98.9, -3051.8] },
  'S9b-dlr-tower-gateway-terminus': { cam: [3798.5, 320.3, -624.8], target: [3758.5, 123.6, -464.8] },
  'S11b-dlr-lewisham-terminus': { cam: [7963.5, 754.9, 4191.2], target: [8023.5, 74.0, 4451.2] },
  // Fix round 1 (--live): stations whose building tile streams in after the
  // first quiet 15 s; camera 150 m west, 260 m south, 110 m up of the marker.
  'L1-jubilee-wembley-park-live': { cam: [-10806.8, 749.9, -5687.1], target: [-10656.8, 209.9, -5947.1] },
  'L2-metropolitan-hillingdon-live': { cam: [-22606.8, 732.5, -4368.1], target: [-22456.8, 192.5, -4628.1] },
  'L3-central-ealing-broadway-live': { cam: [-12220.8, 711.9, -293.1], target: [-12070.8, 171.9, -553.1] },
};

if (process.argv[1]?.endsWith('capture-surface-rail.mjs')) {
  const [origin, outDir, tag] = process.argv.slice(2);
  if (!origin || !outDir || !tag) throw new Error('usage: capture-surface-rail.mjs <origin> <outDir> <tag> [--poses a,b] [--isolate-overground]');
  const flag = k => process.argv.includes(k);
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const isolate = flag('--isolate-overground');
  const jpg = flag('--jpg'); // s01:R: JPEG at quality 0.9 (the Reader page embeds them)
  const live = flag('--live'); // s01:R fix round 1: live building tiles (the default path)
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
  await page.goto(`${origin}/?fast=1&buildings=${live ? 'live' : 'baked'}&mh=1.1`);
  await page.waitForFunction(live => (live || window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal)
    && window.__ug?.groundReady && window.__ug.overground?.userData.stationsAttached && ('surfaceRail' in window.__ug ? !!window.__ug.surfaceRail : true), live, { timeout: 180000 });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
  // s01:R: on builds that lift surface markers over roofs, wait for that pass.
  await page.waitForFunction(() => !window.__ug.surfaceRail || !('liftMarkersOverRoofs' in window.__ug.surfaceRail) || !!window.__ug.surfaceRail.roofLift, null, { timeout: 60000 });
  // Live: until no building tile has arrived or left for 20 s (up to 3 min).
  if (live) await page.evaluate(async () => {
    const count = () => (window.__ug.scene.getObjectByName('surfaceGeometry')?.children || []).filter(m => m.name?.startsWith('buildings-')).length;
    let last = count(), since = performance.now(); const t0 = since;
    while (performance.now() - since < 20000 && performance.now() - t0 < 180000) {
      await new Promise(r => setTimeout(r, 500)); const n = count(); if (n !== last) { last = n; since = performance.now(); }
    }
  });
  for (const name of names) {
    const P = POSES[name];
    await page.evaluate(async ({ P, live }) => {
      window.__thaw();
      const u = window.__ug; u.camera.position.fromArray(P.cam); u.controls.target.fromArray(P.target); u.controls.update();
      if (live) {
        // A live building tile over the target (its instances' plan bounds), then 5 s.
        const [x, , z] = P.target, t0 = performance.now();
        const covered = () => (u.scene.getObjectByName('surfaceGeometry')?.children || []).some(m => {
          if (!m.isInstancedMesh || !m.name?.startsWith('buildings-')) return false;
          const a = m.instanceMatrix.array; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (let i = 0; i < m.count; i++) { const o = i * 16; x0 = Math.min(x0, a[o + 12]); x1 = Math.max(x1, a[o + 12]); z0 = Math.min(z0, a[o + 14]); z1 = Math.max(z1, a[o + 14]); }
          return x >= x0 && x <= x1 && z >= z0 && z <= z1;
        });
        while (!covered() && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 500));
        await new Promise(r => setTimeout(r, 5000));
      }
      await new Promise(r => setTimeout(r, 2500));
      window.__freeze = true; await new Promise(r => setTimeout(r, 100)); window.__step(3);
    }, { P, live });
    const png = await page.evaluate(({ isolate, jpg }) => {
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
      return jpg ? cv.toDataURL('image/jpeg', 0.9) : cv.toDataURL('image/png');
    }, { isolate, jpg });
    const ext = jpg ? 'jpg' : 'png';
    await writeFile(`${outDir}/${tag}-${name}.${ext}`, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${tag}-${name}.${ext}`);
  }
  await browser.close();
}
