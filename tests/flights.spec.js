// Lane F (sprint 23Sep26w, D-037): living air traffic.
// Pure-model tests run through Vite SSR (no GPU). One browser test checks the
// live scene: pinned positions, the easterly switch, rendered (non-black)
// aircraft and the hover label, all through the real app.
import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import UPNG from 'upng-js';
import { fileURLToPath } from 'node:url';

// Pin Vite's root to the repo so the SSR model loads whatever directory the
// runner was launched from (worktrees are run by absolute path).
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let server, F, motorway;
const DEG = Math.PI / 180;
const tilted = ({ x, z }) => (20 + x * 0.0002 + z * 0.0001) * 5; // canonical Y, gentle slope
const EASTERLY = () => ({ dirRad: 90 * DEG, speedMps: 6 });

test.beforeAll(async () => {
  server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', logLevel: 'error' });
  F = await server.ssrLoadModule('/src/flights.js');
  motorway = await server.ssrLoadModule('/src/m25-motorway.js');
});
test.afterAll(async () => { F?.setWindSource(null); await server?.close(); });
test.afterEach(() => F.setWindSource(null));

const ring = () => motorway.MOTORWAY_DATA.boundary.points;
function insideRing(x, z, pts) { let hit = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit; } return hit; }
function distanceToRing(x, z, pts) { let best = Infinity; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)); } return best; }

test('positions are a pure function of elapsed time and pinned at known instants', () => {
  const a = F.createTrafficModel({ getSurfaceY: tilted }), b = F.createTrafficModel({ getSurfaceY: tilted });
  const random = Math.random; Math.random = () => { throw new Error('flights must not use Math.random'); };
  try {
    for (const t of [0, 17.25, 1000, 4321.5, 86400]) expect(a.flightsAt(t)).toEqual(b.flightsAt(t));
    // Evaluating out of order changes nothing (no hidden integration state).
    const later = a.flightsAt(4321.5); a.flightsAt(10); expect(a.flightsAt(4321.5)).toEqual(later);
    const pins = [
      [1000, 'heathrow-arrivals-12', -15919.76, 1532.06, 5082.60],
      [1000, 'heathrow-arrivals-13', -9604.52, 3187.47, 4916.39],
      [4321.5, 'heathrow-arrivals-49', -15406.46, 1666.61, 5069.09],
    ];
    for (const [t, id, x, y, z] of pins) {
      const f = a.flightsAt(t).find(f => f.id === id);
      expect(f, id).toBeTruthy();
      expect(f.x).toBeCloseTo(x, 1); expect(f.y).toBeCloseTo(y, 1); expect(f.z).toBeCloseTo(z, 1);
    }
  } finally { Math.random = random; }
  // Continuity: a flight moves smoothly (no teleports) between adjacent frames.
  // (Violations are collected; Playwright's expect is too costly per sample.)
  const m = F.createTrafficModel({ getSurfaceY: tilted }), jumps = [];
  let pairs = 0;
  for (let t = 500; t < 800; t += 1 / 30) {
    const now = new Map(m.flightsAt(t, { includeHidden: true }).map(f => [f.id, f]));
    for (const f of m.flightsAt(t + 1 / 30, { includeHidden: true })) {
      const p = now.get(f.id); if (!p) continue;
      pairs++;
      const step = Math.hypot(f.x - p.x, f.z - p.z);
      if (!(step < 160 / 30 + 0.5)) jumps.push([f.id, t, step]);
    }
  }
  expect(pairs).toBeGreaterThan(100000);
  expect(jumps).toEqual([]);
});

