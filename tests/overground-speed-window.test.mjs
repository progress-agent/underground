// overground-speed-window.test.mjs (sprint 21Oct26w, lane T, T-weaver): why "O-RTE-1 Weaver leg 2" read `speed window 211.8` once in five
// whole-group runs, reproduced offline, and the state- and distance-based measure that does not vary.
//
// The Weaver's Enfield Town piece meets the Cheshunt trunk at Edmonton Green by a JOIN (overground-network.js): its end is 3.54 m from the
// trunk's end, so a 3.54 m segment that turns 94 degrees is appended. Leg 2 (Seven Sisters towards Enfield Town) changes path there. The
// walker is shown 2.6 m to the left of each segment's own heading and the presenter scales the step by the bend over +/- 12 m, so the shown
// point jumps at that vertex. The 7c2d4bd rule measured windows of 0.5 s of the mode clock and its first window on the new path started
// wherever the frames fell: 198 to 208 m/s here, 211.8 on the real build. Every other window is within 0.2 m/s of 200.
//
// This rebuilds the Weaver topology from public/data/overground.json with the app's own buildLineTopology and walks leg 2 with the app's own
// presenter (createOvergroundAirMap) at 200 fixed-seed phases (mulberry32), frames at 69 to 81 fps with 30% jitter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import '../src/coordinates.js';   // defines EPSG:27700 exactly as the app does
import { buildLineTopology } from '../src/modes/overground-network.js';
import { createOvergroundAirMap } from '../src/modes/overground-walk.js';
import { speeds, oldRuleWindows, END_CLEAR_M } from './helpers/speed-windows.mjs';

const mulberry = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- the Weaver topology, offline (heights 0) ----
const data = JSON.parse(readFileSync(new URL('../public/data/overground.json', import.meta.url), 'utf8'));
const weaver = data.lines.find(l => l.id === 'weaver');
const P = (lon, lat) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e, z: -n }; };
const branches = weaver.branches.map(b => {
  const cls = new Array(b.points.length).fill('surface');
  for (const s of b.segments || []) for (let i = s.i0; i < Math.min(s.i1, b.points.length); i++) cls[i] = s.class;
  const out = [];
  for (let i = 0; i < b.points.length - 1; i++) {
    const a = P(...b.points[i]), c = P(...b.points[i + 1]), steps = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 12));
    for (let j = 0; j < steps + (i === b.points.length - 2 ? 1 : 0); j++) { const t = j / steps; out.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, y: 0, cls: cls[i] }); }
  }
  return out;
});
const stations = weaver.stations.map(s => ({ id: s.naptan, name: s.name, pos: { ...P(s.lon, s.lat), y: 0 } }));
const topo = buildLineTopology({ id: 'weaver', branches, stations }, { groundY: () => 0 });

const mk = verts => {
  const vertices = verts.map(v => ({ x: v.x, y: 0, z: v.z })), vertexS = [0];
  for (let i = 1; i < vertices.length; i++) vertexS.push(vertexS[i - 1] + Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z));
  return { vertices, vertexS, og: verts.map(v => v.rec), length: vertexS.at(-1) };
};
// Leg 2: from Seven Sisters along the Cheshunt trunk (piece 1) to the junction at Edmonton Green, then the Enfield Town piece (piece 3) back to its end.
const p1v = topo.pieces[1].verts, e3 = topo.pieces[3].verts.at(-1);
let qi = -1, qd = Infinity; p1v.forEach((v, i) => { const d = Math.hypot(v.x - e3.x, v.z - e3.z); if (d < qd) { qd = d; qi = i; } });
const sst = stations.find(s => /Seven Sisters/.test(s.name)).pos;
let si = 0, sd = Infinity; p1v.forEach((v, i) => { const d = Math.hypot(v.x - sst.x, v.z - sst.z); if (d < sd) { sd = d; si = i; } });
const A = mk(p1v.slice(0, qi + 1)), B = mk(topo.pieces[3].verts);
const startS = A.vertexS[si];

/** One walk of leg 2 at 200 m/s: frames shaped like the spec's ride() records. */
function walk(rnd, fps, jitter, laneB) {
  const mA = createOvergroundAirMap({ path: A }), mB = createOvergroundAirMap({ path: B });
  const q = {}, frames = []; let path = 0, s = startS + rnd() * 3, clock = 0;
  const push = () => frames.push({ clock, x: q.x, z: q.z, path, s, len: path === 0 ? A.length : B.length, speed: 200, regime: 'open', cut: null, bridged: false });
  mA.presentAt(s, 1, q); push();
  for (;;) {
    const dt = (1 / fps) * (1 + jitter * (2 * rnd() - 1)); clock += dt;
    if (path === 0) { s = mA.trackToChord(s, 1, 200 * dt); if (s >= A.length) { const left = s - A.length; path = 1; s = B.length - left; } }
    else { s = mB.trackToChord(s, -1, 200 * dt); if (s <= 0) break; }
    (path === 0 ? mA : mB).presentAt(s, path === 0 ? 1 : laneB, q); push();
  }
  return { frames };
}

