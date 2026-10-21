// sliced-geometry.js — three r161's computeVertexNormals and computeBoundingSphere, a slice at a time (sprint 21Oct26w,
// lane L, approach E). The late layers are built a few milliseconds a frame after landing; on a merged road or airport
// mesh these two calls alone are 20 to 50 ms. The loops below are the library's own, operation for operation and in the
// same order, so the results are bit-identical (tests/sliced-geometry.test.mjs compares every float against the library's
// own functions); they `yield` every `perStep` elements. Position-only geometry without morph targets, which is what the
// motorway and the airports build.

import * as THREE from 'three';

const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _pC = new THREE.Vector3();
const _nA = new THREE.Vector3(), _nB = new THREE.Vector3(), _nC = new THREE.Vector3();
const _cb = new THREE.Vector3(), _ab = new THREE.Vector3();
const _vector = new THREE.Vector3();

/** BufferGeometry.computeVertexNormals(), yielding every `perStep` triangles. */
export function* computeVertexNormalsSteps(geometry, perStep = 6000) {
  const index = geometry.index;
  const positionAttribute = geometry.getAttribute('position');
  if (positionAttribute === undefined) return;
  let normalAttribute = geometry.getAttribute('normal');
  if (normalAttribute === undefined) {
    normalAttribute = new THREE.BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
    geometry.setAttribute('normal', normalAttribute);
  } else {
    // reset existing normals to zero
    for (let i = 0, il = normalAttribute.count; i < il; i++) {
      normalAttribute.setXYZ(i, 0, 0, 0);
      if ((i + 1) % (perStep * 3) === 0) yield;
    }
  }
  let n = 0;
  if (index) {
    for (let i = 0, il = index.count; i < il; i += 3) {
      const vA = index.getX(i + 0), vB = index.getX(i + 1), vC = index.getX(i + 2);
      _pA.fromBufferAttribute(positionAttribute, vA);
      _pB.fromBufferAttribute(positionAttribute, vB);
      _pC.fromBufferAttribute(positionAttribute, vC);
      _cb.subVectors(_pC, _pB);
      _ab.subVectors(_pA, _pB);
      _cb.cross(_ab);
      _nA.fromBufferAttribute(normalAttribute, vA);
      _nB.fromBufferAttribute(normalAttribute, vB);
      _nC.fromBufferAttribute(normalAttribute, vC);
      _nA.add(_cb); _nB.add(_cb); _nC.add(_cb);
      normalAttribute.setXYZ(vA, _nA.x, _nA.y, _nA.z);
      normalAttribute.setXYZ(vB, _nB.x, _nB.y, _nB.z);
      normalAttribute.setXYZ(vC, _nC.x, _nC.y, _nC.z);
      if (++n % perStep === 0) yield;
    }
  } else {
    // non-indexed elements (unconnected triangle soup)
    for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
      _pA.fromBufferAttribute(positionAttribute, i + 0);
      _pB.fromBufferAttribute(positionAttribute, i + 1);
      _pC.fromBufferAttribute(positionAttribute, i + 2);
      _cb.subVectors(_pC, _pB);
      _ab.subVectors(_pA, _pB);
      _cb.cross(_ab);
      normalAttribute.setXYZ(i + 0, _cb.x, _cb.y, _cb.z);
      normalAttribute.setXYZ(i + 1, _cb.x, _cb.y, _cb.z);
      normalAttribute.setXYZ(i + 2, _cb.x, _cb.y, _cb.z);
      if (++n % perStep === 0) yield;
    }
  }
  // normalizeNormals()
  const normals = geometry.attributes.normal;
  for (let i = 0, il = normals.count; i < il; i++) {
    _vector.fromBufferAttribute(normals, i);
    _vector.normalize();
    normals.setXYZ(i, _vector.x, _vector.y, _vector.z);
    if ((i + 1) % (perStep * 3) === 0) yield;
  }
  normalAttribute.needsUpdate = true;
}

/** BufferGeometry.computeBoundingSphere(), yielding every `perStep` vertices. */
export function* computeBoundingSphereSteps(geometry, perStep = 40000) {
  if (geometry.boundingSphere === null) geometry.boundingSphere = new THREE.Sphere();
  const position = geometry.attributes.position;
  if (!position) return;
  const center = geometry.boundingSphere.center;
  // Box3.setFromBufferAttribute
  let minX = +Infinity, minY = +Infinity, minZ = +Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0, l = position.count; i < l; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    if ((i + 1) % perStep === 0) yield;
  }
  const box = new THREE.Box3();
  box.min.set(minX, minY, minZ);
  box.max.set(maxX, maxY, maxZ);
  box.getCenter(center);
  let maxRadiusSq = 0;
  for (let i = 0, il = position.count; i < il; i++) {
    _vector.fromBufferAttribute(position, i);
    maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
    if ((i + 1) % perStep === 0) yield;
  }
  geometry.boundingSphere.radius = Math.sqrt(maxRadiusSq);
  if (isNaN(geometry.boundingSphere.radius)) {
    console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', geometry);
  }
}

/** BufferGeometry.computeBoundingBox(), yielding every `perStep` vertices. */
export function* computeBoundingBoxSteps(geometry, perStep = 40000) {
  if (geometry.boundingBox === null) geometry.boundingBox = new THREE.Box3();
  const position = geometry.attributes.position;
  if (!position) { geometry.boundingBox.makeEmpty(); return; }
  let minX = +Infinity, minY = +Infinity, minZ = +Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0, l = position.count; i < l; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    if ((i + 1) % perStep === 0) yield;
  }
  geometry.boundingBox.min.set(minX, minY, minZ);
  geometry.boundingBox.max.set(maxX, maxY, maxZ);
  if (isNaN(geometry.boundingBox.min.x) || isNaN(geometry.boundingBox.min.y) || isNaN(geometry.boundingBox.min.z)) {
    console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', geometry);
  }
}

/**
 * BufferGeometryUtils.mergeGeometries(geometries, false), a few parts at a time, for non-indexed geometries with
 * identical attribute sets and no morph targets (what the airports merge): the same attributes in the same order, the same
 * typed-array classes and the same bytes (tests/sliced-geometry.test.mjs compares every one against the library's).
 */
export function* mergeGeometriesSteps(geometries, perStep = 24) {
  const names = Object.keys(geometries[0].attributes);
  const merged = new THREE.BufferGeometry();
  for (const name of names) {
    const attributes = geometries.map(g => g.attributes[name]);
    const first = attributes[0];
    let length = 0;
    for (const a of attributes) length += a.count * first.itemSize;
    const array = new first.array.constructor(length);
    const result = new THREE.BufferAttribute(array, first.itemSize, first.normalized);
    let offset = 0, n = 0;
    for (const a of attributes) {
      array.set(a.array, offset);
      offset += a.count * first.itemSize;
      if (++n % perStep === 0) yield;
    }
    if (first.gpuType !== undefined) result.gpuType = first.gpuType;
    merged.setAttribute(name, result);
    yield;
  }
  return merged;
}
