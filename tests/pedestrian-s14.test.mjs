// Pedestrian body, sprint 14Oct26w lane M (D-053 items 5 to 7): Space tap and hold, the jetpack hand-over
// and jetLevel, jetpack steering, swimming up and down, and level swimming in third person.
// Pure physics against tiny fake worlds, so no GPU and no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEDESTRIAN_TUNABLES, createBody, stepBody } from '../src/modes/pedestrian-body.js';

const VE = 5;
const P = Object.fromEntries(PEDESTRIAN_TUNABLES.map(d => [d.key, d.default]));
const DEF = Object.fromEntries(PEDESTRIAN_TUNABLES.map(d => [d.key, d]));
const RATES = [30, 60, 120];

const pass = (pos, d) => ({ x: pos.x + d.x, z: pos.z + d.z, hit: false });
const LAND = { moveAndSlide: pass, standHeightAt: () => 0, waterAt: () => null };
const ROOF_Y = 10 * VE;
const ROOF = { moveAndSlide: pass, standHeightAt: (x, z, feetY, step) => (x < 10 && feetY + step >= ROOF_Y - 1e-9 ? ROOF_Y : 0), waterAt: () => null };
const W_TOP = 2 * VE, W_BED = -6 * VE;
const WATER = { moveAndSlide: pass, standHeightAt: () => W_BED, waterAt: () => ({ surfaceY: W_TOP, bedY: W_BED }) };
const EYE_TOP = W_TOP + 0.2 * VE;

function sim(world, start, hz, secs, inputAt, p = P) {
  const dt = 1 / hz, b = Object.assign(createBody(), start), ev = [], tr = [];
  for (let i = 0, n = Math.round(secs * hz); i < n; i++) {
    const before = ev.length;
    stepBody(b, inputAt(i, b), dt, world, p, VE, ev);
    tr.push({ i, t: (i + 1) * dt, y: b.y, vy: b.vy, vx: b.vx, state: b.state, jet: !!b.jet, jl: b.jetLevel, ev: ev.slice(before) });
  }
  return { b, tr, ev, dt };
}
const at = (tr, t) => tr.find(s => s.t >= t - 1e-9);
const apexOf = (tr) => Math.max(...tr.map(s => s.y)) / VE;

// ── tap ──
test('a Space tap leaves the ground in its own frame and never fires the jetpack', () => {
  for (const hz of RATES) {
    const r = sim(LAND, {}, hz, 2, (i) => ({ jumpPressed: i === 0, jumpHeld: i === 0 }));
    assert.ok(r.tr[0].y > 0, `${hz} Hz left the ground`);
    assert.ok(r.tr.every(s => !s.jet && s.jl === 0), `${hz} Hz no jetpack`);
    assert.equal(r.b.state, 'ground');
  }
});

test('a press already released gives the plain jump apex, at every rate', () => {
  const want = P.jump ** 2 / (2 * P.gravity);
  for (const hz of RATES) {
    const r = sim(LAND, {}, hz, 2, (i) => ({ jumpPressed: i === 0, jumpHeld: false }));
    assert.ok(Math.abs(apexOf(r.tr) - want) < 0.01, `${hz} Hz apex ${apexOf(r.tr)} vs ${want}`);
  }
});

test('a short hold jumps higher by jump x hold time and still never jets', () => {
  for (const h of [0.05, 0.1]) for (const hz of RATES) {
    const nHeld = Math.round(h * hz);
    const r = sim(LAND, {}, hz, 2.5, (i) => ({ jumpPressed: i === 0, jumpHeld: i < nHeld }));
    const want = P.jump ** 2 / (2 * P.gravity) + P.jump * nHeld / hz;
    assert.ok(Math.abs(apexOf(r.tr) - want) < 0.02, `${hz} Hz hold ${h}: ${apexOf(r.tr)} vs ${want}`);
    assert.ok(r.tr.every(s => !s.jet && s.jl === 0));
  }
});

