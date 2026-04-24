// onboarding.js — Week-1 Step 2.
//
// Two surfaces:
//   (1) Dismissible essentials hint card — appears on `ug:intro-done` if the
//       `ug:onboarding-seen` localStorage flag is unset. Auto-fades after 6s
//       or on first input (keydown / pointerdown / touchstart anywhere outside
//       the hint/icon/modal). Writes the flag on dismiss — one-shot per origin.
//   (2) Persistent `?` icon top-right → 2-tab modal (Basics / All Controls).
//       Backdrop click, Escape key, or close button dismisses. Always available
//       after intro, regardless of hint state.
//
// Spec: DECISIONS.md D-001 §5. Self-contained — no markup required in index.html.

const LS_KEY = 'ug:onboarding-seen';
const HINT_AUTOFADE_MS = 6000;
const FADE_MS = 300;

const BASICS_ROWS = [
  { keys: ['W'], label: 'Forward' },
  { keys: ['S'], label: 'Back' },
  { keys: ['A', 'D'], label: 'Strafe left / right' },
  { keys: ['Q', 'E'], label: 'Down / up' },
  { keys: ['Shift'], label: 'Hold for 3× sprint' },
  { keys: ['Fast flight'], label: 'HUD button — latching 3× toggle' },
  { keys: ['Drag'], label: 'Mouse to look around' },
];

const ALL_ROWS = [
  { section: 'Move' },
  { keys: ['W'], label: 'Forward' },
  { keys: ['S'], label: 'Back' },
  { keys: ['A', 'D'], label: 'Strafe left / right' },
  { keys: ['Q', 'E'], label: 'Down / up' },
  { keys: ['Shift'], label: 'Hold — 3× sprint (momentary)' },
  { keys: ['Fast flight'], label: '3× latching toggle (HUD)' },
  { section: 'Look' },
  { keys: ['Left-drag'], label: 'Orbit — pivot adopts whatever is under pointer' },
  { keys: ['Right-drag'], label: 'Pan' },
  { keys: ['Wheel'], label: 'Dolly (zoom in/out)' },
  { keys: ['↑', '↓', '←', '→'], label: 'Rotate / look (no position change)' },
  { section: 'HUD' },
  { keys: ['Click title'], label: 'Expand / collapse HUD panel' },
  { keys: ['Solo line'], label: 'Focus a single line' },
  { keys: ['Focal length'], label: 'Lens simulation 12–200mm' },
  { keys: ['Volume'], label: 'Spatial audio — muted by default' },
];

