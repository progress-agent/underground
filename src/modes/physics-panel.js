// physics-panel.js: live per-mode physics tunables (sprint 23Sep26w, D-037,
// lane A1). Jordan sets the feel at review; every default here and in each
// mode is a best first guess, meant to be moved.
//
// ─── API ────────────────────────────────────────────────────────────────────
//
//   const physics = createPhysicsPanel({ storage, document });
//
//   const p = physics.register('drone', 'Drone', [
//     { key: 'maxSpeed', label: 'Top speed', unit: 'm/s', min: 5, max: 80, step: 1, default: 35 },
//     { key: 'fov',      label: 'FOV',       unit: '°',   min: 60, max: 130, step: 1, default: 110 },
//   ]);
//   p.maxSpeed            // live current value (getter), always a finite number in [min, max]
//   p.maxSpeed = 40       // also allowed: same as physics.set('drone', 'maxSpeed', 40)
//
//   physics.get(modeId)           live params object (as returned by register)
//   physics.set(modeId, key, v)   clamp, store, persist, notify
//   physics.reset(modeId?)        back to defaults (one mode, or all), persisted
//   physics.defaults(modeId)      { key: default }
//   physics.onChange(fn)          fn(modeId, key, value); returns an unsubscribe
//   physics.show(modeId) / hide() / toggle(modeId) / isOpen()
//   physics.element               the panel root (null without a DOM)
//
// Conventional keys, so the panel reads the same across modes (use them where
// they fit; add others freely): speed, sprint, accel, damping, gravity, jump,
// fov, lag, turn. Units are REAL metres and seconds; the mode converts to
// canonical scene units (Y is 5 per metre) itself.
//
// PERSISTENCE: only values that differ from their default are stored, under
// one localStorage key, so a changed default in code reaches everyone who has
// not deliberately tuned that value. Every storage access is wrapped: private
// windows and blocked storage fall back to defaults silently.

export const PHYSICS_STORAGE_KEY = 'ug:physics:v1';

