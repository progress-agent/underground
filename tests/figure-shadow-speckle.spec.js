// figure-shadow-speckle.spec.js: the figure's planar shadow is one tone (sprint 16Oct26f, lane T, T-speckle, D-054).
//
// The shadow is the skinned figure drawn a second time, flattened onto a plane under the feet. Its triangles overlap (an arm across
// the torso, two legs), and it relied on a strict depth test to stop an overlap darkening twice. Coplanar triangles do not
// interpolate bit-identical depth, so where two overlapped some fragments of the second came out one step nearer and passed: a
// scatter of isolated double-dark pixels, the "faint dark speckles inside the shadow". Every fragment of the shadow now writes the
// depth of the shadow PLANE at its own pixel (figure-shadow.js, FRAG_DEPTH), so overlapping fragments agree and the strict test
// rejects all but the first.
//
// Metric (T/acceptance.md S-1 to S-3): a frame B with the shadow off and a frame A with it on, at noon and Master 1.1; the mask is
// the pixels with sum(B) > 30 and sum(A) < 0.92 sum(B); r = sum(A) / sum(B); med the mask's median r; "dark" the mask pixels with
// r < med - 0.12. Before (07391f3): dark 404 at the top-down pose P1 and 338 at the standard pose P2; now at most 10 at all three.
// UG_NEAR_BASE=http://localhost:5288 runs the same poses against the live build (S-2: dark >= 200 at P1 and P2, and >= 500 at P1 with
// the depth write off, which shows that the poses do contain overlaps).
import { test, expect } from '@playwright/test';
import { api } from './player-vehicles-helpers.mjs';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

const POSES = [
  { id: 'P1', label: 'King\'s Cross, top-down on a street rising 4%', x: 164.9, z: -2507.9, yaw: 0, pitch: -1.2, zoom: 1.6 },
  { id: 'P2', label: 'King\'s Cross, the standard view', x: 164.9, z: -2507.9, yaw: 0, pitch: null, zoom: null },
  { id: 'P3', label: 'Whitehall, the standard view', x: 110, z: 350, yaw: 0, pitch: null, zoom: null },
];
const BASE = process.env.UG_NEAR_BASE ?? '';
let page, h;
const errors = [];

test.describe('the figure\'s shadow', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    h = api(page);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await h.boot(`${BASE}/?fast=1&buildings=baked`);
    await h.activatePedestrian();
    await h.ev(() => window.__ugSun.setTime(0.5, { persist: false }));
    await h.setMaster(1.1);
    await h.wait(800);
  });
  test.afterAll(async () => { if (!BASE) expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  async function metric(p, { depthWriteOff = false } = {}) {
    await h.ev(([x, z, yaw]) => { const ped = window.__ug.modes.registry.get('pedestrian'); ped.setView('third'); ped.place(x, z, { yaw }); }, [p.x, p.z, p.yaw]);
    await h.wait(900);
    await h.ev(([pitch, zoom]) => { if (pitch !== null) { const r = window.__ug.modes.registry.get('pedestrian').onFoot.rig; r.pitch = pitch; r.zoom(zoom); } }, [p.pitch, p.zoom]);
    await h.wait(1500);
    return h.ev((depthWriteOff) => {
      const u = window.__ug, rend = u.composer.renderer, gl = rend.getContext(), cv = rend.domElement;
      u.sim.paused = true;
      const read = () => { u.composer.render(); const px = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      u.player.setShadowEnabled(false); const B = read();
      u.player.setShadowEnabled(true);
      const mat = u.player.shadow.material, was = mat.depthWrite;
      if (depthWriteOff) mat.depthWrite = false;
      const A = read();
      mat.depthWrite = was;
      u.sim.paused = false;
      const rs = [];
      for (let i = 0; i < cv.width * cv.height; i++) {
        const la = A[i * 4] + A[i * 4 + 1] + A[i * 4 + 2], lb = B[i * 4] + B[i * 4 + 1] + B[i * 4 + 2];
        if (lb > 30 && la < lb * 0.92) rs.push(la / lb);
      }
      rs.sort((a, b) => a - b);
      const med = rs[Math.floor(rs.length / 2)] ?? 0;
      let dark = 0; for (const v of rs) if (v < med - 0.12) dark++;
      return { n: rs.length, med, dark };
    }, depthWriteOff);
  }

  const results = {};
  for (const p of POSES) {
    test(`${p.id} ${p.label}: no dark speckles in the shadow`, async () => {
      const m = await metric(p);
      results[p.id] = m;
      console.log(`[speckle ${p.id}] mask ${m.n} px, median ${m.med.toFixed(3)}, dark ${m.dark}`);
      expect(m.n, 'a shadow is drawn').toBeGreaterThan(3000);
      if (BASE) { if (p.id !== 'P3') expect(m.dark, 'the live build shows the speckles (S-2)').toBeGreaterThanOrEqual(200); return; }
      expect(m.dark).toBeLessThanOrEqual(10);
    });
  }

  test('the shadow keeps its size and its tone (mask size within 2% and median within 0.01 of 07391f3)', async () => {
    // Measured by this same spec on 07391f3 (UG_NEAR_BASE=http://localhost:5288), 16Oct26f: mask size, median r and the speckles it had.
    const live = { P1: { n: 8914, med: 0.696, dark: 426 }, P2: { n: 4829, med: 0.708, dark: 392 }, P3: { n: 4555, med: 0.729, dark: 318 } };
    expect(results.P1 && results.P2 && results.P3, 'ran after the pose tests').toBeTruthy();
    if (BASE) return;
    for (const id of ['P1', 'P2', 'P3']) {
      expect(Math.abs(results[id].n - live[id].n) / live[id].n, `${id} mask size`).toBeLessThanOrEqual(0.02);
      expect(Math.abs(results[id].med - live[id].med), `${id} median ratio`).toBeLessThanOrEqual(0.01);
    }
  });

  test('S-2: with the depth write off every overlap doubles (the pose contains overlaps), so the metric can see a speckle', async () => {
    const m = await metric(POSES[0], { depthWriteOff: true });
    console.log(`[speckle P1 depthWrite off] dark ${m.dark}`);
    expect(m.dark, 'doubling is visible to the metric').toBeGreaterThanOrEqual(500);
  });
});
