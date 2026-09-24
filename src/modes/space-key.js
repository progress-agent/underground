// space-key.js: Space belongs to the flight while a mode binds it (sprint
// 24Sep26h, D-038, lane H).
//
// Drone (rise), Balloon (burner) and Pedestrian (jump / jetpack) use Space.
// The browser also uses Space to press a focused button or toggle a <summary>,
// and after any click on the mode bar or the settings HUD the clicked button
// keeps focus. Without a guard, rising in Drone re-pressed that button.
//
// The guard cancels the browser's default for a plain Space only while a mode
// that binds it is active, and never:
//   - in a form field (typing a space, toggling a checkbox), matching the
//     isFormInput policy every key handler here already follows;
//   - inside an element that keeps keys to itself (the Physics panel stops
//     key propagation so its controls never fly the camera, so Space there is
//     not a flight key and must still press the panel's own buttons);
//   - with a modifier held.
// In Deity nothing binds Space, so a focused button still presses as normal.

export const KEY_OWNING_SELECTOR = '#ug-physics-panel';

export function isFormInput(target) {
  return !!(target?.matches?.('input, select, textarea') || target?.isContentEditable);
}

/** True when a Space event should drive the active mode, not the focused element. */
export function modeClaimsSpace(e) {
  if (e?.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target;
  if (isFormInput(t)) return false;
  if (t?.closest?.(KEY_OWNING_SELECTOR)) return false;
  return true;
}

/**
 * A capture-phase keydown/keyup listener pair, switched on while a mode that
 * binds Space is active. Keyup is covered as well because some engines press
 * a button on Space keyup.
 */
export function createSpaceGuard(target = globalThis) {
  let on = false;
  const onKey = (e) => { if (modeClaimsSpace(e)) e.preventDefault(); };
  return {
    set(next) {
      next = !!next;
      if (next === on || !target?.addEventListener) return;
      on = next;
      for (const type of ['keydown', 'keyup']) {
        if (on) target.addEventListener(type, onKey, true);
        else target.removeEventListener(type, onKey, true);
      }
    },
    get active() { return on; },
  };
}
