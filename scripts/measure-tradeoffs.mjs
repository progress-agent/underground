// Visible render trade-offs (NOT shipped), measured on the two agreed setups
// (sprint 25Sep26f, D-039, Lane H; from the 24Sep26h economies harness).
//
// For each trade-off and view: frozen-frame milliseconds before and after (the
// whole composer render plus a GPU drain, mean of ABBA pairs, so larger than a
// live frame), the share of pixels that change, and, at the capture views,
// before/after PNG crops centred on where the picture changes most, plus a
// whole-frame "where it changed" map (changed pixels in red over a dimmed frame).
//
// Usage (dev server only; window.__ug is stripped from production builds):
//   node scripts/measure-tradeoffs.mjs <as-lived|weak> <origin> <outdir> [views]
//   views: comma list from landing,overview,streetBank,riverGreenwich,m25Edge,heathrow
// Writes <outdir>/tradeoffs-<setup>.json and <outdir>/captures/<setup>-<view>-<tradeoff>-{before,after}.png
import { writeFile, mkdir } from 'node:fs/promises';
import { VIEWS as STD, SETUPS } from './measure-setups.mjs';

const [setup = 'as-lived', origin = 'http://localhost:5173', out = '/tmp/ug-tradeoffs', viewArg = ''] = process.argv.slice(2);
const S = SETUPS[setup]; if (!S) throw new Error(`unknown setup ${setup}`);
await mkdir(`${out}/captures`, { recursive: true });
const VIEWS = { landing: { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] }, ...Object.fromEntries(Object.entries(STD).filter(([, v]) => v)) };
const CAPTURE = { overview: true, streetBank: true, riverGreenwich: true };
export const TRADEOFFS = ['msaa0', 'msaa2', 'scale75msaa2', 'scale85', 'shadowsOff', 'bloomOff', 'bloomHalf', 'undergroundHiddenAbove', 'geologyHiddenAbove', 'undersideHiddenAbove'];
const CROP = { w: 480, h: 300 }; // CSS pixels
const views = viewArg ? viewArg.split(',') : Object.keys(VIEWS);

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: S.dpr });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window); const held = []; let lastTs = 0;
  window.requestAnimationFrame = cb => { if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; } return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); }); };
  window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
  window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
});
await page.goto(`${origin}/?fast=1&buildings=baked`);
await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup && window.__ug.landmarkGroup?.children.length, null, { timeout: 240000 });
const layerCounts = await page.evaluate(() => {
  const u = window.__ug, Sc = u.scene, by = n => Sc.getObjectByName(n);
  u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); window.__ugSun.setShadowsEnabled(true, { persist: false }); u.controls.enableDamping = false;
  const lineGroups = () => Sc.children.filter(c => c.name?.startsWith('line:'));
  const sets = {
    geologyHiddenAbove: () => ['geological-strata', 'geology-exterior'].map(by).filter(Boolean),
    undersideHiddenAbove: () => [by('terrainUnderside')].filter(Boolean),
    undergroundHiddenAbove: () => [by('terrainUnderside'), ...['geological-strata', 'geology-exterior', 'tideway-system', 'crossrail-tunnel', 'sewer-tunnels'].map(by), ...lineGroups(), u.unifiedShaftLayer?.group, ...Sc.children.filter(c => !c.name && c.isMesh && c.userData?.kind)].filter(Boolean),
  };
  const saved = new Map(); let bloomSize = null;
  window.__T = {
    set(name, on) {
      if (name === 'shadowsOff') return window.__ugSun.setShadowsEnabled(!on, { persist: false });
      if (name === 'msaa2') return u.renderQuality.set({ scale: 1, samples: on ? 2 : 4 });
      if (name === 'msaa0') return u.renderQuality.set({ scale: 1, samples: on ? 0 : 4 });
      if (name === 'scale85') return u.renderQuality.set({ scale: on ? .85 : 1, samples: 4 });
      if (name === 'scale75msaa2') return u.renderQuality.set({ scale: on ? .75 : 1, samples: on ? 2 : 4 });
      if (name === 'bloomOff') { u.bloomPass.enabled = !on; return; }
      if (name === 'bloomHalf') {
        const rt = u.composer.renderTarget1; if (on) { bloomSize = [rt.width, rt.height]; u.bloomPass.setSize(Math.round(rt.width / 2), Math.round(rt.height / 2)); } else if (bloomSize) { u.bloomPass.setSize(...bloomSize); } return;
      }
      for (const root of sets[name]()) root.traverse(o => { if (on) { if (!saved.has(o)) saved.set(o, o.layers.mask); o.layers.mask = 0; } else if (saved.has(o)) { o.layers.mask = saved.get(o); saved.delete(o); } });
    },
  };
  return Object.fromEntries(Object.entries(sets).map(([k, f]) => [k, f().length]));
});
if (S.cpuThrottle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.cpuThrottle }); }
await page.waitForTimeout(3000);

