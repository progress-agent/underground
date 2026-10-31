// Sprint 21Oct26w, lane L: the faster opening. The late layers (motorway, airports, flights, the map-edge cliff,
// reservoirs, canals, sea life, surface trains) are built after landing; the four hooks for lane V are inert in the
// default opening; nothing is rendered behind the veil; a deep link still bypasses the opening and still paints the ground.
import { test, expect } from '@playwright/test';

const EVENTS = ['ug:opening-reveal', 'ug:intro-done', 'ug:late-layer', 'ug:late-layers-done', 'ug:landing-lock'];
const LAYER_IDS = ['canals', 'reservoirs', 'surfaceTrains', 'seaLife', 'motorway', 'cliff', 'airports', 'flights', 'corridor']; // corridor: the beyond-edge corridor, queued once its sources exist

const RECORDER = () => {
  window.__ev = [];
  window.__renders = { behindVeil: 0, total: 0 };
  for (const n of ['ug:opening-reveal', 'ug:intro-done', 'ug:late-layer', 'ug:late-layers-done', 'ug:landing-lock']) {
    window.addEventListener(n, e => window.__ev.push({ n, at: performance.now(), id: e.detail?.id, state: e.detail?.state }));
  }
  window.addEventListener('ug:opening-reveal', () => {
    const u = window.__ug;
    window.__reveal = {
      items: u.openingGate.getState().readiness.items.map(i => ({ id: i.id, status: i.status })),
      timeline: u.openingGate.getState().timeline,
      motorway: !!u.motorwayGroup, airports: !!u.airportsGroup, flights: !!u.flightsGroup,
      terrain: !!u.scene.getObjectByName('terrainMesh'), thames: !!u.thamesMesh, geology: !!u.scene.getObjectByName('geological-strata'),
      lockOpen: u.openingHooks.landingLock.isOpen(), phase: u.intro.getPhase(),
      layers: u.lateLayers.snapshot().map(l => ({ id: l.id, state: l.state })),
    };
  }, { once: true });
  // Count composer renders made while the gate is still loading or compiling shaders (behind the opaque veil).
  const wrap = setInterval(() => {
    const u = window.__ug;
    if (!u?.composer || !u.openingGate) return;
    clearInterval(wrap);
    const render = u.composer.render.bind(u.composer);
    u.composer.render = (...a) => {
      window.__renders.total++;
      const st = u.openingGate.getState().stage;
      if (st === 'loading' || st === 'compiling') window.__renders.behindVeil++;
      return render(...a);
    };
  }, 5);
};

