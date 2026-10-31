// Sprint 21Oct26w, lane L: the opening gate's cheap stage() accessor (approach C reads it every frame) and, as the
// lane grows, the gate hooks lane V uses. Node only; same stubs as tests/opening.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOpeningGate, WARM_FRACTIONS } from '../src/loading-gate.js';
import { createIntro } from '../src/intro.js';

globalThis.document ??= { addEventListener() {}, removeEventListener() {} };
globalThis.window ??= { dispatchEvent: () => true, location: { search: '' } };
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

function setup(extra = {}) {
  let t = 1000;
  const now = () => t;
  const camera = new THREE.PerspectiveCamera();
  const intro = createIntro({ camera, controls: { enabled: true, target: new THREE.Vector3() }, fpsControls: { enabled: true },
    llToXZ: () => ({ x: 0, z: 0 }), now });
  intro.run();
  let resolveCompile;
  const renderer = { info: { programs: [] }, shadowMap: { needsUpdate: false }, compileAsync: () => new Promise(r => { resolveCompile = r; }) };
  const events = [];
  const layers = { a: false };
  const gate = createOpeningGate({ intro, renderer, composer: { render() {} }, scene: {}, camera, now,
    dispatch: (name, detail) => events.push({ name, detail }), items: [{ id: 'a', check: () => layers.a }], ...extra });
  return { gate, intro, layers, events, resolve: () => resolveCompile(), advance: (ms) => { t += ms; } };
}

test('stage() follows loading, compiling, warming, reveal, done', async () => {
  const s = setup();
  assert.equal(s.gate.stage(), 'loading');
  s.gate.frame();
  assert.equal(s.gate.stage(), 'loading');
  s.layers.a = true; s.gate.frame();
  assert.equal(s.gate.stage(), 'compiling');
  assert.equal(s.gate.stage(), s.gate.getState().stage);
  s.resolve(); await new Promise(r => setImmediate(r));
  assert.equal(s.gate.stage(), 'warming');
  for (let i = 0; i < WARM_FRACTIONS.length; i++) s.gate.frame();
  assert.equal(s.gate.stage(), 'reveal');
  s.gate.frame();
  assert.equal(s.gate.stage(), 'done');
});

test('the landing lock: closed before the gate is done, open after, ug:landing-lock fired exactly once', async () => {
  const s = setup();
  const { createOpeningHooks } = await import('../src/opening-hooks.js');
  const hooks = createOpeningHooks().register({ gate: s.gate, getSurfaceY: () => 12, VE: 5, bypassed: () => false });
  assert.equal(hooks.landingLock.isOpen(), false);
  assert.equal(hooks.landingLock.lockY(0, 0), 12 + 300 * 5);
  s.layers.a = true; s.gate.frame();
  s.resolve(); await new Promise(r => setImmediate(r));
  for (let i = 0; i < WARM_FRACTIONS.length; i++) s.gate.frame();
  assert.equal(hooks.landingLock.isOpen(), false, 'warming is not done');
  assert.equal(s.events.filter(e => e.name === 'ug:landing-lock').length, 0);
  s.gate.frame(); // reveal
  assert.equal(hooks.landingLock.isOpen(), true);
  const locks = s.events.filter(e => e.name === 'ug:landing-lock');
  assert.equal(locks.length, 1);
  const names = s.events.map(e => e.name);
  assert.ok(names.indexOf('ug:landing-lock') < names.indexOf('ug:opening-reveal'), 'the lock opens before the reveal event');
  s.gate.frame(); s.gate.frame();
  assert.equal(s.events.filter(e => e.name === 'ug:landing-lock').length, 1, 'not again');
});

test('the lock is open on a deep link, the hooks are inert until registered, and buildOrder defaults to null', async () => {
  const { createOpeningHooks } = await import('../src/opening-hooks.js');
  const bare = createOpeningHooks();
  assert.equal(bare.buildOrder, null);
  assert.equal(bare.lateLayers, null);
  assert.equal(bare.gate, null);
  assert.equal(bare.landingLock.isOpen(), false);
  assert.equal(bare.completeRadius({ x: 0, z: 0 }), 0);
  assert.equal(bare.landingLock.lockY(0, 0), null);
  const deep = createOpeningHooks().register({ bypassed: () => true });
  assert.equal(deep.landingLock.isOpen(), true);
  await deep.landingLock.whenOpen();
  const withBuilder = createOpeningHooks().register({ getBuilder: () => ({ completeRadius: (o) => o.x + 1 }) });
  assert.equal(withBuilder.completeRadius({ x: 4, z: 0 }), 5);
});

test('the reveal event carries the work timeline from revealDetail', async () => {
  const s = setup({ revealDetail: () => ({ work: [{ job: 'x', ms: 3 }] }) });
  s.layers.a = true; s.gate.frame();
  s.resolve(); await new Promise(r => setImmediate(r));
  for (let i = 0; i < WARM_FRACTIONS.length + 1; i++) s.gate.frame();
  const reveal = s.events.find(e => e.name === 'ug:opening-reveal');
  assert.deepEqual(reveal.detail.timeline.work, [{ job: 'x', ms: 3 }]);
  assert.ok(reveal.detail.timeline.revealed >= 0, 'the existing timeline keys are kept');
  const plain = setup();
  plain.layers.a = true; plain.gate.frame();
  plain.resolve(); await new Promise(r => setImmediate(r));
  for (let i = 0; i < WARM_FRACTIONS.length + 1; i++) plain.gate.frame();
  assert.equal(plain.events.find(e => e.name === 'ug:opening-reveal').detail.timeline.work, undefined);
});
