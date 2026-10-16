// s16-r-economies.test.mjs: the four economies of lane R (sprint 16Oct26f, D-054) are registered, and shadowSnap ships off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ECONOMIES, DEFAULT_OFF, parseEconomies, createEconomies } from '../src/render-economies.js';

test('s16:R the five economies are registered with a description', () => {
  for (const n of ['trainCull', 'shadowFloat', 'shadowSnap', 'edgeLineSize', 'm25Chunks']) assert.ok(typeof ECONOMIES[n] === 'string' && ECONOMIES[n].length > 20, n);
});

test('s16:R shadowSnap ships off, the other four on; parseEconomies itself is unchanged', () => {
  assert.deepEqual([...DEFAULT_OFF], ['shadowSnap']);
  assert.ok(Object.values(parseEconomies('')).every(Boolean), 'the pure parser still reports every economy on for an absent econ');
  const e = createEconomies('');
  assert.equal(e.on('shadowSnap'), false);
  for (const n of ['trainCull', 'shadowFloat', 'edgeLineSize', 'm25Chunks']) assert.equal(e.on(n), true, n);
  assert.equal(createEconomies('?fast=1').on('shadowSnap'), false);
  assert.equal(createEconomies('?econ=1').on('shadowSnap'), false);
  assert.equal(createEconomies('?econ=-trainCull').on('shadowSnap'), false, 'an exclusion list leaves it off');
  assert.equal(createEconomies('?econ=-trainCull').on('trainCull'), false);
  assert.equal(createEconomies('?econ=0').on('shadowSnap'), false);
});

test('s16:R shadowSnap can be switched on by naming it, or at runtime', () => {
  const only = createEconomies('?econ=shadowSnap,trainCull');
  assert.equal(only.on('shadowSnap'), true); assert.equal(only.on('trainCull'), true); assert.equal(only.on('shadowFloat'), false);
  assert.equal(createEconomies('?econ=+shadowSnap').on('shadowSnap'), true);
  const e = createEconomies('');
  assert.equal(e.set('shadowSnap', true), true);
  assert.equal(e.on('shadowSnap'), true);
});
