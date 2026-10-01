// Captures for the surface trains (sprint 30Sep26w, D-041, Lane T): a train
// emerging at a portal, trains on the DLR viaduct, both operators on shared
// track. Needs a DEV server (window.__ug).
//
//   node scripts/capture-surface-trains.mjs <origin> <outDir> [--shots a,b]
//
// Every shot is taken twice from the same page and camera: `-before` with the
// surface-trains group hidden (exactly Lane R's verified head, which draws the
// open-air track without trains) and `-after` with it drawn. Frames: 1440x900
// at DPR 1, Manual quality at 100% and MSAA 4, the TfL API blocked (bundled
// routes, so the timetable is the pinned one), `?fast=1&buildings=baked&mh=1.1`,
// the clock paused at a simulation time found by seeking (printed, and written
// to <outDir>/shots.json with the cameras), the tick frozen and stepped.
//
// The Overground's trains are schematic runners on their own clock (not the
// timetable); for the shared-track shots that clock is set to a sought value
// too, so the frame is reproducible.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const portalShot = (portal, lineId, side = 1, back = 150, up = 45) => ({ kind: 'portal', portal, lineId, side, back, up });
export const SHOTS = {
  'T1-northern-golders-green-portal': portalShot('northern-3', 'northern', 1, 150, 110),
  'T1b-piccadilly-arnos-grove-portal': portalShot('piccadilly-13', 'piccadilly', 1, 150, 110),
  'T1c-central-white-city-portal': portalShot('central-6', 'central', 1, 150, 110),
  'T2-district-piccadilly-profiles': { kind: 'pair', lines: ['district', 'piccadilly'], near: [-9000, 1300], radius: 2500, close: 40, low: true },
  'T3-dlr-west-india-quay-viaduct': { kind: 'cluster', lineId: 'dlr', cam: [7682.2, 192.7, -342.8], target: [7448, 24.5, -110.1], near: [7520, -200], radius: 380, min: 3 },
  'T4-dlr-canning-town-flyover': { kind: 'cluster', lineId: 'dlr', cam: [9590, 230, -790], target: [9414, 45, -965], near: [9430, -950], radius: 260, min: 2 },
  'T4b-dlr-poplar-flyover': { kind: 'cluster', lineId: 'dlr', cam: [7600, 200, -80], target: [7440, 80, -235], near: [7450, -230], radius: 260, min: 2 },
  'T5-bakerloo-lioness-shared': { kind: 'shared', lineId: 'bakerloo', overground: 'lioness', near: [-12660, -6540], radius: 3000, aim: true },
  'T6-district-mildmay-kew-bridge-shared': { kind: 'shared', lineId: 'district', overground: 'mildmay', near: [-10590, 3020], radius: 450, aim: true },
};