const RUNS = 200;
const runs = [];
{ const rnd = mulberry(21); for (let k = 0; k < RUNS; k++) runs.push(walk(rnd, 69 + rnd() * 12, 0.3, -1)); }

test('s21:T the Weaver topology rebuilds offline, with the 94-degree join at Edmonton Green', () => {
  assert.ok(A.length > 1000 && B.length > 1500, `lengths ${A.length}, ${B.length}`);
  // the join: the last vertices of the Enfield Town piece turn sharply (the 3.54 m connector)
  const v = B.vertices.slice(-3);
  const h = (a, b) => Math.atan2(b.x - a.x, b.z - a.z), turn = Math.abs(Math.atan2(Math.sin(h(v[1], v[2]) - h(v[0], v[1])), Math.cos(h(v[1], v[2]) - h(v[0], v[1])))) * 180 / Math.PI;
  const seg = Math.hypot(v[2].x - v[1].x, v[2].z - v[1].z);
  console.log(`join: last segment ${seg.toFixed(2)} m, turn ${turn.toFixed(0)} degrees`);
  assert.ok(seg < 6 && turn > 60, `a short segment (${seg.toFixed(2)} m) that turns sharply (${turn.toFixed(0)} degrees)`);
});

test('s21:T the 7c2d4bd rule: its first window on the new path varies by more than 5 m/s with where the frames fall', () => {
  const first = runs.map(r => oldRuleWindows(r, 200).find(w => w.path === 1)).filter(Boolean);
  assert.ok(first.length >= RUNS * 0.9, `${first.length} runs have a window on the new path`);
  const v = first.map(w => w.v), lo = Math.min(...v), hi = Math.max(...v);
  console.log(`old rule, first window on the Enfield Town path: ${lo.toFixed(1)} to ${hi.toFixed(1)} m/s over ${first.length} phases; its start is ${Math.min(...first.map(w => w.fromEnd)).toFixed(1)} to ${Math.max(...first.map(w => w.fromEnd)).toFixed(1)} m of arc from the path end`);
  assert.ok(hi - lo > 5, `spread ${(hi - lo).toFixed(2)}`);
  assert.ok(first.every(w => w.fromEnd < 20), 'it starts within 20 m of arc of the junction end');
  // every other window of the leg is steady
  const others = runs.flatMap(r => { const w = oldRuleWindows(r, 200); const i = w.findIndex(x => x.path === 1); return w.filter((x, k) => k !== i && !(x.path === 1 && x.fromEnd < 20)); });
  const worst = Math.max(...others.map(w => Math.abs(w.v - 200)));
  console.log(`old rule, every window not at a path end: worst deviation ${worst.toFixed(2)} m/s over ${others.length} windows`);
  assert.ok(worst < 2, `worst ${worst}`);
});

test('s21:T the new rule: every window within 200 +/- 1 and at least 50 windows, at every phase', () => {
  let worst = 0, fewest = Infinity;
  for (const r of runs) {
    const v = speeds(r, 200); fewest = Math.min(fewest, v.length);
    for (const x of v) worst = Math.max(worst, Math.abs(x - 200));
  }
  console.log(`new rule: worst deviation ${worst.toFixed(3)} m/s, fewest windows ${fewest} over ${RUNS} phases`);
  assert.ok(worst <= 1, `worst ${worst}`);
  assert.ok(fewest >= 50, `fewest ${fewest}`);
});

test('s21:T the new rule is state-based: no window starts, runs or ends within END_CLEAR_M of a path end, and it closes by distance', () => {
  // a synthetic record: steady 200 m/s on one path of 1000 m, then a frame 5 m from the end must void any window that reaches it
  const frames = []; let clock = 0;
  for (let s = 10; s < 995; s += 3) { frames.push({ clock, x: s, z: 0, path: 'p', s, len: 1000, speed: 200, regime: 'open', cut: null, bridged: false }); clock += 3 / 200; }
  const v = speeds({ frames }, 200);
  assert.ok(v.length >= 5);
  for (const x of v) assert.ok(Math.abs(x - 200) < 1e-6, `${x}`);
  // 100 m of arc per window, frames of 3 m: a window spans 34 frames; the last start is at most 1000 - 20 - 100 - 3
  assert.ok(v.length <= Math.floor((1000 - 2 * END_CLEAR_M) / 100) + 1, `${v.length}`);
  // a 94-degree jump in plan (the join) voids the window it falls in: a step whose plan distance exceeds 3 x the arc step + 1 m
  const jumpy = frames.map((f, i) => (i === 100 ? { ...f, x: f.x + 12 } : f));
  const vj = speeds({ frames: jumpy }, 200);
  assert.ok(vj.length < v.length, `${vj.length} < ${v.length}`);
  assert.equal(speeds({ frames: [] }, 200).length, 0, 'no frames, no windows');
});
