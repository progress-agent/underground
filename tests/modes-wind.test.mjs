// Shared world wind (src/wind.js): determinism, layering, westerly surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as wind from '../src/wind.js';
import { getWindAt, getSurfaceWind } from '../src/wind.js';

const DEG = 180 / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

test('exports exactly getWindAt and getSurfaceWind', () => {
  assert.deepEqual(Object.keys(wind).sort(), ['getSurfaceWind', 'getWindAt']);
});

test('deterministic in (altitude, time): identical inputs give identical outputs', () => {
  for (const alt of [0, 120, 700, 1800, 4000]) {
    for (const t of [0, 1.5, 600, 12345.678]) {
      assert.deepEqual(getWindAt(alt, t), getWindAt(alt, t));
    }
  }
  assert.deepEqual(getSurfaceWind(42), getSurfaceWind(42));
});

test('shape: dirRad in [0, 2π), speed positive and representative (3 to 20 m/s)', () => {
  for (let t = 0; t < 7200; t += 97) {
    for (const alt of [0, 200, 800, 1600, 3000, 8000]) {
      const w = getWindAt(alt, t);
      assert.ok(w.dirRad >= 0 && w.dirRad < 2 * Math.PI, `dir ${w.dirRad}`);
      assert.ok(w.speedMps > 3 && w.speedMps < 20, `speed ${w.speedMps} at ${alt}m t=${t}`);
    }
  }
});

test('surface wind is westerly (from 270°) and never veers past ±15°', () => {
  for (let t = 0; t < 4 * 3600; t += 31) {
    const w = getSurfaceWind(t);
    assert.ok(angDiff(w.dirRad, 1.5 * Math.PI) * DEG <= 15, `t=${t} dir=${w.dirRad * DEG}`);
  }
  assert.ok(angDiff(getSurfaceWind(0).dirRad, 1.5 * Math.PI) * DEG < 1, 'westerly at t=0');
});

test('layers by altitude have their own directions (altitude is steering)', () => {
  const dirs = [100, 700, 1700, 3500].map(a => getWindAt(a, 0).dirRad);
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      assert.ok(angDiff(dirs[i], dirs[j]) * DEG > 15, `layers ${i},${j} too similar`);
    }
  }
});

test('veers slowly: under half a degree per second in every layer', () => {
  for (const alt of [100, 700, 1700, 3500]) {
    for (let t = 0; t < 3600; t += 53) {
      const d = angDiff(getWindAt(alt, t).dirRad, getWindAt(alt, t + 1).dirRad) * DEG;
      assert.ok(d < 0.5, `alt ${alt} t ${t}: ${d}°/s`);
    }
  }
});

test('continuous across layer boundaries (no step when climbing 1m)', () => {
  const vec = (w) => [-Math.sin(w.dirRad) * w.speedMps, Math.cos(w.dirRad) * w.speedMps];
  for (let alt = 0; alt < 3000; alt += 1) {
    const [ax, az] = vec(getWindAt(alt, 900));
    const [bx, bz] = vec(getWindAt(alt + 1, 900));
    assert.ok(Math.hypot(ax - bx, az - bz) < 0.5, `jump at ${alt}m`);
  }
});

test('garbage inputs do not produce NaN', () => {
  for (const w of [getWindAt(NaN, NaN), getWindAt(-50, 10), getSurfaceWind(undefined)]) {
    assert.ok(Number.isFinite(w.dirRad) && Number.isFinite(w.speedMps));
  }
});
