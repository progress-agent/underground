// near-clearance.spec.js: first person never shows the inside of a wall it stands against (sprint 16Oct26f, lane T, T-near, D-054).
//
// On foot in first person the walker stops 0.35 m short of a facade (BODY.radius) while the camera's near plane is 1.0 scene unit;
// the plane's corners reach near x cf from the eye (cf = sqrt(1 + t^2 (1 + aspect^2)), 1.225 at the default lens in a 1440 x 900
// window), so any wall nearer than that was cut open. src/player/near-clearance.js lowers the near plane ONLY while a wall is
// within 1.5 m of the eye (0.257 pressed against a facade), so the open street keeps its depth precision.
//
// Five contacts (the wall is walked into for 3 s of mode clock, W held): King's Cross station building, Fulham Broadway's box, a
// terrace street east of Bank, Westminster Bridge's parapet, North Greenwich's entrance block. At every third frame from 0.5 s:
// dmin = the least hit distance from the camera over 64 rays (16 azimuths x elevations -60, -30, 0, +30 degrees, far 3) against
// every visible mesh except the player, the sprites, points and the terrain (a ray cannot reach it within the near plane's
// corners from eye height); the corners must stay inside it: camera.near x cf < dmin - 0.005. Also: the frame is the same picture
// as one drawn with the near plane at 0.02 (at most 0.5% of pixels differ by more than 24 levels), the open street keeps near 1,
// and a third-person camera pulled in against a facade never has a larger near than before.
// UG_NEAR_BASE=http://localhost:5288 runs the same checks against the live build (they are expected to FAIL there: that is the
// before of T/near-before-after.md).
import { test, expect } from '@playwright/test';
import { api } from './player-vehicles-helpers.mjs';

// serial on the lane; against the live build (UG_NEAR_BASE) every contact is reported, so a failure does not skip the rest
test.describe.configure({ mode: process.env.UG_NEAR_BASE ? 'default' : 'serial' });
test.setTimeout(240000);

const CONTACTS = [
  { id: 'C1', name: "King's Cross station building, south face", x: 218.1, z: -2617.2, yaw: 0, reach: 0.6 },
  { id: 'C2', name: "Fulham Broadway's box, north face", x: -4590.0, z: 3038.0, yaw: Math.PI, reach: 0.6 },
  { id: 'C3', name: 'a terrace street east of Bank', x: 2870.0, z: -719.6, yaw: Math.PI, reach: 0.6 },
  { id: 'C4', name: "Westminster Bridge's north parapet", x: 434.3, z: 709.6, yaw: 0, reach: null },
  { id: 'C5', name: "North Greenwich's entrance block", x: 9151.12, z: 498.73, yaw: Math.PI, reach: 0.6 },
];

