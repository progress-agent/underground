#!/usr/bin/env node
/**
 * fetch-surface-osm.mjs
 *
 * Fetches OpenStreetMap data (buildings, parks, A-roads) for the Hyde Park
 * test area via the Overpass API, converts WGS84 coordinates to scene
 * coordinates, and writes the result to public/data/surface/hyde-park.json.
 *
 * Usage:  node scripts/fetch-surface-osm.mjs
 * Requires: Node 18+ (native fetch)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'public/data/surface');
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'hyde-park.json');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Bounding box: Hyde Park test area (WGS84 — for Overpass API queries)
const BBOX = { south: 51.495, west: -0.19, north: 51.52, east: -0.14 };

// WGS84 origin — still needed for Overpass API bbox queries
const ORIGIN_LAT = 51.5074;
const ORIGIN_LON = -0.1278;

// OSGB36 / British National Grid — includes Helmert 7-param datum transform
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');

// Scene origin in BNG (Trafalgar Square)
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Defaults
const DEFAULT_BUILDING_HEIGHT = 10;     // metres
const METRES_PER_LEVEL = 3.2;
const MIN_BUILDING_AREA = 20;           // m² — filter noise
const MIN_PARK_AREA = 500;              // m²
const DEFAULT_ROAD_WIDTH = 14;          // metres — A-road default

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

function llToScene(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  const x = e - BNG_REF_E;
  const z = -(n - BNG_REF_N);
  return [Math.round(x), Math.round(z)];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Shoelace formula — returns absolute area in scene-coordinate units (m²). */
function polygonArea(verts) {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i][0] * verts[j][1];
    area -= verts[j][0] * verts[i][1];
  }
  return Math.abs(area) / 2;
}

/** Centroid of a simple polygon (scene coords). */
function polygonCentroid(verts) {
  let cx = 0, cz = 0;
  const n = verts.length;
  for (const [x, z] of verts) {
    cx += x;
    cz += z;
  }
  return [Math.round(cx / n), Math.round(cz / n)];
}

// ---------------------------------------------------------------------------
// Overpass query
// ---------------------------------------------------------------------------

function buildQuery() {
  const bb = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `[out:json][timeout:30];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["leisure"="park"](${bb});
  way["landuse"="grass"](${bb});
  relation["leisure"="park"](${bb});
  way["highway"="primary"](${bb});
  way["highway"="trunk"](${bb});
);
out body;
>;
out skel qt;`;
}

async function fetchOverpass(query) {
  console.log('Querying Overpass API...');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  console.log(`Received ${data.elements.length} elements from Overpass`);
  return data;
}

// ---------------------------------------------------------------------------
// Element processing
// ---------------------------------------------------------------------------

/**
 * Build a lookup map of node ID -> {lat, lon} from the Overpass response.
 */
function buildNodeMap(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }
  return nodes;
}

/**
 * Resolve a way's node refs to scene-coordinate vertices.
 * Returns null if any node is missing (incomplete data).
 */
function resolveWayCoords(way, nodeMap) {
  const coords = [];
  for (const nid of way.nodes) {
    const nd = nodeMap.get(nid);
    if (!nd) return null;
    coords.push(llToScene(nd.lat, nd.lon));
  }
  return coords;
}

/**
 * Resolve a relation's outer ring(s) to scene-coordinate vertex arrays.
 * Returns an array of polygons (each polygon = array of [x,z]).
 */
function resolveRelationOuters(relation, wayMap, nodeMap) {
  const outers = [];
  for (const member of relation.members) {
    if (member.type === 'way' && (member.role === 'outer' || member.role === '')) {
      const way = wayMap.get(member.ref);
      if (!way) continue;
      const coords = resolveWayCoords(way, nodeMap);
      if (coords) outers.push(coords);
    }
  }
  // If multiple outer segments, attempt to join them end-to-end
  if (outers.length > 1) {
    const joined = joinSegments(outers);
    if (joined) return [joined];
  }
  return outers;
}

/**
 * Attempt to join an array of line segments into a single ring.
 * Segments share endpoints by coordinate equality.
 */
