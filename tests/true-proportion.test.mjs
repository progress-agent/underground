// true-proportion.test.mjs: the D-039 height contract (sprint 25Sep26f, Lane S)
// in pure node. Structures keep TRUE proportions for every Master height;
// Master stretches only the landscape. Display space is canonical y x
// (Master / 5), exactly what vertical-scale.js's camera transform shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVerticalScaleController } from '../src/vertical-scale.js';
import {
  bindMasterController, structureYScale, structureHeightScale, masterRatio, currentMaster,
  trueProportionUniform, bindTrueProportion, placeTrueProportion, composeTrueProportionMatrix,
  displayDirection, tubeAxisAttribute, setAxisAttribute, patchTrueProportionMaterial,
  boreRadiusM, BORE_DIAMETER_M, onMasterChange,
} from '../src/true-proportion.js';

const MASTERS = [1, 1.1, 2.5, 5, 10];
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

function withController(fn) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 500, 900); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const controller = createVerticalScaleController({ camera, value: 1.1 });
  const unbind = bindMasterController(controller);
  try { return fn(controller); } finally { unbind(); controller.dispose(); }
}

test('unbound, every factor is identity (Master equals the base)', () => {
  assert.equal(currentMaster(), 5);
  assert.equal(structureYScale(), 1);
  assert.equal(trueProportionUniform.value, 1);
});

test('the bound controller drives the factors: real-metre geometry is shown at real size for every Master', () => {
  withController((controller) => {
    for (const m of MASTERS) {
      controller.setValue(m);
      assert.equal(currentMaster(), m);
      close(structureYScale(), 5 / m, 1e-12);
      close(structureHeightScale(), 1 / m, 1e-12, 'VE5-authored factor');
      close(trueProportionUniform.value, 5 / m, 1e-12, 'shader uniform');
      // A 20m real object: canonical height x display ratio is 20 again.
      close(20 * structureYScale() * masterRatio(), 20, 1e-9);
      close(20 * 5 * structureHeightScale() * controller.ratio, 20, 1e-9);
    }
  });
  assert.equal(structureYScale(), 1, 'unbinding restores identity');
});

test('onChange / onMasterChange fire on every change and never on a no-op', () => {
  withController((controller) => {
    const seen = [];
    const off = onMasterChange((m, k) => seen.push([m, k]));
    controller.setValue(3); controller.setValue(3); controller.setValue(100);
    off();
    controller.setValue(2);
    assert.deepEqual(seen.map(([m]) => m), [3, 10]);
    close(seen[1][1], 0.5, 1e-12);
  });
});

test('a bound object keeps its aspect ratio (height / width) for every Master; its base stays on the stretched ground', () => {
  withController((controller) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(30, 60, 30).translate(0, 30, 0));
    const ground = 12 * 5; // canonical VE5 ground 12m above datum
    placeTrueProportion(box, new THREE.Vector3(100, ground, -50));
    const aspects = [];
    for (const m of MASTERS) {
      controller.setValue(m);
      box.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(box);
      const displayHeight = (bb.max.y - bb.min.y) * controller.ratio;
      aspects.push(displayHeight / (bb.max.x - bb.min.x));
      close(displayHeight, 60, 1e-9, `display height at Master ${m}`);
      close(bb.min.y * controller.ratio, 12 * m, 1e-9, 'base on the stretched landscape');
    }
    for (const a of aspects) close(a, 2, 1e-9);
    // VE-authored geometry (heights already x5) binds with authoredVE 5.
    const ve = new THREE.Object3D(); bindTrueProportion(ve, { authoredVE: 5 });
    controller.setValue(4); close(ve.scale.y, 1 / 4, 1e-12);
  });
});

test('composeTrueProportionMatrix keeps a pitched, yawed body its true shape on screen', () => {
  withController((controller) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.2, 'YXZ'));
    const M = new THREE.Matrix4();
    for (const m of MASTERS) {
      controller.setValue(m);
      composeTrueProportionMatrix(M, new THREE.Vector3(5, -40, 7), q, new THREE.Vector3(2, 3, 50));
      // What the viewer sees: the camera's vertical scale times the matrix.
      const D = new THREE.Matrix4().makeScale(1, controller.ratio, 1).multiply(M);
      const e = D.elements, col = (i) => new THREE.Vector3(e[4 * i], e[4 * i + 1], e[4 * i + 2]);
      close(col(0).length(), 2, 1e-9); close(col(1).length(), 3, 1e-9); close(col(2).length(), 50, 1e-9);
      close(col(0).dot(col(1)), 0, 1e-9); close(col(1).dot(col(2)), 0, 1e-9); close(col(0).dot(col(2)), 0, 1e-9);
      close(e[13], -40 * controller.ratio, 1e-9, 'placed at the stretched depth');
    }
    controller.setValue(2);
    const d = displayDirection(new THREE.Vector3(1, 5, 0));
    close(d.y, 2, 1e-12);
  });
});

