// opening-v1.js (s21:V1): opening study variant 1, "In order". A prototype preview, never live, never merged.
//
// A light title card covers the long build block. When terrain, water, the M25 ring and the airport check are
// settled the card fades onto bare relief seen straight down from the start height, and the world arrives in a
// legible order, one beat at a time, each with a small caption: the water, the streets and parks, the bridges
// (and roads and airports if the frame shows them), the railways, then the city rising out of the ground.
// The descent begins at the later of the rise's end plus 0.6 s and the gate being done.
//
// Beats are timed on a clock that advances by the display frame delta (clamped to 50 ms), so a frozen frame
// pauses the sequence instead of skipping a beat. Objects of a beat that has not played are hidden only inside the
// render call (assembly-mask.js), so compileAsync and the warm-ups still see and upload them.
import { easeOutCubic } from './opening-path.js';

const RISE_MS = 1400;
const AFTER_RISE_MS = 600;
const STEP_MAX_MS = 50;
const BEAT_PATIENCE_MS = 9000; // a beat whose items never settle still plays this long after its slot (a failed layer must not hang the demo)

export function createOpeningV1({
  intro, gate, camera, scene, el, path, startAltM, vista, params, getLayers, setGroundArt, riseUniforms,
  getHeightScale, lateLayers, now = () => performance.now(),
}) {
  const readiness = gate.readiness;
  const record = (phase, extra = {}) => {
    const detail = { phase, at: now(), stage: gate.stage(), fraction: readiness.fraction(), ...extra };
    const rec = window.__ugOpening;
    if (rec) rec.phases.push(detail);
    try { window.dispatchEvent(new CustomEvent('ug:opening-phase', { detail })); } catch (_) { /* noop */ }
  };

  // Deferred layers (L's registry) that a high start may see in frame: ask for them at boot, show them when they attach.
  const highStart = startAltM >= 18000;
  if (highStart && lateLayers) { try { lateLayers.request('motorway'); lateLayers.request('airports'); } catch (_) { /* noop */ } }

  const BEATS = [
    { name: 'water', slot: 700, items: ['water'], caption: 'The Thames' },
    { name: 'ground', slot: 1400, items: ['ground', 'parks'], caption: 'Streets and parks' },
    { name: 'roads', slot: 2100, items: ['bridges'], caption: highStart ? 'Roads, bridges and airports' : 'Bridges' },
    { name: 'railways', slot: 2800, items: ['tube', 'overground'], caption: 'The railways' },
    { name: 'city', slot: 3500, items: ['buildings'], caption: 'The city' },
  ];
  const fired = {};

  // Caption (bottom centre, small capitals).
  const cap = document.createElement('div');
  cap.id = 'ugCaption';
  document.body.appendChild(cap);
  function showCaption(text) {
    cap.textContent = text;
    cap.classList.remove('show');
    void cap.offsetWidth; // restart the CSS animation
    cap.classList.add('show');
  }

  document.body.classList.add('ug-assembling');
  // Every building starts below ground; the tallest tower's height at the current height scale.
  const depthNow = () => 1700 * Math.max(0.05, getHeightScale());
  riseUniforms.uRiseFront.value = 0;
  riseUniforms.uRiseBand.value = 1;
  riseUniforms.uRiseDepth.value = depthNow();

  let tick0 = false;
  let lifted = false;
  let clock = 0;           // ms since the cover lifted
  let riseStart = null;    // clock value at which the rise began
  let riseEnded = false;
  let riseEndClock = 0;
  let gateDone = false;
  let begun = false;
  let crossed = false;
  const hiddenList = [];

  window.addEventListener('ug:intro-done', () => {
    record('landed', { x: camera.position.x, y: camera.position.y, z: camera.position.z });
  }, { once: true });

  const push = (o) => { if (o) hiddenList.push(o); };
  function computeHidden() {
    hiddenList.length = 0;
    if (begun) return;
    const L = getLayers();
    if (!fired.water) { push(L.thames); push(L.reservoirs); push(L.canals); }
    if (!fired.ground) push(L.parks);
    if (!fired.roads) { push(L.bridges); push(L.motorway); push(L.m25road); push(L.airports); push(L.dock); }
    if (!fired.railways) {
      push(L.overground);
      for (const c of scene.children) {
        const kind = c.userData?.kind, n = c.name || '';
        if (kind === 'surface-rail' || n.startsWith('surface-rail') || n === 'surface-trains' || (kind === 'station-markers' && c.userData.surfaceOnly)) hiddenList.push(c);
      }
    }
    if (!fired.city) { push(L.stationBuildings); push(L.landmarks); }
    else if (!riseEnded && riseUniforms.uRiseFront.value < 0.6) push(L.landmarks);
  }

  function fireBeat(b) {
    fired[b.name] = true;
    record(`beat:${b.name}`);
    showCaption(b.caption);
    if (b.name === 'ground') { groundOn = true; setGroundArt(true); }
    if (b.name === 'railways') document.body.classList.remove('ug-assembling');
    if (b.name === 'city') riseStart = clock;
  }
  let groundOn = false;

  function update(dt) {
    if (begun || intro.isBypassed()) return;
    if (!tick0) { tick0 = true; record('cover-on'); }

    // Ground artwork stays off until its beat; the terrain material recreates the uniform at 1.0 whenever it compiles.
    if (!groundOn) setGroundArt(false);

    if (!lifted) {
      const ready = readiness.allSettled(['terrain', 'water', 'm25', 'airports']);
      if (ready || gateDone) {
        lifted = true;
        clock = 0;
        el?.classList.add('done');
        record('cover-lifted');
      }
      computeHidden();
      return;
    }

    clock += Math.min(Math.max(0, (dt || 0) * 1000), STEP_MAX_MS);

    // Beats in order, each at the later of its slot and its items being settled.
    for (const b of BEATS) {
      if (fired[b.name]) continue;
      if (clock >= b.slot && (readiness.allSettled(b.items) || clock >= b.slot + BEAT_PATIENCE_MS)) fireBeat(b);
      break; // strictly in order
    }

    // The rise.
    if (riseStart !== null && !riseEnded) {
      const t = (clock - riseStart) / RISE_MS;
      riseUniforms.uRiseDepth.value = depthNow();
      if (t >= 1) {
        riseUniforms.uRiseFront.value = 1e9;
        riseEnded = true;
        riseEndClock = clock;
        record('rise-end');
      } else riseUniforms.uRiseFront.value = easeOutCubic(Math.max(0, t));
    }

    // The right moment: the later of the rise's end + 0.6 s and the gate being done.
    if (riseEnded && gateDone && clock >= riseEndClock + AFTER_RISE_MS && !begun) {
      begun = true;
      hiddenList.length = 0;
      document.body.classList.remove('ug-assembling');
      riseUniforms.uRiseFront.value = 1e9;
      record('descent-begin');
      intro.begin();
      return;
    }
    computeHidden();
  }

  // After the descent has begun: only the crossing record (a read-only watcher, called every frame from the tick).
  function watch() {
    if (!begun || crossed || !intro.isPlaying()) return;
    if (path.arcAt(intro.getPlayedMs()) >= path.uC) { crossed = true; record('crossing'); }
  }

  return {
    update(dt) { update(dt); watch(); },
    hidden: () => hiddenList,
    coverLifted: () => lifted,
    onReady() { gateDone = true; },
    isFinished: () => begun,
  };
}
