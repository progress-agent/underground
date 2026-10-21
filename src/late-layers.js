// late-layers.js — the registry of layers built after the opening (sprint 21Oct26w, lane L, approach E, and the
// second of the four hooks for lane V).
//
// The profile rendered the descent pose by pose with each layer hidden in turn: the motorway, airports, flights,
// the map-edge cliff and waterfalls, reservoirs, canals, sea life and the surface trains are never above 0.05% of
// the frame at any pose (profile section 3). They are therefore built after landing, one at a time, in slices of
// at most `budgetMs` a frame, and each is handed to renderer.compileAsync before it is attached, so it never
// compiles a program in a visible frame.
//
// A layer is defined once:
//   define(id, { label, name, deps, steps, objects, attach, onFail })
//     deps()      true when what the layer needs exists (terrain, M25 data...); default always
//     steps()     a generator function: the original builder's body with `yield` at loop boundaries; its return
//                 value is the layer's result. Each `next()` is one step and is timed (maxStepMs).
//     prepare(r)  runs before the precompile: settles what is part of a program's key (the shadow flags)
//     objects(r)  the Object3Ds to precompile for result r (default: [r] when r is an Object3D)
//     stagger(r)  Object3Ds whose first render uploads megabytes of buffers: they are attached hidden and shown one a frame,
//                 so no single frame carries the whole layer's GPU upload
//     attach(r)   adds the result to the scene and runs the side effects the old code ran at creation
//     onFail(e)   the fallback or error variable the old code set on failure
//
// States: waiting -> building -> ready (built, being compiled) -> attached, or failed.
//
// Hook for lane V: request(id) moves a layer to the front and lets it start as soon as its deps() hold, in any
// phase, even before the veil. Default behaviour (nothing requested): layers start when `isOpen()` says the
// opening has landed (or at once on a deep link).
//
// Events (window, production builds too): `ug:late-layer` {id, state, at} on every state change and
// `ug:late-layers-done` {at, layers} once every layer is attached or failed.
//
// Pure of three.js; unit tests: node --test tests/late-layers.test.mjs

export const LATE_LAYER_EVENT = 'ug:late-layer';
/** Build order, nearest the landing first (L/design.md section 2.4); unknown ids follow in definition order. */
export const LATE_LAYER_ORDER = ['canals', 'reservoirs', 'surfaceTrains', 'seaLife', 'motorway', 'cliff', 'airports', 'flights'];
export const LATE_LAYERS_DONE_EVENT = 'ug:late-layers-done';

