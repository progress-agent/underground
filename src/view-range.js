// The camera's depth range follows its height (sprint 02Oct26f, Lane F; D-048
// item 8, the second limit).
//
// Near the ground nothing changes: near 1, far 50000, the 1:50000 ratio the
// project depends on for depth precision. The far plane is in DISPLAY space,
// so a Master-stretched view of the ground below needs far >= the display
// height times about 2.4 (the corner ray of a 55 degree, 16:9 frame pitched 60
// degrees down meets the ground 2.4 heights away). Master 3 at 20 km on the
// altimeter is 60,000 display units up, which a fixed 50,000 far plane cannot
// reach: the map would be missing from the frame.
//
// So above RANGE_FROM_H display units of height the far plane grows with the
// height (2.5 x h) and near grows with it, keeping the same 1:50000 ratio, so
// depth precision at a given angle is unchanged. There is no climb ceiling.
// Fog distances scale by the same factor (environment.js reads
// camera.far / BASE_FAR), or the map seen from up there would be pure haze.

export const BASE_NEAR = 1;
export const BASE_FAR = 50000;
/** Display height (units above Ordnance Datum) up to which the range is the base one. */
export const RANGE_FROM_H = 20000;
/** Far plane per unit of display height once above RANGE_FROM_H. */
export const FAR_PER_H = 2.5;

/** The depth range for a display height `h`; `scale` is far / BASE_FAR (1 at or below RANGE_FROM_H). */
export function viewRangeFor(h) {
  if (!(h > RANGE_FROM_H)) return { near: BASE_NEAR, far: BASE_FAR, scale: 1 };
  const far = FAR_PER_H * h;
  return { near: far / (BASE_FAR / BASE_NEAR), far, scale: far / BASE_FAR };
}

/**
 * Keeps `camera.near/far` at the range for the camera's display height.
 * `masterHeight` is the vertical-scale controller (its `ratio` converts canonical
 * to display height). Call `update()` once a frame, before anything reads the range.
 *
 * Near is touched only while the camera is above RANGE_FROM_H, and restored to
 * BASE_NEAR on the way down only if it still holds the value this module set
 * (Pedestrian mode sets its own near).
 */
export function createViewRange(camera, masterHeight) {
  let setNear = null;     // the near this module last wrote while above RANGE_FROM_H
  let appliedFar = camera.far;
  function update() {
    const h = Math.max(0, camera.position.y) * (masterHeight?.ratio ?? 1);
    const range = viewRangeFor(h);
    let changed = false;
    if (h > RANGE_FROM_H) {
      // Re-project only when the far plane moved by more than half a percent.
      if (Math.abs(range.far - appliedFar) > 0.005 * appliedFar || setNear === null) {
        camera.far = range.far; camera.near = range.near;
        appliedFar = range.far; setNear = range.near; changed = true;
      }
    } else {
      if (camera.far !== BASE_FAR) { camera.far = BASE_FAR; changed = true; }
      appliedFar = BASE_FAR;
      if (setNear !== null) {
        if (camera.near === setNear) { camera.near = BASE_NEAR; changed = true; }
        setNear = null;
      }
    }
    if (changed) camera.updateProjectionMatrix();
    return range;
  }
  return { update, get applied() { return { near: camera.near, far: camera.far }; } };
}
