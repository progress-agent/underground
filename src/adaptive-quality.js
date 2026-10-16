// Automatic rendering quality (sprint 24Sep26h, Lane R, D-038; supersedes the
// 11Sep26f controller). Target: about 60 fps. Near-camera sun shadows are the
// first thing to go (FIRST_UNSHADOWED, the rung after full quality, is full
// resolution and full edge smoothing without shadows, and no lower rung brings
// them back); then resolution and edge smoothing fall in fine steps. The
// clouds are never on the ladder (D-043): every cloud is always drawn.
//
// What changed, and why (profile 24Sep26h, Working/sprint-24Sep26h/profile.md):
// - Finer rungs. The old ladder jumped 100% -> 85% -> 75%/2x -> 60%/2x -> 50%/off.
// - A band, not a line. It drops only after the mean frame interval has been
//   over budget (below ~54.5 fps) for two consecutive windows, and probes up
//   only when comfortably inside budget. The old p75 threshold sat on the
//   60Hz boundary, where a 17ms frame presents as 33ms and tripped a double
//   drop.
// - It checks that dropping helped. Street and river views are CPU-bound:
//   lowering resolution did nothing, yet the old controller kept dropping to
//   the 35% floor. One fine rung is too small to measure through frame noise,
//   so the check is made over a descent: from the level where it began, the
//   controller keeps stepping down until at least 35% of the pixel work is
//   shed; if by then the frame interval has not improved by 10% (and is not
//   within budget), it returns to where the descent began and holds there.
//   Any improvement re-anchors the descent. The shadows rung is exempt: it is
//   the agreed first thing to go.
// - The shadows rung keeps the old controller's tolerance (integration fix,
//   24Sep26h). Leaving full quality (shadows on) needs the mean interval over
//   1.14 x target (19ms, ~52.6 fps), the old controller's 19ms line, rather
//   than the 1.10 band used below it. River at Greenwich runs at about 17.7 to
//   18ms with shadows on the M5 (plus ~0.2ms of sky); at 1.10 (18.3ms) its
//   noisy windows tripped the rung and shadows were lost there, which the
//   previous controller never did. A probe back up to shadows is judged
//   against the same 19ms line, so a ~56 fps view is allowed to keep them.
//   Coming back (sprint 25Sep26f, Step 0): every rung probes up when the mean
//   of its recent in-band windows (the last 3s) is at or below 1.07 x target
//   (17.8ms, ~56 fps). The first fix loosened only the no-shadow rung's line, and each
//   window had to clear it on its own, four in a row. A camera arriving at a
//   CPU-bound river view several rungs down (from a GPU-heavy street) wanders
//   17.1 to 17.9ms per window, so it held at 92% or 85% without shadows for
//   good. A probe that costs more than the view can afford fails against the
//   rung's own drop line (18.3ms, or 19ms for shadows) and backs off. So does
//   one that passes its first window on noise and drifts back over within 6s:
//   measured on the M5 as lived, that late drop escaped the backoff and the
//   river bounced 2<->3 every ~3.5s.
// - No cloud rung (D-043, 01Oct26h; supersedes D-040's "Automatic thins clouds
//   before shadows"). From 26Sep26s to 01Oct26h a rung between full quality
//   and shadows-off faded every cloud beyond 7 to 12 km, and Jordan saw clouds
//   appear and vanish as he flew. Every cloud inside the map is now always
//   drawn, at every rung (clouds.js), so the ladder is back to 15 rungs and
//   shadows are again the first thing to go. The shadows rung keeps the
//   tolerant 19ms line, and the drop to FIRST_UNSHADOWED is the agreed
//   trade-off, so it is not judged by the "did it help" check.
// - Probes back off per level and only retry early when the scene has become
//   clearly lighter, which stops the 2<->3 bounce every 4 to 5s.
//
// s16:R (sprint 16Oct26f, D-054): the "did it help" check no longer lets noise re-anchor it. Measured on the weak
// setup (the processor slowed 4x through the browser, where the frame interval is the main thread's tick and
// resolution changes it by under 1 ms at every view, R/profile.md section 3), a window's mean wanders 3 to 6%, and a
// view that sits on the 18.3 ms line re-anchored the descent on noise at nearly every rung, so the judgement never
// fired and each excursion ratcheted the rung down to 35% (Wednesday's build did the same). The rules now are:
//   1. One window never judges a descent. It is judged when it has judgeWindows windows at its current rung and
//      either has shed judgeWork of the pixel work or is within budget; the judged value is the greater of the last two.
//   2. The anchor cannot be inflated by a stall: its mean is the least of the last anchorWindows window means at the
//      rung the descent starts from.
//   3. It helped when the judged value is at or below anchor x helpRatio at the judgement point, or at or below
//      anchor x (1 - landShare x shed) on an early landing in budget. Otherwise it returns to where it began and holds.
//   4. An in-budget window no longer clears an open descent.
//   5. A hold ends early only on heavyWindows consecutive windows heavier than it, not on one stall; holds last
//      30 s and back off to 120 s (a trial descent on a processor-bound view costs about 5 s below full resolution).
// Replayed offline on six recorded weak-setup traces for 300 s, the 07391f3 controller spent 67 to 95% of the time
// below full resolution on three of them; this one holds full resolution on all six (tests/fixtures/aq-weak-intervals.json).
export const QUALITY_LEVELS = [
  { scale: 1, samples: 4, shadows: true },
  { scale: 1, samples: 4, shadows: false },
  { scale: 0.92, samples: 4, shadows: false },
  { scale: 0.85, samples: 4, shadows: false },
  { scale: 0.85, samples: 2, shadows: false },
  { scale: 0.8, samples: 2, shadows: false },
  { scale: 0.75, samples: 2, shadows: false },
  { scale: 0.7, samples: 2, shadows: false },
  { scale: 0.65, samples: 0, shadows: false },
  { scale: 0.6, samples: 0, shadows: false },
  { scale: 0.55, samples: 0, shadows: false },
  { scale: 0.5, samples: 0, shadows: false },
  { scale: 0.45, samples: 0, shadows: false },
  { scale: 0.4, samples: 0, shadows: false },
  { scale: 0.35, samples: 0, shadows: false },
];

