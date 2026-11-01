// touch-ui.js: the phone layout (D-058, 01Nov26u). Supersedes D-001 §3 (landscape
// lock) and D-001's no-joystick rule on touch devices only; desktop is unchanged.
//
// Every control here speaks keys. The thumbstick and the buttons dispatch the
// same synthetic KeyboardEvents the controls guide has used since D-001 §7, so
// each body's existing keyboard code (main.js's held-key Set, Space latches, V,
// B, T, E) runs untouched and nothing in src/modes/ knows about touch.
//
//   isTouchDevice()            coarse pointer and no hover; ?touch=1 / ?touch=0 force it (tests, desktop preview)
//   installTouchUi({ registry, canvas })
//     mode bar      bottom centre in portrait, top centre in landscape (the bottom edge is the thumbs'), one pill per mode
//     thumbstick    left lower zone, appears where the thumb lands, in every mode (Deity flies on W/A/S/D as on a
//                   keyboard; one-finger pan and pinch still own the rest of the screen); 8-way W/A/S/D past a dead zone
//     buttons       right side, per mode (BUTTONS below); held for as long as the finger is down, except Fast, which
//                   latches Shift (sprint / boost / fast flight) so the right thumb stays free; the stick ring turns gold
//     pinch zoom    two fingers on the view in a body mode send wheel events (third-person zoom listens for wheel)
//   Drag to look needs nothing here: the look input already takes a one-finger drag on the canvas
//   (pointer-lock.js computes touch deltas from clientX/Y because iOS leaves movementX at 0).

const STYLE_ID = 'ug-touch-styles';
const ROOT_ID = 'ug-touch';

const SHORT_LABEL = { deity: 'Deity', pedestrian: 'Walk', drone: 'Drone', balloon: 'Balloon' };

// key: KeyboardEvent.key, code: KeyboardEvent.code
const K = {
  space: { key: ' ', code: 'Space' },
  q: { key: 'q', code: 'KeyQ' },
  e: { key: 'e', code: 'KeyE' },
  b: { key: 'b', code: 'KeyB' },
  v: { key: 'v', code: 'KeyV' },
  t: { key: 't', code: 'KeyT' },
  w: { key: 'w', code: 'KeyW' },
  a: { key: 'a', code: 'KeyA' },
  s: { key: 's', code: 'KeyS' },
  d: { key: 'd', code: 'KeyD' },
  shift: { key: 'Shift', code: 'ShiftLeft' },
};

// Per mode, top to bottom in the right-hand column. The big button is the thumb's home.
export const BUTTONS = {
  deity: [
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Down', key: 'q' },
    { id: 'up', label: 'Up', key: 'e', big: true },
  ],
  pedestrian: [
    { id: 'view', label: 'View', key: 'v' },
    { id: 'board', label: 'Board', key: 'b' },
    { id: 'station', label: 'Platforms', key: 'e' },
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Dive', key: 'q' },
    { id: 'up', label: 'Jump', key: 'space', big: true },
  ],
  drone: [
    { id: 'view', label: 'View', key: 'v' },
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Sink', key: 'q' },
    { id: 'up', label: 'Rise', key: 'space', big: true },
  ],
  balloon: [
    { id: 'time', label: 'Time', key: 't' },
    { id: 'down', label: 'Vent', key: 'q' },
    { id: 'up', label: 'Burner', key: 'space', big: true },
  ],
};

export const STICK = { radius: 52, dead: 0.22, axis: 0.38 };

/** The movement keys a stick vector holds. y is down-positive (screen space). */
export function stickKeys(nx, ny) {
  const held = new Set();
  const m = Math.hypot(nx, ny);
  if (m < STICK.dead) return held;
  const ux = nx / m, uy = ny / m;
  if (uy < -STICK.axis) held.add('w');
  if (uy > STICK.axis) held.add('s');
  if (ux < -STICK.axis) held.add('a');
  if (ux > STICK.axis) held.add('d');
  return held;
}

export function isTouchDevice({ search = globalThis.location?.search ?? '', matchMedia = globalThis.matchMedia } = {}) {
  const forced = new URLSearchParams(search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  try { return !!matchMedia?.('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
}

function press(name, down) {
  const k = K[name];
  if (!k) return;
  globalThis.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k.key, code: k.code }));
}

