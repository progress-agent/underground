// sea-life.spec.js: Lane C (sprint 23Sep26w, D-037) sea life in the Thames.
//
// Node-side tests (no page) pin the module against the SAME cross-sections and
// navigation predicate the water volume is built from, with the illustrative
// profile bed. Browser tests then repeat the key contracts against the real
// refined terrain bed and the real submerged predicate in the running app.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import * as THREE from 'three';
import { createSeaLife, SEA_LIFE_SPECIES } from '../src/sea-life.js';
import { bridgePierAnchors } from '../src/bridges.js';
import { createThamesProfileSampler } from '../src/thames-profile.js';
import { makeNavigation, THAMES, BRIDGES, VE, TOP_Y, bngToScene } from './sea-life-fixture.mjs';

const nav = makeNavigation();
const build = () => createSeaLife({ thamesPoints: THAMES.points, navigation: nav, bridges: BRIDGES, VE, topY: TOP_Y });
const TIMES = Array.from({ length: 120 }, (_, i) => i * 61.7);   // ~2 hours of pinned instants
const MOVING = ['blue-whale', 'manta-1', 'turtle', 'hammerhead', 'silver-school', 'anglerfish'];

function bridgeAxis(slug) {
  const b = BRIDGES.find(x => x.curatedSlug === slug);
  return { a: bngToScene(b.axis.a.e, b.axis.a.n), b: bngToScene(b.axis.b.e, b.axis.b.n) };
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (l2 || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function extentOf(api, name) {
  const root = api.group.getObjectByName(name), box = new THREE.Box3();
  root.updateMatrixWorld(true);
  const holder = root.children[0];
  const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  holder.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv));
  });
  return box.getSize(new THREE.Vector3());
}

