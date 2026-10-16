// figure-shadow.js: the figure's own shadow, a planar projection (sprint 14Oct26w, lane P, D-053 item 3: "the
// figure's own shadow ... stands").
//
// WHY NOT THE SUN'S SHADOW MAP. The sun's map is 2048 texels over about 3 km, 1.5 m a texel (D-045 item 7): a
// smudge for a figure half a metre wide. So the figure is drawn a second time, flattened onto the ground along
// the sun's direction: one extra SkinnedMesh per figure primitive (2), sharing the geometry and the skeleton,
// with a black material whose vertex shader projects each skinned vertex onto the horizontal plane under the
// feet. Cost: two draws and the figure's 13,744 triangles again. It follows the animation exactly because it is
// the same skinned geometry.
//
//   projected = world - L * t,  t = (world.y - planeY - g . (world.xz - feet.xz)) / (L.y - g . L.xz)
//
// L is the direction towards the sun, shortened so the shadow is never longer than about 1.4 figure heights
// (shadowLight: the canonical sun is 28.5 degrees up but 6 degrees as displayed, which threw a 16 m shadow that
// sank into any street rising along it). The plane is the ground under the feet, tilted to the ground's slope
// there (g, canonical rise per metre) and lifted 0.02 m, so it follows a rising or falling street instead of
// burying or hovering over it. Depth write on the one plane, with a strict depth test, stops overlapping
// triangles darkening twice. Since sprint 16Oct26f (T-speckle) every fragment WRITES the depth of that plane at
// its own pixel (gl_FragDepth, below): coplanar triangles do not interpolate bit-identical depth, so with the
// triangles' own depth some fragments of the second triangle came out one step nearer and passed the strict
// test, double-darkening isolated pixels (the faint dark speckles inside the shadow). One depth per pixel makes
// the strict test reject every overlap. Opacity follows the sun's own shadow strength (so it fades with the sun's shadows:
// toggled off, Automatic's level 2 and below, or the height above the ground), fades out with the figure's
// height above the plane, and is gone when the sun is lower than 8 degrees or the figure swims.
export const SHADOW = Object.freeze({
  baseOpacity: 0.42,
  // The longest the shadow may run, in metres of ground per metre of figure height. The sun's canonical elevation
  // (28.5 degrees) is only 6 degrees as displayed at Master 1, which would throw a 16 m shadow that no street
  // could hold. Capped, it is about 2.5 m long: the whole figure, readable at the feet.
  maxRunPerHeight: 1.4,
  slopeProbeM: 1.0,
  maxSlope: 0.6,
  fadeHeightM: 25,
  minSunElevationDeg: 8,
  liftM: 0.02,
});

/**
 * The direction the shadow is thrown along (canonical, towards the sun, normalised): the sun's, with its
 * horizontal part shortened until the shadow is at most SHADOW.maxRunPerHeight metres of ground per displayed
 * metre of figure height. Run per height = (horizontal / vertical) / ratio, ratio being the Master height ratio.
 * Pure.
 */
export function shadowLight(dir, ratio = 1, out = { x: 0, y: 1, z: 0 }) {
  const h = Math.hypot(dir.x, dir.z);
  const r = Math.max(1e-3, ratio);
  const maxHV = SHADOW.maxRunPerHeight * r;          // horizontal / vertical allowed, canonical
  let hx = dir.x, hz = dir.z, y = dir.y;
  if (h > 1e-9 && y > 1e-9 && h / y > maxHV) { const k = (maxHV * y) / h; hx *= k; hz *= k; }
  const n = Math.hypot(hx, y, hz) || 1;
  out.x = hx / n; out.y = y / n; out.z = hz / n;
  return out;
}

/**
 * The slope to give the shadow's plane so the denominator of the projection stays well away from zero: the
 * plane y = planeY + gx dx + gz dz, thrown along light L, needs L.y - gx L.x - gz L.z comfortably positive.
 * Returns { gx, gz } (canonical rise per canonical metre), clamped. Pure.
 */
export function clampSlope(gx, gz, light) {
  const m = Math.hypot(gx, gz);
  if (m > SHADOW.maxSlope) { gx *= SHADOW.maxSlope / m; gz *= SHADOW.maxSlope / m; }
  const denom = light.y - gx * light.x - gz * light.z;
  if (denom < 0.3 * light.y) { gx = 0; gz = 0; }
  return { gx, gz };
}

