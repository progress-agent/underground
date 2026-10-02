// The camera depth range follows display height (sprint 02Oct26f, Lane F).
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewRangeFor, createViewRange, BASE_NEAR, BASE_FAR, RANGE_FROM_H } from '../src/view-range.js';

const camera = (y, far = BASE_FAR, near = BASE_NEAR) => ({
  position: { y }, near, far, projections: 0, updateProjectionMatrix() { this.projections++; },
});

test('at or below 20,000 display units the range is exactly 1 and 50,000', () => {
  for (const h of [-10, 0, 75, 4400, 19999.9, RANGE_FROM_H]) {
    const r = viewRangeFor(h);
    assert.equal(r.near, 1); assert.equal(r.far, 50000); assert.equal(r.scale, 1);
  }
});

test('above 20,000 the far plane is 2.5 h and the 1:50000 ratio is kept', () => {
  for (const h of [20001, 25000, 60045, 90045, 250000]) {
    const r = viewRangeFor(h);
    assert.ok(Math.abs(r.far - 2.5 * h) < 1e-9);
    assert.ok(Math.abs(r.far / r.near - 50000) < 1e-6);
    assert.ok(Math.abs(r.scale - r.far / 50000) < 1e-12);
  }
});

test('the range is continuous at 20,000 (far 50,000 and near 1 from both sides)', () => {
  const below = viewRangeFor(RANGE_FROM_H), above = viewRangeFor(RANGE_FROM_H + 1e-6);
  assert.ok(Math.abs(above.far - below.far) < 1e-2);
  assert.ok(Math.abs(above.near - below.near) < 1e-6);
});

test('a camera below 20,000 is left alone, with no projection update', () => {
  const c = camera(5000 * 0.22 / 0.22);       // canonical y 5000, ratio 1
  const vr = createViewRange(c, { ratio: 1 });
  vr.update(); vr.update();
  assert.equal(c.near, 1); assert.equal(c.far, 50000); assert.equal(c.projections, 0);
});

test('canonical height is converted by the Master ratio', () => {
  const c = camera(75 + 5 * 20000);           // altimeter 20 km
  const vr = createViewRange(c, { ratio: 0.22 });   // Master 1.1: display 22,016
  vr.update();
  assert.ok(c.far > 50000 && Math.abs(c.far - 2.5 * 22016.5) < 1);
  const c3 = camera(75 + 5 * 20000), vr3 = createViewRange(c3, { ratio: 0.6 });   // Master 3: 60,045
  vr3.update();
  assert.ok(Math.abs(c3.far - 2.5 * 60045) < 1);
  assert.ok(Math.abs(c3.far / c3.near - 50000) < 1e-6);
});

test('re-projection happens only when far moves by more than 0.5 percent', () => {
  const c = camera(60000), vr = createViewRange(c, { ratio: 1 });
  vr.update(); assert.equal(c.projections, 1);
  c.position.y = 60100; vr.update(); assert.equal(c.projections, 1);   // +0.17 percent
  c.position.y = 60400; vr.update(); assert.equal(c.projections, 2);   // +0.67 percent
});

test('coming back down restores near 1 and far 50,000 within one update', () => {
  const c = camera(90000), vr = createViewRange(c, { ratio: 1 });
  vr.update(); assert.ok(c.far > 200000);
  c.position.y = 300; vr.update();
  assert.equal(c.near, 1); assert.equal(c.far, 50000);
});

test('restore guard: a near set by another owner (Pedestrian) is not overwritten', () => {
  const c = camera(90000), vr = createViewRange(c, { ratio: 1 });
  vr.update();
  c.near = 0.2;                                // another module took the near plane
  c.position.y = 300; vr.update();
  assert.equal(c.near, 0.2); assert.equal(c.far, 50000);
});