// ── hold ──
const HOLD = {
  standing: { world: LAND, start: {}, pre: 0, input: {} },
  running: { world: LAND, start: {}, pre: 1, input: { forward: 1, yaw: 0 } },
  roofEdgeJump: { world: ROOF, start: { x: 9.6, y: ROOF_Y }, pre: 0, input: { forward: 1, yaw: -Math.PI / 2 } },
};
function holdRun(c, hz, secs = 2) {
  const dt = 1 / hz, b = Object.assign(createBody(), c.start);
  for (let i = 0; i < Math.round(c.pre * hz); i++) stepBody(b, { ...c.input }, dt, c.world, P, VE, []);
  const y0 = b.y, tr = [{ t: 0, y: b.y, vy: b.vy, jet: !!b.jet, jl: b.jetLevel }];
  for (let i = 0; i < Math.round(secs * hz); i++) {
    stepBody(b, { ...c.input, jumpPressed: i === 0, jumpHeld: true }, dt, c.world, P, VE, []);
    tr.push({ t: (i + 1) * dt, y: b.y, vy: b.vy, jet: !!b.jet, jl: b.jetLevel });
  }
  return { tr, y0, dt };
}

test('holding Space hands over to the jetpack at the delay, with no dip and no stall', () => {
  for (const [name, c] of Object.entries(HOLD)) for (const hz of RATES) {
    const r = holdRun(c, hz);
    const first = r.tr.find(s => s.jet);
    assert.ok(first && first.t >= P.jetDelay - 1e-6 && first.t <= P.jetDelay + r.dt + 1e-6, `${name} ${hz} Hz first jet ${first?.t}`);
    for (let i = 1; i < r.tr.length; i++) {
      assert.ok(r.tr[i].vy >= r.tr[i - 1].vy - 1e-9, `${name} ${hz} Hz vy fell at ${r.tr[i].t}`);
      assert.ok(r.tr[i].y > r.tr[i - 1].y, `${name} ${hz} Hz height did not rise at ${r.tr[i].t}`);
    }
  }
});

test('the path is the same at 30, 60 and 120 Hz', () => {
  for (const [name, c] of Object.entries(HOLD)) {
    const ref = holdRun(c, 120);
    for (const hz of [30, 60]) {
      const r = holdRun(c, hz);
      for (const t of [0.5, 1, 1.5, 2]) {
        const a = at(r.tr, t), e = at(ref.tr, t);
        const hA = (a.y - r.y0) / VE, hE = (e.y - ref.y0) / VE;
        assert.ok(Math.abs(hA - hE) <= Math.max(0.05, 0.005 * Math.abs(hE)), `${name} ${hz} Hz t${t} height ${hA} vs ${hE}`);
        assert.ok(Math.abs(a.vy - e.vy) <= 0.05, `${name} ${hz} Hz t${t} vy ${a.vy} vs ${e.vy}`);
      }
    }
  }
});

test('the jetpack still climbs: about 20 m two seconds after the press', () => {
  for (const hz of RATES) {
    const r = holdRun(HOLD.standing, hz);
    const h = (at(r.tr, 2).y - r.y0) / VE;
    assert.ok(h >= 15 && h <= 25, `${hz} Hz ${h}`);
  }
});

test('walking off a roof with Space held fires at once and never dips', () => {
  for (const hz of RATES) {
    const r = sim(ROOF, { x: 7, y: ROOF_Y }, hz, 3, () => ({ forward: 1, yaw: -Math.PI / 2, jumpHeld: true }));
    const k = r.tr.findIndex(s => s.state === 'air');
    assert.ok(k >= 0);
    for (let i = k; i < r.tr.length; i++) {
      assert.ok(r.tr[i].y >= ROOF_Y - 1e-6, `${hz} Hz went below the roof`);
      if (i > k) assert.ok(r.tr[i].vy >= r.tr[i - 1].vy - 1e-9, `${hz} Hz vy fell`);
    }
  }
});

