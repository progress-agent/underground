// Nothing built underground pokes up out of the river bed (sprint 25Sep26f,
// D-039 Lane E). Jordan saw tunnels and sewers standing proud of the Thames
// bed, the District line drawn in tunnel where it really crosses on railway
// bridges (Putney, Kew), and the Thames Tunnel 20 m under the bed where it is
// really a few metres.
//
// Contract, per vertex: inside the river mask and below the water line, no
// tunnel, sewer or rail vertex may sit above the rendered bed (plus a small
// tolerance). Above the water line a vertex is a bridge crossing, which is only
// allowed where sourced (rail-truth.js); those corridors are excluded here and
// asserted positively instead.

import { test, expect } from '@playwright/test';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';
import { RAIL_BRIDGE_CROSSINGS, THAMES_TUNNEL } from '../src/rail-truth.js';

const TOL_M = 0.25; // real metres

async function ready(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(() => {
    const ug = window.__ug;
    if (!ug?.scene || !ug.thamesProfileSampler || !ug.overground) return false;
    const d = ug.lineBranchCenterPts?.get('district');
    if (!d || !d.some(b => b.some(p => p._bridge))) return false;
    const types = new Set();
    ug.scene.traverse(o => { if (o.isMesh && o.userData?.type) types.add(o.userData.type); });
    return ['tube-line', 'sewer', 'tideway-tunnel', 'crossrail', 'overground-line'].every(t => types.has(t));
  }, null, { timeout: 110000 });
}

/** Per-type offenders: vertices in the river, under water, above the bed. */
async function offenders(page, types, excludeCorridors) {
  return page.evaluate(({ types, excludeCorridors, tolM }) => {
    const ug = window.__ug, VE = ug.VERTICAL_EXAGGERATION, top = ug.WATER_TOP_Y;
    const v = new ug.camera.position.constructor();
    const nearCorridor = (x, z) => excludeCorridors.some(c => {
      const dx = c.bx - c.ax, dz = c.bz - c.az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / l2));
      return Math.hypot(x - (c.ax + t * dx), z - (c.az + t * dz)) < c.r;
    });
    const out = {};
    ug.scene.traverse(o => {
      const type = o.userData?.type;
      if (!o.isMesh || !types.includes(type)) return;
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.getAttribute('position');
      const rec = out[type] ||= { checked: 0, bad: 0, worstM: 0, sample: null };
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y >= top || !ug.isInThames(v.x, v.z)) continue;
        if (type === 'tube-line' && nearCorridor(v.x, v.z)) continue;
        const bed = ug.getTerrainMeshSurfaceY({ x: v.x, z: v.z });
        if (bed === null) continue;
        rec.checked++;
        const aboveM = (v.y - bed) / VE;
        if (aboveM > tolM) {
          rec.bad++;
          if (aboveM > rec.worstM) { rec.worstM = aboveM; rec.sample = { x: Math.round(v.x), z: Math.round(v.z), name: o.userData.name ?? o.name }; }
        }
      }
    });
    return out;
  }, { types, excludeCorridors, tolM: TOL_M });
}

const corridors = RAIL_BRIDGE_CROSSINGS.map(c => ({
  ax: c.axis.a.e - BNG_REF_E, az: BNG_REF_N - c.axis.a.n, bx: c.axis.b.e - BNG_REF_E, bz: BNG_REF_N - c.axis.b.n, r: 80,
}));

test('tube lines, Crossrail, Tideway and the Overground stay under the river bed', async ({ page }) => {
  await ready(page);
  const r = await offenders(page, ['tube-line', 'crossrail', 'tideway-tunnel', 'lee-tunnel', 'overground-line'], corridors);
  console.log('[river-crossing] offenders', JSON.stringify(r));
  for (const [type, rec] of Object.entries(r)) {
    expect(rec.bad, `${type}: ${rec.bad}/${rec.checked} vertices above the bed, worst ${rec.worstM.toFixed(2)} m at ${JSON.stringify(rec.sample)}`).toBe(0);
  }
  expect(r['tube-line'].checked).toBeGreaterThan(1000);
});

