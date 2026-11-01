// touch-ui.js: the phone layout (D-058, 01Nov26u). Supersedes D-001 §3 (landscape
// lock) and D-001's no-joystick rule on touch devices only; desktop is unchanged.
//
// Every control here speaks the desktop's own input. The move stick and the
// buttons dispatch the same synthetic KeyboardEvents the controls guide has
// used since D-001 §7, so each body's keyboard code (main.js's held-key Set,
// Space latches, V, B, T, E) runs untouched and nothing in src/modes/ knows
// about touch. The look stick sends Deity the arrow keys (how Deity turns on a
// keyboard) and sends the bodies a stream of drag pixels through the same
// look input a finger drag uses, so each body's own look sensitivity applies.
//
//   isTouchDevice()            coarse pointer and no hover; ?touch=1 / ?touch=0 force it (tests, desktop preview)
//   installTouchUi({ registry, canvas, onLook, getQuality })
//     mode bar      bottom centre (between the sticks in landscape), one pill per mode
//     move stick    lower left, appears where the thumb lands; 8-way W/A/S/D past a dead zone (item 2)
//     look stick    lower right, the same; Deity: arrow keys; bodies: LOOK_RATE drag px/s at full push (item 7)
//     buttons       above the look stick; the paired down/up buttons (Down/Up, Dive/Jump, Sink/Rise, Vent/Burner)
//                   sit side by side at one size, the rest in a row above; held while the finger is down
//     Fast          above the move stick: latches Shift (sprint / boost / fast flight); the move ring turns gold (item 6)
//     pinch zoom    two fingers on the view in a body mode send wheel events (third-person zoom listens for wheel)
//     perf line     at the top of the ☰ sheet: frame rate and the drawing resolution, for phone testing
//   One-finger drag on the open view still looks (bodies) or pans (Deity); pointer-lock.js computes touch deltas from
//   clientX/Y because iOS leaves movementX at 0.

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
  arrowup: { key: 'ArrowUp', code: 'ArrowUp' },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown' },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft' },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight' },
  shift: { key: 'Shift', code: 'ShiftLeft' },
};

// Per mode. `pair` buttons sit side by side at one size (down first); the others in a row above; `latch` is Fast.
export const BUTTONS = {
  deity: [
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Down', key: 'q', pair: true },
    { id: 'up', label: 'Up', key: 'e', pair: true },
  ],
  pedestrian: [
    { id: 'view', label: 'View', key: 'v' },
    { id: 'board', label: 'Board', key: 'b' },
    { id: 'station', label: 'Platforms', key: 'e' },
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Dive', key: 'q', pair: true },
    { id: 'up', label: 'Jump', key: 'space', pair: true },
  ],
  drone: [
    { id: 'view', label: 'View', key: 'v' },
    { id: 'fast', label: 'Fast', key: 'shift', latch: true },
    { id: 'down', label: 'Sink', key: 'q', pair: true },
    { id: 'up', label: 'Rise', key: 'space', pair: true },
  ],
  balloon: [
    { id: 'time', label: 'Time', key: 't' },
    { id: 'down', label: 'Vent', key: 'q', pair: true },
    { id: 'up', label: 'Burner', key: 'space', pair: true },
  ],
};

export const STICK = { radius: 52, dead: 0.22, axis: 0.38 };
/** Look stick in a body at full push, in drag pixels per second (Drone 0.14 °/px gives about 84 °/s). */
export const LOOK_RATE = 600;
const ARROW_FOR = { w: 'arrowup', s: 'arrowdown', a: 'arrowleft', d: 'arrowright' };

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

