import { test, expect } from '@playwright/test';

// Sprint 01Oct26h, Lane R, fix round 1 (D-043 item 5: open-air stations show
// their marker from above). Live buildings are the app's default path
// (main.js: "LIVE IS THE DEFAULT"): tiles stream in by camera proximity and
// are disposed beyond it. Round 1's roof lift stopped polling after 15 s with
// no new tile, so a station whose tile arrived later stayed sealed inside its
// station building's box; the verifier found Wembley Park, Hillingdon and
// Ealing Broadway so (01Oct26h). surface-rail.spec.js reads the baked path;
// this one runs the default path the way a visitor does: let the opening
// settle, then fly to each station and let its tile arrive.

test.describe.configure({ mode: 'serial' });
test.setTimeout(420000);

// Stations with a building box over their marker in the live tiles, all well
// outside the tiles the opening loads (LOAD_RADIUS 12 km from the start).
const LATE = [['surface:jubilee', 'Wembley Park'], ['surface:metropolitan', 'Hillingdon'], ['surface:central', 'Ealing Broadway']];

let page;
const trackY = {}; // each LATE marker's height before its tile arrived: on its track
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('/?fast=1&buildings=live&mh=1.1');
  await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.surfaceRail?.stationLayers.size > 0
    && window.__ug.overground?.userData.stationsAttached && !!window.__ug.surfaceRail.roofLift, null, { timeout: 240000 });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
});
test.afterAll(async () => { await page?.close(); });

/** Is a building box within reach of the marker, and does the marker stand over every one? (true metres, scene units) */
async function markerState(key, name) {
  return page.evaluate(({ key, name }) => {
    const u = window.__ug, col = u.modes.collision;
    const st = u.surfaceRail.stationLayers.get(key).stationsLayer.mesh.userData.stations.find(s => s.name.startsWith(name));
    col.sync();
    const boxes = col.buildingsNear(st.pos.x, st.pos.z, 2);
    const roofY = boxes.length ? Math.max(...boxes.map(b => b.roofY)) : null;
    return { boxes: boxes.length, roofY, y: st.pos.y, roofM: st.roofM ?? 0, over: roofY === null || st.pos.y > roofY };
  }, { key, name });
}

