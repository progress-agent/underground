import { test, expect } from '@playwright/test';

// D-040 (Jordan, 26Sep26s): trade-offs 7 and 8 on. From an above-ground camera
// nothing underground is drawn, including the line ribbons that poked through
// the ground where a line runs at the surface ("there should be no overground
// ribbons for underground lines"). The set is hidden only inside the render
// call, so hover still reaches underground lines through the ground, and the
// whirlpools and Overground station markers, seen from above, stay drawn.
//
// Sprint 30Sep26w (D-041, Lane R): the open-air Tube and DLR are drawn again as
// surface railway, in top-level `surface-rail-<line>` groups with surfaceOnly
// station markers, none of which the cull may hide; the underground look
// (every `line:*` group) stays hidden from above.

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held = []; let lastTs = 0;
    window.requestAnimationFrame = cb => {
      if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
      return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
    };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
  });
  await page.goto('/?fast=1&buildings=baked');
  // The station markers attach AFTER the bake and the whirlpools: the six
  // Overground layers only once the Tube stations have initialised (6 to 11 s
  // after load, measured 30Sep26w), the surface railway's once it has built.
  // Waiting for the bake alone read 0 surfaceOnly markers (the race that failed
  // this spec on c820ea9 on both machines), so the wait includes them.
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0
    && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.economies && window.__ug.scene.getObjectByName('tideway-whirlpools')?.children.length
    && window.__ug.overground?.userData.stationsAttached && window.__ug.surfaceRail?.stationLayers.size > 0
    && [...window.__ug.surfaceRail.stationLayers.values()].every(l => l.stationsLayer.mesh.parent),
  null, { timeout: 180000 });
  await page.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.renderQuality.set({ scale: 1, samples: 4 }); });
});
test.afterAll(async () => { await page?.close(); });

async function pose(p, t, { freeze = true } = {}) {
  await page.evaluate(async ({ p, t, freeze }) => {
    window.__thaw();
    const u = window.__ug; u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
    await new Promise(r => setTimeout(r, 1200));
    if (freeze) { window.__freeze = true; await new Promise(r => setTimeout(r, 80)); window.__step(2); }
  }, { p, t, freeze });
}
const ll = (lat, lon, upM, dx, dz) => page.evaluate(({ lat, lon, upM, dx, dz }) => {
  const u = window.__ug, c = u.llToXZ(lat, lon), g = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
  return { p: [c.x + dx, g(c.x + dx, c.z + dz) + upM * 5, c.z + dz], t: [c.x, g(c.x, c.z), c.z] };
}, { lat, lon, upM, dx, dz });

test('above ground the underground set is left undrawn, and restored between frames', async () => {
  await pose([2952.9, 337.8, -732.9], [1910.1, 196.2, -783.7]); // street near Bank
  const s = await page.evaluate(() => {
    const u = window.__ug;
    const lines = u.scene.children.filter(c => c.name?.startsWith('line:'));
    return { above: u.aboveGroundView, ...u.undergroundCull.status, lines: lines.length, allVisible: lines.every(l => l.visible) };
  });
  expect(s.above).toBe(true);
  expect(s.active).toBe(true);
  expect(s.hidden).toBeGreaterThanOrEqual(s.lines + 5); // every line, plus underside, geology x2, crossrail, sewers...
  expect(s.allVisible).toBe(true); // hidden only inside the render call
});

test('underground and in the river everything is drawn', async () => {
  await pose([-194.2, -39, -2162.8], [-988.5, 9, -1557.1]); // the opening's landing, below ground
  expect(await page.evaluate(() => [window.__ug.aboveGroundView, window.__ug.undergroundCull.status.hidden])).toEqual([false, 0]);
  // In the water off Greenwich (the standard river view's target, under the surface).
  await pose([7156, 4, 635.4], [7356, 4, 635.4]);
  expect(await page.evaluate(() => [window.__ug.aboveGroundView, window.__ug.undergroundCull.status.hidden])).toEqual([false, 0]);
});