test('every final approach flies a 3 degree glideslope from about 18km', () => {
  const m = F.createTrafficModel({ getSurfaceY: tilted });
  let checked = 0, longest = 0;
  const off = [];
  for (let t = 0; t < 3600; t += 13) {
    for (const f of m.flightsAt(t, { includeHidden: true })) {
      if (!f.onFinal) continue;
      const d = f.distanceToAimM;
      longest = Math.max(longest, d);
      if (d < 600) continue; // last segment: flare onto the (sloping) runway surface
      const angle = Math.atan((f.altM - f.elevationM) / d) / DEG;
      if (!(angle > 2.99 && angle < 3.01)) off.push([f.id, t, angle]);
      checked++;
    }
  }
  expect(off).toEqual([]);
  expect(checked).toBeGreaterThan(200);
  expect(longest).toBeGreaterThan(F.FINAL_APPROACH_M - 800);
  expect(F.GLIDESLOPE_DEG).toBe(3);
  expect(F.FINAL_APPROACH_M).toBe(18000);
  // Heathrow finals keep at least ~4km separation.
  for (let t = 0; t < 3600; t += 29) {
    const finals = m.flightsAt(t, { includeHidden: true }).filter(f => f.stream === 'heathrow-arrivals' && f.onFinal).map(f => f.distanceToAimM).sort((a, b) => a - b);
    for (let i = 1; i < finals.length; i++) if (!(finals[i] - finals[i - 1] > 4000)) off.push(['separation', t, finals[i] - finals[i - 1]]);
  }
  expect(off).toEqual([]);
});

test('runways are used into wind: westerly default, easterly switch, small tailwind tolerated', () => {
  const heading = f => Math.round(f.heading / DEG);
  const near = (h, target) => Math.abs(((h - target) % 360 + 540) % 360 - 180) < 8;
  let m = F.createTrafficModel({ getSurfaceY: tilted });
  let heathrow = m.flightsAt(2000, { includeHidden: true }).filter(f => f.airport === 'heathrow');
  expect(new Set(heathrow.filter(f => f.kind === 'arrival').map(f => f.runway))).toEqual(new Set(['27L']));
  expect(new Set(heathrow.filter(f => f.kind === 'departure').map(f => f.runway))).toEqual(new Set(['27R']));
  for (const f of heathrow.filter(f => f.onFinal)) expect(near(heading(f), 268)).toBeTruthy();
  const lcyWest = m.chooseRunways('london-city', F.DEFAULT_WIND); expect(lcyWest.land.designator).toBe('27');

  F.setWindSource(EASTERLY);
  m = F.createTrafficModel({ getSurfaceY: tilted });
  heathrow = m.flightsAt(2000, { includeHidden: true }).filter(f => f.airport === 'heathrow');
  expect(new Set(heathrow.filter(f => f.kind === 'arrival').map(f => f.runway))).toEqual(new Set(['09L']));
  expect(new Set(heathrow.filter(f => f.kind === 'departure').map(f => f.runway))).toEqual(new Set(['09R']));
  for (const f of heathrow.filter(f => f.onFinal)) expect(near(heading(f), 88)).toBeTruthy();
  expect(m.chooseRunways('london-city', EASTERLY()).land.designator).toBe('09');
  expect(m.chooseRunways('biggin-hill', { dirRad: 30 * DEG, speedMps: 5 }).land.designator).toBe('03');
  expect(m.chooseRunways('biggin-hill', { dirRad: 200 * DEG, speedMps: 5 }).land.designator).toBe('21');

  // Heathrow keeps its preferred westerly flow in a light easterly.
  expect(m.chooseRunways('heathrow', { dirRad: 90 * DEG, speedMps: 2 }).land.designator).toBe('27L');

  // A wind change mid-session hands over flight by flight: no flight ever
  // changes runway during its own life.
  F.setWindSource(t => (t < 3000 ? F.DEFAULT_WIND : EASTERLY()));
  m = F.createTrafficModel({ getSurfaceY: tilted });
  const seen = new Map(), flips = [];
  for (let t = 2000; t < 5500; t += 5) for (const f of m.flightsAt(t, { includeHidden: true })) {
    if (f.airport !== 'heathrow') continue;
    if (!seen.has(f.id)) seen.set(f.id, f.runway); else if (seen.get(f.id) !== f.runway) flips.push([f.id, t]);
  }
  expect(flips).toEqual([]);
  expect([...seen.values()]).toContain('27L'); expect([...seen.values()]).toContain('09L');
});

