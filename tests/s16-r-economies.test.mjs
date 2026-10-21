// s16-r-economies.test.mjs: the economies of lane R (sprint 16Oct26f, D-054) are registered; shadowSnap shipped OFF in 16Oct26f and
// ships ON since sprint 21Oct26w (D-055 item 1, s21:T), so DEFAULT_OFF is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMIES, DEFAULT_OFF, parseEconomies, createEconomies } from '../src/render-economies.js';

test('s16:R the five economies are registered with a description', () => {
  for (const n of ['trainCull', 'shadowFloat', 'shadowSnap', 'edgeLineSize', 'm25Chunks']) assert.ok(typeof ECONOMIES[n] === 'string' && ECONOMIES[n].length > 20, n);
});

test('s21:T shadowSnap ships on (D-055 item 1), as do the other four; parseEconomies itself is unchanged', () => {
  assert.deepEqual([...DEFAULT_OFF], [], 'no economy ships off any more');
  assert.ok(Object.values(parseEconomies('')).every(Boolean), 'the pure parser reports every economy on for an absent econ');
  const e = createEconomies('');
  for (const n of ['trainCull', 'shadowFloat', 'shadowSnap', 'edgeLineSize', 'm25Chunks']) assert.equal(e.on(n), true, n);
  assert.equal(createEconomies('?fast=1').on('shadowSnap'), true);
  assert.equal(createEconomies('?econ=1').on('shadowSnap'), true);
  assert.equal(createEconomies('?econ=-trainCull').on('shadowSnap'), true, 'an exclusion list leaves it on');
  assert.equal(createEconomies('?econ=-trainCull').on('trainCull'), false);
  assert.equal(createEconomies('?econ=0').on('shadowSnap'), false);
  assert.equal(createEconomies('?econ=-shadowSnap').on('shadowSnap'), false);
  assert.equal(createEconomies('?econ=trainCull').on('shadowSnap'), false, 'a named-only list without it leaves it off');
});

test('s16:R shadowSnap stays on when named, and can be switched off and on at runtime', () => {
  const only = createEconomies('?econ=shadowSnap,trainCull');
  assert.equal(only.on('shadowSnap'), true); assert.equal(only.on('trainCull'), true); assert.equal(only.on('shadowFloat'), false);
  assert.equal(createEconomies('?econ=+shadowSnap').on('shadowSnap'), true);
  const e = createEconomies('');
  assert.equal(e.set('shadowSnap', false), false);
  assert.equal(e.on('shadowSnap'), false);
  assert.equal(e.set('shadowSnap', true), true);
  assert.equal(e.on('shadowSnap'), true);
});