// ── jetLevel ──
test('jetLevel is 0 until the hand-over, rises to 1 over the spool, and never decreases while held', () => {
  for (const hz of RATES) {
    const r = holdRun(HOLD.standing, hz, 1);
    for (let i = 0; i < r.tr.length; i++) {
      const s = r.tr[i];
      assert.ok(Number.isFinite(s.jl) && s.jl >= 0 && s.jl <= 1);
      if (!s.jet) assert.equal(s.jl, 0); else assert.ok(s.jl > 0);
      if (i) assert.ok(s.jl >= r.tr[i - 1].jl - 1e-12);
    }
    const first = r.tr.find(s => s.jet);
    assert.ok(first.jl <= 1 / hz / P.jetSpool + 1e-6, `${hz} Hz first level ${first.jl}`);
    const full = r.tr.find(s => s.jl >= 1 - 1e-9);
    assert.ok(full && full.t <= P.jetDelay + P.jetSpool + 2 / hz + 1e-6);
  }
});

test('jetLevel resets on release, on entering water, and reads 0 on a new body', () => {
  assert.equal(createBody().jetLevel, 0);
  const dt = 1 / 60, b = createBody();
  for (let i = 0; i < 60; i++) stepBody(b, { jumpPressed: i === 0, jumpHeld: true }, dt, LAND, P, VE);
  assert.ok(b.jet && b.jetLevel > 0 && b.jetLevel <= 1);
  stepBody(b, { jumpHeld: false }, dt, LAND, P, VE);
  assert.ok(!b.jet && b.jetLevel === 0);
  const w = Object.assign(createBody(), { y: W_TOP + 2 * VE, state: 'air', airTime: 5, vy: -15 });
  for (let i = 0; i < 120 && w.state !== 'swim'; i++) stepBody(w, { jumpHeld: true }, dt, WATER, P, VE);
  assert.equal(w.state, 'swim');
  assert.equal(w.jetLevel, 0);
  // The mode's own `body.jet = false` reads 0 at once, and copying a body cannot throw.
  const j = Object.assign(createBody(), { jet: true, jetRamp: 0.7 });
  assert.equal(j.jetLevel, 0.7);
  j.jet = false;
  assert.equal(j.jetLevel, 0);
  assert.doesNotThrow(() => Object.assign(createBody(), { ...j }));
});

// ── steering ──
test('turning round at full jetpack speed takes about a second, and top speed is unchanged', () => {
  const SKY = LAND, top = P.speed * 2.5;
  for (const hz of RATES) {
    const dt = 1 / hz, b = Object.assign(createBody(), { y: 500 * VE, state: 'air', airTime: 10 });
    let vmax = 0;
    for (let i = 0; i < 6 * hz; i++) { stepBody(b, { forward: 1, yaw: -Math.PI / 2, jumpHeld: true }, dt, SKY, P, VE); vmax = Math.max(vmax, Math.hypot(b.vx, b.vz)); }
    let t = 0, t95 = null;
    for (let i = 0; i < 6 * hz; i++) {
      stepBody(b, { forward: 1, yaw: Math.PI / 2, jumpHeld: true }, dt, SKY, P, VE); t += dt;
      vmax = Math.max(vmax, Math.hypot(b.vx, b.vz));
      if (t95 === null && -b.vx >= 0.95 * top) t95 = t;
    }
    assert.ok(t95 >= 0.8 && t95 <= 1.3, `${hz} Hz reversal ${t95}`);
    assert.ok(Math.abs(vmax - 15) < 0.01, `${hz} Hz top ${vmax}`);
  }
  const a = Object.assign(createBody(), { y: 500 * VE, state: 'air', airTime: 10 });
  let amax = 0;
  for (let i = 0; i < 360; i++) { stepBody(a, { forward: 1, yaw: -Math.PI / 2 }, 1 / 60, LAND, P, VE); amax = Math.max(amax, Math.hypot(a.vx, a.vz)); }
  assert.ok(Math.abs(amax - P.speed) < 0.01, `air control top ${amax}`);
});

