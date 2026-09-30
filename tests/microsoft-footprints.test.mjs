// Sprint 30Sep26w Lane M (D-040 item 3, D-041): Microsoft building footprints
// fill Park Royal and West Acton only where OpenStreetMap maps no building.
//
// Two halves. The geometry and parsing tests are pure. The data tests read the
// merged tile overlay (public/data/surface, gitignored): they FAIL, never skip,
// when the overlay has not been applied, because a checkout without it would
// deploy a baked payload and a credit line that do not match its tiles.
// Apply it with: node scripts/merge-microsoft-footprints.mjs && npm run bake
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  intersectionArea, footprintsOverlap, boundariesOverlap, strictlyInside, featureToRecord,
  bandMedians, heightBand, HEIGHT_BANDS_M2, neighbourFiles, TARGET_TILES, isMicrosoft,
  DEFAULT_BUILDING_HEIGHT,
} from '../scripts/merge-microsoft-footprints.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILES = path.join(ROOT, 'public/data/surface/tiles');
const BAKED = path.join(ROOT, 'public/data/surface/baked');
const sq = (x, z, s) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]];

// ── Pure ────────────────────────────────────────────────────────────────────

test('overlap: touching is not overlapping; any shared area is', () => {
  assert.equal(footprintsOverlap(sq(0, 0, 2), sq(2, 0, 2)), false, 'shared edge');
  assert.equal(footprintsOverlap(sq(0, 0, 2), sq(2, 2, 2)), false, 'shared corner');
  assert.equal(footprintsOverlap(sq(0, 0, 2), sq(5, 5, 2)), false, 'disjoint');
  // Collinear edges and no proper crossing: the boolean test alone misses
  // this; the exact area must catch it.
  assert.equal(boundariesOverlap(sq(0, 0, 2), sq(1, 0, 2)), false);
  assert.equal(intersectionArea(sq(0, 0, 2), sq(1, 0, 2)), 2);
  assert.equal(footprintsOverlap(sq(0, 0, 2), sq(1, 0, 2)), true, 'half overlap');
  assert.equal(footprintsOverlap(sq(0, 0, 2), sq(0, 0, 2)), true, 'identical');
  assert.equal(intersectionArea(sq(0, 0, 10), sq(2, 2, 2)), 4, 'contained');
  assert.equal(footprintsOverlap(sq(2, 2, 2), sq(0, 0, 10)), true, 'containing');
  // Concave L: a square in its notch touches nothing; one on its arm overlaps.
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]];
  assert.equal(intersectionArea(L, sq(2, 2, 2)), 0);
  assert.equal(footprintsOverlap(L, sq(2, 2, 2)), false);
  assert.equal(intersectionArea(L, sq(0.5, 2, 1)), 0.5);
  assert.equal(intersectionArea(sq(0.5, 2, 1), L), 0.5, 'symmetric');
  assert.equal(intersectionArea(L, L), 7);
  assert.equal(intersectionArea([...L].reverse(), sq(-1, -1, 2)), 1, 'winding-independent');
  // A sliver still counts: the rule is strict.
  assert.equal(footprintsOverlap(sq(0, 0, 10), [[9.9, 0], [20, 0], [20, 10], [9.9, 10], [9.9, 0]]), true);
  assert.equal(strictlyInside(1, 0, sq(0, 0, 2)), false, 'on boundary is outside');
  assert.equal(strictlyInside(1, 1, sq(0, 0, 2)), true);
});

test('parse: projection, rounding, 20 m2 floor, Microsoft height or none', () => {
  const d = 0.00027;
  const ring = (lat, lon, s) => [[lon, lat], [lon + s, lat], [lon + s, lat + s * 0.62], [lon, lat + s * 0.62], [lon, lat]];
  const house = featureToRecord({ type: 'Feature', properties: { height: 7.26, confidence: -1 },
    geometry: { type: 'Polygon', coordinates: [ring(51.5074, -0.1278, d)] } });
  assert.ok(Math.abs(house.cx) < 30 && Math.abs(house.cz) < 30, 'Trafalgar origin');
  assert.equal(house.height, 7.3);
  assert.equal(house._heightGiven, true);
  assert.equal(house.source, 'microsoft');
  assert.ok(house.area > 300 && house.area < 500, `area ${house.area}`);
  assert.deepEqual(house.footprint[0], house.footprint.at(-1));
  assert.ok(house.footprint.flat().every(Number.isInteger), 'integer metres, as the OSM tiles');
  const noHeight = featureToRecord({ type: 'Feature', properties: { height: -1, confidence: -1 },
    geometry: { type: 'Polygon', coordinates: [ring(51.5074, -0.1278, d)] } });
  assert.equal(noHeight._heightGiven, false);
  assert.equal(featureToRecord({ type: 'Feature', properties: { height: 3 },
    geometry: { type: 'Polygon', coordinates: [ring(51.508, -0.128, 0.00002)] } }), null, 'under 20 m2');
});