test('the whirlpools and the surface station markers are never in the set', async () => {
  const c = await page.evaluate(() => {
    const u = window.__ug, set = u.undergroundCull.collect();
    const whirl = u.scene.getObjectByName('tideway-whirlpools');
    const surfaceMarkers = u.scene.children.filter(o => o.userData?.kind === 'station-markers' && o.userData.surfaceOnly);
    const overgroundIds = u.overground.userData.stationSets.map(s => s.id);
    const overgroundMarkers = overgroundIds.map(id => u.lineShaftLayers.get(id)?.stationsLayer.mesh);
    const railMarkers = [...u.surfaceRail.stationLayers.values()].map(l => l.stationsLayer.mesh);
    return { whirlIn: set.includes(whirl) || set.some(o => o === whirl?.parent), surface: surfaceMarkers.length, surfaceIn: surfaceMarkers.some(m => set.includes(m)),
      overground: overgroundMarkers.filter(m => m?.userData.surfaceOnly && surfaceMarkers.includes(m)).length,
      rail: railMarkers.filter(m => m.userData.surfaceOnly && surfaceMarkers.includes(m)).length, railLayers: u.surfaceRail.stationLayers.size,
      tubeMarkersIn: set.filter(o => o.userData?.kind === 'station-markers').length };
  });
  expect(c.whirlIn).toBe(false);
  // Was a single pin of 6 (the six Overground layers). The six are pinned as
  // before; D-041 adds one surfaceOnly layer per Tube or DLR line with an
  // open-air station of its own, one marker per station (nine: not the
  // Victoria or the Waterloo & City, wholly in tunnel, nor the Hammersmith &
  // City, whose open-air stops are all Circle, District or Metropolitan stops
  // too), and the total is exactly the two.
  expect(c.overground).toBe(6);
  expect(c.rail).toBe(c.railLayers);
  expect(c.railLayers).toBe(9);
  expect(c.surface).toBe(6 + 9);
  expect(c.surfaceIn).toBe(false);
  expect(c.tubeMarkersIn).toBeGreaterThanOrEqual(12);
});

test('from above ground, hover still reads the station below', async () => {
  const oc = await page.evaluate(() => { const c = window.__ug.llToXZ(51.515224, -0.141903); return [c.x, c.z]; });
  await pose([oc[0] + 20, 3000, oc[1] + 400], [oc[0], 0, oc[1]], { freeze: false });
  const at = await page.evaluate(() => {
    const u = window.__ug, st = u.lineShaftLayers.get('central').stationsLayer.stations.find(s => /Oxford Circus/.test(s.name));
    const s = st.pos.clone().project(u.camera);
    return { x: (s.x + 1) / 2 * innerWidth, y: (1 - s.y) / 2 * innerHeight, above: u.aboveGroundView, active: u.undergroundCull.status.active };
  });
  expect(at.above && at.active).toBe(true);
  await page.mouse.move(at.x + 50, at.y + 50); await page.waitForTimeout(150);
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => page.evaluate(() => document.getElementById('hoverTip')?.textContent ?? ''), { timeout: 5000 }).toMatch(/Oxford Circus/);
});

// D-040 approved the teal DLR ribbon at Mudchute vanishing from above; on
// 27Sep26u Jordan asked for the DLR back as surface railway (D-041 item 2).
// At the same pose: the underground look is still left undrawn above ground
// (the cull changes pixels, as before, within the same bounds), and the DLR is
// now drawn there by its surface railway (its group changes pixels too).
test('at Mudchute from above ground, the DLR ribbon stays undrawn and the DLR surface railway is drawn', async () => {
  const m = await ll(51.4906, -0.0147, 30, -300, 200);
  await pose(m.p, m.t);
  const r = await page.evaluate(() => {
    const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
    const rail = u.scene.getObjectByName('surface-rail-dlr');
    const grab = (on, railOn = true) => { u.economies.set('underAbove', on); rail.visible = railOn; window.__step(2); u.undergroundCull.render(u.aboveGroundView && on, () => u.composer.render(0)); rr.setRenderTarget(null);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); rail.visible = true; return b; };
    const diff = (A, B) => { let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 2) n++; return n / (A.length / 4) * 100; };
    const off = grab(false), on = grab(true), noRail = grab(true, false);
    return { cullPct: diff(off, on), railPct: diff(on, noRail), above: u.aboveGroundView, railIsTop: rail.parent === u.scene, railCulled: u.undergroundCull.collect().includes(rail) };
  });
  expect(r.above).toBe(true);
  expect(r.cullPct).toBeGreaterThan(0.05);
  expect(r.cullPct).toBeLessThan(3);
  expect(r.railIsTop).toBe(true);
  expect(r.railCulled).toBe(false);
  expect(r.railPct).toBeGreaterThan(0.05);
});
