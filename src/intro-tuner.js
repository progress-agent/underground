// Tuning HUD for the cinematic intro. Gated on ?tuneIntro=1 — completely
// absent on normal boots. Bottom-left, collapsed by default so a single
// glance hides everything; click the summary to expose inputs.
//
// Inputs bind to createIntro's tune() surface, so editing + Replay re-runs
// the intro with live values without a page reload. "Log pose" copies the
// current camera / lookAt to clipboard in a paste-ready format.

const FIELDS = [
  ['startX',      'Start X'],
  ['startY',      'Start Y'],
  ['startZ',      'Start Z'],
  ['endX',        'End X'],
  ['endY',        'End Y'],
  ['endZ',        'End Z'],
  ['lookX',       'Look X'],
  ['lookY',       'Look Y'],
  ['lookZ',       'Look Z'],
  ['holdMs',      'Hold ms'],
  ['phase1EndMs', 'Phase1 ms'],
  ['totalMs',     'Total ms'],
];

export function initIntroTuner({ intro, camera, controls }) {
  if (typeof window === 'undefined' || !window.location) return;
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('tuneIntro') !== '1') return;

  const panel = document.createElement('details');
  panel.id = 'introTuner';
  panel.style.cssText = `
    position: fixed;
    left: 12px;
    bottom: 48px;
    z-index: 16;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgba(255,255,255,0.88);
    background: rgba(20, 24, 34, 0.45);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 10px;
    padding: 6px 8px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    user-select: none;
    max-width: 220px;
  `;

  // Panel-wide event containment — the intro's own skip listeners
  // (click/touchstart/keydown on document) would otherwise fast-forward
  // the intro the moment Replay or a number-input keystroke bubbles up.
  for (const ev of ['click', 'mousedown', 'touchstart', 'keydown']) {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  }

  const summary = document.createElement('summary');
  summary.textContent = 'Intro tuner';
  summary.style.cssText = `
    cursor: pointer;
    list-style: none;
    opacity: 0.7;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 10px;
    outline: none;
  `;
  panel.appendChild(summary);

  const body = document.createElement('div');
  body.style.cssText = 'margin-top: 6px;';
  panel.appendChild(body);

  const inputs = {};
  const params = intro.getParams();

  for (const [key, label] of FIELDS) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px; align-items: center; margin-bottom: 2px;';

    const l = document.createElement('label');
    l.textContent = label;
    l.style.cssText = 'min-width: 66px; opacity: 0.7;';

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = params[key] == null ? '' : String(params[key]);
    input.placeholder = '(auto)';
    input.style.cssText = `
      flex: 1;
      min-width: 64px;
      padding: 2px 4px;
      font-family: inherit;
      font-size: 11px;
      background: rgba(255,255,255,0.06);
      color: inherit;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 4px;
      outline: none;
    `;

    row.appendChild(l);
    row.appendChild(input);
    body.appendChild(row);
    inputs[key] = input;
  }

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display: flex; gap: 6px; margin-top: 6px;';

  const replayBtn = mkButton('Replay', 'rgba(74, 222, 128, 0.30)');
  replayBtn.addEventListener('click', () => {
    const next = {};
    for (const [key] of FIELDS) {
      const raw = inputs[key].value.trim();
      if (raw === '') continue; // keep existing value
      const v = parseFloat(raw);
      if (!Number.isNaN(v)) next[key] = v;
    }
    intro.tune(next).replay();
  });

  const poseBtn = mkButton('Log pose', 'rgba(255,255,255,0.14)');
  poseBtn.title = 'Copy current camera + lookAt to clipboard';
  poseBtn.addEventListener('click', () => {
    const p = camera.position;
    const t = controls && controls.target;
    const msg =
      `endX: ${p.x.toFixed(2)},\n` +
      `endY: ${p.y.toFixed(2)},\n` +
      `endZ: ${p.z.toFixed(2)},\n` +
      (t ? `lookX: ${t.x.toFixed(2)},\nlookY: ${t.y.toFixed(2)},\nlookZ: ${t.z.toFixed(2)},` : '');
    try {
      navigator.clipboard.writeText(msg).then(() => {
        poseBtn.textContent = 'Copied';
        setTimeout(() => { poseBtn.textContent = 'Log pose'; }, 1200);
      });
    } catch (e) { /* noop */ }
    console.log(msg);
  });

  const applyBtn = mkButton('Apply pose→End', 'rgba(255,255,255,0.14)');
  applyBtn.title = 'Copy current camera pose into the End X/Y/Z + Look fields';
  applyBtn.addEventListener('click', () => {
    const p = camera.position;
    const t = controls && controls.target;
    inputs.endX.value = p.x.toFixed(2);
    inputs.endY.value = p.y.toFixed(2);
    inputs.endZ.value = p.z.toFixed(2);
    if (t) {
      inputs.lookX.value = t.x.toFixed(2);
      inputs.lookY.value = t.y.toFixed(2);
      inputs.lookZ.value = t.z.toFixed(2);
    }
  });

  buttonRow.appendChild(replayBtn);
  buttonRow.appendChild(poseBtn);
  body.appendChild(buttonRow);

  const applyRow = document.createElement('div');
  applyRow.style.cssText = 'display: flex; margin-top: 4px;';
  applyBtn.style.flex = '1';
  applyRow.appendChild(applyBtn);
  body.appendChild(applyRow);

  document.body.appendChild(panel);
}

function mkButton(text, bg) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.style.cssText = `
    flex: 1;
    padding: 4px 8px;
    font-family: inherit;
    font-size: 11px;
    background: ${bg};
    color: rgba(255,255,255,0.92);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
  `;
  return b;
}
