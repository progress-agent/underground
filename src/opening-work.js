// opening-work.js — the opening's heavy pure jobs, started at boot on three module workers (sprint 21Oct26w,
// lane L, approaches G and F).
//
//   worker 1  the terrain normal map: its grain field (1.3 s) at once, the pixels when the elevations arrive
//   worker 2  the terrain grain and roughness, the underside grain and its normal map
//   worker 3  the chalk grain, roughness and normal map, then the chalk floor's displacement
//
// Inputs are cloned and outputs transferred, so a worker that dies mid-job can be replaced by the same job run on
// the main thread (a warning, not an error): the arithmetic is src/opening-jobs.js either way and the bytes are
// identical (tests/opening-work.test.mjs, tests/texture-pixels.test.mjs). Where Worker does not exist the jobs run
// on the main thread when first asked for. CDP CPU throttling slows the main thread but not workers, which is why
// the weak-setup figure flatters this step (L/design.md section 1).

import { createJobRunner } from './opening-jobs.js';

const defaultMakeWorker = () => new Worker(new URL('./workers/opening-worker.js', import.meta.url), { type: 'module' });

/** @param {{ makeWorker?: () => any, now?: () => number, workers?: boolean }} [options] */
export function createOpeningWork({ makeWorker = defaultMakeWorker, now = () => performance.now(), workers = typeof Worker !== 'undefined' } = {}) {
  const lanes = {};
  const log = [];
  let seq = 0;

  function lane(name) {
    if (lanes[name]) return lanes[name];
    const l = lanes[name] = { name, worker: null, pending: new Map(), runner: createJobRunner(), failed: !workers, queue: Promise.resolve() };
    if (workers) {
      try {
        l.worker = makeWorker();
        l.worker.onmessage = (event) => {
          const { id, ok, result, error, ms } = event.data;
          const p = l.pending.get(id);
          if (!p) return;
          l.pending.delete(id);
          log.push({ job: p.job, lane: name, inline: false, ms, startedAt: Math.round(p.startedAt), doneAt: Math.round(now()) });
          if (ok) p.resolve(result); else p.fallback(new Error(error));
        };
        l.worker.onerror = (event) => { event.preventDefault?.(); fail(l, new Error(event.message || 'worker error')); };
      } catch (error) { fail(l, error); }
    }
    return l;
  }

  function fail(l, error) {
    if (l.failed) return;
    l.failed = true;
    try { l.worker?.terminate?.(); } catch (_) { /* gone */ }
    console.warn(`[opening] worker ${l.name} unavailable (${error.message}); running its jobs on the main thread`);
    const pending = [...l.pending.values()];
    l.pending.clear();
    for (const p of pending) p.fallback(error);
  }

  function runInline(l, job, args, p) {
    // Serial and off the call stack: the caller never blocks inside call().
    l.queue = l.queue.then(() => new Promise((resolve) => setTimeout(() => {
      const t0 = now();
      try {
        const { result } = l.runner(job, args);
        log.push({ job, lane: l.name, inline: true, ms: Math.round(now() - t0), startedAt: Math.round(t0), doneAt: Math.round(now()) });
        p.resolve(result);
      } catch (error) { p.reject(error); }
      resolve();
    }, 0)));
  }

  function call(name, job, args = {}) {
    const l = lane(name);
    return new Promise((resolve, reject) => {
      const p = { job, resolve, reject, startedAt: now(), fallback: null };
      p.fallback = () => runInline(l, job, args, p);
      if (l.failed || !l.worker) return runInline(l, job, args, p);
      const id = ++seq;
      l.pending.set(id, p);
      try { l.worker.postMessage({ id, job, args }); } catch (error) { l.pending.delete(id); fail(l, error); p.fallback(); }
    });
  }

  // Started at once, in lane order: the grain field first on worker 1 (the elevations will find it done).
  const started = {
    terrainNormalGrain: call('w1', 'terrainNormalGrain'),
    terrainSet: call('w2', 'terrainSet'),
    chalkSet: call('w3', 'chalkSet'),
  };
  for (const p of Object.values(started)) p.catch(() => {});

  return {
    /** Promise of { grain, roughness, undersideGrain, undersideNormal } (RGBA bytes). */
    terrainSet: started.terrainSet,
    /** Promise of { grain, roughness, normal } for the chalk floor. */
    chalkSet: started.chalkSet,
    /** Promise of the terrain normal map's RGBA bytes (2048 x 2048) for normalised heights on a width x height grid. */
    terrainNormal: (heights, width, height) => started.terrainNormalGrain.then(
      () => call('w1', 'terrainNormal', { heights, width, height })),
    /** Promise of a Float32Array: the chalk displacement at every vertex of the plane (x, z are its float32 coordinates). */
    chalkDisplacement: ({ ring, x, z, centerX, centerZ }) => call('w3', 'chalkDisplacement', { ring, x, z, centerX, centerZ }),
    /** Job timings so far: { job, lane, inline, ms, startedAt, doneAt } (ms since navigation for the times). */
    timings: () => log.slice(),
    get usesWorkers() { return Object.values(lanes).some(l => l.worker && !l.failed); },
  };
}
