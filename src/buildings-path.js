// Which building path a visit uses (sprint 02Oct26f, Lane F; D-048 item 6).
//
// The baked city is the default; the live per-tile path stays as the automatic
// fallback (a failed payload or footprint companion falls back inside main.js)
// and as an explicit choice.
//
//   - ?buildings=baked or ?buildings=live wins for the visit and is never saved.
//   - Otherwise the saved HUD choice decides, EXCEPT that a 'live' saved before
//     this release is dropped once. Until now "live" was the default, and a
//     browser that ever pressed the toggle (or visited with an old link) holds
//     a saved 'live' it never chose for itself. The saved settings carry a
//     revision marker (buildingsPathRev); a browser without the current marker
//     has its saved 'live' deleted and the marker written, once. A choice made
//     with the HUD after that writes the marker with it (setBuildingsPath), so
//     it persists.

export const BUILDINGS_PATH_REV = 2;

/**
 * @param {string|null|undefined} urlValue the ?buildings= value, if any
 * @param {object} prefs the saved settings object (mutated when migrated)
 * @returns {{ path: 'baked'|'live', migrated: boolean }} `migrated` means the
 *   caller must save the settings.
 */
export function resolveBuildingsPath(urlValue, prefs) {
  const saved = prefs ?? {};
  let migrated = false;
  if (saved.buildingsPathRev !== BUILDINGS_PATH_REV) {
    if (saved.buildingsPath === 'live') delete saved.buildingsPath;
    saved.buildingsPathRev = BUILDINGS_PATH_REV;
    migrated = true;
  }
  if (urlValue === 'baked' || urlValue === 'live') return { path: urlValue, migrated };
  return { path: saved.buildingsPath === 'live' ? 'live' : 'baked', migrated };
}