test('rendered aircraft stay inside the map edge, above ground, at every sampled instant', () => {
  for (const wind of [null, EASTERLY]) {
    F.setWindSource(wind);
    const m = F.createTrafficModel({ getSurfaceY: tilted }), pts = ring();
    let visible = 0, hidden = 0;
    const bad = [];
    for (let t = 0; t < 7200; t += 7) {
      for (const f of m.flightsAt(t, { includeHidden: true })) {
        if (![f.x, f.y, f.z, f.heading, f.pitch, f.bank].every(Number.isFinite)) bad.push(['non-finite', f.id, t]);
        if (!f.visible) { hidden++; continue; }
        visible++;
        if (!insideRing(f.x, f.z, pts)) bad.push(['outside', f.id, t]);
        else if (distanceToRing(f.x, f.z, pts) < F.EDGE_INSET_M - 1) bad.push(['too near edge', f.id, t]);
        if (f.y < tilted(f) + 1.4) bad.push(['below ground', f.id, t]);
      }
      // What flightsAt returns by default is exactly the visible set.
      if (t % 700 === 0 && !m.flightsAt(t).every(f => f.visible)) bad.push(['default set', t]);
    }
    expect(bad).toEqual([]);
    expect(visible).toBeGreaterThan(10000); expect(hidden).toBeGreaterThan(0);
  }
});

// Sprint 25Sep26f (D-039, Lane F) changed the mix on Jordan's ruling: London
// City a departure about every 2 minutes (arrivals to match), a turboprop at
// London City and Northolt, an A380-class share at Heathrow, and each small
// airfield a steady circuit of 2 or 3 aircraft flying touch-and-go laps. The
// old bounds pinned the 23Sep26w pattern (London City under half of Heathrow,
// regional jets only, 2 to 15 circuit identities an hour); each lap is now its
// own identity, so the circuits' steadiness is pinned per instant in
// flights-fleet.spec.js instead of by identities per hour.
test('traffic mix: heavy Heathrow flow, busy London City, turboprops, circuit types', () => {
  const m = F.createTrafficModel({ getSurfaceY: tilted }), count = {}, models = {}, heathrowModels = {};
  const ids = new Set();
  for (let t = 0; t < 3600; t += 10) for (const f of m.flightsAt(t, { includeHidden: true })) {
    if (ids.has(f.id)) continue; ids.add(f.id);
    count[f.airport] = (count[f.airport] || 0) + 1;
    (models[f.airport] ||= new Set()).add(f.model);
    if (f.airport === 'heathrow') heathrowModels[f.model] = (heathrowModels[f.model] || 0) + 1;
  }
  expect(count.heathrow).toBeGreaterThan(70);                  // ~80 movements an hour
  expect(count['london-city']).toBeGreaterThan(50);            // ~30 departures + ~30 arrivals an hour
  expect(count['london-city']).toBeLessThan(count.heathrow);
  expect(models['london-city']).toEqual(new Set(['regional', 'turboprop']));
  expect(models.heathrow).toEqual(new Set(['superjumbo', 'heavy', 'narrow']));
  const share = heathrowModels.superjumbo / count.heathrow;
  expect(share).toBeGreaterThan(0.03); expect(share).toBeLessThan(0.25);
  expect(models.northolt.has('turboprop')).toBe(true);
  for (const x of models.northolt) expect(['turboprop', 'bizjet']).toContain(x);
  for (const id of ['elstree', 'denham', 'stapleford', 'damyns-hall', 'biggin-hill']) expect([...models[id]]).toEqual(['light']);
  expect([...models.kenley]).toEqual(['glider']);
});

test('hover label reads like a flight but never claims to be a real one', () => {
  const m = F.createTrafficModel({ getSurfaceY: tilted });
  const all = [];
  for (let t = 0; t < 3600; t += 60) all.push(...m.flightsAt(t));
  const arrival = all.find(f => f.stream === 'heathrow-arrivals' && !f.onGround);
  const departure = all.find(f => f.stream === 'heathrow-departures');
  const circuit = all.find(f => f.kind === 'circuit');
  const label = F.formatFlightLabel(arrival);
  expect(label).toContain('Heathrow arrival');
  expect(label).toMatch(/airliner/);
  expect(label).toContain('runway 27L');
  expect(label).toContain('not a real flight');
  expect(F.formatFlightLabel(departure)).toContain('Heathrow departure');
  expect(F.formatFlightLabel(circuit)).toMatch(/circuit/);
  const texts = [...new Set(all.map(f => F.formatFlightLabel(f).replace(/<[^>]+>/g, ' ')))];
  expect(texts.length).toBeGreaterThan(20);
  for (const text of texts) {
    expect(text).toContain('not a real flight');
    // No callsigns, flight numbers, airlines, registrations or destinations.
    expect(text).not.toMatch(/\b[A-Z]{2,3}\s?\d{1,4}[A-Z]?\b/);
    expect(text).not.toMatch(/\bG-[A-Z]{4}\b/);
    expect(text).not.toMatch(/British Airways|easyJet|Ryanair|Virgin|\bBA\b|flight number|callsign|to [A-Z][a-z]+ /i);
    expect(text).not.toMatch(/Airbus|Boeing|Embraer|Cessna|Piper/);
  }
});

