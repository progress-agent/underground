// altitude-map.spec.js: Lane F (sprint 02Oct26f, D-048 item 8).
//
// The map must still fill the frame below the horizon from any altitude. Until
// this sprint the abyss dome (radius 45000, camera-centred, opaque below the
// horizon, depth-tested at its true radius) painted over every ground point
// more than 45000 canonical units from the camera, so the map vanished from
// about 9,000 m on the altimeter: the visible disc is sqrt(45000^2 - (5 alt)^2),
// and Master cancels. The dome is now drawn at the far plane and fills only
// pixels nothing else has claimed.
//
// The measure (same one the acceptance file defines): from altimeter height A
// metres and Master M, look down at 60 degrees over central London. Render
// three float targets with the real scene, in one task:
//   G: as the app draws it, but the dome and the analytic sky hidden, clear
//      colour magenta (so a pixel is "geometry" when it is not magenta);
//   A: as the app draws it;
//   D: only the dome visible, clear colour magenta.
// A geometry pixel is "occluded" when the app's pixel differs from G and equals
// D, that is, the dome paints over it. The share of drawn map overpainted by
// the dome must be at most 0.5 percent at every pose. `coverage` is the share of
// the pixels whose ray meets the ground disc (radius 18 km, plane y = 75)
// inside 0.98 of the far plane that show geometry and are not overpainted.
//
// UG_ALT_OUT=<file> writes the per-pose figures as JSON before asserting (used
// to record the e0675d7 "before" figures against a server on that commit).

import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const HEIGHTS = [5000, 9000, 12000, 15000, 20000, 30000];
const MASTERS = [1.1, 3];

async function boot(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?fast=1&buildings=baked');
  await page.waitForFunction(() => !!(window.__ug?.camera && window.__ug.groundReady && window.__ugSky
    && ['done', 'bypassed'].includes(window.__ug.intro?.getPhase?.())), null, { timeout: 90000 });
}