const CSS = `
html.ug-touch, html.ug-touch body { overscroll-behavior: none; -webkit-user-select: none; user-select: none; }
html.ug-touch #ug-controls-guide, html.ug-touch #ug-landscape-lock, html.ug-touch #ug-mode-bar { display: none !important; }

/* Settings HUD: a compact menu chip, opening as a scrolling sheet. */
html.ug-touch .hud { left: calc(8px + env(safe-area-inset-left)); top: calc(8px + env(safe-area-inset-top)); right: auto;
  max-width: min(360px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-height: calc(100dvh - 120px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); padding: 6px 10px; }
html.ug-touch .hud details > summary { list-style: none; cursor: pointer; min-height: 32px; display: flex; align-items: center; gap: 8px; }
html.ug-touch .hud details > summary::-webkit-details-marker { display: none; }
html.ug-touch .hud details > summary::before { content: '\\2261'; font-size: 20px; line-height: 1; opacity: .85; }
html.ug-touch .hud details > summary .meta, html.ug-touch .hud details > summary .title span { display: none; }
html.ug-touch .hud details > summary .title { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
html.ug-touch .hud input, html.ug-touch .hud select, html.ug-touch .hud button { min-height: 32px; }

/* Readout: smaller, out from under the right thumb. */
html.ug-touch #ug-readout { transform: scale(.68); transform-origin: top right;
  top: calc(104px + env(safe-area-inset-top)) !important; bottom: auto !important; right: calc(6px + env(safe-area-inset-right)) !important; }

/* A pinned tap tip stays inside the screen. */
html.ug-touch .hover-tip { max-width: min(320px, calc(100vw - 24px)); }

#${ROOT_ID} { position: fixed; inset: 0; z-index: 22; pointer-events: none; font: 12px 'Railway Sans', ui-sans-serif, system-ui, sans-serif;
  color: #eeeae2; -webkit-tap-highlight-color: transparent; }
#${ROOT_ID} .modes { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + env(safe-area-inset-bottom));
  display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(16,18,24,.62); border: 1px solid rgba(255,255,255,.10);
  pointer-events: auto; touch-action: none; }
#${ROOT_ID} .modes button { font: inherit; font-size: 13px; color: rgba(238,234,226,.8); background: none; border: 0; border-radius: 999px;
  min-height: 36px; padding: 0 14px; touch-action: none; }
#${ROOT_ID} .modes button[aria-pressed=true] { background: rgba(201,184,150,.28); color: #fff; }

#${ROOT_ID} .stick-zone { position: absolute; left: 0; bottom: 0; width: 46%; height: 62%; pointer-events: auto; touch-action: none; }
#${ROOT_ID} .stick-zone[hidden] { display: none; }
#${ROOT_ID} .stick-hint { position: absolute; left: calc(44px + env(safe-area-inset-left)); bottom: calc(76px + env(safe-area-inset-bottom));
  width: 92px; height: 92px; border-radius: 50%; border: 1.5px dashed rgba(255,255,255,.22); display: grid; place-items: center;
  font-size: 11px; letter-spacing: .06em; color: rgba(255,255,255,.45); text-transform: uppercase; }
#${ROOT_ID} .stick-zone.is-active .stick-hint { display: none; }
#${ROOT_ID} .stick { position: absolute; width: ${STICK.radius * 2}px; height: ${STICK.radius * 2}px; margin: -${STICK.radius}px 0 0 -${STICK.radius}px;
  border-radius: 50%; background: rgba(16,18,24,.35); border: 1.5px solid rgba(255,255,255,.28); display: none; }
#${ROOT_ID} .stick-zone.is-active .stick { display: block; }
#${ROOT_ID} .knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  background: rgba(238,234,226,.55); box-shadow: 0 1px 6px rgba(0,0,0,.35); }
#${ROOT_ID} .stick-zone.is-fast .stick, #${ROOT_ID} .stick-zone.is-fast .stick-hint { border-color: rgba(214,186,120,.95); }
#${ROOT_ID} .stick-zone.is-fast .knob { background: rgba(214,186,120,.8); }

#${ROOT_ID} .actions { position: absolute; right: calc(12px + env(safe-area-inset-right)); bottom: calc(64px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; pointer-events: none; }
#${ROOT_ID} .actions button { pointer-events: auto; touch-action: none; font: inherit; font-size: 12px; letter-spacing: .03em;
  color: #eeeae2; background: rgba(16,18,24,.55); border: 1px solid rgba(255,255,255,.16); border-radius: 999px; min-width: 64px;
  min-height: 40px; padding: 0 14px; }
#${ROOT_ID} .actions button.big { width: 72px; height: 72px; border-radius: 50%; padding: 0; font-size: 13px; }
#${ROOT_ID} .actions button.is-down { background: rgba(201,184,150,.40); border-color: rgba(201,184,150,.8); }
#${ROOT_ID} .actions button.is-on { background: rgba(214,186,120,.55); border-color: rgba(214,186,120,.95); color: #17130c; }

@media (orientation: landscape) {
  #${ROOT_ID} .modes { bottom: auto; top: calc(8px + env(safe-area-inset-top)); }
  html.ug-touch #ug-readout { top: calc(84px + env(safe-area-inset-top)) !important; }
  #${ROOT_ID} .actions { bottom: calc(14px + env(safe-area-inset-bottom)); flex-direction: row; align-items: flex-end; flex-wrap: wrap-reverse;
    justify-content: flex-end; max-width: 52vw; }
  #${ROOT_ID} .stick-zone { width: 40%; height: 75%; }
  #${ROOT_ID} .stick-hint { bottom: calc(24px + env(safe-area-inset-bottom)); }
}`;

