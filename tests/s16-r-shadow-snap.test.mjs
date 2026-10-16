// s16-r-shadow-snap.test.mjs: the shadowSnap economy of lane R (sprint 16Oct26f, D-054): fitShadowFrustum snaps the target
// along the light as well as across it, so the target (and with it the shadow camera) is bitwise the same for every focus
// inside one texel cell. The existing guarantees of tests/sun.test.mjs hold with it on and off; off is exactly 07391f3.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitShadowFrustum, sunDirection, SUN_CONFIG } from '../src/sun.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const same = (a, b) => Object.is(a, b);

// ── the along-light snap ─────────────────────────────────────────────────────
test('s16:R shadowSnap: the target is bitwise the same for every focus inside one cell, and moves by whole texels', () => {
  const r = rng(99);
  for (const t of [0.2, 0.5, 0.9]) {
    const direction = sunDirection(t);
    const cell = f => { const fit = fitShadowFrustum({ focus: f, groundY: 80, direction, alongSnap: true }); return fit; };
    let sameCell = 0, moved = 0;
    for (let i = 0; i < 400; i++) {
      const f0 = new THREE.Vector3(1234.5 + r() * 3000, 0, -987.25 + r() * 3000);
      const f1 = f0.clone().add(new THREE.Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3)); // well under a texel (0.73 m)
      const a = cell(f0), b = cell(f1);
      const ka = (v, ax, tx) => Math.round(v.dot(ax) / tx), d = direction.clone().normalize();
      // the cell: the three whole-texel coordinates of the snapped target
      const ia = [ka(a.target, a.right, a.texelX), ka(a.target, a.up, a.texelY), ka(a.target, d, a.texelX)];
      const ib = [ka(b.target, b.right, b.texelX), ka(b.target, b.up, b.texelY), ka(b.target, d, b.texelX)];
      if (ia.every((v, k) => v === ib[k])) { sameCell++; for (const k of ['x', 'y', 'z']) assert.ok(same(a.target[k], b.target[k]), `bitwise target.${k} t=${t} case ${i}`); } else moved++;
      // whole texels along the light too
      const along = a.target.dot(d) / a.texelX;
      assert.ok(Math.abs(along - Math.round(along)) < 1e-6, `along the light, t=${t}: ${along}`);
    }
    assert.ok(sameCell > 150 && moved > 0, `exercises both sides of a cell edge (${sameCell} same, ${moved} moved)`);
  }
});

test('s16:R shadowSnap: the existing fit guarantees hold with the along-light snap on and off', () => {
  for (const alongSnap of [false, true]) for (const t of [0, 0.2, 0.5, 0.9, 1]) {
    const direction = sunDirection(t), focus = new THREE.Vector3(1234.5, 0, -987.25);
    const fit = fitShadowFrustum({ focus, groundY: 80, direction, alongSnap });
    assert.equal(fit.halfWidth, SUN_CONFIG.shadowHalfExtent);
    const lightPos = fit.target.clone().addScaledVector(direction, fit.distance);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const h of [80 - 500, 80 + 2000]) {
      const along = new THREE.Vector3(direction.x, 0, direction.z).normalize();
      const p = new THREE.Vector3(focus.x, h, focus.z).addScaledVector(along, sx * SUN_CONFIG.shadowHalfExtent * 0.999).addScaledVector(fit.right, sz * SUN_CONFIG.shadowHalfExtent * 0.999);
      const rel = p.clone().sub(fit.target);
      assert.ok(Math.abs(rel.dot(fit.right)) <= fit.halfWidth + 1e-6, `x t=${t}`);
      assert.ok(Math.abs(rel.dot(fit.up)) <= fit.halfHeight + fit.texelY, `y t=${t}`);
      const depth = p.clone().sub(lightPos).dot(direction.clone().negate());
      assert.ok(depth > fit.near && depth < fit.far, `depth t=${t} snap ${alongSnap}`);
    }
    const moved = fitShadowFrustum({ focus: focus.clone().add(new THREE.Vector3(0.37, 0, 0.21)), groundY: 80, direction, alongSnap });
    const dx = moved.target.clone().sub(fit.target), kx = dx.dot(fit.right) / fit.texelX, ky = dx.dot(fit.up) / fit.texelY;
    assert.ok(Math.abs(kx - Math.round(kx)) < 1e-6 && Math.abs(ky - Math.round(ky)) < 1e-6);
  }
});

test('s16:R shadowSnap: off (the default), the fit is exactly the 07391f3 one', () => {
  const direction = sunDirection(0.4), focus = new THREE.Vector3(321.123, 0, 456.789);
  const a = fitShadowFrustum({ focus, groundY: 50, direction }), b = fitShadowFrustum({ focus, groundY: 50, direction, alongSnap: false });
  for (const k of ['x', 'y', 'z']) assert.ok(same(a.target[k], b.target[k]));
  // not snapped along the light: a sub-texel move along the light moves the target
  const d = direction.clone().normalize(), moved = fitShadowFrustum({ focus: focus.clone().addScaledVector(new THREE.Vector3(d.x, 0, d.z).normalize(), 0.2), groundY: 50, direction });
  assert.ok(moved.target.distanceTo(a.target) > 1e-3);
});
