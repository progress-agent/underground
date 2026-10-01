// platform-chooser.js: the Pedestrian platform chooser card and the arrival
// name banner (sprint 30Sep26w, D-041 item 4, Lane P).
//
// Jordan (D-040 item 5): "when first descending, it needs to be possible to
// choose a platform", and it "needs to be visually clear when you reach the
// next station, and can exit". Grilled (D-041 item 4): a card in the
// controls-guide style lists each platform as "Line · towards X", picked by
// number key or click; the same card appears on arrival at every station,
// offering the street or, at an interchange, a change of line without
// surfacing.
//
// ─── API ────────────────────────────────────────────────────────────────────
//
//   const chooser = createPlatformChooser({ document, look, canvas });
//   chooser.open({ title, kicker, rows: [{ label, colour?, section? }], onPick(row, i), onCancel() })
//   chooser.close()          closes without a pick (no callback)
//   chooser.pick(i)          as if row i were chosen (key 1 = row 0 ... key 0 = row 9)
//   chooser.isOpen
//   chooser.banner(name, { colour })   the station name, shown briefly on arrival
//   chooser.debug()          { open, title, rows: [labels], picks, keysCaptured, lockReleased }
//
// KEYS: while the card is open a CAPTURE-phase keydown listener on window
// takes the digits (1-9, then 0 for the tenth row) before anything else sees
// them, so they pick rows and never switch conveyance mode (modes/index.js
// binds 1-4 to the modes on the ordinary bubbling listener). Esc cancels.
// Everything else (W/S, E, Shift) passes through untouched. While the card is
// closed the listener does nothing and the digits switch modes as before.
//
// POINTER LOCK: a locked pointer cannot click the DOM, so opening the card
// releases the lock (look.exit()); the rows are then ordinary buttons. A pick
// made with a key or a click is a user gesture, so if the pointer was locked
// when the card opened the lock is requested again for the walk that follows.
//
// STYLE: the controls guide's (controls-guide.js): IBM Plex Mono captions in
// spaced capitals, dotted-corner key tiles, IBM Plex Sans text, and a card at
// 0.92 opacity with no backdrop-filter (AGENTS.md: blur under a translucent
// card bleeds scene colour). All CSS is namespaced under the element ids.

