import test from 'node:test';
import assert from 'node:assert/strict';
import { createThamesNavigation } from '../src/thames-navigation.js';
const section = (z, x = 0) => [x - 10, 12, z, x + 10, 12, z, x - 10, -20, z, x + 10, -20, z];
test('river predicate covers exact rendered width, bounded by actual carved floor', () => {
  const nav = createThamesNavigation(new Float32Array([...section(0), ...section(100)]),
    ({ x }) => -20 + x * 0.5, 12);
  assert.ok(nav.contains({ x: 9.9, y: 0, z: 50 }), 'full width, not 90% building mask');
  assert.ok(!nav.contains({ x: 10.1, y: 0, z: 50 }));
  assert.ok(!nav.contains({ x: 0, y: 12, z: 50 }));
  assert.ok(!nav.contains({ x: 0, y: -20.1, z: 50 }));
  assert.ok(nav.contains({ x: 0, y: -19.9, z: 50 }));
  const n = nav.outwardNormal({ x: 0, y: -20, z: 50 }, { x: 0, y: -1, z: 0 });
  assert.ok(n.x > 0 && n.y < 0, 'sloping physical bed supplies its outward normal');
  const wall = nav.outwardNormal({ x: 10, y: 0, z: 50 }, { x: 1, y: 0, z: 0 });
  assert.ok(wall.x > 0.99 && wall.y === 0);
});
test('bends follow cross-section triangles, endcaps bound water, missing terrain stays unknown', () => {
  const positions = new Float32Array([...section(0), ...section(100, 30), ...section(200, 60)]);
  const nav = createThamesNavigation(positions, () => -20, 12);
  assert.ok(nav.contains({ x: 15, y: 0, z: 50 }));
  assert.ok(!nav.contains({ x: -5, y: 0, z: 50 }));
  assert.ok(!nav.contains({ x: 0, y: 0, z: -0.1 }));
  const missing = createThamesNavigation(positions, () => null, 12);
  assert.ok(!missing.contains({ x: 15, y: -200, z: 50 }));
});
