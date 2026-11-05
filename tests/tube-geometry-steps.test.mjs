import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTubeGeometrySteps } from '../src/tube-geometry-steps.js';

test('sliced tubes equal native Three buffers and frame vectors, including closed and 32-bit index cases', () => {
  for (const closed of [false, true]) for (const segments of [3, 64, 6000]) {
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-800, -60, 300), new THREE.Vector3(0, -120, 700), new THREE.Vector3(1400, 80, -900), new THREE.Vector3(2200, -40, -250)], closed);
    const reference = new THREE.TubeGeometry(path, segments, 1.78, 10, closed);
    const it = createTubeGeometrySteps(path, segments, 1.78, 10, closed, 3);
    let step, yields = 0;
    do { step = it.next(); if (!step.done) yields++; } while (!step.done);
    const actual = step.value;
    assert.ok(actual instanceof THREE.TubeGeometry);
    for (const name of ['position', 'normal', 'uv']) {
      assert.deepEqual(actual.attributes[name].array, reference.attributes[name].array, name + ' ' + segments);
    }
    assert.deepEqual(actual.index.array, reference.index.array);
    for (const name of ['tangents', 'normals', 'binormals']) assert.deepEqual(actual[name], reference[name], name);
    assert.deepEqual(actual.parameters, reference.parameters);
    assert.deepEqual(actual.toJSON().path, reference.toJSON().path);
    assert.deepEqual(actual.clone().attributes.position.array, reference.attributes.position.array);
    assert.ok(yields >= 4, 'construction yields within each tube');
  }
});

test('sliced tubes retain Three’s 32-bit index transition at the reserved restart index', () => {
  const path = new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(100, 2, 50));
  for (const segments of [8190, 8191]) {
    const native = new THREE.TubeGeometry(path, segments, 1, 7, false);
    const steps = createTubeGeometrySteps(path, segments, 1, 7, false);
    let step; do { step = steps.next(); } while (!step.done);
    assert.equal(step.value.index.array.constructor, native.index.array.constructor);
    assert.deepEqual(step.value.index.array, native.index.array);
  }
});
