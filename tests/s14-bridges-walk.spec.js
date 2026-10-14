// Lane S (sprint 14Oct26w, D-053 item 8): every Thames bridge is solid and walkable for the Pedestrian walker.
// Real app, real baked city, the Pedestrian mode driven by W in one synchronous loop of modes.update(1/60).
// Acceptance ids in the test names: S-01 to S-09 (S-24 inventory rides along).

import { test, expect } from '@playwright/test';
import { boot, enter, setMaster, VE } from './s14-helpers.js';

test.describe.configure({ mode: 'serial' });
test.setTimeout(900000);

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => { (page.__errors ??= []).push(String(e)); });
  page.on('console', (m) => { if (m.type() === 'error') (page.__errors ??= []).push(m.text()); });
  await boot(page);
  await enter(page, '2');
});
test.afterAll(async () => { await page?.close(); });

const DECKS = async () => page.evaluate(() => {
  const out = [];
  for (const [slug, rec] of window.__s14.solidBridges()) out.push([slug, slug === 'golden-jubilee-foot' ? [-11, 11] : [0]]);
  return out;
});

async function walkAll(master) {
  await setMaster(page, master);
  const rows = [];
  for (const [slug, offs] of await DECKS()) {
    for (const vOff of offs) rows.push(await page.evaluate(([s, v]) => window.__s14.bridgeWalk(s, v), [slug, vOff]));
  }
  console.log(`# walk table, Master ${master}: bridge off blocked hw furthest/L minRel maxRel steps`);
  for (const r of rows) {
    console.log(`#  ${r.slug.padEnd(22)} ${String(r.vOff).padStart(3)} ${r.blocked ? 'B' : '-'} hw ${r.hw?.toFixed(1)} ${r.furthest.toFixed(1)}/${r.L.toFixed(1)} rel ${r.minRel.toFixed(2)}..${r.maxRel.toFixed(2)} off ${r.maxOff.toFixed(1)} noHit ${r.noHit} air ${r.airMax} swim ${r.swim} steps ${r.steps}${r.card ? ' CARD' : ''}`);
  }
  return rows;
}

function judge(rows) {
  const failures = [];
  for (const r of rows) {
    const tag = `${r.slug}@${r.vOff}`;
    if (r.swim) failures.push(`${tag}: swam`);
    if (r.minRel < -1.0 || r.maxRel > 0.25) failures.push(`${tag}: y - top ${r.minRel.toFixed(2)}..${r.maxRel.toFixed(2)} m`);
    if (r.maxOff > r.hw + 1e-6) failures.push(`${tag}: off the deck by ${(r.maxOff - r.hw).toFixed(2)} m`);
    if (r.airMax > 15) failures.push(`${tag}: airborne ${r.airMax} frames in a row`);
    const cannon = r.slug === 'cannon-street-rail';
    if (cannon ? !(r.furthest >= 0.8 * r.L) : !(r.furthest >= r.L + 2)) failures.push(`${tag}: reached ${r.furthest.toFixed(1)} of ${r.L.toFixed(1)}`);
    if (cannon && !r.card && r.furthest < r.L + 2) failures.push(`${tag}: stopped without the card`);
  }
  return failures;
}

test('S-24 solid inventory with the motorway attached', async () => {
  const st = await page.evaluate(() => window.__ug.modes.collision.solidStats());
  console.log('# solidStats', JSON.stringify(st));
  expect(st.errors).toEqual([]);
  expect(st.bridges).toBe(39);
  expect(st.decks).toBeGreaterThanOrEqual(40);
  expect(st.motorwaySegments).toBeGreaterThanOrEqual(20);
  expect(st.stations).toBeGreaterThanOrEqual(390);
  expect(st.parapets).toBeGreaterThanOrEqual(80);
  expect(st.ramps).toBeGreaterThanOrEqual(78);
});

test('S-01 and S-03 every bridge walkable at Master 1, with no jump', async () => {
  const failures = judge(await walkAll(1));
  expect(failures).toEqual([]);
});

test('S-02 and S-03 every bridge walkable at Master 1.5', async () => {
  const failures = judge(await walkAll(1.5));
  await setMaster(page, 1);
  expect(failures).toEqual([]);
});