test('the Physics panel values: steer 32 with room above, new keys present, the rest unchanged', () => {
  assert.equal(DEF.jetControl.default, 32);
  assert.ok(DEF.jetControl.max >= 2 * DEF.jetControl.default);
  assert.equal(DEF.jetDelay.default, 0.15);
  assert.deepEqual([DEF.jetSpool.default, DEF.swimUp.default, DEF.swimDive.default], [0.15, 1.6, 1.6]);
  assert.equal(PEDESTRIAN_TUNABLES.length, 23);
  assert.deepEqual([DEF.tunnelWalk.default, DEF.tunnelSprint.default, DEF.shaftSpeed.default], [60, 200, 8]);
  const b = createBody();
  let vyMax = 0;
  for (let i = 0; i < 600; i++) { stepBody(b, { jumpPressed: i === 0, jumpHeld: true }, 1 / 60, LAND, P, VE); vyMax = Math.max(vyMax, b.vy); }
  assert.ok(vyMax <= P.jetMaxRise + 1e-9 && vyMax >= P.jetMaxRise - 1e-6);
});

// ── swimming ──
const SWIM = (y, extra = {}) => ({ y, state: 'swim', ...extra });
const FEET_TOP = W_TOP + (0.2 - P.eye) * VE;

test('holding Space swims up at the designed speed to the surface and bobs there', () => {
  for (const hz of RATES) {
    const r = sim(WATER, SWIM(W_BED), hz, 8, (i) => ({ jumpPressed: i === 0, jumpHeld: true }));
    const rate = (at(r.tr, 2).y - at(r.tr, 1).y) / VE;
    assert.ok(Math.abs(rate - P.swimUp) < 0.05, `${hz} Hz rise ${rate}`);
    const reach = r.tr.find(s => s.y + P.eye * VE >= EYE_TOP - 1e-6);
    assert.ok(reach && 8 - reach.t >= 3);
    for (const s of r.tr.filter(s => s.t >= reach.t)) {
      const eye = s.y + P.eye * VE;
      assert.equal(s.state, 'swim');
      assert.ok(eye <= EYE_TOP + 1e-6 && eye >= EYE_TOP - 0.05 * VE);
    }
  }
});

test('a tap is one stroke, and so is a two-second hold', () => {
  for (const hz of RATES) {
    const tap = sim(WATER, SWIM(-2 * VE), hz, 2, (i) => ({ jumpPressed: i === 0, jumpHeld: i === 0 }));
    const hold = sim(WATER, SWIM(-2 * VE), hz, 2, (i) => ({ jumpPressed: i === 0, jumpHeld: true }));
    assert.equal(tap.ev.filter(e => e.type === 'stroke').length, 1);
    assert.equal(hold.ev.filter(e => e.type === 'stroke').length, 1);
  }
});

test('holding Q dives at the designed speed to the bed and rests there; W still swims along it', () => {
  for (const hz of RATES) {
    const r = sim(WATER, SWIM(FEET_TOP), hz, 6, () => ({ dive: true }));
    const rate = (at(r.tr, 2).y - at(r.tr, 1).y) / VE;
    assert.ok(Math.abs(rate + P.swimDive) < 0.05, `${hz} Hz dive ${rate}`);
    const bedT = r.tr.find(s => s.y <= W_BED + 1e-6);
    assert.ok(bedT && 6 - bedT.t >= 1.5);
    assert.ok(r.tr.filter(s => s.t >= bedT.t).every(s => Math.abs(s.y - W_BED) <= 1e-6 && s.state === 'swim'));
    const x0 = r.b.x;
    const r2 = sim(WATER, r.b, hz, 2, () => ({ dive: true, forward: 1, yaw: -Math.PI / 2 }));
    assert.ok(r2.b.x - x0 >= 2);
    assert.ok(r2.tr.every(s => Math.abs(s.y - W_BED) <= 1e-6 && s.state === 'swim'));
  }
});

test('swim up and dive depth agree to 0.05 m across frame rates', () => {
  const up = (hz) => sim(WATER, SWIM(W_BED), hz, 3, (i) => ({ jumpPressed: i === 0, jumpHeld: true }));
  const dn = (hz) => sim(WATER, SWIM(FEET_TOP), hz, 3, () => ({ dive: true }));
  for (const f of [up, dn]) {
    const ref = f(120);
    for (const hz of [30, 60]) {
      const r = f(hz);
      for (const t of [1, 2, 3]) assert.ok(Math.abs(at(r.tr, t).y - at(ref.tr, t).y) / VE <= 0.05);
    }
  }
});

