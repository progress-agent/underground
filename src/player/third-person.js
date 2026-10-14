// third-person.js: the pieces every body's third-person view shares (sprint 14Oct26w, lane P, D-053 item 3):
// the V key, the wheel and trackpad-pinch zoom, the lens, and the camera blend. The Pedestrian binding
// (on-foot.js) uses them now; lane D uses them for the Drone and the Balloon.

export const LENS_THIRD_MM = 22;
export const BLEND_S = Object.freeze({ key: 0.35, forced: 0.35, auto: 0.6 });
export const ZOOM = Object.freeze({ perPx: 0.0015, pinchPerPx: 0.01, minStep: 0.5, maxStep: 2 });

export const easeOutCubic = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function isFormInput(target) {
  return target?.matches?.('input, select, textarea') || target?.isContentEditable;
}

/** Zoom factor for one wheel event: negative deltaY brings the camera closer. Pure. */
export function wheelZoomFactor({ deltaY = 0, deltaMode = 0, ctrlKey = false }) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = ctrlKey ? ZOOM.pinchPerPx : ZOOM.perPx;
  return Math.min(ZOOM.maxStep, Math.max(ZOOM.minStep, Math.exp(px * k)));
}

/**
 * V: a keydown listener (no modifiers, not a repeat, not in a form). onPress runs only while isActive().
 * Returns an off() function.
 */
export function installViewKey({ isActive, onPress, target = globalThis }) {
  const fn = (e) => {
    if (!isActive() || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isFormInput(e.target)) return;
    if (String(e.key).toLowerCase() !== 'v') return;
    onPress(e);
  };
  target.addEventListener?.('keydown', fn);
  return () => target.removeEventListener?.('keydown', fn);
}

/**
 * A NON-PASSIVE wheel listener on the canvas. Chrome delivers a trackpad pinch as a wheel event with ctrlKey
 * true and zooms the page unless preventDefault is called, which only a non-passive listener may do. Every
 * ctrlKey wheel is cancelled while the body is active; in third person every wheel is (it is the zoom). The
 * event is never stopped: other listeners still see it.
 */
export function installWheelZoom({ canvas, isActive, isThird, zoom }) {
  const fn = (e) => {
    if (!isActive()) return;
    const third = isThird();
    if (e.ctrlKey || third) e.preventDefault();
    if (third) zoom(wheelZoomFactor(e));
  };
  canvas?.addEventListener?.('wheel', fn, { passive: false });
  return () => canvas?.removeEventListener?.('wheel', fn);
}