test('S-04 the two M25 crossings are walkable motorway decks', async () => {
  await setMaster(page, 1);
  const res = await page.evaluate(() => {
    const ug = window.__ug, T = window.__ugTHREE, VE = 5, c = ug.modes.collision;
    const group = ug.scene.getObjectByName('m25Motorway');
    const road = group.getObjectByName('m25-road');
    const ray = new T.Raycaster();
    const m = ug.modes.registry.get('pedestrian');
    const out = [];
    for (const rp of group.userData.roadPaths.values()) {
      if (!rp.road.bridge || rp.road.tunnel) continue;
      const s = rp.samples;
      const first = s.findIndex(p => c.waterAt(p.x, p.z));
      if (first < 0) continue;
      const i0 = Math.max(0, first - 5);
      const p0 = s[i0];
      m.place(p0.x, p0.z, { yaw: window.__s14.yawOf(p0.dx, p0.dz), pitch: 0 });
      ug.fpsControls.keys.add('w');
      let swim = false, worst = 0, checked = 0, along = 0;
      for (let k = 0; k < 2000; k++) {
        ug.modes.update(1 / 60);
        const d = m.debug();
        if (d.state === 'swim') swim = true;
        ray.set(new T.Vector3(d.x, d.y + 2.5 * VE, d.z), new T.Vector3(0, -1, 0)); ray.far = 1e4;
        const h = ray.intersectObject(road, false)[0];
        if (h) { checked++; worst = Math.max(worst, Math.abs(d.y - h.point.y) / VE); }
        along = (d.x - p0.x) * p0.dx + (d.z - p0.z) * p0.dz;
      }
      ug.fpsControls.keys.delete('w');
      out.push({ id: rp.road.id, swim, worstM: worst, checked, along });
    }
    return out;
  });
  console.log('# motorway walks', JSON.stringify(res));
  expect(res.length).toBeGreaterThanOrEqual(2);
  for (const r of res) { expect(r.swim, `${r.id} swam`).toBe(false); expect(r.worstM, `${r.id}`).toBeLessThanOrEqual(0.25); expect(r.checked).toBeGreaterThan(500); }
});

test('S-05 never both, never neither on the two hidden registry decks', async () => {
  const res = await page.evaluate(() => {
    const ug = window.__ug, c = ug.modes.collision, lib = window.__s14, VE = 5;
    const group = ug.scene.getObjectByName('m25Motorway');
    const samples = [];
    for (const rp of group.userData.roadPaths.values()) for (const s of rp.samples) samples.push(s);
    const out = { hidden: [], road: [] };
    for (const slug of ['qe2', 'runnymede']) {
      const rec = ug.bridgeRegistry.get(slug);
      if (rec.group.visible) { out.hidden.push([slug, 'visible']); continue; }
      const f = lib.frame(rec);
      let n = 0;
      for (let u = f.L * 0.1; u < f.L * 0.9 && n < 5; u += f.L * 0.05) {
        const p = lib.at(f, u, 0);
        if (!c.waterAt(p.x, p.z)) continue;
        if (samples.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 30)) continue;
        const top = lib.deckTop(rec, p.x, p.z);
        if (top === null) continue;
        n++;
        const stand = c.standHeightAt(p.x, p.z, Infinity, 0);
        out.hidden.push([slug, Math.abs(stand - top) / VE]);
      }
    }
    for (const rp of group.userData.roadPaths.values()) {
      if (!rp.road.bridge || rp.road.tunnel) continue;
      const wet = rp.samples.filter(s => c.waterAt(s.x, s.z));
      for (let i = 0; i < Math.min(5, wet.length); i++) {
        const s = wet[Math.floor(i * (wet.length - 1) / 4)];
        const road = group.getObjectByName('m25-road');
        const ray = new window.__ugTHREE.Raycaster();
        ray.set(new window.__ugTHREE.Vector3(s.x, 1e5, s.z), new window.__ugTHREE.Vector3(0, -1, 0)); ray.far = 2e5;
        const h = ray.intersectObject(road, false)[0];
        if (h) out.road.push(Math.abs(c.standHeightAt(s.x, s.z, Infinity, 0) - h.point.y) / VE);
      }
    }
    return out;
  });
  console.log('# never both / never neither', JSON.stringify(res));
  expect(res.hidden.length).toBeGreaterThan(0);
  for (const [, d] of res.hidden) expect(d).toBeGreaterThan(0.5);
  expect(res.road.length).toBeGreaterThan(4);
  for (const d of res.road) expect(d).toBeLessThanOrEqual(0.05);
});