function safeStorage(explicit) {
  if (explicit !== undefined) return explicit;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createPhysicsPanel({ storage, document = globalThis.document, storageKey = PHYSICS_STORAGE_KEY } = {}) {
  const store = safeStorage(storage);
  const modes = new Map(); // id -> { label, defs: Map(key -> def), values: {}, params }
  const listeners = new Set();
  let saved = {};
  try { saved = JSON.parse(store?.getItem(storageKey) || '{}') || {}; } catch { saved = {}; }
  if (typeof saved !== 'object' || Array.isArray(saved)) saved = {};

  function persist() {
    const out = {};
    for (const [id, m] of modes) {
      for (const [key, def] of m.defs) {
        if (m.values[key] !== def.default) (out[id] ||= {})[key] = m.values[key];
      }
    }
    // Keep overrides for modes not registered in this build (a stub today may
    // be a real mode tomorrow; do not throw its tuning away).
    for (const id of Object.keys(saved)) if (!modes.has(id)) out[id] = saved[id];
    try { store?.setItem(storageKey, JSON.stringify(out)); } catch { /* quota / private mode */ }
  }

  function clampTo(def, v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def.default;
    return Math.min(def.max, Math.max(def.min, n));
  }

  function notify(id, key, value) {
    for (const fn of listeners) { try { fn(id, key, value); } catch (err) { console.warn('[physics]', err); } }
  }

  function set(id, key, value, { silent = false, save = true } = {}) {
    const m = modes.get(id);
    const def = m?.defs.get(key);
    if (!def) return undefined;
    const v = clampTo(def, value);
    if (m.values[key] === v) return v;
    m.values[key] = v;
    if (save) persist();
    ui.sync(id, key);
    if (!silent) notify(id, key, v);
    return v;
  }

  function register(id, label, defs) {
    if (modes.has(id)) throw new Error(`physics: mode "${id}" already registered`);
    const m = { label, defs: new Map(), values: {}, params: {} };
    for (const d of defs) {
      if (!d || typeof d.key !== 'string') throw new TypeError('physics: tunable needs a key');
      if (![d.min, d.max, d.default].every(Number.isFinite) || d.min > d.max) {
        throw new RangeError(`physics: ${id}.${d.key} needs finite min <= default <= max`);
      }
      const def = { step: (d.max - d.min) / 100, unit: '', label: d.key, ...d };
      m.defs.set(d.key, def);
      m.values[d.key] = clampTo(def, saved[id]?.[d.key] ?? def.default);
      Object.defineProperty(m.params, d.key, {
        enumerable: true,
        get: () => m.values[d.key],
        set: (v) => { set(id, d.key, v); },
      });
    }
    Object.freeze(m.params);
    modes.set(id, m);
    ui.build(id);
    return m.params;
  }

  function reset(id) {
    const ids = id ? [id] : [...modes.keys()];
    for (const mid of ids) {
      const m = modes.get(mid);
      if (!m) continue;
      for (const [key, def] of m.defs) set(mid, key, def.default, { save: false });
      delete saved[mid];
    }
    persist();
  }

  // ── DOM (optional; absent under node tests) ──────────────────────────────
  const ui = (() => {
    if (!document?.createElement) return { build() {}, sync() {}, show() {}, hide() {}, isOpen: () => false, root: null };
    const root = document.createElement('div');
    root.id = 'ug-physics-panel';
    root.hidden = true;
    const style = document.createElement('style');
    style.textContent = `
#ug-physics-panel{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:22;width:300px;max-width:calc(100vw - 32px);
max-height:calc(100vh - 140px);overflow:auto;box-sizing:border-box;padding:10px 12px 12px;border-radius:10px;
background:rgba(16,18,24,.92);border:1px solid rgba(255,255,255,.12);color:#eeeae2;font:11px 'Railway Sans',system-ui,sans-serif}
#ug-physics-panel h3{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
#ug-physics-panel .row{display:grid;grid-template-columns:92px 1fr 58px;gap:6px;align-items:center;margin:3px 0}
#ug-physics-panel input[type=range]{width:100%;accent-color:#c9b896}
#ug-physics-panel output{text-align:right;font-variant-numeric:tabular-nums;opacity:.85}
#ug-physics-panel button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:2px 9px;cursor:pointer}
#ug-physics-panel section[hidden]{display:none}`;
    root.appendChild(style);
    // Keys typed into the panel must not fly the camera or switch modes, and
    // clicks must not reach the intro's document-level skip listeners.
    for (const ev of ['keydown', 'keyup', 'click', 'mousedown', 'pointerdown', 'touchstart']) {
      root.addEventListener(ev, e => e.stopPropagation());
    }
    const sections = new Map();
    let openId = null;
    const fmt = (def, v) => {
      const dp = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : def.step >= 0.01 ? 2 : 3;
      return `${v.toFixed(dp)}${def.unit ? ` ${def.unit}` : ''}`;
    };
    (document.body || document.documentElement).appendChild(root);
    return {
      root,
      build(id) {
        const m = modes.get(id);
        const sec = document.createElement('section');
        sec.dataset.mode = id;
        sec.hidden = true;
        const h = document.createElement('h3');
        h.textContent = `${m.label} physics`;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = 'Reset';
        resetBtn.dataset.action = 'reset';
        resetBtn.addEventListener('click', () => reset(id));
        h.appendChild(resetBtn);
        sec.appendChild(h);
        const inputs = new Map();
        for (const [key, def] of m.defs) {
          const row = document.createElement('label');
          row.className = 'row';
          const name = document.createElement('span');
          name.textContent = def.label;
          const input = document.createElement('input');
          input.type = 'range';
          input.min = String(def.min); input.max = String(def.max); input.step = String(def.step);
          input.value = String(m.values[key]);
          input.dataset.key = key;
          const out = document.createElement('output');
          out.textContent = fmt(def, m.values[key]);
          input.addEventListener('input', () => set(id, key, Number(input.value)));
          row.append(name, input, out);
          sec.appendChild(row);
          inputs.set(key, { input, out, def });
        }
        sections.set(id, { sec, inputs });
        root.appendChild(sec);
      },
      sync(id, key) {
        const s = sections.get(id)?.inputs.get(key);
        if (!s) return;
        const v = modes.get(id).values[key];
        if (Number(s.input.value) !== v) s.input.value = String(v);
        s.out.textContent = fmt(s.def, v);
      },
      show(id) {
        openId = id;
        for (const [mid, s] of sections) s.sec.hidden = mid !== id;
        root.hidden = !sections.has(id);
      },
      hide() { openId = null; root.hidden = true; },
      isOpen: () => !root.hidden && openId !== null,
      get openId() { return openId; },
    };
  })();

  return {
    register,
    get: (id) => modes.get(id)?.params,
    set: (id, key, v) => set(id, key, v),
    reset,
    defaults: (id) => {
      const m = modes.get(id);
      return m ? Object.fromEntries([...m.defs].map(([k, d]) => [k, d.default])) : undefined;
    },
    has: (id) => modes.has(id),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    show: (id) => ui.show(id),
    hide: () => ui.hide(),
    toggle(id) { if (ui.isOpen() && ui.openId === id) ui.hide(); else ui.show(id); },
    isOpen: () => ui.isOpen(),
    get element() { return ui.root; },
  };
}