const frames = (page, n = 3) => page.evaluate(n => new Promise(r => {
  let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);

async function setMaster(page, m) {
  await page.evaluate(m => {
    const el = document.getElementById('masterHeight');
    el.value = String(m); el.dispatchEvent(new Event('input', { bubbles: true }));
    window.__ug.structureMorph.flush();
  }, m);
  const got = await page.evaluate(() => window.__ug.camera.userData.masterHeightController.value);
  expect(got).toBeCloseTo(m, 5);
}

// Place the H1 pose for altimeter height A (metres) at Master M: canonical
// y = 75 + 5 A, z = y r / tan 60, looking north-and-down at a display pitch of
// 60 degrees (canonical forward (0, -tan60 / r, -1) normalised).
async function placeAltitude(page, A, M) {
  await page.evaluate(([A, M]) => {
    const u = window.__ug, r = M / 5, t60 = Math.tan(Math.PI / 3);
    u.fpsControls.enabled = false;
    const y = 75 + 5 * A, z = y * r / t60;
    const f = { x: 0, y: -t60 / r, z: -1 }, n = Math.hypot(f.x, f.y, f.z);
    u.camera.position.set(0, y, z);
    u.controls.target.set(0, y + 1000 * f.y / n, z + 1000 * f.z / n);
  }, [A, M]);
  await frames(page, 8);
}

// The H2 measure, all in one task.
const measure = page => page.evaluate(() => {
  const u = window.__ug, T = window.__ugTHREE, rend = u.composer.renderer, cam = u.camera;
  const ratio = cam.userData.masterHeightController.ratio;
  const W = 192, H = Math.round(W / cam.aspect);
  const dome = u.scene.getObjectByName('skyDome'), sky = window.__ugSky.mesh;
  const savedClear = new T.Color(); rend.getClearColor(savedClear); const savedAlpha = rend.getClearAlpha();
  const all = [];
  u.scene.traverse(o => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push(o); });
  const saved = new Map(all.map(o => [o, o.visible]));
  const restore = () => { for (const [o, v] of saved) o.visible = v; };
  const shoot = (setup, { cull, magenta }) => {
    setup();
    if (magenta) rend.setClearColor(0xff00ff, 1); else rend.setClearColor(savedClear, savedAlpha);
    const rt = new T.WebGLRenderTarget(W, H, { type: T.FloatType });
    rend.setRenderTarget(rt);
    if (cull) u.undergroundCull.render(true, () => rend.render(u.scene, cam)); else rend.render(u.scene, cam);
    const px = new Float32Array(W * H * 4); rend.readRenderTargetPixels(rt, 0, 0, W, H, px);
    rend.setRenderTarget(null); rt.dispose();
    restore();
    return px;
  };
  let g, a, d;
  try {
    // The clouds are hidden in G and A (D has only the dome): they draw after the
    // dome in every build, so they would otherwise make A differ from D wherever
    // one lies over the ground, hiding the occlusion being measured.
    const noClouds = () => { for (const o of all) if (o.name === 'clouds') o.visible = false; };
    g = shoot(() => { noClouds(); dome.visible = false; sky.visible = false; }, { cull: true, magenta: true });
    a = shoot(noClouds, { cull: true, magenta: false });
    d = shoot(() => { for (const o of all) o.visible = o === dome; }, { cull: false, magenta: true });
  } finally { rend.setClearColor(savedClear, savedAlpha); restore(); }
  const fog = u.scene.fog.color;
  const inv = cam.projectionMatrixInverse, mw = cam.matrixWorld, cp = cam.position;
  const v = new T.Vector3();
  let nGeom = 0, nOcc = 0, nExp = 0, nCov = 0, nDisc = 0, nBeyond = 0, nFog = 0;
  const farCut = 0.98 * cam.far;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    const near = (px, c) => Math.abs(px[k] - c[0]) < 0.02 && Math.abs(px[k + 1] - c[1]) < 0.02 && Math.abs(px[k + 2] - c[2]) < 0.02;
    const geom = !near(g, [1, 0, 1]);
    const dGA = Math.max(Math.abs(a[k] - g[k]), Math.abs(a[k + 1] - g[k + 1]), Math.abs(a[k + 2] - g[k + 2]));
    const dAD = Math.max(Math.abs(a[k] - d[k]), Math.abs(a[k + 1] - d[k + 1]), Math.abs(a[k + 2] - d[k + 2]));
    // Thresholds: the scene is dark and hazed from altitude (a ground pixel and the
    // dome pixel that replaces it can differ by only 0.03), so the acceptance
    // file's 0.04 / 0.02 cannot see the occlusion on e0675d7; 0.01 / 0.005 does.
    const occluded = geom && dGA > 0.01 && dAD < 0.005;
    // Canonical ray through the pixel centre, and where it meets the plane y = 75.
    v.set(((i + 0.5) / W) * 2 - 1, ((j + 0.5) / H) * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(mw).sub(cp);
    let inDisc = false, dist = Infinity;
    if (v.y < -1e-9) {
      const t = (75 - cp.y) / v.y;
      const px = cp.x + t * v.x, pz = cp.z + t * v.z;
      inDisc = Math.hypot(px, pz) <= 18000;
      dist = Math.hypot(t * v.x, t * v.y * ratio, t * v.z);
    }
    const expected = inDisc && dist <= farCut;
    if (geom) nGeom++;
    if (occluded) nOcc++;
    if (inDisc) { nDisc++; if (dist > farCut) nBeyond++; }
    if (expected) {
      nExp++;
      if (geom && !occluded) nCov++;
      if (geom && Math.max(Math.abs(a[k] - fog.r), Math.abs(a[k + 1] - fog.g), Math.abs(a[k + 2] - fog.b)) < 0.02) nFog++;
    }
  }
  const h = cam.position.y * ratio;
  return {
    near: cam.near, far: cam.far, displayHeight: h, ratio,
    alt: document.getElementById('ug-readout-alt')?.textContent ?? null,
    geom: nGeom, occluded: nOcc, expected: nExp, inDisc: nDisc,
    occlusionShare: nGeom ? nOcc / nGeom : 0,
    coverage: nExp ? nCov / nExp : null,
    beyondFar: nDisc ? nBeyond / nDisc : 0,
    fogged: nExp ? nFog / nExp : 0,
  };
});

test.describe.configure({ mode: 'serial' });

test('the map fills the frame below the horizon at every altitude and Master', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await boot(page);
  const results = [];
  for (const M of MASTERS) {
    await setMaster(page, M);
    for (const A of HEIGHTS) {
      await placeAltitude(page, A, M);
      const m = await measure(page);
      results.push({ M, A, ...m });
    }
  }
  if (process.env.UG_ALT_OUT) fs.writeFileSync(process.env.UG_ALT_OUT, JSON.stringify(results, null, 2));
  for (const r of results) {
    const tag = `M${r.M} A${r.A} ${JSON.stringify(r)}`;
    // Pose sanity: the altimeter reads A (within 5 percent).
    expect(Number(String(r.alt).replace(/,/g, '')), `pose ${tag}`).toBeGreaterThan(r.A * 0.95);
    expect(Number(String(r.alt).replace(/,/g, '')), `pose ${tag}`).toBeLessThan(r.A * 1.05);
    // (Where no ground is inside the far plane there is nothing to draw: see the far-plane cases.)
    if (r.expected >= 1000) expect(r.geom, tag).toBeGreaterThan(100);
    // The dome never paints over drawn map.
    expect(r.occlusionShare, `occlusion ${tag}`).toBeLessThanOrEqual(0.005);
    // Everything whose ray meets the ground disc inside the far plane is drawn.
    if (r.expected >= 1000) expect(r.coverage, `coverage ${tag}`).toBeGreaterThanOrEqual(0.97);
  }
});