test('S-06 the collision deck follows the drawn deck at Master 1, 1.1 and 1.5', async () => {
  const bad = [];
  for (const M of [1, 1.1, 1.5]) {
    await setMaster(page, M);
    const res = await page.evaluate(() => {
      const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5;
      const out = { n: 0, bad: [] };
      for (const [slug] of lib.solidBridges()) {
        for (const vOff of slug === 'golden-jubilee-foot' ? [-11, 11] : [0]) {
          const rec = ug.bridgeRegistry.get(slug), f = lib.frame(rec, vOff);
          for (let k = 1; k <= 9; k++) {
            const p = lib.at(f, f.L * k / 10, 0);
            const top = lib.deckTop(rec, p.x, p.z);
            if (top === null) continue;
            const stand = c.standHeightAt(p.x, p.z, top + 0.1 * VE, 0);
            const w = c.waterAt(p.x, p.z), g = w ? w.surfaceY : c.groundHeightAt(p.x, p.z);
            const under = lib.undersideAbove(rec, p.x, g + 0.01, p.z);
            const ceil = c.ceilingAt(p.x, p.z, g);
            out.n++;
            const e1 = Math.abs(stand - top) / VE, e2 = under === null || ceil === null ? (under === ceil ? 0 : 99) : Math.abs(ceil - under) / VE;
            if (e1 > 0.05 || e2 > 0.05) out.bad.push(`${slug}@${vOff} u${k}: stand ${e1.toFixed(3)} ceil ${e2.toFixed(3)}`);
          }
        }
      }
      return out;
    });
    console.log(`# S-06 Master ${M}: ${res.n} points, ${res.bad.length} off`);
    for (const b of res.bad) bad.push(`M${M} ${b}`);
  }
  await setMaster(page, 1);
  expect(bad).toEqual([]);
});

test('S-07 a parapet keeps the walker on Westminster Bridge', async () => {
  await setMaster(page, 1);
  const res = await page.evaluate(() => {
    const ug = window.__ug, lib = window.__s14;
    const rec = ug.bridgeRegistry.get('westminster'), f = lib.frame(rec), hw = lib.halfWidth(rec, f);
    const out = [];
    for (const side of [1, -1]) {
      const p = lib.at(f, f.L / 2, 0);
      const dx = (f.ux + side * f.nx) * Math.SQRT1_2, dz = (f.uz + side * f.nz) * Math.SQRT1_2;
      let maxOff = 0;
      const r = lib.walk({ x0: p.x, z0: p.z, dx, dz, maxSteps: 600, onStep: (d) => {
        const v = Math.abs((d.x - f.a.x) * f.nx + (d.z - f.a.z) * f.nz);
        if (v > maxOff) maxOff = v;
      } });
      const along = (r.last.x - p.x) * f.ux + (r.last.z - p.z) * f.uz;
      out.push({ side, hw, maxOff, along, swim: r.swim });
    }
    return out;
  });
  console.log('# S-07', JSON.stringify(res));
  for (const r of res) { expect(r.maxOff).toBeLessThanOrEqual(r.hw + 1e-6); expect(r.swim).toBe(false); expect(r.along).toBeGreaterThanOrEqual(5); }
});

