// Module worker for the opening's pure jobs (sprint 21Oct26w, lane L). One message in, one message out; the
// arithmetic is src/opening-jobs.js, the same code the main-thread fallback runs.
import { createJobRunner } from '../opening-jobs.js';

const run = createJobRunner();

self.onmessage = (event) => {
  const { id, job, args } = event.data;
  const t0 = performance.now();
  try {
    const { result, transfer } = run(job, args);
    self.postMessage({ id, ok: true, result, ms: Math.round(performance.now() - t0) }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error), ms: Math.round(performance.now() - t0) });
  }
};
