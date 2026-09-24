// Lane O (sprint 24Sep26h, D-038): the opening. An honest loading bar holds
// the April descent until everything it shows is ready (plus shader
// pre-compilation and warm-up renders), then the descent plays silently from
// frame 0 on a frame-safe clock and lands at the tuned pose. Deep links still
// bypass it (D-028).
//
// One cold boot per test is expensive (~20s), so the descent test checks the
// frame-gap record, the sampled path, the landing and silence in one visit.
import { test, expect } from '@playwright/test';

// Recorder installed before any app script: every animation frame's
// timestamp, the intro's phase and played time, and the camera position (read
// before this frame's tick, so position and played time are one consistent
// pair from the previous update). Also counts AudioContext construction.
const RECORDER = () => {
  window.__audioContexts = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[name];
    if (!Orig) continue;
    window[name] = class extends Orig { constructor(...a) { super(...a); window.__audioContexts++; } };
  }
  window.__frames = [];
  const rec = ts => {
    const u = window.__ug;
    const i = u?.intro;
    if (i) {
      const p = u.camera.position;
      window.__frames.push({ ts, phase: i.getPhase(), played: i.getPlayedMs(), x: p.x, y: p.y, z: p.z });
    }
    if (!i || i.getPhase() !== 'done') requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
  window.addEventListener('ug:opening-reveal', () => {
    const u = window.__ug, S = u.scene;
    const b = u.bakedStats;
    window.__reveal = {
      at: performance.now(),
      terrain: !!S.getObjectByName('terrainMesh'),
      groundReady: u.groundReady,
      buildingsBuilt: !!(b && b.tilesTotal > 0 && b.tilesBuilt === b.tilesTotal),
      buildingsPath: u.buildingsPath,
      landmarks: (u.landmarkGroup?.children.length || 0) > 0,
      lines: S.children.filter(c => c.name?.startsWith('line:')).length,
      labels: document.querySelectorAll('.station-label').length,
      thames: !!u.thamesMesh,
      bridges: !!u.bridgesGroup,
      overground: !!u.overground?.userData?.stationsAttached,
      motorway: !!u.motorwayGroup,
      airports: !!u.airportsGroup,
      shafts: !!u.unifiedShaftLayer,
      barPct: Number(document.getElementById('loadingBar')?.getAttribute('aria-valuenow')),
      gate: u.openingGate.getState(),
      programs: u.composer.renderer.info.programs.length,
    };
  }, { once: true });
};

async function boot(page, url) {
  await page.addInitScript(RECORDER);
  await page.goto(url);
  await page.waitForFunction(() => window.__ug?.openingGate, null, { timeout: 60000 });
}

