// Shadow-map cache (sprint 24Sep26h, Lane R, D-038).
//
// sun.js requests a shadow-map render on every frame the shadows are active.
// Every shadow caster is static (buildings, landmarks, bridges and airport
// architecture: sun.js applyShadowPolicy); nothing that moves casts. So while
// the light, its fitted shadow camera, the structure height and the set of
// casters are unchanged, the re-rendered map would be byte-identical to the
// one already in the texture. This skips exactly those renders.
//
// Called right after sunSystem.update() each frame. It never requests a
// render sun.js did not ask for; it only withdraws a redundant one.

const MATRIX_EPS = 0; // exact: the fit is texel-snapped, a still camera repeats it bit for bit

// ── s16:R ── shadowFloat (sprint 16Oct26f, D-054): the GPU receives the light's position and target as float32, and
// the shadow camera is a function of those two points, so two float64 values that round to the same float32 give it
// the same map (to the last bit of a rotation element that should be zero: 1e-17, measured). At a still camera the fit's
// snapped target alternated in its last float64 bit (5175.2055123301 / 5175.205512330101; OrbitControls rebuilds the
// camera position from spherical coordinates every frame, R/measure/shadow-wobble.mjs), which the exact comparison read
// as a change and re-rendered the whole shadow map (about 1 ms on the weak setup) on 60 frames of 60. The camera's own
// derived matrices are not compared: their near-zero elements carry float noise of that size and would read as a change
// on three frames in four. Off, the comparison is exactly the 07391f3 one.
const same32 = Math.fround;
// ── /s16:R ──
function sameArray(a, b, float32 = false) {
  if (!a || a.length !== b.length) return false;
  if (float32) { for (let i = 0; i < a.length; i++) if (Math.abs(same32(a[i]) - same32(b[i])) > MATRIX_EPS) return false; return true; } // s16:R
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > MATRIX_EPS) return false;
  return true;
}

export function createShadowCache({ renderer, light }) {
  let last = null;        // signature of the map currently in the texture
  let casterKey = '';
  let float32 = false;    // s16:R: shadowFloat
  const stats = { requested: 0, rendered: 0, skipped: 0 };

  function signature({ heightScale, casterVersion }) {
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    return {
      light: Array.from(light.matrixWorld.elements),
      target: Array.from(light.target.matrixWorld.elements),
      frustum: [cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far],
      mapSize: [light.shadow.mapSize.x, light.shadow.mapSize.y],
      bias: [light.shadow.bias, light.shadow.normalBias],
      heightScale, casterVersion,
    };
  }

  function same(a, b) {
    const f = float32; // s16:R
    return a && b && sameArray(a.light, b.light, f) && sameArray(a.target, b.target, f)
      && sameArray(a.frustum, b.frustum) && sameArray(a.mapSize, b.mapSize) && sameArray(a.bias, b.bias)
      && a.heightScale === b.heightScale && a.casterVersion === b.casterVersion;
  }

  /**
   * enabled: the economy flag. active: sun.js shadows are drawing this frame.
   * casterVersion: any value that changes whenever a caster is added, removed,
   * rebuilt or re-flagged (see casterVersionOf). heightScale: Structure height.
   * settled: false while casters are still streaming in (always render then).
   */
  function update({ enabled = true, active, heightScale, casterVersion, settled = true }) {
    if (!active || !light.castShadow) { last = null; return false; }
    if (!renderer.shadowMap.needsUpdate) return false;
    stats.requested++;
    const sig = signature({ heightScale, casterVersion });
    if (enabled && settled && same(sig, last) && light.shadow.map) {
      renderer.shadowMap.needsUpdate = false;
      stats.skipped++;
      return true;
    }
    last = settled ? sig : null;
    stats.rendered++;
    return false;
  }

  return { update, stats, invalidate() { last = null; }, get casterKey() { return casterKey; },
    // s16:R: shadowFloat on or off; a change of mode forgets the last signature (its shape differs)
    setFloat32(on) { const next = !!on; if (next !== float32) { float32 = next; last = null; } return float32; },
    get float32() { return float32; } };
}

/** Cheap caster-set fingerprint: ids, visibility and cast flags of the direct
 * children of the roots that hold casters. Tile streaming, a rebuilt landmark
 * or a changed shadow policy all change it. */
export function casterVersionOf(roots) {
  let h = 0;
  for (const root of roots) {
    if (!root) continue;
    h = (h * 31 + root.id + (root.visible ? 7 : 3)) | 0;
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      h = (h * 31 + o.id * 2 + (o.visible ? 1 : 0) + (o.castShadow ? 4 : 0) + (o.count ?? 0)) | 0;
    }
    h = (h * 31 + kids.length) | 0;
  }
  return h;
}
