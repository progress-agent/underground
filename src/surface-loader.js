// surface-loader.js — Progressive tile loader for surface features
//
// Loads the tile manifest, then fetches individual tiles based on camera
// proximity. Each loaded tile is passed to callbacks for texture rasterisation
// (parks+roads) and geometry creation (buildings).
//
// Tile lifecycle:
//   IDLE → LOADING → LOADED → (optionally) DISPOSED
//
// Deduplication: buildings near tile boundaries appear in both tiles.
// Each building gets a spatial hash; duplicates are silently skipped.

// ─── Configuration ──────────────────────────────────────────────────────────

const LOAD_RADIUS   = 12000; // metres — tiles within this radius of camera get loaded
const UNLOAD_RADIUS = 18000; // metres — tiles beyond this get disposed
const MAX_CONCURRENT = 4;    // max simultaneous tile fetches
const CHECK_INTERVAL = 500;  // ms between camera-distance checks

// ─── State ──────────────────────────────────────────────────────────────────

let manifest = null;
let tileStates = null;        // Map<filename, { state, centre, data, mesh }>
let onTileLoaded = null;      // callback(tileData, tileEntry)
let onTileDisposed = null;    // callback(tileEntry)
let activeFetches = 0;
let lastCheckTime = 0;
let enabled = false;

// Building dedup: Set of spatial hashes for placed buildings
const placedBuildings = new Set();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialise the tile loader.
 *
 * @param {object} opts
 * @param {Function} opts.onTileLoaded   - (tileData, tileManifestEntry) => void
 * @param {Function} opts.onTileDisposed - (tileManifestEntry) => void
 * @returns {Promise<object>} manifest data
 */
export async function initSurfaceLoader(opts) {
  onTileLoaded = opts.onTileLoaded;
  onTileDisposed = opts.onTileDisposed;

  const resp = await fetch('/data/surface/tiles/manifest.json');
  if (!resp.ok) throw new Error(`Manifest fetch failed: ${resp.status}`);
  manifest = await resp.json();

  // Pre-compute tile centres and init state map
  tileStates = new Map();
  for (const tile of manifest.tiles) {
    const bb = tile.sceneBBox;
    tileStates.set(tile.file, {
      state: 'idle',           // idle | loading | loaded | disposed
      cx: (bb.minX + bb.maxX) / 2,
      cz: (bb.minZ + bb.maxZ) / 2,
      data: null,
      meshRef: null,           // opaque ref for geometry module to track
      buildingHashes: new Set(), // spatial hashes this tile contributed to placedBuildings
    });
  }

  enabled = true;
  console.log(`Surface loader: ${manifest.tiles.length} tiles in ${manifest.cols}×${manifest.rows} grid`);
  return manifest;
}

/**
 * Call each frame with the current camera position.
 * Triggers tile loads/unloads based on distance.
 *
 * @param {number} camX  Camera X position (scene coords)
 * @param {number} camZ  Camera Z position (scene coords)
 */
export function updateSurfaceLoader(camX, camZ) {
  if (!enabled || !tileStates) return;

  const now = performance.now();
  if (now - lastCheckTime < CHECK_INTERVAL) return;
  lastCheckTime = now;

  // Collect tiles that need loading, sorted by distance (nearest first)
  const toLoad = [];

  for (const tile of manifest.tiles) {
    const ts = tileStates.get(tile.file);
    const dx = ts.cx - camX;
    const dz = ts.cz - camZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < LOAD_RADIUS && ts.state === 'idle') {
      toLoad.push({ tile, ts, dist });
    } else if (dist > UNLOAD_RADIUS && ts.state === 'loaded') {
      // Dispose far-away tiles. Reset to 'idle' (not 'disposed') so the tile
      // re-enters the load queue if the camera comes back within LOAD_RADIUS.
      // 'disposed' is reserved for permanent failures (SPA fallback below).
      //
      // Surrender this tile's spatial hashes from the global dedup registry
      // BEFORE firing the external disposal hook — otherwise those hashes
      // would persist and reject every building on the tile's next reload,
      // leaving the tile invisible but counted as 'loaded' (correctness bug).
      if (ts.buildingHashes && ts.buildingHashes.size > 0) {
        for (const hash of ts.buildingHashes) placedBuildings.delete(hash);
        ts.buildingHashes.clear();
      }
      ts.state = 'idle';
      ts.data = null;
      if (onTileDisposed) onTileDisposed(tile);
    }
  }

  // Sort by distance (nearest first) and respect concurrency limit
  toLoad.sort((a, b) => a.dist - b.dist);

  for (const { tile, ts } of toLoad) {
    if (activeFetches >= MAX_CONCURRENT) break;
    fetchTile(tile, ts);
  }
}

