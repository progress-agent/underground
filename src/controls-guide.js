// controls-guide.js — Round 4 control-guide widget (D-003).
//
// Self-contained — injects own <style id="controls-guide-styles"> and appends
// #ug-controls-guide to document.body. Mirrors src/onboarding.js pattern.
//
// Behaviour:
//   - Hidden until ug:intro-done, then fades in (widget reveal, 400ms).
//   - All caption labels visible 30s, then fade out (800ms).
//   - 200ms after labels begin fading, "Hold shift to go faster" fades in,
//     holds 5s, fades out.
//   - Real keyboard + click/touch on keys both update .is-pressed via a
//     single code path: clicks dispatch synthetic KeyboardEvent('keydown',
//     {code: KeyQ|...}) on window. The window keydown listener inside this
//     module updates the visual; the existing main.js window keydown handler
//     drives fpsControls.keys. No parallel implementation.
//
// URL params:
//   ?fast    — compress 30s show window to 3s for tests/review.
//   ?nofade  — disable timed fade entirely (debug).
//
// Spec: DECISIONS.md D-003. Mock source:
//   ~/Wisdom/_REPORTS/25Apr26s/sources/review-site-ug-controls-widget-v3-0030/mocks/v4.{html,css,js}

const STYLE_ID = 'controls-guide-styles';
const ROOT_ID  = 'ug-controls-guide';

const SHOW_MS_DEFAULT = 30000;
const SHOW_MS_FAST    = 3000;
const SHIFT_DELAY_MS  = 200;
const SHIFT_HOLD_MS   = 5000;
const FADE_MS         = 800;
const REVEAL_MS       = 400;

// Map from widget data-k attribute → KeyboardEvent.code. Single source of
// truth — used both to recognise real keydowns and to synthesise events on
// click/touch.
const KEY_CODE_FOR = {
  q: 'KeyQ', w: 'KeyW', e: 'KeyE',
  a: 'KeyA', s: 'KeyS', d: 'KeyD',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
};