test('Victorian sewers stay under the river bed', async ({ page }) => {
  // EXPECTED UNTIL MERGE: Lane W (sprint 25Sep26f) clamps the sewers under
  // the bed in sewers.js (they stand 0.8 to 2.2 m proud near London Bridge
  // and Vauxhall). Lane E does not edit sewers.js. On a branch without Lane W
  // this test is expected to fail; once W is merged it passes, Playwright
  // reports the expected failure as an error, and this marker must be removed.
  test.fail(true, 'expected until Lane W (sewer clamp) is merged');
  await ready(page);
  const r = await offenders(page, ['sewer'], []);
  console.log('[river-crossing] sewers', JSON.stringify(r.sewer));
  expect(r.sewer.checked).toBeGreaterThan(0);
  expect(r.sewer.bad, `sewer: ${r.sewer.bad}/${r.sewer.checked}, worst ${r.sewer.worstM.toFixed(2)} m at ${JSON.stringify(r.sewer.sample)}`).toBe(0);
});

test('District line crosses on Fulham and Kew railway bridges, on the deck, above the water', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const ug = window.__ug, reg = ug.bridgeRegistry;
    const out = [];
    for (const branch of ug.lineBranchCenterPts.get('district')) {
      for (const p of branch) if (p._bridge) out.push({ bridge: p._bridge.bridge, y: p.y, deckY: reg.get(p._bridge.bridge)?.deckY ?? null });
    }
    return { pts: out, top: ug.WATER_TOP_Y };
  });
  console.log('[river-crossing] district deck points', JSON.stringify(r));
  const byBridge = new Map();
  for (const p of r.pts) (byBridge.get(p.bridge) ?? byBridge.set(p.bridge, []).get(p.bridge)).push(p);
  expect([...byBridge.keys()].sort()).toEqual(['fulham-rail', 'kew-rail']);
  for (const [slug, pts] of byBridge) {
    expect(pts.length % 2, slug).toBe(0);
    for (const p of pts) {
      expect(p.y, slug).toBeGreaterThan(r.top);
      if (p.deckY !== null) expect(p.y, slug).toBeGreaterThan(p.deckY);
    }
  }
});

test('Thames Tunnel (Wapping to Rotherhithe) runs about 5 m below the bed, not 20 m', async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const ug = window.__ug, VE = ug.VERTICAL_EXAGGERATION, top = ug.WATER_TOP_Y;
    const v = new ug.camera.position.constructor();
    const depths = [];
    ug.overground.traverse(o => {
      if (!o.isMesh || o.userData?.lineId !== 'windrush') return;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        // Wapping to Rotherhithe reach only.
        if (v.x < 4700 || v.x > 5600 || v.z < 0 || v.z > 800) continue;
        if (v.y >= top || !ug.isInThames(v.x, v.z)) continue;
        depths.push((ug.getTerrainMeshSurfaceY({ x: v.x, z: v.z }) - v.y) / VE);
      }
    });
    depths.sort((a, b) => a - b);
    return { n: depths.length, min: depths[0], median: depths[Math.floor(depths.length / 2)], max: depths.at(-1) };
  });
  console.log('[river-crossing] thames tunnel depth below bed (m)', JSON.stringify(r));
  expect(r.n).toBeGreaterThan(4);
  // The stripe rides STRIPE_LIFT (0.16 m) above the path; the path is 5.2 m
  // down. Before the fix it read 6.7 m mid-river (20 m under the unrefined
  // structural ground, which sits 12 m above the rendered bed there).
  expect(r.min).toBeGreaterThan(THAMES_TUNNEL.centreBelowBedM - 0.5);
  expect(Math.abs(r.median - THAMES_TUNNEL.centreBelowBedM)).toBeLessThan(0.5);
});
