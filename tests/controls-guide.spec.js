// controls-guide.spec.js — D-003 Round 4 widget coverage.
//
// Reveal trigger: per-frame altitude predicate in main.js calls
// controlsGuide.forceReveal() once the camera is within 500 scene units of
// the terrain surface (~100m altimeter reading at VE=5). Tests drive the
// reveal directly via window.__ug.controlsGuide.forceReveal() for
// deterministic timing — natural reveal would race with async terrain mesh
// load.
//
// Uses ?fast=1 — this URL param does double duty:
//   1. ANY non-whitelisted query bypasses intro (intro.js fast path), so the
//      cinematic doesn't run.
//   2. Compresses the controls-guide show-window from 30s to 3s so the spec
//      finishes in ~10s instead of ~40s.
//
// Compressed timeline (with ?fast=1, after forceReveal()):
//   t=0      forceReveal called -> .ready added, captions opaque
//   t=3.0s   captions add .is-faded -> fade out over 800ms
//   t=3.2s   shift-message adds .is-visible -> fades in over 800ms
//   t~4.0s   captions invisible, shift visible
//   t=8.2s   shift removes .is-visible -> fades out
//   t~9.0s   shift invisible
//
// The original 30s/37s design contract is verified implicitly via the
// compression ratio — show=3000ms, shift hold=5000ms, fade=800ms are all
// shared with the production timeline.
//
// Timeline race (diagnosed 06Sep26u, verified and fixed 24Sep26h, sprint
// 23Sep26w lane E). The timeline tests used to sample class state from the
// test side against a wall clock they did not own. Measured on d1a2f7b:
//   - the tick loop's altitude predicate (D-004, 8833893) reveals the widget
//     ~300ms after load, BEFORE the test's forceReveal() (~600ms), in 12/12
//     instrumented runs; the test's call is a no-op and t=0 is not its own;
//   - the first full render then blocks the main thread for ~3.2s while
//     three.js links shader programs (CPU profile: WebGLProgram.getUniforms
//     -> onFirstUse 2.6s inside tick -> composer.render). The 3s fade timer
//     falls due inside that freeze and runs as soon as it ends, racing the
//     test's queued checks: ':39' saw all 8 captions already faded.
// Under full-suite GPU contention the freeze grows, and fixed 5s/7s waits
// counted in Node wall-clock can expire, or both shift timers can fire
// back-to-back after the freeze so 'is-visible' is never observed (':91').
//
// Fix: an init script records every class transition with the PAGE clock
// (performance.now) from before any page script runs. Tests assert the
// recorded sequence against the real reveal instant. Timers never fire
// early, so lower bounds relative to the reveal are deterministic; freezes
// can only delay events, which the generous waits absorb.
// Fix round 1: the shift fade-in used to be checked by polling computed
// opacity for 1500ms, which a freeze landing inside the 800ms fade still
// failed. It is now asserted from the transition the page itself starts
// (target 1, 800ms) and from that transition's recorded end state, with a
// dedicated freeze regression test.

import { test, expect } from '@playwright/test';

const FAST = '/?fast=1';
const SHOW_MS = 3000;          // SHOW_MS_FAST
const SHIFT_DELAY_MS = 200;
const SHIFT_HOLD_MS = 5000;
const EARLY_EPSILON_MS = 20;   // timer-clamping / clock-granularity allowance
const TIMELINE_WAIT_MS = 30000; // absorbs startup freezes under suite load

