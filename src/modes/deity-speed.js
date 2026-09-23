// deity-speed.js: the Deity keyboard speed regime as a pure function
// (sprint 23Sep26w, D-037, lane A1). main.js updateFpsControls calls it; tests
// pin it without a browser.
//
// D-002 (locked): above ground, horizontal reach scales with real altitude,
// clamp(alt / 500m, 0.3, 20) x base, so low flying is precise and high flying
// covers ground fast. Below ground: constant base.
//
// WATER (D-037, supersedes D-020 §3). Measured 24Sep26h at a fixed Thames point
// (Cutty Sark reach, x=8161 z=2340, bed -12m, W held along the channel):
// submerged 500 m/s against 150 m/s just above the surface, 3.33x. D-020 §3 had
// given the water column the underground constant base to escape the 0.3x
// crawl over the carved bed, which is exactly what made underwater feel ~3x
// faster. Jordan's rule: underwater speed equals speed anywhere else, matching
// the speed just above the surface at the same point. So a submerged camera
// takes the regime evaluated AT the water surface: continuous across the
// surface, and the same everywhere in the column beneath it.

export const ALT_REF_M = 500;
export const ALT_CLAMP_MIN = 0.3;
export const ALT_CLAMP_MAX = 20;

/**
 * @param {object} p
 * @param {number} p.moveSpeed       base speed (scene units / s)
 * @param {number} p.y               camera Y (canonical scene units)
 * @param {number|null} p.surfaceY   terrain mesh Y at the camera (the carved bed in the river), or null
 * @param {boolean} p.submerged      shared inside-water predicate at the camera
 * @param {number|null} p.waterSurfaceY  water-top Y at the camera XZ (null when unknown)
 * @param {number} p.VE              vertical exaggeration (5)
 * @returns {number} regime speed before sprint and substrate factors
 */
export function deityRegimeSpeed({ moveSpeed, y, surfaceY, submerged, waterSurfaceY, VE }) {
  let refY = y;
  if (submerged) {
    // Unknown water top: keep the historical constant base rather than guess.
    if (!Number.isFinite(waterSurfaceY)) return moveSpeed;
    refY = waterSurfaceY;
  }
  if (surfaceY === null || surfaceY === undefined || !Number.isFinite(surfaceY) || refY < surfaceY) return moveSpeed;
  const alt = (refY - surfaceY) / VE; // real metres
  return moveSpeed * Math.min(ALT_CLAMP_MAX, Math.max(ALT_CLAMP_MIN, alt / ALT_REF_M));
}
