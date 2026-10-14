// Lane S (sprint 14Oct26w): what must NOT change. A walker at the foot of an Overground viaduct and under the
// DLR deck at Pudding Mill Lane is not lifted onto it, and traces the same feet as the bf10309 livebase
// (port 5278, or UG_LIVEBASE) within 0.05 m. Acceptance S-20.

import { test, expect } from '@playwright/test';
import proj4 from 'proj4';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
import { boot, enter } from './s14-helpers.js';

test.setTimeout(900000);

const toXZ = (lat, lon) => {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) };
};
const SITES = [
  { id: 'dlr-pudding-mill', centre: toXZ(51.5343, -0.0139), group: (u) => u.scene.children.filter(c => c.name.startsWith('surface-rail-dlr')), radius: 400 },
  { id: 'overground-shoreditch', centre: toXZ(51.5233, -0.0752), group: (u) => [u.overground], radius: 600 },
  { id: 'overground-dalston', centre: toXZ(51.5461, -0.0752), group: (u) => [u.overground], radius: 600 },
];

async function locate(page) {
  const found = [];
  for (const s of SITES) {
    const pt = await page.evaluate(([site, fnSrc]) => {
      const ug = window.__ug, T = window.__ugTHREE, c = ug.modes.collision, VE = 5;
      const roots = new Function('u', `return (${fnSrc})(u)`)(ug).filter(Boolean);
      const meshes = [];
      for (const r of roots) r.traverse((o) => { if (o.isMesh && o.visible !== false) meshes.push(o); });
      const ray = new T.Raycaster();
      const best = [];
      for (let dx = -site.radius; dx <= site.radius; dx += 5) for (let dz = -site.radius; dz <= site.radius; dz += 5) {
        const x = site.centre.x + dx, z = site.centre.z + dz, g = c.groundHeightAt(x, z);
        if (g === null) continue;
        ray.set(new T.Vector3(x, g + 0.01, z), new T.Vector3(0, 1, 0)); ray.far = 400;
        const h = ray.intersectObjects(meshes, false)[0];
        if (!h || (h.point.y - g) / VE < 3.0) continue;
        if (c.buildingsNear(x, z, 0.4).length || ug.stationBuildings.contactAt(x, z, 40)) continue;
        best.push({ x, z, d: Math.hypot(dx, dz), under: (h.point.y - g) / VE });
      }
      best.sort((a, b) => a.d - b.d);
      return best[0] ?? null;
    }, [s, s.group.toString()]);
    if (pt) found.push({ id: s.id, ...pt });
  }
  return found;
}

async function traces(page, points) {
  return page.evaluate((points) => {
    const ug = window.__ug, m = ug.modes.registry.get('pedestrian'), c = ug.modes.collision, VE = 5;
    const out = {};
    for (const p of points) {
      const runs = [];
      for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        m.place(p.x, p.z, { yaw, pitch: 0 });
        const d0 = m.debug();
        const ys = [d0.y];
        ug.fpsControls.keys.add('w');
        for (let i = 0; i < 300; i++) { ug.modes.update(1 / 60); ys.push(m.debug().y); }
        ug.fpsControls.keys.delete('w');
        runs.push(ys);
      }
      const d = m.debug();
      out[p.id] = { runs, placedErr: Math.abs(runs[0][0] - c.groundHeightAt(p.x, p.z)) / VE };
    }
    return out;
  }, points);
}

test('S-20 viaducts and the DLR deck stay unwalkable, exactly as on bf10309', async ({ browser }) => {
  const lane = await browser.newPage();
  await boot(lane, { motorway: false });
  await enter(lane, '2');
  const points = await locate(lane);
  console.log('# S-20 points', JSON.stringify(points));
  expect(points.length).toBeGreaterThanOrEqual(2);
  const laneTraces = await traces(lane, points);
  await lane.close();
  for (const [id, t] of Object.entries(laneTraces)) expect(t.placedErr, `${id} placed on the terrain`).toBeLessThanOrEqual(0.5);
  const base = process.env.UG_LIVEBASE ?? 'http://localhost:5278';
  const alive = await fetch(base).then(r => r.ok, () => false);
  if (!alive) { console.log('# livebase not reachable, comparison skipped'); return; }
  const live = await browser.newPage();
  await live.goto(`${base}/?skip=1&buildings=baked`);
  await live.waitForFunction(() => !!(window.__ug && window.__ug.modes && !window.__ug.intro.isRunning() && window.__ug.stationBuildings.ready
    && window.__ug.bakedStats?.tilesBuilt === window.__ug.bakedStats?.tilesTotal), null, { timeout: 180000 });
  await live.keyboard.press('2');
  await live.waitForFunction(() => window.__ug.modes.registry.get('pedestrian').debug().phase === 'body', null, { timeout: 30000 });
  const liveTraces = await traces(live, points);
  await live.close();
  for (const p of points) {
    let worst = 0;
    laneTraces[p.id].runs.forEach((ys, r) => ys.forEach((y, i) => { worst = Math.max(worst, Math.abs(y - liveTraces[p.id].runs[r][i]) / 5); }));
    console.log(`# S-20 ${p.id}: worst feet difference against bf10309 ${worst.toFixed(4)} m`);
    expect(worst, p.id).toBeLessThanOrEqual(0.05);
  }
});
