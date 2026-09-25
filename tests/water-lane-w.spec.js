// water-lane-w.spec.js: sprint 25Sep26f, Lane W (D-039): Tideway whirlpools
// and underground-only shafts, Victorian sewers under the river bed, and
// water bodies (Royal Docks, reservoirs, canals) that occlude the underground.
//
// The occlusion checks are pixel checks, not flag checks: a bright magenta
// marker drawn like the underground infra (transparent queue, after the water)
// is placed under each water body, and a screenshot from above must not show
// it. On the base build the Royal Docks fail this (the old dock sheet did not
// write depth and the terrain is masked open over the wet polygons).

import { test, expect } from '@playwright/test';
import UPNG from 'upng-js';
import * as THREE from 'three';
import { FORESHORE_SITE_IDS, findNearest, buildWhirlpoolGeometry, createWhirlpoolMaterial } from '../src/tideway-whirlpool.js';
import { DOCK_DEPTHS, AIRPORT_DOCK_DATA, createAirportDockWater } from '../src/airport-docks.js';

test.describe('lane W: pure contracts (node)', () => {
  test('whirlpool geometry lies on the floor it is given and is deterministic', () => {
    const floorAt = (x, z) => -40 + 0.01 * x - 0.02 * z;
    const a = buildWhirlpoolGeometry({ cx: 100, cz: 50, innerR: 0.5, outerR: 24, floorAt });
    const b = buildWhirlpoolGeometry({ cx: 100, cz: 50, innerR: 0.5, outerR: 24, floorAt });
    expect(Array.from(a.attributes.position.array)).toEqual(Array.from(b.attributes.position.array));
    const p = a.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = floorAt(p.getX(i), p.getZ(i));
      expect(p.getY(i) - f).toBeGreaterThan(0);          // on, never under, the bed
      expect(p.getY(i) - f).toBeLessThan(0.5);
      expect(Math.hypot(p.getX(i) - 100, p.getZ(i) - 50)).toBeLessThanOrEqual(24.001);
    }
    const m = createWhirlpoolMaterial();
    expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false);
    expect(m.userData.whirlpoolUniforms.uTime.value).toBe(0);
  });

  test('findNearest walks out to the nearest satisfying point', () => {
    expect(findNearest(() => true, 5, 6)).toEqual({ x: 5, z: 6, moved: 0 });
    const r = findNearest((x) => x > 40, 0, 0, 100, 4);
    expect(r.moved).toBeGreaterThanOrEqual(40); expect(r.moved).toBeLessThanOrEqual(44);
    expect(findNearest(() => false, 0, 0, 20)).toBeNull();
  });

  test('eight foreshore sites; each dock has a sourced depth and a closed basin', () => {
    expect([...FORESHORE_SITE_IDS].sort()).toEqual(['albert', 'blackfriars', 'chambers', 'chelsea', 'heathwall', 'kemp', 'putney', 'victoria']);
    const root = createAirportDockWater({ surfaceAt: () => null });
    for (const [k, dock] of AIRPORT_DOCK_DATA.docks.entries()) {
      const d = DOCK_DEPTHS[dock.osm];
      expect(d.source).toMatch(/^https:\/\//);
      const mesh = root.children[k];
      expect(mesh.material.transparent).toBe(false);
      expect(mesh.material.depthWrite).toBe(true);
      const [bed, walls] = mesh.children;
      expect(bed.material.transparent).toBe(false); expect(walls.material.transparent).toBe(false);
      bed.geometry.computeBoundingBox();
      expect(bed.geometry.boundingBox.max.y).toBeCloseTo((dock.referenceLevelM - d.depthM) * 5, 3);
      walls.geometry.computeBoundingBox();
      expect(walls.geometry.boundingBox.min.y).toBeCloseTo((dock.referenceLevelM - d.depthM) * 5, 3);
      expect(walls.geometry.boundingBox.max.y).toBeGreaterThanOrEqual(dock.referenceLevelM * 5);
    }
    expect(DOCK_DEPTHS['way/121158887'].depthM).toBeCloseTo(8.2, 5);    // Royal Albert, 27 ft
    expect(DOCK_DEPTHS['way/190792949'].depthM).toBeCloseTo(11.6, 5);   // King George V, 38 ft
    root.userData.dispose();
  });
});