/** Look stick drag pixels for one frame: zero in the dead zone, then rising from zero to LOOK_RATE at full push. */
export function lookDelta(nx, ny, dt) {
  const m = Math.hypot(nx, ny);
  if (m < STICK.dead) return [0, 0];
  const k = Math.min(1, (m - STICK.dead) / (1 - STICK.dead)) / m * LOOK_RATE * dt;
  return [nx * k, ny * k];
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

const SAFE_B = 'env(safe-area-inset-bottom)';
const CSS = `
html.ug-touch, html.ug-touch body { overscroll-behavior: none; -webkit-user-select: none; user-select: none; }
html.ug-touch #ug-controls-guide, html.ug-touch #ug-landscape-lock, html.ug-touch #ug-mode-bar { display: none !important; }

/* Settings HUD: a compact menu chip, opening as a scrolling sheet. */
html.ug-touch .hud { left: calc(8px + env(safe-area-inset-left)); top: calc(6px + env(safe-area-inset-top)); right: auto;
  max-width: min(360px, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-height: calc(100dvh - 120px - env(safe-area-inset-top) - ${SAFE_B}); padding: 6px 10px; }
html.ug-touch .hud details > summary { list-style: none; cursor: pointer; min-height: 32px; display: flex; align-items: center; gap: 8px; }
html.ug-touch .hud details > summary::-webkit-details-marker { display: none; }
html.ug-touch .hud details > summary::before { content: '\\2261'; font-size: 20px; line-height: 1; opacity: .85; }
html.ug-touch .hud details > summary .meta, html.ug-touch .hud details > summary .title span { display: none; }
html.ug-touch .hud details > summary .title { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
html.ug-touch .hud input, html.ug-touch .hud select, html.ug-touch .hud button { min-height: 32px; }
html.ug-touch #ug-touch-perf { font-variant-numeric: tabular-nums; opacity: .8; }

/* Top-right corner: the mini-map, open by default (Jordan, 01Nov26u), with the altimeter and compass beside it. */
html.ug-touch #ug-mini-map { top: calc(4px + env(safe-area-inset-top)); right: calc(4px + env(safe-area-inset-right)); width: 180px; }
html.ug-touch #ug-readout { transform: scale(.68); transform-origin: top right; bottom: auto !important;
  top: calc(132px + env(safe-area-inset-top)) !important; right: calc(4px + env(safe-area-inset-right)) !important; }
html.ug-touch:has(#ug-mini-map[data-collapsed="true"]) #ug-readout { top: calc(52px + env(safe-area-inset-top)) !important; }

/* A pinned tap tip stays inside the screen. */
html.ug-touch .hover-tip { max-width: min(320px, calc(100vw - 24px)); }

#${ROOT_ID} { position: fixed; inset: 0; z-index: 22; pointer-events: none; font: 12px 'Railway Sans', ui-sans-serif, system-ui, sans-serif;
  color: #eeeae2; -webkit-tap-highlight-color: transparent; --bar: 58px; --zone: 240px; --above: 196px; }
#${ROOT_ID} .modes { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(10px + ${SAFE_B});
  display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(16,18,24,.62); border: 1px solid rgba(255,255,255,.10);
  pointer-events: auto; touch-action: none; }
#${ROOT_ID} .modes button { font: inherit; font-size: 13px; color: rgba(238,234,226,.8); background: none; border: 0; border-radius: 999px;
  min-height: 36px; padding: 0 13px; touch-action: none; }
#${ROOT_ID} .modes button[aria-pressed=true] { background: rgba(201,184,150,.28); color: #fff; }

#${ROOT_ID} .stick-zone { position: absolute; bottom: calc(var(--bar) + ${SAFE_B}); width: 50%; height: var(--zone);
  pointer-events: auto; touch-action: none; }
#${ROOT_ID} .stick-zone.move { left: 0; }
#${ROOT_ID} .stick-zone.look { right: 0; }
#${ROOT_ID} .stick-zone[hidden] { display: none; }
#${ROOT_ID} .stick-hint { position: absolute; bottom: 20px; width: 92px; height: 92px; border-radius: 50%;
  border: 1.5px dashed rgba(255,255,255,.22); display: grid; place-items: center;
  font-size: 11px; letter-spacing: .06em; color: rgba(255,255,255,.45); text-transform: uppercase; }
#${ROOT_ID} .move .stick-hint { left: calc(30px + env(safe-area-inset-left)); }
#${ROOT_ID} .look .stick-hint { right: calc(30px + env(safe-area-inset-right)); }
#${ROOT_ID} .stick-zone.is-active .stick-hint { display: none; }
#${ROOT_ID} .stick { position: absolute; width: ${STICK.radius * 2}px; height: ${STICK.radius * 2}px; margin: -${STICK.radius}px 0 0 -${STICK.radius}px;
  border-radius: 50%; background: rgba(16,18,24,.35); border: 1.5px solid rgba(255,255,255,.28); display: none; }
#${ROOT_ID} .stick-zone.is-active .stick { display: block; }
#${ROOT_ID} .knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  background: rgba(238,234,226,.55); box-shadow: 0 1px 6px rgba(0,0,0,.35); }
#${ROOT_ID} .move.is-fast .stick, #${ROOT_ID} .move.is-fast .stick-hint { border-color: rgba(214,186,120,.95); }
#${ROOT_ID} .move.is-fast .knob { background: rgba(214,186,120,.8); }

#${ROOT_ID} .actions, #${ROOT_ID} .fast-slot { position: absolute; bottom: calc(var(--bar) + var(--above) + ${SAFE_B});
  display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
#${ROOT_ID} .actions { right: calc(12px + env(safe-area-inset-right)); align-items: flex-end; }
#${ROOT_ID} .fast-slot { left: calc(12px + env(safe-area-inset-left)); align-items: flex-start; }
#${ROOT_ID} .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; max-width: calc(100vw - 150px); }
#${ROOT_ID} button.act { pointer-events: auto; touch-action: none; font: inherit; font-size: 12px; letter-spacing: .03em;
  color: #eeeae2; background: rgba(16,18,24,.55); border: 1px solid rgba(255,255,255,.16); border-radius: 999px; min-width: 60px;
  min-height: 40px; padding: 0 13px; }
#${ROOT_ID} .row.pair button.act { width: 76px; height: 52px; min-width: 0; padding: 0; font-size: 13px; }
#${ROOT_ID} button.act.is-down { background: rgba(201,184,150,.40); border-color: rgba(201,184,150,.8); }
#${ROOT_ID} button.act.is-on { background: rgba(214,186,120,.55); border-color: rgba(214,186,120,.95); color: #17130c; }

@media (orientation: landscape) {
  /* The bar sits between the two sticks; the top edge is left to the menu, the mini-map and the readout. */
  #${ROOT_ID} { --bar: 0px; --zone: 62vh; --above: 36vh; }
  #${ROOT_ID} .modes { bottom: calc(8px + ${SAFE_B}); }
  #${ROOT_ID} .modes button { padding: 0 10px; }
  #${ROOT_ID} .stick-zone { width: 33%; }
  #${ROOT_ID} .row { max-width: calc(40vw - 12px); }
  html.ug-touch #ug-mini-map { width: 160px; }
  html.ug-touch #ug-readout { top: calc(4px + env(safe-area-inset-top)) !important; right: calc(170px + env(safe-area-inset-right)) !important; }
  html.ug-touch:has(#ug-mini-map[data-collapsed="true"]) #ug-readout { top: calc(4px + env(safe-area-inset-top)) !important;
    right: calc(52px + env(safe-area-inset-right)) !important; }
}`;

/**
 * @param {{ registry, canvas: HTMLElement, onLook?: (dx: number, dy: number) => void,
 *   getQuality?: () => ({ scale: number, pixelRatio: number }), document?: Document }} o
 * @returns {{ element: HTMLElement, render(): void, dispose(): void, state(): object } | null}
 */
export function installTouchUi({ registry, canvas, onLook = () => {}, getQuality = null, document = globalThis.document }) {
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
  const zoneHtml = (cls, hint) =>
    `<div class="stick-zone ${cls}" data-stick="${cls}"><div class="stick-hint">${hint}</div><div class="stick"><div class="knob"></div></div></div>`;
  root.innerHTML = `${zoneHtml('move', 'Move')}${zoneHtml('look', 'Look')}
    <div class="fast-slot"></div><div class="actions"></div>
    <div class="modes" role="toolbar" aria-label="Conveyance mode"></div>`;
  // Touches here must not reach the intro's document skip listeners, the orbit controls or the look drag.
  for (const ev of ['click', 'mousedown', 'pointerdown', 'touchstart']) {
    root.addEventListener(ev, (e) => { if (e.target !== root) e.stopPropagation(); });
  }
  (document.body || document.documentElement).appendChild(root);

  const actions = root.querySelector('.actions');
  const fastSlot = root.querySelector('.fast-slot');
  const modes = root.querySelector('.modes');

  // ── Fast latches Shift. It survives a mode change into a mode that has Fast; it ends on blur or backgrounding,
  // where main.js clears every held key anyway. ──
  let fast = false;
  function setFast(on) {
    on = !!on;
    if (on !== fast) press('shift', on);
    fast = on;
    sticks.move.zone.classList.toggle('is-fast', fast);
    for (const b of fastSlot.querySelectorAll('[data-action=fast]')) {
      b.classList.toggle('is-on', fast);
      b.setAttribute('aria-pressed', fast ? 'true' : 'false');
    }
  }

  // ── sticks ──
  const sticks = {};
  function makeStick(kind) {
    const zone = root.querySelector(`.stick-zone.${kind}`);
    const ring = zone.querySelector('.stick');
    const knob = zone.querySelector('.knob');
    const st = { zone, id: null, ox: 0, oy: 0, vec: { x: 0, y: 0 }, held: new Set() };
    st.setKeys = (next) => {
      for (const k of st.held) if (!next.has(k)) { press(k, false); st.held.delete(k); }
      for (const k of next) if (!st.held.has(k)) { press(k, true); st.held.add(k); }
    };
    st.end = () => {
      st.id = null;
      st.vec = { x: 0, y: 0 };
      zone.classList.remove('is-active');
      knob.style.transform = '';
      st.setKeys(new Set());
    };
    zone.addEventListener('pointerdown', (e) => {
      if (st.id !== null) return;
      e.preventDefault();
      st.id = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* not all engines */ }
      const r = zone.getBoundingClientRect();
      // Keep the whole ring on screen when the thumb lands near an edge.
      st.ox = Math.min(Math.max(e.clientX, r.left + STICK.radius + 4), r.right - STICK.radius - 4);
      st.oy = Math.min(Math.max(e.clientY, r.top + STICK.radius + 4), r.bottom - STICK.radius - 4);
      ring.style.left = `${st.ox - r.left}px`;
      ring.style.top = `${st.oy - r.top}px`;
      zone.classList.add('is-active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== st.id) return;
      let dx = e.clientX - st.ox, dy = e.clientY - st.oy;
      const m = Math.hypot(dx, dy);
      if (m > STICK.radius) { dx *= STICK.radius / m; dy *= STICK.radius / m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      st.vec = { x: dx / STICK.radius, y: dy / STICK.radius };
      const keys = stickKeys(st.vec.x, st.vec.y);
      if (kind === 'move') st.setKeys(keys);
      else if (registry.activeId === 'deity') st.setKeys(new Set([...keys].map(k => ARROW_FOR[k])));
      else startLookLoop();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      zone.addEventListener(ev, (e) => { if (e.pointerId === st.id) st.end(); });
    }
    return st;
  }
  sticks.move = makeStick('move');
  sticks.look = makeStick('look');

  // The look stick in a body feeds drag pixels every frame it is pushed.
  let lookRaf = 0, lookLast = 0;
  function lookFrame(t) {
    lookRaf = 0;
    const st = sticks.look;
    if (st.id === null || registry.activeId === 'deity') return;
    const dt = lookLast ? Math.min(0.1, (t - lookLast) / 1000) : 1 / 60;
    lookLast = t;
    const [dx, dy] = lookDelta(st.vec.x, st.vec.y, dt);
    if (dx || dy) onLook(dx, dy);
    lookRaf = requestAnimationFrame(lookFrame);
  }
  function startLookLoop() {
    if (lookRaf) return;
    lookLast = 0;
    lookRaf = requestAnimationFrame(lookFrame);
  }

  // ── keys held by touch, so a mode change or a lost pointer can release them all ──
  const buttonHeld = new Map(); // pointerId -> key name
  function releaseAll() {
    for (const k of buttonHeld.values()) press(k, false);
    buttonHeld.clear();
    for (const b of root.querySelectorAll('.is-down')) b.classList.remove('is-down');
    sticks.move.end();
    sticks.look.end();
    if (lookRaf) { cancelAnimationFrame(lookRaf); lookRaf = 0; }
  }
  const dropAll = () => { releaseAll(); setFast(false); };

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

  // ── buttons ──
  function makeButton(def) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act';
    b.dataset.action = def.id;
    b.textContent = def.label;
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    if (def.latch) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); setFast(!fast); });
      return b;
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
    return b;
  }
  function buildActions(id) {
    actions.textContent = '';
    fastSlot.textContent = '';
    const defs = BUTTONS[id] ?? [];
    const top = document.createElement('div'); top.className = 'row';
    const pair = document.createElement('div'); pair.className = 'row pair';
    for (const def of defs) {
      if (def.latch) fastSlot.appendChild(makeButton(def));
      else (def.pair ? pair : top).appendChild(makeButton(def));
    }
    if (top.childElementCount) actions.appendChild(top);
    if (pair.childElementCount) actions.appendChild(pair);
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

  // ── perf line in the ☰ sheet: what the phone is actually managing, for testing ──
  const hudDetails = document.getElementById('hudDetails');
  let perf = null, perfRaf = 0, frames = 0, perfFrom = 0;
  if (hudDetails && getQuality) {
    perf = document.createElement('p');
    perf.id = 'ug-touch-perf';
    perf.className = 'small';
    hudDetails.querySelector('summary')?.after(perf);
    const tick = (t) => {
      frames++;
      if (!perfFrom) perfFrom = t;
      if (t - perfFrom >= 1000) {
        const fps = frames * 1000 / (t - perfFrom);
        const q = getQuality();
        perf.textContent = `${fps.toFixed(0)} fps · drawing at ${Math.round(q.scale * 100)}% · ${q.pixelRatio.toFixed(2)}× pixels`;
        frames = 0; perfFrom = t;
      }
      perfRaf = hudDetails.open ? requestAnimationFrame(tick) : 0;
    };
    hudDetails.addEventListener('toggle', () => {
      if (hudDetails.open && !perfRaf) { frames = 0; perfFrom = 0; perf.textContent = 'Measuring…'; perfRaf = requestAnimationFrame(tick); }
    });
  }

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
    sticks.move.zone.hidden = sticks.look.zone.hidden = !BUTTONS[id];
  }
  registry.onChange?.(() => render());
  render();

  return {
    element: root,
    render,
    state: () => ({ mode: registry.activeId, fast, move: { ...sticks.move.vec, keys: [...sticks.move.held] },
      look: { ...sticks.look.vec, keys: [...sticks.look.held] }, buttons: [...buttonHeld.values()] }),
    dispose() {
      dropAll();
      if (perfRaf) cancelAnimationFrame(perfRaf);
      perf?.remove();
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
