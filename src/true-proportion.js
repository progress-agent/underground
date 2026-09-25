// true-proportion.js: the height contract after D-039 (sprint 25Sep26f, Lane S).
//
// Jordan, 25Sep26f: "We don't ever want to reduce the building height below 1x
// reality... let's exempt structures from the height setting, so they're
// always expressed at true proportions."
//
// THE CONTRACT
//   * The scene is authored in canonical VE5 space: terrain, river bed, geology
//     and every depth are stored at five times their real vertical size.
//   * Master height (vertical-scale.js, floor 1.0) is a display transform on the
//     camera: display y = canonical y x (Master / 5). It stretches the LANDSCAPE
//     only: terrain relief, the river bed, geology and how deep things sit.
//   * Everything BUILT (buildings, landmarks, bridges, towers, stations, tunnel
//     cross-sections, trains, vehicles, aircraft, sea life) keeps its TRUE
//     proportions for every Master value. It stands at its stretched landscape
//     position, but its own shape is never stretched.
//
// HOW: a structure authored in real metres needs a canonical vertical scale of
// 5 / Master about its own pivot, so the camera's Master / 5 cancels it. That
// factor is `structureYScale()`, and the same number lives in the shared shader
// uniform `trueProportionUniform` for geometry that cannot carry a per-object
// scale (instanced markers, tubes extruded along a sloping path).
//
// There is exactly one source of truth: the Master controller bound with
// bindMasterController(). Before binding (unit tests, tools) Master equals the
// base, so every factor is 1 and nothing changes.
//
// FOR OTHER MODULES (how to place a true-proportion thing):
//   * A static object whose local origin is its pivot (base or centre) and has
//     no rotation above that pivot: bindTrueProportion(obj). Position it at the
//     canonical landscape point (for example getSurfaceY(), or a depth x VE).
//   * A moving object whose pose is recomputed each frame:
//     composeTrueProportionMatrix(out, position, quaternion, scale), with the
//     heading taken from displayDirection() so it points along what is drawn.
//     A parent Group with scale.y = structureYScale() and the rotation on a
//     child gives the same result (that is how sea-life.js roots creatures).
//   * Instanced geometry with translation-only instance matrices, or a mesh
//     with no rotation: patchTrueProportionMaterial(mat, { mode: 'local' }).
//   * A tube or ribbon extruded along a path: store each vertex's axis height
//     (setAxisAttribute / tubeAxisAttribute) and patch its material with
//     { mode: 'axis' }. The cross-section is drawn true and round about its
//     own centreline while the centreline itself follows the stretched depth.
//   * Geometry authored at canonical VE (heights already x5): pass
//     { authoredVE: 5 } or use structureHeightScale() (= 1 / Master), the value
//     the building shader and the layers' setHeightScale(value) take.
import * as THREE from 'three';

export const MASTER_BASE = 5;

const state = { master: MASTER_BASE, base: MASTER_BASE };
const listeners = new Set();
const bound = new Set();

/** Shared shader uniform: canonical Y factor for real-metre geometry (base / Master). */
export const trueProportionUniform = { value: 1 };

/** Current Master height as the structures see it. */
export function currentMaster() { return state.master; }
/** display y = canonical y x masterRatio(). */
export function masterRatio() { return state.master / state.base; }
/**
 * Canonical vertical scale that shows geometry authored at `authoredVE` times
 * its real height at exactly its real height: base / (Master x authoredVE).
 */
export function structureYScale(authoredVE = 1) {
  return state.base / (state.master * authoredVE);
}
/** The D-023 height-scale value (VE-authored geometry): 1 / Master for VE5. */
export function structureHeightScale() { return structureYScale(state.base); }

function publish(master, base) {
  if (!Number.isFinite(master) || master <= 0) return;
  state.master = master;
  if (Number.isFinite(base) && base > 0) state.base = base;
  trueProportionUniform.value = structureYScale(1);
  for (const o of bound) o.scale.y = structureYScale(o.userData.trueProportionVE ?? 1);
  for (const fn of listeners) {
    try { fn(state.master, structureYScale(1)); } catch (err) { console.warn('[true-proportion] listener failed', err); }
  }
}

/**
 * Make `controller` (vertical-scale.js) the single source of Master for every
 * structure. Returns an unbind function. Only the app's own camera binds.
 */
export function bindMasterController(controller) {
  if (!controller || typeof controller.onChange !== 'function') throw new TypeError('bindMasterController needs a vertical-scale controller');
  const off = controller.onChange((value) => publish(value, controller.base));
  publish(controller.value, controller.base);
  return () => { off(); publish(MASTER_BASE, MASTER_BASE); };
}

/** Called with (master, structureYScale()) after every Master change. Returns unsubscribe. */
export function onMasterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Keep `object` at true proportions: scale.y follows Master for as long as the
 * object is bound. Its local origin is the pivot; position it at the canonical
 * landscape point. Horizontal scale is left alone.
 */
export function bindTrueProportion(object, { authoredVE = 1 } = {}) {
  object.userData.trueProportionVE = authoredVE;
  object.scale.y = structureYScale(authoredVE);
  bound.add(object);
  return () => bound.delete(object);
}

/**
 * The shared helper for other lanes: place a true-proportion object at a
 * stretched landscape position (canonical coordinates) and keep it true.
 */
export function placeTrueProportion(object, position, options) {
  object.position.copy(position);
  return bindTrueProportion(object, options);
}

