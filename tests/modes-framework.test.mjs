// Mode framework: registry switching / fallback, physics-panel persistence,
// Deity speed regime and the D-037 water rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeRegistry } from '../src/modes/registry.js';
import { createPhysicsPanel, PHYSICS_STORAGE_KEY } from '../src/modes/physics-panel.js';
import { deityRegimeSpeed } from '../src/modes/deity-speed.js';
import { createDeityMode, DEITY_TUNABLES } from '../src/modes/deity.js';
import { createPedestrianMode } from '../src/modes/pedestrian.js';
import { createDroneMode } from '../src/modes/drone.js';
import { createBalloonMode } from '../src/modes/balloon.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    data,
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

test('registry: four modes on keys 1-4, stubs fall back to Deity', () => {
  const physics = createPhysicsPanel({ storage: memoryStorage(), document: null });
  const fps = { keys: new Set() };
  const looks = [];
  const reg = createModeRegistry({ onLookMode: (m) => looks.push(m) });
  reg.register(createDeityMode({ fpsControls: fps, physics }));
  for (const f of [createPedestrianMode, createDroneMode, createBalloonMode]) reg.register(f(reg.ctx));
  assert.deepEqual(reg.list().map(m => m.id), ['deity', 'pedestrian', 'drone', 'balloon']);
  assert.deepEqual(['1', '2', '3', '4'].map(k => reg.byKey(k)), ['deity', 'pedestrian', 'drone', 'balloon']);
  assert.equal(reg.byKey('5'), null);
  assert.ok(reg.activate('deity'));
  assert.equal(reg.update(0.016), false, 'Deity keeps the original keyboard path');
  // Lanes A2/A3 replace stubs with real modes (D-037); whichever are still
  // stubs must keep the Deity fallback. Real modes are covered by their own tests.
  for (const id of ['pedestrian', 'drone', 'balloon']) {
    assert.ok(reg.activate(id));
    assert.equal(reg.activeId, id);
    if (!reg.active.stub) continue;
    assert.match(reg.active.hint, /coming/i);
    assert.equal(reg.update(0.016), false, `${id} stub falls back to Deity`);
    assert.equal(looks.at(-1), 'none');
  }
  assert.equal(reg.activate('nope'), false);
  assert.equal(reg.activeId, 'balloon');
});

test('registry: activate/deactivate hooks, owned update, onChange, ctx.time', () => {
  const log = [];
  const reg = createModeRegistry();
  reg.register({ id: 'deity', key: '1', look: 'none', update: () => false });
  reg.register({
    id: 'drone', key: '3', look: 'lock',
    activate: (ctx, from) => log.push(`on:${from}`),
    deactivate: (ctx, to) => log.push(`off:${to}`),
    update: () => true,
  });
  const changes = [];
  reg.onChange((to, from) => changes.push(`${from}->${to}`));
  reg.activate('deity');
  reg.activate('drone');
  assert.equal(reg.update(0.02), true);
  assert.equal(reg.update(0.03), true);
  assert.ok(Math.abs(reg.ctx.time - 0.05) < 1e-12);
  reg.deactivate();
  assert.deepEqual(log, ['on:deity', 'off:deity']);
  assert.deepEqual(changes, ['null->deity', 'deity->drone', 'drone->deity']);
});

test('registry: a throwing mode never kills the frame; Deity takes over', () => {
  const reg = createModeRegistry();
  reg.register({ id: 'bad', update: () => { throw new Error('boom'); } });
  reg.activate('bad');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(reg.update(0.016), false); } finally { console.warn = warn; }
});

test('registry: duplicate keys are refused; replacing the active stub re-activates', () => {
  const reg = createModeRegistry();
  reg.register({ id: 'deity', key: '1', update: () => false });
  assert.throws(() => reg.register({ id: 'other', key: '1', update: () => false }));
  reg.register({ id: 'drone', key: '3', stub: true, update: () => false });
  reg.activate('drone');
  let activated = false;
  reg.register({ id: 'drone', key: '3', activate: () => { activated = true; }, update: () => true });
  assert.ok(activated);
  assert.equal(reg.update(0.016), true);
});

// ── Physics panel persistence ───────────────────────────────────────────────

const DEFS = [
  { key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 20, step: 0.5, default: 6 },
  { key: 'gravity', label: 'Gravity', unit: 'm/s²', min: 0, max: 30, step: 0.1, default: 9.8 },
];

test('physics: defaults, clamping, live params and change events', () => {
  const panel = createPhysicsPanel({ storage: memoryStorage(), document: null });
  const p = panel.register('pedestrian', 'Pedestrian', DEFS);
  assert.equal(p.speed, 6);
  const seen = [];
  panel.onChange((id, key, v) => seen.push([id, key, v]));
  panel.set('pedestrian', 'speed', 99);
  assert.equal(p.speed, 20, 'clamped to max');
  p.gravity = -5;
  assert.equal(p.gravity, 0, 'clamped to min via the param setter');
  assert.deepEqual(seen, [['pedestrian', 'speed', 20], ['pedestrian', 'gravity', 0]]);
  assert.throws(() => panel.register('pedestrian', 'again', DEFS));
});

test('physics: tuned values persist across a reload; only non-defaults are stored', () => {
  const storage = memoryStorage();
  const a = createPhysicsPanel({ storage, document: null });
  a.register('pedestrian', 'Pedestrian', DEFS);
  a.set('pedestrian', 'speed', 7.5);
  assert.deepEqual(JSON.parse(storage.getItem(PHYSICS_STORAGE_KEY)), { pedestrian: { speed: 7.5 } });
  const b = createPhysicsPanel({ storage, document: null });
  const p = b.register('pedestrian', 'Pedestrian', DEFS);
  assert.equal(p.speed, 7.5);
  assert.equal(p.gravity, 9.8);
});