// Install before any page script: record widget class transitions on the
// page clock, plus a snapshot of the captions at the instant of reveal.
async function recordTimeline(page) {
  await page.addInitScript(() => {
    const t = window.__cgTimeline = {};
    const now = () => performance.now();
    // Anchor the reveal SYNCHRONOUSLY at classList.add('ready'), which
    // forceReveal() calls just before scheduling its timers, so every
    // measured interval is a true lower bound. (A MutationObserver record
    // lands at the end of the revealing tick, up to a frame late, which
    // would shrink the intervals by that much.)
    const owners = new WeakMap();
    const classList = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
    Object.defineProperty(Element.prototype, 'classList', {
      ...classList,
      get() { const list = classList.get.call(this); owners.set(list, this); return list; },
    });
    let capturing = false;
    const setTimeoutNative = window.setTimeout;
    window.setTimeout = function (fn, delay, ...rest) {
      if (capturing) t.scheduled.push(delay);
      return setTimeoutNative.call(this, fn, delay, ...rest);
    };
    const add = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...tokens) {
      const result = add.apply(this, tokens);
      const root = owners.get(this);
      if (t.readyAt === undefined && root?.id === 'ug-controls-guide' && tokens.includes('ready')) {
        t.readyAt = now();
        // forceReveal() schedules its fade timers synchronously after this
        // add; capture their requested delays until the task yields. A
        // startup freeze can delay when a timer FIRES (masking an early fade
        // in the observed intervals), but never what was scheduled.
        t.scheduled = [];
        capturing = true;
        queueMicrotask(() => { capturing = false; });
        const targets = [...root.querySelectorAll('.fade-target')];
        const box = (sel) => { const r = root.querySelector(sel)?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
        t.atReveal = {
          targets: targets.length,
          faded: targets.filter((el) => el.classList.contains('is-faded')).length,
          titleBox: box('.title'),
          roleBox: box('.cluster-role'),
        };
      }
      return result;
    };
    // Later transitions only need "not early", so an end-of-task record is
    // safe: lateness can only lengthen the measured intervals.
    new MutationObserver(() => {
      const root = document.getElementById('ug-controls-guide');
      if (!root || t.readyAt === undefined) return;
      const targets = root.querySelectorAll('.fade-target');
      const faded = [...targets].filter((el) => el.classList.contains('is-faded')).length;
      if (t.firstFadedAt === undefined && faded > 0) t.firstFadedAt = now();
      if (t.allFadedAt === undefined && targets.length && faded === targets.length) t.allFadedAt = now();
      const shiftEl = root.querySelector('.shift-message');
      const shift = shiftEl?.classList.contains('is-visible');
      if (t.shiftOnAt === undefined && shift) {
        t.shiftOnAt = now();
        // Capture the fade-in the class change starts, synchronously and on
        // the page: flush style so the CSS transition exists, then read its
        // declared target and duration. This is a property of the stylesheet
        // plus the class, so no later main-thread freeze can alter it
        // (a wall-clock opacity poll could: see the header).
        getComputedStyle(shiftEl).opacity;
        const tr = shiftEl.getAnimations().find((a) => a.transitionProperty === 'opacity');
        const frames = tr?.effect.getKeyframes() ?? [];
        t.shiftFadeIn = tr ? {
          to: frames[frames.length - 1]?.opacity,
          duration: tr.effect.getTiming().duration,
        } : null;
        // Terminal outcome of that transition: it either completes (and the
        // element then rests at its target) or is cancelled because the hold
        // ended during a freeze. Either way it is recorded, never polled.
        const done = (kind) => (ev) => {
          if (ev.propertyName !== 'opacity' || t.shiftFadeInEnd) return;
          t.shiftFadeInEnd = { kind, opacity: getComputedStyle(shiftEl).opacity, visible: shiftEl.classList.contains('is-visible') };
        };
        shiftEl.addEventListener('transitionend', done('end'));
        shiftEl.addEventListener('transitioncancel', done('cancel'));
      }
      if (t.shiftOnAt !== undefined && t.shiftOffAt === undefined && !shift) t.shiftOffAt = now();
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}

// Wait for the dev surface to mount, then trigger the reveal explicitly (a
// no-op when the altitude predicate has already revealed; see header).
async function gotoAndReveal(page) {
  await recordTimeline(page);
  await page.goto(FAST);
  await page.waitForFunction(() => !!(window.__ug && window.__ug.controlsGuide), null, { timeout: 8000 });
  await page.evaluate(() => window.__ug.controlsGuide.forceReveal());
}

async function timelineWhen(page, key) {
  await page.waitForFunction((k) => window.__cgTimeline?.[k] !== undefined, key, { timeout: TIMELINE_WAIT_MS });
  return page.evaluate(() => window.__cgTimeline);
}

test('widget visible after forceReveal with all caption labels opaque', async ({ page }) => {
  await gotoAndReveal(page);

  // Root reveals via .ready immediately on forceReveal().
  const root = page.locator('#ug-controls-guide');
  await expect(root).toHaveClass(/ready/, { timeout: 2000 });

  // Captions opaque (not yet faded) at the instant of reveal, captured by the
  // page itself rather than sampled after an uncontrolled delay.
  const t = await timelineWhen(page, 'readyAt');
  expect(t.atReveal.targets).toBeGreaterThan(0);
  expect(t.atReveal.faded).toBe(0);
  expect(t.atReveal.titleBox).toBe(true);
  expect(t.atReveal.roleBox).toBe(true);
  // Timeline as scheduled at reveal: captions fade, shift in, shift out.
  expect(t.scheduled).toEqual([SHOW_MS, SHOW_MS + SHIFT_DELAY_MS, SHOW_MS + SHIFT_DELAY_MS + SHIFT_HOLD_MS]);

  // Sanity sample — title visible, action labels visible.
  await expect(page.locator('#ug-controls-guide .title')).toBeVisible();
  await expect(page.locator('#ug-controls-guide .cluster-role')).toBeVisible();

  // And they stay unfaded for the whole show window: no caption fades early.
  const faded = await timelineWhen(page, 'firstFadedAt');
  expect(faded.firstFadedAt - faded.readyAt).toBeGreaterThanOrEqual(SHOW_MS - EARLY_EPSILON_MS);
});

test('caption labels faded ~3s after reveal (compressed)', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  // Every caption fades, and not before the show window has elapsed.
  const t = await timelineWhen(page, 'allFadedAt');
  expect(t.firstFadedAt - t.readyAt).toBeGreaterThanOrEqual(SHOW_MS - EARLY_EPSILON_MS);

  // Confirm computed opacity has gone to 0 after the 800ms transition. The
  // 800ms contract is the declared transition; the final state is terminal,
  // so waiting for it through a startup freeze cannot mask a regression.
  await expect(page.locator('#ug-controls-guide .title')).toHaveCSS('transition-duration', '0.8s');
  await expect(page.locator('#ug-controls-guide .title')).toHaveCSS('opacity', '0', { timeout: TIMELINE_WAIT_MS });
});

test('shift-message visible ~3.2s after reveal', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  // .is-visible arrives on .shift-message no sooner than showMs +
  // SHIFT_DELAY_MS = 3200ms after reveal, and after the captions fade.
  const t = await timelineWhen(page, 'shiftOnAt');
  expect(t.shiftOnAt - t.readyAt).toBeGreaterThanOrEqual(SHOW_MS + SHIFT_DELAY_MS - EARLY_EPSILON_MS);
  expect(t.shiftOnAt).toBeGreaterThanOrEqual(t.firstFadedAt);

  await assertShiftFadeIn(page, t);
});

// The fade-in contract, asserted from page-side records only (fix round 1).
// The previous check polled computed opacity with a 1500ms Node-side
// timeout, so any main-thread freeze of more than ~0.7s landing inside the
// 800ms fade failed it (verifier: 3/3 fails with a 2.5s busy-wait injected
// 100ms after shift-in; opacity read 0.61, 0.58, 0.086).
async function assertShiftFadeIn(page, t) {
  // The class change starts an 800ms opacity transition whose target is 1.
  expect(t.shiftFadeIn).toEqual({ to: '1', duration: 800 });
  // And that transition resolves. While the message is still held visible
  // it can only resolve by completing, at rest on opacity 1. Only if a
  // freeze outlasted the whole 5s hold can the removal of .is-visible get
  // there first, and then the fade-out test owns the outcome.
  await page.waitForFunction(() => !!window.__cgTimeline?.shiftFadeInEnd, null, { timeout: TIMELINE_WAIT_MS });
  const end = await page.evaluate(() => window.__cgTimeline.shiftFadeInEnd);
  if (end.visible) expect(end).toEqual({ kind: 'end', opacity: '1', visible: true });
  return end;
}

// Regression for the verifier's deterministic reproduction: freeze the main
// thread for 2.5s starting 100ms after .is-visible lands, i.e. mid fade-in.
// The old opacity poll failed this 3/3; the page-side records must not care.
test('shift-message fade-in contract survives a freeze mid fade-in', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      const el = document.querySelector('#ug-controls-guide .shift-message.is-visible');
      if (!el) return;
      obs.disconnect();
      setTimeout(() => { const until = performance.now() + 2500; while (performance.now() < until) { /* freeze */ } }, 100);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await gotoAndReveal(page);
  const t = await timelineWhen(page, 'shiftOnAt');
  expect(t.shiftOnAt - t.readyAt).toBeGreaterThanOrEqual(SHOW_MS + SHIFT_DELAY_MS - EARLY_EPSILON_MS);
  // A 2.5s freeze ends ~2.4s inside the 5s hold, so the fade-in must have
  // completed at opacity 1 while still visible: strict, no branch.
  const end = await assertShiftFadeIn(page, t);
  expect(end).toEqual({ kind: 'end', opacity: '1', visible: true });
});

test('shift-message gone ~9s after reveal (after 5s hold + 800ms fade)', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  // After SHIFT_HOLD_MS=5000ms, the .is-visible class is removed. Total from
  // reveal: showMs(3000) + SHIFT_DELAY(200) + SHIFT_HOLD(5000) ~ 8.2s. The
  // recorder sees both transitions even if a freeze runs the timers
  // back-to-back.
  const t = await timelineWhen(page, 'shiftOffAt');
  expect(t.scheduled).toEqual([SHOW_MS, SHOW_MS + SHIFT_DELAY_MS, SHOW_MS + SHIFT_DELAY_MS + SHIFT_HOLD_MS]);
  expect(t.shiftOnAt).toBeDefined();
  expect(t.shiftOnAt - t.readyAt).toBeGreaterThanOrEqual(SHOW_MS + SHIFT_DELAY_MS - EARLY_EPSILON_MS);
  expect(t.shiftOffAt - t.readyAt).toBeGreaterThanOrEqual(SHOW_MS + SHIFT_DELAY_MS + SHIFT_HOLD_MS - EARLY_EPSILON_MS);
  // >= not >: after a long freeze both timers run back-to-back and the page
  // clock (100us resolution) can stamp them identically. Order is still
  // guaranteed, since shiftOffAt is only recorded once shiftOnAt exists.
  expect(t.shiftOffAt).toBeGreaterThanOrEqual(t.shiftOnAt);

  // Opacity reaches 0 after 800ms fade (declared duration; terminal state).
  await expect(page.locator('#ug-controls-guide .shift-message')).toHaveCSS('transition-duration', '0.8s');
  await expect(page.locator('#ug-controls-guide .shift-message')).toHaveCSS('opacity', '0', { timeout: TIMELINE_WAIT_MS });
});

