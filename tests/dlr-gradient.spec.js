// dlr-gradient.spec.js: the DLR's gradient is bounded along its whole length (sprint 16Oct26f, lane T, T-dlr, D-054).
//
// The 16Oct26f report listed "the DLR's 40% ramp near Stratford". That figure was a units slip in the walk check that measured it
// (tests/cross-lane-walks-s02.spec.js 4b divided the run by VE as well); the profile's real grade there is about 6%. What WAS steep
// is where daylight track meets a cutting: the profile kept cutting nodes out of its 8% majorant and gave daylight track a 1 m
// minimum (or its whole deck), so the two stepped by that much over one 9 to 20 m segment: 30.6% at the Woolwich branch's deck end
// (9698, -283), 20.6% west of Stratford International, 15.4% into its platform. src/dlr-profile.js now ramps daylight track down to
// a cutting at the portal grade and lifts the cutting (never above its ground) to meet it, and moves no station or platform.
//
// This spec reads the REAL ground through __ug.dlrProfile (the same profile the walker, the trains and the hover use) for every TfL
// DLR stop sequence at Masters 1, 1.1, 2 and 3:
//   * every segment whose ends are both outside a tunnel: real gradient (|dy| / 5 / d, d the plan distance) at most 0.105 (the
//     model's 8% plus the platform junction at Stratford International, whose own platform cannot move);
//   * every segment with an end in a tunnel: at most 0.21 (a regression guard, not a fix: where the 30 m bore follows the river
//     bed and the City's ground it reaches 0.2015);
//   * every station and platform candidate (98) at exactly the height it had on 07391f3 (tests/dlr-station-heights.json).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PINNED = JSON.parse(readFileSync(new URL('./dlr-station-heights.json', import.meta.url), 'utf8')).stations;
const MASTERS = [1, 1.1, 2, 3];
const DAYLIGHT_MAX = 0.105, TUNNEL_MAX = 0.21;

let page;
test.describe.configure({ mode: process.env.UG_NEAR_BASE ? 'default' : 'serial' });
test.describe('the DLR profile gradient', () => {
  test.setTimeout(240000);
  const errors = [];
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(`${process.env.UG_NEAR_BASE ?? ''}/?fast=1&buildings=baked`);   // UG_NEAR_BASE=http://localhost:5288 runs it against the live build: it must fail there
    await page.waitForFunction(() => { const b = window.__ug?.bakedStats; return !!b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal && window.__ug.groundReady && !!window.__ug.dlrProfile; }, null, { timeout: 240000 });
  });
  test.afterAll(async () => { expect(errors, 'no console or page errors').toEqual([]); await page.close(); });

  const measure = (master) => page.evaluate(async (M) => {
    const u = window.__ug, P = u.dlrProfile;
    const el = document.getElementById('masterHeight'); el.value = String(M); el.dispatchEvent(new Event('input', { bubbles: true })); u.structureMorph.flush();
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    const s = u.getBuildingHeightScale();
    const seqs = (await (await fetch('/data/tfl/route-sequence/dlr.json')).json()).stopPointSequences;
    let day = 0, tun = 0, dayAt = null, tunAt = null, segments = 0, sequences = 0;
    for (const seq of seqs) {
      const pts = P.buildBranch({ points: seq.stopPoint, structureScale: s }).points;
      sequences++;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 1e-6) continue;
        const g = Math.abs(a.y - b.y) / 5 / d;
        const tunnel = a._dlrProfile.classification === 'tunnel' || b._dlrProfile.classification === 'tunnel';
        segments++;
        if (tunnel) { if (g > tun) { tun = g; tunAt = [Math.round(a.x), Math.round(a.z)]; } }
        else if (g > day) { day = g; dayAt = [Math.round(a.x), Math.round(a.z), a._dlrProfile.classification, b._dlrProfile.classification]; }
      }
    }
    const heights = {};
    for (const [id, st] of Object.entries(P.data.stations)) for (const c of st.candidates) heights[`${id}#${c.node}`] = P.station({ id, nodeIndex: c.node, structureScale: s }).y;
    return { scale: s, day, dayAt, tun, tunAt, segments, sequences, heights };
  }, master);

  for (const M of MASTERS) {
    test(`Master ${M}: daylight gradient at most ${DAYLIGHT_MAX}, tunnel at most ${TUNNEL_MAX}, no station or platform moved`, async () => {
      const r = await measure(M);
      console.log(`[dlr-gradient] Master ${M}: ${r.segments} segments over ${r.sequences} sequences, daylight max ${r.day.toFixed(4)} at ${JSON.stringify(r.dayAt)}, tunnel max ${r.tun.toFixed(4)} at ${JSON.stringify(r.tunAt)}`);
      expect(r.sequences, 'the DLR\'s stop sequences').toBeGreaterThanOrEqual(8);
      expect(r.segments).toBeGreaterThan(3000);
      expect(r.day, `daylight at ${JSON.stringify(r.dayAt)}`).toBeLessThanOrEqual(DAYLIGHT_MAX);
      expect(r.tun, `tunnel at ${JSON.stringify(r.tunAt)}`).toBeLessThanOrEqual(TUNNEL_MAX);
      const pinned = PINNED[String(M)];
      const keys = Object.keys(pinned);
      expect(keys.length, 'every station candidate is pinned').toBe(98);
      expect(Object.keys(r.heights).sort()).toEqual(keys.sort());
      let worst = 0, at = null;
      for (const k of keys) { const d = Math.abs(r.heights[k] - pinned[k]); if (d > worst) { worst = d; at = k; } }
      expect(worst, `the station table moved at ${at}`).toBeLessThan(1e-6);
    });
  }
});
