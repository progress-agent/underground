// intro.js — Track C cinematic opening sequence.
//
// Silent one-shot plunge from high above Oxford Circus, ending below street
// level looking diagonally toward OXC. Motion profile is pure easeOut —
// maximum velocity at t=0, monotonically decelerating to rest at t=totalMs.
// No standstill phase, no S-curve: the altimeter reads Y_START on frame 0
// and the camera is already in motion by frame 1. Fixed totalMs — no
// mid-flight duration recomputation (a ready-gate swap in an earlier
// version caused a one-tick "cut" discontinuity). Controls are locked
// for the duration.
//
// All pose parameters are mutable via tune() + replay() so the tuning HUD
// (src/intro-tuner.js, gated on ?tuneIntro=1) can drive live iteration
// without a page reload. holdMs / phase1EndMs remain in the parameter
// set as tunables (default 0) for re-introducing a hold if ever desired.

import * as THREE from 'three';

const MAX_DURATION_MS = 15000; // hard watchdog — intro must finalize by this

// ─── Tunable parameters (defaults) ─────────────────────────────────────────
// All coords are in scene units. `null` placeholders are resolved to the
// Oxford Circus anchor on first run(). After first run they are concrete
// numbers that tune() can mutate.
const DEFAULTS = {
  // startY is in scene units. Altimeter displays (y - surfaceY) / VE=5 in real
  // metres, so 25000 scene units ≈ 5000m altimeter reading — the design target.
  // 5000 scene units used to be a bug: it displayed as ~980m, not 5000m.
  startX: null, startY: 25000,  startZ: null,
  // End pose and lookAt tuned via ?tuneIntro=1 HUD (21Apr26t). Gentle ~2.75°
  // pitch-up, ~1km XZ offset — reads as a wide cityscape settle rather than
  // the original tight 200m-SE-of-OXC framing.
  endX:   -194.15, endY:  -39.00, endZ:   -2162.75,
  lookX:  -988.47, lookY: 8.96,   lookZ:  -1557.14,
  holdMs:      0,      // altitude holds at startY for this long (0 = start moving immediately)
  phase1EndMs: 0,      // XZ holds at start until this elapsed time (0 = start moving immediately)
  // totalMs tuned for 25000-scene-unit start — 9s gives dramatic plunge with the
  // easeOutCubic curve shape Jordan approved. Shorter made it rushed; longer
  // overstayed. Also provides ~3s of cover for surface tiles loading beneath.
  totalMs:     9000,
};

// Default end offset from OXC (only applied when endX/endZ are null at
// first run). 200m SE, y=-39 → ~11° pitch-up from horizontal.
const DEFAULT_END_OFFSET_X =  141.421356;
const DEFAULT_END_OFFSET_Z = -141.421356;

// ─── Easing ────────────────────────────────────────────────────────────────

