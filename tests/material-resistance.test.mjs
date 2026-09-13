import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialResistance } from '../src/material-resistance.js';
const advance = (p, d) => { p.x += d.x; p.y += d.y; p.z += d.z; };
const simpleClassify = p => p.y >= 0 ? 'AIR' : p.y > -100 ? 'CLAY' : 'CHALK';

for (const [title, y, direction] of [['air into clay', 1, -1], ['clay into air', -1, 1],
  ['clay into chalk', -99, -1], ['chalk into clay', -101, 1]]) {
  test(`${title} slows once for 700ms then resumes cruise`, () => {
    const controller = createMaterialResistance({ classify: simpleClassify });
    const p = { x: 0, y, z: 0 }, d = { x: 0, y: direction * 5, z: 0 };
    advance(p, controller.apply(p, d, 0.01));
    assert.equal(controller.state.kind, 'slow');
    for (let i = 0; i < 68; i++) {
      const delta = controller.apply(p, d, 0.01);
      assert.ok(Math.abs(delta.y) < 1);
      advance(p, delta);
    }
    for (let i = 0; i < 3; i++) advance(p, controller.apply(p, d, 0.01));
    assert.equal(controller.state, null);
    assert.equal(controller.apply(p, d, 0.01).y, d.y);
  });
}

const riverClassify = p => p.y >= 10 ? 'AIR' : p.y < 0 || p.x >= 10 || p.x < -10 ? 'CLAY' : 'WATER';
const riverNormal = p => Math.abs(p.y) < 0.05 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
test('oblique water wall holds outward motion, permits slide and crosses at 700ms', () => {
  const controller = createMaterialResistance({ classify: riverClassify, riverNormal });
  const p = { x: 9.999, y: 5, z: 0 }, d = { x: 2, y: 0, z: 3 };
  for (let i = 0; i < 69; i++) advance(p, controller.apply(p, d, 0.01));
  assert.ok(p.x < 10 && p.x > 9.99);
  assert.ok(p.z > 200, 'tangential distance stays near the unimpeded 207');
  advance(p, controller.apply(p, d, 0.01));
  assert.ok(p.x < 10, 'the first contact fraction is subtracted from hold duration');
  advance(p, controller.apply(p, d, 0.01));
  assert.ok(p.x > 10);
});
test('water bed uses same hold and does not confuse floor with surface', () => {
  const controller = createMaterialResistance({ classify: riverClassify, riverNormal });
  const p = { x: 0, y: 0.001, z: 0 }, d = { x: 0, y: -2, z: 0.1 };
  for (let i = 0; i < 69; i++) advance(p, controller.apply(p, d, 0.01));
  assert.ok(p.y >= 0);
  for (let i = 0; i < 2; i++) advance(p, controller.apply(p, d, 0.01));
  assert.ok(p.y < 0);
});
test('release and retreat cancel accumulated water pressure with no delayed displacement', () => {
  for (const mode of ['release', 'retreat']) {
    const controller = createMaterialResistance({ classify: riverClassify, riverNormal });
    const p = { x: 9.999, y: 5, z: 0 }, d = { x: 2, y: 0, z: 0 };
    for (let i = 0; i < 50; i++) advance(p, controller.apply(p, d, 0.01));
    if (mode === 'release') controller.apply(p, { x: 0, y: 0, z: 0 }, 0.01);
    else advance(p, controller.apply(p, { x: -0.01, y: 0, z: 0 }, 0.01));
    assert.equal(controller.state, null);
    for (let i = 0; i < 30; i++) advance(p, controller.apply(p, d, 0.01));
    assert.ok(p.x < 10, 'prior pressure was not banked');
  }
});
test('air/water in either direction and clay/water are free', () => {
  const controller = createMaterialResistance({ classify: riverClassify, riverNormal });
  for (const [p, d] of [[{ x: 0, y: 11, z: 0 }, { x: 0, y: -2, z: 0 }],
    [{ x: 0, y: 9, z: 0 }, { x: 0, y: 2, z: 0 }],
    [{ x: 11, y: 5, z: 0 }, { x: -2, y: 0, z: 0 }]]) {
    assert.deepEqual(controller.apply(p, d, 0.01), d);
    assert.equal(controller.state, null);
  }
});
test('sprint sweep cannot skip a thin water body or a blocking transition after free entry', () => {
  const controller = createMaterialResistance({ classify: riverClassify, riverNormal });
  const p = { x: 0, y: 20, z: 0 }, d = { x: 0, y: -60, z: 0 };
  const result = controller.apply(p, d, 0.05);
  assert.ok(p.y + result.y >= 0, 'free air entry stops at river bed');
  assert.equal(controller.state.kind, 'hold');
});

