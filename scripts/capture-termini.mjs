// The lane T captures (sprint 02Oct26f, D-048 item 7): lines to their termini beyond the M25.
//
//   node scripts/capture-termini.mjs <out-dir> [--after http://localhost:5243] [--before http://localhost:5254]
//
// "After" is this branch's dev server; "before" is e0675d7's (a detached worktree). Run through the GPU lock:
//   ug-gpu.sh T-captures node scripts/capture-termini.mjs <out-dir>
// Master 1.1 (the default), headless on the real GPU (ANGLE Metal), 1440 x 900. Writes JPEGs and captures.md.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const OUT = args[0];
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const AFTER = opt('--after', 'http://localhost:5243'), BEFORE = opt('--before', 'http://localhost:5254');
if (!OUT) { console.error('usage: capture-termini.mjs <out-dir>'); process.exit(64); }
mkdirSync(OUT, { recursive: true });
const index = [];
const note = (file, pose, shows) => { index.push({ file, pose, shows }); console.log('captured', file); };

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
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
async function open(origin, query = '?fast=1&buildings=baked&mh=1.1') {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await p.addInitScript(FREEZE);
  await p.goto(`${origin}/${query}`);
  await p.waitForFunction(READY, null, { timeout: 240000 });
  await p.evaluate(() => { window.__ug.setRenderQualityMode('manual'); window.__ug.renderQuality.set({ scale: 1, samples: 4 }); window.__ug.sim.paused = true; });
  return p;
}
/** Place the camera, let it draw a second or two (the sim is paused: a still scene), and shoot. */
async function shoot(pg, p, t, file, { before = false } = {}) {
  await pg.evaluate(async ({ p, t }) => {
    window.__thaw();
    const u = window.__ug; u.camera.position.fromArray(p); u.controls.target.fromArray(t); u.controls.update();
    await new Promise(r => setTimeout(r, 2500));
  }, { p, t });
  await pg.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 88 });
}
/** Camera beside a line's drawn track near a place (tests/surface-rail.spec.js trackPose): the position and target. */
const trackPose = (pg, o) => pg.evaluate(({ track, lat, lon, side, back, up, ahead }) => {
  const u = window.__ug, c = u.llToXZ(lat, lon), g = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
  const paths = track.startsWith('og:') ? u.overground.userData.linePaths.get(track.slice(3)).filter(Boolean) : u.surfaceRail.paths.get(track).filter(Boolean);
  let best = null;
  for (const path of paths) for (let i = 1; i < path.length - 1; i++) { if (path[i].cls === 'tunnel') continue; const d = Math.hypot(path[i].x - c.x, path[i].z - c.z); if (!best || d < best.d) best = { d, path, i }; }
  const { path, i } = best, a = path[Math.max(0, i - 3)], b = path[Math.min(path.length - 1, i + 3)];
  let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  const p = path[i], cx = p.x - dz * side - dx * back, cz = p.z + dx * side - dz * back;
  const tx = p.x + dx * ahead, tz = p.z + dz * ahead;
  return { p: [cx, g(cx, cz) + up * 5, cz], t: [tx, g(tx, tz) + 10, tz] };
}, o);

// ---- the map-view captures (the app's own camera) ----
const after = await open(AFTER), before = await open(BEFORE);
const at = (pg, lat, lon) => pg.evaluate(([lat, lon]) => { const c = window.__ug.llToXZ(lat, lon); return [c.x, c.z]; }, [lat, lon]);
const groundAfter = (x, z) => after.evaluate(([x, z]) => window.__ug.termini.hiddenGround.terrainY(x, z), [x, z]);

