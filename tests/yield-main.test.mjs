import test from 'node:test';
import assert from 'node:assert/strict';

test('concurrent builders spend separate frame slices when the first exhausts the shared budget', async () => {
  const originals = Object.fromEntries(['performance', 'scheduler', 'requestAnimationFrame'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let now = 10;
  const frames = [], done = [];
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: { postTask: fn => Promise.resolve().then(fn) } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: fn => frames.push(fn) });
  try {
    const { yieldMain, setLoadingSliceBudget } = await import('../src/yield-main.js');
    setLoadingSliceBudget(2);
    const build = async id => { await yieldMain(); now += 3; done.push(id); };
    const a = build('a'), b = build('b'), c = build('c');
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    assert.equal(frames.length, 1);
    frames.shift()(); await flush();
    assert.deepEqual(done, ['a']); assert.equal(frames.length, 1);
    frames.shift()(); await flush();
    assert.deepEqual(done, ['a', 'b']); assert.equal(frames.length, 1);
    frames.shift()(); await flush();
    await Promise.all([a, b, c]);
    assert.deepEqual(done, ['a', 'b', 'c']); assert.equal(frames.length, 0);
  } finally {
    for (const [k, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
    }
  }
});