test('physics: reset restores defaults and clears storage for that mode only', () => {
  const storage = memoryStorage();
  const panel = createPhysicsPanel({ storage, document: null });
  const ped = panel.register('pedestrian', 'Pedestrian', DEFS);
  const dro = panel.register('drone', 'Drone', DEFS);
  panel.set('pedestrian', 'speed', 10);
  panel.set('drone', 'gravity', 3);
  panel.reset('pedestrian');
  assert.equal(ped.speed, 6);
  assert.equal(dro.gravity, 3);
  assert.deepEqual(JSON.parse(storage.getItem(PHYSICS_STORAGE_KEY)), { drone: { gravity: 3 } });
  panel.reset();
  assert.deepEqual(JSON.parse(storage.getItem(PHYSICS_STORAGE_KEY)), {});
});

test('physics: tuning for a mode not registered in this build is preserved', () => {
  const storage = memoryStorage({ [PHYSICS_STORAGE_KEY]: JSON.stringify({ balloon: { lag: 4 } }) });
  const panel = createPhysicsPanel({ storage, document: null });
  panel.register('pedestrian', 'Pedestrian', DEFS);
  panel.set('pedestrian', 'speed', 8);
  assert.deepEqual(JSON.parse(storage.getItem(PHYSICS_STORAGE_KEY)), { pedestrian: { speed: 8 }, balloon: { lag: 4 } });
});

test('physics: corrupt, hostile or throwing storage falls back to defaults', () => {
  for (const storage of [
    memoryStorage({ [PHYSICS_STORAGE_KEY]: '{not json' }),
    memoryStorage({ [PHYSICS_STORAGE_KEY]: JSON.stringify({ pedestrian: { speed: 'fast' } }) }),
    { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } },
    null,
  ]) {
    const panel = createPhysicsPanel({ storage, document: null });
    const p = panel.register('pedestrian', 'Pedestrian', DEFS);
    assert.equal(p.speed, 6);
    panel.set('pedestrian', 'speed', 9);
    assert.equal(p.speed, 9);
  }
});

test('physics: Deity tunables default to the shipped feel and drive fpsControls', () => {
  const panel = createPhysicsPanel({ storage: memoryStorage(), document: null });
  const fps = { moveSpeed: 500, sprintMultiplier: 3, rotateSpeed: 1 };
  createDeityMode({ fpsControls: fps, physics: panel });
  assert.deepEqual(fps, { moveSpeed: 500, sprintMultiplier: 3, rotateSpeed: 1 }, 'untuned Deity is unchanged');
  assert.deepEqual(DEITY_TUNABLES.map(d => d.default), [500, 3, 1]);
  panel.set('deity', 'speed', 800);
  assert.equal(fps.moveSpeed, 800);
  panel.reset('deity');
  assert.equal(fps.moveSpeed, 500);
});

// ── Deity speed regime and the water rule ───────────────────────────────────

const VE = 5, BASE = 500, BED = -60, TOP = 12;

test('water: submerged speed equals the speed just above the surface at the same point', () => {
  const above = deityRegimeSpeed({ moveSpeed: BASE, y: TOP + 0.5, surfaceY: BED, submerged: false, waterSurfaceY: null, VE });
  for (const y of [TOP - 0.1, 10, -24, BED + 1]) {
    const under = deityRegimeSpeed({ moveSpeed: BASE, y, surfaceY: BED, submerged: true, waterSurfaceY: TOP, VE });
    assert.equal(under, above, `y=${y}`);
  }
  assert.equal(above, 150, '0.3x low-altitude crawl over the Cutty Sark reach');
});

test('water: over a deep reach the parity still holds above the clamp floor', () => {
  // Hypothetical 200m-deep water: 0.4x above and below alike.
  const bed = TOP - 200 * VE;
  const above = deityRegimeSpeed({ moveSpeed: BASE, y: TOP + 0.1, surfaceY: bed, submerged: false, waterSurfaceY: null, VE });
  const under = deityRegimeSpeed({ moveSpeed: BASE, y: bed + 10, surfaceY: bed, submerged: true, waterSurfaceY: TOP, VE });
  assert.ok(Math.abs(above - under) < 0.1, `${above} vs ${under}`);
});

test('Deity regimes elsewhere are unchanged (D-002)', () => {
  assert.equal(deityRegimeSpeed({ moveSpeed: BASE, y: -4000, surfaceY: 75, submerged: false, VE }), 500, 'underground constant');
  assert.equal(deityRegimeSpeed({ moveSpeed: BASE, y: 75 + 1000 * VE, surfaceY: 75, submerged: false, VE }), 1000, '1000m = 2x');
  assert.equal(deityRegimeSpeed({ moveSpeed: BASE, y: 1e7, surfaceY: 75, submerged: false, VE }), 10000, '20x ceiling');
  assert.equal(deityRegimeSpeed({ moveSpeed: BASE, y: 100, surfaceY: null, submerged: false, VE }), 500, 'no terrain: base');
  assert.equal(deityRegimeSpeed({ moveSpeed: BASE, y: 5, surfaceY: BED, submerged: true, waterSurfaceY: null, VE }), 500,
    'unknown water top keeps the historical base');
});
