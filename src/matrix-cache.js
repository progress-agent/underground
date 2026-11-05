// Three recomposes every local matrix on every render, forcing the entire
// descendant world-matrix tree even when an authored transform has not moved.
// Keep native world propagation, custom matrices and explicit dirty flags;
// avoid only the identical local composition. Moving objects still use Three.
import * as THREE from 'three';

const native = THREE.Object3D.prototype.updateMatrix;
const nativeAdd = THREE.Object3D.prototype.add;
const nativeRemove = THREE.Object3D.prototype.remove;
const nativeClear = THREE.Object3D.prototype.clear;
const inputs = new WeakMap();

function cachedUpdateMatrix() {
  const p = this.position, q = this.quaternion, s = this.scale, e = this.matrix.elements;
  let c = inputs.get(this);
  if (c && c[0] === p.x && c[1] === p.y && c[2] === p.z
    && c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w
    && c[7] === s.x && c[8] === s.y && c[9] === s.z) {
    // Also detect an explicit matrix edit: matrixAutoUpdate=true means the
    // authored transform, rather than that edit, must win as in native Three.
    let same = true;
    for (let i = 0; i < 16; i++) if (c[10 + i] !== e[i]) { same = false; break; }
    if (same) return;
  }
  native.call(this);
  if (!c) { c = new Float64Array(26); inputs.set(this, c); }
  c[0] = p.x; c[1] = p.y; c[2] = p.z;
  c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w;
  c[7] = s.x; c[8] = s.y; c[9] = s.z;
  for (let i = 0; i < 16; i++) c[10 + i] = e[i];
}

export function cacheLocalMatrices(root) {
  root.traverse(object => {
    // Cameras have their own canonical/display transform contract. Custom
    // updateMatrix implementations (trains, true proportions) remain owners.
    if (!object.isCamera && object.updateMatrix === native) object.updateMatrix = cachedUpdateMatrix;
    if (object.add === nativeAdd) object.add = cachedAdd;
    if (object.remove === nativeRemove) object.remove = cachedRemove;
    if (object.clear === nativeClear) object.clear = cachedClear;
  });
}

function cachedAdd(...children) {
  for (const child of children) if (child?.isObject3D && child !== this) {
    cacheLocalMatrices(child);
    child.matrixWorldNeedsUpdate = true; // also before native 'added' listeners run
  }
  const result = nativeAdd.apply(this, children);
  for (const child of children) if (child?.parent === this) child.matrixWorldNeedsUpdate = true;
  return result;
}

function cachedRemove(...children) {
  for (const child of children) if (child?.parent === this) child.matrixWorldNeedsUpdate = true;
  return nativeRemove.apply(this, children);
}

function cachedClear() {
  for (const child of this.children) child.matrixWorldNeedsUpdate = true;
  return nativeClear.call(this);
}

export function installMatrixCache(scene) {
  // Observe additions once, rather than walking the whole scene each frame.
  // Direct temporary child arrays used by preparation keep native matrices.
  cacheLocalMatrices(scene);
}
