// Sprint 25Sep26f (D-039, Lane H): the two-setup harness's pure parts. The
// browser runs themselves are exercised by using the script; these pin how a
// trace is summarised and how two runs are compared, which every lane's
// before/after numbers depend on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, SETUPS, WEAK_FPS_BAR, summariseTrace, compareRuns, parseArgs } from '../scripts/measure-setups.mjs';

test('the agreed setups and the five standard views plus arrival', () => {
  assert.deepEqual(SETUPS.weak, { dpr: 1, cpuThrottle: 4 });
  assert.deepEqual(SETUPS['as-lived'], { dpr: 2, cpuThrottle: 1 });
  assert.equal(WEAK_FPS_BAR, 30);
  assert.deepEqual(Object.keys(VIEWS), ['overview', 'streetBank', 'riverGreenwich', 'm25Edge', 'heathrow', 'arrival']);
  assert.equal(VIEWS.arrival, null);
});

test('a trace settles on the most frequent rung of the last 8 s and counts its changes', () => {
  const trace = [];
  for (let i = 0; i < 96; i++) {
    const level = i < 40 ? 3 : i < 70 ? (i % 2 ? 1 : 2) : 0; // climbs, wobbles, then shadows for the last 26
    trace.push([i * 250, level, level >= 2 ? 0.85 : 1, 4, level === 0 ? 1 : 0]);
  }
  const s = summariseTrace(trace);
  assert.equal(s.level, 0);
  assert.equal(s.settled, '1/4x/shadows');
  assert.equal(s.changesLast8s, 6); // five in the wobble's tail (samples 64 to 69) plus the step to shadows
  assert.equal(s.firstShadowsMs, 70 * 250);
});

test('compare prints before and after per view with the fps change and the weak bar', () => {
  const run = (label, fps) => ({ setup: 'weak', label, views: {
    overview: { level: 0, settled: '1/4x/shadows', fps, changesLast8s: 0 },
    heathrow: { level: 2, settled: '0.85/4x/noshadows', fps: fps - 5, changesLast8s: 1 },
  } });
  const { rows, text } = compareRuns(run('before', 31), run('after', 36));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dfps, 5);
  assert.deepEqual(rows[1].weakPass, { before: false, after: true });
  assert.match(text, /overview\s+L0 1\/4x\/shadows 31\.0fps ch0\s+L0 1\/4x\/shadows 36\.0fps ch0\s+\+5\.0/);
  assert.match(text, />=30fps: NO -> yes/);
});

test('arguments: positionals, options and --files', () => {
  assert.deepEqual(parseArgs(['weak', 'http://x', '--views', 'arrival', '--settle', '60']),
    { pos: ['weak', 'http://x'], opt: { views: 'arrival', settle: '60' } });
  assert.deepEqual(parseArgs(['--files', 'a.json', 'b.json']).opt.files, ['a.json', 'b.json']);
});
