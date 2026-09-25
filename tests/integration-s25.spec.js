// integration-s25.spec.js: seams between the sprint 25Sep26f lanes (D-039).
//
// Lane S draws every bore round at its TRUE size, so a bore's canonical
// vertical half-extent is radius x (5 / Master), not radius. Lanes W and E
// were each built without S and placed things against the CPU geometry:
//   * W clamps the Victorian sewers under the river bed (sewers.js), and its
//     rebuilt tubes must keep S's axis attribute or the 'axis' patch reads 0;
//   * E seats the District on the Fulham and Kew railway-bridge decks, which
//     are structures whose height follows 1 / Master.
// Both checks below assert on what is DRAWN (the shader transform applied),
// at several Master values.
import { test, expect } from '@playwright/test';
import { tubeOnDeckY } from '../src/rail-truth.js';
import { BORE_DIAMETER_M } from '../src/true-proportion.js';

const MASTERS = [1, 1.1, 3, 10];
const setMasterSrc = `(m)=>{const el=document.getElementById('masterHeight');el.value=String(m);el.dispatchEvent(new Event('input',{bubbles:true}));window.__ug.structureMorph.flush();}`;

async function ready(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(() => {
    const ug = window.__ug;
    if (!ug?.scene || !ug.getSewerRoutes || !ug.bridgeRegistry?.size || !ug.structureMorph) return false;
    const d = ug.lineBranchCenterPts?.get('district');
    return !!(d && d.some(b => b.some(p => p._bridge))) && ug.getSewerRoutes().length > 0;
  }, null, { timeout: 180000 });
}

test('drawn sewer crowns stay under the river bed at every Master (W clamp x S true bores)', async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  for (const m of MASTERS) {
    await page.evaluate(`(${setMasterSrc})(${m})`);
    const r = await page.evaluate(() => {
      const u = window.__ug, TOP = u.WATER_TOP_Y, VE = u.VERTICAL_EXAGGERATION;
      const k = u.trueProportion.trueProportionUniform.value;
      let wet = 0, worst = -Infinity, missingAxis = 0, meshes = 0;
      for (const route of u.getSewerRoutes()) {
        for (const mesh of [route.mesh]) {
          meshes++;
          const p = mesh.geometry.attributes.position, a = mesh.geometry.attributes.trueAxisY;
          if (!a) { missingAxis++; continue; }
          for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            if (!u.isInThames(x, z)) continue;
            const f = u.getTerrainMeshSurfaceY({ x, z });
            if (!(f < TOP)) continue;
            const drawnY = a.getX(i) + (p.getY(i) - a.getX(i)) * k; // the 'axis' patch
            wet++; worst = Math.max(worst, (drawnY - f) / VE);
          }
        }
      }
      // Glow shells too: every sewer mesh must carry the axis attribute.
      u.scene.getObjectByName('sewer-tunnels')?.traverse(o => { if (o.isMesh && o.geometry.type === 'TubeGeometry' && !o.geometry.attributes.trueAxisY) missingAxis++; });
      return { k, wet, worst, missingAxis, meshes };
    });
    expect(r.missingAxis, `Master ${m}: sewer tubes without the true-proportion axis attribute`).toBe(0);
    expect(r.wet, `Master ${m}: sewer vertices under the river`).toBeGreaterThan(0);
    expect(r.worst, `Master ${m}: worst drawn sewer crown over the bed (real m)`).toBeLessThan(-0.2);
  }
});

test('District sits on the Fulham and Kew railway-bridge decks at every Master (E rail truth x S true decks)', async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  const radius = BORE_DIAMETER_M.district / 2;
  for (const m of MASTERS) {
    await page.evaluate(`(${setMasterSrc})(${m})`);
    const r = await page.evaluate(() => {
      const u = window.__ug, VE = u.VERTICAL_EXAGGERATION, ratio = u.getBuildingHeightScale();
      const pts = [];
      for (const b of u.lineBranchCenterPts.get('district')) for (const p of b) {
        if (p._bridge) pts.push({ bridge: p._bridge.bridge, y: p.y, deckY: u.bridgeRegistry.get(p._bridge.bridge)?.deckY });
      }
      return { VE, ratio, pts };
    });
    expect(r.ratio).toBeCloseTo(1 / m, 9);
    expect(new Set(r.pts.map(p => p.bridge))).toEqual(new Set(['fulham-rail', 'kew-rail']));
    const v = r.VE * r.ratio;
    for (const p of r.pts) {
      expect(Number.isFinite(p.deckY), `${p.bridge} live deck`).toBe(true);
      expect(p.y, `Master ${m}: ${p.bridge} bore centre on the morphed deck`).toBeCloseTo(tubeOnDeckY(p.deckY, v, radius * v), 6);
    }
  }
});
