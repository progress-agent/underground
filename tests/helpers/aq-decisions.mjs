// aq-decisions.mjs (sprint 21Oct26w, lane T): every decision Automatic makes, for one controller module. Not a test (no .test.mjs suffix).
// A decision is `${at.toFixed(3)}|${from}>${to}|${why}`, read from state().history after every update that applied a rung.
//   replay: the recorded weak-setup traces (tests/fixtures/aq-weak-intervals.json), each looped for 3600 s;
//   fuzz: 200 seeded synthetic runs of 600 s (piecewise-constant CPU/GPU regimes, noise, rare stalls; mulberry32 seeds 1..200);
//   hourAtOneRung: an hour of 16.7 ms frames at full quality (no change should ever happen; windowsAtLevel must stay bounded).
// The fixture tests/fixtures/aq-decisions-7c2d4bd.json was generated once from `git show 7c2d4bd:src/adaptive-quality.js`.
import { createHash } from 'node:crypto';

export const sha = rows => createHash('sha256').update(rows.join('\n')).digest('hex');
const MSAA = { 4: 1, 2: 0.8, 0: 0.62 };
const mulberry = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Drive one controller; frames(quality) yields [ms, now]. Returns the decision rows and the largest windowsAtLevel seen (0 if absent). */
export function drive(mod, frames) {
  let cur = mod.QUALITY_LEVELS[0], applies = 0;
  const c = mod.createAdaptiveQuality({ apply: q => { cur = q; applies++; } }); c.start(0);
  let seen = applies, maxW = 0; const rows = [], at = [];
  for (const [ms, now] of frames(() => cur)) {
    c.update(ms, now);
    const st = c.state(); if (typeof st.windowsAtLevel === 'number') maxW = Math.max(maxW, st.windowsAtLevel);
    if (applies !== seen) { seen = applies; const h = st.history.at(-1); rows.push(`${h.at.toFixed(3)}|${h.from}>${h.to}|${h.why}`); at.push(h.at); }
  }
  return { rows, at, maxW };
}

export function replayViews(mod, views, { keepFirstMs = 300000 } = {}) {
  const out = {};
  for (const [name, ms] of Object.entries(views)) {
    const { rows, at } = drive(mod, function* () { let now = 0, i = 0; while (now < 3600000) { const f = ms[i++ % ms.length]; now += f; yield [f, now]; } });
    out[name] = { n: rows.length, sha256: sha(rows), first300s: rows.filter((_, i) => at[i] <= keepFirstMs) };
  }
  return out;
}

export function fuzz(mod, { seeds = 200 } = {}) {
  const all = []; let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = mulberry(seed);
    const { rows } = drive(mod, function* (quality) {
      let now = 0, end = 0, cpu = 0, gpu = 0, noise = 0;
      while (now < 600000) {
        if (now >= end) { end = now + 2000 + r() * 40000; cpu = 8 + r() * 22; gpu = r() * 50; noise = r() * 0.15; }
        const q = quality(); let f = Math.max(cpu, gpu * q.scale * q.scale * MSAA[q.samples] + (q.shadows ? 2 : 0));
        f *= 1 + noise * (r() * 2 - 1); if (r() < 0.002) f = 40 + r() * 60;
        now += f; yield [f, now];
      }
    });
    n += rows.length; all.push(`seed ${seed}`, ...rows);
  }
  return { seeds, n, sha256: sha(all) };
}

export function hourAtOneRung(mod) {
  const { maxW, rows } = drive(mod, function* () { let now = 0; while (now < 3600000) { now += 16.7; yield [16.7, now]; } });
  return { changes: rows.length, maxWindowsAtLevel: maxW };
}
