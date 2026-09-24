// pedestrian-scale.js: the Pedestrian "real scale" slider ease (sprint
// 23Sep26w, D-037, lane A2). Pure logic, no DOM, so node tests pin it.
//
// Jordan: "Real scale on entry, sliders still adjustable". Entering Pedestrian
// eases the two HUD sliders to Master 1 / Structure 5 (overall real scale,
// vertical-scale.js) over about a second; leaving restores whatever they were
// before entry. The sliders are moved through ctx.sliders, i.e. the real HUD
// inputs, so every dependent (landmarks, bridges, prefs, DLR resnap) follows
// exactly as if Jordan had dragged them. No layer is ever rescaled directly.
//
// Adjustable while walking: the moment a slider's value differs from the last
// value this ease wrote, the viewer has taken hold of it and the ease leaves
// that slider alone for the rest of the visit.
//
// Cost control: both HUD sliders step in 0.1, and a Structure change resnaps
// the DLR. So targets are quantised to 0.1 and only written when the quantised
// value changes, and Structure writes are spaced at least STRUCTURE_MIN_GAP_S
// apart (the final value always lands exactly on the last frame).

export const REAL_MASTER = 1;
export const REAL_STRUCTURE = 5;
export const STRUCTURE_MIN_GAP_S = 0.08;

const q10 = (v) => Math.round(v * 10) / 10;
// Symmetric ease for a scale change (not a camera inertia move).
export const easeInOutSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));

/**
 * @param {object} o
 * @param {{getMaster(), setMaster(v), getStructure(), setStructure(v)}} o.sliders
 * @param {number} [o.master=1]     real-scale Master
 * @param {number} [o.structure=5]  real-scale Structure
 */
export function createScaleEase({ sliders, master = REAL_MASTER, structure = REAL_STRUCTURE } = {}) {
  const chans = {
    master: { get: () => sliders?.getMaster?.(), set: (v) => sliders?.setMaster?.(v), target: master },
    structure: { get: () => sliders?.getStructure?.(), set: (v) => sliders?.setStructure?.(v), target: structure },
  };
  let saved = null;     // { master, structure } before entry
  let running = false;
  let t = 0;
  const from = {}, lastSet = {}, held = {}, lastWriteAt = {};

  function begin() {
    const m = chans.master.get(), s = chans.structure.get();
    saved = { master: Number.isFinite(m) ? m : null, structure: Number.isFinite(s) ? s : null };
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
      if (key === 'structure' && k < 1 && t - lastWriteAt[key] < STRUCTURE_MIN_GAP_S) continue;
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
    if (out.structure !== null) chans.structure.set(out.structure);
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
