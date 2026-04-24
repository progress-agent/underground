// landscape-lock.js — Week-1 Step 3.
//
// Mobile landscape-only gate. Injects a full-screen overlay that is visible
// when the viewport is in portrait orientation AND the viewport is narrow
// enough to be a phone (≤ 900px in the larger dimension). Hidden otherwise
// — desktop users in any aspect ratio never see it, tablets in landscape
// don't see it.
//
// Spec: DECISIONS.md D-001 §3. iOS Safari silently rejects
// screen.orientation.lock() — confirmed MDN / Can I Use / Apple
// community. CSS-driven overlay + matchMedia reactive update is the only
// reliable path; the API call is a no-op bonus on Android Chrome.
//
// Audience = personal/friends (D-001 §6) — plain "Rotate your device"
// copy, no hand-holding.

const STYLE_ID = 'landscape-lock-styles';
const OVERLAY_ID = 'ug-landscape-lock';
// Portrait + phone-ish. "(orientation: portrait)" alone would lock desktop
// users in tall windows, which is the opposite of what we want. 900px is a
// generous phone/small-tablet cap; above that we assume the user has agency.
const QUERY = '(orientation: portrait) and (max-width: 900px)';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: none;
      align-items: center;
      justify-content: center;
      background: #05070b;
      color: rgba(255,255,255,0.92);
      text-align: center;
      padding: 24px;
      font-family: 'Railway Sans', ui-sans-serif, system-ui;
    }
    #${OVERLAY_ID}.locked { display: flex; }
    #${OVERLAY_ID} .card {
      max-width: 320px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }
    #${OVERLAY_ID} .glyph {
      width: 80px;
      height: 80px;
      display: block;
      opacity: 0.75;
      animation: ug-ll-rotate 2.4s ease-in-out infinite;
    }
    #${OVERLAY_ID} .title {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.04em;
      margin: 0;
    }
    #${OVERLAY_ID} .sub {
      font-size: 13px;
      opacity: 0.7;
      margin: 0;
      line-height: 1.5;
    }
    @keyframes ug-ll-rotate {
      0%   { transform: rotate(0deg);   }
      40%  { transform: rotate(90deg);  }
      60%  { transform: rotate(90deg);  }
      100% { transform: rotate(0deg);   }
    }
  `;
  document.head.appendChild(s);
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="card">
      <svg class="glyph" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="22" y="10" width="20" height="36" rx="3" />
        <circle cx="32" cy="41" r="1.2" fill="currentColor" />
        <path d="M 10 54 Q 10 58 14 58 L 50 58 Q 54 58 54 54" opacity="0.55" />
      </svg>
      <p class="title">Rotate your device</p>
      <p class="sub">This visualisation is designed for landscape.</p>
    </div>
  `;
  return el;
}

export function initLandscapeLock() {
  injectStyles();
  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const mql = window.matchMedia(QUERY);
  const apply = (matches) => {
    overlay.classList.toggle('locked', !!matches);
  };
  apply(mql.matches);

  // addEventListener is the modern path; the deprecated addListener() fallback
  // covers Safari < 14 which is effectively off the supported list but cheap
  // to keep.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', (e) => apply(e.matches));
  } else if (typeof mql.addListener === 'function') {
    mql.addListener((e) => apply(e.matches));
  }

  // Bonus: attempt screen.orientation.lock('landscape') — succeeds on Android
  // Chrome in fullscreen, silently rejects everywhere else. Never awaited, never
  // trusted; the CSS path is load-bearing.
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => { /* expected on iOS */ });
    }
  } catch (e) { /* noop */ }

  return {
    _overlay: overlay,
    _mql: mql,
    isLocked: () => overlay.classList.contains('locked'),
  };
}
