// Sprint 30Sep26w Lane M (D-040 item 3, D-041): Microsoft building footprints
// fill Park Royal and West Acton only where OpenStreetMap maps no building.
// Sprint 01Oct26h Lane M (D-042 item 5, D-043): and North Acton, East Acton,
// Harlesden and Willesden Junction (tile_11_13, tile_11_14), with their own
// height pool, leaving Park Royal and West Acton byte-identical.
//
// Two halves. The geometry and parsing tests are pure. The data tests read the
// merged tile overlay (public/data/surface, gitignored): they FAIL, never skip,
// when the overlay has not been applied, because a checkout without it would
// deploy a baked payload and a credit line that do not match its tiles.
// Apply it, in a worktree, with:
//   node scripts/surface-overlay.mjs prepare && node scripts/merge-microsoft-footprints.mjs && npm run bake
// `prepare` makes this checkout's public/data/surface a local overlay first, so
// neither the merge nor the bake can write through a symlinked directory into
// the main checkout's shared store; the merge refuses to run without it
// (tests/surface-overlay.test.mjs). Or copy a finished overlay in with
// node scripts/surface-overlay.mjs apply --from <lane checkout>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  intersectionArea, footprintsOverlap, boundariesOverlap, strictlyInside, featureToRecord,
  bandMedians, heightBand, HEIGHT_BANDS_M2, neighbourFiles, TARGET_TILES, isMicrosoft,
  DEFAULT_BUILDING_HEIGHT, TILE_GROUPS, groupOf, main as mergeMain, LOCATION, QUADKEY,
} from '../scripts/merge-microsoft-footprints.mjs';
import { LANE_M_FILES } from '../scripts/surface-overlay.mjs';

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

test('target tiles: two height pools, one per sprint, disjoint; the overlay carries all four tiles', () => {
  assert.deepEqual(TILE_GROUPS.map((g) => g.tiles), [['tile_10_13.json', 'tile_10_14.json'], ['tile_11_13.json', 'tile_11_14.json']]);
  assert.deepEqual(TARGET_TILES, TILE_GROUPS.flatMap((g) => g.tiles));
  assert.equal(new Set(TARGET_TILES).size, TARGET_TILES.length, 'no tile in two pools');
  for (const f of TARGET_TILES) assert.equal(groupOf(f).tiles.includes(f), true);
  assert.equal(groupOf('tile_12_13.json'), null);
  // The 30Sep26w text is part of those tiles' bytes: it must never change.
  assert.equal(TILE_GROUPS[0].heightRule, 'Microsoft height where given (rounded to 0.1 m). Where Microsoft gives none (-1), the median Microsoft-given height of candidates in the same footprint-area band across the target tiles (heightBands); 10 m only for a band with no given heights.');
  for (const f of TARGET_TILES) assert.ok(LANE_M_FILES.includes(`tiles/${f}`), `${f} travels with the overlay`);
  for (const f of ['tiles/manifest.json', 'baked/buildings.bin', 'baked/meta.json']) assert.ok(LANE_M_FILES.includes(f));
});

/**
 * A self-contained checkout for the merge: the four target tiles (real bounds,
 * no OSM buildings), a manifest, and a cached "download" holding `features`.
 */