test('click on Q key dispatches synthetic KeyboardEvent with code KeyQ', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  // Install a window-level keydown listener that records every event into
  // window.__capturedCodes. We can't share closures with the browser, so we
  // store on window and read back via evaluate.
  await page.evaluate(() => {
    window.__capturedCodes = [];
    window.addEventListener('keydown', (ev) => { window.__capturedCodes.push(ev.code); });
  });

  // Click the Q tile — pointerdown handler will dispatch KeyboardEvent.
  await page.locator('#ug-controls-guide .key[data-k="q"]').click();

  // Assert captured code includes KeyQ.
  const codes = await page.evaluate(() => window.__capturedCodes);
  expect(codes).toContain('KeyQ');

  // Visual side-effect — Q tile becomes .is-pressed via the synthetic keydown
  // round-tripping through window listener. After mouseup, .is-pressed is
  // removed via pointerup (which dispatches keyup).
  // We don't assert the steady-state class because the click() call already
  // released the pointer — just verify the keyup also fired.
  expect(codes.filter((c) => c === 'KeyQ').length).toBeGreaterThanOrEqual(1);
});

test('arrow key click dispatches ArrowUp', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  await page.evaluate(() => {
    window.__capturedCodes = [];
    window.addEventListener('keydown', (ev) => { window.__capturedCodes.push(ev.code); });
  });

  await page.locator('#ug-controls-guide .key[data-k="up"]').click();

  const codes = await page.evaluate(() => window.__capturedCodes);
  expect(codes).toContain('ArrowUp');
});

test('clicking W tile feeds fpsControls.keys with "w" (synthetic key carries .key)', async ({ page }) => {
  await gotoAndReveal(page);
  await expect(page.locator('#ug-controls-guide')).toHaveClass(/ready/, { timeout: 2000 });

  // A full click dispatches keydown then keyup, so fpsControls.keys is emptied
  // again by the time we read it. Snapshot the Set at the instant of keydown —
  // that captures the mutation the synthetic event drives. If the synthetic
  // event omitted `key`, main.js's e.key.toLowerCase() listener would add
  // `undefined`-derived garbage (never 'w'), so this asserts the fix directly.
  await page.evaluate(() => {
    window.__keysAtDown = [];
    window.addEventListener('keydown', () => {
      window.__keysAtDown = Array.from(window.__ug.fpsControls.keys);
    });
  });

  await page.locator('#ug-controls-guide .key[data-k="w"]').click();

  const keysAtDown = await page.evaluate(() => window.__keysAtDown);
  expect(keysAtDown).toContain('w');
});
