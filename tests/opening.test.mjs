// Lane O (sprint 24Sep26h): honest readiness, the opening gate's stages and
// the intro's frame-safe clock, without a browser.
// Run: node --test tests/opening.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createReadiness } from '../src/loading-readiness.js';
import { createOpeningGate, WARM_FRACTIONS, SHADERS_ID, WARMUP_ID } from '../src/loading-gate.js';
import { createIntro, introPoseAt, INTRO_DEFAULTS, MAX_STEP_MS } from '../src/intro.js';

// intro.js arms skip listeners on document and dispatches on window.
const listeners = new Map();
globalThis.document ??= {
  addEventListener: (t, f) => listeners.set(t, f),
  removeEventListener: (t) => listeners.delete(t),
};
globalThis.window ??= { dispatchEvent: () => true, location: { search: '' } };
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('readiness reaches exactly 1 only when every item has settled', () => {
  const c = clock();
  let a = false, b = 0;
  const r = createReadiness([
    { id: 'a', weight: 3, check: () => a },
    { id: 'b', weight: 1, check: () => b },
    { id: 'manual', weight: 1 },
  ], c);
  r.poll();
  assert.equal(r.fraction(), 0);
  b = 1; // a check reporting 1 as a NUMBER is progress, not settlement
  r.poll();
  assert.ok(r.fraction() < 1);
  assert.equal(r.isSettled('b'), false);
  a = true; b = true;
  r.poll();
  assert.equal(r.allSettled(), false, 'manual item still pending');
  assert.ok(r.fraction() < 1 && r.fraction() >= 0.99 * (4 / 5));
  r.settle('manual');
  assert.equal(r.fraction(), 1);
  assert.equal(r.snapshot().complete, true);
});

test('readiness progress is monotonic and failure settles an item', () => {
  let v = 0.6;
  const r = createReadiness([{ id: 'x', check: () => v }, { id: 'y', check: () => 'failed' }]);
  r.poll();
  const f1 = r.fraction();
  v = 0.2; // a layer that briefly reports less must not move the bar back
  r.poll();
  assert.equal(r.fraction(), f1);
  assert.equal(r.snapshot().items.find(i => i.id === 'y').status, 'failed');
  r.expire(['x']);
  assert.equal(r.snapshot().items.find(i => i.id === 'x').status, 'timeout');
  assert.equal(r.fraction(), 1);
});

test('descent pose function follows the April Track C defaults exactly', () => {
  const p = { ...INTRO_DEFAULTS, startX: 100, startZ: -200 };
  assert.equal(p.startY, 25000);
  assert.equal(p.totalMs, 9000);
  assert.deepEqual([p.endX, p.endY, p.endZ], [-194.15, -39.0, -2162.75]);
  assert.deepEqual(introPoseAt(p, 0), { x: 100, y: 25000, z: -200 });
  assert.deepEqual(introPoseAt(p, 9000), { x: p.endX, y: p.endY, z: p.endZ });
  // easeOutCubic at t = 0.5: 1 - 0.5^3 = 0.875
  const mid = introPoseAt(p, 4500);
  assert.ok(Math.abs(mid.y - (25000 + (-39 - 25000) * 0.875)) < 1e-9);
});

function makeIntro(c) {
  const camera = new THREE.PerspectiveCamera();
  const controls = { enabled: true, target: new THREE.Vector3() };
  const fps = { enabled: true };
  const intro = createIntro({ camera, controls, fpsControls: fps, llToXZ: () => ({ x: 0, z: 0 }), now: c.now });
  return { intro, camera, controls, fps };
}

test('intro waits at the start pose until begin(), then draws frame 0', () => {
  const c = clock();
  const { intro, camera, controls } = makeIntro(c);
  intro.run();
  assert.equal(intro.getPhase(), 'waiting');
  assert.equal(intro.isRunning(), true);
  assert.equal(controls.enabled, false);
  for (let i = 0; i < 100; i++) { c.advance(100); intro.update(0.1); }
  assert.equal(camera.position.y, 25000, 'no descent while waiting');
  assert.equal(listeners.has('click'), false, 'skip is not armed while loading');
  intro.begin();
  assert.equal(listeners.has('click'), true);
  intro.update(0.5); // however long the first delta, frame 0 is the start pose
  assert.equal(intro.getPlayedMs(), 0);
  assert.equal(camera.position.y, 25000);
});

test('a stall pauses the descent instead of skipping it (clamped delta)', () => {
  const c = clock();
  const { intro, camera } = makeIntro(c);
  intro.run(); intro.begin(); intro.update(0.016);
  c.advance(5400); intro.update(5.4); // the measured boot block
  assert.equal(intro.getPlayedMs(), MAX_STEP_MS);
  const expect = introPoseAt(intro.getParams(), MAX_STEP_MS);
  assert.ok(Math.abs(camera.position.y - expect.y) < 1e-6);
  assert.ok(camera.position.y > 20000, 'still high: the flight resumed, not cut');
});