test.describe('sea life: module contracts (node)', () => {
  test('eight species, true scale, sparse and low-poly', () => {
    const api = build();
    expect(SEA_LIFE_SPECIES.map(s => s.id)).toEqual(['blue-whale', 'manta', 'jellyfish', 'octopus', 'turtle',
      'hammerhead', 'silver-school', 'anglerfish']);
    // Real-metre sizes (the parent carries VE; these are measured in the body frame).
    const whale = extentOf(api, 'sea-life:blue-whale');
    expect(whale.z).toBeGreaterThan(23); expect(whale.z).toBeLessThan(28);
    expect(whale.y).toBeLessThan(5);
    const manta = extentOf(api, 'sea-life:manta-1');
    expect(manta.x).toBeGreaterThan(5.5); expect(manta.x).toBeLessThan(8);
    const shark = extentOf(api, 'sea-life:hammerhead');
    expect(shark.z).toBeGreaterThan(4.3); expect(shark.z).toBeLessThan(6);
    const turtle = extentOf(api, 'sea-life:turtle');
    expect(turtle.z).toBeGreaterThan(2); expect(turtle.z).toBeLessThan(3.2);
    const angler = extentOf(api, 'sea-life:anglerfish');
    // About a metre of fish, plus the rod and lure reaching forward.
    expect(angler.z).toBeGreaterThan(0.9); expect(angler.z).toBeLessThan(1.8);
    // The whole layer stays a small, flat-shaded budget.
    let tris = 0, draws = 0;
    api.group.traverse(o => {
      if (!o.isMesh) return;
      draws++;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
      if (!o.isSprite && o.material.name !== 'sea-life-lure') expect(o.material.flatShading).toBe(true);
    });
    expect(draws).toBeLessThan(40);
    expect(tris).toBeLessThan(30000);
    api.dispose();
  });

  test('never per-instance colour (D-015)', () => {
    const api = build();
    api.update(1, { position: new THREE.Vector3() }, { submerged: true });
    let instanced = 0;
    api.group.traverse(o => {
      if (o.isInstancedMesh) instanced++;
      expect(o.instanceColor ?? null).toBeNull();
      if (o.isMesh && o.material.vertexColors) expect(o.geometry.attributes.color).toBeTruthy();
    });
    expect(instanced).toBeGreaterThanOrEqual(3);
    const source = fs.readFileSync(new URL('../src/sea-life.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/setColorAt|instanceColor\s*=/);
    api.dispose();
  });

  test('deterministic at pinned time: two instances, and update() agrees with setElapsed()', () => {
    const a = build(), b = build();
    for (const t of [0, 17.25, 600, 3599.5]) for (const id of a.ids) {
      expect(a.poseAt(id, t)).toEqual(b.poseAt(id, t));
      expect(a.probes(id, t)).toEqual(b.probes(id, t));
    }
    const cam = { x: 0, y: 0, z: 0 };
    expect(a.fishAt(123.4, cam)).toEqual(b.fishAt(123.4, cam));
    // The clock integrates dt; the pose depends only on the total.
    const camera = { position: new THREE.Vector3(0, 0, 0) };
    for (let i = 0; i < 90; i++) a.update(1 / 30, camera, { submerged: true });
    b.setElapsed(3); b.update(0, camera, { submerged: true });
    expect(a.getElapsed()).toBeCloseTo(3, 9);
    const whaleA = a.group.getObjectByName('sea-life:blue-whale').position;
    const whaleB = b.group.getObjectByName('sea-life:blue-whale').position;
    expect(whaleA.distanceTo(whaleB)).toBeLessThan(1e-6);
    // Moving species actually move, at plausible swimming speeds.
    for (const id of MOVING) {
      const p0 = a.poseAt(id, 1000), p1 = a.poseAt(id, 1020);
      const d = Math.hypot(p1.x - p0.x, (p1.y - p0.y) / VE, p1.z - p0.z) / 20;
      expect(d, id).toBeGreaterThan(0.03);
      expect(d, id).toBeLessThan(3);
    }
    a.dispose(); b.dispose();
  });

  test('stays inside the water volume at every pinned instant', () => {
    const api = build();
    const outside = {};
    for (const id of api.ids) {
      outside[id] = 0;
      for (const t of TIMES) for (const p of api.probes(id, t)) if (!nav.contains(p)) outside[id]++;
    }
    expect(outside).toEqual(Object.fromEntries(api.ids.map(id => [id, 0])));
    // Fish that part around a camera inside the school still stay wet.
    for (const t of TIMES.slice(0, 30)) {
      const c = api.poseAt('silver-school', t);
      for (const p of api.probes('silver-school', t, { x: c.x + 2, y: c.y + 1, z: c.z })) expect(nav.contains(p)).toBe(true);
    }
    api.dispose();
  });

  test('placed for discovery: whale in the Pool, mantas at Greenwich, anglerfish deepest, octopus on a pier', () => {
    const api = build();
    const tower = bridgeAxis('tower'), london = bridgeAxis('london');
    const mid = ax => ({ x: (ax.a.x + ax.b.x) / 2, z: (ax.a.z + ax.b.z) / 2 });
    const towerMid = mid(tower), londonMid = mid(london);
    const pool = { x: (towerMid.x + londonMid.x) / 2, z: (towerMid.z + londonMid.z) / 2 };
    const poolHalf = Math.hypot(towerMid.x - londonMid.x, towerMid.z - londonMid.z) / 2;
    const greenwich = { x: 8161, z: 2340 }; // Cutty Sark reach, as river-banks.spec.js
    const sampler = createThamesProfileSampler(THAMES.points);
    const deepest = Math.max(...THAMES.points.map(p => p.d));
    const axes = BRIDGES.map(b => ({ slug: b.curatedSlug, ...bridgeAxis(b.curatedSlug) }));
    const closest = { d: Infinity };
    for (const t of TIMES) {
      const w = api.poseAt('blue-whale', t);
      // Always well inside the Pool of London, the reach between the two bridges.
      expect(Math.hypot(w.x - pool.x, w.z - pool.z)).toBeLessThan(poolHalf - 60);
      // Upstream of Tower Bridge and downstream of London Bridge: the Pool of London.
      for (const p of api.probes('blue-whale', t)) {
        expect(distToSegment(p, tower.a, tower.b)).toBeGreaterThan(20);
        expect(distToSegment(p, london.a, london.b)).toBeGreaterThan(20);
      }
      for (const id of ['manta-1', 'manta-2', 'manta-3']) {
        const m = api.poseAt(id, t);
        expect(Math.hypot(m.x - greenwich.x, m.z - greenwich.z)).toBeLessThan(600);
        // Low over the bed: in the lower half of the column.
        const bed = nav.bedAt(m.x, m.z);
        expect((m.y - bed) / (TOP_Y - bed)).toBeLessThan(0.5);
      }
      const a = api.poseAt('anglerfish', t);
      expect(sampler.sampleAt(a.x, a.z).d).toBe(deepest);
      expect((a.y - nav.bedAt(a.x, a.z)) / VE).toBeLessThan(3.5); // hugging the bed
      // No free swimmer passes through a bridge.
      for (const id of MOVING) for (const p of api.probes(id, t)) for (const ax of axes) {
        const d = distToSegment(p, ax.a, ax.b);
        if (d < closest.d) Object.assign(closest, { d, id, slug: ax.slug, t });
      }
    }
    expect(closest.d, JSON.stringify(closest)).toBeGreaterThan(12);
    // Octopus: body within a metre of a drawn Westminster pier face, arms on it.
    const west = BRIDGES.find(b => b.curatedSlug === 'westminster');
    const piers = bridgePierAnchors(west);
    const o = api.poseAt('octopus', 50);
    const best = Math.min(...piers.map(p => {
      const du = (o.x - p.x) * p.ux + (o.z - p.z) * p.uz, dn = (o.x - p.x) * p.nx + (o.z - p.z) * p.nz;
      return Math.abs(dn) <= p.halfN ? Math.abs(Math.abs(du) - p.halfU) : Infinity;
    }));
    expect(best).toBeLessThan(1);
    expect(nav.containsXZ(o.x, o.z)).toBe(true);
    api.dispose();
  });

  test('visible only when the caller reports the submerged regime', () => {
    const api = build();
    const camera = { position: new THREE.Vector3(0, 500, 0) };
    expect(api.group.visible).toBe(false);
    api.update(1 / 60, camera, { submerged: false });
    expect(api.group.visible).toBe(false);
    api.update(1 / 60, camera, { submerged: true });
    expect(api.group.visible).toBe(true);
    api.update(1 / 60, camera, {});
    expect(api.group.visible).toBe(false);
    // The clock keeps running while hidden, so re-entry lands on the same instant.
    expect(api.getElapsed()).toBeCloseTo(3 / 60, 9);
    api.dispose();
  });

  test('the silver school parts around the camera', () => {
    const api = build();
    const avoid = SEA_LIFE_SPECIES.find(s => s.id === 'silver-school').school.avoidM;
    let near = 0, parted = Infinity;
    for (const t of [30, 400, 1200]) {
      const c = api.poseAt('silver-school', t), cam = { x: c.x, y: c.y, z: c.z };
      const real = f => Math.hypot(f.x - cam.x, (f.y - cam.y) / VE, f.z - cam.z);
      near += api.fishAt(t, null).fish.filter(f => real({ ...f, y: f.y * VE }) < avoid * 0.5).length;
      for (const f of api.fishAt(t, cam).fish) parted = Math.min(parted, real({ ...f, y: f.y * VE }));
    }
    expect(near).toBeGreaterThan(10);           // undisturbed, fish fill that space
    // With the camera there they clear it (the water top and bed can hold a
    // fish back a little from the full avoidance radius).
    expect(parted).toBeGreaterThan(avoid * 0.5);
    api.dispose();
  });
});

// ── Browser: the real terrain bed, the real submerged predicate ─────────
async function waitReady(page) {
  await page.waitForFunction(() => !!(window.__ug && window.__ug.seaLife && window.__ug.isSubmergedAt
    && window.__ug.intro && !window.__ug.intro.isRunning()), null, { timeout: 120000 });
}
async function lookFrom(page, eye, target) {
  await page.evaluate(([e, t]) => {
    const u = window.__ug;
    u.camera.position.set(e.x, e.y, e.z);
    u.controls.target.set(t.x, t.y, t.z);
    u.camera.lookAt(t.x, t.y, t.z);
    u.camera.updateMatrixWorld(true);
  }, [eye, target]);
  // A few frames so tick() re-evaluates the regime and poses the layer.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
}

test.describe('sea life: in the running app', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?skip=1');
    await waitReady(page);
    await page.evaluate(() => { window.__ug.sim.paused = true; window.__ug.seaLife.setElapsed(300); });
  });

  test('hidden above water, visible when submerged at each placement, and in view', async ({ page }) => {
    const ids = await page.evaluate(() => window.__ug.seaLife.ids);
    expect(ids.length).toBe(10);
    for (const id of ids) {
      const vp = await page.evaluate(id => {
        const s = window.__ug.seaLife;
        if (id === 'jellyfish') { const p = s.jellyPose(0, 300); return { target: p, eye: { x: p.x - 14, y: p.y - 5, z: p.z } }; }
        return s.viewpoint(id, 300, id === 'blue-whale' ? 60 : 18);
      }, id);
      // Directly above the same spot, well clear of the water: never drawn.
      await lookFrom(page, { x: vp.eye.x, y: 400, z: vp.eye.z }, vp.target);
      expect(await page.evaluate(() => window.__ug.seaLife.group.visible), `${id} above water`).toBe(false);
      await lookFrom(page, vp.eye, vp.target);
      const state = await page.evaluate(([id, t]) => {
        const u = window.__ug, THREE = window.__ugTHREE, c = u.camera;
        const p = new THREE.Vector3(t.x, t.y, t.z).project(c);
        return { submerged: u.isSubmergedAt(c.position.x, c.position.y, c.position.z),
          visible: u.seaLife.group.visible, ndc: [p.x, p.y, p.z] };
      }, [id, vp.target]);
      expect(state.submerged, `${id} viewpoint is in the water`).toBe(true);
      expect(state.visible, `${id} drawn when submerged`).toBe(true);
      expect(Math.abs(state.ndc[0]), id).toBeLessThan(1);
      expect(Math.abs(state.ndc[1]), id).toBeLessThan(1);
      expect(state.ndc[2], id).toBeLessThan(1);
    }
  });

  test('stays within the real channel and bed, deterministic against the node build', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window.__ug.seaLife, nav = window.__ug.thamesMesh.userData.navigation;
      const outside = {}, poses = {};
      for (const id of s.ids) {
        outside[id] = 0;
        for (let i = 0; i < 60; i++) for (const p of s.probes(id, i * 97.3)) if (!nav.contains(p)) outside[id]++;
        poses[id] = [s.poseAt(id, 750), s.poseAt(id, 750)];
      }
      let instanceColour = 0;
      s.group.traverse(o => { if (o.instanceColor) instanceColour++; });
      return { outside, poses, instanceColour, parent: s.group.parent?.type };
    });
    expect(result.parent).toBe('Scene');
    expect(result.instanceColour).toBe(0);
    for (const [id, n] of Object.entries(result.outside)) expect(n, `${id} probes outside the water`).toBe(0);
    // Same instant twice in the page is identical; the horizontal path is the
    // same as the node build (only the bed under it differs: real vs profile).
    const local = build();
    for (const [id, [a, b]] of Object.entries(result.poses)) {
      expect(a).toEqual(b);
      const n = local.poseAt(id, 750);
      expect(Math.hypot(a.x - n.x, a.z - n.z), id).toBeLessThan(1e-6);
    }
    local.dispose();
  });
});
