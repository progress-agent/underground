// registry.js: conveyance-mode controller registry (sprint 23Sep26w, D-037,
// lane A1). Pure logic, no DOM, so it runs under node tests.
//
// ─── MODE CONTRACT (what src/modes/pedestrian.js, drone.js, balloon.js export) ─
//
//   {
//     id:    'drone',                      unique id
//     label: 'Drone',                      shown in the HUD picker
//     key:   '3',                          digit that selects it
//     hint:  'W thrust · mouse steer',     one-line key hint shown while active
//     look:  'lock' | 'drag' | 'none',     pointer handling the registry sets up
//                                          ('none' leaves OrbitControls in charge)
//     solid: true,                         collides with buildings (Deity: false)
//     stub:  false,                        true while the mode is a placeholder
//     activate(ctx, fromId)                optional; take the camera over here
//     deactivate(ctx, toId)                optional; hand everything back here
//     update(dt, ctx) -> boolean           every frame while active. Return TRUE
//                                          when this mode owns the camera this
//                                          frame (Deity's keyboard code is then
//                                          skipped and OrbitControls is held off);
//                                          FALSE to fall back to Deity behaviour.
//     onLook(dx, dy, ctx)                  optional; pointer-lock / drag deltas (CSS px)
//   }
//
//   ctx is the shared world context built in src/modes/index.js (camera,
//   controls, keys, collision, physics, sfx, wind, sliders, time ...). Modes
//   must treat it as read-mostly and keep their own state in their closure.
//
// Timing: update() receives the same capped interactive dt the Deity keyboard
// gets (50ms ceiling, D-027); ctx.time is the sum of those, so anything a mode
// animates is a deterministic function of elapsed time.

export const MODE_ORDER = Object.freeze(['deity', 'pedestrian', 'drone', 'balloon']);

export function createModeRegistry({ ctx = {}, onLookMode = () => {}, onSilence = () => {} } = {}) {
  const modes = new Map();
  const listeners = new Set();
  let active = null;

  function validate(mode) {
    if (!mode || typeof mode.id !== 'string' || !mode.id) throw new TypeError('mode needs an id');
    if (typeof mode.update !== 'function') throw new TypeError(`mode "${mode.id}" needs update(dt, ctx)`);
    if (!['lock', 'drag', 'none'].includes(mode.look ?? 'none')) throw new RangeError(`mode "${mode.id}" look`);
  }

  function register(mode) {
    validate(mode);
    if (mode.key) {
      for (const m of modes.values()) {
        if (m.key === mode.key && m.id !== mode.id) throw new Error(`key ${mode.key} already used by "${m.id}"`);
      }
    }
    const replacing = modes.get(mode.id);
    modes.set(mode.id, mode);
    // Replacing the ACTIVE mode (a stub swapped for the real thing at runtime)
    // re-activates cleanly.
    if (replacing && active === replacing) {
      active = null;
      try { replacing.deactivate?.(ctx, mode.id); } catch (err) { console.warn('[modes]', err); }
      activate(mode.id);
    }
    return mode;
  }

  function activate(id) {
    const next = modes.get(id);
    if (!next) return false;
    if (next === active) return true;
    const prev = active;
    try { prev?.deactivate?.(ctx, id); } catch (err) { console.warn(`[modes] ${prev.id}.deactivate`, err); }
    onSilence();
    active = next;
    onLookMode(next.look ?? 'none');
    try { next.activate?.(ctx, prev?.id ?? null); } catch (err) { console.warn(`[modes] ${next.id}.activate`, err); }
    for (const fn of listeners) { try { fn(next.id, prev?.id ?? null); } catch (err) { console.warn('[modes]', err); } }
    return true;
  }

  function byKey(key) {
    for (const m of modes.values()) if (m.key === key) return m.id;
    return null;
  }

  /** @returns {boolean} true when the active mode owns the camera this frame. */
  function update(dt) {
    if (!active) return false;
    ctx.time = (ctx.time || 0) + dt;
    try {
      return active.update(dt, ctx) === true;
    } catch (err) {
      // A throwing mode must never kill requestAnimationFrame (the train
      // curve lesson): fall back to Deity for this frame and say so once.
      if (!active._warned) { console.warn(`[modes] ${active.id}.update threw; Deity fallback`, err); active._warned = true; }
      return false;
    }
  }

  function look(dx, dy) {
    try { active?.onLook?.(dx, dy, ctx); } catch (err) { console.warn('[modes] onLook', err); }
  }

  return {
    register,
    activate,
    deactivate: () => activate('deity'),
    update,
    look,
    byKey,
    get: (id) => modes.get(id),
    list: () => [...modes.values()].sort((a, b) => {
      const ia = MODE_ORDER.indexOf(a.id), ib = MODE_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }),
    get active() { return active; },
    get activeId() { return active?.id ?? null; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ctx,
  };
}