const results = {};
for (const v of views) {
  results[v] = {};
  await page.evaluate(async pose => { const u = window.__ug; u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update(); await new Promise(r => setTimeout(r, 1500)); window.__freeze = true; await new Promise(r => setTimeout(r, 100)); }, VIEWS[v]);
  const underground = await page.evaluate(() => { const u = window.__ug, y = u.getTerrainMeshSurfaceY({ x: u.camera.position.x, z: u.camera.position.z }); return y !== null && u.camera.position.y < y; });
  for (const t of TRADEOFFS) {
    if (t.endsWith('Above') && underground) continue;
    const r = await page.evaluate(async ({ t, crop }) => {
      const u = window.__ug, r = u.composer.renderer, gl = r.getContext();
      const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const bench = () => { const px = new Uint8Array(4), sync = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }; const tot = []; for (let i = 0; i < 12; i++) { sync(); if (window.__ugSun.status.active) r.shadowMap.needsUpdate = true; const s = performance.now(); u.composer.render(0.016); sync(); if (i >= 2) tot.push(performance.now() - s); } return med(tot); };
      const grab = () => { u.composer.render(0); r.setRenderTarget(null); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return { b, W, H }; };
      const state = on => { window.__T.set(t, on); window.__step(4); };
      const ms = { off: [], on: [] };
      for (const on of [false, true, true, false]) { state(on); ms[on ? 'on' : 'off'].push(bench()); }
      state(false); const A = grab(); state(true); const B = grab();
      const same = A.W === B.W && A.H === B.H;
      let diff = 0, maxd = 0; const mask = same ? new Uint8Array(A.W * A.H) : null;
      if (same) for (let p = 0, n = A.W * A.H; p < n; p++) {
        const i = p * 4, d = Math.max(Math.abs(A.b[i] - B.b[i]), Math.abs(A.b[i + 1] - B.b[i + 1]), Math.abs(A.b[i + 2] - B.b[i + 2]));
        if (d > 2) { diff++; if (d > maxd) maxd = d; const y = A.H - 1 - Math.floor(p / A.W); mask[y * A.W + (p % A.W)] = 1; }
      }
      // Centre of the densest changed region, in CSS pixels.
      let spot = null;
      if (same && diff) {
        const dpr = devicePixelRatio, cw = Math.round(crop.w * dpr), ch = Math.round(crop.h * dpr), step = Math.max(8, Math.round(16 * dpr));
        const gw = Math.ceil(A.W / step), gh = Math.ceil(A.H / step), grid = new Float64Array(gw * gh);
        for (let y = 0; y < A.H; y++) for (let x = 0; x < A.W; x++) if (mask[y * A.W + x]) grid[Math.floor(y / step) * gw + Math.floor(x / step)]++;
        const bw = Math.max(1, Math.round(cw / step)), bh = Math.max(1, Math.round(ch / step));
        let best = -1, bx = 0, by = 0;
        for (let gy = 0; gy + bh <= gh; gy++) for (let gx = 0; gx + bw <= gw; gx++) {
          let sum = 0; for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) sum += grid[(gy + j) * gw + gx + i];
          if (sum > best) { best = sum; bx = gx; by = gy; }
        }
        const cssW = A.W / dpr, cssH = A.H / dpr;
        spot = { x: Math.round(Math.min(Math.max(0, bx * step / dpr), cssW - crop.w)), y: Math.round(Math.min(Math.max(0, by * step / dpr), cssH - crop.h)), changedInCrop: best };
      }
      // Downsampled "where it changed" map: dimmed before-frame, changed pixels red.
      let map = null;
      if (same) {
        const k = Math.max(1, Math.round(A.W / 720)), mw = Math.floor(A.W / k), mh = Math.floor(A.H / k);
        const cv = document.createElement('canvas'); cv.width = mw; cv.height = mh;
        const cx = cv.getContext('2d'), img = cx.createImageData(mw, mh), m = img.data;
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
          let hit = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) hit |= mask[(y * k + j) * A.W + x * k + i];
          const src = ((A.H - 1 - y * k) * A.W + x * k) * 4, o = (y * mw + x) * 4;
          if (hit) { m[o] = 255; m[o + 1] = 32; m[o + 2] = 32; } else { m[o] = A.b[src] * 0.35; m[o + 1] = A.b[src + 1] * 0.35; m[o + 2] = A.b[src + 2] * 0.35; }
          m[o + 3] = 255;
        }
        cx.putImageData(img, 0, 0); map = cv.toDataURL('image/png');
      }
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
      return { off: mean(ms.off), on: mean(ms.on), saving: mean(ms.off) - mean(ms.on), raw: ms, changedPx: diff, changedPct: same ? +(diff / (A.W * A.H) * 100).toFixed(4) : null, maxLevel: maxd, resized: !same,
        W: A.W, H: A.H, spot, map };
    }, { t, crop: CROP });
    const spot = r.spot;
    if (CAPTURE[v]) {
      const clip = { ...(spot ?? { x: (1440 - CROP.w) / 2, y: (900 - CROP.h) / 2 }), width: CROP.w, height: CROP.h };
      delete clip.changedInCrop;
      for (const on of [false, true]) {
        await page.evaluate(({ t, on }) => { window.__T.set(t, on); window.__step(4); window.__ug.composer.render(0); }, { t, on });
        await page.screenshot({ path: `${out}/captures/${setup}-${v}-${t}-${on ? 'after' : 'before'}.png`, clip, scale: 'device' });
      }
      if (r.map) await writeFile(`${out}/captures/${setup}-${v}-${t}-map.png`, Buffer.from(r.map.split(',')[1], 'base64'));
      r.crop = clip;
    }
    await page.evaluate(t => { window.__T.set(t, false); window.__step(4); }, t);
    delete r.map; delete r.spot;
    r.hotspot = spot;
    results[v][t] = r;
    console.log(setup, v.padEnd(15), t.padEnd(24), `${r.off.toFixed(2)} -> ${r.on.toFixed(2)} ms (saves ${r.saving.toFixed(2)})`, r.changedPct === null ? 'resolution change' : `${r.changedPct}% px changed, max ${r.maxLevel}`);
  }
  await page.evaluate(() => window.__thaw());
}
await writeFile(`${out}/tradeoffs-${setup}.json`, JSON.stringify({ when: new Date().toISOString(), setup, dpr: S.dpr, cpuThrottle: S.cpuThrottle, origin, layerCounts, errors,
  note: 'Frozen-frame ms (serialised render + GPU drain), mean of ABBA pairs; changed pixels counted above a 2-level threshold. Indicative: other lanes shared the GPU.', results }, null, 1));
await browser.close();
