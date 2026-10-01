// measure-cloud-cost.mjs: what the clouds cost a frame, full, thinned and off
// (sprint 30Sep26w, Lane C, D-041; from the sprint 25Sep26f lane script).
//
// Automatic's level 1 thins the clouds before level 2 drops shadows (D-040).
// This measures, per standard view, the frame time with the clouds FULL (level
// 0), THIN (level 1's distant fade and far-puff thinning, clouds.js
// CLOUD_CONFIG.thinQuality) and OFF, all with sun and cloud shadows as those
// levels have them. The render loop is held and the three states are rendered
// in turn, frame after frame, each timed through a pixel read (so GPU work is
// inside the timing); paired per-round differences cancel slow drift from
// other load. Manual quality at 100% and MSAA 4x (level 0 and 1's resolution).
// The same again for the cloud sprites alone (the scene target with only the
// cloud mesh drawn, against an empty draw): the part of the frame the cloud
// look changes, far less exposed to other load than the whole frame.
//
// Setups, as scripts/measure-setups.mjs: as-lived (DPR 2, no throttle) and
// weak (DPR 1, CDP CPU throttle 4x). 1440x900 CSS, headless ANGLE Metal.
//
// Usage: node scripts/measure-cloud-cost.mjs <dev origin> [as-lived|weak|both] [rounds] [out.json]
// Needs a dev server (window.__ug is stripped from production builds).
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { VIEWS as SETUP_VIEWS, SETUPS } from './measure-setups.mjs';

const [origin = 'http://localhost:5214', which = 'both', roundsArg = '45', out = ''] = process.argv.slice(2);
const ROUNDS = +roundsArg;
const VIEWS = {
  overview: SETUP_VIEWS.overview,
  streetBank: SETUP_VIEWS.streetBank,
  streetUp: { p: [2952.9, 337.8, -732.9], t: [1900, 3300, -300] }, // the clouds' worst case
  riverGreenwich: SETUP_VIEWS.riverGreenwich,
  m25Edge: SETUP_VIEWS.m25Edge,
  heathrow: SETUP_VIEWS.heathrow,
};

