// beyond-edge-s14.spec.js: lane F of sprint 14Oct26w (D-053 item 9), the 04Oct26u report's map issues beyond the M25 edge.
//
// Beyond the ring the ground is hidden (lane T of 02Oct26f), so two things the ground used to hide leaked:
//   shafts    Epping's glass shaft hung under its white building in the open and Amersham's stood beside it, seen from above;
//   skirt     from a bore, the surface railway overhead (ballast, skirts, deck) showed as a large near-black band.
// The fix restores the separation at the hidden ground, inside the render call, with the existing cull (D-040: never a layer mask):
//   'lines' mode also hides the glass-shaft group; a new 'below' mode hides the beyond-edge surface railway from a camera below
//   the hidden ground. And Chesham's branch, drawn broadside to the camera from the report's pose, fell under a pixel at 7 to 9 km
//   where Amersham's ran along it: beyond the edge the track also gets a line of at least 1.5 CSS pixels (tube-surface-rail.js).
// Self-contained: no second server. The comparisons are between renders of the same page with one object hidden.

import { test, expect } from '@playwright/test';

test.setTimeout(300000);

const ST = { epping: [51.69368, 0.113767], theydon: [51.671759, 0.103085], chalfont: [51.667985, -0.560689], amersham: [51.674126, -0.607714], chesham: [51.705208, -0.611247] };
const SH = 'kind:unified-shafts';
const errors = [];
let page;

const FREEZE = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const held = []; let lastTs = 0;
  window.requestAnimationFrame = cb => {
    if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; }
    return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); });
  };
  window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
  window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
};
const READY = () => {
  const u = window.__ug;
  return !!(u?.bakedStats?.tilesTotal > 0 && u.bakedStats.tilesBuilt === u.bakedStats.tilesTotal && u.groundReady && u.economies
    && u.surfaceRail?.stationLayers.size > 0 && u.surfaceTrains && u.overground?.userData.linePaths && u.overground.userData.stationsAttached
    && (!u.termini || u.termini.corridor.ready));
};

test.beforeAll(async ({ browser }, info) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(FREEZE);
  await page.goto(`${info.project.use.baseURL ?? 'http://localhost:5266'}/?fast=1&buildings=baked&mh=1.1`);
  await page.waitForFunction(READY, null, { timeout: 240000 });
  await page.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.renderQuality.set({ scale: 1, samples: 4 }); window.__ug.sim.paused = true; });
});
test.afterAll(async () => { await page?.close(); });

async function pose(p, t) {
  await page.evaluate(async ({ p, t }) => {
    window.__thaw();
    const u = window.__ug; u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
    await new Promise(r => setTimeout(r, 1200));
    window.__freeze = true; await new Promise(r => setTimeout(r, 80)); window.__step(2);
  }, { p, t });
}
const thaw = () => page.evaluate(() => window.__thaw());

/** The scene as the app draws it, with `hide` objects hidden (names, or 'kind:<userData.kind>'; trains and clouds always), read back in the same task. */
const PIXELS = ({ hide, mode }) => {
  const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
  const toHide = [];
  for (const n of hide) {
    if (n.startsWith('kind:')) { for (const c of u.scene.children) if (c.userData?.kind === n.slice(5)) toHide.push(c); }
    else { const o = u.scene.getObjectByName(n); if (o) toHide.push(o); }
  }
  const all = [...toHide, ...[u.surfaceTrains?.group, u.scene.getObjectByName('clouds')].filter(Boolean)], saved = all.map(o => o.visible);
  for (const o of all) o.visible = false;
  const m = mode === 'app' ? (u.economies.on('underAbove') ? u.termini.regime.cullMode : false) : mode;
  u.undergroundCull.render(m, () => u.composer.render(0));
  rr.setRenderTarget(null);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
  all.forEach((o, i) => { o.visible = saved[i]; });
  let s = ''; const CH = 0x8000; for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return { W, H, hid: toHide.length, bytes: btoa(s) };
};
const px = async (hide, mode = 'app') => { const r = await page.evaluate(PIXELS, { hide, mode }); return { ...r, buf: Buffer.from(r.bytes, 'base64') }; };
const differ = (a, b, tol = 2, rows = null) => {
  let n = 0, N = 0; const [y0, y1] = rows ?? [0, a.H];
  for (let y = y0; y < y1; y++) for (let x = 0; x < a.W; x++) { const i = (y * a.W + x) * 4; N++; if (Math.max(Math.abs(a.buf[i] - b.buf[i]), Math.abs(a.buf[i + 1] - b.buf[i + 1]), Math.abs(a.buf[i + 2] - b.buf[i + 2])) > tol) n++; }
  return n / N;
};
const stationAt = ll => page.evaluate(([lat, lon]) => { const u = window.__ug, c = u.llToXZ(lat, lon); return { x: c.x, z: c.z, g: u.termini.hiddenGround.terrainY(c.x, c.z) }; }, ll);
const state = () => page.evaluate(() => { const u = window.__ug; return { cull: u.termini.regime.cullMode, above: u.aboveGroundView, status: { ...u.undergroundCull.status } }; });