if (process.argv[1]?.endsWith('capture-surface-trains.mjs')) {
  const [origin, outDir] = process.argv.slice(2);
  if (!origin || !outDir) throw new Error('usage: capture-surface-trains.mjs <origin> <outDir> [--shots a,b]');
  const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
  const names = arg('--shots', Object.keys(SHOTS).join(',')).split(',');
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
    && window.__ug.groundReady && window.__ug.overground?.userData.stationsAttached && window.__ug.surfaceTrains?.stats.written > 3 && window.__ug.surfaceTrains.stats.pending === 0, null, { timeout: 180000 });
  await page.evaluate(() => { const u = window.__ug; u.setRenderQualityMode('manual'); u.renderQuality.set({ scale: 1, samples: 4 }); u.sim.paused = true; });
  const record = {};
  for (const name of names) {
    const shot = SHOTS[name];
    const found = await page.evaluate(async shot => {
      window.__thaw();
      const u = window.__ug, st = u.surfaceTrains, data = u.surfaceRail.data, ground = (x, z) => u.getTerrainMeshSurfaceY({ x, z }) ?? 0;
      // A camera beside a car (its forward column gives the track's direction), framing it and a second point.
      const aimAt = (car, other, low = false) => {
        const fw = [car.m[8], car.m[10]], fl = Math.hypot(...fw), side = [-fw[1] / fl, fw[0] / fl];
        const mid = [(car.m[12] + other[0]) / 2, (car.m[13] + other[1]) / 2, (car.m[14] + other[2]) / 2];
        const dist = Math.max(low ? 60 : 140, Math.hypot(car.m[12] - other[0], car.m[14] - other[2]) * 1.2 + (low ? 60 : 80));
        const cx = mid[0] + side[0] * dist * 0.85 - fw[0] / fl * dist * 0.35, cz = mid[2] + side[1] * dist * 0.85 - fw[1] / fl * dist * 0.35;
        const up = low ? 8 + dist * 0.05 : 45 + dist * 0.2; // steep enough that low-rise housing cannot hide the track
        return { cam: [cx, Math.max(ground(cx, cz), mid[1]) + up * 5 / 1.1, cz], target: [mid[0], mid[1] + (low ? 2 : 4), mid[2]] };
      };
      let cam = shot.cam, target = shot.target, simT = null, note = '';
      if (shot.kind === 'portal') {
        const p = data.lines.find(l => l.id === shot.lineId).portals.find(q => q.id === shot.portal);
        const c = u.llToXZ(p.lat, p.lon), b = p.bearingIntoOpenDeg * Math.PI / 180;
        const dir = [Math.sin(b), -Math.cos(b)], perp = [-dir[1] * shot.side, dir[0] * shot.side];
        // Seek: a train of the line part way out of this mouth (some cars drawn, some not, the drawn ones near it).
        const total = st.stockOf.get(shot.lineId).layout.length;
        for (let t = 600; t < 600 + 3 * 3600 && simT === null; t += 1) {
          const snap = st.snapshot(t, { lineId: shot.lineId });
          for (const tr of Object.values(snap)) {
            if (tr.cars.length < 2 || tr.cars.length > total - 2) continue;
            const d = Math.min(...tr.cars.map(k => Math.hypot(k.m[12] - c.x, k.m[14] - c.z)));
            if (d < 25) { simT = t; note = `${tr.cars.length} of ${total} cars out of ${shot.portal}`; break; }
          }
        }
        const fx = c.x + dir[0] * shot.back * 0.8 + perp[0] * shot.back * 0.6, fz = c.z + dir[1] * shot.back * 0.8 + perp[1] * shot.back * 0.6;
        cam = [fx, ground(fx, fz) + shot.up * 5 / 1.1, fz];
        const tx = c.x + dir[0] * 40, tz = c.z + dir[1] * 40;
        target = [tx, ground(tx, tz) + 6, tz];
      } else if (shot.kind === 'cluster') {
        let best = null;
        for (let t = 600; t < 600 + 3600; t += 2) {
          const snap = st.snapshot(t, { lineId: shot.lineId });
          const n = Object.values(snap).filter(tr => tr.cars.some(k => Math.hypot(k.m[12] - shot.near[0], k.m[14] - shot.near[1]) < shot.radius)).length;
          if (!best || n > best.n) best = { t, n };
          if (n >= shot.min + 2) break;
        }
        simT = best.t; note = `${best.n} DLR trains within ${shot.radius} m`;
      } else if (shot.kind === 'pair') {
        // Two lines' trains side by side (within shot.close metres, both whole), seen from beside them.
        for (let t = 600; t < 600 + 3 * 3600 && simT === null; t += 1) {
          const A = Object.values(st.snapshot(t, { lineId: shot.lines[0] })), B = Object.values(st.snapshot(t, { lineId: shot.lines[1] }));
          for (const a of A) {
            if (a.cars.length !== st.stockOf.get(shot.lines[0]).layout.length) continue;
            const ca = a.cars[a.cars.length >> 1];
            if (Math.hypot(ca.m[12] - shot.near[0], ca.m[14] - shot.near[1]) > shot.radius) continue;
            const b = B.find(b => b.cars.length === st.stockOf.get(shot.lines[1]).layout.length && b.cars.some(cb => Math.hypot(cb.m[12] - ca.m[12], cb.m[14] - ca.m[14]) < shot.close));
            if (!b) continue;
            simT = t;
            const cb = b.cars[b.cars.length >> 1];
            ({ cam, target } = aimAt(ca, [cb.m[12], cb.m[13], cb.m[14]], shot.low));
            note = `${shot.lines[0]} and ${shot.lines[1]} trains side by side`;
            break;
          }
        }
      } else if (shot.kind === 'shared') {
        // The Tube train: whole, on the Overground line's corridor (its middle car within 4 m of that line's track).
        const ogPaths = u.overground.userData.linePaths.get(shot.overground);
        const onOg = (x, z) => { for (const p of ogPaths) if (p) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], vx = b.x - a.x, vz = b.z - a.z, q = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1))); if (Math.hypot(x - a.x - vx * q, z - a.z - vz * q) < 4) return true; } return false; };
        let tube = null;
        for (let t = 600; t < 600 + 3 * 3600 && simT === null; t += 1) {
          const snap = st.snapshot(t, { lineId: shot.lineId });
          for (const tr of Object.values(snap)) if (tr.cars.length === st.stockOf.get(shot.lineId).layout.length && tr.cars.every(k => Math.hypot(k.m[12] - shot.near[0], k.m[14] - shot.near[1]) < shot.radius)) {
            const mc = tr.cars[tr.cars.length >> 1]; if (!onOg(mc.m[12], mc.m[14])) continue;
            simT = t; tube = mc; break;
          }
        }
        if (tube) shot.near = [tube.m[12], tube.m[14]];
        // The Overground runners' own clock: the first value that brings one of this line's trains near too.
        const fleet = u.overground.userData.fleets.find(f => f.name === `overground-trains-${shot.overground}`);
        const SPEED = 13;
        const initial = fleet.userData.trains.map(tr => tr.phase0 ??= (() => { const same = fleet.userData.trains.filter(o => o.path === tr.path); return (same.indexOf(tr) + .31) / same.length * 2 * tr.run; })());
        let og = null;
        for (let tau = 0; tau < 4000 && og === null; tau += 0.5) {
          fleet.userData.trains.forEach((tr, i) => { tr.phase = (initial[i] + SPEED * tau) % (2 * tr.run); });
          fleet.userData.update(0, null, 5 * u.getBuildingHeightScale());
          const near = fleet.userData.trains.find(tr => tr.visible !== false && Math.hypot(tr.position.x - shot.near[0], tr.position.z - shot.near[1]) < (shot.aim ? 150 : shot.radius * 0.8));
          if (near) { og = tau; if (shot.aim && tube) ({ cam, target } = aimAt(tube, [near.position.x, near.position.y, near.position.z])); }
        }
        note = `Overground runners' clock ${og} s`;
        shot.ogTau = og;
      }
      if (simT === null) return { error: 'no simulation time found' };
      u.trainSystem.simTime = simT;
      u.camera.position.fromArray(cam); u.controls.target.fromArray(target); u.controls.update();
      await new Promise(r => setTimeout(r, 2500));
      window.__freeze = true; await new Promise(r => setTimeout(r, 100)); window.__step(3);
      return { simT, cam: cam.map(v => +v.toFixed(1)), target: target.map(v => +v.toFixed(1)), note, ogTau: shot.ogTau ?? null };
    }, shot);
    if (found.error) { console.log(name, found.error); continue; }
    record[name] = found;
    for (const tag of ['before', 'after']) {
      const png = await page.evaluate(({ tag }) => {
        const u = window.__ug, rr = u.composer.renderer, gl = rr.getContext();
        const g = u.surfaceTrains.group; g.visible = tag === 'after';
        u.undergroundCull.render(u.aboveGroundView && u.economies.on('underAbove'), () => u.composer.render(0));
        g.visible = true;
        rr.setRenderTarget(null);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'), img = cx.createImageData(W, H);
        for (let y = 0; y < H; y++) img.data.set(b.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        cx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      }, { tag });
      await writeFile(`${outDir}/${name}-${tag}.png`, Buffer.from(png.split(',')[1], 'base64'));
    }
    console.log(name, JSON.stringify(found));
  }
  await writeFile(`${outDir}/shots.json`, JSON.stringify(record, null, 1));
  await browser.close();
}