test('missing heights: median of given heights in the same size band', () => {
  assert.equal(heightBand(20), 0); assert.equal(heightBand(39.9), 0); assert.equal(heightBand(40), 1);
  assert.equal(heightBand(5000), HEIGHT_BANDS_M2.length - 1);
  const r = (area, height, given = true) => ({ area, height, _heightGiven: given });
  const m = bandMedians([r(25, 3), r(30, 4), r(35, 9), r(36, 99, false), r(100, 5), r(120, 6)]);
  assert.equal(m[0], 4, 'odd count: middle value; not-given heights ignored');
  assert.equal(m[2], 5, 'even count: lower median, a real observation');
  assert.equal(m[1], DEFAULT_BUILDING_HEIGHT, 'empty band falls back to 10 m');
});

test('neighbourhood for the overlap test is the 3x3 block', () => {
  const n = neighbourFiles('tile_10_13.json');
  assert.equal(n.length, 9);
  for (const f of ['tile_09_12.json', 'tile_11_14.json', 'tile_10_13.json']) assert.ok(n.includes(f));
});

// ── Data (the merged overlay) ───────────────────────────────────────────────

const summary = JSON.parse(await readFile(path.join(ROOT, 'scripts/microsoft-footprints.json'), 'utf8'));
const readTile = async (f) => JSON.parse(await readFile(path.join(TILES, f), 'utf8'));
const overlayMissing = 'Microsoft footprint overlay not applied to public/data/surface: run node scripts/merge-microsoft-footprints.mjs && npm run bake';

test('counts per tile match the tracked summary, byte for byte', async () => {
  assert.deepEqual(Object.keys(summary.tiles), TARGET_TILES);
  for (const f of TARGET_TILES) {
    const text = await readFile(path.join(TILES, f), 'utf8');
    const tile = JSON.parse(text), s = summary.tiles[f];
    const ms = tile.buildings.filter(isMicrosoft);
    assert.ok(ms.length > 0, overlayMissing);
    assert.equal(ms.length, s.added, `${f} added`);
    assert.equal(tile.buildings.length - ms.length, s.osmBuildings, `${f} OSM records unchanged`);
    assert.equal(tile.microsoft.added, s.added);
    assert.equal(tile.microsoft.candidates, s.candidates);
    assert.equal(s.belowFloor + s.overlapOsm + s.added, s.candidates, `${f} every candidate accounted for`);
    assert.equal(s.heightGiven + s.heightFromBand, s.added);
    assert.equal(createHash('sha256').update(text).digest('hex'), s.sha256After, `${f} bytes`);
    // OSM records come first and are untouched: re-serialising the OSM-only
    // tile reproduces the original file's recorded hash.
    const osmOnly = { ...tile, buildings: tile.buildings.filter((b) => !isMicrosoft(b)) };
    delete osmOnly.microsoft;
    assert.equal(createHash('sha256').update(JSON.stringify(osmOnly, null, 2)).digest('hex'), s.sha256Before, `${f} OSM part unchanged`);
    // Same schema as the OSM records the renderer and the bake read.
    for (const b of ms) {
      assert.ok(Number.isInteger(b.cx) && Number.isInteger(b.cz) && Number.isInteger(b.area) && b.area >= 20);
      assert.ok(Number.isFinite(b.height) && b.height > 0);
      assert.ok(b.footprint.length >= 4 && b.footprint.flat().every(Number.isInteger));
    }
  }
  // Park Royal and West Acton only: the manifest's totals are the tile sums,
  // and only the two target tiles hold Microsoft records (raw text scan of
  // every tile, so a stray merge anywhere else fails here).
  const manifest = await readTile('manifest.json');
  assert.equal(manifest.totals.buildings, manifest.tiles.reduce((a, t) => a + t.counts.buildings, 0));
  for (const f of TARGET_TILES) assert.equal(manifest.tiles.find((t) => t.file === f).counts.buildings, summary.tiles[f].buildingsAfter);
  const stray = [];
  for (const f of (await readdir(TILES)).filter((n) => /^tile_\d+_\d+\.json$/.test(n))) {
    if (TARGET_TILES.includes(f)) continue;
    if ((await readFile(path.join(TILES, f), 'utf8')).includes('"source": "microsoft"')) stray.push(f);
  }
  assert.deepEqual(stray, [], 'Microsoft records outside Park Royal and West Acton');
});