// ============================ Shafts ============================

for (const name of ['epping', 'amersham']) {
  test(`S-1 ${name} from 40 m: no glass shaft is drawn above ground beyond the edge, and the hover still reaches it`, async () => {
    const a = await stationAt(ST[name]);
    await pose([a.x + 120, a.g + 200, a.z + 90], [a.x, a.g, a.z]);
    const st = await state();
    expect(st.cull).toBe('lines'); expect(st.above).toBe(false); expect(st.status.mode).toBe('lines');
    const withShafts = await px([]), without = await px([SH]);
    expect(withShafts.hid + without.hid, 'the shafts group exists').toBeGreaterThan(0);
    expect(differ(withShafts, without), 'hiding the shaft group changes no pixel: none is drawn').toBe(0);
    // D-040: hidden only inside the render call. Between frames the group is visible, so hover raycasts reach the shafts.
    const vis = await page.evaluate(() => window.__ug.scene.children.filter(c => c.userData?.kind === 'unified-shafts').map(c => c.visible));
    expect(vis.length).toBeGreaterThan(0); expect(vis.every(Boolean)).toBe(true);
    await thaw();
  });
}

test('S-2 from below at Epping the shaft still shows: a camera below the hidden ground is in the new "below" mode, never "lines"', async () => {
  const r = await page.evaluate(([lat, lon, lat2, lon2]) => {
    const u = window.__ug, e = u.llToXZ(lat, lon), th = u.llToXZ(lat2, lon2);
    let best = null;
    u.scene.traverse(o => { if (o.userData?.type === 'station-shaft') { const d = Math.hypot(o.position.x - e.x, o.position.z - e.z); if (!best || d < best.d) best = { d, o }; } });
    const c = best.o.position, dx = th.x - c.x, dz = th.z - c.z, l = Math.hypot(dx, dz), px = c.x + dx / l * 60, pz = c.z + dz / l * 60;
    return { d: best.d, c: [c.x, c.y, c.z], p: [px, c.y, pz], ground: u.termini.hiddenGround.terrainY(px, pz) };
  }, [...ST.epping, ...ST.theydon]);
  expect(r.d, 'the shaft stands within 150 m of Epping').toBeLessThanOrEqual(150);
  expect(r.p[1], 'the camera is below the hidden ground').toBeLessThan(r.ground);
  await pose(r.p, r.c);
  const st = await state();
  expect(st.above).toBe(false); expect(st.cull).toBe('below'); expect(st.status.active, "'below' is not the above-ground cull").toBe(false);
  const f = differ(await px([]), await px([SH]));
  console.log(`[beyond-edge] Epping shaft from 60 m below ground: ${(100 * f).toFixed(2)}% of pixels are the shaft`);
  expect(f).toBeGreaterThanOrEqual(0.005);
  await thaw();
});

// ============================ The skirt ============================