const _s = new THREE.Matrix4(), _r = new THREE.Matrix4(), _v = new THREE.Vector3();
/**
 * out = T(position) . S_y(structureYScale(authoredVE)) . R(quaternion) . S(scale).
 * The vertical unscale acts in WORLD (canonical) axes after the rotation, so a
 * pitched or banked body keeps its real shape on screen. Use displayDirection()
 * for the heading so the body points along the displayed path.
 */
export function composeTrueProportionMatrix(out, position, quaternion, scale = null, { authoredVE = 1 } = {}) {
  _r.makeRotationFromQuaternion(quaternion);
  if (scale) _r.scale(scale);
  _s.makeScale(1, structureYScale(authoredVE), 1);
  out.multiplyMatrices(_s, _r);
  out.elements[12] = position.x; out.elements[13] = position.y; out.elements[14] = position.z;
  return out;
}

/** A canonical direction as the viewer sees it (y x Master ratio); not normalised. */
export function displayDirection(canonical, out = _v) {
  return out.set(canonical.x, canonical.y * masterRatio(), canonical.z);
}

// ── Shader path ────────────────────────────────────────────────────────────

const AXIS_ATTRIBUTE = 'trueAxisY';

/**
 * Store each vertex's axis height (canonical y of the centreline point its
 * cross-section is built around). `axisY` has one entry per vertex.
 */
export function setAxisAttribute(geometry, axisY) {
  const count = geometry.attributes.position.count;
  if (axisY.length !== count) throw new RangeError(`axis attribute needs ${count} values, got ${axisY.length}`);
  geometry.setAttribute(AXIS_ATTRIBUTE, new THREE.BufferAttribute(Float32Array.from(axisY), 1));
  return geometry;
}

/**
 * Axis heights for a TubeGeometry-shaped layout: rings of `ringSize`
 * vertices (radialSegments + 1, the last duplicating the first). Each ring's
 * centre is the mean of its distinct vertices, exact for a regular ring.
 */
export function tubeAxisAttribute(geometry, ringSize = (geometry.parameters?.radialSegments ?? 8) + 1) {
  const p = geometry.attributes.position, n = p.count;
  if (n % ringSize) throw new RangeError('vertex count is not a whole number of rings');
  const axis = new Float32Array(n), distinct = ringSize - 1;
  for (let r = 0; r < n; r += ringSize) {
    let sum = 0;
    for (let j = 0; j < distinct; j++) sum += p.getY(r + j);
    const c = sum / distinct;
    for (let j = 0; j < ringSize; j++) axis[r + j] = c;
  }
  geometry.setAttribute(AXIS_ATTRIBUTE, new THREE.BufferAttribute(axis, 1));
  return geometry;
}

/**
 * Inject the vertical unscale into a built-in material. Chains any existing
 * onBeforeCompile (haze, masks) and program cache key.
 *   mode 'local': local y x factor, about the object's (or instance's) origin.
 *   mode 'axis' : y = axis + (y - axis) x factor, per vertex (trueAxisY).
 * Normals are corrected so lighting sees the true shape.
 */
export function patchTrueProportionMaterial(material, { mode = 'local' } = {}) {
  if (material.userData.trueProportion) return material;
  if (mode !== 'local' && mode !== 'axis') throw new RangeError(`unknown true-proportion mode ${mode}`);
  material.userData.trueProportion = mode;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    if (previous) previous.call(this, shader, renderer);
    shader.uniforms.uTrueY = trueProportionUniform;
    const decl = mode === 'axis' ? `uniform float uTrueY;\nattribute float ${AXIS_ATTRIBUTE};` : 'uniform float uTrueY;';
    const move = mode === 'axis'
      ? `transformed.y = ${AXIS_ATTRIBUTE} + ( transformed.y - ${AXIS_ATTRIBUTE} ) * uTrueY;`
      : 'transformed.y *= uTrueY;';
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${decl}`);
    vs = vs.replace('#include <project_vertex>', `${move}\n#include <project_vertex>`);
    if (vs.includes('#include <defaultnormal_vertex>')) {
      vs = vs.replace('#include <defaultnormal_vertex>',
        'objectNormal = normalize( vec3( objectNormal.x, objectNormal.y / max( uTrueY, 1e-4 ), objectNormal.z ) );\n#include <defaultnormal_vertex>');
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = function () {
    return `${previousKey ? previousKey.call(this) : ''}|trueY:${mode}`;
  };
  material.needsUpdate = true;
  return material;
}

// ── True sizes ─────────────────────────────────────────────────────────────
//
// Internal bore diameters (metres), approximate and sourced from published
// figures: the standard deep-level tube 11 ft 8.25 in (3.56 m); the Victoria
// line 12 ft 6 in (3.81 m); the Jubilee line extension 4.35 m; the Elizabeth
// line 6.2 m; the DLR's bored tunnels (Bank, Lewisham and Woolwich) about 5.2 m;
// sub-surface lines are cut-and-cover boxes about 4.6 m high, drawn here as a
// bore of that height per track.
export const BORE_DIAMETER_M = Object.freeze({
  bakerloo: 3.56, central: 3.56, northern: 3.56, piccadilly: 3.56, 'waterloo-city': 3.56,
  victoria: 3.81, jubilee: 4.35,
  circle: 4.6, district: 4.6, 'hammersmith-city': 4.6, metropolitan: 4.6,
  dlr: 5.2, elizabeth: 6.2,
});
export const DEFAULT_BORE_DIAMETER_M = 3.56;
/** True bore radius for a line (metres, drawn round at every Master). */
export function boreRadiusM(lineId) {
  return (BORE_DIAMETER_M[lineId] ?? DEFAULT_BORE_DIAMETER_M) / 2;
}
