// infra-transparency.spec.js — angle- and distance-consistent underground
// feature visibility (10Jul26f transparency pass, diag in
// Working/polish-10Jul26f/diag-transparency/).
//
// Guards four things:
//   1. Angle-stable materials: every crossrail/tideway/lee/sewer tunnel wall
//      is FrontSide + depthWrite:true (exactly one wall layer composites at
//      every angle — the old DoubleSide read opaque axially, ghost broadside);
//      glow shells are depthWrite:false; no transmission on Tideway/Lee shafts.
//   2. Infra haze regimes: strength ~1 underground in clay, 0 inside chalk
//      (the chalk perfect-clarity contract) and 0 at altitude.
//   3. Crossrail stays VISIBLE at 4000m broadside (the old alpha fade erased
//      it: 0.11% toggle footprint; the haze keeps >0.4% with strong contrast).
//   4. Tideway reads with real contrast broadside over the chalk floor at
//      400m (was a ghost wash: meanDelta 24; factory emissive lift gives >45).
//
// Toggle-footprint technique: screenshot, hide the group, screenshot, count
// changed pixels — same probe as the diagnosis, so numbers are comparable.

import { test, expect } from '@playwright/test';

const GROUPS = ['crossrail-tunnel', 'tideway-system', 'sewer-tunnels'];

async function gotoLoaded(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug && window.__ug.scene
      && ['crossrail-tunnel', 'tideway-system', 'sewer-tunnels']
        .every(n => !!window.__ug.scene.getObjectByName(n)),
    null, { timeout: 90000 }
  );
  await page.waitForTimeout(3000);
}

// World-space midpoint + local direction of a named tube mesh (or the first
// TubeGeometry child of a named group) — mirrors the diagnosis capture probe.
function describeFeature(page, name) {
  return page.evaluate((nm) => {
    const scene = window.__ug.scene;
    let mesh = scene.getObjectByName(nm);
    if (mesh && !mesh.isMesh) mesh = mesh.children.find(c => c.geometry?.type === 'TubeGeometry');
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const p = mesh.geometry.attributes.position;
    const e = mesh.matrixWorld.elements;
    const wp = (i) => {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      return [e[0] * x + e[4] * y + e[8] * z + e[12],
              e[1] * x + e[5] * y + e[9] * z + e[13],
              e[2] * x + e[6] * y + e[10] * z + e[14]];
    };
    const mid = wp(Math.floor(p.count * 0.5));
    const midB = wp(Math.floor(p.count * 0.52));
    return { mid, dir: [midB[0] - mid[0], midB[1] - mid[1], midB[2] - mid[2]] };
  }, name);
}

function placeCamera(page, pos, target) {
  return page.evaluate(({ pos, target }) => {
    const ug = window.__ug;
    ug.fpsControls.enabled = false;
    ug.camera.position.set(pos[0], pos[1], pos[2]);
    ug.controls.target.set(target[0], target[1], target[2]);
    ug.controls.update();
  }, { pos, target });
}

// Pixel footprint of a group at the current pose: % of (downsampled) pixels
// that change when the group is hidden, and their mean |rgb| delta.
async function toggleFootprint(page, groupName) {
  const shotA = (await page.screenshot()).toString('base64');
  await page.evaluate((n) => { window.__ug.scene.getObjectByName(n).visible = false; }, groupName);
  await page.waitForTimeout(250);
  const shotB = (await page.screenshot()).toString('base64');
  await page.evaluate((n) => { window.__ug.scene.getObjectByName(n).visible = true; }, groupName);
  await page.waitForTimeout(150);
  return page.evaluate(async ({ a64, b64 }) => {
    const load = (b) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = 'data:image/png;base64,' + b;
    });
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    const W = 400, H = 250;
    const px = (img) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const a = px(ia), b = px(ib);
    let changed = 0, sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 12) { changed++; sum += d; }
    }
    return { changedPct: 100 * changed / (a.length / 4), meanDelta: changed ? sum / changed : 0 };
  }, { a64: shotA, b64: shotB });
}

const norm = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };

