import { test, expect } from '@playwright/test';

// Sprint 24Sep26h (D-038, Lane R): the render economies must leave the picture
// unchanged. At each default view the app loop is frozen (tick is held and
// stepped by hand with a repeated timestamp, so no clock advances), and the
// frame is rendered with every economy off, then on, then off, then on. The
// off/off pair measures the renderer's own frame-to-frame noise; each off/on
// pair must match to within that noise plus a small stated tolerance.
//
// Tolerance: at most 0.002% of pixels (about 100 of 5.2M at 2880x1800) may
// differ, by at most 8 levels. Instance order inside an instanced draw is the
// only thing an economy may change (live cars compacted to the front), which
// can only matter where two instances meet at exactly equal depth.
//
// Fix round 2: the train batch (`trainBatch`) is held ON through these
// comparisons, so they cover every other economy at the tolerance above. Its
// own ABBA, footprint containment and stated tolerance are in
// tests/render-merges.spec.js: instanced drawing moves the last bits of depth,
// which flips a few hundred depth-tied samples on trains kilometres away.
//
// D-040 (26Sep26s): `underAbove` is also held ON. It is the one economy meant to
// change the picture (Jordan approved trade-offs 7 and 8: underground lines draw
// nothing from an above-ground camera, ribbons included); its own checks are in
// tests/underground-cull.spec.js.

const VIEWS = {
  landing: { p: [-194.2, -39, -2162.8], t: [-988.5, 9, -1557.1] },
  overview: { p: [0, 20000, 18000], t: [0, 0, 0] },
  streetBank: { p: [2952.9, 337.8, -732.9], t: [1910.1, 196.2, -783.7] },
  riverGreenwich: { p: [8447.1, 112, 2136.1], t: [7156, 12, 635.4] },
  m25Edge: { p: [4910.7, 634.3, -18445.1], t: [6239.5, 102.8, -20483.9] },
  heathrow: { p: [-19493.3, 1606.7, 4622.3], t: [-22570.2, 120, 4688.2] },
};
const MAX_PCT = 0.002, MAX_LEVEL = 8;

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
    // Run the held app tick n times at the last timestamp: dt = 0, so no
    // simulation, water or traffic clock moves, but every per-frame update runs.
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; const h = held.splice(0); for (const cb of h) window.requestAnimationFrame(cb); };
  });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.flightsGroup && window.__ug.motorwayGroup
    && window.__ug.landmarkGroup?.children.length, null, { timeout: 180000 });
  await page.evaluate(() => {
    const u = window.__ug;
    u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 });
    window.__ugSun.setShadowsEnabled(true, { persist: false });
  });
  await page.waitForTimeout(3000);
});
test.afterAll(async () => { await page?.close(); });

for (const [name, pose] of Object.entries(VIEWS)) {
  test(`economies leave the ${name} view unchanged`, async () => {
    const r = await page.evaluate(async pose => {
      const u = window.__ug;
      u.controls.enableDamping = false;
      u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
      await new Promise(res => setTimeout(res, 1200));
      window.__freeze = true;
      await new Promise(res => setTimeout(res, 100));
      const r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const grab = on => {
        u.economies.setAll(on); u.economies.set('trainBatch', true); u.economies.set('underAbove', true); // own specs: render-merges, underground-cull
        window.__step(4); // M25 traffic recomputes every third tick
        u.composer.render(0);
        r.setRenderTarget(null);
        const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b;
      };
      const diff = (a, b) => {
        let n = 0, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
          if (d) { n++; if (d > max) max = d; }
        }
        return { px: n, pct: n / (W * H) * 100, max };
      };
      const a1 = grab(false), b1 = grab(true), a2 = grab(false), b2 = grab(true);
      const split = { ...u.doubleSideSplit.stats };
      const out = {
        size: [W, H], noise: diff(a1, a2), onNoise: diff(b1, b2), ab1: diff(a1, b1), ab2: diff(a2, b2),
        split, culled: u.motorwayGroup.userData.trafficLod.culled, shadowsActive: window.__ugSun.status.active,
        nonBlack: (() => { let n = 0; for (let i = 0; i < b1.length; i += 64) if (b1[i] + b1[i + 1] + b1[i + 2] > 30) n++; return n; })(),
      };
      window.__thaw();
      u.controls.enableDamping = true;
      return out;
    }, pose);
    console.log(name, JSON.stringify(r));
    // The frame is a real picture, and the economies were in force.
    expect(r.nonBlack).toBeGreaterThan(1000);
    expect(r.split.splitLastRender).toBeGreaterThan(0);
    const allowPct = MAX_PCT + Math.max(r.noise.pct, r.onNoise.pct);
    for (const d of [r.ab1, r.ab2]) {
      expect(d.pct).toBeLessThanOrEqual(allowPct);
      if (d.px > Math.max(r.noise.px, r.onNoise.px)) expect(d.max).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });
}

