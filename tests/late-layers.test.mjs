// The late-layer registry: states, order, request(id) jumping the queue and starting early, the per-frame budget,
// events and settled() (sprint 21Oct26w, lane L; hook 2 for lane V; acceptance L-21 b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLateLayers } from '../src/late-layers.js';

function clock() { let t = 0; return { now: () => t, advance: (ms) => { t += ms; } }; }
function make(opts = {}) {
  const c = clock();
  const events = [];
  const layers = createLateLayers({ now: c.now, dispatch: (name, detail) => events.push([name, detail]), ...opts });
  return { c, events, layers };
}
/** A layer of n steps, each costing `cost` ms of the fake clock. */
function stepsOf(c, n, cost, result) {
  return function* () { for (let i = 0; i < n; i++) { c.advance(cost); yield; } return result; };
}
const flush = () => new Promise(r => setImmediate(r));

test('a layer waits until the opening has landed, then builds, becomes ready and is attached', async () => {
  let open = false;
  const attached = [];
  const { c, events, layers } = make({ isOpen: () => open });
  layers.define('a', { steps: stepsOf(c, 2, 1, { id: 'a' }), attach: (r) => attached.push(r.id) });
  layers.pump(100);
  assert.equal(layers.state('a'), 'waiting');
  assert.deepEqual(events, []);
  open = true;
  layers.pump(100);
  await flush();
  assert.equal(layers.state('a'), 'attached');
  assert.deepEqual(attached, ['a']);
  assert.deepEqual(events.filter(e => e[0] === 'ug:late-layer').map(e => e[1].state), ['building', 'ready', 'attached']);
  assert.equal(layers.settled(), true);
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 1);
});