/**
 * Get the full scene bounding box of all tiles (for texture UV mapping).
 */
export function getFullSceneBBox() {
  if (!manifest) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of manifest.tiles) {
    if (t.sceneBBox.minX < minX) minX = t.sceneBBox.minX;
    if (t.sceneBBox.maxX > maxX) maxX = t.sceneBBox.maxX;
    if (t.sceneBBox.minZ < minZ) minZ = t.sceneBBox.minZ;
    if (t.sceneBBox.maxZ > maxZ) maxZ = t.sceneBBox.maxZ;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Get a spatial hash for a building, used for boundary deduplication.
 * Buildings within 5m of each other (same height) are considered duplicates.
 */
export function buildingHash(b) {
  // Round to 5m grid + height bucket
  const gx = Math.round(b.cx / 5) * 5;
  const gz = Math.round(b.cz / 5) * 5;
  const gh = Math.round(b.height);
  return `${gx},${gz},${gh}`;
}

/**
 * Build a per-tile dedup predicate. The returned closure checks whether a
 * building's spatial hash is already resident in the global `placedBuildings`
 * registry; if not, it records the hash both globally and on the tile's own
 * `buildingHashes` Set (so the tile can surrender those hashes when disposed).
 *
 * Replaces the old module-level `isDuplicateBuilding` which leaked hashes
 * forever — on reload, every building hashed identically and was rejected,
 * leaving the tile with zero rendered buildings.
 *
 * @param {string} tileKey  The manifest file key (matches tileStates Map key)
 * @returns {(b: object) => boolean}  true if duplicate (skip), false if new
 */
export function makeTileDedup(tileKey) {
  return function dedup(b) {
    const hash = buildingHash(b);
    if (placedBuildings.has(hash)) return true;
    placedBuildings.add(hash);
    const ts = tileStates ? tileStates.get(tileKey) : null;
    if (ts) ts.buildingHashes.add(hash);
    return false;
  };
}

/**
 * Get loading statistics.
 */
export function getSurfaceLoaderStats() {
  if (!tileStates) return { total: 0, loaded: 0, loading: 0 };
  let loaded = 0, loading = 0;
  for (const ts of tileStates.values()) {
    if (ts.state === 'loaded') loaded++;
    if (ts.state === 'loading') loading++;
  }
  return { total: manifest.tiles.length, loaded, loading };
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function fetchTile(tile, ts) {
  ts.state = 'loading';
  activeFetches++;

  try {
    const resp = await fetch(`/data/surface/tiles/${tile.file}`);
    if (!resp.ok) {
      console.warn(`Tile ${tile.file}: HTTP ${resp.status}`);
      ts.state = 'idle'; // retry later
      return;
    }

    // Vite SPA fallback trap: check content-type
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      console.warn(`Tile ${tile.file}: got HTML (SPA fallback), skipping`);
      ts.state = 'disposed'; // don't retry
      return;
    }

    const data = await resp.json();
    ts.state = 'loaded';
    ts.data = data;

    if (onTileLoaded) onTileLoaded(data, tile);
  } catch (err) {
    console.warn(`Tile ${tile.file}: ${err.message}`);
    ts.state = 'idle'; // retry later
  } finally {
    activeFetches--;
  }
}
