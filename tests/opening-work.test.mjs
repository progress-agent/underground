// The workers' job runner and its main-thread fallback (sprint 21Oct26w, lane L; acceptance L-02 a): the bytes a
// worker would return are the bytes the old in-line functions made, and a worker that cannot start or dies only
// moves the arithmetic. A fake worker runs the real runner, so the message protocol is exercised without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpeningWork } from '../src/opening-work.js';
import { createJobRunner } from '../src/opening-jobs.js';
import { realHeightmap } from './fixtures/texture-goldens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLD = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/texture-goldens.json'), 'utf8'));
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

/** A worker whose thread is this one: it structured-clones the message, runs the real runner, replies later. */
function fakeWorkerFactory({ dieOn = null } = {}) {
  return () => {
    const run = createJobRunner();
    const w = {
      onmessage: null, onerror: null, terminated: false,
      postMessage(message) {
        const { id, job, args } = structuredClone(message);
        setImmediate(() => {
          if (dieOn === job) { w.onerror?.({ message: 'boom', preventDefault() {} }); return; }
          try { const { result } = run(job, args); w.onmessage?.({ data: { id, ok: true, result, ms: 1 } }); }
          catch (error) { w.onmessage?.({ data: { id, ok: false, error: error.message, ms: 1 } }); }
        });
      },
      terminate() { w.terminated = true; },
    };
    return w;
  };
}

test('worker jobs return the goldens, the normal map after its grain field', async () => {
  const work = createOpeningWork({ makeWorker: fakeWorkerFactory(), workers: true });
  const terrain = await work.terrainSet;
  assert.equal(sha(terrain.grain), GOLD.terrainGrain);
  assert.equal(sha(terrain.roughness), GOLD.terrainRoughness);
  assert.equal(sha(terrain.undersideGrain), GOLD.undersideGrain);
  assert.equal(sha(terrain.undersideNormal), GOLD.undersideNormal);
  const chalk = await work.chalkSet;
  assert.equal(sha(chalk.grain), GOLD.chalkGrain);
  assert.equal(sha(chalk.roughness), GOLD.chalkRoughness);
  assert.equal(sha(chalk.normal), GOLD.chalkNormal);
  const hm = realHeightmap(ROOT);
  const normal = await work.terrainNormal(hm.floats, hm.width, hm.height);
  assert.equal(sha(normal), GOLD.terrainNormal);
  assert.ok(work.usesWorkers);
  assert.ok(work.timings().some(t => t.job === 'terrainNormal' && !t.inline));
});

test('without Worker the same jobs run on the main thread with the same bytes', async () => {
  const work = createOpeningWork({ workers: false });
  assert.equal(sha((await work.terrainSet).grain), GOLD.terrainGrain);
  const hm = realHeightmap(ROOT);
  assert.equal(sha(await work.terrainNormal(hm.floats, hm.width, hm.height)), GOLD.terrainNormal);
  assert.equal(work.usesWorkers, false);
  assert.ok(work.timings().every(t => t.inline));
});

test('a worker that dies mid-job is replaced by the main thread, with a warning, and the input survives', async () => {
  const warns = [];
  const realWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    const work = createOpeningWork({ makeWorker: fakeWorkerFactory({ dieOn: 'terrainNormal' }), workers: true });
    const hm = realHeightmap(ROOT);
    const normal = await work.terrainNormal(hm.floats, hm.width, hm.height);
    assert.equal(sha(normal), GOLD.terrainNormal);
    assert.ok(warns.some(w => /worker w1 unavailable/.test(w)));
    assert.equal(hm.floats.length > 0, true, 'the caller still owns its array (inputs are cloned, not transferred)');
  } finally { console.warn = realWarn; }
});

test('an unknown job is an error, not a hang', async () => {
  const run = createJobRunner();
  assert.throws(() => run('nope'), /unknown opening job/);
});