// Reverse lookup — KeyboardEvent.code → data-k.
const ID_FOR_CODE = Object.fromEntries(
  Object.entries(KEY_CODE_FOR).map(([id, code]) => [code, id])
);

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    #${ROOT_ID} {
      position: fixed;
      left: 28px;
      bottom: 26px;
      z-index: 28;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      user-select: none;
      font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
      pointer-events: auto;
      opacity: 0;
      transition: opacity ${REVEAL_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }
    #${ROOT_ID}.ready { opacity: 1; }

    #${ROOT_ID} .row-clusters {
      display: flex;
      align-items: flex-start;
      gap: 18px;
    }

    #${ROOT_ID} .cluster {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
    }
    #${ROOT_ID} .cluster-wasd { position: relative; }

    #${ROOT_ID} .row { display: flex; gap: 6px; }

    #${ROOT_ID} .sep {
      align-self: stretch;
      width: 1px;
      background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.10) 70%, transparent 100%);
      margin-top: 4px;
    }

    /* a5 typographic grid base — borderless, dotted-corner radial gradients,
       Plex Mono glyph at 400 weight. */
    #${ROOT_ID} .key {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
      font-weight: 400;
      font-size: 15px;
      letter-spacing: 0.02em;
      color: rgba(250,250,250,0.82);
      position: relative;
      border: none;
      border-radius: 0;
      cursor: pointer;
      touch-action: manipulation;
      background:
        radial-gradient(1px 1px at 20% 20%, rgba(255,255,255,0.22), transparent 60%),
        radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.22), transparent 60%),
        radial-gradient(1px 1px at 20% 80%, rgba(255,255,255,0.22), transparent 60%),
        radial-gradient(1px 1px at 80% 80%, rgba(255,255,255,0.22), transparent 60%),
        radial-gradient(1px 1px at 50% 50%, rgba(255,255,255,0.10), transparent 60%);
      transition:
        background 160ms cubic-bezier(0.22, 0.61, 0.36, 1),
        color 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }
    #${ROOT_ID} .key.small {
      width: 32px;
      height: 32px;
      font-size: 13px;
    }
    #${ROOT_ID} .key .glyph {
      display: inline-block;
      transition:
        text-shadow 160ms cubic-bezier(0.22, 0.61, 0.36, 1),
        font-weight 160ms cubic-bezier(0.22, 0.61, 0.36, 1),
        color 160ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }

    /* Press feedback — soft circular bloom + glyph halo. NO outer box-shadow
       (would create a dark-square-obfuscating-glow artefact — see CLAUDE.md). */
    #${ROOT_ID} .key.is-pressed {
      color: #ffffff;
      background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), transparent 65%);
    }
    #${ROOT_ID} .key.is-pressed .glyph {
      font-weight: 700;
      color: #ffffff;
      text-shadow:
        0 0 6px  rgba(255,255,255,1),
        0 0 12px rgba(255,255,255,0.85),
        0 0 24px rgba(255,255,255,0.55),
        0 0 42px rgba(255,255,255,0.30);
    }

    #${ROOT_ID} .key-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }

    /* Per-key action labels + cluster role + arrow hint — same caption style. */
    #${ROOT_ID} .action-label,
    #${ROOT_ID} .cluster-role,
    #${ROOT_ID} .hint.sub {
      font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
      font-size: 9.5px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.58);
      font-weight: 500;
      line-height: 1;
      text-align: center;
    }
    #${ROOT_ID} .cluster-role { margin-bottom: 3px; }
    #${ROOT_ID} .hint.sub { margin-top: 3px; }

    /* Title "CONTROLS" — 19px (2× caption), centred above QWE.
       Letter-spacing's trailing-space asymmetry pushes glyphs ~half-a-letter-
       space LEFT of optical centre under translateX(-50%). The +0.1em right-
       shift compensates exactly. See CLAUDE.md "letter-spacing trailing-space"
       trap. */
    #${ROOT_ID} .title {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(calc(-50% + 0.1em));
      font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
      font-size: 19px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.58);
      font-weight: 500;
      white-space: nowrap;
      line-height: 1;
    }

    #${ROOT_ID} .fade-target {
      opacity: 1;
      transition: opacity ${FADE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }
    #${ROOT_ID} .fade-target.is-faded {
      opacity: 0;
      pointer-events: none;
    }

    #${ROOT_ID} .shift-message {
      position: absolute;
      left: 0;
      bottom: calc(100% + 10px);
      font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
      opacity: 0;
      transition: opacity ${FADE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
      pointer-events: none;
      text-shadow: 0 0 18px rgba(255,255,255,0.18);
    }
    #${ROOT_ID} .shift-message.is-visible { opacity: 1; }
  `;
  document.head.appendChild(s);
}

function buildRoot() {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="shift-message" aria-live="polite">Hold shift to go faster</div>
    <div class="row-clusters">
      <div class="cluster cluster-wasd">
        <div class="title fade-target">Controls</div>
        <div class="row row-qwe">
          <div class="key-cell">
            <span class="key" data-k="q"><span class="glyph">Q</span></span>
            <span class="action-label fade-target">down</span>
          </div>
          <div class="key-cell">
            <span class="key" data-k="w"><span class="glyph">W</span></span>
            <span class="action-label fade-target">FWD</span>
          </div>
          <div class="key-cell">
            <span class="key" data-k="e"><span class="glyph">E</span></span>
            <span class="action-label fade-target">up</span>
          </div>
        </div>
        <div class="row row-asd">
          <div class="key-cell">
            <span class="key" data-k="a"><span class="glyph">A</span></span>
            <span class="action-label fade-target">left</span>
          </div>
          <div class="key-cell">
            <span class="key" data-k="s"><span class="glyph">S</span></span>
            <span class="action-label fade-target">back</span>
          </div>
          <div class="key-cell">
            <span class="key" data-k="d"><span class="glyph">D</span></span>
            <span class="action-label fade-target">right</span>
          </div>
        </div>
      </div>
      <div class="sep" aria-hidden="true"></div>
      <div class="cluster cluster-arrows">
        <div class="cluster-role fade-target">Look</div>
        <div class="row row-up">
          <span class="key small" data-k="up"><span class="glyph">&uarr;</span></span>
        </div>
        <div class="row row-down">
          <span class="key small" data-k="left"><span class="glyph">&larr;</span></span>
          <span class="key small" data-k="down"><span class="glyph">&darr;</span></span>
          <span class="key small" data-k="right"><span class="glyph">&rarr;</span></span>
        </div>
        <div class="hint sub fade-target">arrows</div>
      </div>
    </div>
  `;
  return root;
}