test.describe('Lane L: the faster opening', () => {
  test('late layers: absent at the reveal, started only after landing, all attached within 10 s of it', async ({ page }) => {
    test.setTimeout(240000);
    await page.addInitScript(RECORDER);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?buildings=baked&mh=1.1&bh=2');
    await page.waitForFunction(() => window.__ev.some(e => e.n === 'ug:late-layers-done'), null, { timeout: 200000 });
    const r = await page.evaluate(() => ({ reveal: window.__reveal, ev: window.__ev, snap: window.__ug.lateLayers.snapshot(), renders: window.__renders,
      hooks: { buildOrder: window.__ug.openingHooks.buildOrder, lockOpen: window.__ug.openingHooks.landingLock.isOpen() },
      baked: window.__ug.scene.getObjectByName('surfaceGeometry').children.filter(c => c.name.startsWith('baked-buildings-')).map(c => Number(c.name.split('-').pop())) }));
    // At the reveal: what the descent shows is present, the deferred layers are not.
    expect(r.reveal.terrain && r.reveal.thames && r.reveal.geology).toBe(true);
    expect(r.reveal.motorway).toBe(false);
    expect(r.reveal.airports).toBe(false);
    expect(r.reveal.flights).toBe(false);
    for (const item of r.reveal.items) expect(item.status, item.id).toBe('ready');
    const ids = r.reveal.items.map(i => i.id);
    expect(ids).not.toContain('reservoirs');
    expect(ids).not.toContain('canals');
    expect(ids.slice(-2)).toEqual(['shaders', 'warmup']);
    expect(r.reveal.layers.every(l => l.state === 'waiting')).toBe(true);
    // Hooks inert: the default build order, the lock open as the descent begins, the phase playing.
    expect(r.hooks.buildOrder).toBeNull();
    expect(r.reveal.lockOpen).toBe(true);
    expect(r.reveal.phase).toBe('playing');
    const at = (n) => r.ev.find(e => e.n === n)?.at;
    expect(at('ug:landing-lock')).toBeLessThanOrEqual(at('ug:opening-reveal'));
    expect(r.ev.filter(e => e.n === 'ug:landing-lock').length).toBe(1);
    // Index order for the baked city.
    expect(r.baked).toEqual([...r.baked].sort((a, b) => a - b));
    // Late layers: every one started after landing, every one attached, all within 10 s.
    const landed = at('ug:intro-done');
    expect(r.snap.map(l => l.id).sort()).toEqual([...LAYER_IDS].sort());
    for (const l of r.snap) {
      expect(l.state, l.id).toBe('attached');
      expect(l.startedAt, `${l.id} started after landing`).toBeGreaterThanOrEqual(landed - 50);
    }
    expect(at('ug:late-layers-done') - landed).toBeLessThan(10000);
    for (const l of r.snap) console.log(`[late] ${l.id}: attached ${((l.attachedAt - landed) / 1000).toFixed(2)} s after landing, ${l.steps} steps, max step ${l.maxStepMs} ms, build ${l.buildMs} ms, compile ${l.compileMs} ms`);
    // Nothing was rendered behind the veil by the tick (the gate's warm-up renders happen in the warming stage).
    expect(r.renders.behindVeil).toBe(0);
    expect(errors, 'console errors').toEqual([]);
  });

  test('request(id) starts a late layer before the veil lifts (hook 2), and completeRadius is Infinity once the city is built (hook 1)', async ({ page }) => {
    test.setTimeout(240000);
    await page.addInitScript(RECORDER);
    await page.addInitScript(() => {
      const poll = setInterval(() => {
        const h = window.__ug?.openingHooks;
        if (h?.lateLayers && h.lateLayers.ids().includes('motorway')) { clearInterval(poll); h.lateLayers.request('motorway'); window.__requestedAt = performance.now(); }
      }, 5);
    });
    await page.goto('/?buildings=baked&mh=1.1&bh=2');
    await page.waitForFunction(() => window.__ev.some(e => e.n === 'ug:late-layers-done'), null, { timeout: 200000 });
    const r = await page.evaluate(() => ({ ev: window.__ev, snap: window.__ug.lateLayers.snapshot(), radius: window.__ug.openingHooks.completeRadius({ x: 0, z: 0 }), requestedAt: window.__requestedAt }));
    const motorway = r.snap.find(l => l.id === 'motorway');
    const reveal = r.ev.find(e => e.n === 'ug:opening-reveal').at;
    expect(r.requestedAt).toBeGreaterThan(0);
    expect(motorway.requestedAt).not.toBeNull();
    expect(motorway.attachedAt).toBeLessThan(r.ev.find(e => e.n === 'ug:intro-done').at);
    expect(motorway.startedAt).toBeLessThan(reveal + 2000);
    expect(r.radius).toBe(Infinity);
  });

  test('deep links bypass the opening and still pace the ground (?fast=1)', async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => {
      window.__frameTimes = [];
      const rec = ts => { window.__frameTimes.push(ts); requestAnimationFrame(rec); };
      requestAnimationFrame(rec);
      const poll = () => { if (window.__ug?.groundReady && !window.__groundAt) window.__groundAt = performance.now(); else requestAnimationFrame(poll); };
      requestAnimationFrame(poll);
    });
    await page.goto('/?fast=1&buildings=baked');
    await page.waitForFunction(() => window.__ug?.groundReady && window.__ug.lateLayers.settled(), null, { timeout: 90000 });
    const r = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource').find(e => /baked\/ground\.bin/.test(e.name));
      const between = window.__frameTimes.filter(t => t > res.responseEnd && t <= window.__groundAt).length;
      return { phase: window.__ug.intro.getPhase(), veil: document.getElementById('loadingBar').classList.contains('veil'), between,
        groundPath: window.__ug.groundPath, layers: window.__ug.lateLayers.snapshot().map(l => l.state) };
    });
    expect(r.phase).toBe('bypassed');
    expect(r.veil).toBe(false);
    expect(r.groundPath).toBe('baked');
    expect(r.between, 'frames presented while the ground was expanded (the per-chunk pacing is kept)').toBeGreaterThanOrEqual(50);
    expect(r.layers.every(s => s === 'attached' || s === 'failed')).toBe(true);
  });

  test('the compressed payload falls back to buildings.bin when it is missing, and a changed airport fingerprint falls back to live (L-19 d, L-20)', async ({ browser }) => {
    test.setTimeout(240000);
    // (d) buildings.z.bin answers 404: the city still builds, from buildings.bin.
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const bins = [], pageErrors = [], warnings = [];
      page.on('response', r => { if (/\/baked\/buildings(\.z)?\.bin/.test(r.url())) bins.push([r.url().split('/').pop(), r.status()]); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
      await page.route('**/baked/buildings.z.bin', r => r.fulfill({ status: 404, body: 'not found' }));
      await page.goto('/?fast=1&buildings=baked');
      await page.waitForFunction(() => window.__ug?.bakedStats && window.__ug.bakedStats.tilesBuilt === window.__ug.bakedStats.tilesTotal, null, { timeout: 90000 });
      expect(await page.evaluate(() => window.__ug.buildingsPath)).toBe('baked');
      expect(bins.some(([n, st]) => n === 'buildings.bin' && st === 200)).toBe(true);
      expect(pageErrors).toEqual([]);
      expect(warnings.filter(w => /Baked buildings unavailable/.test(w))).toEqual([]);
      await context.close();
    }
    // (L-20) an untouched load checks the airport fingerprint and runs baked; a different fingerprint falls back to live with the warning.
    for (const tamper of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const warnings = [], pageErrors = [];
      page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
      page.on('pageerror', e => pageErrors.push(String(e)));
      if (tamper) await page.route('**/baked/meta.json', async route => {
        const response = await route.fetch();
        const meta = await response.json();
        meta.airportSuppression = { ...meta.airportSuppression, fingerprint: 'f'.repeat(64) };
        await route.fulfill({ response, json: meta });
      });
      await page.goto('/?fast=1&buildings=baked');
      if (tamper) {
        await page.waitForFunction(() => window.__ug?.buildingsPath === 'live', null, { timeout: 90000 });
        expect(warnings.filter(w => /Baked buildings unavailable \(baked airport replacements unavailable or incompatible\)/.test(w)).length).toBe(1);
      } else {
        await page.waitForFunction(() => window.__ug?.openingGate && window.__ug.bakedStats?.tilesBuilt > 0, null, { timeout: 90000 });
        expect(await page.evaluate(() => window.__ug.buildingsPath)).toBe('baked');
        expect(warnings.filter(w => /Baked buildings unavailable/.test(w))).toEqual([]);
      }
      expect(pageErrors).toEqual([]);
      await context.close();
    }
  });
});
