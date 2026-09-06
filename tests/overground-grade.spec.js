// Overground at-grade contract + building height multiplier (06Sep26u, D-023/D-024).
//
// Both behaviours below fail SILENTLY when undone — geometry that sinks into an
// opaque terrain mesh throws nothing and looks like missing data, which is
// exactly how 14.1% of the Overground network stayed invisible from 11Jul26s
// until Jordan reported it at Highbury & Islington on 06Sep26u.
//
// Contract 1: no earthworks class EXCEPT `tunnel` may render below the terrain.
//   The terrain mesh is 512x512 over 70x50km (~137m x 98m per cell), so a 20m
//   railway cutting is an order of magnitude below the grid's resolution and
//   cannot be carved. Cuttings therefore render at grade, recessed by tone
//   (flanking dark bands), and buildPath applies a hard terrain floor to every
//   non-tunnel point AFTER the smoothing pass — because smoothing blends across
//   class boundaries and a tunnel at -20m real drags its neighbours down with
//   it for a long way either side of every portal.
//
// Contract 2: building height is its own multiplier, applied in the shader over
//   base-pivoted geometry. If the box is ever re-centred (pivot at middle) the
//   slider silently starts scaling buildings about their centres, sinking half
//   of every building into the ground.

import { test, expect } from '@playwright/test';

// Dressing materials — ballast, earth, masonry, cut-shadow, train body, train
// windows. Everything else on an overground line group is an identity stripe.
const DRESSING = new Set(['4c4741', '5d5142', '8d8778', '272320', '22252a', 'ffb14e']);

test('no non-tunnel overground track renders below the terrain', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug?.overground?.children.length > 0
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function',
    { timeout: 120000 });
  await page.waitForTimeout(4000);

  const out = await page.evaluate((dressing) => {
    const ug = window.__ug, VE = ug.VERTICAL_EXAGGERATION;
    const DRESS = new Set(dressing);
    let total = 0, buried = 0, shallowBuried = 0, grazing = 0;
    ug.overground.traverse(o => {
      if (!o.isMesh) return;
      const hex = o.material?.color?.getHexString?.();
      if (!hex || DRESS.has(hex)) return;
      const pos = o.geometry?.attributes?.position; if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const tY = ug.getTerrainMeshSurfaceY({ x: pos.getX(i), z: pos.getZ(i) });
        if (tY === null || tY === undefined) continue;
        const above = (pos.getY(i) - tY) / VE;
        total++;
        if (above < -0.5) {
          buried++;
          // A tunnel sits at -20m real; its portal descent ramps down to meet
          // it. Anything buried by LESS than 5m has no earthworks class that
          // justifies it and is the regression this test exists to catch.
          if (above > -5) shallowBuried++;
        } else if (above < 0.35) grazing++;
      }
    });
    return { total, buried, shallowBuried, grazing };
  }, [...DRESSING]);

  console.log(`stripe verts ${out.total} | buried ${(100*out.buried/out.total).toFixed(1)}% ` +
    `| shallow-buried ${(100*out.shallowBuried/out.total).toFixed(2)}% | grazing ${(100*out.grazing/out.total).toFixed(2)}%`);

  expect(out.total).toBeGreaterThan(20000);
  // Measured 06Sep26u: 0.46% shallow-buried, 5.7% buried overall (of which
  // 5.2% is tunnel or portal descent), 0.03% grazing. Bounds are set with
  // headroom, not on the nose — the point is to catch a return to 14%/9%.
  expect(out.shallowBuried / out.total).toBeLessThan(0.02);
  expect(out.buried / out.total).toBeLessThan(0.09);
  expect(out.grazing / out.total).toBeLessThan(0.02);
});

test('building height multiplier scales about the footprint, not the centre', async ({ page }) => {
  await page.goto('/?fast=1');
  await page.waitForFunction(
    () => window.__ug?.setBuildingHeightScale && window.__ug.surfaceGeometryGroup,
    { timeout: 120000 });
  await page.waitForTimeout(6000);

  const geo = await page.evaluate(() => {
    const g = window.__ug.surfaceGeometryGroup;
    let mesh = null;
    g.traverse(o => { if (!mesh && o.isInstancedMesh) mesh = o; });
    if (!mesh) return null;
    const bb = mesh.geometry.boundingBox
      || (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
    return { minY: bb.min.y, maxY: bb.max.y };
  });
  expect(geo, 'no building InstancedMesh found').not.toBeNull();
  // Base-pivoted unit box: local y runs 0..1, NOT -0.5..0.5. If this flips,
  // uHeightScale starts scaling buildings about their centres and sinks half
  // of every one of them into the terrain.
  expect(geo.minY).toBeCloseTo(0, 5);
  expect(geo.maxY).toBeCloseTo(1, 5);

  const slider = await page.evaluate(() => {
    const el = document.getElementById('buildingHeight');
    return el ? { min: +el.min, max: +el.max, value: +el.value } : null;
  });
  expect(slider, 'building height slider missing from HUD').not.toBeNull();
  expect(slider.value).toBe(5);   // defaults to the historical VE-matched look

  const clamped = await page.evaluate(() => {
    const ug = window.__ug;
    ug.setBuildingHeightScale(3);      // above the cap
    const high = ug.getBuildingHeightScale();
    ug.setBuildingHeightScale(0.4);
    const mid = ug.getBuildingHeightScale();
    ug.setBuildingHeightScale(1);
    return { high, mid };
  });
  // Cap is 1.0: the InstancedMesh bounding sphere encodes the unscaled height,
  // so a value above 1 pushes roofs outside the culling volume.
  expect(clamped.high).toBe(1);
  expect(clamped.mid).toBeCloseTo(0.4, 5);
});