test('no added footprint overlaps an OpenStreetMap building (exact, and an independent point sample)', async () => {
  for (const f of TARGET_TILES) {
    const tile = await readTile(f);
    const added = tile.buildings.filter(isMicrosoft);
    assert.ok(added.length > 0, overlayMissing);
    const osm = [];
    for (const n of neighbourFiles(f)) {
      try { osm.push(...(await readTile(n)).buildings.filter((b) => !isMicrosoft(b))); } catch { /* edge of grid */ }
    }
    const box = (r) => r.reduce((a, [x, z]) => ({ minX: Math.min(a.minX, x), maxX: Math.max(a.maxX, x), minZ: Math.min(a.minZ, z), maxZ: Math.max(a.maxZ, z) }),
      { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const osmBoxed = osm.filter((b) => b.footprint?.length >= 3).map((b) => ({ b, bb: box(b.footprint) }));
    let exactHits = 0, sampleHits = 0, pairs = 0;
    for (const a of added) {
      const ab = box(a.footprint);
      for (const { b, bb } of osmBoxed) {
        if (bb.maxX < ab.minX || bb.minX > ab.maxX || bb.maxZ < ab.minZ || bb.minZ > ab.maxZ) continue;
        pairs++;
        if (footprintsOverlap(a.footprint, b.footprint)) exactHits++;
        // Independent check: a 0.25 m lattice (offset off the integer grid, so
        // no sample lands on a shared integer edge) strictly inside both.
        const x0 = Math.max(ab.minX, bb.minX), x1 = Math.min(ab.maxX, bb.maxX);
        const z0 = Math.max(ab.minZ, bb.minZ), z1 = Math.min(ab.maxZ, bb.maxZ);
        let hit = false;
        for (let x = Math.floor(x0) + 0.125; x < x1 && !hit; x += 0.25)
          for (let z = Math.floor(z0) + 0.125; z < z1 && !hit; z += 0.25)
            if (strictlyInside(x, z, a.footprint) && strictlyInside(x, z, b.footprint)) hit = true;
        if (hit) sampleHits++;
      }
    }
    assert.equal(exactHits, 0, `${f}: added footprints overlapping OSM (exact test)`);
    assert.equal(sampleHits, 0, `${f}: added footprints overlapping OSM (point sample)`);
    // Not vacuous: thousands of OSM neighbours loaded, and dozens of added
    // footprints whose boxes do meet an OSM box (98 and 177 on 30Sep26w).
    assert.ok(osm.length > 5000 && pairs >= 50, `${f}: the check compared real neighbours (${osm.length} OSM, ${pairs} pairs)`);
  }
});

test('the baked payload is this tile set and carries every added building within quantisation', async () => {
  const meta = JSON.parse(await readFile(path.join(BAKED, 'meta.json'), 'utf8'));
  const buf = await readFile(path.join(BAKED, 'buildings.bin'));
  assert.equal(createHash('sha256').update(buf).digest('hex'), meta.payloadSha256, 'payload hash');
  const manifest = await readTile('manifest.json');
  assert.equal(meta.stats.read, manifest.totals.buildings, overlayMissing + ' (payload baked from a different tile set)');
  assert.equal(buf.readUInt32LE(0), 0x31424755);
  const tileCount = buf.readUInt16LE(6), total = buf.readUInt32LE(8);
  assert.equal(total, meta.buildings);
  assert.equal(buf.length, 12 + tileCount * 16 + total * 10);
  const decoded = new Map();
  for (let i = 0; i < tileCount; i++) {
    const d = 12 + i * 16, minX = buf.readInt32LE(d), minZ = buf.readInt32LE(d + 4);
    let off = buf.readUInt32LE(d + 8); const count = buf.readUInt32LE(d + 12);
    for (let j = 0; j < count; j++, off += 10) {
      const cx = minX + buf.readUInt16LE(off) / 10, cz = minZ + buf.readUInt16LE(off + 2) / 10;
      const k = `${Math.round(cx)},${Math.round(cz)}`;
      (decoded.get(k) || decoded.set(k, []).get(k)).push({ cx, cz, hM: buf.readUInt16LE(off + 4) / 10, sideM: buf.readUInt16LE(off + 6) / 10, baseM: buf.readInt16LE(off + 8) / 10 });
    }
  }
  // Terrain through the bake's own Node shim, as scripts/verify-bake.mjs does.
  const { installNodeEnv } = await import('../scripts/bake-node-env.mjs');
  installNodeEnv();
  const terrain = await import('../src/terrain.js');
  const { initThamesMask } = await import('../src/thames-mask.js');
  const { loadM25Data, initM25Boundary } = await import('../src/m25.js');
  initThamesMask(JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8')).points);
  const m25 = await loadM25Data(); initM25Boundary(m25.supportPoints || m25.points);
  await terrain.tryCreateTerrainMesh({ thamesData: JSON.parse(await readFile(path.join(ROOT, 'public/data/thames.json'), 'utf8')) });
  const VE = terrain.VERTICAL_EXAGGERATION, BOUND = 0.05 + 1e-9;
  // The bake's dedup rule, replayed over every tile in the bake's order, names
  // the added records that legitimately lose to an earlier identical hash.
  const key = (b) => `${b.cx},${b.cz},${b.height},${b.area}`;
  const placed = new Set(), losers = new Set();
  for (const f of manifest.tiles.map((t) => t.file).sort()) {
    const near = TARGET_TILES.some((t) => neighbourFiles(t).includes(f));
    if (!near && f > TARGET_TILES.at(-1)) break;
    if (!near) continue;
    for (const b of (await readTile(f)).buildings) {
      const h = `${Math.round(b.cx / 5) * 5},${Math.round(b.cz / 5) * 5},${Math.round(b.height)}`;
      if (placed.has(h)) { if (isMicrosoft(b)) losers.add(key(b)); continue; }
      placed.add(h);
    }
  }
  let found = 0, worst = { base: 0, h: 0, side: 0 };
  const missing = [];
  for (const f of TARGET_TILES) {
    for (const b of (await readTile(f)).buildings.filter(isMicrosoft)) {
      if (losers.has(key(b))) continue;
      const got = (decoded.get(`${Math.round(b.cx)},${Math.round(b.cz)}`) || [])
        .find((r) => Math.abs(r.hM - b.height) <= BOUND && Math.abs(r.sideM - Math.sqrt(b.area)) <= BOUND);
      if (!got) { missing.push(b); continue; }
      found++;
      worst.base = Math.max(worst.base, Math.abs(got.baseM - terrain.getStructuralSurfaceY({ x: b.cx, z: b.cz }) / VE));
      worst.h = Math.max(worst.h, Math.abs(got.hM - b.height));
      worst.side = Math.max(worst.side, Math.abs(got.sideM - Math.sqrt(b.area)));
    }
  }
  const added = TARGET_TILES.reduce((a, f) => a + summary.tiles[f].added, 0);
  assert.equal(missing.length, 0, `added buildings absent from the payload: ${JSON.stringify(missing.slice(0, 3).map(({ cx, cz, height, area }) => ({ cx, cz, height, area })))}`);
  assert.equal(found + losers.size, added);
  assert.ok(losers.size <= 5, `dedup losers ${losers.size}`);
  assert.ok(worst.base <= BOUND && worst.h <= BOUND && worst.side <= BOUND, JSON.stringify(worst));
});

test('the Data credits name Microsoft Building Footprints under the ODbL', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const credits = html.slice(html.indexOf('<summary>Data credits</summary>'), html.indexOf('</details>', html.indexOf('<summary>Data credits</summary>')));
  assert.ok(credits.length > 0, 'Data credits block');
  const line = credits.split('\n').find((l) => l.includes('creditMicrosoftFootprints'));
  assert.ok(line, 'Microsoft credit line inside Data credits');
  assert.match(line, /Microsoft Building Footprints/);
  assert.match(line, /https:\/\/github\.com\/microsoft\/GlobalMLBuildingFootprints/);
  assert.match(line, /ODbL/);
  assert.match(line, /opendatacommons\.org\/licenses\/odbl/);
  assert.match(line, /Park Royal and West Acton/);
});