/**
 * @param {{ registry, canvas: HTMLElement, document?: Document }} o
 * @returns {{ element: HTMLElement, render(): void, dispose(): void, state(): object } | null}
 */
export function installTouchUi({ registry, canvas, document = globalThis.document }) {
  if (!document?.createElement) return null;
  document.documentElement.classList.add('ug-touch');
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="stick-zone" hidden><div class="stick-hint">Move</div><div class="stick"><div class="knob"></div></div></div>
    <div class="actions"></div>
    <div class="modes" role="toolbar" aria-label="Conveyance mode"></div>`;
  // Touches here must not reach the intro's document skip listeners, the orbit controls or the look drag.
  for (const ev of ['click', 'mousedown', 'pointerdown', 'touchstart']) {
    root.addEventListener(ev, (e) => { if (e.target !== root) e.stopPropagation(); });
  }
  (document.body || document.documentElement).appendChild(root);

  const zone = root.querySelector('.stick-zone');
  const stick = root.querySelector('.stick');
  const knob = root.querySelector('.knob');
  const actions = root.querySelector('.actions');
  const modes = root.querySelector('.modes');

  // ── keys held by touch, so a mode change or a lost pointer can release them all ──
  const stickHeld = new Set();
  const buttonHeld = new Map(); // pointerId -> key name
  // Fast latches Shift. It survives a mode change into a mode that has Fast; it ends on blur or backgrounding,
  // where main.js clears every held key anyway.
  let fast = false;
  function setFast(on) {
    on = !!on;
    if (on !== fast) press('shift', on);
    fast = on;
    zone.classList.toggle('is-fast', fast);
    for (const b of actions.querySelectorAll('[data-action=fast]')) {
      b.classList.toggle('is-on', fast);
      b.setAttribute('aria-pressed', fast ? 'true' : 'false');
    }
  }
  const dropAll = () => { releaseAll(); setFast(false); };
  function releaseAll() {
    for (const k of stickHeld) press(k, false);
    stickHeld.clear();
    for (const k of buttonHeld.values()) press(k, false);
    buttonHeld.clear();
    for (const b of actions.querySelectorAll('.is-down')) b.classList.remove('is-down');
    endStick();
  }

  // ── mode bar ──
  function buildModes() {
    modes.textContent = '';
    for (const m of registry.list()) {
      if (m.stub) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = m.id;
      b.textContent = SHORT_LABEL[m.id] ?? m.label;
      b.addEventListener('click', () => { releaseAll(); registry.activate(m.id); });
      modes.appendChild(b);
    }
  }

  // ── action buttons ──
  function buildActions(id) {
    actions.textContent = '';
    for (const def of BUTTONS[id] ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = def.id;
      b.textContent = def.label;
      if (def.big) b.classList.add('big');
      if (def.latch) {
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); setFast(!fast); });
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        actions.appendChild(b);
        continue;
      }
      const up = (e) => {
        if (!buttonHeld.has(e.pointerId)) return;
        press(buttonHeld.get(e.pointerId), false);
        buttonHeld.delete(e.pointerId);
        b.classList.remove('is-down');
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* not all engines */ }
        buttonHeld.set(e.pointerId, def.key);
        b.classList.add('is-down');
        press(def.key, true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      actions.appendChild(b);
    }
  }

  // ── thumbstick ──
  let stickId = null, ox = 0, oy = 0, lastVec = { x: 0, y: 0 };
  function setStickKeys(next) {
    for (const k of stickHeld) if (!next.has(k)) { press(k, false); stickHeld.delete(k); }
    for (const k of next) if (!stickHeld.has(k)) { press(k, true); stickHeld.add(k); }
  }
  function endStick() {
    stickId = null;
    lastVec = { x: 0, y: 0 };
    zone.classList.remove('is-active');
    knob.style.transform = '';
    setStickKeys(new Set());
  }
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* not all engines */ }
    const r = zone.getBoundingClientRect();
    // Keep the whole ring on screen when the thumb lands near an edge.
    ox = Math.min(Math.max(e.clientX, r.left + STICK.radius + 4), r.right - STICK.radius - 4);
    oy = Math.min(Math.max(e.clientY, r.top + STICK.radius + 4), r.bottom - STICK.radius - 4);
    stick.style.left = `${ox - r.left}px`;
    stick.style.top = `${oy - r.top}px`;
    zone.classList.add('is-active');
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const m = Math.hypot(dx, dy);
    if (m > STICK.radius) { dx *= STICK.radius / m; dy *= STICK.radius / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    lastVec = { x: dx / STICK.radius, y: dy / STICK.radius };
    setStickKeys(stickKeys(lastVec.x, lastVec.y));
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(ev, (e) => { if (e.pointerId === stickId) endStick(); });
  }

  // ── two-finger pinch on the view in a body mode: third-person zoom listens for wheel ──
  const viewTouches = new Map();
  let pinchDist = null;
  const bodyActive = () => registry.activeId !== 'deity';
  const onViewDown = (e) => {
    if (e.pointerType !== 'touch') return;
    viewTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinchDist = null;
  };
  const onViewMove = (e) => {
    if (!viewTouches.has(e.pointerId)) return;
    viewTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!bodyActive() || viewTouches.size !== 2) return;
    const [a, b] = [...viewTouches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist !== null && Math.abs(d - pinchDist) > 2) {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: (pinchDist - d) * 2, deltaMode: 0, bubbles: true, cancelable: true }));
    }
    pinchDist = d;
  };
  const onViewUp = (e) => { viewTouches.delete(e.pointerId); pinchDist = null; };
  canvas?.addEventListener('pointerdown', onViewDown);
  canvas?.addEventListener('pointermove', onViewMove);
  for (const ev of ['pointerup', 'pointercancel']) canvas?.addEventListener(ev, onViewUp);

  // Backgrounding the page can swallow pointerup; never leave a key held.
  const onHide = () => { if (document.visibilityState === 'hidden') dropAll(); };
  document.addEventListener('visibilitychange', onHide);
  globalThis.addEventListener?.('blur', dropAll);

  let builtFor = null;
  function render() {
    const id = registry.activeId;
    if (modes.childElementCount === 0) buildModes();
    for (const b of modes.children) b.setAttribute('aria-pressed', b.dataset.mode === id ? 'true' : 'false');
    if (builtFor !== id) {
      builtFor = id;
      releaseAll();
      buildActions(id);
      // Keep Fast on into a mode that has it (re-pressed: a mode may read Shift on its own keydown); else end it.
      const keep = fast && (BUTTONS[id] ?? []).some(d => d.latch);
      setFast(false);
      if (keep) setFast(true);
    }
    zone.hidden = !BUTTONS[id];
  }
  registry.onChange?.(() => render());
  render();

  return {
    element: root,
    render,
    state: () => ({ mode: registry.activeId, fast, stick: { ...lastVec, keys: [...stickHeld] }, buttons: [...buttonHeld.values()] }),
    dispose() {
      dropAll();
      document.removeEventListener('visibilitychange', onHide);
      globalThis.removeEventListener?.('blur', dropAll);
      canvas?.removeEventListener('pointerdown', onViewDown);
      canvas?.removeEventListener('pointermove', onViewMove);
      for (const ev of ['pointerup', 'pointercancel']) canvas?.removeEventListener(ev, onViewUp);
      root.remove();
      document.documentElement.classList.remove('ug-touch');
    },
  };
}