// ── Browser ─────────────────────────────────────────────────────────────
async function ready(page) {
  await page.goto('/?skip=1');
  await page.waitForFunction(() => {
    const u = window.__ug;
    return !!(u && u.intro && !u.intro.isRunning() && u.thamesMesh && u.airportDockGroup && u.tidewayWhirlpools
      && u.tidewayWhirlpools.children.length && u.getSewerRoutes().length && u.scene.getObjectByName('reservoirs')
      && u.scene.getObjectByName('canals'));
  }, null, { timeout: 180000 });
  await page.evaluate(() => { window.__ug.sim.paused = true; window.__ug.controls.enableDamping = false; });
}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));

test.describe('lane W: in the running app', () => {
  test('Tideway: no shaft rises above ground, bed or water; foreshore sites are whirlpools on the bed', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const u = window.__ug, nav = u.thamesMesh.userData.navigation, TOP = u.WATER_TOP_Y;
      const shafts = [];
      for (const name of ['tideway-shafts', 'lee-shafts']) {
        const g = u.scene.getObjectByName(name);
        for (const m of g.children) {
          const top = m.position.y + m.scale.y / 2, x = m.position.x, z = m.position.z;
          shafts.push({ id: m.userData.shaftId, top, floor: u.getTerrainMeshSurfaceY({ x, z }), wet: nav.containsXZ(x, z),
            inRiver: !!m.userData.inRiver, open: m.geometry.parameters.openEnded });
        }
      }
      const whirl = u.tidewayWhirlpools.children.map(w => {
        const p = w.geometry.attributes.position; let maxAbove = -Infinity, maxY = -Infinity, dry = 0;
        for (let i = 0; i < p.count; i += 7) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = u.getTerrainMeshSurfaceY({ x, z });
          maxAbove = Math.max(maxAbove, y - f); maxY = Math.max(maxY, y);
          if (!nav.containsXZ(x, z)) dry++;
        }
        return { id: w.userData.shaftId, maxAbove, maxY, dry, renderOrder: w.renderOrder, centreWet: nav.containsXZ(w.userData.centre.x, w.userData.centre.z) };
      });
      return { shafts, whirl, TOP };
    });
    expect(r.shafts.length).toBe(21 + 5);      // 21 Tideway shaft sites (Acton..Abbey Mills) + 5 Lee Tunnel shafts
    for (const s of r.shafts) {
      expect(s.open, s.id).toBe(true);                                   // no cap anywhere
      expect(s.top, `${s.id} top below its ground or bed`).toBeLessThan(s.floor);
      if (s.wet || s.inRiver) expect(s.top, `${s.id} under the water top`).toBeLessThan(r.TOP);
    }
    // Every foreshore site is a whirlpool in the modelled river; nothing else is.
    expect(r.whirl.map(w => w.id).sort()).toEqual(['albert', 'blackfriars', 'chambers', 'chelsea', 'heathwall', 'kemp', 'putney', 'victoria']);
    for (const w of r.whirl) {
      expect(w.centreWet, w.id).toBe(true);
      expect(w.dry, `${w.id} disc lies in the water`).toBe(0);
      expect(w.maxY, `${w.id} below the water top`).toBeLessThan(r.TOP);
      expect(w.maxAbove, `${w.id} lies on the bed`).toBeLessThan(0.6);
      expect(w.renderOrder).toBeLessThan(1);                              // before SURFACE_WATER
    }
    expect(r.shafts.filter(s => s.inRiver).map(s => s.id).sort()).toEqual(r.whirl.map(w => w.id).sort());
  });

  test('Tideway whirlpools turn with simulation time only', async ({ page }) => {
    await ready(page);
    const t = await page.evaluate(async () => {
      const u = window.__ug, uni = u.tidewayWhirlpools.children[0].material.userData.whirlpoolUniforms;
      u.setTidewayWhirlpoolTime(123.5);
      const a = uni.uTime.value;
      await new Promise(r => setTimeout(r, 400));                        // paused: no advance
      const b = uni.uTime.value;
      u.sim.paused = false;
      await new Promise(r => setTimeout(r, 600));
      const c = uni.uTime.value;
      u.sim.paused = true;
      return { a, b, c };
    });
    expect(t.a).toBe(123.5); expect(t.b).toBe(123.5); expect(t.c).toBeGreaterThan(123.5);
  });

  test('Victorian sewers: every crown under the modelled river bed', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const u = window.__ug, TOP = u.WATER_TOP_Y, VE = u.VERTICAL_EXAGGERATION;
      const out = {};
      for (const route of u.getSewerRoutes()) {
        const p = route.mesh.geometry.attributes.position;
        let worst = -Infinity, wet = 0;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          if (!u.isInThames(x, z)) continue;
          const f = u.getTerrainMeshSurfaceY({ x, z });
          if (!(f < TOP)) continue;
          wet++; worst = Math.max(worst, (y - f) / VE);                     // tube surface over bed, real metres
        }
        out[route.tunnelId] = { wet, worst, clamped: route.clampedSamples };
      }
      return out;
    });
    let crossings = 0;
    for (const [id, s] of Object.entries(r)) {
      if (!s.wet) continue;
      crossings++;
      expect(s.worst, `${id} crown clearance under the bed (m)`).toBeLessThan(-0.2);
    }
    expect(crossings).toBeGreaterThanOrEqual(2);
    // The two reported offenders (London Bridge and Vauxhall) were lowered.
    expect(r['northern-low-1'].clamped).toBeGreaterThan(0);
    expect(r['southern-low'].clamped).toBeGreaterThan(0);
  });

  test('Royal Docks: submerged only between the water and the dock bed', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => {
      const u = window.__ug, p = { x: 13100, z: 70 };
      const top = u.getAirportDockSurfaceY(p, 5), bed = u.getAirportDockBedY(p, 5);
      return { top, bed, mid: u.isSubmergedAt(p.x, (top + bed) / 2, p.z), under: u.isSubmergedAt(p.x, bed - 10, p.z), above: u.isSubmergedAt(p.x, top + 1, p.z) };
    });
    expect(r.bed).toBeLessThan(r.top);
    expect(r.mid).toBe(true); expect(r.under).toBe(false); expect(r.above).toBe(false);
  });

  // Pixel occlusion: a magenta marker under each water body, seen from above.
  const CASES = [
    { name: 'King George V Dock', where: 'dock', x: 13100, z: 60 },
    { name: 'Royal Albert Dock', where: 'dock', x: 12400, z: -190 },
    { name: 'King George V Reservoir', where: 'reservoir' },
    { name: "Regent's Canal", where: 'canal' },
  ];
  for (const c of CASES) {
    test(`${c.name} occludes the underground from above`, async ({ page }) => {
      await ready(page);
      const setup = await page.evaluate(c => {
        const u = window.__ug, THREE = window.__ugTHREE;
        let x = c.x, z = c.z, waterY;
        if (c.where === 'dock') waterY = u.getAirportDockSurfaceY({ x, z }, 5);
        else if (c.where === 'reservoir') {
          const m = u.scene.getObjectByName('reservoirs').children.find(o => o.isMesh && o.userData.name === c.name);
          m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
          x = (b.min.x + b.max.x) / 2; z = (b.min.z + b.max.z) / 2; waterY = b.max.y;
        } else {
          const m = u.scene.getObjectByName('canals').children.find(o => o.isMesh && o.userData.name === c.name);
          const p = m.geometry.attributes.position, i = 2 * Math.floor(p.count / 4);
          x = (p.getX(i) + p.getX(i + 1)) / 2; z = (p.getZ(i) + p.getZ(i + 1)) / 2; waterY = p.getY(i);
        }
        // Drawn like the underground infra: transparent queue, after the water.
        const size = c.where === 'canal' ? 8 : 40;
        const marker = new THREE.Mesh(new THREE.BoxGeometry(size, 4, size),
          new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 1, fog: false, toneMapped: false, depthWrite: true }));
        marker.name = 'lane-w-occlusion-marker'; marker.renderOrder = 2;
        marker.position.set(x, waterY - 60, z);
        u.scene.add(marker);
        const eye = { x: x + 1, y: waterY + (c.where === 'canal' ? 250 : 300), z: z + 1 };
        u.camera.position.set(eye.x, eye.y, eye.z); u.controls.target.set(x, waterY - 60, z);
        u.camera.lookAt(x, waterY - 60, z); u.controls.update();
        // The same marker in open air proves the camera can see it.
        return { x, z, waterY };
      }, c);
      await frames(page); await page.waitForTimeout(600); await frames(page);
      const count = async () => {
        const png = UPNG.decode(await page.screenshot());
        const rgba = new Uint8Array(UPNG.toRGBA8(png)[0]);
        let n = 0;
        for (let i = 0; i < rgba.length; i += 4) { const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]; if (r > 150 && b > 150 && r - g > 60 && b - g > 60) n++; }
        return n;
      };
      const hidden = await count();
      // Control: lift the marker above the water; it must now be seen.
      await page.evaluate(w => { window.__ug.scene.getObjectByName('lane-w-occlusion-marker').position.y = w + 20; }, setup.waterY);
      await frames(page); await page.waitForTimeout(300); await frames(page);
      const shown = await count();
      expect(shown, `${c.name}: control marker visible`).toBeGreaterThan(200);
      expect(hidden, `${c.name}: marker under the water is hidden`).toBeLessThan(20);
    });
  }
});
