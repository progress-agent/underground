#!/usr/bin/env node
/**
 * fetch-surface-tiles.mjs — Fetch OSM surface data for M25 area as 2km tiles
 *
 * v2: Uses proj4 WGS84→OSGB36 (British National Grid) projection for accurate
 * coordinate alignment with terrain and tube lines. Replaces equirectangular
 * approximation which had 177–449m errors at M25 edges.
 *
 * Usage:
 *   node scripts/fetch-surface-tiles.mjs          # full fetch (775 tiles)
 *   node scripts/fetch-surface-tiles.mjs --test    # 3 test tiles only
 *
 * Requires: Node 18+ (native fetch), proj4 (npm install proj4)
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import proj4 from 'proj4';

// ---------------------------------------------------------------------------
// Crash resilience
// ---------------------------------------------------------------------------

const OUTPUT_DIR = resolve(
  process.env.HOME,
  '.openclaw/workspace/projects/underground/data/surface/tiles'
);
const DONE_PATH = resolve(OUTPUT_DIR, 'DONE');

process.on('uncaughtException', (err) => {
  const msg = `FATAL uncaughtException: ${err.stack || err.message}`;
  console.error(msg);
  try {
    writeFileSync(DONE_PATH, JSON.stringify({
      completedAt: new Date().toISOString(), error: msg, status: 'CRASH'
    }, null, 2));
  } catch (_) {}
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const msg = `FATAL unhandledRejection: ${reason?.stack || reason}`;
  console.error(msg);
  try {
    writeFileSync(DONE_PATH, JSON.stringify({
      completedAt: new Date().toISOString(), error: msg, status: 'CRASH'
    }, null, 2));
  } catch (_) {}
  process.exit(1);
});

mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Projection setup — OSGB36 / British National Grid
// ---------------------------------------------------------------------------

proj4.defs('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
  '+x_0=400000 +y_0=-100000 +ellps=airy ' +
  '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 ' +
  '+units=m +no_defs'
);

// Scene origin in BNG (Trafalgar Square) — derived from proj4 so it's
// always consistent with the Helmert transform, not independently looked-up.
const [BNG_REF_E, BNG_REF_N] = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);

// M25 bounding box in WGS84
const M25_BOUNDS = {
  sw: { lat: 51.2792, lon: -0.5894 },
  ne: { lat: 51.7284, lon: 0.2843 }
};

// Tile size in degrees (≈2km)
const TILE_SIZE_LAT = 0.018;
const TILE_SIZE_LON = 0.029;

// Rate limiting
const DELAY_MS = 2000;
const MAX_RETRIES = 5;

// Building/park thresholds
const DEFAULT_BUILDING_HEIGHT = 10;
const METRES_PER_LEVEL = 3.2;
const MIN_BUILDING_AREA = 20;   // m²
const MIN_PARK_AREA = 500;      // m²
const DEFAULT_ROAD_WIDTH = 14;  // metres

// ---------------------------------------------------------------------------
// Coordinate conversion (proj4 — matches terrain & tube rendering)
// ---------------------------------------------------------------------------

function llToScene(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  const x = e - BNG_REF_E;
  const z = -(n - BNG_REF_N);
  return [Math.round(x), Math.round(z)];
}

// ---------------------------------------------------------------------------
// Tile grid
// ---------------------------------------------------------------------------

function getTileBounds(col, row) {
  const west = M25_BOUNDS.sw.lon + (col * TILE_SIZE_LON);
  const south = M25_BOUNDS.sw.lat + (row * TILE_SIZE_LAT);
  const east = west + TILE_SIZE_LON;
  const north = south + TILE_SIZE_LAT;
  return { west, south, east, north };
}

function tileBBoxScene(bounds) {
  const sw = llToScene(bounds.south, bounds.west);
  const ne = llToScene(bounds.north, bounds.east);
  return {
    minX: Math.min(sw[0], ne[0]),
    maxX: Math.max(sw[0], ne[0]),
    minZ: Math.min(sw[1], ne[1]),
    maxZ: Math.max(sw[1], ne[1])
  };
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status >= 500) {
      if (attempt > MAX_RETRIES) throw new Error(`Max retries exceeded`);
      const backoff = Math.min(10000 * Math.pow(2, attempt - 1), 120000);
      console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms (status ${response.status})`);
      await sleep(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }
    return response;
  } catch (error) {
    if (attempt > MAX_RETRIES) throw error;
    const backoff = Math.min(10000 * Math.pow(2, attempt - 1), 120000);
    console.log(`  Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms (${error.message})`);
    await sleep(backoff);
    return fetchWithRetry(url, options, attempt + 1);
  }
}

// ---------------------------------------------------------------------------
// Overpass query + OSM parsing
// ---------------------------------------------------------------------------

function buildOverpassQuery(west, south, east, north) {
  return `[out:json][timeout:180];
(
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["landuse"="grass"](${south},${west},${north},${east});
  relation["leisure"="park"](${south},${west},${north},${east});
  way["highway"="primary"](${south},${west},${north},${east});
  way["highway"="trunk"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;
}

function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1];
    area -= points[i + 1][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(points) {
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cross = points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    cx += (points[i][0] + points[i + 1][0]) * cross;
    cy += (points[i][1] + points[i + 1][1]) * cross;
    area += cross;
  }
  area = area / 2;
  if (Math.abs(area) < 0.001) {
    const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [Math.round(sum[0] / points.length), Math.round(sum[1] / points.length)];
  }
  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return [Math.round(cx), Math.round(cy)];
}

function parseOsmData(osmData) {
  const nodes = new Map();
  const buildings = [];
  const parks = [];
  const roads = [];

  for (const element of (osmData.elements || [])) {
    if (element.type === 'node') {
      nodes.set(element.id, [element.lat, element.lon]);
    }
  }

  function getNodeCoords(nodeId) {
    const node = nodes.get(nodeId);
    if (!node) return null;
    return llToScene(node[0], node[1]);
  }

  function resolveWayNodes(nodeIds) {
    return nodeIds.map(id => getNodeCoords(id)).filter(c => c !== null);
  }

  for (const element of (osmData.elements || [])) {
    if (element.type === 'way' || element.type === 'relation') {
      const tags = element.tags || {};

      if (tags.building) {
        let nodeIds = [];
        if (element.type === 'way') {
          nodeIds = element.nodes || [];
        } else if (element.members) {
          for (const member of element.members) {
            if (member.type === 'way' && member.role === 'outer') {
              const way = osmData.elements.find(e => e.type === 'way' && e.id === member.ref);
              if (way?.nodes) nodeIds.push(...way.nodes);
            }
          }
        }

        const footprint = resolveWayNodes(nodeIds);
        if (footprint.length >= 3) {
          if (footprint[0][0] !== footprint[footprint.length - 1][0] ||
              footprint[0][1] !== footprint[footprint.length - 1][1]) {
            footprint.push([...footprint[0]]);
          }

          const area = shoelaceArea(footprint);
          if (area >= MIN_BUILDING_AREA) {
            const [cx, cz] = polygonCentroid(footprint);
            let height = DEFAULT_BUILDING_HEIGHT;
            if (tags.height) {
              const h = parseFloat(tags.height);
              if (!isNaN(h)) height = h;
            } else if (tags['building:levels']) {
              const levels = parseInt(tags['building:levels']);
              if (!isNaN(levels)) height = levels * METRES_PER_LEVEL;
            }

            buildings.push({
              cx, cz,
              height: Math.round(height * 10) / 10,
              area: Math.round(area),
              footprint: footprint.map(p => [Math.round(p[0]), Math.round(p[1])])
            });
          }
        }
      }

      if (tags.leisure === 'park' || tags.landuse === 'grass') {
        let nodeIds = [];
        if (element.type === 'way') {
          nodeIds = element.nodes || [];
        } else if (element.members) {
          for (const member of element.members) {
            if (member.type === 'way' && member.role === 'outer') {
              const way = osmData.elements.find(e => e.type === 'way' && e.id === member.ref);
              if (way?.nodes) nodeIds.push(...way.nodes);
            }
          }
        }

        const polygon = resolveWayNodes(nodeIds);
        if (polygon.length >= 3) {
          if (polygon[0][0] !== polygon[polygon.length - 1][0] ||
              polygon[0][1] !== polygon[polygon.length - 1][1]) {
            polygon.push([...polygon[0]]);
          }

          const area = shoelaceArea(polygon);
          if (area >= MIN_PARK_AREA) {
            parks.push({
              polygon: polygon.map(p => [Math.round(p[0]), Math.round(p[1])]),
              name: tags.name || ''
            });
          }
        }
      }

      if (tags.highway === 'primary' || tags.highway === 'trunk') {
        const nodeIds = element.nodes || [];
        const points = resolveWayNodes(nodeIds);
        if (points.length >= 2) {
          roads.push({
            points: points.map(p => [Math.round(p[0]), Math.round(p[1])]),
            width: DEFAULT_ROAD_WIDTH,
            name: tags.name || ''
          });
        }
      }
    }
  }

  return { buildings, parks, roads };
}

// ---------------------------------------------------------------------------
// Tile fetch
// ---------------------------------------------------------------------------

async function fetchTile(col, row) {
  const filename = `tile_${col.toString().padStart(2, '0')}_${row.toString().padStart(2, '0')}.json`;
  const filepath = resolve(OUTPUT_DIR, filename);

  if (existsSync(filepath)) {
    const existing = JSON.parse(readFileSync(filepath, 'utf8'));
    if (existing.buildings?.length > 0 || existing.parks?.length > 0 || existing.roads?.length > 0) {
      console.log(`  Skipping ${filename} (exists)`);
      return {
        filename, col, row, skipped: true,
        counts: {
          buildings: existing.buildings?.length || 0,
          parks: existing.parks?.length || 0,
          roads: existing.roads?.length || 0
        }
      };
    }
  }

  const bounds = getTileBounds(col, row);
  const query = buildOverpassQuery(bounds.west, bounds.south, bounds.east, bounds.north);

  console.log(`  Fetching ${filename}...`);

  const response = await fetchWithRetry('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!response.ok) throw new Error(`Overpass error: ${response.status}`);

  const osmData = await response.json();
  const parsed = parseOsmData(osmData);
  const sceneBBox = tileBBoxScene(bounds);

  const tileData = {
    bounds: {
      sw: [bounds.south, bounds.west],
      ne: [bounds.north, bounds.east],
      sceneBBox
    },
    buildings: parsed.buildings,
    parks: parsed.parks,
    roads: parsed.roads
  };

  writeFileSync(filepath, JSON.stringify(tileData, null, 2));

  return {
    filename, col, row, skipped: false,
    counts: {
      buildings: parsed.buildings.length,
      parks: parsed.parks.length,
      roads: parsed.roads.length
    }
  };
}

// ---------------------------------------------------------------------------
// Test mode — 3 landmark tiles
// ---------------------------------------------------------------------------

function getTestTiles() {
  return [
    { col: 17, row: 12, reason: 'The Shard (~51.504, -0.086)' },
    { col: 1,  row: 12, reason: 'Western M25 edge (~51.50, -0.55)' },
    { col: 15, row: 12, reason: 'Buckingham Palace (~51.501, -0.141)' }
  ];
}

async function runTestMode() {
  console.log('=== TEST MODE (proj4 BNG) ===\n');

  // Verify proj4 is working by spot-checking a known coordinate
  const trafalgar = llToScene(51.5074, -0.1278);
  console.log(`proj4 sanity check — Trafalgar Square: [${trafalgar}] (expect ~[0, 0])`);
  if (Math.abs(trafalgar[0]) > 5 || Math.abs(trafalgar[1]) > 5) {
    console.error('FAIL: proj4 projection not centred on Trafalgar Square');
    return false;
  }
  console.log('proj4 OK\n');

  const testTiles = getTestTiles();
  const results = [];

  for (const tile of testTiles) {
    console.log(`Tile ${tile.col},${tile.row}: ${tile.reason}`);
    try {
      const result = await fetchTile(tile.col, tile.row);
      results.push({ ...result, ...tile });

      const filepath = resolve(OUTPUT_DIR, result.filename);
      const data = JSON.parse(readFileSync(filepath, 'utf8'));
      console.log(`  Buildings: ${data.buildings.length}, Parks: ${data.parks.length}, Roads: ${data.roads.length}`);

      // Landmark spot-checks with proj4-corrected expected coords
      if (tile.reason.includes('Shard')) {
        // The Shard: 51.5045, -0.0865 → BNG ~532600, 179950 → scene ~[2600, 450]
        const shard = data.buildings.find(b =>
          Math.abs(b.cx - 2600) < 300 && Math.abs(b.cz - 450) < 300 && b.area > 2000
        );
        console.log(`  Landmark check (Shard): ${shard ? `FOUND at [${shard.cx}, ${shard.cz}]` : 'NOT FOUND (will verify at wider radius)'}`);
        if (!shard) {
          // Wider search — just find the biggest building in the tile
          const biggest = data.buildings.reduce((a, b) => b.area > a.area ? b : a, { area: 0 });
          console.log(`  Biggest building: [${biggest.cx}, ${biggest.cz}] area=${biggest.area}`);
        }
      }
      if (tile.reason.includes('Buckingham')) {
        const bp = data.buildings.find(b =>
          Math.abs(b.cx - (-960)) < 300 && Math.abs(b.cz - 680) < 300 && b.area > 2000
        );
        console.log(`  Landmark check (Buckingham): ${bp ? `FOUND at [${bp.cx}, ${bp.cz}]` : 'NOT FOUND (will verify at wider radius)'}`);
        if (!bp) {
          const biggest = data.buildings.reduce((a, b) => b.area > a.area ? b : a, { area: 0 });
          console.log(`  Biggest building: [${biggest.cx}, ${biggest.cz}] area=${biggest.area}`);
        }
      }

      const bbox = data.bounds.sceneBBox;
      console.log(`  SceneBBox: X=[${bbox.minX}, ${bbox.maxX}], Z=[${bbox.minZ}, ${bbox.maxZ}]`);

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      results.push({ ...tile, error: error.message });
    }
    await sleep(DELAY_MS);
  }

  console.log('\n=== TEST RESULTS ===');
  let passed = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`FAIL: tile_${r.col}_${r.row} — ${r.error}`);
    } else if (r.counts.buildings === 0 && r.counts.parks === 0 && r.counts.roads === 0) {
      console.log(`FAIL: tile_${r.col}_${r.row} — Empty tile`);
    } else {
      console.log(`PASS: tile_${r.col}_${r.row} — ${r.counts.buildings} buildings`);
      passed++;
    }
  }

  const overall = passed === testTiles.length ? 'PASS' : 'FAIL';
  console.log(`\nOverall: ${overall} (${passed}/${testTiles.length})`);
  return overall === 'PASS';
}

// ---------------------------------------------------------------------------
// Full fetch
// ---------------------------------------------------------------------------

async function runFullFetch() {
  const cols = Math.ceil((M25_BOUNDS.ne.lon - M25_BOUNDS.sw.lon) / TILE_SIZE_LON);
  const rows = Math.ceil((M25_BOUNDS.ne.lat - M25_BOUNDS.sw.lat) / TILE_SIZE_LAT);

  console.log(`=== FULL FETCH (proj4 BNG) ===`);
  console.log(`Grid: ${cols} cols x ${rows} rows = ${cols * rows} tiles`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  // Sanity check proj4
  const trafalgar = llToScene(51.5074, -0.1278);
  console.log(`proj4 check — Trafalgar Square: [${trafalgar}] (expect ~[0, 0])`);

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) tiles.push({ col, row });
  }

  let completed = 0, skipped = 0;
  let totalBuildings = 0, totalParks = 0, totalRoads = 0;
  const tileManifest = [];
  const startTime = Date.now();

  for (let i = 0; i < tiles.length; i++) {
    const { col, row } = tiles[i];

    try {
      const result = await fetchTile(col, row);
      completed++;
      if (result.skipped) {
        skipped++;
      } else {
        totalBuildings += result.counts.buildings;
        totalParks += result.counts.parks;
        totalRoads += result.counts.roads;
      }

      const filepath = resolve(OUTPUT_DIR, result.filename);
      const stats = existsSync(filepath) ? readFileSync(filepath, 'utf8').length : 0;
      const bounds = getTileBounds(col, row);
      const sceneBBox = tileBBoxScene(bounds);

      tileManifest.push({
        file: result.filename, col, row,
        bounds: { sw: [bounds.south, bounds.west], ne: [bounds.north, bounds.east] },
        sceneBBox,
        counts: result.counts,
        sizeBytes: stats
      });

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / (elapsed / 60);
      const remaining = (tiles.length - i - 1) / rate;

      console.log(
        `[${i + 1}/${tiles.length}] ${result.filename}: ` +
        `b=${result.counts.buildings} p=${result.counts.parks} r=${result.counts.roads} | ` +
        `Total: ${totalBuildings} buildings | ~${Math.round(remaining)} min remaining`
      );

    } catch (error) {
      console.error(`[${i + 1}/${tiles.length}] tile_${col}_${row} FAILED: ${error.message}`);
    }

    if (i < tiles.length - 1) await sleep(DELAY_MS);
  }

  const manifest = {
    projection: 'OSGB36-BNG-proj4',
    sceneOrigin: { bngEasting: BNG_REF_E, bngNorthing: BNG_REF_N, name: 'Trafalgar Square' },
    gridOrigin: { lat: M25_BOUNDS.sw.lat, lon: M25_BOUNDS.sw.lon },
    tileSize: { lat: TILE_SIZE_LAT, lon: TILE_SIZE_LON },
    cols, rows,
    generated: new Date().toISOString(),
    tiles: tileManifest,
    totals: {
      buildings: totalBuildings,
      parks: totalParks,
      roads: totalRoads,
      tiles: completed,
      totalSizeBytes: tileManifest.reduce((s, t) => s + t.sizeBytes, 0)
    }
  };

  writeFileSync(resolve(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written`);

  return manifest;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function runValidation(manifest) {
  console.log('\n=== VALIDATION PASS ===');
  const report = {
    generated: new Date().toISOString(),
    projection: 'OSGB36-BNG-proj4',
    landmarks: {},
    statistics: {},
    geometry: {},
    boundary_dedup: {},
    overall: 'PASS'
  };

  // 1. Landmark spot checks (coords updated for proj4 BNG)
  console.log('\n1. Landmark Spot Checks');

  // Compute expected coords dynamically via proj4
  const shardExpected = llToScene(51.5045, -0.0865);
  const buckinghamExpected = llToScene(51.5014, -0.1419);
  const wembleyExpected = llToScene(51.5560, -0.2795);

  const landmarks = {
    the_shard:          { expected: shardExpected,     tileCol: 17, tileRow: 12 },
    buckingham_palace:  { expected: buckinghamExpected, tileCol: 15, tileRow: 12 },
    wembley_stadium:    { expected: wembleyExpected,    tileCol: 11, tileRow: 15 }
  };

  for (const [name, data] of Object.entries(landmarks)) {
    const tileFile = resolve(OUTPUT_DIR,
      `tile_${data.tileCol.toString().padStart(2, '0')}_${data.tileRow.toString().padStart(2, '0')}.json`
    );
    if (existsSync(tileFile)) {
      const tileData = JSON.parse(readFileSync(tileFile, 'utf8'));
      const found = tileData.buildings.find(b =>
        Math.abs(b.cx - data.expected[0]) < 300 &&
        Math.abs(b.cz - data.expected[1]) < 300 &&
        b.area > 2000
      );
      if (found) {
        const dist = Math.sqrt(
          Math.pow(found.cx - data.expected[0], 2) +
          Math.pow(found.cz - data.expected[1], 2)
        );
        report.landmarks[name] = {
          expected: data.expected, found: [found.cx, found.cz],
          distance_m: Math.round(dist), pass: true
        };
        console.log(`  ${name}: PASS at [${found.cx}, ${found.cz}] (${Math.round(dist)}m from expected)`);
      } else {
        // Report biggest building in tile for debugging
        const biggest = tileData.buildings.reduce((a, b) => b.area > a.area ? b : a, { area: 0 });
        report.landmarks[name] = {
          expected: data.expected, found: null, pass: false,
          debug_biggest: biggest.area > 0 ? [biggest.cx, biggest.cz, biggest.area] : null
        };
        report.overall = 'WARN';
        console.log(`  ${name}: MISS — expected [${data.expected}], biggest in tile: [${biggest.cx}, ${biggest.cz}] area=${biggest.area}`);
      }
    } else {
      report.landmarks[name] = { expected: data.expected, found: null, pass: false };
      report.overall = 'FAIL';
      console.log(`  ${name}: FAIL — tile not found`);
    }
  }

  // 2. Statistical sanity
  console.log('\n2. Statistical Sanity Checks');
  const stats = manifest.totals;
  let totalHeight = 0, heightCount = 0, maxBuildingsInTile = 0;

  for (const tile of manifest.tiles) {
    if (tile.counts.buildings > maxBuildingsInTile) maxBuildingsInTile = tile.counts.buildings;
    const tileFile = resolve(OUTPUT_DIR, tile.file);
    if (existsSync(tileFile)) {
      const tileData = JSON.parse(readFileSync(tileFile, 'utf8'));
      for (const b of tileData.buildings) { totalHeight += b.height; heightCount++; }
    }
  }

  const avgHeight = heightCount > 0 ? totalHeight / heightCount : 0;
  report.statistics = {
    total_buildings: stats.buildings,
    avg_height: Math.round(avgHeight * 10) / 10,
    max_buildings_per_tile: maxBuildingsInTile,
    total_parks: stats.parks,
    total_roads: stats.roads
  };
  console.log(`  Buildings: ${stats.buildings}, Avg height: ${report.statistics.avg_height}m`);

  if (stats.buildings < 400000 || stats.buildings > 1000000) {
    report.statistics.in_range = false;
    if (report.overall === 'PASS') report.overall = 'WARN';
    console.log(`  WARNING: building count outside expected 400k-1M range`);
  }

  // 3. Geometry integrity (sample first 20 tiles)
  console.log('\n3. Geometry Integrity');
  const sampleBuildings = [];
  for (const tile of manifest.tiles.slice(0, 20)) {
    const tileFile = resolve(OUTPUT_DIR, tile.file);
    if (existsSync(tileFile)) {
      const tileData = JSON.parse(readFileSync(tileFile, 'utf8'));
      for (let i = 0; i < tileData.buildings.length && sampleBuildings.length < 100; i++) {
        sampleBuildings.push(tileData.buildings[i]);
      }
    }
  }

  let validCount = 0;
  for (const b of sampleBuildings) {
    const fp = b.footprint;
    if (fp.length < 4) continue;
    const gap = Math.sqrt(
      Math.pow(fp[0][0] - fp[fp.length - 1][0], 2) +
      Math.pow(fp[0][1] - fp[fp.length - 1][1], 2)
    );
    if (gap > 1) continue;
    if (b.area < MIN_BUILDING_AREA) continue;
    validCount++;
  }
  report.geometry = { sampled: sampleBuildings.length, valid: validCount };
  console.log(`  Buildings: ${validCount}/${sampleBuildings.length} valid`);

  // 4. Boundary dedup audit
  console.log('\n4. Tile Boundary Dedup Audit');
  let totalDuplicates = 0, pairsChecked = 0;
  for (let i = 0; i < 10 && i < manifest.tiles.length - 1; i++) {
    const tileA = manifest.tiles[i];
    const tileB = manifest.tiles.find(t => t.row === tileA.row && t.col === tileA.col + 1);
    if (tileB) {
      const fileA = resolve(OUTPUT_DIR, tileA.file);
      const fileB = resolve(OUTPUT_DIR, tileB.file);
      if (existsSync(fileA) && existsSync(fileB)) {
        const dataA = JSON.parse(readFileSync(fileA, 'utf8'));
        const dataB = JSON.parse(readFileSync(fileB, 'utf8'));
        let duplicates = 0;
        for (const ca of dataA.buildings) {
          for (const cb of dataB.buildings) {
            if (Math.sqrt(Math.pow(ca.cx - cb.cx, 2) + Math.pow(ca.cz - cb.cz, 2)) < 5) {
              duplicates++;
            }
          }
        }
        totalDuplicates += duplicates;
        pairsChecked++;
      }
    }
  }
  report.boundary_dedup = {
    pairs_checked: pairsChecked,
    avg_duplicates_per_pair: pairsChecked > 0 ? Math.round(totalDuplicates / pairsChecked) : 0
  };
  console.log(`  ${pairsChecked} pairs checked, ~${report.boundary_dedup.avg_duplicates_per_pair} duplicates/pair`);

  writeFileSync(resolve(OUTPUT_DIR, 'validation-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nValidation report written: ${report.overall}`);
  return report.overall;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const isTest = process.argv.includes('--test');

  if (isTest) {
    const passed = await runTestMode();
    process.exit(passed ? 0 : 1);
  } else {
    const manifest = await runFullFetch();
    const overall = runValidation(manifest);

    writeFileSync(DONE_PATH, JSON.stringify({
      completedAt: new Date().toISOString(),
      tiles: manifest.totals.tiles,
      buildings: manifest.totals.buildings,
      parks: manifest.totals.parks,
      roads: manifest.totals.roads,
      validation: overall,
      projection: 'OSGB36-BNG-proj4'
    }, null, 2));

    console.log('\n=== COMPLETE ===');
    console.log(`Tiles: ${manifest.totals.tiles}`);
    console.log(`Buildings: ${manifest.totals.buildings}`);
    console.log(`Parks: ${manifest.totals.parks}`);
    console.log(`Roads: ${manifest.totals.roads}`);
    console.log(`Validation: ${overall}`);
  }
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