export function createLateLayers({
  budgetMs = 4,
  isOpen = () => true,
  compile = null, // async (objects) => void; null attaches without precompiling (unit tests, no renderer)
  now = () => performance.now(),
  dispatch = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) { /* noop */ } },
} = {}) {
  const defs = new Map();
  const info = new Map();
  let order = [];
  let requestSeq = 0;
  const expected = new Set(); // ids the opening will define (some after the veil); `settled` waits for all of them
  const skipped = new Set(); // expected ids that will never be defined (their data failed, their parent was absent)
  const earlyRequests = []; // request(id) calls made before the id was defined
  const revealQueue = []; // [object, wasVisible]: staggered children waiting to be shown, one a frame
  let current = null; // { id, it }
  let doneFired = false;
  let pendingAttaches = 0;
  const waiters = new Map();

  const at = () => Math.round(now());

  function setState(id, state) {
    const rec = info.get(id);
    rec.state = state;
    if (state === 'building') rec.startedAt = at();
    else if (state === 'ready') rec.builtAt = at();
    else if (state === 'attached') rec.attachedAt = at();
    dispatch(LATE_LAYER_EVENT, { id, state, at: at() });
    if (state === 'attached' || state === 'failed') {
      for (const resolve of waiters.get(id) ?? []) resolve(rec.state);
      waiters.delete(id);
      maybeDone();
    }
  }

  /** True once every expected id is defined or skipped and everything defined is attached or failed. */
  function allFinished() {
    if (!defs.size) return false;
    for (const id of expected) if (!defs.has(id) && !skipped.has(id)) return false;
    for (const rec of info.values()) if (rec.state !== 'attached' && rec.state !== 'failed') return false;
    return revealQueue.length === 0;
  }

  function maybeDone() {
    if (doneFired || !allFinished()) return;
    doneFired = true;
    dispatch(LATE_LAYERS_DONE_EVENT, { at: at(), layers: snapshot().map(l => ({ id: l.id, state: l.state, attachedAt: l.attachedAt, steps: l.steps, maxStepMs: l.maxStepMs, buildMs: l.buildMs, compileMs: l.compileMs, slow: l.slow })) });
  }

  function define(id, def) {
    if (defs.has(id)) throw new Error(`late layer ${id} already defined`);
    defs.set(id, { deps: () => true, ...def });
    info.set(id, { id, name: def.name ?? null, label: def.label ?? id, state: 'waiting', requestedAt: null, startedAt: null,
      builtAt: null, attachedAt: null, buildMs: 0, steps: 0, maxStepMs: 0, compileMs: null, error: null, requestSeq: null, slow: [] });
    order.push(id);
    resort();
    doneFired = false;
    const early = earlyRequests.indexOf(id);
    if (early >= 0) { earlyRequests.splice(early, 1); request(id); }
  }

  /** The ids the opening will define, some of them after the veil lifts: settled() and the done event wait for them. */
  function expect(ids) { for (const id of ids) expected.add(id); }
  /** An expected id that will never be defined (its data failed to load): stop waiting for it. */
  function skip(id) { skipped.add(id); maybeDone(); }

  // Requested layers first (in the order asked), then the canonical order, then definition order.
  function resort() {
    const rank = (id) => { const k = LATE_LAYER_ORDER.indexOf(id); return k < 0 ? LATE_LAYER_ORDER.length : k; };
    const seq = (id) => info.get(id).requestSeq ?? Infinity;
    const defined = [...defs.keys()];
    order.sort((a, b) => (seq(a) - seq(b)) || (rank(a) - rank(b)) || (defined.indexOf(a) - defined.indexOf(b)));
  }

  function request(id) {
    const rec = info.get(id);
    if (!rec) {
      // Not defined yet (a layer defined after the veil): remember the request and honour it at definition.
      if (!expected.has(id) && !skipped.has(id)) throw new Error(`unknown late layer ${id}`);
      if (!earlyRequests.includes(id)) earlyRequests.push(id);
      return;
    }
    if (rec.requestedAt === null) { rec.requestedAt = at(); rec.requestSeq = ++requestSeq; }
    if (rec.state === 'waiting') resort();
  }

  function fail(id, error) {
    const rec = info.get(id);
    rec.error = String(error?.message ?? error);
    try { defs.get(id).onFail?.(error); } catch (e) { console.warn(`[late-layers] ${id} fallback failed`, e); }
    console.warn(`[late-layers] ${id} unavailable (${rec.error})`);
    setState(id, 'failed');
  }

  function finish(id, result) {
    const def = defs.get(id), rec = info.get(id);
    setState(id, 'ready');
    pendingAttaches++;
    try { def.prepare?.(result); } catch (e) { console.warn(`[late-layers] ${id} prepare failed`, e); }
    const objects = def.objects ? def.objects(result) : (result && result.isObject3D ? [result] : []);
    const t0 = now();
    // The precompile starts in a microtask, outside the frame that built the layer, and a throw in it only skips the precompile.
    Promise.resolve().then(() => (compile && objects.length ? compile(objects) : null)).catch((e) => {
      console.warn(`[late-layers] ${id} precompile failed`, e);
    }).then(() => {
      rec.compileMs = Math.round(now() - t0);
      try {
        let held = [];
        try { held = (def.stagger ? def.stagger(result) : null) || []; held = held.filter(Boolean); } catch (_) { held = []; }
        const was = held.map(o => o.visible);
        held.forEach(o => { o.visible = false; });
        def.attach(result);
        held.forEach((o, i) => revealQueue.push([o, was[i]]));
        setState(id, 'attached');
      } catch (e) { fail(id, e); }
    }).finally(() => { pendingAttaches--; });
  }

  /** Run building steps for up to `ms` (default the budget). Call once per frame. Returns true while work remains. */
  function pump(ms = budgetMs) {
    // One staggered child a frame (its first render uploads its buffers), before this frame's building steps.
    if (revealQueue.length) { const [o, visible] = revealQueue.shift(); o.visible = visible; if (!revealQueue.length) maybeDone(); }
    const t0 = now();
    while (now() - t0 < ms) {
      if (!current) {
        const id = order.find(x => {
          const rec = info.get(x);
          if (rec.state !== 'waiting') return false;
          if (!(isOpen() || rec.requestedAt !== null)) return false;
          try { return !!defs.get(x).deps(); } catch (_) { return false; }
        });
        if (!id) break;
        let it;
        try { it = defs.get(id).steps(); } catch (e) { setState(id, 'building'); fail(id, e); continue; }
        current = { id, it };
        setState(id, 'building');
      }
      const rec = info.get(current.id);
      const s0 = now();
      let r;
      try { r = current.it.next(); } catch (e) { const id = current.id; current = null; fail(id, e); continue; }
      const ds = now() - s0;
      rec.steps++; rec.buildMs += ds; if (ds > rec.maxStepMs) rec.maxStepMs = ds;
      if (ds > 6 && rec.slow.length < 8) rec.slow.push({ step: rec.steps, ms: Math.round(ds * 10) / 10 }); // diagnosis: which steps ran long
      if (r.done) { const id = current.id; current = null; finish(id, r.value); }
    }
    return remaining();
  }

  function remaining() {
    for (const rec of info.values()) if (rec.state === 'waiting' || rec.state === 'building' || rec.state === 'ready') return true;
    return revealQueue.length > 0;
  }

  function snapshot() {
    return [...defs.keys()].map(id => {
      const r = info.get(id);
      return { ...r, buildMs: Math.round(r.buildMs * 10) / 10, maxStepMs: Math.round(r.maxStepMs * 10) / 10 };
    });
  }

  const settled = () => allFinished();
  const whenAttached = (id) => {
    const rec = info.get(id);
    if (!rec) return Promise.reject(new Error(`unknown late layer ${id}`));
    if (rec.state === 'attached' || rec.state === 'failed') return Promise.resolve(rec.state);
    return new Promise(resolve => { (waiters.get(id) ?? waiters.set(id, []).get(id)).push(resolve); });
  };
  const state = (id) => info.get(id)?.state ?? null;
  const ids = () => [...defs.keys()];

  return { define, expect, skip, request, pump, snapshot, settled, whenAttached, state, ids, remaining, get pending() { return pendingAttaches; } };
}
