// Three r161 TubeGeometry, with bounded construction steps. Native Frenet
// arithmetic and attribute order are retained; typed buffers avoid growing
// temporary number arrays, and each radial sine/cosine is evaluated once.
import * as THREE from 'three';

function* frenetSteps(path, segments, closed, perStep) {
  const normal = new THREE.Vector3(), vec = new THREE.Vector3(), mat = new THREE.Matrix4();
  const tangents = [], normals = [], binormals = [];
  for (let i = 0; i <= segments; i++) {
    tangents[i] = path.getTangentAt(i / segments, new THREE.Vector3());
    if ((i + 1) % perStep === 0) yield;
  }
  normals[0] = new THREE.Vector3(); binormals[0] = new THREE.Vector3();
  let min = Number.MAX_VALUE;
  const tx = Math.abs(tangents[0].x), ty = Math.abs(tangents[0].y), tz = Math.abs(tangents[0].z);
  if (tx <= min) { min = tx; normal.set(1, 0, 0); }
  if (ty <= min) { min = ty; normal.set(0, 1, 0); }
  if (tz <= min) normal.set(0, 0, 1);
  vec.crossVectors(tangents[0], normal).normalize();
  normals[0].crossVectors(tangents[0], vec);
  binormals[0].crossVectors(tangents[0], normals[0]);
  for (let i = 1; i <= segments; i++) {
    normals[i] = normals[i - 1].clone(); binormals[i] = binormals[i - 1].clone();
    vec.crossVectors(tangents[i - 1], tangents[i]);
    if (vec.length() > Number.EPSILON) {
      vec.normalize();
      const theta = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
      normals[i].applyMatrix4(mat.makeRotationAxis(vec, theta));
    }
    binormals[i].crossVectors(tangents[i], normals[i]);
    if (i % perStep === 0) yield;
  }
  if (closed) {
    let theta = Math.acos(THREE.MathUtils.clamp(normals[0].dot(normals[segments]), -1, 1)) / segments;
    if (tangents[0].dot(vec.crossVectors(normals[0], normals[segments])) > 0) theta = -theta;
    for (let i = 1; i <= segments; i++) {
      normals[i].applyMatrix4(mat.makeRotationAxis(tangents[i], theta * i));
      binormals[i].crossVectors(tangents[i], normals[i]);
      if (i % perStep === 0) yield;
    }
  }
  return { tangents, normals, binormals };
}

export function* createTubeGeometrySteps(path, tubularSegments, radius, radialSegments = 8, closed = false, perStep = 64) {
  const frames = yield* frenetSteps(path, tubularSegments, closed, perStep);
  // Use the native prototype so clone/copy/toJSON and instanceof retain the
  // TubeGeometry contract without running its blocking constructor first.
  const geometry = Object.setPrototypeOf(new THREE.BufferGeometry(), THREE.TubeGeometry.prototype);
  geometry.type = 'TubeGeometry';
  geometry.parameters = { path, tubularSegments, radius, radialSegments, closed };
  Object.assign(geometry, frames);
  const stride = radialSegments + 1, count = (tubularSegments + 1) * stride;
  const vertices = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const indices = new (count >= 65536 ? Uint32Array : Uint16Array)(tubularSegments * radialSegments * 6);
  const sin = [], cos = [];
  for (let j = 0; j <= radialSegments; j++) {
    const v = j / radialSegments * Math.PI * 2;
    sin[j] = Math.sin(v); cos[j] = -Math.cos(v);
  }
  const normal = new THREE.Vector3(); let P = new THREE.Vector3();
  for (let row = 0; row <= tubularSegments; row++) {
    const i = row === tubularSegments && closed ? 0 : row;
    P = path.getPointAt(i / tubularSegments, P);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radialSegments; j++) {
      normal.set(cos[j] * N.x + sin[j] * B.x, cos[j] * N.y + sin[j] * B.y, cos[j] * N.z + sin[j] * B.z).normalize();
      const k = (row * stride + j) * 3;
      normals[k] = normal.x; normals[k + 1] = normal.y; normals[k + 2] = normal.z;
      vertices[k] = P.x + radius * normal.x; vertices[k + 1] = P.y + radius * normal.y; vertices[k + 2] = P.z + radius * normal.z;
      const uv = (row * stride + j) * 2;
      uvs[uv] = row / tubularSegments; uvs[uv + 1] = j / radialSegments;
    }
    if ((row + 1) % perStep === 0) yield;
  }
  let offset = 0;
  for (let j = 1; j <= tubularSegments; j++) {
    for (let i = 1; i <= radialSegments; i++) {
      const a = stride * (j - 1) + i - 1, b = stride * j + i - 1, c = stride * j + i, d = stride * (j - 1) + i;
      indices[offset++] = a; indices[offset++] = b; indices[offset++] = d;
      indices[offset++] = b; indices[offset++] = c; indices[offset++] = d;
    }
    if (j % perStep === 0) yield;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}