// The 'axis' shader, replicated on the CPU: y' = a + (y - a) x uTrueY.
function displayRing(geometry, ring, ringSize, ratio) {
  const p = geometry.attributes.position, a = geometry.attributes.trueAxisY;
  const pts = [];
  for (let j = 0; j < ringSize - 1; j++) {
    const i = ring * ringSize + j, ax = a.getX(i);
    const y = ax + (p.getY(i) - ax) * trueProportionUniform.value;
    pts.push(new THREE.Vector3(p.getX(i), y * ratio, p.getZ(i)));
  }
  return pts;
}

test('a bore on a sloping, curving path is drawn round at its true radius for every Master (axis mode)', () => {
  withController((controller) => {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -100, 0), new THREE.Vector3(300, -160, 80), new THREE.Vector3(700, -120, 40), new THREE.Vector3(900, -220, -60),
    ]);
    const r = boreRadiusM('victoria');
    const geo = tubeAxisAttribute(new THREE.TubeGeometry(path, 40, r, 10, false));
    for (const m of MASTERS) {
      controller.setValue(m);
      for (const ring of [0, 7, 20, 33, 40]) {
        const pts = displayRing(geo, ring, 11, controller.ratio);
        const c = pts.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        const centre = path.getPointAt(ring / 40);
        close(c.y, centre.y * controller.ratio, 1e-3, 'bore centre sits at the stretched depth');
        for (const q of pts) close(q.distanceTo(c), r, 1e-3, `ring ${ring} at Master ${m}`);
      }
    }
  });
});

test('setAxisAttribute validates its length; tubeAxisAttribute needs whole rings', () => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  assert.throws(() => setAxisAttribute(g, [1, 2, 3]), RangeError);
  setAxisAttribute(g, new Array(g.attributes.position.count).fill(4));
  assert.equal(g.attributes.trueAxisY.getX(0), 4);
  assert.throws(() => tubeAxisAttribute(new THREE.BoxGeometry(1, 1, 1), 7), RangeError);
});

test('patchTrueProportionMaterial chains prior hooks and injects the unscale before projection', () => {
  for (const [Material, lib] of [[THREE.MeshStandardMaterial, 'standard'], [THREE.MeshBasicMaterial, 'basic']]) {
    for (const mode of ['local', 'axis']) {
      const mat = new Material();
      let prior = 0;
      mat.onBeforeCompile = () => { prior++; };
      mat.customProgramCacheKey = () => 'prior-key';
      patchTrueProportionMaterial(mat, { mode });
      patchTrueProportionMaterial(mat, { mode }); // idempotent
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader };
      mat.onBeforeCompile(shader, null);
      assert.equal(prior, 1, 'prior onBeforeCompile ran once');
      assert.equal(shader.uniforms.uTrueY, trueProportionUniform);
      const vs = shader.vertexShader;
      const move = mode === 'axis' ? 'transformed.y = trueAxisY + ( transformed.y - trueAxisY ) * uTrueY;' : 'transformed.y *= uTrueY;';
      assert.ok(vs.includes(move), `${lib}/${mode} moves the vertex`);
      assert.ok(vs.indexOf(move) < vs.indexOf('#include <project_vertex>'), 'before projection');
      if (mode === 'axis') assert.ok(vs.includes('attribute float trueAxisY;'));
      if (vs.includes('#include <defaultnormal_vertex>')) assert.ok(vs.includes('objectNormal.y / max( uTrueY'), 'normal corrected');
      assert.equal(mat.customProgramCacheKey(), `prior-key|trueY:${mode}`);
    }
  }
  assert.throws(() => patchTrueProportionMaterial(new THREE.MeshBasicMaterial(), { mode: 'sideways' }), RangeError);
});

test('true bore sizes are sourced and round-trip to radii', () => {
  assert.equal(boreRadiusM('central'), 3.56 / 2);
  assert.equal(boreRadiusM('victoria'), 3.81 / 2);
  assert.equal(boreRadiusM('jubilee'), 4.35 / 2);
  assert.equal(boreRadiusM('elizabeth'), 6.2 / 2);
  assert.equal(boreRadiusM('not-a-line'), 3.56 / 2);
  for (const d of Object.values(BORE_DIAMETER_M)) assert.ok(d > 3 && d < 7);
});