function joinSegments(segments) {
  if (segments.length === 0) return null;

  // Work with copies
  const remaining = segments.map(s => [...s]);
  const ring = remaining.shift();

  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      const ringStart = ring[0];
      const ringEnd = ring[ring.length - 1];
      const segStart = seg[0];
      const segEnd = seg[seg.length - 1];

      if (ringEnd[0] === segStart[0] && ringEnd[1] === segStart[1]) {
        ring.push(...seg.slice(1));
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (ringEnd[0] === segEnd[0] && ringEnd[1] === segEnd[1]) {
        ring.push(...seg.reverse().slice(1));
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (ringStart[0] === segEnd[0] && ringStart[1] === segEnd[1]) {
        ring.unshift(...seg.slice(0, -1));
        remaining.splice(i, 1);
        changed = true;
        break;
      } else if (ringStart[0] === segStart[0] && ringStart[1] === segStart[1]) {
        ring.unshift(...seg.reverse().slice(0, -1));
        remaining.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return remaining.length === 0 ? ring : null;
}

/**
 * Determine building height from OSM tags.
 */
function buildingHeight(tags) {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!isNaN(h) && h > 0) return h;
  }
  if (tags['building:levels']) {
    const levels = parseFloat(tags['building:levels']);
    if (!isNaN(levels) && levels > 0) return levels * METRES_PER_LEVEL;
  }
  return DEFAULT_BUILDING_HEIGHT;
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------

function processElements(elements) {
  const nodeMap = buildNodeMap(elements);
  const wayMap = new Map();
  const buildings = [];
  const parks = [];
  const roads = [];

  // First pass: index all ways (needed for relation member lookup)
  for (const el of elements) {
    if (el.type === 'way') {
      wayMap.set(el.id, el);
    }
  }

  // Second pass: process ways and relations
  for (const el of elements) {
    if (el.type === 'way' && el.tags) {
      const coords = resolveWayCoords(el, nodeMap);
      if (!coords || coords.length < 2) continue;

      if (el.tags.building) {
        processBuilding(coords, el.tags, buildings);
      } else if (el.tags.leisure === 'park' || el.tags.landuse === 'grass') {
        processPark(coords, el.tags, parks);
      } else if (el.tags.highway === 'primary' || el.tags.highway === 'trunk') {
        processRoad(coords, el.tags, roads);
      }
    } else if (el.type === 'relation' && el.tags) {
      const outers = resolveRelationOuters(el, wayMap, nodeMap);
      if (outers.length === 0) continue;

      if (el.tags.building) {
        for (const ring of outers) {
          processBuilding(ring, el.tags, buildings);
        }
      } else if (el.tags.leisure === 'park' || el.tags.landuse === 'grass') {
        for (const ring of outers) {
          processPark(ring, el.tags, parks);
        }
      }
    }
  }

  return { buildings, parks, roads };
}

function processBuilding(coords, tags, buildings) {
  if (coords.length < 4) return; // need at least 3 unique vertices + closing
  const area = polygonArea(coords);
  if (area < MIN_BUILDING_AREA) return;

  const [cx, cz] = polygonCentroid(coords);
  const height = buildingHeight(tags);

  buildings.push({
    cx,
    cz,
    height: Math.round(height * 10) / 10,
    area: Math.round(area),
    footprint: coords,
  });
}

function processPark(coords, tags, parks) {
  if (coords.length < 4) return;
  const area = polygonArea(coords);
  if (area < MIN_PARK_AREA) return;

  parks.push({
    polygon: coords,
    name: tags.name || null,
  });
}

function processRoad(coords, tags, roads) {
  if (coords.length < 2) return;

  roads.push({
    points: coords,
    width: DEFAULT_ROAD_WIDTH,
    name: tags.name || null,
  });
}

// ---------------------------------------------------------------------------
// Scene bounding box
// ---------------------------------------------------------------------------

function computeSceneBBox() {
  const sw = llToScene(BBOX.south, BBOX.west);
  const ne = llToScene(BBOX.north, BBOX.east);
  return {
    minX: Math.min(sw[0], ne[0]),
    maxX: Math.max(sw[0], ne[0]),
    minZ: Math.min(sw[1], ne[1]),
    maxZ: Math.max(sw[1], ne[1]),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const query = buildQuery();
  const data = await fetchOverpass(query);
  const { buildings, parks, roads } = processElements(data.elements);

  const output = {
    bounds: {
      sw: [BBOX.south, BBOX.west],
      ne: [BBOX.north, BBOX.east],
      sceneBBox: computeSceneBBox(),
    },
    buildings,
    parks,
    roads,
  };

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const json = JSON.stringify(output, null, 2);
  writeFileSync(OUTPUT_FILE, json, 'utf-8');

  // Summary
  const sizeKB = (Buffer.byteLength(json, 'utf-8') / 1024).toFixed(1);
  console.log('');
  console.log('--- Surface OSM fetch complete ---');
  console.log(`Buildings: ${buildings.length}`);
  console.log(`Parks:     ${parks.length}`);
  console.log(`Roads:     ${roads.length}`);
  console.log(`Output:    ${OUTPUT_FILE}`);
  console.log(`Size:      ${sizeKB} KB`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
