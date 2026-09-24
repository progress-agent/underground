import { test, expect } from '@playwright/test';

// Sprint 24Sep26h (D-038, Lane R, fix round 2): the draw-call merges the
// profile ranked third (underground layers: 1,000 to 1,900 draws, mostly CPU
// submit). Each candidate is either built and shown to leave the picture
// unchanged, or measured and shown to change it.
//
//   Tube trains, one InstancedMesh per line per part: BUILT (economy
//   `trainBatch`). Every train part is opaque (the window strips are alphaTest
//   cutouts), so the depth test, not draw order, decides every pixel; the
//   only differences are last-bit depth ties on distant trains (see below).
//   Station shafts as one InstancedMesh: RULED OUT here with evidence. The
//   shafts are transparent, double-sided and do not write depth; three draws
//   an instanced double-sided transparent mesh as all back faces then all
//   front faces, so wherever two shafts overlap on screen the blend order
//   changes.
//   Tunnel pairs merged per line: RULED OUT here with evidence. The tunnels
//   are transparent and DO write depth, so whichever of two overlapping tubes
//   is drawn first hides the other; merged, the order is fixed by vertex
//   order instead of by depth sort.
//
// Harness as in render-economies.spec.js: the app loop is frozen and stepped
// with dt = 0, frames are compared ABBA, and off/off gives the noise floor.

const VIEWS = {
  landing: { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] },
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  streetBank: { p: [2952.9, 337.8, -732.9], t: [1910.1, 196.2, -783.7] },
  riverGreenwich: { p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
};
const MAX_PCT = 0.002; // render-economies.spec.js's pixel tolerance

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held = [];
    let lastTs = 0;
    window.requestAnimationFrame = cb => {
      if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
      return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
    };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; const h = held.splice(0); for (const cb of h) window.requestAnimationFrame(cb); };
    // Shared helpers for the page-side tests.
    window.__grabber = () => {
      const u = window.__ug, r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = () => { window.__step(4); u.composer.render(0); r.setRenderTarget(null); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
      const diff = (a, b) => { let n = 0, max = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) { n++; if (d > max) max = d; } } return { px: n, pct: n / (W * H) * 100, max }; };
      // Main-scene draw calls for one plain render (the composer resets info per pass).
      const calls = () => { const info = r.info; info.autoReset = false; info.reset(); r.setRenderTarget(null); r.render(u.scene, u.camera); const c = info.render.calls; info.autoReset = true; return c; };
      return { grab, diff, calls };
    };
    window.__place = async pose => {
      const u = window.__ug; u.controls.enableDamping = false;
      u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
      await new Promise(res => setTimeout(res, 1200));
      window.__freeze = true; await new Promise(res => setTimeout(res, 100));
    };
    window.__release = () => { window.__thaw(); window.__ug.controls.enableDamping = true; };
  });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup
    && window.__ug.landmarkGroup?.children.length && window.__ug.unifiedShaftLayer
    && window.__ug.trainSystem.allTrains.length > 100, null, { timeout: 180000 });
  await page.evaluate(() => {
    const u = window.__ug;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setShadowsEnabled(true, { persist: false });
  });
  await page.waitForTimeout(3000);
});
test.afterAll(async () => { await page?.close(); });

// Train batch tolerance. The per-train meshes get model-view matrices built
// in double precision on the CPU; the instanced draw multiplies on the GPU in
// single precision. The depths differ in the last bits, which matters only
// where the depth buffer cannot separate a train body from its tunnel wall
// (0.7 m apart; with near 1 and far 50,000 the 24-bit depth step passes 0.7 m
// at about 3.5 km). Those distant samples already flicker between the two as
// trains move. Measured with the post chain (bloom spreads each sample a
// little): 0.007 to 0.017% of pixels at the landing view and 0.009% at the
// overview, varying by page load because train phases are drawn at random
// when the lines are built (createTrains, pre-existing). So for this economy
// the composed frame may differ by up to 0.04% of pixels, and every differing
// pixel of the plain scene render must lie on a train: inside the footprint
// the trains cover on either path, dilated by 2 px for the MSAA resolve.
const TRAIN_MAX_PCT = 0.04, FOOTPRINT_DILATE = 2;

