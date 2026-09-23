// Conservative display-time controller. Drop quality after sustained overload;
// probe upward slowly, and back off failed probes to avoid quality oscillation.
// Near-camera sun shadows (sprint 23Sep26w, Lane D) are the first thing to go:
// level 1 is full resolution and full edge smoothing without shadows, and no
// lower level brings them back. Resolution and MSAA only start to fall after.
export const QUALITY_LEVELS = [
  { scale: 1, samples: 4, shadows: true },
  { scale: 1, samples: 4, shadows: false },
  { scale: 0.85, samples: 4, shadows: false },
  { scale: 0.75, samples: 2, shadows: false },
  { scale: 0.6, samples: 2, shadows: false },
  { scale: 0.5, samples: 0, shadows: false },
  { scale: 0.4, samples: 0, shadows: false },
  { scale: 0.35, samples: 0, shadows: false },
];

export function createAdaptiveQuality({ apply }) {
  let level = 0;
  let windowStart = null;
  let cooldownUntil = 0;
  let stableSince = null;
  let nextProbeAfter = 0;
  let probeFrom = null;
  let longFrames = 0;
  let samples = [];

  function clearWindow(now) {
    samples = [];
    windowStart = now;
  }

  function change(next, now) {
    level = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, next));
    apply(QUALITY_LEVELS[level]);
    cooldownUntil = now + 650; // exclude target allocation and shader warmup
    stableSince = null;
    clearWindow(now);
  }

  function reset(now = null) {
    windowStart = now;
    cooldownUntil = now === null ? 0 : now + 1000;
    stableSince = null;
    nextProbeAfter = 0;
    probeFrom = null;
    longFrames = 0;
    samples = [];
  }

  function start(now) {
    level = 0;
    apply(QUALITY_LEVELS[level]);
    reset(now);
  }

  function update(frameMs, now) {
    if (!Number.isFinite(frameMs) || !Number.isFinite(now) || frameMs <= 0) return;
    if (windowStart === null) { reset(now); return; }
    // Ignore isolated stalls, but not a machine consistently below 12fps.
    // Three consecutive long frames are real overload and must still adapt.
    if (frameMs > 1000) { reset(now); return; }
    longFrames = frameMs > 80 ? longFrames + 1 : 0;
    if (frameMs > 80 && longFrames < 3) {
      clearWindow(now); stableSince = null; return;
    }
    if (now < cooldownUntil) return;
    samples.push(frameMs);
    if (now - windowStart < 500 || samples.length < 10) return;
    const ordered = [...samples].sort((a, b) => a - b);
    const frameCost = ordered[Math.floor(ordered.length * 0.75)];
    clearWindow(now);

    if (frameCost > 19) {
      stableSince = null;
      if (probeFrom !== null) {
        const fallback = probeFrom;
        probeFrom = null;
        nextProbeAfter = now + 20000;
        change(fallback, now);
      } else if (level < QUALITY_LEVELS.length - 1) {
        change(level + (frameCost > 30 ? 2 : 1), now);
      }
      return;
    }

    probeFrom = null;
    if (frameCost <= 17.5 && level > 0) {
      stableSince ??= now;
      // A fast display revealing ample headroom can recover without waiting
      // out a failed probe from a previous, much heavier view.
      const ampleHeadroom = frameCost < 12;
      if (now - stableSince >= (ampleHeadroom ? 1000 : 3000) &&
          (now >= nextProbeAfter || ampleHeadroom)) {
        probeFrom = level;
        change(level - 1, now);
      }
    } else {
      stableSince = null;
    }
  }

  return { update, reset, start, get: () => ({ level, ...QUALITY_LEVELS[level] }) };
}
