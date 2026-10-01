// Captures for sprint 01Oct26h, Lane T (trains on the drawn track): a train
// standing at a station, or trains on a stretch, framed from beside the track.
// Needs a DEV server (window.__ug).
//
//   node scripts/capture-s01-trains.mjs <origin> <outDir> <tag> [--shots a,b] [--poses poses.json]
//
// Without --poses each shot seeks its moment and camera on this server (a
// train of the line standing at the station, drawn whole where the shot asks
// for it; or the most trains drawn near a point), and writes them to
// <outDir>/poses.json. With --poses (the "after" run's file) the same
// simulation time and camera are used, so a "before" frame on another commit
// shows the same moment of the same timetable (trains.js is unchanged by the
// sprint, and the TfL API is blocked, so the timetable is the bundled one).
// Frames: 1440x900 at DPR 1, Manual quality at 100% and MSAA 4,
// `?fast=1&buildings=baked&mh=1.1`, the clock paused, the tick frozen, rendered
// through D-040's cull as the app renders an above-ground frame.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const SHOTS = {
  // A Jubilee train standing at West Hampstead, drawn whole (387dff0: a stub of 1 to 3 cars on the undrawn tunnel piece).
  'T1-west-hampstead-jubilee': { kind: 'dwell', line: 'jubilee', station: 'West Hampstead', dist: 230, up: 70, whole: true },
  // A Metropolitan train standing at Watford, its front at the buffers.
  'T2-watford-metropolitan': { kind: 'dwell', line: 'metropolitan', station: 'Watford', dist: 230, up: 70, whole: true, terminus: true },
  // Trains on the Hainault loop (Lane R's new track): one standing at Fairlop, and the loop from above Barkingside.
  'T3-hainault-loop-fairlop-central': { kind: 'dwell', line: 'central', station: 'Fairlop', dist: 230, up: 70, whole: true },
  'T3b-hainault-loop-central': { kind: 'cluster', line: 'central', station: 'Barkingside', radius: 1200 },
  // A Central train at West Acton (Lane R's new Ealing Broadway branch), beside the new footprints.
  'T4-west-acton-central': { kind: 'dwell', line: 'central', station: 'West Acton', dist: 230, up: 70, whole: true },
  // The termini fitted this sprint.
  'T5-earls-court-district': { kind: 'dwell', line: 'district', station: "Earl's Court", dist: 260, up: 90, terminus: true },
  // A District train from Upminster standing at Earl's Court, the end of its curve: its rear two cars inside the tunnel it came out of.
  'T5b-earls-court-arrival-district': { kind: 'dwell', line: 'district', station: "Earl's Court", dist: 120, up: 230, terminus: true, curve: 'district@2610' },
  'T6-barking-hammersmith-city': { kind: 'dwell', line: 'hammersmith-city', station: 'Barking', dist: 230, up: 70, whole: true, terminus: true },
  'T7-stratford-dlr': { kind: 'dwell', line: 'dlr', station: 'Stratford', dist: 260, up: 90, whole: true, terminus: true, curveNear: 200 },
  'T8-theydon-bois-central': { kind: 'dwell', line: 'central', station: 'Theydon Bois', dist: 230, up: 70, whole: true },
};