function injectStyles() {
  if (document.getElementById('onboarding-styles')) return;
  const s = document.createElement('style');
  s.id = 'onboarding-styles';
  s.textContent = `
    #ug-onboarding-hint {
      position: fixed;
      left: 50%;
      bottom: 15%;
      transform: translateX(-50%) translateY(8px);
      z-index: 30;
      display: none;
      max-width: min(520px, calc(100vw - 32px));
      color: rgba(255,255,255,0.92);
      background: rgba(12, 16, 24, 0.65);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 14px;
      padding: 14px 18px;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      opacity: 0;
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      user-select: none;
      font-size: 13px;
      line-height: 1.5;
    }
    #ug-onboarding-hint.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    #ug-onboarding-hint .title {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(201,184,150,0.95);
      margin-bottom: 8px;
      font-weight: 600;
    }
    #ug-onboarding-hint .rows { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; }
    #ug-onboarding-hint .rows .keys { white-space: nowrap; }
    #ug-onboarding-hint .dismiss-hint {
      margin-top: 10px;
      font-size: 11px;
      opacity: 0.65;
      text-align: right;
    }

    .ug-key {
      display: inline-block;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 4px;
      padding: 1px 7px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.4;
      margin-right: 3px;
      color: rgba(255,255,255,0.95);
    }

    #ug-help-icon {
      position: fixed;
      top: 52px;
      right: 12px;
      z-index: 25;
      display: none;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(20, 24, 34, 0.55);
      border: 1px solid rgba(255,255,255,0.18);
      color: rgba(255,255,255,0.92);
      font-family: 'Railway Sans', ui-sans-serif, system-ui;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 0;
      line-height: 1;
      user-select: none;
      transition: background 150ms ease, border-color 150ms ease;
    }
    #ug-help-icon:hover {
      background: rgba(40, 48, 64, 0.75);
      border-color: rgba(255,255,255,0.32);
    }
    #ug-help-icon.ready { display: inline-flex; align-items: center; justify-content: center; }

    #ug-help-modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity ${FADE_MS}ms ease;
    }
    #ug-help-modal.visible { opacity: 1; }
    #ug-help-modal .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 7, 11, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    #ug-help-modal .panel {
      position: relative;
      background: rgba(20, 24, 34, 0.96);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 16px;
      padding: 22px 26px 24px;
      width: min(560px, calc(100vw - 32px));
      max-height: min(640px, calc(100vh - 32px));
      overflow-y: auto;
      color: rgba(255,255,255,0.92);
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
    }
    #ug-help-modal .close {
      position: absolute;
      top: 10px;
      right: 12px;
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: rgba(255,255,255,0.7);
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      border-radius: 6px;
    }
    #ug-help-modal .close:hover { color: rgba(255,255,255,1); background: rgba(255,255,255,0.08); }
    #ug-help-modal h2 {
      margin: 0 0 14px 0;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: rgba(201,184,150,0.95);
    }
    #ug-help-modal .tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    #ug-help-modal .tab {
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.6);
      padding: 8px 14px;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      font-family: inherit;
    }
    #ug-help-modal .tab.active {
      color: rgba(255,255,255,0.95);
      border-bottom-color: rgba(201,184,150,0.8);
    }
    #ug-help-modal .panel-body .section {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.45);
      margin: 14px 0 6px;
    }
    #ug-help-modal .panel-body .section:first-child { margin-top: 0; }
    #ug-help-modal .panel-body .rows { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 13px; }
    #ug-help-modal .panel-body .keys { white-space: nowrap; }

    @media (max-width: 520px) {
      #ug-help-icon { top: auto; bottom: 82px; right: 12px; }
      #ug-onboarding-hint { bottom: 160px; padding: 12px 14px; font-size: 12px; }
    }
  `;
  document.head.appendChild(s);
}

function renderRows(rows) {
  // rows may include {section} dividers.
  const parts = [];
  let pendingRows = [];
  const flush = () => {
    if (!pendingRows.length) return;
    parts.push(`<div class="rows">${pendingRows.join('')}</div>`);
    pendingRows = [];
  };
  for (const r of rows) {
    if (r.section) {
      flush();
      parts.push(`<div class="section">${r.section}</div>`);
    } else {
      const keys = r.keys.map((k) => `<span class="ug-key">${k}</span>`).join('');
      pendingRows.push(`<div class="keys">${keys}</div><div class="label">${r.label}</div>`);
    }
  }
  flush();
  return parts.join('');
}

function buildHint() {
  const el = document.createElement('div');
  el.id = 'ug-onboarding-hint';
  el.setAttribute('role', 'note');
  el.innerHTML = `
    <div class="title">Quick start</div>
    ${renderRows(BASICS_ROWS)}
    <div class="dismiss-hint">Any key or click to dismiss</div>
  `;
  return el;
}

function buildIcon() {
  const el = document.createElement('button');
  el.id = 'ug-help-icon';
  el.type = 'button';
  el.setAttribute('aria-label', 'Show controls');
  el.title = 'Controls';
  el.textContent = '?';
  return el;
}

