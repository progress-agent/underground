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

function setup() {
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
    dispatch: (name, detail) => events.push({ name, detail }), items: [{ id: 'a', check: () => layers.a }] });
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
