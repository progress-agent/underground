// hud.js: small mode picker and per-mode key hint (sprint 23Sep26w, D-037,
// lane A1). Top centre, clear of the settings HUD (top left), the minimap and
// readout (right) and the controls guide (bottom left). Desktop only: on a
// coarse-pointer, no-hover device the bar is hidden and touch keeps Deity.

const CSS = `
#ug-mode-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:21;display:flex;flex-direction:column;
align-items:center;gap:4px;font:11px 'Railway Sans',system-ui,sans-serif;color:#eeeae2;user-select:none;pointer-events:none}
#ug-mode-bar .pills{display:flex;gap:4px;padding:3px;border-radius:999px;background:rgba(16,18,24,.62);
border:1px solid rgba(255,255,255,.10);pointer-events:auto}
#ug-mode-bar button{font:inherit;color:rgba(238,234,226,.78);background:none;border:0;border-radius:999px;padding:3px 10px;cursor:pointer;
display:flex;gap:5px;align-items:baseline}
#ug-mode-bar button kbd{font:inherit;font-size:9px;opacity:.55}
#ug-mode-bar button[aria-pressed=true]{background:rgba(201,184,150,.24);color:#fff}
#ug-mode-bar button .soon{font-size:9px;opacity:.5}
#ug-mode-bar button.physics{border-left:1px solid rgba(255,255,255,.12);border-radius:0 999px 999px 0;opacity:.8}
#ug-mode-bar .hint{max-width:min(560px,calc(100vw - 32px));text-align:center;padding:2px 10px;border-radius:6px;
background:rgba(16,18,24,.5);opacity:.82;text-shadow:0 0 3px #111}
@media (hover:none) and (pointer:coarse){#ug-mode-bar{display:none}}
@media (max-width:520px){#ug-mode-bar{top:auto;bottom:74px}}`;

export function createModeHud({ document = globalThis.document, registry, physics, look }) {
  if (!document?.createElement) return { render() {}, setHint() {}, element: null };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head?.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ug-mode-bar';
  const pills = document.createElement('div');
  pills.className = 'pills';
  pills.setAttribute('role', 'toolbar');
  pills.setAttribute('aria-label', 'Conveyance mode');
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.id = 'ug-mode-hint';
  root.append(pills, hint);
  // Clicks here must not reach the intro's document skip listeners or start a
  // canvas pointer-lock / orbit drag.
  for (const ev of ['click', 'mousedown', 'pointerdown', 'touchstart']) root.addEventListener(ev, e => e.stopPropagation());
  (document.body || document.documentElement).appendChild(root);

  const buttons = new Map();
  let hintOverride = null;

  const physicsBtn = document.createElement('button');
  physicsBtn.type = 'button';
  physicsBtn.className = 'physics';
  physicsBtn.textContent = 'Physics';
  physicsBtn.title = 'Tune this mode (speeds, acceleration, damping, gravity, FOV, lag)';
  // A mode without its own tunables (a stub) behaves as Deity, so it shows Deity's.
  const panelId = () => (physics?.has(registry.activeId) ? registry.activeId : 'deity');
  physicsBtn.addEventListener('click', () => physics?.toggle(panelId()));

  function build() {
    pills.textContent = '';
    buttons.clear();
    for (const m of registry.list()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = m.id;
      const k = document.createElement('kbd'); k.textContent = m.key ?? '';
      const t = document.createElement('span'); t.textContent = m.label;
      b.append(k, t);
      if (m.stub) { const s = document.createElement('span'); s.className = 'soon'; s.textContent = 'soon'; b.append(s); }
      b.addEventListener('click', () => registry.activate(m.id));
      buttons.set(m.id, b);
      pills.appendChild(b);
    }
    pills.appendChild(physicsBtn);
  }

  function render() {
    if (buttons.size !== registry.list().length) build();
    const active = registry.active;
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', id === active?.id ? 'true' : 'false');
    let text = hintOverride ?? active?.hint ?? '';
    if (active?.look === 'lock' && !hintOverride) {
      text += look?.isLocked() ? ' · Esc frees the cursor' : ' · click the view to capture the mouse';
    }
    hint.textContent = text;
    hint.hidden = !text;
    if (physics?.isOpen()) physics.show(panelId());
  }

  build();
  registry.onChange(() => { hintOverride = null; build(); render(); });
  look?.onLockChange(() => render());
  render();

  return {
    render,
    /** Temporary hint text from a mode (null restores the mode's own hint). */
    setHint(text) { hintOverride = text ?? null; render(); },
    element: root,
  };
}