// P1: the Metropolitan from Rickmansworth to Amersham, 500 m up.
{
  const o = { track: 'metropolitan', lat: 51.6610, lon: -0.5400, side: 2500, back: 2500, up: 500, ahead: 2000 };
  for (const [pg, tag] of [[before, 'before'], [after, 'after']]) { const v = await trackPose(pg, o); await shoot(pg, v.p, v.t, `T-P1-metropolitan-500m-${tag}.jpg`); }
  note('T-P1-metropolitan-500m-before.jpg', 'trackPose metropolitan 51.6610,-0.5400 side 2500 back 2500 up 500 m ahead 2000, e0675d7', 'The Metropolitan beyond Rickmansworth before: the drawn track stops at the map edge, the rest is bored tube ribbon under bare ground.');
  note('T-P1-metropolitan-500m-after.jpg', 'the same pose', 'After: the track runs on to Amersham and Chesham in empty space, with no bore ribbon under it.');
}
// P2: a train standing at Chesham.
{
  const f = await after.evaluate(async () => {
    const u = window.__ug, st = u.surfaceTrains, { trainStateAt } = await import('/src/trains.js');
    const byId = new Map(u.trainSystem.allTrains.map(t => [t.userData.id, t])), c = u.llToXZ(51.705208, -0.611247);
    for (let k = 0; k < 400; k++) {
      const t = 640 + 37 * k;
      for (const [id, tr] of Object.entries(st.snapshot(t, { lineId: 'metropolitan' }))) {
        const s = trainStateAt(byId.get(id).userData, t);
        if (s.pausedLeft <= 0 || tr.cars.length !== st.stockOf.get('metropolitan').layout.length) continue;
        const cx = tr.cars.reduce((a, q) => a + q.m[12], 0) / tr.cars.length, cz = tr.cars.reduce((a, q) => a + q.m[14], 0) / tr.cars.length;
        if (Math.hypot(cx - c.x, cz - c.z) < 120) { u.trainSystem.simTime = t; return { t, cx, cz, y: tr.cars[0].m[13] }; }
      }
    }
    return null;
  });
  if (f) {
    const g = await groundAfter(f.cx, f.cz);
    await shoot(after, [f.cx - 100, g + 40 * 5, f.cz + 65], [f.cx, f.y, f.cz], 'T-P2-train-at-chesham-after.jpg');
    note('T-P2-train-at-chesham-after.jpg', `sim time ${f.t} s; camera 120 m west-south-west of the train, 40 m up, looking at it`, 'A Metropolitan train standing whole at Chesham, the terminus, on the drawn track beyond the M25.');
  } else console.warn('no train dwelling whole at Chesham found');
}
// P5: inside the bore beyond the edge.
{
  const bore = await after.evaluate(() => {
    const u = window.__ug, c = u.llToXZ(51.667985, -0.560689), hg = u.termini.hiddenGround;
    let best = null;
    for (const branch of u.lineBranchCenterPts.get('metropolitan')) branch.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.z - c.z); if (!best || d < best.d) best = { d, branch, i }; });
    const { branch, i } = best, p = branch[i], q = branch[i + 1] ?? branch[i - 1];
    let dx = q.x - p.x, dz = q.z - p.z; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const y = hg.terrainY(p.x, p.z) - 150;
    return { p: [p.x, y, p.z], t: [p.x + dx * 200, y, p.z + dz * 200] };
  });
  for (const [pg, tag] of [[before, 'before'], [after, 'after']]) await shoot(pg, bore.p, bore.t, `T-P5-bore-beyond-edge-${tag}.jpg`);
  note('T-P5-bore-beyond-edge-before.jpg', 'camera 30 m below the ground in the bore at Chalfont & Latimer, looking 200 m along it, e0675d7', 'Before: a camera 30 m below the ground in a bore beyond the edge. Audio and station labels are in their daylight (surface) modes here; fog and light already match the underground look at this height (clayLift is 1 for any y above 0), so the picture itself barely differs from the after.');
  note('T-P5-bore-beyond-edge-after.jpg', 'the same pose', 'After: the same pose. Audio and the labels are underground (tests/termini.spec.js T-R1 reads them and the fog and light against Shooters Hill); what is new to see is the Metropolitan\'s surface railway, now drawn beyond the edge, seen from below (the dark band upper left is a viaduct deck or embankment skirt, there being no terrain to hide it).');
}
// P6: the Weaver at Cheshunt.
{
  const o = { track: 'og:weaver', lat: 51.7029, lon: -0.0240, side: 300, back: 400, up: 300, ahead: 200 };
  for (const [pg, tag] of [[before, 'before'], [after, 'after']]) { const v = await trackPose(pg, o); await shoot(pg, v.p, v.t, `T-P6-weaver-cheshunt-${tag}.jpg`); }
  note('T-P6-weaver-cheshunt-before.jpg', 'trackPose og:weaver 51.7029,-0.0240 side 300 back 400 up 300 ahead 200, e0675d7', 'Before: the Weaver stops 520 m short of Cheshunt (trackPose points at the nearest drawn sample, so this pose looks along the track from its old end; the Cheshunt marker stands alone beyond it).');
  note('T-P6-weaver-cheshunt-after.jpg', 'the same pose', 'After: the track runs on to the Cheshunt platforms.');
}
// P7: the exterior cliff, unchanged.
{
  const v = { p: [-30000, -120, 9511], t: [-28513, -300, 9511] };
  for (const [pg, tag] of [[before, 'before'], [after, 'after']]) await shoot(pg, v.p, v.t, `T-P7-exterior-cliff-${tag}.jpg`);
  note('T-P7-exterior-cliff-before.jpg', 'camera (-30000, -120, 9511) looking at (-28513, -300, 9511), e0675d7', 'The west cliff from outside, before.');
  note('T-P7-exterior-cliff-after.jpg', 'the same pose', 'After: unchanged (the corridor does not reach it; pixels compared in tests/termini.spec.js).');
}
// P8: from 300 m above Amersham.
{
  const [x, z] = await at(after, 51.674126, -0.607714), g = await groundAfter(x, z);
  const gb = await before.evaluate(([x, z]) => window.__ug.getTerrainMeshSurfaceY({ x, z }), [x, z]);
  await shoot(before, [x - 400, gb + 1500, z + 300], [x, gb, z], 'T-P8-above-amersham-before.jpg');
  await shoot(after, [x - 400, g + 1500, z + 300], [x, g, z], 'T-P8-above-amersham-after.jpg');
  note('T-P8-above-amersham-before.jpg', 'camera 400 m west and 300 m south of Amersham station, 300 m above the ground, looking at the station, e0675d7', 'Before: the bore ribbon runs through empty space beyond the edge, and no surface track is drawn.');
  note('T-P8-above-amersham-after.jpg', 'the same pose', 'After: the ribbon is gone (the lines cull) and the surface track and the station marker are drawn.');
}
await after.close(); await before.close();

