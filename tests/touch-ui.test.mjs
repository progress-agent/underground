// The phone layout's input mapping (D-058, 01Nov26u): the stick's keys, touch detection and touch look deltas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickKeys, isTouchDevice, STICK, BUTTONS } from '../src/touch-ui.js';
import { createLookInput } from '../src/modes/pointer-lock.js';

const keys = (x, y) => [...stickKeys(x, y)].sort().join('');

test('the dead zone holds nothing', () => {
  assert.equal(keys(0, 0), '');
  assert.equal(keys(STICK.dead * 0.9, 0), '');
});

test('the stick holds the four directions and the diagonals', () => {
  assert.equal(keys(0, -0.6), 'w');
  assert.equal(keys(0, 0.6), 's');
  assert.equal(keys(-0.6, 0), 'a');
  assert.equal(keys(0.6, 0), 'd');
  assert.equal(keys(0.45, -0.45), 'dw');
  assert.equal(keys(-0.45, 0.45), 'as');
});

test('a mostly-forward push stays forward only', () => {
  assert.equal(keys(0.15, -0.7), 'w');
});

test('full deflection adds Shift', () => {
  assert.equal(keys(0, -1), 'shiftw');
  assert.equal(keys(0, -0.8), 'w');
});

test('touch detection honours ?touch= and the coarse-pointer query', () => {
  const mm = (matches) => () => ({ matches });
  assert.equal(isTouchDevice({ search: '?touch=1', matchMedia: mm(false) }), true);
  assert.equal(isTouchDevice({ search: '?touch=0', matchMedia: mm(true) }), false);
  assert.equal(isTouchDevice({ search: '', matchMedia: mm(true) }), true);
  assert.equal(isTouchDevice({ search: '', matchMedia: mm(false) }), false);
  assert.equal(isTouchDevice({ search: '', matchMedia: undefined }), false);
});

test('every body has a big thumb button bound to Space, and Deity has none', () => {
  for (const id of ['pedestrian', 'drone', 'balloon']) {
    const big = BUTTONS[id].filter(b => b.big);
    assert.equal(big.length, 1, id);
    assert.equal(big[0].key, 'space', id);
  }
  assert.equal(BUTTONS.deity, undefined);
});

function fakeTarget() {
  const l = new Map();
  return {
    addEventListener: (t, fn) => { if (!l.has(t)) l.set(t, []); l.get(t).push(fn); },
    removeEventListener: () => {},
    fire: (t, e) => { for (const fn of l.get(t) ?? []) fn(e); },
    pointerLockElement: null,
  };
}

test('a touch drag reports clientX/Y deltas when movementX is 0 (iOS)', () => {
  const element = fakeTarget(), document = fakeTarget();
  const seen = [];
  const look = createLookInput({ element, document, onLook: (dx, dy) => seen.push([dx, dy]) });
  look.setMode('drag');
  element.fire('pointerdown', { button: 0, pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 100 });
  document.fire('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 110, clientY: 95, movementX: 0, movementY: 0, buttons: 1 });
  document.fire('pointermove', { pointerId: 7, pointerType: 'touch', clientX: 130, clientY: 95, movementX: 0, movementY: 0, buttons: 1 });
  assert.deepEqual(seen, [[10, -5], [20, 0]]);
});

test('a second finger neither takes over nor ends the look drag', () => {
  const element = fakeTarget(), document = fakeTarget();
  const seen = [];
  const look = createLookInput({ element, document, onLook: (dx, dy) => seen.push([dx, dy]) });
  look.setMode('drag');
  element.fire('pointerdown', { button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  element.fire('pointerdown', { button: 0, pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 });
  document.fire('pointerup', { pointerId: 2, pointerType: 'touch' });
  document.fire('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 4, clientY: 0, buttons: 1 });
  assert.deepEqual(seen, [[4, 0]]);
});

test('a tap never requests pointer lock', () => {
  const element = fakeTarget(), document = fakeTarget();
  let asked = 0;
  element.requestPointerLock = () => { asked++; };
  const look = createLookInput({ element, document });
  look.setMode('lock');
  element.fire('click', { button: 0, pointerType: 'touch' });
  assert.equal(asked, 0);
  element.fire('click', { button: 0, pointerType: 'mouse' });
  assert.equal(asked, 1);
});
