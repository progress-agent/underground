// loading-readiness.js — honest readiness tracker for the opening (sprint 24Sep26h, lane O).
//
// The loading bar reports real readiness, not a timer. Each item names one
// thing the descent shows (terrain, baked ground, buildings, tube network,
// water, landmarks...) and carries a `check()` that inspects live state:
//
//   check() -> true            settled: ready
//   check() -> 'failed'        settled: the layer gave up (its fallback owns it)
//   check() -> number in [0,1) partial progress, not settled
//   check() -> false/other     pending
//
// Items may instead be settled by hand (`settle(id)`), which the opening gate
// does for the shader pre-compilation and warm-up render stages. Progress per
// item is monotonic, and the overall fraction reaches exactly 1 only when
// every item has settled. That is the contract the loading bar relies on: it
// cannot show 100% while anything in the readiness set is outstanding.
//
// Pure: no DOM, no three.js. Unit tests: node --test tests/loading-readiness.test.mjs

export function createReadiness(items, { now = () => performance.now() } = {}) {
  const t0 = now();
  const state = new Map();
  const order = [];
  for (const item of items) {
    if (!item || !item.id) throw new Error('readiness item needs an id');
    if (state.has(item.id)) throw new Error(`duplicate readiness item ${item.id}`);
    state.set(item.id, {
      id: item.id,
      label: item.label || item.id,
      weight: Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1,
      check: typeof item.check === 'function' ? item.check : null,
      progress: 0,
      status: 'pending', // 'pending' | 'ready' | 'failed' | 'timeout'
      at: null,           // ms since tracker creation when settled
    });
    order.push(item.id);
  }

  function mark(entry, status) {
    if (entry.status !== 'pending') return;
    entry.status = status;
    entry.progress = 1;
    entry.at = Math.round(now() - t0);
  }

  /** Run every pending item's check once. Returns the snapshot. */
  function poll() {
    for (const id of order) {
      const entry = state.get(id);
      if (entry.status !== 'pending' || !entry.check) continue;
      let r;
      try { r = entry.check(); } catch (e) { r = false; }
      if (r === true) mark(entry, 'ready');
      else if (r === 'failed') mark(entry, 'failed');
      else if (typeof r === 'number' && Number.isFinite(r)) {
        // Partial progress never reaches 1 on its own: only settling does.
        entry.progress = Math.max(entry.progress, Math.min(Math.max(r, 0), 0.99));
      }
    }
    return snapshot();
  }

  /** Settle an item by hand (e.g. a stage the caller drives). */
  function settle(id, status = 'ready') {
    const entry = state.get(id);
    if (!entry) throw new Error(`unknown readiness item ${id}`);
    mark(entry, status);
  }

  /** Report partial progress for a hand-driven item. */
  function setProgress(id, p) {
    const entry = state.get(id);
    if (!entry || entry.status !== 'pending' || !Number.isFinite(p)) return;
    entry.progress = Math.max(entry.progress, Math.min(Math.max(p, 0), 0.99));
  }

  /** Give up on every pending item among `ids` (default: all). */
  function expire(ids = order) {
    for (const id of ids) mark(state.get(id), 'timeout');
  }

  function isSettled(id) { return state.get(id)?.status !== 'pending'; }

  function allSettled(ids = order) { return ids.every(isSettled); }

  function fraction() {
    let total = 0, done = 0;
    for (const id of order) {
      const e = state.get(id);
      total += e.weight;
      done += e.weight * (e.status === 'pending' ? e.progress : 1);
    }
    if (!total) return 1;
    // Guard the contract against floating-point drift: 1 only when settled.
    const f = done / total;
    return allSettled() ? 1 : Math.min(f, 0.999);
  }

  function pending() { return order.filter(id => !isSettled(id)).map(id => state.get(id)); }

  function snapshot() {
    return {
      fraction: fraction(),
      complete: allSettled(),
      items: order.map(id => {
        const { label, weight, progress, status, at } = state.get(id);
        return { id, label, weight, progress, status, at };
      }),
    };
  }

  return { poll, settle, setProgress, expire, isSettled, allSettled, fraction, pending, snapshot, ids: order.slice() };
}