test('layers build one at a time in definition order', async () => {
  const { c, layers } = make();
  const log = [];
  layers.define('first', { steps: function* () { log.push('first-start'); c.advance(1); yield; log.push('first-end'); return 1; }, attach: () => {} });
  layers.define('second', { steps: function* () { log.push('second-start'); c.advance(1); yield; log.push('second-end'); return 2; }, attach: () => {} });
  layers.pump(100);
  await flush();
  assert.deepEqual(log, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('a frame spends at most the budget plus one step', async () => {
  const { c, layers } = make({ budgetMs: 6 });
  layers.define('slow', { steps: stepsOf(c, 20, 2, 1), attach: () => {} });
  layers.pump();
  const rec = layers.snapshot()[0];
  assert.ok(rec.steps >= 3 && rec.steps <= 4, `steps in one frame: ${rec.steps}`);
  assert.equal(layers.state('slow'), 'building');
  let frames = 1;
  while (layers.state('slow') === 'building' && frames < 50) { layers.pump(); frames++; }
  await flush();
  assert.equal(layers.state('slow'), 'attached');
  assert.equal(layers.snapshot()[0].maxStepMs, 2);
  assert.equal(layers.snapshot()[0].steps, 21);
});

test('deps gate a layer, and a layer behind an unready one does not wait for it', async () => {
  let ready = false;
  const { c, layers } = make();
  layers.define('needs', { deps: () => ready, steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  layers.define('free', { steps: stepsOf(c, 1, 1, 2), attach: () => {} });
  layers.pump(100);
  await flush();
  assert.equal(layers.state('needs'), 'waiting');
  assert.equal(layers.state('free'), 'attached');
  ready = true;
  layers.pump(100);
  await flush();
  assert.equal(layers.state('needs'), 'attached');
});

test('request(id) jumps the queue and starts before the opening has landed', async () => {
  const { c, layers } = make({ isOpen: () => false });
  layers.define('a', { steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  layers.define('b', { steps: stepsOf(c, 1, 1, 2), attach: () => {} });
  layers.define('motorway', { steps: stepsOf(c, 1, 1, 3), attach: () => {} });
  layers.pump(100);
  assert.deepEqual(layers.snapshot().map(l => l.state), ['waiting', 'waiting', 'waiting']);
  layers.request('motorway');
  layers.pump(100);
  await flush();
  assert.deepEqual(layers.snapshot().map(l => [l.id, l.state]), [['a', 'waiting'], ['b', 'waiting'], ['motorway', 'attached']]);
  assert.ok(layers.snapshot()[2].requestedAt !== null);
});

test('request(id) on a layer that is waiting behind others moves it to the front once the opening has landed', async () => {
  const { c, layers } = make();
  const order = [];
  for (const id of ['a', 'b', 'c']) layers.define(id, { steps: function* () { c.advance(1); order.push(id); yield; return id; }, attach: () => {} });
  layers.request('c');
  layers.pump(100);
  await flush();
  assert.deepEqual(order, ['c', 'a', 'b']);
});

test('a failing layer calls onFail, is marked failed and does not stop the others or the done event', async () => {
  const { c, events, layers } = make();
  let failed = null;
  layers.define('bad', { steps: function* () { c.advance(1); yield; throw new Error('no terrain'); }, attach: () => {}, onFail: (e) => { failed = e.message; } });
  layers.define('good', { steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  const warn = console.warn; console.warn = () => {};
  try { layers.pump(100); await flush(); } finally { console.warn = warn; }
  assert.equal(failed, 'no terrain');
  assert.equal(layers.state('bad'), 'failed');
  assert.equal(layers.state('good'), 'attached');
  assert.equal(layers.settled(), true);
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 1);
});

test('the result is compiled before it is attached, and compile time is recorded', async () => {
  const order = [];
  const { c, layers } = make({ compile: async (objects) => { order.push(`compile:${objects.length}`); } });
  layers.define('x', { steps: stepsOf(c, 1, 1, { isObject3D: true }), attach: () => order.push('attach') });
  layers.pump(100);
  await flush();
  assert.deepEqual(order, ['compile:1', 'attach']);
  assert.ok(layers.snapshot()[0].compileMs !== null);
});

test('whenAttached resolves on attach and the snapshot carries the times', async () => {
  const { c, layers } = make();
  layers.define('x', { name: 'topLevelName', steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  const p = layers.whenAttached('x');
  layers.pump(100);
  assert.equal(await p, 'attached');
  const s = layers.snapshot()[0];
  assert.equal(s.name, 'topLevelName');
  assert.ok(s.startedAt !== null && s.builtAt !== null && s.attachedAt !== null);
});

test('the canonical order puts canals first and flights last whatever order they are defined in', async () => {
  const { c, layers } = make();
  const log = [];
  for (const id of ['flights', 'airports', 'motorway', 'canals', 'extra']) layers.define(id, { steps: function* () { c.advance(1); log.push(id); yield; return id; }, attach: () => {} });
  layers.pump(100);
  await flush();
  assert.deepEqual(log, ['canals', 'motorway', 'airports', 'flights', 'extra']);
  assert.deepEqual(layers.snapshot().map(l => l.id), ['flights', 'airports', 'motorway', 'canals', 'extra'], 'the snapshot keeps definition order');
});

test('expected layers: settled and the done event wait for a layer defined after the others finished; skip releases one that never comes', async () => {
  const { c, events, layers } = make();
  layers.expect(['early', 'late', 'never']);
  layers.define('early', { steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  layers.pump(100);
  await flush();
  assert.equal(layers.state('early'), 'attached');
  assert.equal(layers.settled(), false, 'late and never are still expected');
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 0);
  layers.define('late', { steps: stepsOf(c, 1, 1, 2), attach: () => {} });
  layers.pump(100);
  await flush();
  assert.equal(layers.settled(), false, 'never is still expected');
  layers.skip('never');
  assert.equal(layers.settled(), true);
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 1, 'fired once, when the last expected layer was done');
});

test('request(id) for an expected layer not yet defined is honoured when it is defined', async () => {
  const { c, layers } = make({ isOpen: () => false });
  layers.expect(['motorway']);
  layers.define('other', { steps: stepsOf(c, 1, 1, 1), attach: () => {} });
  layers.request('motorway'); // before it exists
  assert.throws(() => layers.request('nonsense'), /unknown late layer/);
  layers.define('motorway', { steps: stepsOf(c, 1, 1, 2), attach: () => {} });
  layers.pump(100);
  await flush();
  assert.equal(layers.state('motorway'), 'attached');
  assert.equal(layers.state('other'), 'waiting', 'the gate is still shut for the others');
});

test('staggered children are attached hidden and shown one a frame; settled waits for the last', async () => {
  const { c, events, layers } = make();
  const kids = [{ visible: true }, { visible: true }, { visible: false }];
  const group = { isObject3D: true, kids };
  layers.define('big', { steps: stepsOf(c, 1, 1, group), stagger: (g) => g.kids, attach: (g) => { assert.ok(g.kids.every(k => k.visible === false), 'hidden when attached'); } });
  layers.pump(100);
  await flush();
  assert.equal(layers.state('big'), 'attached');
  assert.equal(layers.settled(), false, 'children are still waiting to be shown');
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 0);
  layers.pump(100); assert.deepEqual(kids.map(k => k.visible), [true, false, false]);
  layers.pump(100); assert.deepEqual(kids.map(k => k.visible), [true, true, false]);
  layers.pump(100); assert.deepEqual(kids.map(k => k.visible), [true, true, false], 'a child that was hidden before stays hidden');
  assert.equal(layers.settled(), true);
  assert.equal(events.filter(e => e[0] === 'ug:late-layers-done').length, 1);
});
