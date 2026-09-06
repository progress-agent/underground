// measure-baked.mjs — live vs baked buildings, in ONE browser session.
//
// Usage: node scripts/measure-baked.mjs <outDir>   (dev server must be running)
//
// WHY ONE SESSION. Two visits to the same camera coordinates do not produce the
// same frame: OrbitControls.update() runs even with controls disabled and
// settles differently per run, and the machine's own speed drifts by ~30%
// between sittings (measured 05Sep26s: identical commit, 33.5 fps then 23.7
// hours later). Absolute numbers from different sittings are not comparable.
// Ratios inside one sitting are. So the path is flipped in place, mid-session.
//
// WHAT THE FLIGHT MEASURES. The stutter this work exists to remove is a
// per-tile-arrival cost paid on the main thread while flying. Steady-state fps
// at a fixed pose cannot see it — the still frame was always fine. So each path
// flies the same 40km line from a COLD tile state (camera parked 60km out until
// everything exceeds UNLOAD_RADIUS) and every frame delta is recorded.
//
// The baked path still rasterises parks and roads on arrival, because that half
// of the compiler does not exist yet. The gap between the two flights is
// therefore the BUILDING share of the arrival cost specifically, and whatever
// stutter survives in the baked flight is the size of the remaining job.

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const outDir = process.argv[2] || '/tmp/baked-perf';
await mkdir(outDir, { recursive: true });

const POSES = {
  overview:    { cam: [0, 20000, 12000], tgt: [0, 0, 0] },
  street:      { cam: [0, 60, 800],      tgt: [0, 40, 0] },
  underground: { cam: [0, -120, 700],    tgt: [0, -160, 0] },
};

// West-to-east across the whole city at low altitude, which is where building
// overdraw and tile churn both bite.
const FLIGHT = { from: [-22000, 900, 0], to: [18000, 900, 0], ms: 15000 };

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (/Baked buildings|baked payload/i.test(m.text())) console.log('  [page]', m.text()); });

await page.goto('http://localhost:5173/?buildings=live&fast=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#loadingBar')?.classList.contains('done'), { timeout: 90000 });
await page.waitForFunction(() => window.__ug?.camera && window.__ug?.controls, { timeout: 30000 });
await page.waitForTimeout(6000);

const setPose = async (cam, tgt) => {
  await page.evaluate(({ cam, tgt }) => {
    const { camera, controls } = window.__ug;
    controls.target.set(...tgt);
    camera.position.set(...cam);
    controls.update();
    camera.updateMatrixWorld(true);
  }, { cam, tgt });
  await page.waitForTimeout(2500);
};

// A "steady-state pose" measured while tiles are still arriving is not steady
// state: the first run of this harness reported p95 = 125ms and 15 frames over
// 50ms at a MOTIONLESS overview camera, which is tile churn, not draw cost.
// Sample only once the loader has stopped: nothing in flight and the loaded
// count unchanged across three consecutive checks.
async function awaitQuiescence(label, timeoutMs = 60000) {
  const t0 = Date.now();
  let stable = 0, prev = -1;
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => window.__ug.surfaceLoaderStats);
    if (st.loading === 0 && st.loaded === prev) stable++; else stable = 0;
    prev = st.loaded;
    if (stable >= 3) return { quiesced: true, waitedMs: Date.now() - t0, tiles: st.loaded };
    await page.waitForTimeout(700);
  }
  console.warn(`  ! ${label}: loader never settled in ${timeoutMs}ms — sample is contaminated`);
  return { quiesced: false, waitedMs: Date.now() - t0, tiles: prev };
}

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  return {
    frames: s.length,
    fps: +(1000 / (s.reduce((t, v) => t + v, 0) / s.length)).toFixed(1),
    p50: +at(0.50).toFixed(1), p95: +at(0.95).toFixed(1), p99: +at(0.99).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    over33: s.filter(v => v > 33.4).length,   // a dropped frame at 30fps
    over50: s.filter(v => v > 50).length,     // visible hitch
  };
};

const sampleFrames = (ms) => page.evaluate((dur) => new Promise((res) => {
  const out = []; let last = performance.now(); const t0 = last;
  const tick = (now) => { out.push(now - last); last = now;
    if (now - t0 < dur) requestAnimationFrame(tick); else { out.shift(); res(out); } };
  requestAnimationFrame(tick);
}), ms);

// renderer.info.render describes only the LAST render call, which is the
// composer's fullscreen output pass — 1 draw, 1 triangle, always. It cannot
// answer "how much more is being drawn". Test the building meshes against the
// live camera frustum instead, which is the actual question behind the
// distant-buildings look decision.
const sceneInfo = () => page.evaluate(() => {
  const { camera } = window.__ug;
  const T = window.__ugTHREE;
  const g = window.__ug.surfaceGeometryGroup;
  let meshes = 0, visibleMeshes = 0, resident = 0, visibleInstances = 0;
  if (g) {
    const proj = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new T.Frustum().setFromProjectionMatrix(proj);
    const sphere = new T.Sphere();
    g.traverse((o) => {
      if (!o.isInstancedMesh || !o.name) return;
      if (!o.name.startsWith('buildings-') && !o.name.startsWith('baked-buildings-')) return;
      meshes++; resident += o.count;
      if (o.boundingSphere === null) o.computeBoundingSphere();
      sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
      if (frustum.intersectsSphere(sphere)) { visibleMeshes++; visibleInstances += o.count; }
    });
  }
  return {
    buildingsResident: resident,
    buildingMeshes: meshes,
    meshesInFrustum: visibleMeshes,
    instancesInFrustum: visibleInstances,
    tiles: window.__ug.surfaceLoaderStats,
  };
});