async function mergeFixture(features) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ug-merge-pools-'));
  const tiles = path.join(root, 'public/data/surface/tiles');
  await mkdir(tiles, { recursive: true });
  await mkdir(path.join(root, 'public/data/surface/baked'));
  const cache = path.join(root, 'scripts/.cache/microsoft-footprints');
  await mkdir(cache, { recursive: true });
  const manifest = { tiles: [], totals: { buildings: 0, totalSizeBytes: 0 } };
  for (const file of TARGET_TILES) {
    const [, c, r] = /^tile_(\d+)_(\d+)\.json$/.exec(file).map(Number);
    const bounds = { sw: [51.2792 + r * 0.018, -0.5894 + c * 0.029], ne: [51.2792 + (r + 1) * 0.018, -0.5894 + (c + 1) * 0.029] };
    const text = JSON.stringify({ bounds, buildings: [], parks: [], roads: [], greenery: [] }, null, 2);
    await writeFile(path.join(tiles, file), text);
    manifest.tiles.push({ file, bounds, counts: { buildings: 0 }, sizeBytes: text.length });
  }
  await writeFile(path.join(tiles, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(cache, 'dataset-links.csv'), `Location,QuadKey,Url,Size,UploadDate\n${LOCATION},${QUADKEY},https://example.invalid/x.csv.gz,1KB,2026-02-23\n`);
  const gz = gzipSync(features.map((x) => JSON.stringify(x)).join('\n') + '\n');
  await writeFile(path.join(cache, `${LOCATION}-${QUADKEY}.csv.gz`), gz);
  const read = async (f) => readFile(path.join(tiles, f), 'utf8');
  const sha = createHash('sha256').update(gz).digest('hex');
  return { root, read, sha, /** The tile with its download's hash (provenance) named, for comparing different downloads. */
    readNormalised: async (f) => (await read(f)).split(sha).join('<download sha256>'), summary: async () => JSON.parse(await readFile(path.join(root, 'scripts/microsoft-footprints.json'), 'utf8')),
           cleanup: () => rm(root, { recursive: true, force: true }) };
}
/** Squares of about 180 m2 (all in the 150 to 400 m2 band), 70 m apart in a row east from (lat, lon), one per height (-1: none given). */
const houses = (lat, lon, heights) => heights.map((height, i) => {
  const w = lon + i * 0.001, d = 0.00012;
  return { type: 'Feature', properties: { height, confidence: -1 },
    geometry: { type: 'Polygon', coordinates: [[[w, lat], [w + d * 1.6, lat], [w + d * 1.6, lat + d], [w, lat + d], [w, lat]]] } };
});

test('height pools: a later pool never changes an earlier pool\'s bytes; --tiles only chooses what is written', async () => {
  const parkRoyal = houses(51.520, -0.290, [4, 5, 6, -1]);      // tile_10_13: pool 30Sep26w, band median 5
  const northActon = houses(51.520, -0.260, [10, 11, 12, -1]);  // tile_11_13: pool 01Oct26h, band median 11
  const alone = await mergeFixture(parkRoyal), both = await mergeFixture([...parkRoyal, ...northActon]);
  const subset = await mergeFixture([...parkRoyal, ...northActon]);
  try {
    await mergeMain(['--root', alone.root], { mainRoot: null });
    await mergeMain(['--root', both.root], { mainRoot: null });
    const untouched = await subset.read('tile_10_13.json');
    await mergeMain(['--root', subset.root, '--tiles', 'tile_11_13.json'], { mainRoot: null });
    const heightsOf = async (fx, f) => JSON.parse(await fx.read(f)).buildings.map((b) => b.height).sort((a, b) => a - b);
    // Each pool fills its missing height from its own median (pooled together it would be 6 for both).
    assert.deepEqual(await heightsOf(both, 'tile_10_13.json'), [4, 5, 5, 6]);
    assert.deepEqual(await heightsOf(both, 'tile_11_13.json'), [10, 11, 11, 12]);
    // Adding North Acton's pool leaves Park Royal's tile byte-identical, but for
    // the provenance hash of the (here different) download file.
    assert.notEqual(both.sha, alone.sha);
    assert.equal(await both.readNormalised('tile_10_13.json'), await alone.readNormalised('tile_10_13.json'));
    // A --tiles run writes only that tile, with the bytes a full run writes, and
    // its summary still describes every tile and pool exactly as a full run's
    // (only the manifest total differs: that fixture's tile_10_13 is unmerged).
    assert.equal(await subset.read('tile_11_13.json'), await both.read('tile_11_13.json'));
    assert.equal(await subset.read('tile_10_13.json'), untouched, 'not asked for, not written');
    const [sS, sB] = [await subset.summary(), await both.summary()];
    assert.deepEqual(sS.tiles, sB.tiles);
    assert.deepEqual(sS.heightPools, sB.heightPools);
    assert.equal(sS.totals.added, sB.totals.added);
    assert.deepEqual(Object.keys((await both.summary()).tiles), TARGET_TILES);
    await assert.rejects(mergeMain(['--root', both.root, '--tiles', 'tile_12_13.json'], { mainRoot: null }), /not in TILE_GROUPS/);
  } finally { await Promise.all([alone, both, subset].map((x) => x.cleanup())); }
});

// ── Data (the merged overlay) ───────────────────────────────────────────────