test('infra materials are angle-stable (FrontSide walls, no-depth glows, no transmission)', async ({ page }) => {
  await gotoLoaded(page);
  const report = await page.evaluate((groups) => {
    const out = [];
    for (const g of groups) {
      const grp = window.__ug.scene.getObjectByName(g);
      grp.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        if (o.geometry?.type === 'TubeGeometry') {
          out.push({
            group: g, name: o.name || o.userData?.name || 'tube',
            kind: m.type === 'MeshBasicMaterial' ? 'glow' : 'wall',
            side: m.side, depthWrite: m.depthWrite,
            transmission: m.transmission ?? 0, fog: m.fog,
          });
        } else if (o.geometry?.type === 'CylinderGeometry') {
          out.push({
            group: g, name: o.name, kind: 'shaft',
            side: m.side, depthWrite: m.depthWrite,
            transmission: m.transmission ?? 0, fog: m.fog,
          });
        }
      });
    }
    return out;
  }, GROUPS);

  expect(report.length).toBeGreaterThan(10);
  for (const r of report) {
    expect(r.side, `${r.group}/${r.name} must be FrontSide`).toBe(0); // THREE.FrontSide
    expect(r.transmission, `${r.group}/${r.name} must not use transmission`).toBe(0);
    expect(r.fog, `${r.group}/${r.name} must stay fog-aware`).toBe(true);
    if (r.kind === 'glow') {
      expect(r.depthWrite, `${r.group}/${r.name} glow must not write depth`).toBe(false);
    } else {
      expect(r.depthWrite, `${r.group}/${r.name} ${r.kind} must write depth`).toBe(true);
    }
  }
});

test('infra haze: ~1 underground in clay, 0 inside chalk, 0 at altitude', async ({ page }) => {
  await gotoLoaded(page);

  // Clay underground (well below surface, above the chalk).
  await placeCamera(page, [0, -150, 0], [500, -150, 0]);
  await page.waitForTimeout(400);
  const clay = await page.evaluate(() => window.__ug.infraHazeStrength);
  expect(clay).toBeGreaterThan(0.9);

  // Inside chalk: the perfect-clarity contract — haze must release entirely.
  await page.evaluate(() => {
    const u = window.__ug;
    const cs = u.getChalkSurfaceY(0, 0);
    u.camera.position.set(0, cs - 60, 0);
    u.controls.target.set(500, cs - 60, 0);
    u.controls.update();
  });
  await page.waitForFunction(() => window.__ug.chalkClarity > 0.95, null, { timeout: 5000 });
  const chalk = await page.evaluate(() => window.__ug.infraHazeStrength);
  expect(chalk).toBeLessThan(0.05);

  // High altitude: haze irrelevant above ground — must be off.
  await placeCamera(page, [0, 3000, 0], [500, 0, 0]);
  await page.waitForTimeout(400);
  const air = await page.evaluate(() => window.__ug.infraHazeStrength);
  expect(air).toBeLessThan(0.05);
});

test('crossrail stays visible at 4000m broadside (alpha-fade regression)', async ({ page }) => {
  await gotoLoaded(page);
  const f = await describeFeature(page, 'crossrail-tunnel');
  expect(f).not.toBeNull();
  const P = f.mid, D = norm(f.dir), X = [-D[2], 0, D[0]];
  await placeCamera(page, [P[0] + X[0] * 4000, P[1] + 100, P[2] + X[2] * 4000], P);
  await page.waitForTimeout(600);
  const fp = await toggleFootprint(page, 'crossrail-tunnel');
  // Old alpha fade: 0.06-0.11% (invisible). Haze keeps the line legible —
  // measured 0.95% @ meanDelta 70 on 10Jul26f; thresholds allow pose jitter.
  expect(fp.changedPct).toBeGreaterThan(0.4);
  expect(fp.meanDelta).toBeGreaterThan(30);
});

test('tideway reads broadside over the chalk floor at 400m (contrast floor)', async ({ page }) => {
  await gotoLoaded(page);
  const f = await describeFeature(page, 'tideway-tunnel-ec');
  expect(f).not.toBeNull();
  const P = f.mid, D = norm(f.dir), X = [-D[2], 0, D[0]];
  await placeCamera(page, [P[0] + X[0] * 400, P[1] + 30, P[2] + X[2] * 400], P);
  await page.waitForTimeout(600);
  const fp = await toggleFootprint(page, 'tideway-system');
  // Ghost-wash baseline: 3.9% @ meanDelta 24. Factory emissive lift measured
  // 3.8% @ meanDelta 72 — assert the CONTRAST, which is what the eye lost.
  expect(fp.changedPct).toBeGreaterThan(1.5);
  expect(fp.meanDelta).toBeGreaterThan(45);
});