const ROOT_ID = 'ug-platform-chooser';
const BANNER_ID = 'ug-station-banner';
const STYLE_ID = 'ug-platform-chooser-styles';
export const BANNER_MS = 2600;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const CSS = `
#${ROOT_ID}{position:fixed;left:50%;top:58%;transform:translate(-50%,-50%);z-index:30;min-width:300px;
max-width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 160px);overflow:auto;box-sizing:border-box;
padding:14px 16px 12px;border-radius:10px;background:rgba(12,14,19,.92);border:1px solid rgba(255,255,255,.12);
color:rgba(250,250,250,.9);font-family:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;user-select:none;
opacity:0;transition:opacity 220ms cubic-bezier(0.22,0.61,0.36,1);pointer-events:none}
#${ROOT_ID}.is-open{opacity:1;pointer-events:auto}
#${ROOT_ID} .kicker,#${ROOT_ID} .section{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-size:9.5px;
letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.58);font-weight:500;line-height:1}
#${ROOT_ID} .title{margin:6px 0 10px;font-size:17px;font-weight:600;letter-spacing:-.01em;color:#fff}
#${ROOT_ID} .section{margin:10px 0 4px}
#${ROOT_ID} ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
#${ROOT_ID} button.row{all:unset;box-sizing:border-box;display:grid;grid-template-columns:32px 4px 1fr;gap:10px;align-items:center;
width:100%;padding:3px 6px 3px 0;border-radius:6px;cursor:pointer;font-size:14px;line-height:1.25;color:rgba(250,250,250,.9)}
#${ROOT_ID} button.row:hover,#${ROOT_ID} button.row:focus-visible,#${ROOT_ID} button.row.is-active{background:rgba(255,255,255,.06);color:#fff}
#${ROOT_ID} .key{display:grid;place-items:center;width:32px;height:32px;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;
font-size:13px;color:rgba(250,250,250,.82);background:
radial-gradient(1px 1px at 20% 20%,rgba(255,255,255,.22),transparent 60%),radial-gradient(1px 1px at 80% 20%,rgba(255,255,255,.22),transparent 60%),
radial-gradient(1px 1px at 20% 80%,rgba(255,255,255,.22),transparent 60%),radial-gradient(1px 1px at 80% 80%,rgba(255,255,255,.22),transparent 60%)}
#${ROOT_ID} button.row.is-active .key{color:#fff;text-shadow:0 0 6px rgba(255,255,255,1),0 0 12px rgba(255,255,255,.85);
background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.08),transparent 65%)}
#${ROOT_ID} .swatch{width:4px;height:22px;border-radius:2px;background:rgba(255,255,255,.35);box-shadow:0 0 0 1px rgba(255,255,255,.28)}
#${ROOT_ID} .foot{margin-top:10px;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-size:9.5px;letter-spacing:.12em;
text-transform:uppercase;color:rgba(255,255,255,.42)}
#${BANNER_ID}{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:29;display:flex;align-items:center;gap:10px;
padding:6px 18px;border-radius:3px;background:rgba(0,15,159,.9);color:#fff;font-family:'Railway Sans','IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
font-size:26px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;opacity:0;pointer-events:none;
transition:opacity 420ms cubic-bezier(0.22,0.61,0.36,1)}
#${BANNER_ID}.is-visible{opacity:1}
#${BANNER_ID} .line{width:10px;height:26px;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.4)}
@media (max-width:520px){#${ROOT_ID}{top:auto;bottom:90px;transform:translateX(-50%)}#${BANNER_ID}{font-size:19px}}`;