// The 64-ray clearance probe, run in the page. Stateful across frames through window.__nc.
const PROBE = `
const nc = (window.__nc ||= { n: 0, meshes: null, rc: new T.Raycaster(), dirs: null });
nc.n++;
if (nc.n % 3 !== 0 || t < 0.5) return;
const cam = u.camera;
if (!nc.meshes || nc.stamp !== nc.kind) {
  nc.meshes = [];
  u.scene.traverseVisible((o) => {
    if (!o.isMesh || o.isSprite || o.isPoints || o.name === 'terrainMesh') return;
    for (let a = o; a; a = a.parent) if (a.name === 'player') return;
    // a bridge morphs its geometry in place with Master, and three.js keeps the bounds it computed first: refresh them once here
    if (!o.isInstancedMesh && o.geometry.attributes.position.count <= 60000) { o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere(); }
    nc.meshes.push(o);
  });
  nc.stamp = nc.kind;
  nc.dirs = [];
  for (let i = 0; i < 16; i++) for (const el of [-60, -30, 0, 30]) {
    const az = i / 16 * Math.PI * 2, e = el * Math.PI / 180;
    nc.dirs.push(new T.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)));
  }
}
cam.updateMatrixWorld(true);
const tn = Math.tan(cam.fov * Math.PI / 360), cf = Math.sqrt(1 + tn * tn * (1 + cam.aspect * cam.aspect));
let dmin = Infinity;
nc.rc.far = 3; nc.rc.near = 0;
// Only the meshes that can reach within 3 m of the eye are worth a ray. An instanced mesh (a baked tile of thousands of boxes) is
// tested by its bounding sphere, any other by its world bounding box; the map-wide meshes (the M25's barrier, the terrain's
// underside, the chalk floor, 60,000+ vertices each: a ray costs seconds) and the underground ribbons can never be a wall in
// reach of a street-level eye, and are left out.
const cand = [];
const c = new T.Vector3(), bx = new T.Box3();
for (const m of nc.meshes) {
  if (m.isInstancedMesh) {
    if (!m.boundingSphere) m.computeBoundingSphere();
    const sph = m.boundingSphere; if (!sph) continue;
    c.copy(sph.center).applyMatrix4(m.matrixWorld);
    const e = m.matrixWorld.elements, sc = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
    if (c.distanceTo(cam.position) <= sph.radius * sc + 3.2) cand.push(m);
  } else {
    const g = m.geometry;
    if (g.attributes.position.count > 60000 || /^(ribbon|tideway|train-batch|skyDome)/.test(m.name)) continue;
    bx.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
    if (bx.distanceToPoint(cam.position) <= 3.2) cand.push(m);
  }
}
for (const d of nc.dirs) {
  nc.rc.set(cam.position, d);
  for (const m of cand) { const h = nc.rc.intersectObject(m, false); if (h.length && h[0].distance < dmin) dmin = h[0].distance; }
}
return { t, near: cam.near, cf, reach: cam.near * cf, dmin, margin: dmin - cam.near * cf, x: cam.position.x, z: cam.position.z, card: ped.debug().card?.kind ?? null };
`;

let page, h;
const errors = [];
const BASE = process.env.UG_NEAR_BASE ?? '';

