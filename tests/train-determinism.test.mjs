// Sprint 25Sep26f (D-039, Lane H): tube trains are seeded by train id and their
// positions are a pure function of the simulation clock. Checks that two builds
// of the same line give the same ids, phases and dwells without touching
// Math.random; that the same elapsed time gives the same positions however the
// time was split into frames; that the pure query matches the live updater; and
// that a branch rebuilt on a resnapped (vertically moved) curve keeps its ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// trains.js paints its window texture on a canvas; a no-op 2D context suffices.
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }),
};
const { createTrainSystem, createTrains, updateTrains, trainStateAt, seededRandom } = await import('../src/trains.js');

const PTS = [new THREE.Vector3(0, -20, 0), new THREE.Vector3(4000, -25, 800), new THREE.Vector3(9000, -40, 300), new THREE.Vector3(14000, -22, -500)];
function build(lineId = 'central', dy = 0) {
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  const pts = PTS.map(p => p.clone().setY(p.y + dy));
  const left = new THREE.CatmullRomCurve3(pts), right = new THREE.CatmullRomCurve3(pts.map(p => p.clone().add(new THREE.Vector3(0, 0, 12))));
  const system = createTrainSystem({ scene });
  const trains = createTrains({ system, leftCurve: left, rightCurve: right, stationUs: [0.1, 0.35, 0.6, 0.85], lineId, colour: 0xdc241f, group });
  return { system, trains };
}
const snapshot = trains => trains.map(t => ({ id: t.userData.id, t: t.userData.t, dwell: t.userData.dwellSec, p: t.position.toArray() }));
// Fails if trains.js itself draws from Math.random (three.js object UUIDs may, and do not matter).
function withoutMathRandom(fn) {
  const real = Math.random;
  Math.random = () => {
    const caller = new Error().stack.split('\n')[2] || ''; // the frame that called Math.random
    if (/src\/trains\.js/.test(caller)) throw new Error('Math.random called by the train simulation');
    return real();
  };
  try { return fn(); } finally { Math.random = real; }
}

test('two builds of a line give identical ids, phases and dwells, with no Math.random', () => {
  const a = withoutMathRandom(() => build()), b = withoutMathRandom(() => build());
  assert.ok(a.trains.length > 4);
  assert.deepEqual(snapshot(a.trains), snapshot(b.trains));
  const ids = a.trains.map(t => t.userData.id);
  assert.equal(new Set(ids).size, ids.length, 'train ids are unique');
  // Seeded, not constant: dwells still vary within the documented +-4 s band.
  const dwells = new Set(a.trains.map(t => t.userData.dwellSec.toFixed(6)));
  assert.ok(dwells.size > 1);
  for (const t of a.trains) assert.ok(t.userData.dwellSec >= 26 && t.userData.dwellSec <= 34);
});

test('same elapsed time, same positions, whatever the frame sequence', () => {
  const sim = { paused: false, timeScale: 8 };
  const a = build(), b = build();
  // A: steady 60 Hz for 90 s of wall time. B: ragged frames (including stalls) summing to the same.
  withoutMathRandom(() => {
    for (let i = 0; i < 5400; i++) updateTrains(a.system, sim, null, 1 / 60);
    const rnd = seededRandom('ragged'); let left = 90;
    while (left > 1e-9) { const dt = Math.min(left, rnd() < 0.02 ? 1.5 : rnd() * 0.05); updateTrains(b.system, sim, null, dt); left -= dt; }
  });
  assert.ok(Math.abs(a.system.simTime - b.system.simTime) < 1e-6);
  // Align clocks exactly (float sums differ in the last bits), then compare.
  b.system.simTime = a.system.simTime; updateTrains(b.system, { paused: true, timeScale: 1 }, null, 0);
  let worst = 0, dwelling = 0;
  a.trains.forEach((t, i) => { worst = Math.max(worst, t.position.distanceTo(b.trains[i].position)); if (t.userData._pausedLeft > 0) dwelling++; });
  assert.ok(worst < 1e-6, `worst position difference ${worst}`);
  assert.ok(dwelling > 0, 'some trains are dwelling at stations');
});

test('the pure query matches the live updater, and paused time stands still', () => {
  const a = build(), sim = { paused: false, timeScale: 8 };
  for (let i = 0; i < 300; i++) updateTrains(a.system, sim, null, 1 / 30);
  for (const t of a.trains) {
    const st = trainStateAt(t.userData, a.system.simTime);
    assert.equal(st.t, t.userData.t); assert.equal(st.pausedLeft, t.userData._pausedLeft);
    assert.ok(t.userData.curve.getPointAt(st.t).distanceTo(t.position) < 1e-9);
  }
  const before = snapshot(a.trains);
  updateTrains(a.system, { paused: true, timeScale: 8 }, null, 5);
  assert.deepEqual(snapshot(a.trains), before);
});

test('a branch rebuilt on a resnapped curve keeps its ids and timetable phase', () => {
  const a = build('northern'), b = build('northern', -6);
  assert.deepEqual(a.trains.map(t => t.userData.id), b.trains.map(t => t.userData.id));
  assert.deepEqual(a.trains.map(t => t.userData.dwellSec), b.trains.map(t => t.userData.dwellSec));
  // Anchored at clock zero: the same timetable time on both, so the curve parameter at a
  // given clock differs only by the small change in curve length from the resnap.
  const T = 600;
  a.trains.forEach((t, i) => {
    const sa = trainStateAt(t.userData, T), sb = trainStateAt(b.trains[i].userData, T);
    const du = Math.min(Math.abs(sa.t - sb.t), 1 - Math.abs(sa.t - sb.t));
    assert.ok(du < 0.02, `${t.userData.id}: ${sa.t} vs ${sb.t}`);
  });
});

test('a curve rebuilt with new depths keeps each train near its place, even late in a session', () => {
  // main.js keeps DLR trains across a resnap and swaps in the rebuilt curve;
  // other lines rebuild their trains, which rejoin the same timetable. Depths
  // here are stretched by 1.5x (a Master change), which lengthens the 3-D curve
  // but not the plan-view length that paces the timetable.
  const a = build('dlr');
  const deeper = new THREE.CatmullRomCurve3(PTS.map(p => p.clone().setY(p.y * 1.5)));
  const T = 20000; // about 42 minutes at the default 8x
  const probe = a.trains.find(t => t.userData.dir > 0);
  const ud = probe.userData, before = trainStateAt(ud, T);
  const p0 = ud.curve.getPointAt(before.t);
  ud.curve = deeper; ud.curveLengthM = deeper.getLength();
  const after = trainStateAt(ud, T), p1 = deeper.getPointAt(after.t);
  const planShift = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  assert.ok(planShift < 1, `plan shift ${planShift.toFixed(2)} m`); // measured 0.009 m
});