/**
 * What the vertex shader does, in JS (the test pins it): a world point thrown along L onto the plane through
 * (px, planeY, pz) that rises (gx, gz) per metre, then lifted by `lift`. Pure.
 */
export function projectOntoPlane(w, light, plane, lift = 0, out = { x: 0, y: 0, z: 0 }) {
  const { px, py, pz, gx, gz } = plane;
  const t = (w.y - py - gx * (w.x - px) - gz * (w.z - pz)) / (light.y - gx * light.x - gz * light.z);
  out.x = w.x - light.x * t; out.y = w.y - light.y * t + lift; out.z = w.z - light.z * t;
  return out;
}

const VERT_FIND = '#include <project_vertex>';
const VERT_REPLACE = `
vec4 ugWp = modelMatrix * vec4( transformed, 1.0 );
float ugT = ( ugWp.y - uPlaneP.y - uSlope.x * ( ugWp.x - uPlaneP.x ) - uSlope.y * ( ugWp.z - uPlaneP.z ) )
  / ( uLight.y - uSlope.x * uLight.x - uSlope.y * uLight.z );
ugWp.xyz -= uLight * ugT;
ugWp.y += uLift;
vec4 mvPosition = viewMatrix * ugWp;
gl_Position = projectionMatrix * mvPosition;
`;

// ── s16:T ── T-speckle (D-054): one depth per pixel. The plane in view space is (n, w) with n . x = w; the ray through
// a pixel, (dx, dy, -1) with dx = (ndcX + P[8]) / P[0], dy = (ndcY + P[9]) / P[5], meets it at view z = -w / (n . dir);
// the depth that z has under the projection is what the fragment writes, pulled a hair nearer than the ground it
// lies 2 cm above (twice the pixel's depth slope and 4 steps of a 24-bit buffer; the polygon offset it replaces
// is inert once a shader writes depth).
const FRAG_DEPTH = `
vec2 ugNdc = ( gl_FragCoord.xy - uVp.xy ) / uVp.zw * 2.0 - 1.0;
vec3 ugDir = vec3( ( ugNdc.x + uProjK.z ) / uProjK.x, ( ugNdc.y + uProjK.w ) / uProjK.y, -1.0 );
float ugZ = - uPlaneV.w / dot( uPlaneV.xyz, ugDir );
float ugD = 0.5 * ( ( uProjZ.x * ugZ + uProjZ.y ) / ( - ugZ ) ) + 0.5;
gl_FragDepth = ugD - 2.0 * max( abs( dFdx( ugD ) ), abs( dFdy( ugD ) ) ) - 4.0 / 16777216.0;
`;

/**
 * What the fragment shader computes before its small pull-forward, in JS (the test pins it): the window depth in
 * [0, 1] of the plane `planeView` = { nx, ny, nz, w } (view space, n . x = w) at the pixel with normalised device
 * coordinates (ndcX, ndcY), under a projection with `proj` = the matrix elements (column-major, as three.js
 * stores them). Pure.
 */
export function planeDepthAt(ndcX, ndcY, planeView, proj) {
  const dx = (ndcX + proj[8]) / proj[0], dy = (ndcY + proj[9]) / proj[5];
  const z = -planeView.w / (planeView.nx * dx + planeView.ny * dy - planeView.nz);
  return 0.5 * ((proj[10] * z + proj[14]) / -z) + 0.5;
}
// ── /s16:T ──

/** Shadow opacity for a state. Pure. */
export function shadowOpacity({ strengthRatio, heightM, elevationDeg, swimming, enabled = true }) {
  if (!enabled || swimming || !(strengthRatio > 0) || !(elevationDeg >= SHADOW.minSunElevationDeg)) return 0;
  const fade = Math.min(1, Math.max(0, 1 - heightM / SHADOW.fadeHeightM));
  return SHADOW.baseOpacity * Math.min(1, strengthRatio) * fade;
}

