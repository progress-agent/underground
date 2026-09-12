import * as THREE from 'three';

export const MASTER_HEIGHT_BASE = 5;

/**
 * One display transform for canonical VE5 geometry, including objects added later.
 * Coordinates, terrain/depth queries, camera pose and structure height stay in
 * canonical space. Paired camera matrices make projection AND raycasting agree.
 * Display rotation follows the scaled viewing direction, keeping the canonical
 * OrbitControls target and keyboard forward direction in the centre of the view.
 */
export function createVerticalScaleController({ camera, value = MASTER_HEIGHT_BASE,
  base = MASTER_HEIGHT_BASE, min = 1, max = 10 } = {}) {
  if (!camera?.isCamera) throw new TypeError('Master height requires a Three.js camera');
  if (camera.userData.masterHeightController) throw new Error('Camera already has a master-height controller');
  if (![base, min, max].every(Number.isFinite) || base <= 0 || min <= 0 || max < min) {
    throw new RangeError('Invalid master-height range');
  }
  const updateMatrixWorld = camera.updateMatrixWorld;
  const updateWorldMatrix = camera.updateWorldMatrix;
  updateWorldMatrix.call(camera, true, false);
  const canonicalWorld = camera.matrixWorld.clone();
  const canonicalView = camera.matrixWorldInverse.clone();
  const position = new THREE.Vector3(), forward = new THREE.Vector3(), up = new THREE.Vector3();
  const zero = new THREE.Vector3(), displayRotation = new THREE.Matrix4();
  const scale = new THREE.Matrix4(), translation = new THREE.Matrix4();
  let current = base, disposed = false;

  function restoreCanonicalMatrices() {
    camera.matrixWorld.copy(canonicalWorld);
    camera.matrixWorldInverse.copy(canonicalView);
  }
  function apply() {
    canonicalWorld.copy(camera.matrixWorld);
    canonicalView.copy(camera.matrixWorldInverse);
    const ratio = current / base;
    if (ratio === 1) return;
    const e = canonicalWorld.elements;
    position.setFromMatrixPosition(canonicalWorld);
    forward.set(-e[8], -e[9] * ratio, -e[10]).normalize();
    up.set(e[4], e[5] * ratio, e[6]).normalize();
    displayRotation.lookAt(zero, forward, up);
    // R_display^-1 S T(-p): exactly equivalent to scaling world and camera
    // position about Ordnance Datum, with the scaled target kept in view.
    camera.matrixWorldInverse.copy(displayRotation).transpose()
      .multiply(scale.makeScale(1, ratio, 1))
      .multiply(translation.makeTranslation(-position.x, -position.y, -position.z));
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
  }
  camera.updateMatrixWorld = function (force) {
    restoreCanonicalMatrices();
    updateMatrixWorld.call(this, force);
    apply();
  };
  camera.updateWorldMatrix = function (updateParents, updateChildren) {
    restoreCanonicalMatrices();
    updateWorldMatrix.call(this, updateParents, updateChildren);
    apply();
  };
  const controller = {
    get value() { return current; },
    get ratio() { return current / base; },
    base, min, max,
    setValue(next) {
      if (disposed) throw new Error('Master-height controller is disposed');
      if (!Number.isFinite(next)) throw new TypeError('Master height must be finite');
      current = THREE.MathUtils.clamp(next, min, max);
      camera.updateWorldMatrix(true, false);
      return current;
    },
    // Explicit conversions for external display-space consumers. Existing
    // physical samplers and ray hits already use canonical coordinates.
    toDisplayY(y) { return y * current / base; },
    toCanonicalY(y) { return y * base / current; },
    dispose() {
      if (disposed) return;
      restoreCanonicalMatrices();
      camera.updateMatrixWorld = updateMatrixWorld;
      camera.updateWorldMatrix = updateWorldMatrix;
      delete camera.userData.masterHeightController;
      disposed = true;
      camera.updateWorldMatrix(true, false);
    },
  };
  camera.userData.masterHeightController = controller;
  controller.setValue(value);
  return controller;
}
