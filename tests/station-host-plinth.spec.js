// station-host-plinth.spec.js: a station's host box is seated on the street on every side (sprint 16Oct26f, lane T, T-ng, D-054).
//
// A baked map box stands at the ground under its centre, so North Greenwich's host (a 85.5 m box at 4.00 m) stood 0.75 m above the
// street under its west face, and Fulham Broadway's (90.6 m at 10.00 m) 2.85 m above its north face. The box's top may not move,
// and its height law scales it about its own base, so the part below the base is a plinth: a thin wall closing all four faces from
// the host's base down to 0.3 m under the street, sampled every metre so its bottom edge never lifts off a dip between samples,
// and made of the map boxes' own surface (colour, roughness and metalness read from their shared material) so it reads as the
// box's own wall. Its vertices are canonical, so it follows Master exactly as the terrain does.
//
// G-1: along each face of both hosts at 0.5 m steps, wherever the street 0.5 m outside the face is below the base, the plinth's
// bottom edge there is at or below the street + 0.1 canonical (0.02 m real) and its top equals the host's base to 1e-3.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);
const errors = [];
let page;

test.describe('the host plinth', () => {
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`${process.env.UG_NEAR_BASE ?? ''}/?fast=1&buildings=baked`);
    await page.waitForFunction(() => { const b = window.__ug?.bakedStats; return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady && window.__ug.stationBuildings?.ready; }, null, { timeout: 240000 });
  });
  test.afterAll(async () => { if (!process.env.UG_NEAR_BASE) expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  for (const master of [1.1, 3]) {
    test(`Master ${master}: both hosts are seated on the street on all four faces`, async () => {
      const r = await page.evaluate(async (M) => {
        const u = window.__ug;
        const el = document.getElementById('masterHeight'); el.value = String(M); el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
        for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
        const group = u.scene.getObjectByName('station-buildings');
        const names = group.children.map((c) => c.name).sort();
        const skirt = u.scene.getObjectByName('station-host-skirts');
        const pos = skirt.geometry.attributes.position.array;
        // quads, as station-buildings.js writes them: (prev bottom, cur top, cur bottom), (prev bottom, prev top, cur top)
        const quads = [];
        for (let i = 0; i + 17 < pos.length; i += 18) quads.push({ x0: pos[i], y0: pos[i + 1], z0: pos[i + 2], x1: pos[i + 6], z1: pos[i + 8], top: pos[i + 4], y1: pos[i + 7] });
        const getY = u.modes.ctx.getStructuralY;
        const hosts = u.stationBuildings.index.buildings.filter((b) => b.host);
        const rows = [];
        for (const b of hosts) {
          const h = b.host, half = h.side / 2, base = h.baseM * 5;
          // the four faces: [from corner, to corner, outward normal]
          const faces = [[[-1, -1], [1, -1], [0, -1]], [[1, -1], [1, 1], [1, 0]], [[1, 1], [-1, 1], [0, 1]], [[-1, 1], [-1, -1], [-1, 0]]];
          let checked = 0, worstBottom = -Infinity, worstTop = 0, missing = 0, below = 0;
          for (const [a, c, n] of faces) {
            const ax = h.x + a[0] * half, az = h.z + a[1] * half, cx = h.x + c[0] * half, cz = h.z + c[1] * half;
            const L = Math.hypot(cx - ax, cz - az);
            for (let d = 0; d <= L + 1e-9; d += 0.5) {
              const t = d / L, x = ax + (cx - ax) * t, z = az + (cz - az) * t;
              const street = getY(x + n[0] * 0.5, z + n[1] * 0.5);
              if (!(street < base)) continue;
              below++;
              // the quad of this face holding (x, z)
              let q = null;
              for (const k of quads) {
                const dx = k.x1 - k.x0, dz = k.z1 - k.z0, l2 = dx * dx + dz * dz;
                if (l2 < 1e-12) continue;
                const s = ((x - k.x0) * dx + (z - k.z0) * dz) / l2;
                if (s < -1e-6 || s > 1 + 1e-6) continue;
                if (Math.hypot(x - (k.x0 + dx * s), z - (k.z0 + dz * s)) > 1e-3) continue;
                q = { bottom: k.y0 + (k.y1 - k.y0) * s, top: k.top }; break;
              }
              if (!q) { missing++; continue; }
              checked++;
              worstBottom = Math.max(worstBottom, q.bottom - (street + 0.1));
              worstTop = Math.max(worstTop, Math.abs(q.top - base));
            }
          }
          rows.push({ key: b.key, below, checked, missing, worstBottom, worstTop });
        }
        const bm = (await import('/src/surface-geometry.js')).getBuildingMaterial();
        return { names, rows, mat: { same: skirt.material.color.equals(bm.color) && skirt.material.roughness === bm.roughness && skirt.material.metalness === bm.metalness, roughness: skirt.material.roughness } };
      }, master);
      console.log(`[plinth M${master}] ${JSON.stringify(r.rows)}`);
      expect(r.names, 'the group holds exactly its three meshes').toEqual(['station-buildings-walls', 'station-host-skirts', 'station-roundels']);
      expect(r.rows.map((x) => x.key).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/north-greenwich/), expect.stringMatching(/fulham-broadway/)]));
      for (const x of r.rows) {
        expect(x.below, `${x.key}: some of its faces stand above the street`).toBeGreaterThan(20);
        expect(x.missing, `${x.key}: a plinth wherever the street is below the base`).toBe(0);
        expect(x.worstBottom, `${x.key}: the bottom edge is at or below the street`).toBeLessThanOrEqual(0);
        expect(x.worstTop, `${x.key}: the top is the host's base`).toBeLessThan(1e-3);
      }
      expect(r.mat.same, 'the map boxes\' own surface').toBe(true);
    });
  }
});
