// Automatic rendering quality (sprint 24Sep26h, Lane R, D-038; supersedes the
// 11Sep26f controller). Target: about 60 fps. Near-camera sun shadows are the
// first thing to go (level 1 is full resolution and full edge smoothing
// without shadows, and no lower level brings them back); then resolution and
// edge smoothing fall in fine steps.
//
// What changed, and why (profile 24Sep26h, Working/sprint-24Sep26h/profile.md):
// - Finer rungs. The old ladder jumped 100% -> 85% -> 75%/2x -> 60%/2x -> 50%/off.
// - A band, not a line. It drops only after the mean frame interval has been
//   over budget (below ~54.5 fps) for two consecutive windows, and probes up
//   only when comfortably inside budget. The old p75 threshold sat on the
//   60Hz boundary, where a 17ms frame presents as 33ms and tripped a double
//   drop.
// - It checks that a drop helped. Street and river views are CPU-bound:
//   lowering resolution did nothing, yet the old controller kept dropping to
//   the 35% floor. A resolution drop that does not cut the frame interval by
//   at least 5% (or bring it within budget) is reverted, and that level is
//   held. The shadows rung is exempt: it is the agreed first thing to go.
// - Probes back off per level and only retry early when the scene has become
//   clearly lighter, which stops the 2<->3 bounce every 4 to 5s.
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

export const ADAPTIVE_TUNING = {
  targetMs: 1000 / 60,
  overBudget: 1.10,     // drop when the mean interval exceeds 1.10 x target (~54.5 fps)
  severe: 1.8,          // one window is enough above this (~33 fps)
  doubleStep: 2.5,      // and two rungs at once above this (~24 fps)
  underBudget: 1.03,    // probe up only at or below 1.03 x target (~58 fps)
  ample: 0.8,           // clear headroom (fast display, light view)
  windowMs: 750, minSamples: 8, cooldownMs: 650,
  stableMs: 3000, ampleStableMs: 700,
  helpRatio: 0.95,      // a drop must cut the mean interval by 5%
  holdMs: 15000, holdMaxMs: 60000, heavierRetry: 1.3,
  backoffMs: 8000, backoffMaxMs: 64000, lighterRetry: 0.75,
};

export function createAdaptiveQuality({ apply, tuning = {} }) {
  const K = { ...ADAPTIVE_TUNING, ...tuning };
  const MAX = QUALITY_LEVELS.length - 1;
  let level = 0;
  let windowStart = null, cooldownUntil = 0, samples = [], longFrames = 0;
  let overWindows = 0, stableMs = 0;
  let pendingDrop = null;   // { from, revertTo, before, exempt }
  let pendingProbe = null;  // { from, to, before }
  let hold = null;          // { level, until, mean, streak }
  let holdStreak = 0;
  const backoff = new Map(); // target level -> { until, mean, count }
  const history = [];        // recent decisions, for tests and the dev HUD

  const over = () => K.targetMs * K.overBudget;

  function clearWindow(now) { samples = []; windowStart = now; }

  function change(next, now, why) {
    const from = level;
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
    samples = []; longFrames = 0; overWindows = 0; stableMs = 0;
    pendingDrop = null; pendingProbe = null; hold = null; holdStreak = 0;
    backoff.clear();
  }

  function start(now) {
    level = 0;
    apply(QUALITY_LEVELS[level]);
    reset(now);
  }

  function evaluate(mean, span, now) {
    // 1. Did the last drop help?
    if (pendingDrop) {
      const d = pendingDrop; pendingDrop = null;
      const helped = mean <= d.before * K.helpRatio || mean <= over();
      if (!helped && !d.exempt) {
        holdStreak++;
        const ms = Math.min(K.holdMaxMs, K.holdMs * 2 ** (holdStreak - 1));
        hold = { level: d.revertTo, until: now + ms, mean: d.before };
        overWindows = 0; stableMs = 0;
        change(d.revertTo, now, 'revert: drop did not help');
        return;
      }
      if (!d.exempt) holdStreak = 0;
    }
    // 2. Did the last probe hold?
    if (pendingProbe) {
      const p = pendingProbe; pendingProbe = null;
      if (mean > over()) {
        const b = backoff.get(p.to), count = (b?.count ?? 0) + 1;
        backoff.set(p.to, { until: now + Math.min(K.backoffMaxMs, K.backoffMs * 2 ** (count - 1)), mean: p.before, count });
        overWindows = 0; stableMs = 0;
        change(p.from, now, 'probe failed');
        return;
      }
      backoff.delete(p.to);
    }

    if (mean > over()) {
      stableMs = 0; overWindows++;
      const severe = mean > K.targetMs * K.severe;
      if (level >= MAX || (overWindows < 2 && !severe)) return;
      if (hold && level <= hold.level && now < hold.until && mean < hold.mean * K.heavierRetry) return;
      const step = mean > K.targetMs * K.doubleStep && level >= 1 ? 2 : 1;
      const next = Math.min(MAX, level + step);
      pendingDrop = { from: level, revertTo: level === 0 ? 1 : level, before: mean, exempt: level === 0 && next === 1 };
      overWindows = 0;
      change(next, now, step === 2 ? 'drop x2' : 'drop');
      return;
    }

    overWindows = 0;
    if (mean <= K.targetMs * K.underBudget) {
      stableMs += span;
      if (level === 0) return;
      const ample = mean <= K.targetMs * K.ample;
      if (stableMs < (ample ? K.ampleStableMs : K.stableMs)) return;
      const to = level - 1, b = backoff.get(to);
      if (b && now < b.until && mean > b.mean * K.lighterRetry) return;
      pendingProbe = { from: level, to, before: mean };
      // A successful probe keeps its verification window toward the next one.
      stableMs = ample ? K.ampleStableMs : 0;
      change(to, now, 'probe');
    } else {
      stableMs = 0; // inside the band: hold still
    }
  }

  function update(frameMs, now) {
    if (!Number.isFinite(frameMs) || !Number.isFinite(now) || frameMs <= 0) return;
    if (windowStart === null) { reset(now); return; }
    // Ignore isolated stalls, but not a machine consistently below 12fps.
    // Three consecutive long frames are real overload and must still adapt.
    if (frameMs > 1000) { reset(now); return; }
    longFrames = frameMs > 80 ? longFrames + 1 : 0;
    if (frameMs > 80 && longFrames < 3) { clearWindow(now); stableMs = 0; return; }
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
    state: () => ({ level, overWindows, stableMs, pendingDrop, pendingProbe, hold, backoff: Object.fromEntries(backoff), history: history.slice() }),
    tuning: K,
  };
}