// easeOutCubic — peak velocity at t=0, monotonically decelerating to t=1.
// Chosen over expOut (too aggressive, flashes the start altitude in <200ms)
// and easeInOutCubic (S-curve, starts at standstill — reads as "pause").
function easeOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createIntro({ camera, controls, fpsControls, llToXZ }) {
  const params = { ...DEFAULTS };

  let finished = false;
  let started = false;
  let skipRequested = false;
  let startTime = 0;
  let anchorsResolved = false;

  function onSkip() { skipRequested = true; }

  // Preserve "any URL param bypasses intro" so deep-links (e.g. ?hx=5) skip
  // the cinematic, but whitelist ?tuneIntro=1 — otherwise the tuner can't
  // actually drive the intro it's meant to tune.
  function shouldSkipByUrl() {
    if (typeof window === 'undefined' || !window.location) return false;
    const sp = new URLSearchParams(window.location.search);
    sp.delete('tuneIntro');
    return sp.size > 0;
  }

  function resolveAnchors() {
    if (anchorsResolved) return;
    const oxc = llToXZ(51.515224, -0.141903);
    if (params.startX == null) params.startX = oxc.x;
    if (params.startZ == null) params.startZ = oxc.z;
    if (params.endX   == null) params.endX   = oxc.x + DEFAULT_END_OFFSET_X;
    if (params.endZ   == null) params.endZ   = oxc.z + DEFAULT_END_OFFSET_Z;
    if (params.lookX  == null) params.lookX  = oxc.x;
    if (params.lookZ  == null) params.lookZ  = oxc.z;
    anchorsResolved = true;
  }

  function applyPoseK3() {
    camera.position.set(params.endX, params.endY, params.endZ);
    camera.lookAt(params.lookX, params.lookY, params.lookZ);
    // Flush matrixWorld so the next station-label projection reads the
    // final pose (same-frame, not next-frame). Without this the labels
    // appear to "drift" behind the camera during fast motion.
    camera.updateMatrixWorld(true);
  }

  function removeListeners() {
    document.removeEventListener('click', onSkip);
    document.removeEventListener('touchstart', onSkip);
    document.removeEventListener('keydown', onSkip);
  }

  function finalize() {
    if (finished) return;
    finished = true;
    removeListeners();

    if (controls) controls.enabled = true;
    if (fpsControls) fpsControls.enabled = true;

    // Re-sync OrbitControls target to current camera forward so the first
    // post-intro drag doesn't snap the view.
    if (controls && controls.target) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      controls.target.copy(camera.position).add(forward.multiplyScalar(1000));
    }

    try {
      window.dispatchEvent(new CustomEvent('ug:intro-done'));
    } catch (e) { /* noop — CustomEvent always works in browser contexts */ }
  }

  function run() {
    if (started) return;
    started = true;

    if (shouldSkipByUrl()) {
      finished = true;
      try { window.dispatchEvent(new CustomEvent('ug:intro-done')); } catch (e) {}
      return;
    }

    resolveAnchors();

    if (controls) controls.enabled = false;
    if (fpsControls) fpsControls.enabled = false;

    document.addEventListener('click',      onSkip, { once: true });
    document.addEventListener('touchstart', onSkip, { once: true, passive: true });
    document.addEventListener('keydown',    onSkip, { once: true });

    // Prime at K0 so the very first render frame is correct even before
    // update() ticks.
    camera.position.set(params.startX, params.startY, params.startZ);
    camera.lookAt(params.lookX, params.lookY, params.lookZ);
    camera.updateMatrixWorld(true);

    // startTime=0 is a sentinel meaning "not armed yet". The first update()
    // call sets it to performance.now(). This excludes any sync-setup block
    // between run() and the first tick() from the elapsed clock — without
    // this guard, heavy boot work (mesh creation, shader compile, tile prefetch)
    // would eat 2-3 seconds off the front of the descent, causing the camera
    // to visibly start at ~1000m instead of startY.
    startTime = 0;
  }

  function update(/* dt */) {
    if (finished || !started) return;

    // Arm the clock on first tick — see startTime=0 comment in run().
    if (startTime === 0) {
      startTime = performance.now();
      return;
    }

    try {
      const elapsedMs = performance.now() - startTime;

      if (skipRequested) { applyPoseK3(); finalize(); return; }

      const T = params.totalMs;
      if (elapsedMs >= T || elapsedMs >= MAX_DURATION_MS) {
        applyPoseK3(); finalize(); return;
      }

      // Altitude — optional hold for holdMs (default 0), then easeOutCubic
      // to endY. With holdMs=0 the camera is in motion from frame 0.
      let y;
      if (elapsedMs < params.holdMs) {
        y = params.startY;
      } else {
        const u = easeOutCubic((elapsedMs - params.holdMs) / (T - params.holdMs));
        y = params.startY + (params.endY - params.startY) * u;
      }

      // XZ — optional hold for phase1EndMs (default 0), then easeOutCubic
      // to end. With phase1EndMs=0 the XZ drift tracks altitude from t=0.
      let px = params.startX;
      let pz = params.startZ;
      if (elapsedMs > params.phase1EndMs) {
        const u = easeOutCubic((elapsedMs - params.phase1EndMs) / (T - params.phase1EndMs));
        px = params.startX + (params.endX - params.startX) * u;
        pz = params.startZ + (params.endZ - params.startZ) * u;
      }

      camera.position.set(px, y, pz);
      camera.lookAt(params.lookX, params.lookY, params.lookZ);
      camera.updateMatrixWorld(true);
    } catch (e) {
      console.error('[intro] update failed', e);
      try { finalize(); } catch (_) { /* noop */ }
    }
  }

  function isRunning() { return started && !finished; }

  // ─── Tuner surface ───────────────────────────────────────────────────────

  function getParams() { return { ...params }; }

  function tune(partial) {
    Object.assign(params, partial || {});
    return api;
  }

  // Reset state and re-run with current params. Used by the tuning HUD's
  // Replay button. Safe to call whether intro is running or already done.
  function replay() {
    removeListeners();
    finished = false;
    started = false;
    skipRequested = false;
    startTime = 0;
    run();
  }

  const api = { run, update, isRunning, tune, replay, getParams };
  return api;
}
