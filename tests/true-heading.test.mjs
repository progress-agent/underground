// true-heading.test.mjs: vehicles on a grade keep TRUE proportions at every
// Master (D-039, sprint 25Sep26f, Lane S, fix round 1).
//
// The verifier measured M25 near vehicles leaning by up to 67 degrees and
// Overground cars by up to 41 degrees, both stretched vertically, because the
// vertical unscale was applied in LOCAL axes before a rotation aimed along the
// canonical (VE5-steepened) path. The fix aims along the displayed path and
// unscales in world axes after the rotation (true-proportion.js
// trueHeadingBasis). These tests look at each instance matrix as the viewer
// sees it (canonical y x Master / 5) and require an orthonormal basis, that is
// no shear and no stretch, pointing along the displayed grade.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { trueHeadingBasis } from '../src/true-proportion.js';
import { createOvergroundFleet } from '../src/overground-trains.js';
import { createMotorway } from '../src/m25-motorway.js';

const VE = 5;
const MASTERS = [1, 1.1, 2.5, 5, 10];
const EPS = 1e-4;

/** Display-space columns of a column-major 4x4 (canonical y x ratio). */
function displayColumns(e, ratio) {
  return [0, 4, 8].map(o => new THREE.Vector3(e[o], e[o + 1] * ratio, e[o + 2]));
}
/** Worst shear (degrees off 90 between any two columns) and worst |length - 1|. */
function distortion(cols) {
  let shear = 0, stretch = 0;
  for (let i = 0; i < 3; i++) {
    stretch = Math.max(stretch, Math.abs(cols[i].length() - 1));
    for (let j = i + 1; j < 3; j++) {
      const c = cols[i].dot(cols[j]) / (cols[i].length() * cols[j].length());
      shear = Math.max(shear, Math.abs(90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(c, -1, 1)))));
    }
  }
  return { shear, stretch };
}
function alignedWith(col, dir) {
  return col.clone().normalize().dot(dir.clone().normalize());
}

test('trueHeadingBasis: orthonormal on screen, aimed along the displayed grade, no roll', () => {
  const out = { side: new THREE.Vector3(), up: new THREE.Vector3(), forward: new THREE.Vector3() };
  for (const master of MASTERS) {
    const k = VE / master, ratio = master / VE;
    for (const grade of [0, 0.01, 0.032, -0.08, 0.4]) for (const yaw of [0, 0.7, 2.1, -2.9]) {
      const dir = new THREE.Vector3(Math.sin(yaw), grade * VE, Math.cos(yaw)); // canonical: real grade x VE
      trueHeadingBasis(dir, k, out);
      const cols = [out.side, out.up, out.forward].map(v => new THREE.Vector3(v.x, v.y * ratio, v.z));
      const d = distortion(cols);
      assert.ok(d.shear < 1e-6 && d.stretch < 1e-9, `master ${master} grade ${grade}: ${JSON.stringify(d)}`);
      const shown = new THREE.Vector3(dir.x, dir.y * ratio, dir.z);
      assert.ok(alignedWith(cols[2], shown) > 1 - 1e-12, 'forward follows the displayed path');
      assert.ok(Math.abs(cols[0].y) < 1e-12, 'side stays level: no roll');
      assert.ok(cols[1].y > 0, 'up is up');
      // Displayed pitch equals the displayed grade (real grade x Master).
      const pitch = Math.atan2(cols[2].y, Math.hypot(cols[2].x, cols[2].z));
      assert.ok(Math.abs(Math.tan(pitch) - grade * master) < 1e-9);
    }
  }
});

test('Overground cars on a grade keep true proportions at every Master', () => {
  // A 3% real grade, stored canonically at VE5 like the app's rail paths.
  const path = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1800, 1800 * 0.03 * VE, 1200)];
  for (const master of MASTERS) {
    const fleet = createOvergroundFleet([path], '#ee7c0e', 'test');
    const multiplier = VE / master, ratio = master / VE;
    fleet.userData.update(1, null, multiplier);
    const shown = new THREE.Vector3(path[1].x, path[1].y * ratio, path[1].z);
    let checked = 0;
    for (const mesh of fleet.userData.meshes) {
      for (let i = 0; i < mesh.count; i++) {
        const e = new THREE.Matrix4(); mesh.getMatrixAt(i, e);
        if (Math.abs(e.determinant()) < 1e-12) continue; // hidden slot
        const cols = displayColumns(e.elements, ratio);
        const d = distortion(cols);
        assert.ok(d.shear < 1e-3 && d.stretch < EPS, `${mesh.name} master ${master}: ${JSON.stringify(d)}`);
        assert.ok(Math.abs(alignedWith(cols[2], shown)) > 1 - 1e-9, `${mesh.name} runs along the displayed rail`);
        checked++;
      }
    }
    assert.ok(checked >= 6, `checked ${checked} car matrices`);
    // The roof sits a true 1.75m above the body centre on screen, along the car's up.
    const body = new THREE.Matrix4(), roof = new THREE.Matrix4();
    fleet.userData.meshes[0].getMatrixAt(0, body); fleet.userData.meshes[1].getMatrixAt(0, roof);
    const lift = new THREE.Vector3().setFromMatrixPosition(roof).sub(new THREE.Vector3().setFromMatrixPosition(body));
    lift.y *= ratio;
    assert.ok(Math.abs(lift.length() - 1.75) < 1e-4, `roof lift ${lift.length()}`);
  }
});

test('M25 near vehicles on a grade keep true proportions at every Master', () => {
  // A stub terrain rising 3.2% (real) across London, stored at VE5 like the app.
  const getSurfaceY = ({ x, z }) => 40 + (0.032 * x + 0.011 * z) * VE;
  for (const master of [1, 1.1, 10]) {
    const g = createMotorway({ getSurfaceY, heightScale: 1 / master });
    g.userData.update(10, null, true); // no camera: every vehicle is near LOD
    const ratio = master / VE;
    let checked = 0, graded = 0, worst = { shear: 0, stretch: 0 };
    g.traverse(mesh => {
      if (!mesh.isInstancedMesh || mesh.userData.lod !== 'near') return;
      for (let i = 0; i < mesh.count; i += 7) {
        const e = mesh.instanceMatrix.array.subarray(i * 16, i * 16 + 16);
        const cols = displayColumns(e, ratio), d = distortion(cols);
        worst = { shear: Math.max(worst.shear, d.shear), stretch: Math.max(worst.stretch, d.stretch) };
        const p = g.userData.vehicleAt(mesh.userData.vehicleIds[i]);
        const shown = new THREE.Vector3(p.dx, p.dy * ratio, p.dz);
        assert.ok(alignedWith(cols[2], shown) > 1 - 1e-6, 'vehicle runs along the displayed road');
        if (Math.abs(p.dy) / Math.hypot(p.dx, p.dz) > 0.05) graded++;
        checked++;
      }
    });
    assert.ok(checked > 500, `checked ${checked} vehicles`);
    assert.ok(graded > 100, `only ${graded} vehicles on a grade: the check would be vacuous`);
    assert.ok(worst.shear < 1e-3 && worst.stretch < EPS, `master ${master}: ${JSON.stringify(worst)}`);
    g.userData.dispose();
  }
});