// ---- the walker captures (Pedestrian) ----
const walk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await walk.goto(`${AFTER}/?skip=1&buildings=baked`);
await walk.waitForFunction(() => !!(window.__ug && window.__ug.modes && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
await walk.waitForFunction(() => { const b = window.__ug.bakedStats; return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.lineBranchCenterPts.size > 11
  && window.__ug.trainSystem?.allTrains.length > 100 && window.__ug.modes.ctx.tubeRoutes?.size > 11 && window.__ug.surfaceRail && window.__ug.surfaceTrains && window.__ug.termini?.corridor.ready; }, null, { timeout: 180000 });
await walk.keyboard.press('2');
await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
const placeAt = (lineId, from, toward) => walk.evaluate(([lineId, from, toward]) => {
  const m = window.__ug.modes.registry.get('pedestrian'), net = m.rebuildNetwork();
  for (const p of net.paths) {
    if (p.lineId !== lineId) continue;
    const st = p.stops.find(x => x.stop.name.startsWith(from)); if (!st) continue;
    for (const dir of [1, -1]) {
      const nx = dir > 0 ? p.stations.find(x => x.s > st.s + 1e-6) : [...p.stations].reverse().find(x => x.s < st.s - 1e-6);
      if (nx && nx.name.startsWith(toward)) { m.placeInTunnel({ path: p.id, s: st.s, dir }); return true; }
    }
  }
  return false;
}, [lineId, from, toward]);
const rideUntil = (lineId, until, via = null) => walk.evaluate(async ({ lineId, until, via }) => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r)), net = m.network;
  const c0 = m.debug().clock, is = (n, w) => n === w || n.replace(/\s*\(.*\)$/, '') === w;
  const since = d => d.arrivals.filter(a => a.at > c0);
  const posOf = name => net.entrances.filter(en => is(en.name, name) && en.stops.some(x => x.lineId === lineId));
  for (const k of ['w', 'shift']) ug.fpsControls.keys.add(k);
  const t0 = performance.now(); let vi = 0;
  try {
    while (performance.now() - t0 < 150000) {
      if (via) {
        const d0 = m.debug(), c = ug.camera.position;
        while (vi < via.length && since(d0).some(a => is(a.name, via[vi]))) vi++;
        let e = null;
        for (let k = vi; k < via.length && !e; k++) { const best = posOf(via[k]).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0]; if (best && Math.hypot(best.x - c.x, best.z - c.z) > 150) e = best; }
        if (e) { const want = Math.atan2(-(e.x - c.x), -(e.z - c.z)); m.turn(Math.atan2(Math.sin(want - d0.yaw), Math.cos(want - d0.yaw)), 0); }
      }
      await frame();
      if (since(m.debug()).some(a => is(a.name, until))) break;
    }
  } finally { for (const k of ['w', 'shift']) ug.fpsControls.keys.delete(k); }
  return since(m.debug()).map(a => a.name);
}, { lineId, until, via });
// P3: the walker arriving at Epping.
await placeAt('central', 'Debden', 'Theydon Bois');
console.log('arrivals', JSON.stringify(await rideUntil('central', 'Epping')));
await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
await walk.waitForTimeout(1500);
await walk.screenshot({ path: path.join(OUT, 'T-P3-walker-at-epping-after.jpg'), type: 'jpeg', quality: 88 });
note('T-P3-walker-at-epping-after.jpg', 'Pedestrian, first person, arrived at Epping from Debden (Shift held), the arrival card up', 'The walker at Epping, beyond the M25: the platform in the open, the card offering the street. On e0675d7 the walk held at Theydon Bois.');
// P4: the walker on the hidden ground outside Amersham, 150 m into the walk, looking back towards the track.
await placeAt('metropolitan', 'Moor Park', 'Rickmansworth');
console.log('arrivals', JSON.stringify(await rideUntil('metropolitan', 'Amersham', ['Rickmansworth', 'Chorleywood', 'Chalfont & Latimer', 'Amersham'])));
await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().card?.kind === 'arrival', null, { timeout: 30000 });
await walk.keyboard.press('1');
await walk.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
const away = await walk.evaluate(async () => {
  const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), frame = () => new Promise(r => requestAnimationFrame(r));
  const d0 = m.debug(), st = d0.step?.station;
  // Turn away from the track: from the nearest drawn sample of the Metropolitan to the walker.
  let best = null;
  for (const p of ug.surfaceRail.paths.get('metropolitan')) for (const q of p) { const d = Math.hypot(q.x - d0.x, q.z - d0.z); if (!best || d < best.d) best = { d, q }; }
  const want = Math.atan2(-(d0.x - best.q.x), -(d0.z - best.q.z));
  m.turn(Math.atan2(Math.sin(want - d0.yaw), Math.cos(want - d0.yaw)), 0);
  const x0 = d0.x, z0 = d0.z, t0 = performance.now();
  for (const k of ['w', 'shift']) ug.fpsControls.keys.add(k);
  try { while (performance.now() - t0 < 60000) { await frame(); const d = m.debug(); if (Math.hypot(d.x - x0, d.z - z0) >= 150) break; } } finally { for (const k of ['w', 'shift']) ug.fpsControls.keys.delete(k); }
  await frame();
  const d1 = m.debug(); m.turn(Math.PI, 0);   // look back towards the track
  await new Promise(r => setTimeout(r, 1200));
  return { metres: Math.hypot(d1.x - x0, d1.z - z0), x: d1.x, z: d1.z, y: d1.y, ground: ug.termini.hiddenGround.terrainY(d1.x, d1.z) };
});
console.log('walk', JSON.stringify(away));
await walk.screenshot({ path: path.join(OUT, 'T-P4-walker-hidden-ground-amersham-after.jpg'), type: 'jpeg', quality: 88 });
note('T-P4-walker-hidden-ground-amersham-after.jpg', `Pedestrian, first person, ${away.metres.toFixed(0)} m from the Amersham street step, turned back towards the track`, 'The walker on the invisible ground outside Amersham (beyond the M25), looking back at the station and the track.');
await walk.close();
await browser.close();

const md = ['# Lane T captures (sprint 02Oct26f)', '',
  'Lines to their termini beyond the M25 (D-048 item 7). Master 1.1, 1440 x 900, headless on the real GPU. "Before" is `e0675d7`, "after" is branch `s02/T`. Made by `scripts/capture-termini.mjs`.', '',
  '| File | Pose | What it shows |', '|---|---|---|', ...index.map(i => `| ${i.file} | ${i.pose} | ${i.shows} |`), ''].join('\n');
writeFileSync(path.join(OUT, 'captures.md'), md);
console.log('wrote captures.md with', index.length, 'rows');