function buildModal() {
  const el = document.createElement('div');
  el.id = 'ug-help-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Controls');
  el.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <button class="close" type="button" aria-label="Close">×</button>
      <h2>Controls</h2>
      <div class="tabs">
        <button class="tab active" type="button" data-tab="basics">Basics</button>
        <button class="tab" type="button" data-tab="all">All Controls</button>
      </div>
      <div class="panel-body" data-panel="basics">${renderRows(BASICS_ROWS)}</div>
      <div class="panel-body" data-panel="all" style="display:none">${renderRows(ALL_ROWS)}</div>
    </div>
  `;
  return el;
}

function safeGetFlag() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
}
function safeSetFlag() {
  try { localStorage.setItem(LS_KEY, '1'); } catch (e) { /* privacy mode */ }
}

export function initOnboarding() {
  injectStyles();

  const hint = buildHint();
  const icon = buildIcon();
  const modal = buildModal();
  document.body.appendChild(hint);
  document.body.appendChild(icon);
  document.body.appendChild(modal);

  // ─── Modal ─────────────────────────────────────────────────────────────
  let modalOpen = false;
  const tabs = modal.querySelectorAll('.tab');
  const panels = {
    basics: modal.querySelector('[data-panel="basics"]'),
    all: modal.querySelector('[data-panel="all"]'),
  };

  const setTab = (key) => {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
    Object.entries(panels).forEach(([k, el]) => { el.style.display = k === key ? 'block' : 'none'; });
  };
  tabs.forEach((t) => t.addEventListener('click', (e) => {
    e.stopPropagation();
    setTab(t.dataset.tab);
  }));

  const openModal = () => {
    if (modalOpen) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('visible'));
    modalOpen = true;
  };
  const closeModal = () => {
    if (!modalOpen) return;
    modal.classList.remove('visible');
    modalOpen = false;
    setTimeout(() => { if (!modalOpen) modal.style.display = 'none'; }, FADE_MS);
  };

  icon.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
  modal.querySelector('.backdrop').addEventListener('click', closeModal);
  modal.querySelector('.close').addEventListener('click', closeModal);
  // Escape key closes modal. Scoped to modalOpen so we don't eat other ESC handlers.
  window.addEventListener('keydown', (e) => {
    if (modalOpen && e.key === 'Escape') { e.stopPropagation(); closeModal(); }
  });

  // ─── Hint ──────────────────────────────────────────────────────────────
  const seen = safeGetFlag();

  let hintDismissed = false;
  let hintTimer = null;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.classList.remove('visible');
    setTimeout(() => { hint.remove(); }, FADE_MS);
    safeSetFlag();
    if (hintTimer) clearTimeout(hintTimer);
    window.removeEventListener('keydown', onFirstInput, true);
    window.removeEventListener('pointerdown', onFirstInput, true);
    window.removeEventListener('touchstart', onFirstInput, true);
  };
  const onFirstInput = (e) => {
    // Clicks on the ? icon or inside the modal are not hint dismissals — user
    // is engaging with help, not moving past it.
    const t = e.target;
    if (t && (icon.contains(t) || modal.contains(t))) return;
    dismissHint();
  };

  const showHint = () => {
    hint.style.display = 'block';
    requestAnimationFrame(() => hint.classList.add('visible'));
    hintTimer = setTimeout(dismissHint, HINT_AUTOFADE_MS);
    window.addEventListener('keydown', onFirstInput, true);
    window.addEventListener('pointerdown', onFirstInput, true);
    window.addEventListener('touchstart', onFirstInput, true);
  };

  const onIntroDone = () => {
    icon.classList.add('ready');
    if (!seen) showHint();
  };

  // { once: true } — intro.js fires ug:intro-done from both finalize() and
  // the URL-skip fast path. Handler must be idempotent across both.
  window.addEventListener('ug:intro-done', onIntroDone, { once: true });

  // If intro already completed before this module initialised (e.g. tests
  // that fire ug:intro-done synchronously, or ?intro-skip URLs that dispatch
  // before our module loads), show immediately.
  if (window.__ug && window.__ug.introDoneAlready) onIntroDone();

  return {
    openModal,
    closeModal,
    // Test hooks — direct surface for Playwright, not user-facing.
    _hint: hint,
    _icon: icon,
    _modal: modal,
    _resetSeen: () => { try { localStorage.removeItem(LS_KEY); } catch (e) {} },
  };
}
