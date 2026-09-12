import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createVerticalScaleController } from '../src/vertical-scale.js';

const closeVector = (a, b, tolerance = 1e-8) => expect(a.distanceTo(b)).toBeLessThan(tolerance);

test('master height preserves the canonical forward ray and flight at every pitch', () => {
  for (const pitch of [-60, -25, 0, 25, 60]) for (const value of [1, 5, 10]) {
    const camera = new THREE.PerspectiveCamera(60, 1.5, .1, 100000);
    camera.position.set(230, 420, -900);
    camera.rotation.set(THREE.MathUtils.degToRad(pitch), .7, .1, 'YXZ');
    camera.updateMatrixWorld(true);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const target = camera.position.clone().addScaledVector(forward, 500);
    const originalPosition = camera.position.clone(), originalQuaternion = camera.quaternion.clone();
    const controller = createVerticalScaleController({ camera, value });
    const screen = target.clone().project(camera);
    expect(Math.abs(screen.x)).toBeLessThan(1e-10);
    expect(Math.abs(screen.y)).toBeLessThan(1e-10);
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(), camera);
    closeVector(ray.ray.direction, forward);
    closeVector(camera.getWorldDirection(new THREE.Vector3()), forward);
    closeVector(camera.position, originalPosition);
    expect(camera.quaternion.angleTo(originalQuaternion)).toBeLessThan(1e-7);
    camera.position.addScaledVector(forward, 40); camera.updateMatrixWorld(true);
    const afterFlight = target.clone().project(camera);
    expect(Math.hypot(afterFlight.x, afterFlight.y)).toBeLessThan(1e-10);
    controller.dispose();
  }
});

test('master height projects the same world as explicit datum scaling, without mutating it', () => {
  const camera = new THREE.PerspectiveCamera(55, 1.4, 1, 50000);
  camera.position.set(400, 600, 700); camera.lookAt(50, -100, -1200); camera.updateMatrixWorld(true);
  const canonicalForward = camera.getWorldDirection(new THREE.Vector3());
  const canonicalUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const controller = createVerticalScaleController({ camera });
  const points = [new THREE.Vector3(80, -300, -600), new THREE.Vector3(200, 12, -800), new THREE.Vector3(100, 350, -1000)];
  for (const value of [1, 3, 5, 10]) {
    controller.setValue(value); const ratio = value / 5;
    const reference = new THREE.PerspectiveCamera(55, 1.4, 1, 50000);
    reference.position.copy(camera.position); reference.position.y *= ratio;
    reference.up.copy(canonicalUp); reference.up.y *= ratio;
    const aim = canonicalForward.clone(); aim.y *= ratio;
    reference.lookAt(reference.position.clone().add(aim)); reference.updateMatrixWorld(true);
    for (const point of points) {
      const scaled = point.clone(); scaled.y *= ratio;
      closeVector(point.clone().project(camera), scaled.project(reference));
      closeVector(point.clone().project(camera).unproject(camera), point, 1e-7);
    }
  }
  controller.dispose();
});

test('ray hits remain canonical for perspective and orthographic cameras and independent structure scales', () => {
  for (const camera of [new THREE.PerspectiveCamera(60, 1, .1, 10000), new THREE.OrthographicCamera(-100, 100, 100, -100, .1, 10000)]) {
    camera.position.set(0, 120, 400); camera.lookAt(0, 40, 0);
    const controller = createVerticalScaleController({ camera });
    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20)); body.position.y = 40;
    for (const structure of [.2, 1]) for (const master of [1, 5, 10]) {
      body.scale.y = structure; body.updateMatrixWorld(true); controller.setValue(master);
      const ndc = body.position.clone().project(camera);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(body)[0]; expect(hit).toBeTruthy();
      expect(hit.point.z).toBeCloseTo(10, 7);
      expect(body.position.y).toBe(40); expect(body.scale.y).toBe(structure);
      expect(Math.abs(hit.point.y - 40)).toBeLessThanOrEqual(10 * structure + 1e-6);
    }
    body.geometry.dispose(); body.material.dispose(); controller.dispose();
  }
});

test('renderer-style repeated matrix updates do not compound master height, including manual matrices', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(20, 70, 300); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true); camera.matrixAutoUpdate = false;
  const controller = createVerticalScaleController({ camera, value: 1 });
  const expected = camera.matrixWorldInverse.clone();
  for (let i = 0; i < 20; i++) { camera.updateMatrixWorld(); camera.updateWorldMatrix(true, false); }
  expect(camera.matrixWorldInverse.elements).toEqual(expected.elements);
  const identity = camera.matrixWorld.clone().multiply(camera.matrixWorldInverse);
  identity.elements.forEach((n, i) => expect(n).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9));
  controller.dispose();
});

test('default and restoration are exact and input bounds never produce singular transforms', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 3, 4); camera.updateMatrixWorld(true);
  const original = camera.matrixWorldInverse.clone(), originalUpdater = camera.updateMatrixWorld;
  const controller = createVerticalScaleController({ camera });
  expect(camera.matrixWorldInverse.elements).toEqual(original.elements);
  expect(controller.setValue(-10)).toBe(1); expect(controller.setValue(100)).toBe(10);
  expect(() => controller.setValue(NaN)).toThrow();
  controller.setValue(5); expect(camera.matrixWorldInverse.elements).toEqual(original.elements);
  controller.dispose(); expect(camera.updateMatrixWorld).toBe(originalUpdater);
  expect(camera.matrixWorldInverse.elements).toEqual(original.elements);
});