test('S-08 the walker on the bank under a bridge approach is not lifted onto the deck', async () => {
  await setMaster(page, 1);
  const res = await page.evaluate(() => {
    const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5;
    const sb = ug.stationBuildings;
    const table = [];
    for (const slug of ['westminster', 'lambeth', 'waterloo', 'blackfriars', 'southwark', 'london', 'tower', 'vauxhall']) {
      const rec = ug.bridgeRegistry.get(slug);
      if (!rec) continue;
      const f = lib.frame(rec), hw = lib.halfWidth(rec, f) ?? 8;
      for (const end of ['a', 'b']) {
        for (let d = 0; d <= 70; d += 2) {
          const u = end === 'a' ? d : f.L - d;
          const P = lib.at(f, u, 0);
          if (c.waterAt(P.x, P.z)) continue;
          const g = c.groundHeightAt(P.x, P.z);
          const under = lib.undersideAbove(rec, P.x, g + 0.01, P.z);
          if (under === null || (under - g) / VE < 3.0) continue;
          let clear = true;
          for (let s = -(hw + 15); s <= hw + 15; s++) {
            const q = lib.at(f, u, s);
            if (c.buildingsNear(q.x, q.z, 0.4).length || sb.contactAt(q.x, q.z, 40)) { clear = false; break; }
          }
          table.push(`${slug}/${end}/${d}m under ${((under - g) / VE).toFixed(1)} m clear ${clear}`);
          if (!clear) continue;
          const start = lib.at(f, u, -(hw + 15));
          const m = ug.modes.registry.get('pedestrian');
          let worst = 0, swim = false;
          const r = lib.walk({ x0: start.x, z0: start.z, dx: f.nx, dz: f.nz, maxSteps: 1000, onStep: (dd) => {
            const gg = c.groundHeightAt(dd.x, dd.z);
            worst = Math.max(worst, Math.abs(dd.y - gg) / VE);
            if (dd.state === 'swim') swim = true;
          } });
          const past = (r.last.x - P.x) * f.nx + (r.last.z - P.z) * f.nz;
          return { slug, end, d, under: (under - g) / VE, worst, swim, past, hw, table };
        }
      }
    }
    return { fail: true, table };
  });
  console.log('# S-08', JSON.stringify(res));
  expect(res.fail, JSON.stringify(res.table)).toBeUndefined();
  expect(res.worst).toBeLessThanOrEqual(0.15);
  expect(res.swim).toBe(false);
  expect(res.past).toBeGreaterThanOrEqual(res.hw + 10);
});

test('S-09 a swimmer passes under a deck', async () => {
  const run = async (slug, master, mode) => {
    await setMaster(page, master);
    return page.evaluate(([slug, mode]) => {
      const ug = window.__ug, lib = window.__s14, c = ug.modes.collision, VE = 5;
      const rec = ug.bridgeRegistry.get(slug), f = lib.frame(rec);
      const hw = lib.halfWidth(rec, f) ?? 8;
      let u = f.L / 2;
      if (mode === 'gap') {
        // midway between two adjacent river piers (the same anchors the sea life uses)
        const anchors = window.__s14.piers(rec);
        const us = anchors.map(a => (a.x - f.a.x) * f.ux + (a.z - f.a.z) * f.uz).filter(x => x > 0 && x < f.L).sort((a, b) => a - b);
        let best = 0, gap = null;
        for (let i = 0; i + 1 < us.length; i++) if (us[i + 1] - us[i] > best) { best = us[i + 1] - us[i]; gap = (us[i] + us[i + 1]) / 2; }
        if (gap !== null) u = gap;
      } else u = f.L / 2 + 30;
      const start = lib.at(f, u, -(hw + 25));
      const m = ug.modes.registry.get('pedestrian');
      m.place(start.x, start.z, { yaw: lib.yawOf(f.nx, f.nz), pitch: 0 });
      const d0 = m.debug();
      ug.fpsControls.keys.add('w');
      let swimAlways = d0.state === 'swim', headOk = true, steps = 0, worst = -Infinity;
      for (let i = 0; i < 3000; i++) {
        ug.modes.update(1 / 60); steps++;
        const d = m.debug();
        if (d.state !== 'swim') swimAlways = false;
        const v = (d.x - f.a.x) * f.nx + (d.z - f.a.z) * f.nz;
        if (Math.abs(v) <= hw) {
          const under = lib.undersideAbove(rec, d.x, d.y, d.z);
          if (under !== null) { const clear = (under - (d.y + 1.85 * VE)) / VE; if (-clear > worst) worst = -clear; if (clear < 0) headOk = false; }
        }
        if (v > hw + 15) break;
      }
      ug.fpsControls.keys.delete('w');
      const d = m.debug();
      return { slug, startedSwimming: d0.state === 'swim', swimAlways, headOk, past: (d.x - f.a.x) * f.nx + (d.z - f.a.z) * f.nz - hw, steps };
    }, [slug, mode]);
  };
  const w = await run('westminster', 1, 'gap');
  const h = await run('hammersmith', 1.5, 'mid');
  await setMaster(page, 1);
  console.log('# S-09', JSON.stringify([w, h]));
  for (const r of [w, h]) { expect(r.startedSwimming).toBe(true); expect(r.headOk).toBe(true); expect(r.past).toBeGreaterThanOrEqual(15); }
});

test('S-25 no console errors from any walk', async () => {
  expect(page.__errors ?? []).toEqual([]);
});
