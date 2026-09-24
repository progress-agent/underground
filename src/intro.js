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
// Two phases (sprint 24Sep26h, lane O). run() primes the start pose and locks
// the controls at module load, as before, but the descent then WAITS: the
// opening gate (src/loading-gate.js) calls begin() once the honest loading bar
// reports everything the descent shows, shaders compiled and a warm-up render
// done. isRunning() is true in both phases (the intro owns the camera from
// run()); isPlaying() is true only once the descent clock is advancing.
//
// All pose parameters are mutable via tune() + replay() so the tuning HUD
// (src/intro-tuner.js, gated on ?tuneIntro=1) can drive live iteration
// without a page reload. holdMs / phase1EndMs remain in the parameter
// set as tunables (default 0) for re-introducing a hold if ever desired.

import * as THREE from 'three';

const MAX_DURATION_MS = 15000; // hard watchdog, counted from the moment the descent starts playing

// Frame-safe clock (sprint 24Sep26h, lane O). The descent advances by the
// display frame delta, clamped to this many milliseconds per frame, so a
// main-thread stall pauses the flight instead of skipping part of it. The
// old wall clock kept running through the ~5s boot block and the camera
// resumed near its end pose (roughly 95% of the descent was never shown).
// 50ms matches the interactive recovery cap (D-027): full speed down to 20fps.
export const MAX_STEP_MS = 50;

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
  // overstayed. (Since sprint 24Sep26h it no longer covers loading: the
  // opening gate holds the descent until what it shows is ready.)
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

// ─── Path (pure) ───────────────────────────────────────────────────────────

/**
 * Camera position on the descent path after `ms` of played time. Pure, so the
 * tests can check sampled frames against the exact curve the intro flies.
 */
export function introPoseAt(params, ms) {
  const T = params.totalMs;
  if (ms >= T) return { x: params.endX, y: params.endY, z: params.endZ };
  const t = Math.max(0, ms);
  let y = params.startY;
  if (t >= params.holdMs) {
    const u = easeOutCubic((t - params.holdMs) / (T - params.holdMs));
    y = params.startY + (params.endY - params.startY) * u;
  }
  let x = params.startX, z = params.startZ;
  if (t > params.phase1EndMs) {
    const u = easeOutCubic((t - params.phase1EndMs) / (T - params.phase1EndMs));
    x = params.startX + (params.endX - params.startX) * u;
    z = params.startZ + (params.endZ - params.startZ) * u;
  }
  return { x, y, z };
}

export { easeOutCubic, DEFAULTS as INTRO_DEFAULTS };

// ─── Factory ───────────────────────────────────────────────────────────────

export function createIntro({ camera, controls, fpsControls, llToXZ, now = () => performance.now() }) {
  const params = { ...DEFAULTS };

  let finished = false;
  let started = false;      // run() called: intro owns the camera
  let playing = false;      // begin() called: descent clock advancing
  let skipRequested = false;
  let playedMs = 0;
  let playStartWall = 0;
  let firstPlayFrame = false;
  let anchorsResolved = false;
  let bypassed = false;

  function onSkip() { skipRequested = true; }

  // Render settings choose how the same visit is drawn, not where it starts.
  // Preserve explicit skips/deep-links while keeping the cinematic on preview
  // URLs such as ?buildings=baked (which formerly exposed the fallback pose).
  function shouldSkipByUrl() {
    if (typeof window === 'undefined' || !window.location) return false;
    const sp = new URLSearchParams(window.location.search);
    for (const setting of ['tuneIntro', 'buildings', 'ground', 'mh', 'bh', 'sky']) sp.delete(setting);
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

  function applyPose(p) {
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(params.lookX, params.lookY, params.lookZ);
    // Flush matrixWorld so the next station-label projection reads this
    // pose (same-frame, not next-frame). Without this the labels appear to
    // "drift" behind the camera during fast motion.
    camera.updateMatrixWorld(true);
  }

  function applyPoseK3() { applyPose({ x: params.endX, y: params.endY, z: params.endZ }); }

  function removeListeners() {
    document.removeEventListener('click', onSkip);
    document.removeEventListener('touchstart', onSkip);
    document.removeEventListener('keydown', onSkip);
  }

  function finalize() {
    if (finished) return;
    finished = true;
    playing = false;
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
      bypassed = true;
      finished = true;
      try { window.dispatchEvent(new CustomEvent('ug:intro-done')); } catch (e) {}
      return;
    }

    resolveAnchors();

    if (controls) controls.enabled = false;
    if (fpsControls) fpsControls.enabled = false;

    // Prime at K0 so every frame rendered while the loading bar is up (and
    // the warm-up render behind it) is the start pose. The descent itself
    // waits for begin().
    primeStart();
  }

  /** Put the camera back on the start pose (after the gate's warm-up renders). */
  function primeStart() {
    if (!started || finished) return;
    applyPose(introPoseAt(params, 0));
  }

  /**
   * Start the descent clock. Called by the opening gate when everything the
   * descent shows is ready. Frame 0 of the path is rendered on the next
   * update(); skip-on-input is armed only now, so a click during loading does
   * not forfeit the descent.
   */
  function begin() {
    if (!started || finished || playing) return;
    playing = true;
    playedMs = 0;
    firstPlayFrame = true;
    playStartWall = now();
    document.addEventListener('click',      onSkip, { once: true });
    document.addEventListener('touchstart', onSkip, { once: true, passive: true });
    document.addEventListener('keydown',    onSkip, { once: true });
    primeStart();
  }

  function update(dt) {
    if (finished || !playing) return;

    try {
      if (skipRequested) { applyPoseK3(); finalize(); return; }

      // Frame 0 of the path is drawn on the first frame after begin(),
      // whatever that frame's delta was.
      if (firstPlayFrame) firstPlayFrame = false;
      else playedMs += Math.min(Math.max(0, (dt || 0) * 1000), MAX_STEP_MS);

      if (playedMs >= params.totalMs || now() - playStartWall >= MAX_DURATION_MS) {
        applyPoseK3(); finalize(); return;
      }

      applyPose(introPoseAt(params, playedMs));
    } catch (e) {
      console.error('[intro] update failed', e);
      try { finalize(); } catch (_) { /* noop */ }
    }
  }

  function isRunning() { return started && !finished; }
  function isPlaying() { return playing && !finished; }
  function isBypassed() { return bypassed; }
  function getPlayedMs() { return playedMs; }
  function getPhase() {
    if (!started) return 'idle';
    if (bypassed) return 'bypassed';
    if (finished) return 'done';
    return playing ? 'playing' : 'waiting';
  }

  // ─── Tuner surface ───────────────────────────────────────────────────────

  function getParams() { return { ...params }; }

  function tune(partial) {
    Object.assign(params, partial || {});
    return api;
  }

  // Reset state and re-run with current params. Used by the tuning HUD's
  // Replay button, after the page has loaded, so it begins at once. Safe to
  // call whether intro is running or already done.
  function replay() {
    removeListeners();
    finished = false;
    started = false;
    playing = false;
    bypassed = false;
    skipRequested = false;
    playedMs = 0;
    run();
    begin();
  }

  /** Pose the camera at `ms` along the path (warm-up renders behind the bar). */
  function showPoseAt(ms) { applyPose(introPoseAt(params, ms)); }

  const api = { run, begin, primeStart, showPoseAt, update, isRunning, isPlaying, isBypassed, getPhase,
    getPlayedMs, tune, replay, getParams, poseAt: ms => introPoseAt(params, ms) };
  return api;
}
