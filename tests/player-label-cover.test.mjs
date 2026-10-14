// player-label-cover.test.mjs: station names hidden where the figure covers them (sprint 14Oct26w, lane P).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFigureLabelCover, displayedNdc, overlapArea, COVER_OVERLAP } from '../src/player/label-cover.js';

const FIG = { x: 100, y: 100, w: 100, h: 200 };
const cover = (fig) => createFigureLabelCover({ getFigureScreenRect: () => fig });

test('a null figure rectangle never hides', () => {
  const o = cover(null);
  assert.equal(o({ x: 100, y: 100, w: 50, h: 20 }), false);
  assert.equal(createFigureLabelCover({ getFigureScreenRect: () => undefined })({ x: 0, y: 0, w: 10, h: 10 }), false);
});

test('a label whose centre is inside the rectangle is hidden', () => {
  assert.equal(cover(FIG)({ x: 120, y: 150, w: 20, h: 10 }), true);
  // mostly outside, but the centre inside
  assert.equal(cover(FIG)({ x: 180, y: 150, w: 40, h: 10 }), true);
});

test('overlap of at least 25% of the label hides it even with the centre outside', () => {
  const hidden = cover(FIG)({ x: 70, y: 150, w: 100, h: 20 });     // centre at x = 120: inside
  assert.equal(hidden, true);
  const quarter = cover(FIG)({ x: 25, y: 150, w: 100, h: 20 });    // x 25..125: 25% inside, centre 75 outside
  assert.equal(quarter, true);
  assert.equal(overlapArea(FIG, { x: 25, y: 150, w: 100, h: 20 }) / 2000, COVER_OVERLAP);
});

test('overlap of 10% with the centre outside shows the label', () => {
  const label = { x: 10, y: 150, w: 100, h: 20 };                  // x 10..110: 10% inside, centre 60 outside
  assert.equal(overlapArea(FIG, label) / 2000, 0.1);
  assert.equal(cover(FIG)(label), false);
});

test('a disjoint label shows', () => {
  assert.equal(cover(FIG)({ x: 400, y: 400, w: 50, h: 20 }), false);
  assert.equal(cover(FIG)({ x: 100, y: 320, w: 50, h: 20 }), false);   // just below
});

test('a zero-size label does not throw: hidden only if its point is inside the figure', () => {
  assert.doesNotThrow(() => cover(FIG)({ x: 150, y: 150, w: 0, h: 0 }));
  assert.equal(cover(FIG)({ x: 150, y: 150, w: 0, h: 0 }), true);
  assert.equal(cover(FIG)({ x: 10, y: 10, w: 0, h: 0 }), false);
});

test('the figure rectangle is read afresh on every call', () => {
  let fig = null;
  const o = createFigureLabelCover({ getFigureScreenRect: () => fig });
  const label = { x: 120, y: 150, w: 20, h: 10 };
  assert.equal(o(label), false);
  fig = FIG;
  assert.equal(o(label), true);
  fig = null;
  assert.equal(o(label), false);
});

test('displayedNdc is the identity for an identity distortion', () => {
  const id = (x, y) => ({ x, y });
  for (const p of [{ x: 0, y: 0 }, { x: 0.5, y: -0.3 }, { x: -0.8, y: 0.8 }]) {
    const d = displayedNdc(p, id);
    assert.ok(Math.abs(d.x - p.x) < 1e-12 && Math.abs(d.y - p.y) < 1e-12);
  }
});

test('displayedNdc inverts a synthetic barrel distortion (k = -0.3) to 1e-3 for |p| <= 0.8', () => {
  const k = -0.3;
  const barrel = (x, y) => { const r2 = x * x + y * y; const f = 1 + k * r2; return { x: x * f, y: y * f }; };
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
    const p = { x: -0.8 + i * 0.1, y: -0.8 + j * 0.1 };
    if (Math.hypot(p.x, p.y) > 0.8) continue;
    const src = barrel(p.x, p.y);                  // the source point the pass samples for the screen point p
    const d = displayedNdc(src, barrel);           // ... and the inverse finds p again
    assert.ok(Math.abs(d.x - p.x) < 1e-3 && Math.abs(d.y - p.y) < 1e-3, `${JSON.stringify(p)} -> ${JSON.stringify(src)} -> ${JSON.stringify(d)}`);
  }
});

test('displayedNdc inverts the 22 mm lens of lens.js (scale and cubic term, with the aspect ratio)', () => {
  const k = -0.302, kcube = 0.021, scale = 1.151, aspect = 1.6;
  const distort = (ndcX, ndcY) => {
    let cx = ((ndcX + 1) * 0.5 - 0.5) / scale, cy = ((ndcY + 1) * 0.5 - 0.5) / scale;
    cx *= aspect;
    const r2 = cx * cx + cy * cy, r = Math.sqrt(r2), f = 1 + k * r2 + kcube * r2 * r;
    cx *= f; cy *= f; cx /= aspect;
    return { x: (cx + 0.5) * 2 - 1, y: (cy + 0.5) * 2 - 1 };
  };
  for (const p of [{ x: -0.13, y: 0 }, { x: -0.1, y: -0.5 }, { x: 0.3, y: 0.4 }, { x: -0.7, y: 0.6 }]) {
    const d = displayedNdc(p, distort);
    const back = distort(d.x, d.y);
    assert.ok(Math.abs(back.x - p.x) < 1e-6 && Math.abs(back.y - p.y) < 1e-6);
  }
});