export function createFigureShadow({ THREE, figure }) {
  const uniforms = {
    uLight: { value: new THREE.Vector3(0, 1, 0) }, uPlaneP: { value: new THREE.Vector3() }, uSlope: { value: new THREE.Vector2() }, uLift: { value: 0.1 },
    // ── s16:T ── the plane in view space (xyz normal, w = -constant), the projection terms and the viewport
    uPlaneV: { value: new THREE.Vector4() }, uProjK: { value: new THREE.Vector4() }, uProjZ: { value: new THREE.Vector2() }, uVp: { value: new THREE.Vector4() },
    // ── /s16:T ──
  };
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.4, depthWrite: true, depthFunc: THREE.LessDepth,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: false, toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLight = uniforms.uLight;
    shader.uniforms.uPlaneP = uniforms.uPlaneP;
    shader.uniforms.uSlope = uniforms.uSlope;
    shader.uniforms.uLift = uniforms.uLift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLight;\nuniform vec3 uPlaneP;\nuniform vec2 uSlope;\nuniform float uLift;')
      .replace(VERT_FIND, VERT_REPLACE);
    // ── s16:T ── one depth per pixel (see FRAG_DEPTH)
    shader.uniforms.uPlaneV = uniforms.uPlaneV;
    shader.uniforms.uProjK = uniforms.uProjK;
    shader.uniforms.uProjZ = uniforms.uProjZ;
    shader.uniforms.uVp = uniforms.uVp;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uPlaneV;\nuniform vec4 uProjK;\nuniform vec2 uProjZ;\nuniform vec4 uVp;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>${FRAG_DEPTH}`);
    // ── /s16:T ──
  };
  material.customProgramCacheKey = () => 'player-planar-shadow-fd';   // s16:T (was 'player-planar-shadow')

  // ── s16:T ── the plane's view-space uniforms, set per mesh just before it draws (the camera and viewport of THIS render)
  const planeW = new THREE.Plane(), planeN = new THREE.Vector3(), planeP = new THREE.Vector3(), vpTmp = new THREE.Vector4();
  function setPlaneUniforms(renderer, camera) {
    const g = uniforms.uSlope.value, P0 = uniforms.uPlaneP.value;
    planeN.set(-g.x, 1, -g.y).normalize();
    planeP.set(P0.x, P0.y + uniforms.uLift.value, P0.z);
    planeW.setFromNormalAndCoplanarPoint(planeN, planeP).applyMatrix4(camera.matrixWorldInverse);
    uniforms.uPlaneV.value.set(planeW.normal.x, planeW.normal.y, planeW.normal.z, -planeW.constant);
    const e = camera.projectionMatrix.elements;
    uniforms.uProjK.value.set(e[0], e[5], e[8], e[9]);
    uniforms.uProjZ.value.set(e[10], e[14]);
    renderer.getCurrentViewport(vpTmp);
    uniforms.uVp.value.copy(vpTmp);
  }
  // ── /s16:T ──

  const meshes = [];
  let k = 0;
  for (const src of figure.meshes) {
    if (!src.isSkinnedMesh) continue;
    const m = new THREE.SkinnedMesh(src.geometry, material);
    m.name = `player-shadow-${k++}`;
    m.bind(src.skeleton, src.bindMatrix);
    m.position.copy(src.position); m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
    m.frustumCulled = false;
    m.castShadow = false; m.receiveShadow = false;
    m.renderOrder = 1;
    m.onBeforeRender = (renderer, scene, camera) => setPlaneUniforms(renderer, camera);   // s16:T
    m.visible = false;
    src.parent.add(m);
    meshes.push(m);
  }
  const info = { visible: false, opacity: 0, planeY: 0, slope: [0, 0] };
  let enabled = true, wanted = false;
  const apply = () => { const on = enabled && wanted; for (const m of meshes) m.visible = on; info.visible = on; };

  /**
   * @param {object} o  { light: Vector3 (canonical, towards the sun), planeY (canonical), x, z (the point the plane
   *   passes through), slopeX, slopeZ (its rise per metre), liftCanon, opacity }
   */
  function update({ light, planeY, x = 0, z = 0, slopeX = 0, slopeZ = 0, liftCanon, opacity }) {
    wanted = !!(opacity > 0.003 && light && light.y > 0.05);
    apply();
    info.opacity = wanted ? opacity : 0; info.planeY = planeY; info.slope = [slopeX, slopeZ];
    if (!wanted) return info;
    uniforms.uLight.value.copy(light);
    uniforms.uPlaneP.value.set(x, planeY, z);
    uniforms.uSlope.value.set(slopeX, slopeZ);
    uniforms.uLift.value = liftCanon;
    material.opacity = opacity;
    return info;
  }
  return {
    meshes, material, uniforms, update,
    /** Switch the drawing on or off at once (not at the next frame): a capture compares a frame with and without it. */
    setEnabled(on) { enabled = !!on; apply(); },
    hide() { wanted = false; apply(); info.opacity = 0; },
    debug: () => ({ ...info }),
  };
}