test('live: a station whose building tile arrives after the opening has settled has its marker lifted over the roof, seen from above', async () => {
  // Settle: no building tile arrives or leaves for 20 s (round 1 stopped after 15).
  const settled = await page.evaluate(async () => {
    const u = window.__ug, count = () => u.scene.getObjectByName('surfaceGeometry').children.filter(m => m.name?.startsWith('buildings-')).length;
    let last = count(), since = performance.now(); const t0 = since;
    while (performance.now() - since < 20000 && performance.now() - t0 < 200000) {
      await new Promise(r => setTimeout(r, 500)); const n = count(); if (n !== last) { last = n; since = performance.now(); }
    }
    return { meshes: last, quietMs: performance.now() - since, passes: u.surfaceRail.roofLift.passes };
  });
  console.log('settled', JSON.stringify(settled));
  expect(settled.quietMs).toBeGreaterThanOrEqual(20000);
  // None of the three stations' tiles has arrived yet: each arrives after the
  // quiet 20 s (the case round 1 missed), on the flight to it or to the one before.
  const before = {};
  for (const [key, name] of LATE) {
    before[name] = await markerState(key, name);
    expect(before[name].boxes, `${name}: its tile is not loaded once the opening has settled`).toBe(0);
    trackY[name] = before[name].y;
  }

  for (const [key, name] of LATE) {
    await page.evaluate(({ key, name }) => {
      const u = window.__ug, st = u.surfaceRail.stationLayers.get(key).stationsLayer.mesh.userData.stations.find(s => s.name.startsWith(name));
      const p = st.pos, g = u.getTerrainMeshSurfaceY({ x: p.x, z: p.z });
      u.camera.position.set(p.x - 150, g + 110 * 5, p.z + 260); u.controls.target.set(p.x, g, p.z); u.controls.update();
    }, { key, name });
    // Its tile arrives, then the poll (every 0.5 s) lifts the marker over the box.
    await page.waitForFunction(({ key, name }) => {
      const u = window.__ug, col = u.modes.collision;
      const st = u.surfaceRail.stationLayers.get(key).stationsLayer.mesh.userData.stations.find(s => s.name.startsWith(name));
      col.sync(); const boxes = col.buildingsNear(st.pos.x, st.pos.z, 2);
      return boxes.length > 0 && boxes.every(b => st.pos.y > b.roofY);
    }, { key, name }, { timeout: 120000, polling: 500 });
    const after = await markerState(key, name);
    expect(after.roofM, `${name}: lifted for the roof over it`).toBeGreaterThan(0);
    expect(after.over, name).toBe(true);

    // Seen from above, the cull as the app runs it: pixels the marker changes.
    const r = await page.evaluate(async ({ key, name }) => {
      const u = window.__ug, T = window.__ugTHREE, rr = u.composer.renderer, gl = rr.getContext();
      const layer = u.surfaceRail.stationLayers.get(key).stationsLayer.mesh, i = layer.userData.stations.findIndex(s => s.name.startsWith(name));
      const p = layer.userData.stations[i].pos, g = u.getTerrainMeshSurfaceY({ x: p.x, z: p.z });
      u.camera.position.set(p.x, g + 250 * 5, p.z + 300); u.controls.target.set(p.x, p.y, p.z); u.controls.update();
      await new Promise(r => setTimeout(r, 600));
      const grab = () => { u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0)); rr.setRenderTarget(null);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return { b, W, H }; };
      const A = grab();
      const m = new T.Matrix4(); layer.getMatrixAt(i, m); const away = m.clone(); away.setPosition(0, -1e6, 0); layer.setMatrixAt(i, away); layer.instanceMatrix.needsUpdate = true;
      const B = grab(); layer.setMatrixAt(i, m); layer.instanceMatrix.needsUpdate = true;
      const v = new T.Vector3(p.x, p.y, p.z).project(u.camera), sx = Math.round((v.x + 1) / 2 * A.W), sy = Math.round((v.y + 1) / 2 * A.H);
      let px = 0; for (let y = Math.max(0, sy - 40); y < Math.min(A.H, sy + 40); y++) for (let x = Math.max(0, sx - 40); x < Math.min(A.W, sx + 40); x++) { const k = (y * A.W + x) * 4; if (Math.abs(A.b[k] - B.b[k]) + Math.abs(A.b[k + 1] - B.b[k + 1]) + Math.abs(A.b[k + 2] - B.b[k + 2]) > 6) px++; }
      return { px, surfaceOnly: layer.userData.surfaceOnly, culled: u.undergroundCull.collect().includes(layer), above: u.aboveGroundView };
    }, { key, name });
    console.log(name, JSON.stringify({ before: before[name], after, ...r }));
    expect(r.surfaceOnly, name).toBe(true);
    expect(r.culled, name).toBe(false);
    expect(r.above, name).toBe(true);
    expect(r.px, `${name}: marker pixels from above`).toBeGreaterThan(150);
  }

  // No surface marker stands inside a loaded building box, wherever the camera has been.
  const r = await page.evaluate(() => {
    const u = window.__ug, col = u.modes.collision; col.sync(); let underRoof = 0, n = 0;
    for (const l of u.surfaceRail.stationLayers.values()) for (const s of l.stationsLayer.mesh.userData.stations) {
      n++; const roof = col.roofHeightAt(s.pos.x, s.pos.z); if (roof !== null && roof > s.pos.y) underRoof++;
    }
    return { underRoof, n, lift: u.surfaceRail.roofLift };
  });
  console.log('all markers', JSON.stringify(r));
  expect(r.underRoof).toBe(0);
  expect(r.lift.passes).toBeGreaterThan(settled.passes);
});

test('live: a marker returns to its track when the buildings go, and rises again when they are back', async () => {
  const [key, name] = LATE[1]; // Hillingdon: the camera left it last but one; its tile is still loaded (UNLOAD_RADIUS 18 km)
  const lifted = await markerState(key, name);
  expect(lifted.roofM).toBeGreaterThan(0);
  // Buildings off: the collision service reads no mesh, and the markers come down.
  await page.evaluate(() => { window.__ug.scene.getObjectByName('surfaceGeometry').visible = false; });
  await page.waitForFunction(() => window.__ug.surfaceRail.roofLift.roofed === 0, null, { timeout: 10000, polling: 250 });
  const down = await markerState(key, name);
  expect(down.roofM).toBe(0);
  expect(down.y).toBeCloseTo(trackY[name], 3); // where it stood before its tile arrived
  expect(down.y).toBeLessThan(lifted.y);
  // Buildings back: lifted again.
  await page.evaluate(() => { window.__ug.scene.getObjectByName('surfaceGeometry').visible = true; });
  await page.waitForFunction(() => window.__ug.surfaceRail.roofLift.roofed > 0, null, { timeout: 10000, polling: 250 });
  const up = await markerState(key, name);
  expect(up.roofM).toBeCloseTo(lifted.roofM, 3);
  expect(up.y).toBeCloseTo(lifted.y, 3);
  expect(up.over).toBe(true);
});
