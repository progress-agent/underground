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
//   projected = world - L * ((world.y - planeY) / L.y),  then y = planeY + lift
//
// L is the canonical direction towards the sun, planeY the standing height under the figure (the ground or
// the roof it is above), lift 0.02 m. Depth write on the one plane, with a strict depth test, stops overlapping
// triangles darkening twice. Opacity follows the sun's own shadow strength (so it fades with the sun's shadows:
// toggled off, Automatic's level 2 and below, or the height above the ground), fades out with the figure's
// height above the plane, and is gone when the sun is lower than 8 degrees or the figure swims.
export const SHADOW = Object.freeze({
  baseOpacity: 0.42,
  fadeHeightM: 25,
  minSunElevationDeg: 8,
  liftM: 0.02,
});

const VERT_FIND = '#include <project_vertex>';
const VERT_REPLACE = `
vec4 ugWp = modelMatrix * vec4( transformed, 1.0 );
ugWp.xyz -= uLight * ( ( ugWp.y - uPlaneY ) / uLight.y );
ugWp.y = uPlaneY + uLift;
vec4 mvPosition = viewMatrix * ugWp;
gl_Position = projectionMatrix * mvPosition;
`;

/** Shadow opacity for a state. Pure. */
export function shadowOpacity({ strengthRatio, heightM, elevationDeg, swimming, enabled = true }) {
  if (!enabled || swimming || !(strengthRatio > 0) || !(elevationDeg >= SHADOW.minSunElevationDeg)) return 0;
  const fade = Math.min(1, Math.max(0, 1 - heightM / SHADOW.fadeHeightM));
  return SHADOW.baseOpacity * Math.min(1, strengthRatio) * fade;
}

export function createFigureShadow({ THREE, figure }) {
  const uniforms = { uLight: { value: new THREE.Vector3(0, 1, 0) }, uPlaneY: { value: 0 }, uLift: { value: 0.1 } };
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.4, depthWrite: true, depthFunc: THREE.LessDepth,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: false, toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLight = uniforms.uLight;
    shader.uniforms.uPlaneY = uniforms.uPlaneY;
    shader.uniforms.uLift = uniforms.uLift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLight;\nuniform float uPlaneY;\nuniform float uLift;')
      .replace(VERT_FIND, VERT_REPLACE);
  };
  material.customProgramCacheKey = () => 'player-planar-shadow';

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
    m.visible = false;
    src.parent.add(m);
    meshes.push(m);
  }
  const info = { visible: false, opacity: 0, planeY: 0 };
  let enabled = true, wanted = false;
  const apply = () => { const on = enabled && wanted; for (const m of meshes) m.visible = on; info.visible = on; };

  /**
   * @param {object} o  { light: Vector3 (canonical, towards the sun), planeY (canonical), liftCanon, opacity }
   */
  function update({ light, planeY, liftCanon, opacity }) {
    wanted = !!(opacity > 0.003 && light && light.y > 0.05);
    apply();
    info.opacity = wanted ? opacity : 0; info.planeY = planeY;
    if (!wanted) return info;
    uniforms.uLight.value.copy(light);
    uniforms.uPlaneY.value = planeY;
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