// Sprint 25Sep26f (D-039, Lane F): one mesh per type AND livery (8 types x 3
// liveries); the old count of 6 pinned one mesh per type before the two new
// types and the liveries. Every other assertion is unchanged.
test('render group: one instanced mesh per type and livery, baked vertex colour, finite non-degenerate matrices', async () => {
  let scale = 0.4;
  const g = F.createFlights({ getSurfaceY: tilted, getHeightScale: () => scale });
  g.userData.setElapsed(1000);
  const meshes = Object.values(g.userData.meshes);
  expect(meshes).toHaveLength(Object.keys(F.AIRCRAFT_TYPES).length * F.FLIGHT_LIVERIES.length);
  expect(meshes).toHaveLength(24);
  let total = 0;
  const degenerate = [];
  const m4 = new (g.children[0].matrix.constructor)();
  for (const mesh of meshes) {
    expect(mesh.isInstancedMesh).toBeTruthy();
    expect(mesh.instanceColor).toBeNull();
    expect(mesh.material.vertexColors).toBeTruthy();
    expect(mesh.geometry.attributes.color).toBeTruthy();
    expect([...mesh.geometry.attributes.normal.array].every(Number.isFinite)).toBeTruthy();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m4);
      // Never a zero-scale axis: that makes NaN normals, which bloom smears across the frame.
      if (!m4.elements.every(Number.isFinite) || !(Math.abs(m4.determinant()) > 0.1)) degenerate.push([mesh.name, i]);
    }
    total += mesh.count;
  }
  expect(degenerate).toEqual([]);
  expect(total).toBe(g.userData.flights.length);
  expect(total).toBeGreaterThan(8);
  // Structure slider stretches aircraft like parked ones (VE x structure scale).
  const narrow = meshes.find(x => x.userData.model === 'narrow' && x.count > 0); narrow.getMatrixAt(0, m4);
  const det04 = m4.determinant();
  scale = 1; g.userData.setElapsed(1000); narrow.getMatrixAt(0, m4);
  expect(m4.determinant() / det04).toBeCloseTo(2.5, 3);
  // Far aircraft keep a minimum on-screen length; near ones stay true scale.
  const Camera = (await import('three')).PerspectiveCamera;
  const cam = new Camera(50, 1.6, 1, 200000);
  const f0 = g.userData.flights[0];
  cam.position.set(f0.x, f0.y + 30000, f0.z + 40000); cam.lookAt(f0.x, f0.y, f0.z); cam.updateMatrixWorld(true);
  g.userData.update(0, cam);
  const far = g.userData.flights.find(f => f.id === f0.id);
  expect(far.displayScale).toBeGreaterThan(1);
  const depth = Math.hypot(30000, 40000), focal = 450 / Math.tan(25 * DEG);
  expect(far.length * far.displayScale * focal / depth).toBeGreaterThan(F.MIN_ON_SCREEN_PX - 0.1);
  cam.position.set(f0.x + 150, f0.y + 50, f0.z + 150); cam.lookAt(f0.x, f0.y, f0.z); cam.updateMatrixWorld(true);
  g.userData.update(0, cam);
  expect(g.userData.flights.find(f => f.id === f0.id).displayScale).toBe(1);
  g.userData.setMinPixels(0); g.userData.update(0, cam);
  expect(g.userData.flights.every(f => f.displayScale === 1)).toBeTruthy();
  // update() integrates elapsed time; update(0) (paused) holds it.
  g.userData.update(0); expect(g.userData.getElapsed()).toBe(1000);
  g.userData.update(0.5); expect(g.userData.getElapsed()).toBe(1000.5);
  g.userData.dispose();
});