test.describe('Lane O: opening', () => {
  test('bar is honest: 100% only when the readiness set is complete, then the descent starts', async ({ page }) => {
    test.setTimeout(180000);
    await boot(page, '/?buildings=baked');
    const early = await page.evaluate(() => ({
      veil: document.getElementById('loadingBar').classList.contains('veil'),
      done: document.getElementById('loadingBar').classList.contains('done'),
      phase: window.__ug.intro.getPhase(),
      y: window.__ug.camera.position.y,
      audioReady: window.__ug.isAudioReady(),
    }));
    expect(early.veil).toBe(true);
    expect(early.done).toBe(false);
    expect(early.phase).toBe('waiting');
    expect(early.y).toBe(25000);
    expect(early.audioReady).toBe(false);

    await page.waitForFunction(() => window.__reveal, null, { timeout: 120000 });
    const r = await page.evaluate(() => window.__reveal);
    console.log('[opening] reveal', JSON.stringify({ ...r, gate: { timeline: r.gate.timeline, compile: r.gate.compile } }));
    // Independent check of the scene at the moment the bar let go.
    expect(r.terrain).toBe(true);
    expect(r.groundReady).toBe(true);
    expect(r.buildingsPath).toBe('baked');
    expect(r.buildingsBuilt).toBe(true);
    expect(r.landmarks).toBe(true);
    expect(r.lines).toBeGreaterThanOrEqual(11);
    expect(r.labels).toBeGreaterThan(0);
    expect(r.thames).toBe(true);
    expect(r.bridges).toBe(true);
    expect(r.overground).toBe(true);
    expect(r.motorway).toBe(true);
    expect(r.airports).toBe(true);
    expect(r.shafts).toBe(true);
    expect(r.barPct).toBe(100);
    // Nothing gave up or timed out on a healthy load.
    for (const item of r.gate.readiness.items) expect(item.status, item.id).toBe('ready');
    expect(r.gate.compile.ms).not.toBeNull();
    // The bar's whole history: it never showed 100% before completion.
    const log = r.gate.barLog;
    expect(log.length).toBeGreaterThan(3);
    for (const e of log) if (e.pct >= 100) expect(e.complete).toBe(true);
    expect(log.filter(e => !e.complete).every(e => e.pct < 100)).toBe(true);
    for (let i = 1; i < log.length; i++) expect(log[i].pct).toBeGreaterThanOrEqual(log[i - 1].pct);
    // The descent starts on the frame the bar lets go, and the bar fades.
    expect(await page.evaluate(() => window.__ug.intro.getPhase())).toBe('playing');
    expect(await page.evaluate(() => document.getElementById('loadingBar').classList.contains('done'))).toBe(true);
  });

  test('descent: frame 0 to landing, full path, no frame gap over 100ms, silent', async ({ page }) => {
    test.setTimeout(180000);
    await boot(page, '/?buildings=baked');
    await page.waitForFunction(() => window.__ug.intro.getPhase() === 'done', null, { timeout: 150000 });
    await page.waitForTimeout(100);
    const res = await page.evaluate(() => {
      const u = window.__ug, p = u.intro.getParams();
      const frames = window.__frames;
      const playing = frames.filter(f => f.phase === 'playing');
      const firstIdx = frames.indexOf(playing[0]);
      // Descent window: from the first playing frame to the first frame after it ended.
      const lastIdx = frames.findIndex((f, i) => i > firstIdx && f.phase === 'done');
      const win = frames.slice(firstIdx, lastIdx + 1);
      let maxGap = 0, over50 = 0, over100 = 0; const gaps = [];
      for (let i = 1; i < win.length; i++) {
        const g = win[i].ts - win[i - 1].ts; gaps.push(g);
        maxGap = Math.max(maxGap, g); if (g > 50) over50++; if (g > 100) over100++;
      }
      let maxStep = 0;
      for (let i = 1; i < playing.length; i++) maxStep = Math.max(maxStep, playing[i].played - playing[i - 1].played);
      const sample = target => {
        const f = playing.reduce((a, b) => Math.abs(b.played - target) < Math.abs(a.played - target) ? b : a);
        const e = u.intro.poseAt(f.played);
        return { target, played: f.played, err: Math.hypot(f.x - e.x, f.y - e.y, f.z - e.z), y: f.y };
      };
      gaps.sort((a, b) => a - b);
      return {
        frames: win.length, first: playing[0], maxGap, over50, over100, maxStep,
        p50: gaps[Math.floor(gaps.length / 2)], p95: gaps[Math.floor(gaps.length * 0.95)],
        wallMs: win.at(-1).ts - win[0].ts,
        samples: [1000, 4500, 8000].map(sample),
        end: u.camera.position.toArray(), expected: [p.endX, p.endY, p.endZ],
        orbit: u.controls.enabled, keyboard: u.fpsControls.enabled,
        audioContexts: window.__audioContexts, audioReady: u.isAudioReady(),
      };
    });
    console.log('[opening] descent', JSON.stringify(res));
    // Frame 0 of the path was drawn: the first playing frame is the start pose.
    expect(res.first.played).toBe(0);
    expect(res.first.y).toBe(25000);
    // Frame-safe clock: no frame advanced the path by more than the clamp.
    expect(res.maxStep).toBeLessThanOrEqual(50 + 1e-6);
    // The full path was flown: frames near 1s, 4.5s and 8s sit on the curve.
    for (const s of res.samples) {
      expect(Math.abs(s.played - s.target), `sample ${s.target}`).toBeLessThan(60);
      expect(s.err, `pose error at ${s.target}`).toBeLessThan(0.01);
    }
    expect(res.maxGap, `worst frame gap during the descent (p95 ${res.p95}ms)`).toBeLessThanOrEqual(100);
    // Lands at the tuned pose, controls handed back.
    for (let i = 0; i < 3; i++) expect(res.end[i]).toBeCloseTo(res.expected[i], 6);
    expect(res.orbit).toBe(true);
    expect(res.keyboard).toBe(true);
    // Silent: no AudioContext exists without an interaction.
    expect(res.audioContexts).toBe(0);
    expect(res.audioReady).toBe(false);
  });

  test('live buildings path (default URL): the bar waits for the descent footprint, then streaming pauses in flight', async ({ page }) => {
    test.setTimeout(180000);
    await page.addInitScript(() => localStorage.clear());
    await boot(page, '/');
    await page.waitForFunction(() => window.__reveal, null, { timeout: 150000 });
    const r = await page.evaluate(() => {
      const u = window.__ug, p = u.intro.getParams();
      // Independently recompute the footprint: tiles within 6km of the path's ground track.
      const vx = p.endX - p.startX, vz = p.endZ - p.startZ, vv = vx * vx + vz * vz;
      const near = u.getSurfaceTileStates().filter(t => {
        const k = Math.max(0, Math.min(1, ((t.cx - p.startX) * vx + (t.cz - p.startZ) * vz) / vv));
        return Math.hypot(t.cx - p.startX - vx * k, t.cz - p.startZ - vz * k) <= 6000;
      });
      return { path: u.buildingsPath, near: near.length, nearLoaded: near.filter(t => t.state === 'loaded').length,
        instances: u.buildingInstanceCount, items: window.__reveal.gate.readiness.items, phase: u.intro.getPhase() };
    });
    console.log('[opening] live', JSON.stringify({ ...r, items: r.items.map(i => `${i.id}:${i.status}@${i.at}`) }));
    expect(r.path).toBe('live');
    expect(r.near).toBeGreaterThan(20);
    expect(r.nearLoaded).toBe(r.near);
    expect(r.instances).toBeGreaterThan(100000);
    for (const item of r.items) expect(item.status, item.id).toBe('ready');
    expect(r.phase).toBe('playing');
    // While the descent plays no new tile fetch starts; streaming resumes at landing.
    await page.waitForTimeout(3000);
    const mid = await page.evaluate(() => ({ phase: window.__ug.intro.getPhase(), loading: window.__ug.surfaceLoaderStats.loading }));
    if (mid.phase === 'playing') expect(mid.loading).toBe(0);
    await page.waitForFunction(() => window.__ug.intro.getPhase() === 'done', null, { timeout: 30000 });
    await page.waitForFunction(() => window.__ug.surfaceLoaderStats.loading > 0 || window.__ug.surfaceLoaderStats.loaded > 60, null, { timeout: 15000 });
  });

  for (const query of ['fast=1&buildings=baked', 'skip=1', 'hx=5&buildings=baked', 'view=0,2000,0,0,0,-1000']) {
    test(`deep link bypasses the opening and its veil: ${query}`, async ({ page }) => {
      await boot(page, `/?${query}`);
      await page.waitForFunction(() => window.__ug.openingGate.getState().stage === 'done', null, { timeout: 15000 });
      const s = await page.evaluate(() => ({
        phase: window.__ug.intro.getPhase(),
        veil: document.getElementById('loadingBar').classList.contains('veil'),
        stage: window.__ug.openingGate.getState().stage,
        orbit: window.__ug.controls.enabled,
      }));
      expect(s.phase).toBe('bypassed');
      expect(s.veil).toBe(false);
      expect(s.stage).toBe('done');
      expect(s.orbit).toBe(true);
    });
  }
});
