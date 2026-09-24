// loading-gate.js — the opening gate (sprint 24Sep26h, lane O, D-038).
//
// Holds the April descent (src/intro.js, unchanged choreography) behind an
// honest loading bar until everything the descent shows is ready, then
// pre-compiles every shader, renders warm-up frames along the descent path
// behind the bar, fades the bar and starts the descent at frame 0. Silent:
// nothing here touches audio, which still starts on the first interaction.
//
// Stages, driven once per animation frame by frame():
//   loading   poll the layer readiness items (loading-readiness.js)
//   compiling renderer.compileAsync(scene, camera) over the whole scene, so
//             programs for layers first seen mid-descent (underground,
//             shadows) are linked now rather than as a frame stall later
//   warming   one extra composer render per frame at poses along the path
//             (with a forced shadow-map pass), uploading geometry, textures
//             and shadow programs the descent will need, all hidden by the bar
//   reveal    one ordinary frame at the start pose, then the bar fades and
//             intro.begin() starts the descent clock
//   done
//
// Two limits stop a layer that failed silently from holding the opening
// forever: an overall cap (capMs from boot) and a grace period after the core
// layers (terrain, ground, buildings, tube network) have settled. Past either,
// the remaining items are marked 'timeout' and the opening proceeds with what
// exists. Both are far beyond a healthy load (about 11s cold on the M5).

import { createReadiness } from './loading-readiness.js';

export const SHADERS_ID = 'shaders';
export const WARMUP_ID = 'warmup';

// Fractions of the descent at which warm-up frames are rendered. Frame 0 is
// the start pose itself (rendered by the ordinary tick while the bar is up).
export const WARM_FRACTIONS = [0.08, 0.2, 0.4, 0.6, 0.8, 0.93, 1];

export function createOpeningGate({
  intro, renderer, composer, scene, camera, items, el = null,
  capMs = 45000, coreIds = null, graceMs = 10000, beforeCompile = null, whileWaiting = null,
  now = () => performance.now(), dispatch = (name, detail) => {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) { /* noop */ }
  },
}) {
  const layerIds = items.map(i => i.id);
  const readiness = createReadiness([
    ...items,
    { id: SHADERS_ID, label: 'Preparing shaders', weight: 2 },
    { id: WARMUP_ID, label: 'Warming up the view', weight: 1 },
  ], { now });

  const t0 = now();
  let stage = 'loading';
  let warmIndex = 0;
  let revealFrames = 0;
  let coreSettledAt = null;
  const timeline = { created: 0 };
  const compile = { ms: null, programsBefore: null, programsAfter: null };
  const barLog = []; // every displayed percentage, with whether the set was complete
  let lastPct = -1;
  let fill = null, label = null, pct = null;
  if (el) {
    fill = el.querySelector('.fill');
    label = el.querySelector('.label');
    pct = el.querySelector('.pct');
  }

  const ms = () => Math.round(now() - t0);

  function render() {
    const f = readiness.fraction();
    const p = Math.floor(f * 100);
    const complete = readiness.allSettled();
    if (p !== lastPct) {
      lastPct = p;
      barLog.push({ at: ms(), pct: p, complete });
      if (fill) fill.style.width = `${p}%`;
      if (pct) pct.textContent = `${p}%`;
    }
    if (label) {
      const next = readiness.pending()[0];
      const text = next ? `${next.label}…` : 'Ready';
      if (label.textContent !== text) label.textContent = text;
    }
    if (el) el.setAttribute('aria-valuenow', String(p));
  }

  function startCompile() {
    stage = 'compiling';
    timeline.layersReady = ms();
    // Shadow participation flags are part of each program's key; settle them
    // for every current object before compiling (sun.js applies the same
    // policy lazily every 30 frames).
    try { beforeCompile?.(); } catch (e) { console.warn('[opening] pre-compile step failed', e); }
    const start = now();
    compile.programsBefore = renderer.info?.programs?.length ?? null;
    let p;
    try {
      p = typeof renderer.compileAsync === 'function'
        ? renderer.compileAsync(scene, camera)
        : Promise.resolve(renderer.compile(scene, camera));
    } catch (e) { p = Promise.reject(e); }
    p.then(() => {
      compile.ms = Math.round(now() - start);
      compile.programsAfter = renderer.info?.programs?.length ?? null;
      readiness.settle(SHADERS_ID);
    }, (e) => {
      console.warn('[opening] shader pre-compilation failed', e);
      compile.ms = Math.round(now() - start);
      readiness.settle(SHADERS_ID, 'failed');
    }).finally(() => {
      timeline.compiled = ms();
      stage = 'warming';
    });
  }

  function warmStep() {
    const params = intro.getParams();
    const f = WARM_FRACTIONS[warmIndex++];
    try {
      intro.showPoseAt(f * params.totalMs);
      // Force the shadow pass so its depth programs link now, not when the
      // descent first drops into shadow range.
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      composer.render(0);
    } catch (e) {
      console.warn('[opening] warm-up render failed', e);
    }
    intro.primeStart();
    readiness.setProgress(WARMUP_ID, warmIndex / WARM_FRACTIONS.length);
    if (warmIndex >= WARM_FRACTIONS.length) {
      readiness.settle(WARMUP_ID);
      timeline.warmed = ms();
      stage = 'reveal';
    }
  }

  function reveal() {
    stage = 'done';
    timeline.revealed = ms();
    if (el) el.classList.add('done');
    const snap = readiness.snapshot();
    intro.begin();
    dispatch('ug:opening-reveal', { ...snap, timeline: { ...timeline }, compile: { ...compile } });
  }

  /** Call once per animation frame, before intro.update(). */
  function frame() {
    if (stage === 'done') return;
    const phase = intro.getPhase();
    if (phase === 'bypassed' || phase === 'done' || phase === 'idle') {
      // Deep links bypass the opening (D-028), and a skip/replay may already
      // have finished it; the gate has nothing to hold.
      stage = 'done';
      timeline.abandoned = ms();
      return;
    }

    if (phase === 'playing') {
      // Something else started the descent (the tuner's Replay): stand down
      // rather than move the camera under it.
      stage = 'done';
      timeline.abandoned = ms();
      if (el) el.classList.add('done');
      return;
    }

    if (stage === 'loading') {
      readiness.poll();
      try { whileWaiting?.(); } catch (e) { console.warn('[opening] waiting step failed', e); }
      if (coreIds && coreSettledAt === null && readiness.allSettled(coreIds)) coreSettledAt = now();
      const graceOver = coreSettledAt !== null && now() - coreSettledAt >= graceMs;
      if (readiness.allSettled(layerIds)) startCompile();
      else if (now() - t0 >= capMs || graceOver) {
        const late = readiness.pending().filter(e => layerIds.includes(e.id)).map(e => e.id);
        console.warn(`[opening] ${graceOver ? `${graceMs}ms grace after the core layers` : `readiness cap of ${capMs}ms`} reached; proceeding without: ${late.join(', ')}`);
        readiness.expire(late);
        startCompile();
      }
    } else if (stage === 'warming') {
      warmStep();
    } else if (stage === 'reveal') {
      // The last warm-up frame's own tick rendered the start pose normally;
      // reveal now, so the first frame behind the fading bar is frame 0.
      if (++revealFrames >= 1) reveal();
    }
    render();
  }

  function getState() {
    return { stage, elapsedMs: ms(), fraction: readiness.fraction(), readiness: readiness.snapshot(),
      timeline: { ...timeline }, compile: { ...compile }, barLog: barLog.slice() };
  }

  render();
  return { frame, getState, readiness };
}
