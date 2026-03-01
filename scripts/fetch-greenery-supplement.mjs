#!/usr/bin/env node
/**
 * fetch-greenery-supplement.mjs — Add greenery data to existing surface tiles
 *
 * Fetches green OSM features NOT in the original surface query and stores
 * them in a separate `greenery` array in each tile JSON. This field is
 * REPLACED on each run (idempotent — safe to re-run with expanded queries).
 *
 * Categories fetched:
 *   natural   = wood, heath, scrub, grassland
 *   landuse   = farmland, meadow, forest, allotments, orchard, vineyard,
 *               cemetery, village_green, recreation_ground
 *   leisure   = garden, golf_course, nature_reserve, recreation_ground
 *
 * Usage:
 *   node scripts/fetch-greenery-supplement.mjs          # all 775 tiles
 *   node scripts/fetch-greenery-supplement.mjs --test    # 3 test tiles
 *   node scripts/fetch-greenery-supplement.mjs --resume  # skip completed tiles
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import proj4 from 'proj4';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES_DIR = resolve(__dirname, '..', 'public', 'data', 'surface', 'tiles');

// ---------------------------------------------------------------------------
// Projection (identical to fetch-surface-tiles.mjs)
// ---------------------------------------------------------------------------

proj4.defs('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
  '+x_0=400000 +y_0=-100000 +ellps=airy ' +
  '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 ' +
  '+units=m +no_defs'
);

const [BNG_REF_E, BNG_REF_N] = proj4('EPSG:4326', 'EPSG:27700', [-0.1278, 51.5074]);

const M25_BOUNDS = {
  sw: { lat: 51.2792, lon: -0.5894 },
  ne: { lat: 51.7284, lon: 0.2843 }
};
const TILE_SIZE_LAT = 0.018;
const TILE_SIZE_LON = 0.029;

const DELAY_MS = 2000;
const MAX_RETRIES = 5;
const MIN_GREEN_AREA = 200; // m² — lower than parks (500) to capture smaller greens

// ---------------------------------------------------------------------------
// Coord helpers
// ---------------------------------------------------------------------------

function llToScene(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  return [Math.round(e - BNG_REF_E), Math.round(-(n - BNG_REF_N))];
}

function getTileBounds(col, row) {
  const west = M25_BOUNDS.sw.lon + (col * TILE_SIZE_LON);
  const south = M25_BOUNDS.sw.lat + (row * TILE_SIZE_LAT);
  return { west, south, east: west + TILE_SIZE_LON, north: south + TILE_SIZE_LAT };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options);
    if (response.status === 429 || response.status >= 500) {
      if (attempt > MAX_RETRIES) throw new Error(`Max retries exceeded (${response.status})`);
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
// Overpass query — comprehensive greenery
// ---------------------------------------------------------------------------

function buildGreeneryQuery(west, south, east, north) {
  const bbox = `(${south},${west},${north},${east})`;
  // Each tag needs way + relation variants for multipolygon support
  const tags = [
    // Natural
    'natural=wood', 'natural=heath', 'natural=scrub', 'natural=grassland',
    // Landuse
    'landuse=farmland', 'landuse=meadow', 'landuse=forest',
    'landuse=allotments', 'landuse=orchard', 'landuse=vineyard',
    'landuse=cemetery', 'landuse=village_green', 'landuse=recreation_ground',
    // Leisure
    'leisure=garden', 'leisure=golf_course',
    'leisure=nature_reserve', 'leisure=recreation_ground',
  ];

  const queries = tags.flatMap(tag => {
    const [key, val] = tag.split('=');
    return [
      `  way["${key}"="${val}"]${bbox};`,
      `  relation["${key}"="${val}"]${bbox};`,
    ];
  });

  return `[out:json][timeout:180];\n(\n${queries.join('\n')}\n);\nout body;\n>;\nout skel qt;`;
}

// ---------------------------------------------------------------------------
// OSM parsing
// ---------------------------------------------------------------------------

function shoelaceArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1];
    area -= points[i + 1][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

const GREEN_TAGS = new Set([
  // natural
  'wood', 'heath', 'scrub', 'grassland',
  // landuse
  'farmland', 'meadow', 'forest', 'allotments', 'orchard', 'vineyard',
  'cemetery', 'village_green', 'recreation_ground',
  // leisure
  'garden', 'golf_course', 'nature_reserve',
]);

function parseGreenery(osmData) {
  const nodes = new Map();
  const greens = [];

  for (const el of (osmData.elements || [])) {
    if (el.type === 'node') nodes.set(el.id, [el.lat, el.lon]);
  }

  function resolveWayNodes(nodeIds) {
    return nodeIds.map(id => {
      const n = nodes.get(id);
      return n ? llToScene(n[0], n[1]) : null;
    }).filter(c => c !== null);
  }

  for (const el of (osmData.elements || [])) {
    if (el.type !== 'way' && el.type !== 'relation') continue;
    const tags = el.tags || {};

    const type = [tags.natural, tags.landuse, tags.leisure].find(v => v && GREEN_TAGS.has(v));
    if (!type) continue;

    let nodeIds = [];
    if (el.type === 'way') {
      nodeIds = el.nodes || [];
    } else if (el.members) {
      for (const member of el.members) {
        if (member.type === 'way' && member.role === 'outer') {
          const way = osmData.elements.find(e => e.type === 'way' && e.id === member.ref);
          if (way?.nodes) nodeIds.push(...way.nodes);
        }
      }
    }

    const polygon = resolveWayNodes(nodeIds);
    if (polygon.length < 3) continue;

    // Close polygon
    if (polygon[0][0] !== polygon[polygon.length - 1][0] ||
        polygon[0][1] !== polygon[polygon.length - 1][1]) {
      polygon.push([...polygon[0]]);
    }

    const area = shoelaceArea(polygon);
    if (area < MIN_GREEN_AREA) continue;

    greens.push({
      polygon: polygon.map(p => [Math.round(p[0]), Math.round(p[1])]),
      name: tags.name || `[${type}]`
    });
  }

  return greens;
}

// ---------------------------------------------------------------------------
// Supplement a single tile
// ---------------------------------------------------------------------------

async function supplementTile(col, row) {
  const filename = `tile_${col.toString().padStart(2, '0')}_${row.toString().padStart(2, '0')}.json`;
  const filepath = resolve(TILES_DIR, filename);

  if (!existsSync(filepath)) {
    return { filename, col, row, skipped: true, reason: 'tile missing' };
  }

  const bounds = getTileBounds(col, row);
  const query = buildGreeneryQuery(bounds.west, bounds.south, bounds.east, bounds.north);

  const response = await fetchWithRetry('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!response.ok) throw new Error(`Overpass error: ${response.status}`);

  const osmData = await response.json();
  const newGreens = parseGreenery(osmData);

  // Read existing tile, REPLACE greenery array (idempotent), leave parks/buildings/roads intact
  const tile = JSON.parse(readFileSync(filepath, 'utf8'));

  // Clean up any parks appended by the old test run (names starting with [)
  if (tile.parks) {
    tile.parks = tile.parks.filter(p => !p.name.startsWith('['));
  }

  tile.greenery = newGreens;
  delete tile._greenery_supplemented; // clean up old flag

  writeFileSync(filepath, JSON.stringify(tile, null, 2));

  return { filename, col, row, count: newGreens.length };
}

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------

async function runTestMode() {
  console.log('=== TEST MODE (greenery supplement, expanded categories) ===\n');

  const testTiles = [
    { col: 3, row: 20, reason: 'NW outer London (farmland/heath)' },
    { col: 25, row: 5, reason: 'SE outer London (Kent countryside)' },
    { col: 15, row: 12, reason: 'Central London (gardens)' },
  ];

  for (const { col, row, reason } of testTiles) {
    console.log(`Tile ${col},${row}: ${reason}`);
    try {
      const result = await supplementTile(col, row);
      if (result.skipped) {
        console.log(`  Skipped: ${result.reason}`);
      } else {
        console.log(`  Greenery: ${result.count} features`);
        // Show breakdown
        const filepath = resolve(TILES_DIR, result.filename);
        const data = JSON.parse(readFileSync(filepath, 'utf8'));
        const types = {};
        for (const g of (data.greenery || [])) {
          const match = g.name.match(/^\[(\w+)\]$/);
          const type = match ? match[1] : 'named';
          types[type] = (types[type] || 0) + 1;
        }
        console.log(`  Types: ${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log('\nTest complete.');
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------

async function runFull() {
  const cols = Math.ceil((M25_BOUNDS.ne.lon - M25_BOUNDS.sw.lon) / TILE_SIZE_LON);
  const rows = Math.ceil((M25_BOUNDS.ne.lat - M25_BOUNDS.sw.lat) / TILE_SIZE_LAT);
  const total = cols * rows;

  const isResume = process.argv.includes('--resume');

  console.log(`=== GREENERY SUPPLEMENT — EXPANDED (${total} tiles) ===`);
  console.log(`Categories: wood, heath, scrub, grassland, farmland, meadow, forest,`);
  console.log(`  allotments, orchard, vineyard, cemetery, village_green,`);
  console.log(`  recreation_ground, garden, golf_course, nature_reserve`);
  console.log(`Output: ${TILES_DIR}`);
  if (isResume) console.log('Resume mode: skipping tiles with greenery array');
  console.log('');

  let completed = 0, totalGreenery = 0, errors = 0;
  const startTime = Date.now();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const filename = `tile_${col.toString().padStart(2, '0')}_${row.toString().padStart(2, '0')}.json`;
      const filepath = resolve(TILES_DIR, filename);

      // Resume: skip tiles that already have a greenery array
      if (isResume && existsSync(filepath)) {
        try {
          const existing = JSON.parse(readFileSync(filepath, 'utf8'));
          if (Array.isArray(existing.greenery)) {
            completed++;
            totalGreenery += existing.greenery.length;
            continue;
          }
        } catch (_) {}
      }

      try {
        const result = await supplementTile(col, row);
        completed++;

        if (!result.skipped) {
          totalGreenery += result.count;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / (elapsed / 60);
        const remaining = Math.round((total - completed) / rate);

        if ((result.count > 0) || completed % 50 === 0) {
          console.log(
            `[${completed}/${total}] ${filename}: +${result.count || 0} greens | ` +
            `Total: ${totalGreenery} | ~${remaining} min remaining`
          );
        }
      } catch (err) {
        errors++;
        console.error(`[${completed}/${total}] ${filename}: ERROR — ${err.message}`);
      }

      await sleep(DELAY_MS);
    }
  }

  // Update manifest
  const manifestPath = resolve(TILES_DIR, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    let parkTotal = 0, greeneryTotal = 0;
    for (const tile of manifest.tiles) {
      const fp = resolve(TILES_DIR, tile.file);
      if (existsSync(fp)) {
        const data = JSON.parse(readFileSync(fp, 'utf8'));
        const pc = data.parks ? data.parks.length : 0;
        const gc = data.greenery ? data.greenery.length : 0;
        tile.counts.parks = pc;
        tile.counts.greenery = gc;
        parkTotal += pc;
        greeneryTotal += gc;
      }
    }
    manifest.totals.parks = parkTotal;
    manifest.totals.greenery = greeneryTotal;
    manifest.greenery_supplemented = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest updated: ${parkTotal} parks + ${greeneryTotal} greenery`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Tiles processed: ${completed}`);
  console.log(`Greenery features: ${totalGreenery}`);
  console.log(`Errors: ${errors}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isTest = process.argv.includes('--test');

if (isTest) {
  runTestMode().catch(err => { console.error('Fatal:', err); process.exit(1); });
} else {
  runFull().catch(err => { console.error('Fatal:', err); process.exit(1); });
}