test.describe('first person against a wall', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    h = api(page);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await h.boot(`${BASE}/?fast=1&buildings=baked`);
    await h.activatePedestrian();
    await h.ev(() => { window.__ugSun?.setTime?.(0.5, { persist: false }); });
  });
  test.afterAll(async () => { if (!BASE) expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  async function press(c, view) {
    await h.releaseKeys();
    await h.ev(([x, z, yaw, view]) => { const p = window.__ug.modes.registry.get('pedestrian'); p.place(x, z, { yaw }); p.setView(view); }, [c.x, c.z, c.yaw, view]);
    await h.wait(900);
    await h.ev((view) => { window.__nc = null; if (window.__nc) window.__nc.kind = view; }, view);
  }

  for (const c of CONTACTS) {
    test(`${c.id} ${c.name}: no frame cuts the wall while pressing into it for 3 s, and the picture is the one drawn with near 0.02`, async () => {
      await press(c, 'first');
      const rows = await h.sample(3.0, PROBE, [{ t: 0, down: ['w'] }]);
      const last = rows[rows.length - 1];
      await h.releaseKeys();
      const worst = Math.min(...rows.map((r) => r.margin));   // Infinity where no drawn surface is within 3 scene units
      const nearMin = Math.min(...rows.map((r) => r.near));
      console.log(`[near ${c.id}] ${rows.length} frames, worst margin ${worst.toFixed(3)} m, near ${nearMin.toFixed(3)}..${Math.max(...rows.map((r) => r.near)).toFixed(3)}, last dmin ${last.dmin.toFixed(3)} m, reach ${last.reach.toFixed(3)}, card ${last.card}`);
      expect(rows.length, 'sampled frames').toBeGreaterThanOrEqual(15);
      if (c.reach !== null) expect(last.dmin, 'the contact happened').toBeLessThanOrEqual(c.reach);
      else {
        // A parapet is below the eye, and vertical distances count five times in scene units (VE 5), so no drawn surface is within the
        // rays' 3 units of the eye here (dmin stays infinite) and the near plane's corners cannot reach it. The contact is then the
        // walker being held: it walked on, then stopped dead against the solid.
        expect(Math.hypot(last.x - c.x, last.z - c.z), 'the walker walked on').toBeGreaterThan(3);
        const tail = rows.slice(-6);
        expect(Math.hypot(tail[tail.length - 1].x - tail[0].x, tail[tail.length - 1].z - tail[0].z), 'and was held by the parapet').toBeLessThan(0.02);
      }
      for (const r of rows) expect(r.reach, `near ${r.near.toFixed(3)} x cf ${r.cf.toFixed(3)} at t ${r.t.toFixed(2)} against a wall ${r.dmin.toFixed(3)} m away`).toBeLessThan(r.dmin - 0.005);
      // the pixels: frame F as drawn, frame R with the near plane at 0.02 for that one render
      const diff = await h.ev(() => {
        const u = window.__ug, rend = u.composer.renderer, gl = rend.getContext(), cv = rend.domElement, cam = u.camera;
        u.sim.paused = true;
        const read = () => { u.composer.render(); const px = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        const F = read();
        const near = cam.near; cam.near = 0.02; cam.updateProjectionMatrix();
        const R = read();
        cam.near = near; cam.updateProjectionMatrix();
        u.sim.paused = false;
        let n = 0;
        for (let i = 0; i < F.length; i += 4) if (Math.abs(F[i] - R[i]) > 24 || Math.abs(F[i + 1] - R[i + 1]) > 24 || Math.abs(F[i + 2] - R[i + 2]) > 24) n++;
        return { frac: n / (F.length / 4), near };
      });
      console.log(`[near ${c.id}] pixels differing by more than 24 levels from the near-0.02 frame: ${(diff.frac * 100).toFixed(3)}% (near ${diff.near.toFixed(3)})`);
      expect(diff.frac, 'the same picture as with the near plane at 0.02').toBeLessThanOrEqual(0.005);
    });
  }

  test('open ground keeps the on-foot near plane exactly: nothing within 1.5 m of the eye', async () => {
    await h.releaseKeys();
    await h.ev(() => { const p = window.__ug.modes.registry.get('pedestrian'); p.place(164.9, -2507.9, { yaw: 0 }); p.setView('first'); });
    await h.wait(1200);
    const near = await h.ev(() => window.__ug.camera.near);
    expect(near).toBe(1);
  });

  test('third person beside a facade (pulled in or not) never has a larger near than the rig asks, and its corners stay clear', async () => {
    const c = CONTACTS[2];
    await press(c, 'third');
    const probe = PROBE.replace('const cam = u.camera;', 'const cam = u.camera; const rig = ped.onFoot.rig;').replace('card: ped', 'rigDist: rig.distance, suggested: rig.suggestedNear, card: ped');
    const rows = await h.sample(3.0, probe, [{ t: 0, down: ['w'] }]);
    await h.releaseKeys();
    const close = rows.filter((r) => r.dmin < 1.5);
    console.log(`[near third] ${rows.length} frames, ${rows.filter((r) => r.rigDist <= 2.5).length} pulled in, ${close.length} with a wall within 1.5 m of the camera, worst margin ${Math.min(...rows.map((r) => r.margin)).toFixed(3)} m, least near ${Math.min(...rows.map((r) => r.near)).toFixed(3)}`);
    expect(close.length, 'a wall came within reach of the camera').toBeGreaterThan(3);
    for (const r of rows) {
      if (r.suggested !== null) expect(r.near, 'never above the rig\'s own near').toBeLessThanOrEqual(r.suggested + 1e-9);
      expect(r.reach, `corners clear of a wall ${r.dmin.toFixed(3)} m away`).toBeLessThan(r.dmin - 0.005);
    }
  });
});
