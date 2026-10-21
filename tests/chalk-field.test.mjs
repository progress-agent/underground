// The chalk floor's displacement field, in a worker or in line (sprint 21Oct26w, lane L, approach F; L-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { chalkDisplacement, chalkDisplacementField, chalkRingFromPoints, setChalkRing } from '../src/chalk-field.js';
import { createChalkPlane, createGeologicalStrata, getChalkSurfaceY, CHALK_TOP_Y } from '../src/geology.js';
import { samplePoints } from './fixtures/chalk-goldens.mjs';
import { createJobRunner } from '../src/opening-jobs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/chalk-goldens.json'), 'utf8'));
const M25 = JSON.parse(readFileSync(path.join(ROOT, 'public/data/m25.json'), 'utf8'));

test('the displacement equals the 7c2d4bd values at the golden points, exactly', () => {
  setChalkRing(chalkRingFromPoints(M25.supportPoints || M25.points));
  assert.equal(GOLD.length > 600, true);
  // The goldens are getChalkSurfaceY(x, z) - CHALK_TOP_Y as 7c2d4bd computed it, so the same expression on the
  // branch must give the same double; the bare displacement agrees to the rounding of adding and removing the datum.
  for (const [x, z, expected] of GOLD) {
    assert.equal(getChalkSurfaceY(x, z) - CHALK_TOP_Y, expected, `surface at ${x}, ${z}`);
    assert.ok(Math.abs(chalkDisplacement(x, z) - expected) < 1e-9, `displacement at ${x}, ${z}`);
  }
  assert.equal(samplePoints().length, 600);
});

test('the worker job, run in the runner, equals the in-line loop over a real chalk plane', () => {
  const bounds = { minX: -30000, maxX: 40000, minZ: -30000, maxZ: 24000, widthM: 70000, heightM: 54000 };
  const plane = createChalkPlane(bounds);
  assert.equal(plane.x.length, 513 * 513);
  assert.equal(plane.centerX, 5000);
  const ring = chalkRingFromPoints(M25.supportPoints || M25.points);
  const viaRunner = createJobRunner()('chalkDisplacement', { ring, x: plane.x, z: plane.z, centerX: plane.centerX, centerZ: plane.centerZ }).result;
  // The loop that lived in createGeologicalStrata: world position from the Float32 vertex, then the displacement.
  setChalkRing(ring);
  const pos = plane.geom.attributes.position;
  const loop = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) loop[i] = chalkDisplacement(pos.getX(i) + plane.centerX, pos.getZ(i) + plane.centerZ);
  assert.equal(viaRunner.length, loop.length);
  for (let i = 0; i < loop.length; i++) if (viaRunner[i] !== loop[i]) assert.fail(`vertex ${i}: ${viaRunner[i]} vs ${loop[i]}`);
});

test('the rim is flat at the M25 ring and the interior is not', () => {
  setChalkRing(chalkRingFromPoints(M25.supportPoints || M25.points));
  const p = M25.supportPoints[0];
  const { BNG_REF_E, BNG_REF_N } = { BNG_REF_E: 530028.7469586737, BNG_REF_N: 180380.09351556934 };
  assert.ok(Math.abs(chalkDisplacement(p.e - BNG_REF_E, -(p.n - BNG_REF_N))) < 1e-6);
  assert.ok(GOLD.some(([, , d]) => Math.abs(d) > 20));
});