export function initControlsGuide() {
  injectStyles();
  const root = buildRoot();
  document.body.appendChild(root);

  const params  = new URLSearchParams(location.search);
  const fast    = params.has('fast');
  const noFade  = params.has('nofade');
  const showMs  = fast ? SHOW_MS_FAST : SHOW_MS_DEFAULT;

  const fadeTargets  = root.querySelectorAll('.fade-target');
  const shiftMessage = root.querySelector('.shift-message');
  const keyEls = {};
  root.querySelectorAll('.key').forEach((k) => {
    const id = k.getAttribute('data-k');
    if (id) keyEls[id] = k;
  });

  // ── .is-pressed visual driver ────────────────────────────────────────────
  // Single set tracking which key ids are currently held. Real keyboard +
  // synthetic-from-click both feed through the window keydown/keyup listeners
  // below so the visual matches what main.js's window keydown handler is
  // doing to fpsControls.keys.
  const held = new Set();
  const onWindowKeyDown = (ev) => {
    const id = ID_FOR_CODE[ev.code];
    if (!id) return;
    held.add(id);
    const k = keyEls[id];
    if (k) k.classList.add('is-pressed');
  };
  const onWindowKeyUp = (ev) => {
    const id = ID_FOR_CODE[ev.code];
    if (!id) return;
    held.delete(id);
    const k = keyEls[id];
    if (k) k.classList.remove('is-pressed');
  };
  window.addEventListener('keydown', onWindowKeyDown);
  window.addEventListener('keyup',   onWindowKeyUp);

  // ── Click/touch → synthetic KeyboardEvent ───────────────────────────────
  // pointerdown dispatches keydown on window; pointerup/cancel/leave dispatch
  // keyup. setPointerCapture so the key keeps tracking even if the pointer
  // drifts off the tile mid-press. This unifies click and real-keyboard code
  // paths through one handler — main.js's existing window keydown logic does
  // the rest (no fpsControls.keys mutation here).
  Object.entries(keyEls).forEach(([id, el]) => {
    const code = KEY_CODE_FOR[id];
    if (!code) return;

    const down = (ev) => {
      ev.preventDefault();
      try { el.setPointerCapture(ev.pointerId); } catch (_) { /* not all envs */ }
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    };
    const up = () => {
      // Guard against duplicate keyup (pointerleave fires after pointerup).
      if (held.has(id)) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      }
    };

    el.addEventListener('pointerdown',   down);
    el.addEventListener('pointerup',     up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave',  up);
  });

  // ── Reveal lifecycle ────────────────────────────────────────────────────
  // Widget is opacity-0 until ug:intro-done. Then `.ready` fades it in over
  // REVEAL_MS, and the timed caption-fade / shift-message reveal kicks off.
  const timers = [];
  const startTimedReveal = () => {
    if (noFade) return;
    timers.push(setTimeout(() => {
      fadeTargets.forEach((el) => el.classList.add('is-faded'));
    }, showMs));
    timers.push(setTimeout(() => {
      shiftMessage.classList.add('is-visible');
    }, showMs + SHIFT_DELAY_MS));
    timers.push(setTimeout(() => {
      shiftMessage.classList.remove('is-visible');
    }, showMs + SHIFT_DELAY_MS + SHIFT_HOLD_MS));
  };

  const onIntroDone = () => {
    root.classList.add('ready');
    startTimedReveal();
  };

  // intro.js fires ug:intro-done from both finalize() and the URL-skip fast
  // path. Handler is once-only — both paths converge here.
  window.addEventListener('ug:intro-done', onIntroDone, { once: true });

  // If intro already completed before this module mounted (e.g. tests that
  // dispatch ug:intro-done synchronously), reveal immediately.
  if (window.__ug && window.__ug.introDoneAlready) onIntroDone();

  return {
    // Test hooks — direct surface for Playwright, not user-facing.
    _root: root,
    _shiftMessage: shiftMessage,
    _keys: keyEls,
    _held: held,
    _showMs: showMs,
  };
}
