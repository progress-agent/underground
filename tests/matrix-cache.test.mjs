import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installMatrixCache } from '../src/matrix-cache.js';

test('cached matrices preserve animated hierarchies, reparenting, explicit edits and forced updates', () => {
  const make = () => {
    const scene = new THREE.Scene(), a = new THREE.Group(), b = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    scene.add(a, b); a.add(mesh);
    a.position.set(12, -3, 40); b.rotation.y = 0.7;
    mesh.position.set(-8, 7, 9); mesh.scale.set(2, 0.3, -1);
    return { scene, a, b, mesh };
  };
  const plain = make(), cached = make(); installMatrixCache(cached.scene);
  const compare = (force = false) => {
    plain.scene.updateMatrixWorld(force); cached.scene.updateMatrixWorld(force);
    for (const key of ['scene', 'a', 'b', 'mesh']) {
      assert.deepEqual(cached[key].matrix.elements, plain[key].matrix.elements, key + ' local');
      assert.deepEqual(cached[key].matrixWorld.elements, plain[key].matrixWorld.elements, key + ' world');
    }
  };
  compare(); compare();
  for (let frame = 0; frame < 200; frame++) {
    for (const o of [plain, cached]) {
      o.a.rotation.x = frame * 0.01;
      o.mesh.position.y = Math.sin(frame * 0.04);
      if (frame === 40) o.b.add(o.mesh);
      if (frame === 70) o.mesh.matrix.elements[12] = 123456;
      if (frame === 90) o.mesh.matrixWorldNeedsUpdate = true;
      if (frame === 110) { o.mesh.matrixAutoUpdate = false; o.mesh.matrix.makeTranslation(1, 2, 3); o.mesh.matrixWorldNeedsUpdate = true; }
      if (frame === 120) o.mesh.matrixAutoUpdate = true;
      if (frame === 130) o.a.add(new THREE.Group());
    }
    compare(frame % 7 === 0);
  }
  // Native updateWorldMatrix used by raycasts and lookAt remains correct too.
  for (const o of [plain, cached]) { o.b.position.z = 87; o.mesh.updateWorldMatrix(true, true); }
  assert.deepEqual(cached.mesh.matrixWorld.elements, plain.mesh.matrixWorld.elements);
  // An unchanged second scene update no longer composes static transforms.
  cached.scene.updateMatrixWorld();
  assert.equal(cached.b.matrixWorldNeedsUpdate, false);
});

test('matrix cache leaves custom transforms and cameras with their owners', () => {
  const scene = new THREE.Scene(), custom = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  custom.updateMatrix = function () { this.matrix.makeTranslation(15, 26, 37); this.matrixWorldNeedsUpdate = true; };
  const own = custom.updateMatrix, cameraUpdate = camera.updateMatrix;
  scene.add(custom, camera); installMatrixCache(scene); scene.updateMatrixWorld();
  assert.equal(custom.updateMatrix, own); assert.equal(camera.updateMatrix, cameraUpdate);
  assert.equal(custom.matrixWorld.elements[13], 26);
});

test('stationary warmed objects update after reparenting, removal and clearing', () => {
  const scene = new THREE.Scene(), a = new THREE.Group(), b = new THREE.Group(), child = new THREE.Group();
  a.position.x = 10; b.position.x = 20; scene.add(a, b); a.add(child);
  installMatrixCache(scene); scene.updateMatrixWorld(); scene.updateMatrixWorld();
  assert.equal(child.matrixWorld.elements[12], 10);
  let atAdded;
  child.addEventListener('added',()=>{child.updateMatrixWorld();atAdded=child.matrixWorld.elements[12];});
  b.add(child); assert.equal(atAdded,20); scene.updateMatrixWorld(); assert.equal(child.matrixWorld.elements[12], 20);
  b.remove(child); child.updateMatrixWorld(); assert.equal(child.matrixWorld.elements[12], 0);
  a.add(child); scene.updateMatrixWorld(); assert.equal(child.matrixWorld.elements[12], 10);
  a.clear(); child.updateMatrixWorld(); assert.equal(child.matrixWorld.elements[12], 0);
});