/** The first rung without shadows: the drop to it is the agreed trade-off
 * (shadows go first), and resolution descents are judged from it. */
export const FIRST_UNSHADOWED = QUALITY_LEVELS.findIndex(q => !q.shadows);

export const ADAPTIVE_TUNING = {
  targetMs: 1000 / 60,
  overBudget: 1.10,     // drop when the mean interval exceeds 1.10 x target (~54.5 fps)
  shadowsOverBudget: 1.14, // but leave the shadows-on rung only above 19ms (~52.6 fps)
  severe: 1.8,          // one window is enough above this (~33 fps)
  doubleStep: 2.5,      // and two rungs at once above this (~24 fps)
  underBudget: 1.07,    // probe up when the recent stable mean is at or below 17.8ms (~56 fps)
  ample: 0.8,           // clear headroom (fast display, light view)
  windowMs: 750, minSamples: 8, cooldownMs: 650,
  stableMs: 3000, ampleStableMs: 700,
  helpRatio: 0.9,       // a descent must cut the mean interval by 10%...
  judgeWork: 0.65,      // ...by the time it has shed 35% of the pixel work
  holdMs: 30000, holdMaxMs: 120000, heavierRetry: 1.3, // s16:R: were 15000 and 60000
  backoffMs: 8000, backoffMaxMs: 64000, lighterRetry: 0.75,
  probeGraceMs: 6000,   // a drop back within 6s of a probe counts as that probe failing
  // s16:R (sprint 16Oct26f, D-054): see the header paragraph of that name
  judgeWindows: 2,      // a descent is judged on the greater of this many consecutive windows at one rung, never on one
  heavyWindows: 3,      // a hold ends early only after this many consecutive windows heavier than it by heavierRetry
  anchorWindows: 4,     // the anchor's mean is the least of the last this-many window means at the rung the descent starts from
  landShare: 0.4,       // landing in budget early must show this share of the pixel work shed as a faster frame
};

