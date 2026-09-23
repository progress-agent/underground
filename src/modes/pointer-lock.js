// pointer-lock.js: look input for the conveyance modes (sprint 23Sep26w,
// D-037, lane A1).
//
// Jordan's ruling: Pedestrian and Drone use pointer-lock mouse look (click the
// canvas to capture, Esc frees the cursor for hover and the minimap); Balloon
// keeps drag-to-look with a free cursor. Deity keeps OrbitControls untouched,
// so the registry sets 'none' for it and this helper does nothing at all.
//
// ─── API ────────────────────────────────────────────────────────────────────
//
//   const look = createLookInput({ element: renderer.domElement, onLook(dx, dy) {} });
//   look.setMode('none' | 'drag' | 'lock')
//     none  no listeners act; OrbitControls (Deity) owns the mouse.
//     drag  left-drag on the canvas reports movement; cursor stays free.
//     lock  a click on the canvas requests pointer lock; while locked every
//           mouse movement reports. While NOT locked (before the first click,
//           or after Esc), drag-to-look still works, so the view is never
//           stranded.
//   look.isLocked()     true while this element holds pointer lock
//   look.exit()         release pointer lock (also called on setMode away from 'lock')
//   look.onLockChange(fn)  fn(locked) whenever lock is gained or lost; returns unsubscribe
//   look.dispose()
//
// dx / dy are CSS pixels as the browser reports movementX / movementY; the
// mode applies its own sensitivity. Esc needs no handler here: the browser
// releases pointer lock on Esc itself and we observe pointerlockchange.

export function createLookInput({ element, onLook = () => {}, document = globalThis.document } = {}) {
  let mode = 'none';
  let dragging = false;
  let pointerId = null;
  const lockListeners = new Set();
  const isLocked = () => !!document && document.pointerLockElement === element;

  function report(e) {
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (dx || dy) onLook(dx, dy);
  }

  const onClick = (e) => {
    if (mode !== 'lock' || isLocked() || e.button !== 0) return;
    try {
      const p = element.requestPointerLock?.();
      // Chrome returns a promise that rejects if the gesture is refused
      // (e.g. straight after an Esc); drag look remains available.
      p?.catch?.(() => {});
    } catch { /* unsupported: drag look remains */ }
  };
  const onPointerDown = (e) => {
    if (mode === 'none' || isLocked() || e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
  };
  const onPointerMove = (e) => {
    if (mode === 'none') return;
    if (isLocked()) { report(e); return; }
    if (dragging && (e.buttons & 1) && (pointerId === null || e.pointerId === pointerId)) report(e);
  };
  const endDrag = () => { dragging = false; pointerId = null; };
  const onLockChange = () => {
    endDrag();
    const locked = isLocked();
    for (const fn of lockListeners) { try { fn(locked); } catch (err) { console.warn('[look]', err); } }
  };

  if (element?.addEventListener) {
    element.addEventListener('click', onClick);
    element.addEventListener('pointerdown', onPointerDown);
  }
  // Locked movement is delivered to the document, not the element.
  document?.addEventListener?.('pointermove', onPointerMove);
  document?.addEventListener?.('pointerup', endDrag);
  document?.addEventListener?.('pointercancel', endDrag);
  document?.addEventListener?.('pointerlockchange', onLockChange);
  globalThis.addEventListener?.('blur', endDrag);

  function exit() {
    if (isLocked()) { try { document.exitPointerLock(); } catch { /* ignore */ } }
  }

  return {
    setMode(next) {
      if (!['none', 'drag', 'lock'].includes(next)) throw new RangeError(`look mode "${next}"`);
      if (next !== 'lock') exit();
      endDrag();
      mode = next;
    },
    get mode() { return mode; },
    isLocked,
    exit,
    onLockChange(fn) { lockListeners.add(fn); return () => lockListeners.delete(fn); },
    dispose() {
      exit();
      element?.removeEventListener?.('click', onClick);
      element?.removeEventListener?.('pointerdown', onPointerDown);
      document?.removeEventListener?.('pointermove', onPointerMove);
      document?.removeEventListener?.('pointerup', endDrag);
      document?.removeEventListener?.('pointercancel', endDrag);
      document?.removeEventListener?.('pointerlockchange', onLockChange);
      globalThis.removeEventListener?.('blur', endDrag);
    },
  };
}