for (const [name, pose] of Object.entries(VIEWS)) {
  test(`train batch leaves the ${name} view unchanged off the trains and cuts draw calls`, async () => {
    const r = await page.evaluate(async ({ pose, DIL }) => {
      const u = window.__ug; await window.__place(pose);
      const { grab, diff, calls } = window.__grabber();
      const R = u.composer.renderer, gl = R.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const plain = () => { window.__step(4); R.setRenderTarget(null); R.render(u.scene, u.camera); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
      const set = on => { u.economies.set('trainBatch', on); return grab(); };
      const a1 = set(false), c0 = calls(), b1 = set(true), c1 = calls(), a2 = set(false), b2 = set(true);
      // Plain scene render, off vs on, and the trains' footprint (on vs trains hidden).
      u.economies.set('trainBatch', false); const pOff = plain();
      u.economies.set('trainBatch', true); const pOn = plain();
      // Both paths' train parts hidden (layers do not inherit, so every descendant).
      const parts = []; u.scene.traverse(o => { if (o.userData?.trainBatch) parts.push(o); });
      for (const t of u.trainSystem.allTrains) parts.push(t);
      for (const o of parts) o.traverse(c => { c.layers.mask = 0; });
      const pNone = plain();
      for (const o of parts) o.traverse(c => c.layers.enableAll());
      const foot = new Uint8Array(W * H);
      const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
      for (let p = 0, i = 0; p < W * H; p++, i += 4) if (differs(pOn, pNone, i) || differs(pOff, pNone, i)) {
        const x = p % W, y = (p / W) | 0;
        for (let dy = -DIL; dy <= DIL; dy++) for (let dx = -DIL; dx <= DIL; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) foot[yy * W + xx] = 1; }
      }
      let plainDiff = 0, outside = 0, footPx = 0;
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        footPx += foot[p];
        if (pOff[i] !== pOn[i] || pOff[i + 1] !== pOn[i + 1] || pOff[i + 2] !== pOn[i + 2]) { plainDiff++; if (!foot[p]) outside++; }
      }
      const out = { noise: diff(a1, a2), onNoise: diff(b1, b2), ab1: diff(a1, b1), ab2: diff(a2, b2), callsOff: c0, callsOn: c1,
        plainDiff, outside, footPx, stats: { ...u.trainBatchStats }, trains: u.trainSystem.allTrains.length };
      window.__release();
      return out;
    }, { pose, DIL: FOOTPRINT_DILATE });
    console.log(`trainBatch ${name}`, JSON.stringify(r));
    expect(r.stats.batches).toBeGreaterThan(5);
    expect(r.stats.instances).toBe(3 * r.trains);
    expect(r.callsOn).toBeLessThan(r.callsOff);
    expect(r.noise.px).toBe(0); expect(r.onNoise.px).toBe(0);
    for (const d of [r.ab1, r.ab2]) expect(d.pct).toBeLessThanOrEqual(TRAIN_MAX_PCT);
    // Nothing but trains changes.
    expect(r.outside).toBe(0);
  });
}

test('negative control: trains are in the landing picture, so the batch had pixels to get wrong', async () => {
  const r = await page.evaluate(async pose => {
    const u = window.__ug; await window.__place(pose);
    const { grab, diff } = window.__grabber();
    u.economies.set('trainBatch', true);
    const roots = [];
    u.scene.traverse(o => { if (o.userData?.trainBatch) roots.push(o); });
    const a = grab();
    for (const o of roots) o.traverse(c => { c.layers.mask = 0; }); // layers do not inherit
    const b = grab();
    for (const o of roots) o.traverse(c => c.layers.enableAll());
    const out = { hidden: diff(a, b), roots: roots.length };
    window.__release();
    return out;
  }, VIEWS.landing);
  console.log('train control', JSON.stringify(r));
  expect(r.roots).toBeGreaterThan(5);
  expect(r.hidden.px).toBeGreaterThan(50);
});

test('train batches survive the tube rebuild: one per line, every train drawn exactly once', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug;
    const census = () => {
      const lines = u.scene.children.filter(c => c.name?.startsWith('line:'));
      return lines.map(g => {
        const roots = g.children.filter(c => c.userData?.trainBatch);
        const trains = u.trainSystem.allTrains.filter(t => t.parent === g).length;
        const b = roots[0]?.userData.trainBatch;
        return { line: g.name, roots: roots.length, trains, batched: b?.trains.length ?? 0, body: b?.body.count ?? 0, win: b?.win.count ?? 0,
          disposed: !!b?.disposed, nearShown: u.trainSystem.allTrains.filter(t => t.parent === g && t.userData.nearGroup.visible).length };
      });
    };
    u.economies.set('trainBatch', true);
    await new Promise(r => setTimeout(r, 300));
    const before = census();
    u.snapAllTubesToTerrain();
    await new Promise(r => setTimeout(r, 500));
    return { before, after: census(), total: u.trainSystem.allTrains.length };
  });
  console.log('rebuild', JSON.stringify(r.after));
  for (const set of [r.before, r.after]) {
    for (const l of set) {
      if (!l.trains) continue;
      expect(l.roots).toBe(1);
      expect(l.disposed).toBe(false);
      expect(l.batched).toBe(l.trains);
      expect(l.body).toBe(l.trains);
      expect(l.win).toBe(2 * l.trains);
      expect(l.nearShown).toBe(0);
    }
  }
  expect(r.after.reduce((n, l) => n + l.batched, 0)).toBe(r.total);
});