export function createAdaptiveQuality({ apply, tuning = {} }) {
  const K = { ...ADAPTIVE_TUNING, ...tuning };
  const MAX = QUALITY_LEVELS.length - 1;
  let level = 0;
  let windowStart = null, cooldownUntil = 0, samples = [], longFrames = 0;
  let overWindows = 0, stableMs = 0;
  let stable = [];          // recent in-band windows [mean, span], judged together
  let pendingDrop = null;   // { from, exempt }
  let descent = null;       // { level, mean }: where the current descent is anchored
  let heavy = 0;            // s16:R consecutive windows heavier than the hold's by heavierRetry
  let atLevel = [];         // s16:R window means since the last change (the level they were measured at)
  let recentOver = [];      // s16:R the last over-budget window means at this level (the anchor's mean)
  let pendingProbe = null;  // { from, to, before }
  let lastProbe = null;     // { to, before, at }: the most recent probe that passed its first window
  let hold = null;          // { level, until, mean, streak }
  let holdStreak = 0;
  const backoff = new Map(); // target level -> { until, mean, count }
  const history = [];        // recent decisions, for tests and the dev HUD

  const over = () => K.targetMs * K.overBudget;
  // The over-budget line for a given level: the shadows-on rungs are more tolerant.
  const overAt = l => K.targetMs * (QUALITY_LEVELS[l].shadows ? K.shadowsOverBudget : K.overBudget);
  const EDGE_WORK = { 4: 1, 2: 0.8, 0: 0.62 };
  const work = l => { const q = QUALITY_LEVELS[l]; return q.scale * q.scale * EDGE_WORK[q.samples]; };

  function clearWindow(now) { samples = []; windowStart = now; }

  function change(next, now, why) {
    const from = level;
    stable = []; atLevel = []; recentOver = [];
    level = Math.max(0, Math.min(MAX, next));
    apply(QUALITY_LEVELS[level]);
    cooldownUntil = now + K.cooldownMs; // exclude target reallocation and shader warm-up
    clearWindow(now);
    history.push({ at: now, from, to: level, why });
    if (history.length > 64) history.shift();
  }

  function reset(now = null) {
    windowStart = now;
    cooldownUntil = now === null ? 0 : now + 1000;
    samples = []; longFrames = 0; overWindows = 0; stableMs = 0; stable = [];
    pendingDrop = null; pendingProbe = null; lastProbe = null; hold = null; holdStreak = 0; descent = null; atLevel = []; recentOver = [];
    backoff.clear();
  }

  function start(now) {
    level = 0;
    apply(QUALITY_LEVELS[level]);
    reset(now);
  }

  function revert(now) {
    const back = descent.level;
    holdStreak++;
    const ms = Math.min(K.holdMaxMs, K.holdMs * 2 ** (holdStreak - 1));
    hold = { level: back, until: now + ms, mean: descent.mean };
    descent = null; overWindows = 0; stableMs = 0; pendingDrop = null;
    change(back, now, 'revert: dropping did not help');
  }

  function evaluate(mean, span, now) {
    let continuing = false;
    atLevel.push(mean);
    // 1. Is the descent paying off? (s16:R) Judged on the mean of judgeWindows windows at one level against the anchor's
    // mean, never on one window: on the weak setup a window's mean wanders 3 to 6% and a CPU-bound view straddling the
    // band line re-anchored on noise at every rung, so the descent never reached its judgement and sank to the floor.
    if (pendingDrop) { if (!pendingDrop.exempt && descent) continuing = true; pendingDrop = null; }
    if (descent && level > descent.level) {
      continuing = true;
      const n = atLevel.length;
      const shed = 1 - work(level) / work(descent.level);
      const atJudge = work(level) <= work(descent.level) * K.judgeWork;
      const inBudget = mean <= overAt(level);
      if (n >= K.judgeWindows && (atJudge || inBudget)) {
        let m = 0; for (let i = n - K.judgeWindows; i < n; i++) m = Math.max(m, atLevel[i]);   // the greater: one quick window is not help
        const need = atJudge ? K.helpRatio : 1 - K.landShare * shed;
        if (m <= descent.mean * need) {
          holdStreak = 0;
          if (inBudget) { descent = null; }      // it helped and it fits: the descent is over
          else descent = { level, mean: m };     // it helped but not enough: re-anchor and go on
        } else if (atJudge || inBudget) {
          revert(now);
          return;
        }
      } else if (inBudget || atJudge) {
        return; // landed in budget, or at the judgement point: wait for the second window before judging (no drop, no probe)
      }
    }
    // 2. Did the last probe hold?
    if (pendingProbe) {
      const p = pendingProbe; pendingProbe = null;
      if (mean > overAt(p.to)) {
        backOff(p.to, p.before, now);
        overWindows = 0; stableMs = 0;
        change(p.from, now, 'probe failed');
        return;
      }
      lastProbe = { to: p.to, before: p.before, at: now };
    }

    // A probe that has held through its grace period succeeded: clear its backoff.
    if (lastProbe && now - lastProbe.at >= K.probeGraceMs) { backoff.delete(lastProbe.to); lastProbe = null; }

    if (mean > overAt(level)) {
      stableMs = 0; stable = []; overWindows++;
      recentOver.push(mean); if (recentOver.length > K.judgeWindows) recentOver.shift();
      const severe = mean > K.targetMs * K.severe;
      if (level >= MAX || (overWindows < 2 && !severe && !continuing)) return;
      // s16:R a hold ends early only when the view has been clearly heavier for heavyWindows windows running, not on one stall
      heavy = hold && mean >= hold.mean * K.heavierRetry ? heavy + 1 : 0;
      if (hold && level <= hold.level && now < hold.until && heavy < K.heavyWindows) return;
      // Drifting back over budget soon after a probe is that probe failing
      // late (it passed its first window on noise): back off as if it had.
      if (lastProbe && lastProbe.to === level && now - lastProbe.at < K.probeGraceMs) backOff(level, lastProbe.before, now);
      lastProbe = null;
      // Never two rungs at once from full quality: shadows go on their own first.
      const step = mean > K.targetMs * K.doubleStep && level >= FIRST_UNSHADOWED ? 2 : 1;
      const next = Math.min(MAX, level + step);
      const exempt = next <= FIRST_UNSHADOWED;
      if (!exempt && !descent) descent = { level: Math.max(FIRST_UNSHADOWED, level), mean: Math.min(...atLevel.slice(-K.anchorWindows)) };   // s16:R the best of the recent windows here: a stall cannot inflate the anchor
      pendingDrop = { from: level, exempt };
      overWindows = 0;
      change(next, now, step === 2 ? 'drop x2' : 'drop');
      return;
    }

    overWindows = 0;
    if (descent) return; // s16:R an open descent is judged above, never cleared by one in-budget window
    if (level === 0) return;
    // Judge the probe on the mean of the recent in-band windows, not window by
    // window: a CPU-bound view wanders 17.1 to 17.9ms, and requiring four
    // consecutive windows under the line kept it off shadows indefinitely.
    stable.push([mean, span]);
    if (stable.length > 8) stable.shift();
    if (mean <= K.targetMs * K.ample) {
      stableMs += span;
      if (stableMs < K.ampleStableMs) return;
      return probe(level - 1, mean, now, K.ampleStableMs);
    }
    let ms = 0, sum = 0;
    for (let i = stable.length - 1; i >= 0 && ms < K.stableMs; i--) { ms += stable[i][1]; sum += stable[i][0] * stable[i][1]; }
    stableMs = ms;
    if (ms < K.stableMs) return;
    const recent = sum / ms;
    if (recent > K.targetMs * K.underBudget) return; // inside the band: hold still
    probe(level - 1, recent, now, 0);
  }

  function backOff(to, before, now) {
    const b = backoff.get(to), count = (b?.count ?? 0) + 1;
    backoff.set(to, { until: now + Math.min(K.backoffMaxMs, K.backoffMs * 2 ** (count - 1)), mean: before, count });
  }

  function probe(to, before, now, keep) {
    const b = backoff.get(to);
    if (b && now < b.until && before > b.mean * K.lighterRetry) return;
    pendingProbe = { from: level, to, before };
    change(to, now, 'probe');
    // A successful probe keeps its verification window toward the next one.
    stableMs = keep;
  }

  function update(frameMs, now) {
    if (!Number.isFinite(frameMs) || !Number.isFinite(now) || frameMs <= 0) return;
    if (windowStart === null) { reset(now); return; }
    // Ignore isolated stalls, but not a machine consistently below 12fps.
    // Three consecutive long frames are real overload and must still adapt.
    if (frameMs > 1000) { reset(now); return; }
    longFrames = frameMs > 80 ? longFrames + 1 : 0;
    if (frameMs > 80 && longFrames < 3) { clearWindow(now); stableMs = 0; stable = []; return; }
    if (now < cooldownUntil) { windowStart = now; return; }
    samples.push(frameMs);
    const span = now - windowStart;
    if (span < K.windowMs || samples.length < K.minSamples) return;
    let sum = 0; for (const s of samples) sum += s;
    const mean = sum / samples.length;
    clearWindow(now);
    evaluate(mean, span, now);
  }

  return {
    update, reset, start,
    get: () => ({ level, ...QUALITY_LEVELS[level] }),
    state: () => ({ level, overWindows, stableMs, pendingDrop, pendingProbe, hold, descent, backoff: Object.fromEntries(backoff), history: history.slice() }),
    tuning: K,
  };
}