test('third person (levelSwim): W keeps depth whatever the view pitch', () => {
  for (const hz of RATES) for (const pitch of [-Math.PI / 4, Math.PI / 4]) for (const vy0 of [0, -P.sink]) {
    const y0 = -2 * VE;
    const r = sim(WATER, SWIM(y0, { vy: vy0 }), hz, 3, () => ({ forward: 1, yaw: -Math.PI / 2, pitch, levelSwim: true }));
    const dd = Math.max(...r.tr.map(s => Math.abs(s.y - y0))) / VE;
    assert.ok(dd <= 0.1, `${hz} Hz pitch ${pitch} depth change ${dd}`);
    assert.ok(r.b.x >= 3.5, `${hz} Hz swam ${r.b.x}`);
  }
});

// bf10309 numbers (60 Hz, 3 s, surface 10, bed -100 canonical, from y = -10, no Space or Q held).
const BF = {
  Wdown: { x: 3.7297025930523775, y: -36.62381022048343 },
  Wup: { x: -1.7660572445669878, y: -3.8794596633040297 },
  idle: { x: 0, y: -17.601984639805337 },
  strafe: { x: 1.6798675015943731, y: 2.447995804908873 },
};
test('first person (levelSwim false) is bf10309 bit for bit when neither Space nor Q is held', () => {
  const deep = { moveAndSlide: pass, standHeightAt: () => -100, waterAt: () => ({ surfaceY: 10, bedY: -100 }) };
  const inputs = {
    Wdown: () => ({ forward: 1, yaw: -Math.PI / 2, pitch: -Math.PI / 4 }),
    Wup: () => ({ forward: 1, yaw: 0.3, pitch: 0.5 }),
    idle: () => ({}),
    strafe: (i) => ({ right: 1, yaw: 1, pitch: -0.2, jumpPressed: i % 40 === 0 }),
  };
  for (const [name, fn] of Object.entries(inputs)) {
    const r = sim(deep, SWIM(-10), 60, 3, (i) => ({ ...fn(i), levelSwim: false }));
    assert.ok(Math.abs(r.b.x - BF[name].x) < 1e-9, `${name} x ${r.b.x}`);
    assert.ok(Math.abs(r.b.y - BF[name].y) < 1e-9, `${name} y ${r.b.y}`);
  }
});

test('Space and Q together are no command: the same as idle', () => {
  const both = sim(WATER, SWIM(-2 * VE), 60, 3, () => ({ jumpHeld: true, dive: true }));
  const idle = sim(WATER, SWIM(-2 * VE), 60, 3, () => ({}));
  assert.ok(Math.abs(both.b.y - idle.b.y) < 1e-9);
});

test('Q means nothing out of the water', () => {
  const f = (dv) => sim(LAND, {}, 60, 3, (i) => ({ forward: 1, yaw: 0.2, jumpPressed: i === 30, jumpHeld: i >= 30 && i < 90, dive: dv })).b;
  const a = f(true), b = f(false);
  assert.deepEqual([a.x, a.y, a.z, a.vy], [b.x, b.y, b.z, b.vy]);
});

test('the new inputs keep the body deterministic', () => {
  const inputs = (i) => ({ forward: 1, right: (i >> 5) & 1, yaw: -Math.PI / 2 + i * 0.001, jumpPressed: i % 90 === 0, jumpHeld: i % 90 < 40, dive: (i >> 6) & 1, levelSwim: !!((i >> 7) & 1) });
  const mixed = { moveAndSlide: pass, standHeightAt: (x) => (x > 30 ? W_BED : 0), waterAt: (x) => (x > 30 ? { surfaceY: W_TOP, bedY: W_BED } : null) };
  const a = sim(mixed, {}, 60, 8, inputs).b, b = sim(mixed, {}, 60, 8, inputs).b;
  assert.equal(JSON.stringify({ ...a }), JSON.stringify({ ...b }));
});