// ── Ruled out, with evidence ────────────────────────────────────────────────
// Each emulation builds the merged draw exactly as a shipped merge would, hides
// the originals, and compares with the unmerged frame. The candidate is ruled
// out if any default view changes by more than the pixel tolerance.

async function emulate(kind) {
  const out = {};
  for (const [name, pose] of Object.entries(VIEWS)) {
    out[name] = await page.evaluate(async ({ pose, kind }) => {
      const u = window.__ug, T = window.__ugTHREE; await window.__place(pose);
      const { grab, diff } = window.__grabber();
      const undo = [];
      let merged = 0, replaced = 0;
      if (kind === 'shafts') {
        // One InstancedMesh for every station shaft (same unit cylinder and
        // shared material), instances ordered far to near from this camera:
        // the most favourable fixed order a merge could have.
        const group = u.unifiedShaftLayer.group;
        const shafts = group.children.filter(m => m.isMesh && m.userData.type === 'station-shaft' && m.visible);
        group.updateMatrixWorld(true);
        const cam = u.camera.position;
        const order = [...shafts].sort((a, b) => b.getWorldPosition(new T.Vector3()).distanceTo(cam) - a.getWorldPosition(new T.Vector3()).distanceTo(cam));
        const inst = new T.InstancedMesh(shafts[0].geometry, shafts[0].material, order.length);
        order.forEach((m, i) => inst.setMatrixAt(i, m.matrixWorld));
        inst.renderOrder = shafts[0].renderOrder; inst.frustumCulled = false;
        u.scene.add(inst); merged = 1; replaced = shafts.length;
        for (const m of shafts) { m.visible = false; }
        undo.push(() => { u.scene.remove(inst); inst.dispose(); for (const m of shafts) m.visible = true; });
      } else {
        // Each line's tunnel tubes (left and right, every branch) merged into
        // one mesh with the line's own material, in build order.
        for (const g of u.scene.children.filter(c => c.name?.startsWith('line:') && c.visible)) {
          const tubes = g.children.filter(m => m.isMesh && m.userData.type === 'tube-line' && m.visible);
          if (tubes.length < 2) continue;
          const parts = tubes.map(m => { const g = m.geometry.clone().applyMatrix4(m.matrix); return g.index ? g : g.setIndex([...Array(g.getAttribute('position').count).keys()]); });
          const names = Object.keys(parts[0].attributes).filter(n => parts.every(p => p.getAttribute(n)?.itemSize === parts[0].getAttribute(n).itemSize));
          const geo = new T.BufferGeometry(); let vOff = 0; const idx = [];
          for (const n of names) {
            const size = parts[0].getAttribute(n).itemSize, total = parts.reduce((s, p) => s + p.getAttribute(n).count, 0);
            const arr = new Float32Array(total * size); let o = 0;
            for (const p of parts) { arr.set(p.getAttribute(n).array, o); o += p.getAttribute(n).array.length; }
            geo.setAttribute(n, new T.BufferAttribute(arr, size));
          }
          for (const p of parts) { for (const i of p.index.array) idx.push(i + vOff); vOff += p.getAttribute('position').count; }
          geo.setIndex(idx);
          const mesh = new T.Mesh(geo, tubes[0].material); mesh.renderOrder = tubes[0].renderOrder;
          g.add(mesh); merged++; replaced += tubes.length;
          for (const m of tubes) m.visible = false;
          undo.push(() => { g.remove(mesh); geo.dispose(); for (const m of tubes) m.visible = true; });
        }
      }
      const mergedFrame = grab();
      for (const f of undo) f();
      const original = grab();
      window.__release();
      return { merged, replaced, ab: diff(original, mergedFrame) };
    }, { pose, kind });
  }
  return out;
}

for (const kind of ['shafts', 'tunnels']) {
  test(`evidence: merging ${kind} changes the picture, so it is not shipped`, async () => {
    // Noise floor per view: two unmerged frames.
    const noise = {};
    for (const [name, pose] of Object.entries(VIEWS)) {
      noise[name] = await page.evaluate(async pose => {
        await window.__place(pose); const { grab, diff } = window.__grabber();
        const a = grab(), b = grab(); window.__release(); return diff(a, b);
      }, pose);
    }
    const r = await emulate(kind);
    for (const name of Object.keys(r)) r[name].noise = noise[name];
    console.log(`merge ${kind}`, JSON.stringify(r));
    // Every view is noise-free, so any difference is the merge's own.
    for (const name of Object.keys(r)) expect(r[name].noise.px).toBe(0);
    const worst = Math.max(...Object.values(r).map(x => x.ab.pct));
    expect(worst).toBeGreaterThan(MAX_PCT);
  });
}
