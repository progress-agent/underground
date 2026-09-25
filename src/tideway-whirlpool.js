// tideway-whirlpool.js: where a Tideway foreshore shaft meets the Thames bed
// (sprint 25Sep26f, Lane W, D-039).
//
// Jordan: remove the blue cylinders standing on the river; foreshore sites
// become whirlpools in the floor of the river, a slow animated vortex on the
// bed visible through the water. Land sites keep an underground-only shaft.
//
// Contracts:
//  - Pure functions of their inputs: geometry from a floor sampler, motion from
//    elapsed simulation time (uTime). No randomness, no per-instance colour.
//  - The disc lies on the rendered bed (a landscape surface, so it stretches
//    with Master like the bed does). The bed is opaque and is not cut open, so
//    the shaft mouth is painted, not modelled: a dark core the arms spiral into,
//    with the open shaft top just below the bed.
//  - Drawn transparent, depthWrite false, before the Thames water (renderOrder
//    below SURFACE_WATER), so the water composites over it from above and its
//    rim fades into the bed instead of ending in a hard disc edge.

import * as THREE from 'three';

// The eight Tideway sites built in the river foreshore (Thames Tideway Tunnel
// Order 2014 site names: "... Foreshore", plus the in-river structures at
// Heathwall Pumping Station and Chambers Wharf).
export const FORESHORE_SITE_IDS = new Set([
  'putney', 'chelsea', 'albert', 'victoria', 'blackfriars', 'kemp', 'heathwall', 'chambers',
]);

export const WHIRLPOOL = {
  outerFactor: 2.6,    // disc radius as a multiple of the shaft radius
  minOuterM: 24,       // but never smaller than this, so it reads from above
  dipM: 0,             // the bed is opaque: no modelled funnel (see above)
  liftY: 0.35,         // canonical units above the bed (no z-fighting)
  shaftBelowBedM: 0.5, // open shaft top, real metres under the bed
  armSpeed: 0.55,      // radians per second of pattern phase
  arms: 3,
};

/** Nearest point (spiral search) within maxR of (x, z) where ok(x, z) holds. */
export function findNearest(ok, x, z, maxR = 120, step = 4) {
  if (ok(x, z)) return { x, z, moved: 0 };
  for (let r = step; r <= maxR; r += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) { best = { x: px, z: pz, moved: r }; break; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Funnel disc from the shaft rim (innerR) to outerR, draped on floorAt.
 * Positions are world (canonical) coordinates; aWhirl is the local XZ offset
 * normalised so the outer rim is 1 (aWhirl.z = inner rim), which the shader
 * turns into the spiral, so every whirlpool shares one material.
 */
export function buildWhirlpoolGeometry({ cx, cz, innerR, outerR, floorAt, VE = 5, dipM = WHIRLPOOL.dipM,
  liftY = WHIRLPOOL.liftY, rings = 10, segs = 48 }) {
  const count = (rings + 1) * (segs + 1);
  const pos = new Float32Array(count * 3), local = new Float32Array(count * 3);
  let v = 0;
  for (let i = 0; i <= rings; i++) {
    const rn = i / rings, r = innerR + (outerR - innerR) * rn;
    const dip = dipM * VE * (1 - rn) * (1 - rn);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      const x = cx + lx, z = cz + lz;
      const f = floorAt(x, z);
      pos[v * 3] = x; pos[v * 3 + 1] = (Number.isFinite(f) ? f : 0) + liftY - dip; pos[v * 3 + 2] = z;
      local[v * 3] = lx / outerR; local[v * 3 + 1] = lz / outerR; local[v * 3 + 2] = innerR / outerR;
      v++;
    }
  }
  const index = [];
  for (let i = 0; i < rings; i++) for (let k = 0; k < segs; k++) {
    const a = i * (segs + 1) + k, b = a + 1, c = a + (segs + 1), d = c + 1;
    // Counter-clockwise seen from above (+Y): faces point up.
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aWhirl', new THREE.BufferAttribute(local, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Shared material: silt bed with pale streaks spiralling into the shaft. */
export function createWhirlpoolMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uBed: { value: new THREE.Color(0x5c5446) },
    uFoam: { value: new THREE.Color(0xb7c6c0) },
    uArmSpeed: { value: WHIRLPOOL.armSpeed },
    uArms: { value: WHIRLPOOL.arms },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  material.name = 'tideway-whirlpool';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 aWhirl;\nvarying vec3 vWhirl;\nvoid main() {\n vWhirl = aWhirl;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uTime;
uniform vec3 uBed;
uniform vec3 uFoam;
uniform float uArmSpeed;
uniform float uArms;
varying vec3 vWhirl;
float whirlStreak;
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float d = length( vWhirl.xy );
    float rn = clamp( ( d - vWhirl.z ) / max( 1.0 - vWhirl.z, 1e-3 ), 0.0, 1.0 );
    float a = atan( vWhirl.y, vWhirl.x );
    // Logarithmic spiral arms: rotating them rigidly reads as water drawn
    // inwards. (A radius-dependent spin would wind up without limit.)
    float spin = uTime * uArmSpeed;
    float arms = 0.5 + 0.5 * sin( uArms * a + 5.0 * log( d + 0.03 ) + spin );
    float fine = 0.5 + 0.5 * sin( ( uArms * 2.0 + 1.0 ) * a + 9.0 * log( d + 0.03 ) + spin * 1.3 );
    whirlStreak = ( smoothstep( 0.6, 0.97, arms ) * 0.75 + smoothstep( 0.72, 1.0, fine ) * 0.3 )
      * ( 1.0 - 0.7 * rn ) * smoothstep( 0.0, 0.1, rn );
    // The shaft mouth: dark at the core, easing out to the silt.
    float depthDark = mix( 0.1, 1.0, smoothstep( 0.0, 0.4, rn ) );
    diffuseColor.rgb = mix( uBed * depthDark, uFoam, clamp( whirlStreak, 0.0, 1.0 ) * 0.62 );
    diffuseColor.a = ( 1.0 - smoothstep( 0.7, 1.0, rn ) ) * ( 0.55 + 0.45 * max( whirlStreak, 1.0 - rn ) );
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += uFoam * whirlStreak * 0.3;`);
    material.userData.shader = shader;
  };
  material.userData.whirlpoolUniforms = uniforms;
  return material;
}