// ── Live scene ──────────────────────────────────────────────────────────────
test('live scene: pinned flights render, switch runway on an easterly and show the hover label', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?skip=1');
  await page.waitForFunction(() => window.__ug?.flightsGroup, null, { timeout: 120000 });
  expect(await page.evaluate(() => window.__ug.flightsInitError)).toBeNull();

  const pinned = await page.evaluate(() => {
    const u = window.__ug; u.sim.paused = true;
    const g = u.flightsGroup; g.userData.setElapsed(1000);
    const f = g.userData.flights.find(f => f.id === 'heathrow-arrivals-13');
    return f && { x: f.x, z: f.z, runway: f.runway, count: g.userData.flights.length };
  });
  expect(pinned).toBeTruthy();
  expect(pinned.runway).toBe('27L');
  expect(pinned.x).toBeCloseTo(-9604.52, -1);   // same path as the model pin, real terrain
  expect(pinned.z).toBeCloseTo(4916.39, -1);
  // Held while paused: frames advance, elapsed does not.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__ug.flightsGroup.userData.getElapsed())).toBe(1000);

  // Frame a final-approach aircraft at the centre of the view, side-on.
  const aim = async () => page.evaluate(() => {
    const u = window.__ug, g = u.flightsGroup, T = window.__ugTHREE;
    const f = g.userData.flights.find(f => f.id === 'heathrow-arrivals-13');
    const target = new T.Vector3(f.x, f.y + 20, f.z);
    u.controls.target.copy(target);
    u.camera.position.set(f.x + 60, f.y + 60, f.z + 320);
    u.camera.lookAt(target); u.controls.update(); u.camera.updateMatrixWorld(true);
    return true;
  });
  await aim();
  await page.waitForTimeout(800);
  const shot = async () => { const png = await page.screenshot({ clip: { x: 540, y: 300, width: 200, height: 200 } }); const img = UPNG.decode(png); return new Uint8Array(UPNG.toRGBA8(img)[0]); };
  const withPlanes = await shot();
  await page.evaluate(() => { window.__ug.flightsGroup.visible = false; });
  await page.waitForTimeout(400);
  const without = await shot();
  await page.evaluate(() => { window.__ug.flightsGroup.visible = true; });
  let changed = 0, lumaSum = 0;
  for (let i = 0; i < withPlanes.length; i += 4) {
    const d = Math.abs(withPlanes[i] - without[i]) + Math.abs(withPlanes[i + 1] - without[i + 1]) + Math.abs(withPlanes[i + 2] - without[i + 2]);
    if (d > 30) { changed++; lumaSum += 0.2126 * withPlanes[i] + 0.7152 * withPlanes[i + 1] + 0.0722 * withPlanes[i + 2]; }
  }
  expect(changed).toBeGreaterThan(300);                 // the aircraft is drawn
  expect(lumaSum / changed).toBeGreaterThan(70);        // and lit, not a black silhouette

  // Hover at the aircraft (screen centre) shows the flight-like label.
  await page.waitForTimeout(300);
  await page.mouse.move(640, 395); await page.mouse.move(640, 400);
  await expect(page.locator('#hoverTip')).toContainText('Heathrow arrival', { timeout: 5000 });
  await expect(page.locator('#hoverTip')).toContainText('not a real flight');

  // Easterly: the integrator's wind source reaches the live module.
  const east = await page.evaluate(() => {
    const g = window.__ug.flightsGroup, mod = g.userData;
    mod.setWindSource(() => ({ dirRad: Math.PI / 2, speedMps: 6 }));
    g.userData.setElapsed(1000);
    const r = [...new Set(g.userData.flightsAt(1000, { includeHidden: true }).filter(f => f.airport === 'heathrow').map(f => `${f.kind}:${f.runway}`))].sort();
    mod.setWindSource(null);
    return r;
  });
  expect(east).toEqual(['arrival:09L', 'departure:09R']);
  expect(errors.filter(e => /flight/i.test(e))).toEqual([]);
});