/** The pose inside the bore near Chalfont & Latimer: 30 m below the hidden ground, looking 200 m along the bore (termini.spec.js boreNearChalfont). */
const BORE = () => {
  const u = window.__ug, c = u.llToXZ(51.667985, -0.560689), hg = u.termini.hiddenGround;
  let best = null;
  for (const branch of u.lineBranchCenterPts.get('metropolitan')) branch.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.z - c.z); if (!best || d < best.d) best = { d, branch, i }; });
  const { branch, i } = best, p = branch[i], q = branch[Math.min(branch.length - 1, i + 1)] === p ? branch[i - 1] : branch[i + 1] ?? branch[i - 1];
  let dx = q.x - p.x, dz = q.z - p.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const y = hg.terrainY(p.x, p.z) - 150;
  return { p: [p.x, y, p.z], t: [p.x + dx * 200, y, p.z + dz * 200] };
};

test('S-3 from the bore beyond the edge the surface railway overhead is not drawn: no black band in the sky half', async () => {
  const b = await page.evaluate(BORE);
  await pose(b.p, b.t);
  const st = await state();
  expect(st.cull).toBe('below'); expect(st.status.mode).toBe('below'); expect(st.status.hidden, 'the beyond-edge railway meshes and the minimum-width lines').toBeGreaterThan(0);
  const a = await px([]), noRail = await px(['surface-rail-metropolitan', 'surface-rail-central', 'beyond-edge-track-lines']);
  // readPixels rows run from the bottom: the upper half of the picture is the rows from H / 2 up.
  const upper = [a.H / 2, a.H];
  let black = 0, N = 0;
  for (let y = a.H / 2; y < a.H; y++) for (let x = 0; x < a.W; x++) { const i = (y * a.W + x) * 4; N++; if (a.buf[i] <= 40 && a.buf[i + 1] <= 40 && a.buf[i + 2] <= 40) black++; }
  console.log(`[beyond-edge] bore: near-black ${(100 * black / N).toFixed(3)}% of the upper half; hiding the railway differs on ${(100 * differ(a, noRail, 2, upper)).toFixed(3)}%`);
  expect(black / N, 'near-black fraction of the upper half (bf10309: 8.8%)').toBeLessThanOrEqual(0.0025);
  expect(differ(a, noRail, 3, upper), 'the railway adds nothing to the upper half').toBeLessThanOrEqual(0.001);
  // Hover reaches it: the objects are hidden only inside the render call.
  const vis = await page.evaluate(() => { const u = window.__ug, o = [u.scene.getObjectByName('surface-rail-metropolitan'), u.scene.getObjectByName('beyond-edge-track-lines')]; return o.map(x => x?.visible); });
  expect(vis).toEqual([true, true]);
  await thaw();
});

test('S-4 from above the track looks as before: nothing of the beyond-edge railway is hidden or added 300 m above Amersham', async () => {
  const a = await stationAt(ST.amersham);
  await pose([a.x - 400, a.g + 1500, a.z + 300], [a.x, a.g, a.z]);
  const st = await state();
  expect(st.cull).toBe('lines'); expect(st.status.mode).toBe('lines');
  const withRail = await px([SH]), noRail = await px([SH, 'surface-rail-metropolitan']);
  expect(differ(withRail, noRail), 'the track is drawn from above').toBeGreaterThanOrEqual(0.005);
  const noLegibility = await px([SH, 'beyond-edge-track-lines']);
  expect(differ(withRail, noLegibility), 'from 300 m the minimum-width line is under the stripe: it adds no pixel').toBe(0);
  await thaw();
});

// ============================ The legibility lines ============================