test('the 15s watchdog counts from started-playing, not from boot', () => {
  const c = clock();
  const { intro, fps } = makeIntro(c);
  intro.run();
  c.advance(20000); intro.update(0.016); // a long load does not trip it
  assert.equal(intro.getPhase(), 'waiting');
  intro.begin(); intro.update(0.016);
  // A 5fps device advances 50ms per 200ms frame: the watchdog ends it at 15s.
  let frames = 0;
  while (intro.isRunning() && frames < 1000) { c.advance(200); intro.update(0.2); frames++; }
  assert.equal(intro.getPhase(), 'done');
  assert.equal(frames, 75);
  assert.equal(fps.enabled, true);
});

test('60fps playback lands at the tuned pose after 9s', () => {
  const c = clock();
  const { intro, camera } = makeIntro(c);
  intro.run(); intro.begin(); intro.update(0);
  let n = 0;
  while (intro.isRunning() && n < 2000) { c.advance(1000 / 60); intro.update(1 / 60); n++; }
  assert.ok(Math.abs(n - 540) <= 1, `frames ${n}`);
  const p = intro.getParams();
  assert.deepEqual(camera.position.toArray(), [p.endX, p.endY, p.endZ]);
});

test('gate: bar stays below 100% until layers, shaders and warm-up are all done', async () => {
  const c = clock();
  const { intro, camera } = makeIntro(c);
  intro.run();
  const layers = { terrain: false, tube: 0 };
  let resolveCompile;
  const renders = [];
  const renderer = { info: { programs: [] }, shadowMap: { needsUpdate: false },
    compileAsync: () => new Promise(r => { resolveCompile = r; }) };
  const composer = { render: () => renders.push(camera.position.y) };
  const events = [];
  const gate = createOpeningGate({ intro, renderer, composer, scene: {}, camera, now: c.now,
    dispatch: (name, detail) => events.push({ name, detail }),
    items: [
      { id: 'terrain', check: () => layers.terrain },
      { id: 'tube', check: () => layers.tube },
    ] });
  gate.frame();
  layers.tube = 0.5; gate.frame();
  layers.terrain = true; layers.tube = true; gate.frame();
  assert.equal(gate.getState().stage, 'compiling');
  assert.ok(gate.getState().fraction < 1);
  resolveCompile(); await new Promise(r => setImmediate(r));
  assert.equal(gate.getState().readiness.items.find(i => i.id === SHADERS_ID).status, 'ready');
  for (let i = 0; i < WARM_FRACTIONS.length; i++) {
    assert.equal(intro.getPhase(), 'waiting');
    gate.frame();
    assert.equal(camera.position.y, 25000, 'warm-up restores the start pose');
  }
  assert.equal(renders.length, WARM_FRACTIONS.length);
  assert.equal(renders.at(-1), -39, 'last warm-up render is the landing pose');
  assert.equal(gate.getState().readiness.items.find(i => i.id === WARMUP_ID).status, 'ready');
  gate.frame();
  assert.equal(intro.getPhase(), 'playing');
  assert.equal(events[0].name, 'ug:opening-reveal');
  const log = gate.getState().barLog;
  assert.ok(log.every(e => e.pct < 100 || e.complete), JSON.stringify(log));
  assert.equal(log.at(-1).pct, 100);
});

test('gate: a silently failed minor layer is given up after the grace period', () => {
  const c = clock();
  const { intro, camera } = makeIntro(c);
  intro.run();
  const renderer = { info: { programs: [] }, compileAsync: () => new Promise(() => {}) };
  const gate = createOpeningGate({ intro, renderer, composer: { render() {} }, scene: {}, camera, now: c.now,
    dispatch: () => {}, coreIds: ['core'], graceMs: 10000,
    items: [{ id: 'core', check: () => true }, { id: 'minor', check: () => false }] });
  gate.frame();
  c.advance(9999); gate.frame();
  assert.equal(gate.getState().stage, 'loading');
  c.advance(2); gate.frame();
  assert.equal(gate.getState().stage, 'compiling');
  assert.equal(gate.getState().readiness.items.find(i => i.id === 'minor').status, 'timeout');
});

test('gate: deep links bypass it entirely', () => {
  const c = clock();
  globalThis.window.location.search = '?fast=1';
  const { intro, camera } = makeIntro(c);
  intro.run();
  globalThis.window.location.search = '';
  assert.equal(intro.getPhase(), 'bypassed');
  let compiled = false;
  const gate = createOpeningGate({ intro, renderer: { compileAsync: async () => { compiled = true; } },
    composer: { render() {} }, scene: {}, camera, now: c.now, dispatch: () => {},
    items: [{ id: 'a', check: () => true }] });
  gate.frame(); gate.frame();
  assert.equal(gate.getState().stage, 'done');
  assert.equal(compiled, false);
});