// Park the camera beyond UNLOAD_RADIUS until every tile is surrendered, so both
// flights start from the same cold state rather than one inheriting the other's
// resident tiles.
async function coldStart() {
  await page.evaluate(() => window.__ug.camera.position.set(60000, 3000, 60000));
  await page.waitForTimeout(3500);
}

async function flight() {
  await coldStart();
  await setPose(FLIGHT.from, [FLIGHT.to[0], 0, FLIGHT.to[2]]);
  await page.evaluate(() => window.__ug.clearArrivalCosts());
  const deltas = await page.evaluate(({ from, to, ms }) => new Promise((res) => {
    const { camera, controls } = window.__ug;
    const out = []; let last = performance.now(); const t0 = last;
    const tick = (now) => {
      out.push(now - last); last = now;
      const k = Math.min(1, (now - t0) / ms);
      camera.position.set(from[0] + (to[0] - from[0]) * k, from[1], from[2] + (to[2] - from[2]) * k);
      controls.target.set(camera.position.x + 500, 0, camera.position.z);
      controls.update(); camera.updateMatrixWorld(true);
      if (k < 1) requestAnimationFrame(tick); else { out.shift(); res(out); }
    };
    requestAnimationFrame(tick);
  }), FLIGHT);

  // Attribute what the arrivals cost on the main thread during that flight.
  const costs = await page.evaluate(() => window.__ug.arrivalCosts);
  const sum = (k) => costs.reduce((t, c) => t + c[k], 0);
  const top = (k) => costs.map(c => c[k]).sort((a, b) => b - a);
  return {
    ...stats(deltas),
    arrivals: {
      tiles: costs.length,
      rasteriseTotalMs: +sum('rasteriseMs').toFixed(0),
      buildingsTotalMs: +sum('buildingsMs').toFixed(0),
      rasteriseWorstMs: +(top('rasteriseMs')[0] ?? 0).toFixed(1),
      buildingsWorstMs: +(top('buildingsMs')[0] ?? 0).toFixed(1),
    },
  };
}

async function runPath(label) {
  const r = { poses: {}, };
  for (const [name, p] of Object.entries(POSES)) {
    await setPose(p.cam, p.tgt);
    const settle = await awaitQuiescence(`${label}/${name}`);
    r.poses[name] = { ...stats(await sampleFrames(4000)), ...(await sceneInfo()), settle };
    await page.screenshot({ path: `${outDir}/${label}-${name}.png` });
  }
  r.flight = await flight();
  await page.screenshot({ path: `${outDir}/${label}-flight-end.png` });
  return r;
}

// The third per-arrival cost, and the one neither path avoids: Response.json()
// on a tile. Mean tile is ~1MB and the largest is 8.26MB, and that parse lands
// on the main thread. Measured here on real tiles rather than instrumented in
// the loader, because splitting text()/JSON.parse() inside the live path would
// fork dev behaviour from production.
console.log('measuring tile JSON parse cost...');
const parseCost = await page.evaluate(async () => {
  const man = await (await fetch('/data/surface/tiles/manifest.json')).json();
  const pick = [0, Math.floor(man.tiles.length / 3), Math.floor(man.tiles.length / 2),
                Math.floor(man.tiles.length * 0.75), man.tiles.length - 1];
  const rows = [];
  for (const i of pick) {
    const f = man.tiles[i].file;
    const txt = await (await fetch(`/data/surface/tiles/${f}`)).text();
    const t0 = performance.now();
    JSON.parse(txt);
    rows.push({ file: f, mb: +(txt.length / 1048576).toFixed(2), parseMs: +(performance.now() - t0).toFixed(1) });
  }
  return rows;
});
console.log('  ' + JSON.stringify(parseCost));

console.log('measuring LIVE path...');
const live = await runPath('live');

console.log('switching to BAKED (same session)...');
const tSwitch = Date.now();
await page.evaluate(() => window.__ug.setBuildingsPath('baked'));
await page.waitForFunction(() => window.__ug.bakedStats?.tilesBuilt >= window.__ug.bakedStats?.tilesTotal, { timeout: 120000 });
const switchMs = Date.now() - tSwitch;
const bakedStats = await page.evaluate(() => window.__ug.bakedStats);

console.log('measuring BAKED path...');
const baked = await runPath('baked');

const report = {
  measuredAt: new Date().toISOString(),
  note: 'One session, path flipped in place. Absolute fps is machine- and sitting-specific; the live/baked RATIO is the comparable quantity.',
  bakedPayload: { ...bakedStats, wallClockToResidentMs: switchMs },
  tileJsonParseCost: parseCost,
  live, baked,
  ratios: {
    overviewFps: +(baked.poses.overview.fps / live.poses.overview.fps).toFixed(3),
    streetFps: +(baked.poses.street.fps / live.poses.street.fps).toFixed(3),
    undergroundFps: +(baked.poses.underground.fps / live.poses.underground.fps).toFixed(3),
    flightP99: +(baked.flight.p99 / live.flight.p99).toFixed(3),
    buildingsAtOverview: +(baked.poses.overview.buildingsResident / live.poses.overview.buildingsResident).toFixed(2),
  },
};
await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