test('S-5 the minimum-width line: beyond the edge only, no instance colour, never picked, follows its line and Master', async () => {
  const r = await page.evaluate(async () => {
    const u = window.__ug, rail = u.surfaceRail, { isOffMapEdge } = await import('/src/m25-edge.js');
    const { getBuildingHeightScale } = await import('/src/surface-geometry.js');
    const group = rail.legibility, out = { children: group.children.length, userKind: group.userData.kind, inScene: group.parent === u.scene, mask: group.layers.mask };
    out.names = group.children.map(c => c.name);
    out.ids = group.children.map(c => c.userData.lineId);
    // Every point of every line is beyond the edge.
    let points = 0, onMap = 0, instanceColour = 0;
    const snap = () => group.children.map(c => Array.from(c.geometry.attributes.instanceStart.data.array));
    for (const c of group.children) {
      const a = c.geometry.attributes.instanceStart.data.array;
      for (let i = 0; i < a.length; i += 3) { points++; if (!isOffMapEdge({ x: a[i], z: a[i + 2] })) onMap++; }
      if (c.geometry.attributes.instanceColorStart || c.instanceColor || c.geometry.attributes.instanceColor) instanceColour++;
    }
    out.points = points; out.onMap = onMap; out.instanceColour = instanceColour;
    // Never picked.
    const picked = rail.pickables(); out.pickedLegibility = picked.some(m => group.children.includes(m) || m.userData?.part === 'legibility');
    out.inGroups = [...rail.groups.values()].some(g => g.children.some(c => group.children.includes(c)));
    // The line hides with its line.
    const first = group.children[0], lineId = first.userData.lineId;
    rail.setLineVisible(lineId, false); out.hiddenWithLine = first.visible === false;
    rail.setLineVisible(lineId, true); out.shownWithLine = first.visible === true;
    // Master: the lift over the ground scales with the structure height factor.
    const lift = () => { const a = first.geometry.attributes.instanceStart.data.array; let s = 0, n = 0; for (let i = 0; i < a.length; i += 3) { const g = u.termini.hiddenGround.structuralY(a[i], a[i + 2]); if (Number.isFinite(g)) { s += a[i + 1] - g; n++; } } return s / n; };
    const el = document.getElementById('masterHeight'), r0 = getBuildingHeightScale(), lift0 = lift();
    el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
    await new Promise(r => setTimeout(r, 300));
    const r1 = getBuildingHeightScale(), lift1 = lift();
    el.value = '1.1'; el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
    await new Promise(r => setTimeout(r, 300));
    out.master = { r0, r1, lift0, lift1, back: lift() };
    // The split meshes: every triangle of a flagged mesh is beyond the edge, no triangle of an unflagged one is; bands are on the map.
    const split = {};
    for (const [id, g] of rail.groups) {
      const s = { flagged: 0, flaggedOnMap: 0, plain: 0, plainOff: 0, bandOff: 0, flaggedMeshes: 0 };
      for (const m of g.children) {
        if (!m.isMesh) continue;
        const p = m.geometry.attributes.position; if (m.userData.beyondEdge) s.flaggedMeshes++;
        for (let t = 0; t < p.count; t += 3) {
          const off = isOffMapEdge({ x: (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, z: (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3 });
          if (m.userData.beyondEdge) { s.flagged++; if (!off) s.flaggedOnMap++; }
          else { s.plain++; if (off) { s.plainOff++; if (m.userData.part === 'band') s.bandOff++; } }
        }
      }
      split[id] = s;
    }
    out.split = split;
    return out;
  });
  console.log('[beyond-edge] legibility', JSON.stringify({ ...r, split: undefined }), 'split', JSON.stringify(r.split.central), JSON.stringify(r.split.metropolitan));
  expect(r.children, 'the Central and the Metropolitan').toBe(2);
  expect(new Set(r.ids)).toEqual(new Set(['central', 'metropolitan']));
  expect(r.userKind).toBe('beyond-edge-legibility'); expect(r.inScene).toBe(true);
  expect(r.mask, 'no layer mask (D-040)').toBe(1);
  expect(r.points).toBeGreaterThan(100); expect(r.onMap, 'every point is beyond the edge').toBe(0);
  expect(r.instanceColour, 'no per-instance colour (D-015)').toBe(0);
  expect(r.pickedLegibility).toBe(false); expect(r.inGroups).toBe(false);
  expect(r.hiddenWithLine).toBe(true); expect(r.shownWithLine).toBe(true);
  expect(r.master.r1, 'Master 2 changes the structure factor').not.toBeCloseTo(r.master.r0, 3);
  expect(r.master.lift1 / r.master.lift0, 'the lift over the ground follows the structure factor').toBeCloseTo(r.master.r1 / r.master.r0, 1);
  expect(r.master.back, 'and returns').toBeCloseTo(r.master.lift0, 3);
  // The split: the part beyond the edge is in meshes of its own and only it; no band lies beyond the edge.
  for (const id of ['central', 'metropolitan']) {
    expect(r.split[id].flaggedMeshes, `${id}: beyond-edge meshes exist`).toBeGreaterThanOrEqual(2);
    expect(r.split[id].flagged, `${id}: they hold triangles`).toBeGreaterThan(0);
    expect(r.split[id].flaggedOnMap, `${id}: no flagged triangle is on the map`).toBe(0);
    expect(r.split[id].plainOff, `${id}: no unflagged triangle is beyond the edge`).toBe(0);
    expect(r.split[id].bandOff, `${id}: no band lies beyond the edge`).toBe(0);
  }
  for (const id of Object.keys(r.split)) if (id !== 'central' && id !== 'metropolitan') expect(r.split[id].flaggedMeshes, `${id}: every other line is built as before`).toBe(0);
});

// ============================ Chesham ============================

test('S-6 Chesham at 8 km: the branch is drawn, not dashed away: the minimum-width line adds its pixels from the report\'s pose and fades by 20 km', async () => {
  const v = await page.evaluate(() => {
    const u = window.__ug, c = u.llToXZ(51.6610, -0.5400), g = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
    const paths = u.surfaceRail.paths.get('metropolitan').filter(Boolean);
    let best = null;
    for (const path of paths) for (let i = 1; i < path.length - 1; i++) { if (path[i].cls === 'tunnel') continue; const d = Math.hypot(path[i].x - c.x, path[i].z - c.z); if (!best || d < best.d) best = { d, path, i }; }
    const { path, i } = best, a = path[Math.max(0, i - 3)], b = path[Math.min(path.length - 1, i + 3)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const p = path[i], cx = p.x - dz * 2500 - dx * 2500, cz = p.z + dx * 2500 - dz * 2500, tx = p.x + dx * 2000, tz = p.z + dz * 2000;
    return { p: [cx, g(cx, cz) + 500 * 5, cz], t: [tx, g(tx, tz) + 10, tz] };
  });
  await pose(v.p, v.t);
  const withLine = await px([]), without = await px(['beyond-edge-track-lines']);
  const f = differ(withLine, without);
  console.log(`[beyond-edge] P1: the minimum-width line changes ${(100 * f).toFixed(3)}% of pixels`);
  expect(f, 'at 7 to 9 km the line is what makes the branch a line').toBeGreaterThanOrEqual(0.0001);
  // Its material: 1.5 CSS pixels wide in the viewport being drawn, and a fade between 12 and 20 km.
  const m = await page.evaluate(async () => {
    const mod = await import('/src/tube-surface-rail.js'); const line = window.__ug.surfaceRail.legibility.children[0];
    return { px: mod.BEYOND_EDGE_MIN_PX, fade: mod.BEYOND_EDGE_FADE_M, linewidth: line.material.linewidth, resolution: [line.material.resolution.x, line.material.resolution.y], transparent: line.material.transparent, fog: line.material.fog };
  });
  console.log('[beyond-edge] line material', JSON.stringify(m));
  expect(m.px).toBe(1.5); expect(m.fade).toEqual([12000, 20000]); expect(m.fog).toBe(true);
  expect(m.linewidth, 'one CSS pixel is one device pixel here (DPR 1, scale 1)').toBeCloseTo(1.5, 2);
  await thaw();
  // From the overview (40 km from the nearest beyond-edge track) the line is faded out: nothing changes.
  await pose([0, 20000, 18000], [0, 0, 0]);
  expect(differ(await px([]), await px(['beyond-edge-track-lines'])), 'the overview keeps its pixels').toBe(0);
  await thaw();
});

test('S-7 no console error across the poses above', async () => {
  expect(errors).toEqual([]);
});