const summary = JSON.parse(await readFile(path.join(ROOT, 'scripts/microsoft-footprints.json'), 'utf8'));
const readTile = async (f) => JSON.parse(await readFile(path.join(TILES, f), 'utf8'));
const overlayMissing = 'Microsoft footprint overlay not applied to public/data/surface: run node scripts/surface-overlay.mjs prepare && node scripts/merge-microsoft-footprints.mjs && npm run bake';
// Park Royal and West Acton exactly as sprint 30Sep26w wrote them (its tracked
// summary at 0d3818c / 387dff0; the bytes promoted with that sprint's overlay).
const PARK_ROYAL_WEST_ACTON_30SEP26W = {
  'tile_10_13.json': 'db3f1e1b3f7ef9b3626a3d2e556e75fbac7c2dd872f86d10ca1301c651c3b95c',
  'tile_10_14.json': 'd2cc9624fc1553016079e9b62259113b7f8d86f18928a1b8800821e071de1dbf',
};

test('Park Royal and West Acton are byte-identical to sprint 30Sep26w (their medians are not re-pooled)', async () => {
  for (const [f, hash] of Object.entries(PARK_ROYAL_WEST_ACTON_30SEP26W)) {
    assert.equal(summary.tiles[f].sha256After, hash, `${f}: the merge, run over all four tiles, still computes the 30Sep26w bytes`);
    assert.equal(createHash('sha256').update(await readFile(path.join(TILES, f))).digest('hex'), hash, `${f} on disk`);
  }
  assert.deepEqual(summary.heightPools[0].heightBands.map((b) => b.medianM), [3.6, 4.1, 5.5, 5.5, 6.1, 7.6], 'the 30Sep26w pool medians');
});

test('each tile carries its own pool\'s medians and rule, and every band-filled height is one of them', async () => {
  assert.deepEqual(summary.heightPools.map((p) => p.tiles), TILE_GROUPS.map((g) => g.tiles));
  for (const f of TARGET_TILES) {
    const tile = await readTile(f), pool = summary.heightPools.find((p) => p.tiles.includes(f));
    assert.equal(summary.tiles[f].pool, pool.pool);
    assert.deepEqual(tile.microsoft.heightBands, pool.heightBands, `${f} heightBands`);
    assert.equal(tile.microsoft.heightRule, groupOf(f).heightRule, `${f} heightRule`);
    // A Microsoft height is never negative and is rounded to 0.1 m; at least the
    // band-filled count of records sits exactly on the pool median of its band.
    const ms = tile.buildings.filter(isMicrosoft);
    const onMedian = ms.filter((b) => b.height === pool.heightBands[heightBand(b.area)].medianM).length;
    assert.ok(onMedian >= summary.tiles[f].heightFromBand, `${f}: ${onMedian} records on their band median, ${summary.tiles[f].heightFromBand} filled`);
  }
  // The new pool is its own: computed from North/East Acton and Harlesden/Willesden Junction, not copied.
  assert.notDeepEqual(summary.heightPools[1].heightBands.map((b) => b.medianM), summary.heightPools[0].heightBands.map((b) => b.medianM));
});

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
  // The target tiles only: the manifest's totals are the tile sums, and only
  // the four target tiles hold Microsoft records (raw text scan of every
  // tile, so a stray merge anywhere else fails here).
  const manifest = await readTile('manifest.json');
  assert.equal(manifest.totals.buildings, manifest.tiles.reduce((a, t) => a + t.counts.buildings, 0));
  for (const f of TARGET_TILES) assert.equal(manifest.tiles.find((t) => t.file === f).counts.buildings, summary.tiles[f].buildingsAfter);
  const stray = [];
  for (const f of (await readdir(TILES)).filter((n) => /^tile_\d+_\d+\.json$/.test(n))) {
    if (TARGET_TILES.includes(f)) continue;
    if ((await readFile(path.join(TILES, f), 'utf8')).includes('"source": "microsoft"')) stray.push(f);
  }
  assert.deepEqual(stray, [], 'Microsoft records outside the four target tiles');
  // Floors, not this run's counts: each new tile gains hundreds of buildings.
  for (const f of ['tile_11_13.json', 'tile_11_14.json']) assert.ok(summary.tiles[f].added >= 500, `${f} added ${summary.tiles[f].added}`);
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
  for (const area of ['Park Royal', 'West Acton', 'North Acton', 'East Acton', 'Harlesden', 'Willesden Junction']) {
    assert.ok(line.includes(area), `the credit line names ${area}`);
  }
});