// Fix round 1: the verifier's pan case. The M25 fleet recomputes every third
// tick; with culling on, a camera that turns between those ticks used to show
// late pop-in at the entering edge (15 degrees and more). revalidate() now
// writes any chunk that can newly show, from the same elapsed time and LOD
// projection, before the frame is drawn, so the frame must equal the unculled
// one. The fog cull is live at landing and river views, so both are covered.
for (const [name, pose, yaws] of [['m25Edge', VIEWS.m25Edge, [8, 20, 40]], ['riverGreenwich', VIEWS.riverGreenwich, [25, 60]], ['landing', VIEWS.landing, [45, 120, 200]]]) {
  test(`pan between traffic updates leaves the ${name} view unchanged`, async () => {
    const res = await page.evaluate(async ({ pose, yaws }) => {
      const u = window.__ug, T = window.__ugTHREE, tl = u.motorwayGroup.userData.trafficLod;
      u.controls.enableDamping = false;
      const r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const place = yaw => {
        u.camera.position.fromArray(pose.p);
        const d = new T.Vector3().fromArray(pose.t).sub(u.camera.position).applyAxisAngle(new T.Vector3(0, 1, 0), yaw * Math.PI / 180);
        u.controls.target.copy(u.camera.position).add(d); u.controls.update();
      };
      const grab = (on, yaw) => {
        u.economies.setAll(on); u.economies.set('trainBatch', true); u.economies.set('underAbove', true); // own specs: render-merges, underground-cull
        place(0);
        window.__step(4); while (tl.frame % 3) window.__step(1); // an update tick just ran at yaw 0
        place(yaw);
        window.__step(1); // not an update tick: only revalidate can react
        const nonUpdate = tl.frame % 3 !== 0;
        u.composer.render(0); r.setRenderTarget(null);
        const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return { b, nonUpdate };
      };
      const diff = (a, b) => { let n = 0, max = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) { n++; if (d > max) max = d; } } return { px: n, pct: n / (W * H) * 100, max }; };
      place(0); await new Promise(res => setTimeout(res, 1200));
      window.__freeze = true; await new Promise(res => setTimeout(res, 100));
      const out = [];
      for (const yaw of yaws) {
        const rv0 = tl.revalidations || 0;
        const a1 = grab(false, yaw), b1 = grab(true, yaw), a2 = grab(false, yaw), b2 = grab(true, yaw);
        out.push({ yaw, nonUpdate: a1.nonUpdate && b1.nonUpdate && a2.nonUpdate && b2.nonUpdate, revalidations: (tl.revalidations || 0) - rv0,
          noise: diff(a1.b, a2.b), onNoise: diff(b1.b, b2.b), ab1: diff(a1.b, b1.b), ab2: diff(a2.b, b2.b), fogChunks: tl.fogCulledChunks });
      }
      // Negative control: with revalidate stubbed out, the widest pan must lose
      // pixels, or this test could not see the pop-in it guards against.
      const ud = u.motorwayGroup.userData, real = ud.revalidate;
      ud.revalidate = () => false;
      let control;
      try { const yaw = yaws[yaws.length - 1]; control = diff(grab(false, yaw).b, grab(true, yaw).b); } finally { ud.revalidate = real; }
      window.__thaw(); u.controls.enableDamping = true;
      return { out, control };
    }, { pose, yaws });
    const { out: r, control } = res;
    console.log(`pan ${name}`, JSON.stringify(r), 'control', JSON.stringify(control));
    // The M25 edge view is where late pop-in shows (verifier: 1,142 to 58,173 px
    // at 15 degrees and more); elsewhere the entering chunks may be hidden anyway.
    if (name === 'm25Edge') expect(control.px).toBeGreaterThan(50);
    for (const d of r) {
      expect(d.nonUpdate).toBe(true);
      const allowPct = MAX_PCT + Math.max(d.noise.pct, d.onNoise.pct);
      for (const x of [d.ab1, d.ab2]) {
        expect(x.pct).toBeLessThanOrEqual(allowPct);
        if (x.px > Math.max(d.noise.px, d.onNoise.px)) expect(x.max).toBeLessThanOrEqual(MAX_LEVEL);
      }
    }
    // At least one pan in this view made revalidate write newly visible chunks.
    expect(r.some(d => d.revalidations > 0)).toBe(true);
  });
}