function hex(c) {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string') return c;
  return `#${(Number(c) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

export function createPlatformChooser({ document = globalThis.document, look = null, canvas = null, window: win = globalThis } = {}) {
  let current = null;           // { title, rows, onPick, onCancel, wasLocked }
  let active = 0;               // highlighted row (arrow keys)
  let bannerTimer = null;
  const stats = { picks: 0, keysCaptured: 0, lockReleased: 0, opened: 0 };
  let lastBanner = null;

  const hasDom = !!document?.createElement;
  let root = null, banner = null;
  if (hasDom) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head?.appendChild(style);
    }
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-hidden', 'true');
    // Clicks on the card must not reach the canvas (pointer lock, orbit drag)
    // or the intro's document-level skip listeners.
    for (const ev of ['click', 'mousedown', 'pointerdown', 'touchstart', 'wheel']) root.addEventListener(ev, e => e.stopPropagation());
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).append(root, banner);
  }

  function render() {
    if (!root) return;
    root.textContent = '';
    if (!current) return;
    const kicker = document.createElement('div');
    kicker.className = 'kicker';
    kicker.textContent = current.kicker || 'Platforms';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = current.title || '';
    root.append(kicker, title);
    let list = null, section = Symbol('start');   // the first row always starts a list
    current.rows.forEach((row, i) => {
      if (row.section !== section) {
        section = row.section;
        if (section) {
          const h = document.createElement('div');
          h.className = 'section';
          h.textContent = section;
          root.appendChild(h);
        }
        list = document.createElement('ol');
        root.appendChild(list);
      }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `row${i === active ? ' is-active' : ''}`;
      b.dataset.index = String(i);
      const k = document.createElement('span');
      k.className = 'key';
      k.textContent = i < DIGITS.length ? DIGITS[i] : '';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      const c = hex(row.colour);
      if (c) sw.style.background = c;
      const t = document.createElement('span');
      t.className = 'label';
      t.textContent = row.label;
      b.append(k, sw, t);
      b.addEventListener('click', (e) => { e.preventDefault(); pick(i); });
      li.appendChild(b);
      list.appendChild(li);
    });
    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = current.rows.length > 1 ? `Press 1-${Math.min(current.rows.length, 9)} or click · Esc to stay` : 'Press 1 or click · Esc to stay';
    root.appendChild(foot);
  }

  function setVisible(on) {
    if (!root) return;
    root.classList.toggle('is-open', on);
    root.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  function open({ title = '', kicker = '', rows = [], onPick = () => {}, onCancel = () => {} } = {}) {
    const wasLocked = !!look?.isLocked?.() || current?.wasLocked || false;
    current = { title, kicker, rows: rows.slice(), onPick, onCancel, wasLocked };
    active = 0;
    stats.opened++;
    // A locked pointer cannot click the card: free it.
    if (look?.isLocked?.()) { look.exit(); stats.lockReleased++; }
    else if (document?.pointerLockElement) { try { document.exitPointerLock(); stats.lockReleased++; } catch { /* ignore */ } }
    render();
    setVisible(true);
    return true;
  }

  function close() {
    if (!current) return false;
    current = null;
    setVisible(false);
    render();
    return true;
  }

  function relock(wasLocked) {
    if (!wasLocked || !canvas?.requestPointerLock) return;
    try { const p = canvas.requestPointerLock(); p?.catch?.(() => {}); } catch { /* refused: drag look remains */ }
  }

  function pick(i) {
    if (!current || !(i >= 0 && i < current.rows.length)) return false;
    const c = current;
    const row = c.rows[i];
    current = null;
    setVisible(false);
    render();
    stats.picks++;
    relock(c.wasLocked);
    try { c.onPick(row, i); } catch (err) { console.warn('[chooser] pick', err); }
    return true;
  }

  function cancel() {
    if (!current) return false;
    const c = current;
    close();
    try { c.onCancel(); } catch (err) { console.warn('[chooser] cancel', err); }
    return true;
  }

  // Capture phase: runs before modes/index.js (digits 1-4 switch mode) and
  // main.js (movement keys), both of which listen on the bubbling phase.
  const onKey = (e) => {
    if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target?.matches?.('input, select, textarea') || target?.isContentEditable) return;
    const d = DIGITS.indexOf(e.key);
    if (d >= 0) {
      e.preventDefault(); e.stopImmediatePropagation();
      stats.keysCaptured++;
      if (!e.repeat) pick(d);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopImmediatePropagation();
      const n = current.rows.length;
      active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % Math.max(1, n);
      render();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
  };
  win?.addEventListener?.('keydown', onKey, { capture: true });

  function showBanner(name, { colour = null } = {}) {
    lastBanner = { name, colour };
    if (!banner) return;
    banner.textContent = '';
    const c = hex(colour);
    if (c) { const bar = document.createElement('span'); bar.className = 'line'; bar.style.background = c; banner.appendChild(bar); }
    const t = document.createElement('span');
    t.textContent = name;
    banner.appendChild(t);
    banner.classList.add('is-visible');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.classList.remove('is-visible'); bannerTimer = null; }, BANNER_MS);
  }

  function hideBanner() {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    banner?.classList.remove('is-visible');
  }

  return {
    open, close, pick, cancel,
    get isOpen() { return !!current; },
    get rows() { return current ? current.rows.slice() : []; },
    banner: showBanner,
    hideBanner,
    element: root,
    bannerElement: banner,
    debug() {
      return {
        open: !!current, title: current?.title ?? null, kicker: current?.kicker ?? null,
        rows: current ? current.rows.map(r => r.label) : [],
        banner: lastBanner ? { ...lastBanner, visible: !!banner?.classList.contains('is-visible') } : null,
        ...stats,
      };
    },
    dispose() {
      win?.removeEventListener?.('keydown', onKey, { capture: true });
      hideBanner();
      root?.remove(); banner?.remove();
    },
  };
}
