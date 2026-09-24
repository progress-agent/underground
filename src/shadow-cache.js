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

function sameArray(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > MATRIX_EPS) return false;
  return true;
}

export function createShadowCache({ renderer, light }) {
  let last = null;        // signature of the map currently in the texture
  let casterKey = '';
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
    return a && b && sameArray(a.light, b.light) && sameArray(a.target, b.target)
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

  return { update, stats, invalidate() { last = null; }, get casterKey() { return casterKey; } };
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