test('negative control: the M25 fleet is visible at the edge view, so culling had pixels to lose', async () => {
  const r = await page.evaluate(async pose => {
    const u = window.__ug;
    u.controls.enableDamping = false;
    u.camera.position.fromArray(pose.p); u.controls.target.fromArray(pose.t); u.controls.update();
    await new Promise(res => setTimeout(res, 800));
    window.__freeze = true; await new Promise(res => setTimeout(res, 100));
    const r = u.composer.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { window.__step(4); u.composer.render(0); r.setRenderTarget(null); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
    const cars = u.motorwayGroup.children.filter(m => m.name.startsWith('m25-cars'));
    const drawn = cars.reduce((n, m) => n + m.count, 0);
    const a = grab(); for (const m of cars) m.layers.mask = 0; const b = grab(); for (const m of cars) m.layers.enableAll();
    let px = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) px++;
    window.__thaw(); u.controls.enableDamping = true;
    return { px, drawn, culled: u.motorwayGroup.userData.trafficLod.culled };
  }, VIEWS.m25Edge);
  console.log('control', JSON.stringify(r));
  expect(r.drawn).toBeGreaterThan(20);
  expect(r.culled).toBeGreaterThan(r.drawn);
  expect(r.px).toBeGreaterThan(50);
});

test('split passes read the live uniforms the app updates (water clock)', async () => {
  const read = () => page.evaluate(() => {
    const u = window.__ug, props = u.composer.renderer.properties, out = [], seen = new Set();
    for (const [mesh] of u.doubleSideSplit.entries) {
      const m = mesh.material, live = m.userData.waterUniforms;
      if (seen.has(m) || !live) continue; seen.add(m);
      const pair = u.doubleSideSplit.pairOf(m); if (!pair) continue;
      const b = props.get(pair.back).uniforms, f = props.get(pair.front).uniforms;
      out.push({ kind: m.userData.waterKind, compiled: !!(b && f), backShares: b?.uTime === live.uTime,
        frontShares: f?.uTime === live.uTime, t: live.uTime.value });
    }
    return out;
  });
  const first = await read();
  console.log('uniforms', JSON.stringify(first));
  expect(first.length).toBeGreaterThan(0);
  for (const d of first) { expect(d.compiled).toBe(true); expect(d.backShares).toBe(true); expect(d.frontShares).toBe(true); }
  await page.waitForTimeout(300);
  const later = await read();
  expect(later[0].t).toBeGreaterThan(first[0].t); // the shared clock is the one that advances
});
