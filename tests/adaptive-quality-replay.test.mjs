// adaptive-quality-replay.test.mjs (sprint 21Oct26w, lane T, T-auto): Automatic's loose ends were tidied (atLevel bounded, recentOver and
// the unused over() deleted, heavy reset in reset() and capped) with NO change of decision. The fixture was generated once from
// `git show 7c2d4bd:src/adaptive-quality.js`; this replays the six recorded weak-setup traces (an hour each) and 200 seeded synthetic
// runs against the current controller and compares every decision (time, rungs and reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mod from '../src/adaptive-quality.js';
import { replayViews, fuzz, hourAtOneRung } from './helpers/aq-decisions.mjs';

const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const FIX = read('./fixtures/aq-decisions-7c2d4bd.json');
const AQ = read('./fixtures/aq-weak-intervals.json');

test('s21:T the fixture carries the digests recorded from 7c2d4bd', () => {
  assert.equal(Object.keys(FIX.replay).length, 6);
  assert.deepEqual(Object.fromEntries(Object.entries(FIX.replay).map(([k, v]) => [k, [v.n, v.sha256]])), {
    'live-streetBank': [121, '0ec7d4d51c6e13c0f3e04fe583348e9143e5abfb304933546528cf66e0714f46'],
    'live-playerFoot': [111, '0ecf6d3fc1188c2fcc28ee77f5acdf49233478cb44215cddb26da61424d88f81'],
    'live-playerSkate': [146, '60d9f3c57afc51aeab209fa6fdb55a66d25feac13f8bc3196168d70a9bc0cbb2'],
    'live-playerBalloon': [121, 'c3c34f953a940a75f1cef9798cf8e8408abb5c03ff11fb496d469b0179d90df2'],
    'wed-streetBank': [121, '8253ff1b97ab55bc29ce73c20d5c698cdca40c72fb728d09f32ce90d6241c6b8'],
    'wed-overview': [121, '8e15264d66586d3a3562dbd4aca2c0b0ac04c688ad603a3a8022b1b47e826906'],
  });
  assert.deepEqual([FIX.fuzz.seeds, FIX.fuzz.n, FIX.fuzz.sha256], [200, 19064, 'edaf754325e699b2f96e6e7fd2b4eb3969c3a19e20b105b8038b1630689512eb']);
});

test('s21:T replay: the six recorded weak-setup traces, an hour each, give the same decisions as 7c2d4bd', () => {
  const got = replayViews(mod, AQ.views);
  assert.deepEqual(Object.keys(got), Object.keys(FIX.replay));
  for (const [name, want] of Object.entries(FIX.replay)) {
    assert.deepEqual(got[name].first300s, want.first300s, `${name}: the first 300 s decision rows`);
    assert.equal(got[name].n, want.n, `${name}: decision count`);
    assert.equal(got[name].sha256, want.sha256, `${name}: every decision of the hour`);
  }
});

test('s21:T fuzz: 200 seeded synthetic runs of 600 s give the same decisions as 7c2d4bd', () => {
  const got = fuzz(mod);
  assert.equal(got.n, FIX.fuzz.n);
  assert.equal(got.sha256, FIX.fuzz.sha256);
});

test('s21:T an hour of frames at one rung keeps the window means bounded, with no decision', () => {
  const r = hourAtOneRung(mod);
  assert.equal(r.changes, 0);
  assert.ok(r.maxWindowsAtLevel >= 1 && r.maxWindowsAtLevel <= Math.max(mod.ADAPTIVE_TUNING.judgeWindows, mod.ADAPTIVE_TUNING.anchorWindows),
    `windowsAtLevel peaked at ${r.maxWindowsAtLevel}`);
});

test('s21:T state() reports windowsAtLevel (the bound test reads it) and carries no recentOver', () => {
  const c = mod.createAdaptiveQuality({ apply() {} });
  c.start(0);
  const s = c.state();
  assert.equal(s.windowsAtLevel, 0);
  assert.ok(!('recentOver' in s));
});
