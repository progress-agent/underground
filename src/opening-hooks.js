// opening-hooks.js — what lane V's previews import (sprint 21Oct26w, lane L; the four hooks of L/design.md section 4).
// Production builds carry it too (a preview has no window.__ug). All four are inert in the default opening.
//
//   1. buildOrder      { origin: {x, z} } | { order: number[] } | null  (default null), read once when the baked
//                      city's builder is created; completeRadius(origin) answers how far the build has reached
//   2. lateLayers      the registry of layers built after landing (src/late-layers.js): snapshot(), request(id),
//                      whenAttached(id), settled(); events ug:late-layer and ug:late-layers-done
//   3. gate            the opening gate: gate.readiness.snapshot() (id, weight, progress, status, settle time) and
//                      gate.getState().stage ('loading' | 'compiling' | 'warming' | 'reveal' | 'done'), gate.stage()
//   4. landingLock     isOpen() / whenOpen() / lockY(x, z): the camera may pass 300 m above the crossing only once
//                      everything the landing needs is built and uploaded (the gate's stage is 'done'); the event
//                      ug:landing-lock fires once, as the descent begins
//
// main.js registers the live objects; until it has, every accessor answers as a closed, empty opening.

export const LANDING_LOCK_M = 300;
const VE_DEFAULT = 5;

export function createOpeningHooks() {
  const live = { gate: null, lateLayers: null, getBuilder: () => null, getSurfaceY: () => null, VE: VE_DEFAULT, bypassed: () => false };
  let openPromise = null;

  const landingLock = {
    /** True once the gate has finished (every item settled, shaders compiled, warm-up frames rendered) or on a deep link. */
    isOpen() { return live.bypassed() || live.gate?.stage?.() === 'done'; },
    /** Resolves when the lock opens (at once if it already has). */
    whenOpen() {
      if (landingLock.isOpen()) return Promise.resolve();
      return (openPromise ||= new Promise((resolve) => {
        const done = () => { window.removeEventListener('ug:landing-lock', done); resolve(); };
        window.addEventListener('ug:landing-lock', done);
      }));
    },
    /** The height (scene units) the camera may not pass below at (x, z) while the lock is shut: the surface plus 300 m. */
    lockY(x, z) {
      const y = live.getSurfaceY({ x, z });
      return Number.isFinite(y) ? y + LANDING_LOCK_M * live.VE : null;
    },
  };

  const hooks = {
    /** Hook 1. Read once, when the baked builder is created; null keeps tile index order. */
    buildOrder: null,
    /** Hook 1: the distance about `origin` within which every tile is built (0 before the builder exists). */
    completeRadius(origin) { const b = live.getBuilder(); return b ? b.completeRadius(origin) : 0; },
    /** Hook 2. */
    get lateLayers() { return live.lateLayers; },
    /** Hook 3. */
    get gate() { return live.gate; },
    /** Hook 4. */
    landingLock,
    /** main.js only. */
    register(parts) { Object.assign(live, parts); return hooks; },
  };
  return hooks;
}

export const openingHooks = createOpeningHooks();