if (process.argv[1]?.endsWith('capture-s01-trains.mjs')) {
  const [origin, outDir, tag] = process.argv.slice(2);
  if (!origin || !outDir || !tag) throw new Error('usage: capture-s01-trains.mjs <origin> <outDir> <tag> [--shots a,b] [--poses poses.json]');
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const names = arg('--shots', Object.keys(SHOTS).join(',')).split(',');
  const posesFile = arg('--poses', null);
  const poses = posesFile ? JSON.parse(await readFile(posesFile, 'utf8')) : {};
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.context().route('https://api.tfl.gov.uk/**', r => r.abort());
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window); const held = []; let lastTs = 0;
    window.requestAnimationFrame = cb => { if (window.__freeze && cb.name === 'tick') { held.push(cb); return 0; } return raf(ts => { if (cb.name === 'tick') lastTs = ts; cb(ts); }); };
    window.__step = n => { for (let i = 0; i < n; i++) { const cb = held.shift(); if (cb) cb(lastTs); } };
    window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) window.requestAnimationFrame(cb); };
  });
  await page.goto(`${origin}/?fast=1&buildings=baked&mh=1.1`);
  await page.waitForFunction(() => window.__ug?.bakedStats?.tilesTotal > 0 && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal
    && window.__ug.groundReady && window.__ug.overground?.userData.stationsAttached && window.__ug.surfaceTrains?.stats.written > 3, null, { timeout: 180000 });
  // As tests/surface-trains.spec.js: let the terrain resnap settle, resnap once more, let the mappings land.
  await page.waitForFunction(() => {
    const key = window.__ug.trainSystem.allTrains.map(t => `${t.userData.id}=${t.userData.curveLengthM.toFixed(3)}`).sort().join('|');
    const now = performance.now(), w = window;
    if (w.__trainKey !== key) { w.__trainKey = key; w.__trainKeySince = now; return false; }
    return now - w.__trainKeySince > 3000;
  }, null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => window.__ug.snapAllTubesToTerrain());
  await page.waitForFunction(() => window.__ug.surfaceTrains.stats.pending === 0, null, { timeout: 60000 });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
  const record = {};
  for (const name of names) {
    const shot = { ...SHOTS[name], pose: poses[name] ?? null };
    const found = await page.evaluate(async shot => {
      window.__thaw();
      const u = window.__ug, st = u.surfaceTrains, data = u.surfaceRail.data, ground = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
      const { trainStateAt } = await import('/src/trains.js');
      const line = data.lines.find(l => l.id === shot.line);
      const stop = line.stations.find(s => s.name.replace(/ (Underground|DLR|Rail) Station/, '') === shot.station);
      if (!stop) return { error: `no stop ${shot.station}` };
      const c = u.llToXZ(stop.lat, stop.lon);
      let simT = null, cam = null, target = null, note = '';
      const total = st.stockOf.get(shot.line).layout.length;
      if (shot.pose) {
        ({ simT, cam, target } = shot.pose); note = 'pose from the after run';
      } else if (shot.kind === 'dwell') {
        // A train of the line standing at the station (its curve point within curveNear of the stop), drawn whole if asked.
        const reach = shot.curveNear ?? 160;
        for (let t = 600; t < 600 + 4 * 3600 && simT === null; t += 1) {
          for (const train of u.trainSystem.allTrains) {
            const ud = train.userData; if (ud.lineId !== shot.line || (shot.curve && !ud.id.startsWith(shot.curve))) continue;
            const s = trainStateAt(ud, t); if (!(s.pausedLeft > 1)) continue;
            const P = ud.curve.getPointAt(s.t); if (Math.hypot(P.x - c.x, P.z - c.z) > reach) continue;
            const su = ud.stationUs; const atEnd = Math.abs(s.t - Math.min(...su)) < 1e-6 || Math.abs(s.t - Math.max(...su)) < 1e-6;
            if (shot.terminus && !atEnd) continue;
            const tr = st.snapshot(t, { lineId: shot.line })[ud.id];
            if (!tr || (shot.whole && tr.cars.length !== total)) continue;
            const mid = tr.cars[tr.cars.length >> 1].m, fw = [mid[8], mid[10]], fl = Math.hypot(...fw), side = [-fw[1] / fl, fw[0] / fl];
            const cx = mid[12] + side[0] * shot.dist * 0.85 - fw[0] / fl * shot.dist * 0.35, cz = mid[14] + side[1] * shot.dist * 0.85 - fw[1] / fl * shot.dist * 0.35;
            cam = [cx, Math.max(ground(cx, cz), mid[13]) + shot.up * 5 / 1.1, cz]; target = [mid[12], mid[13] + 4, mid[14]];
            simT = t; note = `${ud.id} standing at ${shot.station}${atEnd ? ' (its curve\'s end)' : ''}: ${tr.cars.length} of ${total} cars drawn`;
            break;
          }
        }
      } else if (shot.kind === 'cluster') {
        // The moment with the most whole trains of the line within radius of the station, framed from beside their centroid.
        let best = null;
        for (let t = 600; t < 600 + 3600; t += 3) {
          const trs = Object.values(st.snapshot(t, { lineId: shot.line })).filter(tr => tr.cars.length === total && tr.cars.every(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z) < shot.radius));
          if (!best || trs.length > best.trs.length) best = { t, trs };
        }
        simT = best.t; note = `${best.trs.length} whole ${shot.line} trains within ${shot.radius} m of ${shot.station}`;
        const mids = best.trs.map(tr => tr.cars[tr.cars.length >> 1].m), mx = mids.reduce((a, m) => a + m[12], 0) / mids.length, mz = mids.reduce((a, m) => a + m[14], 0) / mids.length;
        const ex = Math.max(...mids.map(m => m[12])) - Math.min(...mids.map(m => m[12])), ez = Math.max(...mids.map(m => m[14])) - Math.min(...mids.map(m => m[14]));
        const ax = ez > ex ? 1 : 0, az = ez > ex ? 0 : 1, D = 0.9 * Math.max(ex, ez) + 350; // look across the trains' spread
        const cx = mx + ax * D, cz = mz + az * D;
        cam = [cx, ground(cx, cz) + 0.75 * D * 5 / 1.1, cz]; target = [mx, ground(mx, mz), mz];
      }
      if (simT === null) return { error: 'no simulation time found' };
      u.trainSystem.simTime = simT;
      u.camera.position.fromArray(cam); u.controls.target.fromArray(target); u.controls.update();
      await new Promise(r => setTimeout(r, 2500));
      window.__freeze = true; await new Promise(r => setTimeout(r, 100)); window.__step(3);
      // What this frame draws near the station (every surface train of the line within 600 m).
      const near = Object.entries(st.snapshot(simT, { lineId: shot.line })).filter(([, tr]) => tr.cars.some(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z) < (shot.radius ?? 600))).map(([id, tr]) => `${id.replace(/@.*?(:fwd|:rev)/, '$1')} ${tr.cars.length}/${total}`);
      return { simT, cam: cam.map(v => +v.toFixed(1)), target: target.map(v => +v.toFixed(1)), note, near };
    }, shot);
    if (found.error) { console.log(name, found.error); continue; }
    record[name] = found;
    const png = await page.evaluate(() => {
      const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
      u.surfaceTrains.update(u.camera);
      u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0));
      rr.setRenderTarget(null);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'), img = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(b.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      cx.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    });
    await writeFile(`${outDir}/${name}-${tag}.png`, Buffer.from(png.split(',')[1], 'base64'));
    console.log(name, tag, JSON.stringify(found));
  }
  await writeFile(`${outDir}/poses-${tag}.json`, JSON.stringify(record, null, 1));
  await browser.close();
}
