// player-view-rules.test.mjs: which view the walker has (sprint 14Oct26w, lane P, D-053 item 3), pure cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewRules, allowsThirdIn, THIRD_PERSON_PHASES } from '../src/player/view-rules.js';

const eff = (r, loaded, phase = 'body') => r.update({ loaded, allowsThird: allowsThirdIn(phase) }).effective;

test('a. opens in first person before the figure and changes to third person once when it lands', () => {
  const r = createViewRules();
  r.reset(false);
  assert.equal(eff(r, false), 'first');
  const seq = [];
  for (let i = 0; i < 6; i++) seq.push(eff(r, i >= 3));
  assert.deepEqual(seq, ['first', 'first', 'first', 'third', 'third', 'third']);
  let changes = 0, prev = 'first';
  for (const e of seq) { if (e !== prev) changes++; prev = e; }
  assert.equal(changes, 1, 'exactly one false-to-true change');
});

test('a. opens in third person when the figure is already there', () => {
  const r = createViewRules();
  r.reset(true);
  assert.equal(eff(r, true), 'third');
});

test('b. pressing V twice before the figure lands keeps first person afterwards', () => {
  const r = createViewRules();
  r.reset(false);
  r.press(); r.press();
  assert.equal(r.chosen, 'first');
  for (let i = 0; i < 20; i++) assert.equal(eff(r, true), 'first');
});

test('b. pressing V once before the figure lands means third person when it lands, and no second switch', () => {
  const r = createViewRules();
  r.reset(false);
  r.press();
  assert.equal(eff(r, false), 'first');
  assert.equal(eff(r, true), 'third');
  const auto = r.update({ loaded: true, allowsThird: true });
  assert.equal(auto.auto, false);
});

test('the auto switch reports itself on exactly one frame', () => {
  const r = createViewRules();
  r.reset(false);
  const a = r.update({ loaded: true, allowsThird: true });
  const b = r.update({ loaded: true, allowsThird: true });
  assert.deepEqual([a.effective, a.auto, b.effective, b.auto], ['third', true, 'third', false]);
});

test('c. shafts, tunnels, transfers and steps are first person whatever V says; the street returns the choice', () => {
  assert.deepEqual([...THIRD_PERSON_PHASES], ['enter', 'body']);
  const r = createViewRules();
  r.reset(true);
  for (const phase of ['shaft', 'tunnel', 'transfer', 'step', 'off']) {
    assert.equal(eff(r, true, phase), 'first', phase);
    r.press(); r.press();       // V does not change that
    assert.equal(eff(r, true, phase), 'first', phase);
  }
  assert.equal(eff(r, true, 'body'), 'third', 'back at the street: the choice');
});

test('c. a choice of first person made before descending survives the climb up', () => {
  const r = createViewRules();
  r.reset(true);
  r.press();                              // first person
  assert.equal(eff(r, true, 'body'), 'first');
  assert.equal(eff(r, true, 'shaft'), 'first');
  assert.equal(eff(r, true, 'tunnel'), 'first');
  assert.equal(eff(r, true, 'body'), 'first', 'still first person after coming up');
});

test('V toggles the stored choice in every phase', () => {
  const r = createViewRules();
  r.reset(true);
  assert.equal(r.chosen, 'third');
  r.press();                              // while in a tunnel the choice still flips
  assert.equal(r.chosen, 'first');
  r.press();
  assert.equal(r.chosen, 'third');
});

test('d. the choice can be set directly (the test surface) and counts as the player\'s own press', () => {
  const r = createViewRules();
  r.reset(false);
  r.set('first');
  assert.equal(eff(r, true), 'first');
  assert.throws(() => r.set('side'), RangeError);
});

test('the figure not being loaded forces first person even when third is chosen', () => {
  const r = createViewRules();
  r.reset(true);
  assert.equal(eff(r, false), 'first');
});
