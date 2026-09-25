// pedestrian-scale.js: the Pedestrian "real scale" slider ease (sprint
// 23Sep26w, D-037, lane A2; reduced to Master alone in sprint 25Sep26f, D-039).
//
// Jordan: "Real scale on entry, sliders still adjustable". Entering Pedestrian
// eases the Master height slider to 1 (the real landscape, vertical-scale.js)
// over about a second; leaving restores whatever it was before entry. Since
// D-039 there is no Structure slider: every structure keeps its true
// proportions at every Master height (true-proportion.js), so Master alone
// takes the whole scene to real scale. The slider is moved through ctx.sliders,
// i.e. the real HUD input, so every dependent (the structure morphs, prefs, the
// DLR resnap) follows exactly as if Jordan had dragged it. No layer is ever
// rescaled directly.
//
// Adjustable while walking: the moment the slider's value differs from the
// last value this ease wrote, the viewer has taken hold of it and the ease
// leaves it alone for the rest of the visit.
//
// Cost control: the slider steps in 0.1, so targets are quantised to 0.1 and
// only written when the quantised value changes. Each write re-scales the
// structures; main.js rate-limits their CPU morphs (at most one per 200ms,
// always landing the final value). The final Master value always lands exactly
// on the last frame.

export const REAL_MASTER = 1;

const q10 = (v) => Math.round(v * 10) / 10;
// Symmetric ease for a scale change (not a camera inertia move).
export const easeInOutSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));

/**
 * @param {object} o
 * @param {{getMaster(), setMaster(v)}} o.sliders
 * @param {number} [o.master=1]     real-scale Master
 */
export function createScaleEase({ sliders, master = REAL_MASTER } = {}) {
  const chans = {
    master: { get: () => sliders?.getMaster?.(), set: (v) => sliders?.setMaster?.(v), target: master },
  };
  let saved = null;     // { master } before entry
  let running = false;
  let t = 0;
  const from = {}, lastSet = {}, held = {}, lastWriteAt = {};

  function begin() {
    const m = chans.master.get();
    saved = { master: Number.isFinite(m) ? m : null };
    t = 0;
    running = true;
    for (const k of Object.keys(chans)) {
      from[k] = saved[k];
      lastSet[k] = saved[k];
      held[k] = saved[k] === null; // no slider: nothing to ease
      lastWriteAt[k] = -Infinity;
    }
    return { ...saved };
  }

  /** Advance the ease; duration in seconds (read live from the physics panel). */
  function update(dt, duration = 1) {
    if (!running) return false;
    t += Math.max(0, dt || 0);
    const k = duration > 0 ? Math.min(1, t / duration) : 1;
    const e = easeInOutSine(k);
    for (const [key, ch] of Object.entries(chans)) {
      if (held[key]) continue;
      const cur = ch.get();
      if (!Number.isFinite(cur)) { held[key] = true; continue; }
      // The viewer moved it: hands off from now on.
      if (lastSet[key] !== null && Math.abs(cur - lastSet[key]) > 1e-6) { held[key] = true; continue; }
      const want = k >= 1 ? ch.target : q10(from[key] + (ch.target - from[key]) * e);
      if (Math.abs(want - cur) < 1e-6) continue;
      const got = ch.set(want);
      lastSet[key] = Number.isFinite(got) ? got : want;
      lastWriteAt[key] = t;
    }
    if (k >= 1) running = false;
    return true;
  }

  /** Put the pre-entry values back (leaving Pedestrian). */
  function restore() {
    running = false;
    if (!saved) return null;
    const out = saved;
    saved = null;
    if (out.master !== null) chans.master.set(out.master);
    return out;
  }

  return {
    begin,
    update,
    restore,
    get running() { return running; },
    get saved() { return saved ? { ...saved } : null; },
    get held() { return { ...held }; },
    get progress() { return t; },
  };
}