async function run(setup) {
  const S = SETUPS[setup];
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: S.dpr });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window); window.__paused = false; const held = [];
    window.requestAnimationFrame = cb => { if (window.__paused && cb.name === 'tick') { held.push(cb); return 0; } return raf(cb); };
    window.__resume = () => { window.__paused = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
  });
  await page.goto(`${origin}/?fast=1&buildings=baked`);
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal && window.__ug.groundReady
    && window.__ugClouds && window.__ug.landmarkGroup?.children.length, null, { timeout: 240000 });
  await page.evaluate(() => {
    const u = window.__ug; u.controls.enableDamping = false; u.fpsControls.enabled = false;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setShadowsEnabled(true, { persist: false }); window.__ugClouds.setTimeOverride(900);
  });
  if (S.cpuThrottle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle });
  }
  const results = {};
  for (const [name, pose] of Object.entries(VIEWS)) {
    results[name] = await page.evaluate(async ({ pose, rounds }) => {
      const u = window.__ug, c = window.__ugClouds, sleep = ms => new Promise(r => setTimeout(r, ms));
      u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
      await sleep(2000); window.__paused = true; await sleep(150);
      const r = u.composer.renderer, gl = r.getContext(), px = new Uint8Array(4);
      const U = c.material.uniforms, lod0 = U.uLod.value.clone(), fade0 = U.uFade.value.clone();
      const sync = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      // Level 1's thinned clouds, as clouds.js eases them (end state).
      // (c820ea9 does not expose its config; its values were these.)
      const TQ = c.config?.thinQuality ?? { lodM: [2000, 7000], fadeM: [7000, 12000] };
      const set = k => {
        c.setEnabled(k !== 'off'); c.setShadowsEnabled(k !== 'off');
        c.update({ camera: u.camera, time: 900 });
        if (k === 'thin') { U.uLod.value.set(...TQ.lodM); U.uFade.value.set(...TQ.fadeM); }
        else { U.uLod.value.copy(lod0); U.uFade.value.copy(fade0); }
      };
      const t = { full: [], thin: [], off: [] };
      for (let i = 0; i < rounds; i++) for (const k of ['full', 'thin', 'off']) {
        set(k); sync(); if (window.__ugSun.status.active) r.shadowMap.needsUpdate = true;
        const s = performance.now(); u.composer.render(0.016); sync(); if (i >= 5) t[k].push(performance.now() - s);
      }
      set('full'); window.__resume();
      const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const d = (a, b) => med(t[a].map((x, i) => x - t[b][i]));
      const clouds = d('full', 'off'), thin = d('thin', 'off');
      // The sprites alone: the same scene target (MSAA, half float), only the
      // cloud mesh drawn, against the same draw with it hidden. Isolates the
      // cloud draw from the rest of the frame and from most outside load.
      window.__paused = true; await sleep(100);
      const shown = u.scene.children.filter(o => o !== c.mesh && o.visible);
      const bg = u.scene.background;
      const target = u.composer.renderTarget1 ?? u.composer.readBuffer;
      const sp = { full: [], thin: [], none: [] }, px16 = new Uint16Array(4);
      let drawn = null;
      shown.forEach(o => { o.visible = false; }); u.scene.background = null;
      for (let i = 0; i < rounds; i++) for (const k of ['full', 'thin', 'none']) {
        set(k === 'none' ? 'full' : k); c.mesh.visible = k !== 'none';
        // A one-pixel read of the target itself (its resolved half-float
        // texture) waits for the draw into it; a read of the default
        // framebuffer does not, under ANGLE Metal.
        // Ten draws a sample, so the read's own cost is spread thin.
        r.setRenderTarget(target); r.clear(); r.readRenderTargetPixels(target, 0, 0, 1, 1, px16);
        const s = performance.now();
        for (let n = 0; n < 10; n++) { r.setRenderTarget(target); r.render(u.scene, u.camera); }
        r.readRenderTargetPixels(target, 0, 0, 1, 1, px16);
        if (i >= 5) sp[k].push((performance.now() - s) / 10);
        if (i === 5 && k === 'full') drawn = { calls: r.info.render.calls, triangles: r.info.render.triangles };
      }
      shown.forEach(o => { o.visible = true; }); u.scene.background = bg; r.setRenderTarget(null);
      set('full'); window.__resume();
      const ds = (a, b) => med(sp[a].map((x, i) => x - sp[b][i]));
      const sprites = ds('full', 'none'), spritesThin = ds('thin', 'none');
      return { fullMs: med(t.full), offMs: med(t.off), clouds, thin, saved: clouds > 0.05 ? (clouds - thin) / clouds : null,
        sprites, spritesThin, spritesSaved: sprites > 0.05 ? (sprites - spritesThin) / sprites : null,
        spritesMs: med(sp.full), emptyMs: med(sp.none), drawn: JSON.stringify(drawn),
        instances: c.status.instances, visibleClouds: c.status.visibleClouds };
    }, { pose, rounds: ROUNDS });
    const r = results[name], f = v => (v == null ? '-' : typeof v === 'number' ? +v.toFixed(2) : v);
    console.log(setup.padEnd(9), name.padEnd(15), JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, f(v)]))));
  }
  await browser.close();
  return results;
}

const setups = which === 'both' ? ['as-lived', 'weak'] : [which];
const all = { origin, rounds: ROUNDS, host: os.hostname(), cpu: os.cpus()[0]?.model, loadavg: os.loadavg(), results: {} };
for (const s of setups) all.results[s] = await run(s);
all.loadavgAfter = os.loadavg();
if (out) await writeFile(out, JSON.stringify(all, null, 1));
