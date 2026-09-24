// space-key.js: which Space events a Space-binding mode takes from the page
// (sprint 24Sep26h, D-038, lane H).
import test from 'node:test';
import assert from 'node:assert/strict';
import { modeClaimsSpace, createSpaceGuard, KEY_OWNING_SELECTOR } from '../src/modes/space-key.js';

function el({ tag = 'button', inPanel = false, editable = false } = {}) {
  return {
    isContentEditable: editable,
    matches: (sel) => sel.split(',').map(s => s.trim()).includes(tag),
    closest: (sel) => (sel === KEY_OWNING_SELECTOR && inPanel ? {} : null),
  };
}
const ev = (over = {}) => {
  const e = { key: ' ', metaKey: false, ctrlKey: false, altKey: false, target: el(), defaultPrevented: false, ...over };
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
};

test('a plain Space on a focused button or summary belongs to the mode', () => {
  assert.equal(modeClaimsSpace(ev()), true);
  assert.equal(modeClaimsSpace(ev({ target: el({ tag: 'summary' }) })), true);
  assert.equal(modeClaimsSpace(ev({ target: null })), true);
});

test('form fields, the Physics panel, modifiers and other keys are left alone', () => {
  for (const tag of ['input', 'select', 'textarea']) assert.equal(modeClaimsSpace(ev({ target: el({ tag }) })), false, tag);
  assert.equal(modeClaimsSpace(ev({ target: el({ tag: 'div', editable: true }) })), false);
  assert.equal(modeClaimsSpace(ev({ target: el({ inPanel: true }) })), false);
  for (const m of ['metaKey', 'ctrlKey', 'altKey']) assert.equal(modeClaimsSpace(ev({ [m]: true })), false, m);
  for (const key of ['Enter', 'e', 'Spacebar', undefined]) assert.equal(modeClaimsSpace(ev({ key })), false, String(key));
});

test('the guard listens in the capture phase only while on, for keydown and keyup', () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn, capture) => { assert.equal(capture, true); listeners.set(type, fn); },
    removeEventListener: (type, fn, capture) => { assert.equal(capture, true); assert.equal(listeners.get(type), fn); listeners.delete(type); },
  };
  const guard = createSpaceGuard(target);
  assert.equal(guard.active, false);
  guard.set(true); guard.set(true);
  assert.deepEqual([...listeners.keys()].sort(), ['keydown', 'keyup']);
  const down = ev(); listeners.get('keydown')(down); assert.equal(down.defaultPrevented, true);
  const up = ev(); listeners.get('keyup')(up); assert.equal(up.defaultPrevented, true);
  const typed = ev({ target: el({ tag: 'input' }) }); listeners.get('keydown')(typed); assert.equal(typed.defaultPrevented, false);
  guard.set(false);
  assert.equal(listeners.size, 0);
  assert.equal(guard.active, false);
});
