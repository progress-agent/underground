import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchRouteSequence, fetchBundledRouteSequenceIndex, fetchTubeLines } from './tfl.js';
import { loadStationDepthAnchors, depthForStation, debugDepthStats, buildDepthInterpolator } from './depth.js';
import { tryCreateTerrainMesh, xzToTerrainUV, terrainHeightToWorldY, TERRAIN_CONFIG, createSkyDome, updateEnvironment, createAtmosphere, updateLighting } from './terrain.js';
import { createStationMarkers } from './stations.js';
import { loadLineShafts, addShaftsToScene } from './shafts.js';
import { loadThamesData, createThamesMesh } from './thames.js';
import { loadTidewayData, createTidewayTunnel, addTidewayToLegend } from './tideway.js';
import { loadCrossrailData, createCrossrailTunnel, addCrossrailToLegend } from './crossrail.js';
import { createGeologicalStrata, addGeologyToLegend } from './geology.js';

// Version: 2026-02-06-1330 - UnderGround MVP
// Emergency debugging: catch all errors
window.addEventListener('error', (e) => {
  console.error('GLOBAL ERROR:', e.error);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;top:10px;left:10px;background:red;color:white;padding:10px;z-index:9999">ERROR: ${e.error?.message || e.message}</div>`);
});

// Mobile debug overlay: shows key logs on screen (only when ?debug=1 or on error)
(function setupMobileDebug() {
  const urlParams = new URLSearchParams(location.search);
  const debugEnabled = urlParams.get('debug') === '1';
  
  let debugDiv = null;
  let logs = [];
  
  function createDebugDiv() {
    if (debugDiv) return debugDiv;
    debugDiv = document.createElement('div');
    debugDiv.id = 'mobile-debug';
    debugDiv.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;max-height:150px;overflow:auto;background:rgba(0,0,0,0.85);color:#0f0;font-family:monospace;font-size:11px;padding:8px;z-index:10000;border-radius:8px;pointer-events:none;';
    document.body.appendChild(debugDiv);
    // Populate with any buffered logs
    if (logs.length > 0) {
      debugDiv.textContent = logs.join('\n');
    }
    return debugDiv;
  }
  
  function show(msg) {
    logs.push(msg);
    if (logs.length > 10) logs.shift();
    if (debugDiv) {
      debugDiv.textContent = logs.join('\n');
    }
  }
  
  // If debug mode enabled via URL, create immediately
  if (debugEnabled) {
    createDebugDiv();
  }
  
  // Capture key logs only when debug is enabled or after an error
  const origLog = console.log;
  console.log = (...args) => {
    origLog.apply(console, args);
    if (!debugEnabled) return;
    const msg = args.join(' ');
    if (msg.includes('stations') || msg.includes('labels') || msg.includes('update')) {
      show(msg.slice(0, 100));
    }
  };
  
  // Expose show() for error handlers to use even when debug not enabled
  window.mobileDebug = { 
    show: (msg) => {
      createDebugDiv();
      show(msg);
    }
  };
})();

// Real-world tube tunnels are built as parallel bores roughly 5–10 m apart (centre-to-centre).
// With 4.5m radius tubes, we need ~6-8m half-spacing to show clear separation.
const TUNNEL_OFFSET_METRES = 6.0;

// Twin tunnel toggle preference (initialized after prefs loads)
let twinTunnelsEnabled = true;
let tunnelOffsetM = TUNNEL_OFFSET_METRES;
let twinTunnelOffset = TUNNEL_OFFSET_METRES;

function setNetStatus({ kind, text }) {
  const el = document.getElementById('netStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn', 'err');
  el.classList.add(kind);
  el.textContent = text;
  el.style.display = 'block';
  // auto-hide happy path after a moment
  if (kind === 'ok') {
    setTimeout(() => { el.style.display = 'none'; }, 2500);
  }
}

// ---------- Scene ----------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Use a lighter background so scene is visible even if nothing renders
renderer.setClearColor(0x1a1a2e, 1);
app.appendChild(renderer.domElement);
// On mobile browsers, allow OrbitControls to handle gestures without the page
// also panning/zooming.
renderer.domElement.style.touchAction = 'none';
renderer.domElement.style.webkitTapHighlightColor = 'transparent';

const scene = new THREE.Scene();
// Re-enabled fog with lighter color for better above-ground visibility
scene.fog = new THREE.Fog(0x1a2a3a, 800, 20000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 50000);
// Curated view: straight down over central London
// Position above the city looking directly down
const INITIAL_VIEW = {
  position: new THREE.Vector3(0, 4500, 0),  // High above, straight down
  target: new THREE.Vector3(0, 0, 0)          // Looking at center of network
};
camera.position.copy(INITIAL_VIEW.position);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(INITIAL_VIEW.target);
controls.minDistance = 10;
controls.maxDistance = 25000;
// Lock controls during initial load to prevent accidental movement
controls.enabled = false;

// Mobile/touch UX:
// - 1 finger: rotate
// - 2 fingers: dolly + pan
// (Three.js OrbitControls defaults vary by version; set explicitly.)
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// ---------- FPS-style Keyboard Controls ----------
// Adds WASD/QE/SX movement + arrow key look direction
// Works alongside OrbitControls (mouse) — use one or both
const fpsControls = {
  enabled: true,
  moveSpeed: 1000.0,      // base movement speed (units/sec) — 10X for tube-scale flying
  fastMultiplier: 2.0,    // W = faster
  rotateSpeed: 2.0,       // arrow key rotation speed (rad/sec)
  keys: new Set(),        // currently pressed keys
  active: false,          // true when FPS keys are being held
};

window.addEventListener('keydown', (e) => {
  fpsControls.keys.add(e.key.toLowerCase());
});

window.addEventListener('keyup', (e) => {
  fpsControls.keys.delete(e.key.toLowerCase());
});

// Prevent default scrolling for control keys
window.addEventListener('keydown', (e) => {
  const controlKeys = ['s', 'w', 'x', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  if (controlKeys.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
}, { passive: false });

function updateFpsControls(dt) {
  if (!fpsControls.enabled) return;

  const keys = fpsControls.keys;
  const hasFpsKey = ['s', 'w', 'x', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
    .some(k => keys.has(k));

  fpsControls.active = hasFpsKey;

  if (!hasFpsKey) return;

  // Disable OrbitControls while using FPS controls to prevent fighting
  controls.enabled = false;

  const moveSpeed = fpsControls.moveSpeed;
  const fastMult = fpsControls.fastMultiplier;

  // Get camera's current forward direction (from camera matrix)
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  // Project forward onto XZ plane for movement (keep Y separate)
  const forwardXZ = new THREE.Vector3(forward.x, 0, forward.z).normalize();

  // Right vector is perpendicular to forward in XZ plane
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();

  // Calculate movement direction
  const moveDir = new THREE.Vector3();

  // S = forward (normal speed)
  if (keys.has('s')) moveDir.add(forwardXZ);
  // W = faster forward
  if (keys.has('w')) moveDir.add(forwardXZ.clone().multiplyScalar(fastMult));
  // X = backward
  if (keys.has('x')) moveDir.sub(forwardXZ);
  // A = left (strafe)
  if (keys.has('a')) moveDir.sub(right);
  // D = right (strafe)
  if (keys.has('d')) moveDir.add(right);
  // E = ascend
  if (keys.has('e')) moveDir.y += 1;
  // Q = descend
  if (keys.has('q')) moveDir.y -= 1;

  // Apply movement
  if (moveDir.lengthSq() > 0) {
    moveDir.normalize();
    const actualSpeed = keys.has('w') ? moveSpeed * fastMult : moveSpeed;
    const displacement = moveDir.multiplyScalar(actualSpeed * dt);
    camera.position.add(displacement);
    controls.target.add(displacement);
  }

  // Arrow keys rotate the camera (yaw and pitch)
  const yawSpeed = fpsControls.rotateSpeed;
  const pitchSpeed = fpsControls.rotateSpeed;

  let yaw = 0;
  let pitch = 0;

  if (keys.has('arrowleft')) yaw += yawSpeed * dt;
  if (keys.has('arrowright')) yaw -= yawSpeed * dt;
  if (keys.has('arrowup')) pitch += pitchSpeed * dt;
  if (keys.has('arrowdown')) pitch -= pitchSpeed * dt;

  if (yaw !== 0 || pitch !== 0) {
    // Get current rotation
    const quaternion = camera.quaternion.clone();
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');

    // Apply yaw (Y axis rotation)
    euler.y += yaw;

    // Apply pitch (X axis rotation) with clamping
    euler.x += pitch;
    euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

    // Set new rotation
    camera.quaternion.setFromEuler(euler);

    // Update OrbitControls target to match new look direction
    const lookDistance = camera.position.distanceTo(controls.target);
    const newForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).add(newForward.multiplyScalar(lookDistance));
  }
}

// ---------- Persistent UI prefs (localStorage) ----------
const PREFS_KEY = 'ug:prefs:v2';
function loadPrefs() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function savePrefs(next) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/private mode
  }
}
function resetPrefsAndCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    // clear prefs
    localStorage.removeItem(PREFS_KEY);
    // clear TfL cache entries
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ug:tfl:')) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
const prefs = loadPrefs();
// Prefs loaded silently

// Initialize twin tunnel settings now that prefs is loaded
twinTunnelsEnabled = prefs.twinTunnelsEnabled ?? true;
tunnelOffsetM = prefs.tunnelOffsetM ?? TUNNEL_OFFSET_METRES;
twinTunnelOffset = twinTunnelsEnabled ? tunnelOffsetM : 0;

// ---------- Simulation params ----------
// Set by the terrain loader when/if a terrain mesh exists.
let applyTerrainOpacity = null;
let terrain = null;

function getUrlNumberParam(key) {
  const sp = new URLSearchParams(location.search);
  if (!sp.has(key)) return null;
  const n = Number(sp.get(key));
  return Number.isFinite(n) ? n : null;
}

function getUrlStringParam(key) {
  const sp = new URLSearchParams(location.search);
  if (!sp.has(key)) return null;
  const v = (sp.get(key) ?? '').trim();
  return v.length ? v : null;
}

const urlTimeScale = getUrlNumberParam('t');
const urlVerticalScale = getUrlNumberParam('vz');
const urlHorizontalScale = getUrlNumberParam('hx');

// Optional: pre-focus camera on a line id (e.g. ?focus=victoria)
const urlFocusLine = getUrlStringParam('focus');

const sim = {
  trains: [],
  paused: prefs.paused ?? false,
  // 1 = real-time, >1 = sped up
  timeScale: urlTimeScale ?? (prefs.timeScale ?? 8),
  verticalScale: urlVerticalScale ?? (prefs.verticalScale ?? 3.0),
  horizontalScale: urlHorizontalScale ?? (prefs.horizontalScale ?? 1.0),
};

// Persist current values back to prefs so the next load (without URL params)
// uses the last-seen settings.
prefs.timeScale = sim.timeScale;
prefs.verticalScale = sim.verticalScale;
prefs.horizontalScale = sim.horizontalScale;
prefs.paused = !!sim.paused;
savePrefs(prefs);

function setUrlParam(key, value) {
  const url = new URL(location.href);
  url.searchParams.set(key, String(value));
  history.replaceState(null, '', url.toString());
}

function deleteUrlParam(key) {
  const url = new URL(location.href);
  url.searchParams.delete(key);
  history.replaceState(null, '', url.toString());
}

// HUD controls (optional)
{
  // Handlers check for existence before applying.

  const el = document.getElementById('timeScale');
  const out = document.getElementById('timeScaleValue');
  if (el) {
    // initialise from URL param t
    el.value = String(sim.timeScale);
    if (out) out.textContent = `${sim.timeScale}×`;

    el.addEventListener('input', () => {
      sim.timeScale = Number(el.value) || 1;
      prefs.timeScale = sim.timeScale;
      savePrefs(prefs);
      if (out) out.textContent = `${sim.timeScale}×`;
    });

    el.addEventListener('change', () => {
      const v = Number(el.value) || 1;
      if (v === 8) deleteUrlParam('t');
      else setUrlParam('t', v);
    });
  }

  const vEl = document.getElementById('verticalScale');
  const vOut = document.getElementById('verticalScaleValue');
  if (vEl) {
    vEl.value = String(sim.verticalScale);
    if (vOut) vOut.textContent = `${sim.verticalScale.toFixed(2)}×`;

    vEl.addEventListener('input', () => {
      sim.verticalScale = Number(vEl.value) || 1;
      prefs.verticalScale = sim.verticalScale;
      savePrefs(prefs);
      if (vOut) vOut.textContent = `${sim.verticalScale.toFixed(2)}×`;
    });

    vEl.addEventListener('change', () => {
      const v = Number(vEl.value) || 1;
      if (v === 3.0) deleteUrlParam('vz');
      else setUrlParam('vz', v);
      rebuildFromSimScales();
    });
  }

  const hEl = document.getElementById('horizontalScale');
  const hOut = document.getElementById('horizontalScaleValue');
  if (hEl) {
    hEl.value = String(sim.horizontalScale);
    if (hOut) hOut.textContent = `${sim.horizontalScale.toFixed(2)}×`;

    hEl.addEventListener('input', () => {
      sim.horizontalScale = Number(hEl.value) || 1;
      prefs.horizontalScale = sim.horizontalScale;
      savePrefs(prefs);
      if (hOut) hOut.textContent = `${sim.horizontalScale.toFixed(2)}×`;
    });

    hEl.addEventListener('change', () => {
      const v = Number(hEl.value) || 1;
      if (v === 1.0) deleteUrlParam('hx');
      else setUrlParam('hx', v);
      rebuildFromSimScales();
    });
  }
}

// ---------- Lights & Atmosphere ----------
// Remove old lighting setup - we'll use the atmospheric system
let atmosphereLights = null;
let skyDome = null;

// Initialize atmospheric lighting (adapts based on camera height)
atmosphereLights = createAtmosphere(scene);

// Create sky dome for above-ground visibility
skyDome = createSkyDome(scene);

// Keep rim light for tube highlighting
const rim = new THREE.DirectionalLight(0x9bd6ff, 0.65);
rim.position.set(-60, 80, -40);
scene.add(rim);

// ---------- Ground (terrain if available, else debug grid) ----------
{
  // Debug fallback: visible grid if terrain fails
  const grid = new THREE.GridHelper(24000, 120, 0x6b7280, 0x334155);
  grid.position.y = -6;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  grid.visible = false; // Hidden by default, shown if terrain fails
  scene.add(grid);
  
  // Attempt to load generated terrain heightmap
  terrain = null;
  applyTerrainOpacity = (opacity) => {
    if (!terrain?.mesh?.material) return;
    terrain.mesh.material.opacity = opacity;
    terrain.mesh.material.needsUpdate = true;
  };

  // Emergency debugging: ensure something is visible
  // Scene init
  
  tryCreateTerrainMesh({ opacity: 1.0, wireframe: false }).then(result => {
    if (!result) {
      grid.visible = true;
      return;
    }
    terrain = result;
    scene.add(result.mesh);

    // If station shafts already exist, snap their ground cubes to the terrain surface (approx).
    // This improves the "shaft length" feel without needing per-station survey data.
    snapAllShaftsToTerrain();
  });
  
  // Legacy surface plane removed — terrain mesh provides surface visual at full opacity
}

// Helper: snap all line shafts to current terrain height (module-scoped
// so it's accessible from both the terrain .then() callback and the
// per-line shaft loading code).
function snapAllShaftsToTerrain() {
  if (!terrain?.heightSampler) return;
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.shaftsLayer?.updateGroundYById) {
      const groundYById = {};
      for (const s of layers.shaftsLayer.shaftsData?.shafts ?? []) {
        if (!s?.id) continue;
        const { u, v } = xzToTerrainUV({ x: s.x, z: s.z, terrainSize: TERRAIN_CONFIG.size });
        const h01 = terrain.heightSampler(u, v);
        groundYById[s.id] = terrainHeightToWorldY({ h01 });
      }
      if (Object.keys(groundYById).length > 0) {
        layers.shaftsLayer.updateGroundYById(groundYById);
      }
    }
  }
}

// ---------- Thames (accurate river from BNG data) ----------
let thamesMesh = null;
loadThamesData().then(thamesData => {
  if (thamesData) {
    thamesMesh = createThamesMesh(thamesData, {
      width: 200,
      color: 0x1d4ed8,
      opacity: 0.4,
    });
    if (thamesMesh) {
      thamesMesh.position.y = -2.0;
      scene.add(thamesMesh);
    }
  }
});

// Module-scoped function assigned inside buildNetworkMvp (needs cross-block access)
let applySoloSelection = () => {};

// ---------- Tideway Tunnel (Super Sewer - deeper infrastructure) ----------
let tidewayMesh = null;
loadTidewayData().then(tidewayData => {
  if (tidewayData) {
    // Use the same projection as tube stations
    tidewayMesh = createTidewayTunnel(tidewayData, llToXZ, TERRAIN_CONFIG.depthScale);
    if (tidewayMesh) {
      scene.add(tidewayMesh);
      addTidewayToLegend();
      console.log('Tideway Tunnel added to scene');
    }
  }
});

// ---------- Crossrail/Elizabeth Line (deep rail infrastructure) ----------
let crossrailMesh = null;
loadCrossrailData().then(crossrailData => {
  if (crossrailData) {
    crossrailMesh = createCrossrailTunnel(crossrailData, llToXZ, TERRAIN_CONFIG.depthScale);
    if (crossrailMesh) {
      scene.add(crossrailMesh);
      addCrossrailToLegend();
      console.log('Crossrail added to scene');
    }
  }
});

// ---------- Geological Strata (London Clay & Chalk bedrock) ----------
const geologyGroup = createGeologicalStrata(null, TERRAIN_CONFIG.depthScale);
if (geologyGroup) {
  scene.add(geologyGroup);
  addGeologyToLegend();
  console.log('Geological strata added to scene');
}

// ---------- Tube lines (real TfL route sequences) ----------
// Brand-ish colours (can refine later)
const LINE_COLOURS = {
  bakerloo: 0xb36305,
  central: 0xdc241f,
  circle: 0xffd300,
  district: 0x00782a,
  'hammersmith-city': 0xf3a9bb,
  jubilee: 0x868f98,
  metropolitan: 0x9b0056,
  northern: 0x000000,
  piccadilly: 0x0019a8,
  victoria: 0x0098d4,
  'waterloo-city': 0x93ceba,
};

// Persisted line visibility (defaults to all-on)
// Line visibility now managed by solo dropdown (no per-line persistence needed)

// Track line groups so we can toggle visibility.
const lineGroups = new Map();
// Store approximate centerline points per line (for camera focus helpers).
const lineCenterPoints = new Map();
// Pickable meshes for raycast selection (click-to-focus).
const linePickables = [];
// Track meshes by lineId for hover highlight.
const lineMeshesById = new Map();


function setLineVisible(lineId, visible) {
  const g = lineGroups.get(lineId);
  if (!g) return;
  g.visible = visible;
}

function normalizeLineId(id) {
  return String(id || '').trim().toLowerCase().replace(/\s+/g, '-');
}

function brightenIfTooDark(hex, { minLuma = 0.08, floor = 0x2a2a2a } = {}) {
  const c = new THREE.Color(hex);
  // Relative luminance-ish (linear RGB); good enough for UI visibility decisions.
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (luma >= minLuma) return { base: hex, emissive: hex };
  // For very dark colours (e.g. Northern line black), keep base colour but
  // lift emissive so the geometry remains readable.
  return { base: hex, emissive: floor };
}

function frostedTubeMaterial(hex) {
  const { base, emissive } = brightenIfTooDark(hex);
  return new THREE.MeshPhysicalMaterial({
    color: base,
    transparent: true,
    opacity: 0.42,
    roughness: 0.45,
    metalness: 0.0,
    transmission: 0.82,
    thickness: 0.9,
    ior: 1.28,
    clearcoat: 0.22,
    clearcoatRoughness: 0.6,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: 0.15,
  });
}

// Geo projection: lon/lat -> x/z in *metres* (local tangent plane-ish), centred on London.
// This makes scene units ≈ metres, so train speeds and station spacing can feel real.
const ORIGIN = { lat: 51.5074, lon: -0.1278 };
const METRES_PER_DEG_LAT = 111_320;
function metresPerDegLonAt(latDeg) {
  return 111_320 * Math.cos(latDeg * Math.PI / 180);
}
function llToXZ(lat, lon) {
  const dLon = lon - ORIGIN.lon;
  const dLat = lat - ORIGIN.lat;
  const x = dLon * metresPerDegLonAt(ORIGIN.lat) * sim.horizontalScale;
  const z = dLat * METRES_PER_DEG_LAT * sim.horizontalScale;
  return { x, z: -z };
}

// Shared station registry: all lines use same X/Z for stations with same NaPTAN ID
// This ensures interchanges show vertical stacks, not offset tubes
const sharedStationPositions = new Map(); // naptanId -> { x, z, lat, lon }

function registerStationPosition(naptanId, lat, lon) {
  if (!naptanId) return;
  const key = String(naptanId).trim();
  if (sharedStationPositions.has(key)) {
    // Already registered — return canonical position
    return sharedStationPositions.get(key);
  }
  const { x, z } = llToXZ(lat, lon);
  sharedStationPositions.set(key, { x, z, lat, lon });
  return { x, z, lat, lon };
}

function getStationPosition(naptanId) {
  if (!naptanId) return null;
  return sharedStationPositions.get(String(naptanId).trim());
}

function rebuildFromSimScales() {
  // MVP: easiest way to apply hx/vz changes is a hard reload.
  // (We currently bake scales into geometry.)
  // Later: refactor to allow dynamic rescaling without re-fetching.
  const url = new URL(location.href);
  url.searchParams.set('t', String(sim.timeScale));
  url.searchParams.set('vz', String(sim.verticalScale));
  url.searchParams.set('hx', String(sim.horizontalScale));

  // Avoid a full navigation to preserve devtools state; still reloads the page.
  history.replaceState(null, '', url.toString());
  location.reload();
}

function buildOffsetCurvesFromCenterline(centerPts, halfSpacing = 1.0) {
  // Create two offset polylines (left/right) in XZ plane.
  // For each point, estimate tangent and take a perpendicular in XZ.
  const left = [];
  const right = [];

  for (let i = 0; i < centerPts.length; i++) {
    const p = centerPts[i];
    const pPrev = centerPts[Math.max(0, i - 1)];
    const pNext = centerPts[Math.min(centerPts.length - 1, i + 1)];

    const tangent = new THREE.Vector3().subVectors(pNext, pPrev);
    tangent.y = 0;
    tangent.normalize();

    // perpendicular in XZ: (x,z) -> (-z,x)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    left.push(new THREE.Vector3().copy(p).addScaledVector(normal, halfSpacing));
    right.push(new THREE.Vector3().copy(p).addScaledVector(normal, -halfSpacing));
  }

  return {
    leftCurve: new THREE.CatmullRomCurve3(left),
    rightCurve: new THREE.CatmullRomCurve3(right),
  };
}

function stationUsFromPolyline(centerPts) {
  // Convert station polyline vertices into approximate curve parameters u in [0,1]
  // by using cumulative distances along the polyline.
  let total = 0;
  const cum = [0];
  for (let i = 1; i < centerPts.length; i++) {
    total += centerPts[i].distanceTo(centerPts[i - 1]);
    cum.push(total);
  }
  if (total <= 0) return centerPts.map(() => 0);
  return cum.map(d => d / total);
}

// Extract inbound branch sequences from TfL route data, deduplicating stops.
// Returns { branches: [[sp, ...], ...], allStops: [sp, ...] }
function extractBranches(sequences) {
  const inbound = sequences.filter(s => s.direction === 'inbound');
  if (inbound.length === 0) {
    // Fallback: if no inbound, use all sequences
    const all = sequences.filter(s => s.stopPoint?.length > 0);
    if (all.length === 0) return { branches: [], allStops: [] };
    // Just pick longest as single branch
    const longest = all.reduce((best, cur) =>
      (cur.stopPoint.length > (best?.stopPoint?.length || 0)) ? cur : best, null);
    const sps = longest?.stopPoint || [];
    return { branches: [sps], allStops: sps };
  }

  const branches = inbound
    .map(s => s.stopPoint || [])
    .filter(arr => arr.length >= 2);

  // Deduplicate all stops by ID, preserving first occurrence
  const seen = new Set();
  const allStops = [];
  for (const branch of branches) {
    for (const sp of branch) {
      if (!seen.has(sp.id)) {
        seen.add(sp.id);
        allStops.push(sp);
      }
    }
  }

  return { branches, allStops };
}

function addLineFromStopPoints(lineId, colour, stopPoints, depthAnchors, sim, { branches = null } = {}) {
  // If branches provided, build one tube per branch. Otherwise treat stopPoints as single branch.
  const branchArrays = branches && branches.length > 0 ? branches : [stopPoints];

  const group = new THREE.Group();
  group.name = `line:${lineId}`;
  lineGroups.set(lineId, group);
  scene.add(group);

  const allCenterPts = []; // merged for camera focus
  const allMeshes = [];
  const allTrains = [];

  for (const branchStops of branchArrays) {
    const validStopPoints = branchStops.filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon));
    if (validStopPoints.length < 2) continue;

    const interpolateDepth = buildDepthInterpolator(validStopPoints, depthAnchors);
    const centerPts = [];

    for (const sp of validStopPoints) {
      registerStationPosition(sp.id, sp.lat, sp.lon);
      const pos = getStationPosition(sp.id);
      let depthM = interpolateDepth(sp.id);
      if (depthM === null) {
        depthM = depthForStation({ naptanId: sp.id, lineId, anchors: depthAnchors });
      }
      const y = -depthM * sim.verticalScale;
      centerPts.push(new THREE.Vector3(pos.x, y, pos.z));
    }

    allCenterPts.push(...centerPts);

    const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);
    const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, twinTunnelsEnabled ? tunnelOffsetM : 0);

    const segs = Math.max(80, centerPts.length * 10);
    const radius = 4.5;

    const leftMesh = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
    const rightMesh = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
    leftMesh.userData.lineId = lineId;
    rightMesh.userData.lineId = lineId;

    allMeshes.push(leftMesh, rightMesh);
    linePickables.push(leftMesh, rightMesh);
    group.add(leftMesh, rightMesh);

    // One train pair per branch
    const makeTrain = (curve, phase = 0, dir = +1) => {
      const train = new THREE.Mesh(
        new THREE.SphereGeometry(2.1, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(colour), emissiveIntensity: 1.6 })
      );
      const cruiseMps = (lineId === 'victoria' ? 14.5 : 12.0);
      const dwellSec = 22;
      const curveLengthM = curve.getLength();
      train.userData = {
        t: (Math.random() + phase) % 1, curve, dir, curveLengthM, stationUs,
        nextStationIndex: dir === 1 ? 0 : stationUs.length - 1,
        cruiseMps, dwellSec, _pausedLeft: 0,
      };
      train.position.copy(curve.getPointAt(train.userData.t));
      group.add(train);
      sim.trains.push(train);
      return train;
    };

    allTrains.push(makeTrain(leftCurve, 0.0, +1));
    allTrains.push(makeTrain(rightCurve, 0.5, -1));
  }

  // Keep merged center points for camera focus
  lineCenterPoints.set(lineId, allCenterPts);

  // Track all meshes for hover highlight
  lineMeshesById.set(lineId, allMeshes);

  if (allMeshes.length === 0) return null;
  return { group, meshes: allMeshes, trains: allTrains };
}

// (trains are kept in sim.trains)

// Victoria station markers/labels (legacy - now per-line tracking below)
let victoriaStationsLayer = null;
let victoriaStationsVisible = prefs.victoriaStationsVisible ?? true;
let victoriaLabelsVisible = prefs.victoriaLabelsVisible ?? true;

// Victoria station shafts (legacy - now per-line tracking below)
let victoriaShaftsLayer = null;
let victoriaShaftsVisible = prefs.victoriaShaftsVisible ?? true;

// Per-line shaft and station layer tracking (supports all 11 Underground lines + DLR)
const lineShaftLayers = new Map(); // lineId -> { shaftsLayer, stationsLayer }
const lineStationsVisible = new Map(); // lineId -> boolean
const lineLabelsVisible = new Map(); // lineId -> boolean
const lineShaftsVisible = new Map(); // lineId -> boolean

// Simple camera focus helpers (MVP)
function focusCameraOnStations({ stations, controls, camera, pad = 1.35 } = {}) {
  if (!stations || stations.length === 0) return;

  const box = new THREE.Box3();
  for (const st of stations) box.expandByPoint(st.pos);

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Frame the box: distance derived from vertical fov.
  // Ignore Y when framing; depth exaggeration can make Y huge and force the camera absurdly far.
  const maxDim = Math.max(size.x, size.z);
  const fov = camera.fov * Math.PI / 180;
  const dist = (maxDim * pad) / Math.max(1e-6, 2 * Math.tan(fov / 2));

  controls.target.copy(center);

  // Put camera at a pleasing oblique angle.
  // Keep a minimum zoom so we don't fly out so far that translucency/fog makes everything vanish.
  const distClamped = THREE.MathUtils.clamp(dist, 250, 6000);

  const dir = new THREE.Vector3(1, 0.6, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distClamped);

  controls.update();
}

async function buildNetworkMvp() {
  // Track loading start time for minimum display duration
  window.loadingStartTime = Date.now();
  let usedCacheFallback = false;
  try {
    setNetStatus({ kind: 'warn', text: 'Loading TfL tube lines…' });
    const depthAnchors = await loadStationDepthAnchors();

    // Render all TfL tube lines we know about.
    // If the bundled cache index exists, use it as the source of truth (keeps demo working offline
    // and avoids hard-coding line ids in two places).
    const bundledIndex = await fetchBundledRouteSequenceIndex();

    // Decide which line ids to render.
    // Priority:
    // 1) bundled cache index (best for offline demos)
    // 2) live discovery from TfL (/Line/Mode/tube)
    // 3) hard-coded fallback list
    let wanted;
    if (bundledIndex?.lines) {
      wanted = Object.keys(bundledIndex.lines);
    } else {
      try {
        const tubeLines = await fetchTubeLines({ ttlMs: 24 * 60 * 60 * 1000, useCache: true });
        wanted = (Array.isArray(tubeLines) ? tubeLines : [])
          .map(l => normalizeLineId(l?.id))
          .filter(Boolean);
      } catch {
        wanted = null;
      }

      if (!wanted || wanted.length === 0) {
        wanted = [
          'bakerloo','central','circle','district','hammersmith-city',
          'jubilee','metropolitan','northern','piccadilly','victoria','waterloo-city'
        ];
      }
    }

    // Keep a stable order for UI.
    wanted = Array.from(new Set(wanted)).sort();

    // Build solo-line dropdown (replaces per-line checkboxes)
    {
      const soloSelect = document.getElementById('soloLine');
      if (soloSelect) {
        for (const id of wanted) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = id.replace(/-/g, ' ');
          soloSelect.appendChild(opt);
        }
        // Add infrastructure layers as additional options
        soloSelect.appendChild(Object.assign(document.createElement('option'), { disabled: true, textContent: '───────────' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'crossrail', textContent: 'Crossrail' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'tideway', textContent: 'Tideway Tunnel' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'geology', textContent: 'Geology' }));

        // Restore from URL or prefs
        const focusParam = normalizeLineId(getUrlStringParam('focus'));
        if (focusParam && focusParam !== 'all') soloSelect.value = focusParam;

        soloSelect.addEventListener('change', () => {
          const val = soloSelect.value;
          applySoloSelection(val);
          if (val === 'all') deleteUrlParam('focus');
          else setUrlParam('focus', val);
          updateSimUi();
        });
      }
    }

    // Assign module-scoped applySoloSelection (needs cross-block access from keyboard/click handlers)
    applySoloSelection = function(val) {
      const isInfra = ['crossrail', 'tideway', 'geology'].includes(val);

      // Tube lines + their stations/shafts: show all or just selected
      for (const id of wanted) {
        const visible = val === 'all' || id === val;
        setLineVisible(id, visible);

        // Toggle per-line station markers, labels, and shafts
        const layers = lineShaftLayers.get(id);
        if (layers) {
          if (layers.stationsLayer?.mesh) layers.stationsLayer.mesh.visible = visible;
          if (layers.stationsLayer?.setLabelsVisible) layers.stationsLayer.setLabelsVisible(visible);
          if (layers.shaftsLayer?.group) layers.shaftsLayer.group.visible = visible;
        }
      }

      // Infrastructure: visible when "all" or when specifically solo'd
      if (tidewayMesh) tidewayMesh.visible = val === 'all' || val === 'tideway';
      if (crossrailMesh) crossrailMesh.visible = val === 'all' || val === 'crossrail';
      if (geologyGroup) geologyGroup.visible = val === 'all' || val === 'geology';

      // Focus camera on the selected line
      if (!isInfra && val !== 'all') {
        const pts = lineCenterPoints.get(val);
        if (pts && pts.length > 0) {
          focusCameraOnStations({ stations: pts.map(pos => ({ pos })), controls, camera, pad: 1.22 });
        }
      }
    };

    const failed = [];
    let loadedCount = 0;
    const totalLines = wanted.length;

    // Loading bar helper
    function updateLoadingProgress(current, total) {
      const fill = document.getElementById('loadingFill');
      if (fill) {
        const pct = Math.round((current / total) * 100);
        fill.style.width = `${pct}%`;
      }
    }

    for (const id of wanted) {
      setNetStatus({ kind: 'warn', text: `Loading TfL route sequences… (${loadedCount}/${wanted.length})` });
      updateLoadingProgress(loadedCount, totalLines);

      try {
        const colour = LINE_COLOURS[id] ?? 0xffffff;

        // Prefer live fetch, but allow cached fallback for robustness.
        // (fetchRouteSequence internally falls back to cache on network error.)
        let seq;
        try {
          seq = await fetchRouteSequence(id, { ttlMs: 24 * 60 * 60 * 1000, useCache: true, preferCache: false });
        } catch (err) {
          // If we fail here, retry preferring cache explicitly (covers cases where
          // the first throw happened before fallback due to a parse error etc.)
          usedCacheFallback = true;
          seq = await fetchRouteSequence(id, { ttlMs: 7 * 24 * 60 * 60 * 1000, useCache: true, preferCache: true });
        }

        const sequences = seq.stopPointSequences || [];
        const { branches, allStops } = extractBranches(sequences);

        const sps = allStops;
        const ds = debugDepthStats({ lineId: id, stopPoints: sps, anchors: depthAnchors });
        addLineFromStopPoints(id, colour, sps, depthAnchors, sim, { branches });
        setLineVisible(id, true);

        // Station markers + labels + shafts for all lines
        const DEEP_LINES_WITH_SHAFTS = new Set(['victoria', 'bakerloo', 'central', 'jubilee', 'northern', 'piccadilly', 'waterloo-city', 'circle', 'district', 'hammersmith-city', 'metropolitan', 'dlr']);
        if (DEEP_LINES_WITH_SHAFTS.has(id)) {
          const stations = sps
            .filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon))
            .map(sp => {
              const { x, z } = llToXZ(sp.lat, sp.lon);
              const depthM = depthForStation({ naptanId: sp.id, lineId: id, anchors: depthAnchors });
              const y = -depthM * sim.verticalScale;
              return {
                id: sp.id,
                name: sp.name,
                pos: new THREE.Vector3(x, y, z),
              };
            });

          // Dispose old per-line layers if they exist
          const existing = lineShaftLayers.get(id);
          existing?.stationsLayer?.dispose?.();
          existing?.shaftsLayer?.dispose?.();

          const stationsLayer = createStationMarkers({
            scene,
            stations,
            colour,
            size: 6.0,
            labels: true,
          });
          const sv = lineStationsVisible.get(id) ?? victoriaStationsVisible;
          const lv = lineLabelsVisible.get(id) ?? victoriaLabelsVisible;
          stationsLayer.setLabelsVisible(lv);
          stationsLayer.mesh.visible = sv;

          // Ground cube + platform cube + connecting line (MVP)
          // Make platform Y match the built tunnel centerline so shafts always intersect the tube.
          try {
            // Prefer prebuilt/cached shaft positions (generated via scripts), but fall back
            // to deriving them from the station list so shafts still render in dev/offline.
            let shaftsData = await loadLineShafts(id);
            if (!shaftsData) {
              shaftsData = {
                line: id,
                origin: ORIGIN,
                verticalScale: sim.verticalScale,
                groundY: -6,
                shafts: stations.map(st => ({
                  id: st.id,
                  name: st.name,
                  x: st.pos.x,
                  z: st.pos.z,
                  groundY: -6,
                  // initial platformY; we will override from centerline below.
                  platformY: st.pos.y,
                })),
              };
            }

            // Build a lookup from station id -> nearest centerline y.
            const centerPts = lineCenterPoints.get(id);
            const platformYById = {};
            if (centerPts?.length) {
              for (const st of stations) {
                let bestY = st.pos.y;
                let bestD2 = Infinity;
                for (const p of centerPts) {
                  const dx = p.x - st.pos.x;
                  const dz = p.z - st.pos.z;
                  const d2 = dx * dx + dz * dz;
                  if (d2 < bestD2) {
                    bestD2 = d2;
                    bestY = p.y;
                  }
                }
                platformYById[st.id] = bestY;
              }
            }

            const shaftsLayer = addShaftsToScene({ scene, shaftsData, colour, platformYById, kind: `${id}-shafts` });

            // If terrain is already loaded, snap ground cubes to terrain surface (approx).
            if (shaftsLayer?.updateGroundYById && terrain?.heightSampler) {
              snapAllShaftsToTerrain();
            }

            const shv = lineShaftsVisible.get(id) ?? true;
            if (shaftsLayer?.group) shaftsLayer.group.visible = shv;

            // Store per-line layers for later access
            lineShaftLayers.set(id, { stationsLayer, shaftsLayer });
          } catch (err) {
            console.warn(`Shaft loading failed for ${id}:`, err.message);
          }

          // Keep HUD checkboxes in sync
          if (id === 'victoria') {
            const stCb = document.getElementById('victoriaStations');
            if (stCb) stCb.checked = victoriaStationsVisible;
            const lbCb = document.getElementById('victoriaLabels');
            if (lbCb) lbCb.checked = victoriaLabelsVisible;
            const shCb = document.getElementById('victoriaShafts');
            if (shCb) shCb.checked = victoriaShaftsVisible;
          }
        }

        loadedCount++;
      } catch (e) {
        console.warn('Failed to build line', id, e);
        failed.push(id);
      }
    }

    // Loading complete: set bar to 100% and hide it
    updateLoadingProgress(totalLines, totalLines);
    // Ensure minimum display time so loading feedback is visible even with fast cache
    const MIN_LOADING_DISPLAY_MS = 1200;
    const elapsed = Date.now() - window.loadingStartTime;
    const remaining = Math.max(0, MIN_LOADING_DISPLAY_MS - elapsed);
    setTimeout(() => {
      const loadingBar = document.getElementById('loadingBar');
      if (loadingBar) loadingBar.classList.add('done');
      // Enable controls now that loading is done
      controls.enabled = true;
    }, 300 + remaining);

    // Summary status
    if (failed.length) {
      setNetStatus({
        kind: 'warn',
        text: `Loaded ${loadedCount}/${wanted.length} lines (failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''})`,
      });
    } else if (navigator.onLine === false) {
      setNetStatus({ kind: 'warn', text: 'Offline mode (using cached TfL data if available)' });
    } else if (usedCacheFallback) {
      setNetStatus({ kind: 'warn', text: 'TfL unstable — using cached data' });
    } else {
      setNetStatus({ kind: 'ok', text: 'TfL data loaded' });
    }

    // Optional: focus on a specific line after everything is built.
    const focusId = normalizeLineId(urlFocusLine);
    if (focusId && focusId !== 'all') {
      applySoloSelection(focusId);
      // Sync dropdown
      const soloSelect = document.getElementById('soloLine');
      if (soloSelect) soloSelect.value = focusId;
    }

    // Update HUD focus label once the network is built.
    updateSimUi();
  } catch (e) {
    console.warn('Network build failed:', e);

    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    // Try to detect whether a bundled cache exists, so we can show a less misleading error.
    let hasBundled = false;
    try {
      const idx = await fetchBundledRouteSequenceIndex();
      hasBundled = !!(idx && idx.lines && Object.keys(idx.lines).length);
    } catch {
      hasBundled = false;
    }

    if (offline && hasBundled) {
      setNetStatus({ kind: 'err', text: 'Offline: bundled TfL cache missing/unreadable. Rebuild with cached data.' });
    } else if (offline) {
      setNetStatus({ kind: 'err', text: 'Offline: no cached TfL data yet. Load once online or bundle cache.' });
    } else {
      setNetStatus({ kind: 'err', text: 'TfL fetch failed. Try refresh; the app will use cache when available.' });
    }
  }
}

buildNetworkMvp();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Click-to-focus / shift-click toggle + hover tooltip ----------
{
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const tip = document.getElementById('hoverTip');
  let lastHoverLineId = null;

  function prettyLineName(lineId) {
    return String(lineId || '').replace(/-/g, ' ');
  }

  function moveTip(ev, lineId) {
    if (!tip) return;
    if (!lineId) {
      tip.style.display = 'none';
      tip.style.transform = 'translate(-9999px, -9999px)';
      lastHoverLineId = null;
      return;
    }

    const name = prettyLineName(lineId);
    if (lastHoverLineId !== lineId) {
      tip.innerHTML = `<b>${name}</b> <span class="muted">(shift+click to toggle)</span>`;
      tip.style.display = 'block';
      lastHoverLineId = lineId;
    }

    const x = (ev.clientX ?? 0) + 12;
    const y = (ev.clientY ?? 0) + 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  function getMouseNdc(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function pickLineUnderPointer(ev) {
    getMouseNdc(ev);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(linePickables, false);
    if (!hits || hits.length === 0) return null;
    const hit = hits[0].object;
    return hit?.userData?.lineId || null;
  }

  // Station pickables for hover detection
  const stationPickables = [];
  
  function pickStationUnderPointer(ev) {
    getMouseNdc(ev);
    raycaster.setFromCamera(mouse, camera);
    // Check station markers from all line shaft layers
    const allStationMeshes = [];
    for (const [, layers] of lineShaftLayers) {
      if (layers.stationsLayer?.mesh) {
        allStationMeshes.push(layers.stationsLayer.mesh);
      }
    }
    if (allStationMeshes.length === 0) return null;
    const hits = raycaster.intersectObjects(allStationMeshes, false);
    if (!hits || hits.length === 0) return null;
    const hit = hits[0];
    const mesh = hit.object;
    // Get instance ID to look up station data
    const instanceId = hit.instanceId;
    if (instanceId == null || !mesh.userData?.stations?.[instanceId]) return null;
    return mesh.userData.stations[instanceId];
  }

  function setHoverHighlight(lineId) {
    // Clear all highlights (cheap; only ~11 lines).
    for (const [id, meshes] of lineMeshesById.entries()) {
      for (const m of meshes) {
        if (!m?.material) continue;
        // Reset to baseline.
        m.material.emissiveIntensity = 0.10;
        m.material.opacity = 0.42;
        m.material.thickness = 0.9;
      }
    }

    if (!lineId) return;
    const meshes = lineMeshesById.get(lineId);
    if (!meshes) return;

    // Make hover state clearly visible even for very dark lines (Northern).
    const isVeryDark = (lineId === 'northern');
    for (const m of meshes) {
      if (!m?.material) continue;
      m.material.emissiveIntensity = isVeryDark ? 0.55 : 0.22;
      m.material.opacity = 0.70;
      m.material.thickness = 1.35;
    }
  }

  function moveStationTip(ev, station) {
    if (!tip) return;
    if (!station) {
      // Don't hide here - let line hover take over
      return;
    }

    const depthM = Math.abs(station.pos?.z ? station.pos.z / 3.0 : 0).toFixed(0);
    const depthLabel = depthM > 0 ? `${depthM}m below ground` : 'Surface station';
    
    tip.innerHTML = `<b>${station.name}</b><br/><span class="muted">${depthLabel}</span>`;
    tip.style.display = 'block';
    
    const x = (ev.clientX ?? 0) + 12;
    const y = (ev.clientY ?? 0) + 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  function onPointerMove(ev) {
    // Check for station hover first (takes priority)
    const station = pickStationUnderPointer(ev);
    if (station) {
      moveStationTip(ev, station);
      setHoverHighlight(null); // Clear line highlight when hovering station
      return;
    }
    
    // Fall back to line hover
    const lineId = pickLineUnderPointer(ev);
    moveTip(ev, lineId);
    setHoverHighlight(lineId);
  }

  function onPointerLeave() {
    moveTip({}, null);
    setHoverHighlight(null);
  }

  function onPointerDown(ev) {
    // Only left click / primary.
    if (ev.button !== 0) return;

    const lineId = pickLineUnderPointer(ev);
    if (!lineId) return;

    // UX:
    // - Click: does nothing (no camera focus)
    // - Shift+Click: toggle visibility for that line
    if (ev.shiftKey) {
      // Solo the clicked line (or back to all if already solo'd)
      const soloSelect = document.getElementById('soloLine');
      const currentSolo = soloSelect?.value || 'all';
      const next = currentSolo === lineId ? 'all' : lineId;
      applySoloSelection(next);
      if (soloSelect) soloSelect.value = next;
      if (next === 'all') deleteUrlParam('focus');
      else setUrlParam('focus', next);
      updateSimUi();
    }
    // Click without shift: no action (intentionally empty)
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

// ---------- UI toggles ----------
function updateSimUi() {
  const btn = document.getElementById('togglePause');
  const label = document.getElementById('simStatus');
  if (btn) btn.textContent = sim.paused ? 'Resume' : 'Pause';
  if (label) label.textContent = sim.paused ? 'Paused' : 'Running';

  const focusLabel = document.getElementById('focusStatus');
  if (focusLabel) {
    const soloSelect = document.getElementById('soloLine');
    const focusId = soloSelect?.value || normalizeLineId(getUrlStringParam('focus')) || 'all';
    focusLabel.textContent = focusId === 'all' ? 'All lines' : focusId.replace(/-/g, ' ');
  }

  // Mobile-friendly: auto-collapse the HUD after initial load
  // so the scene is visible without scrolling.
  // (User can re-open via the <summary> header.)
  try {
    const details = document.getElementById('hudDetails');
    if (details && window.innerWidth <= 520 && details.open) {
      // Collapse on next tick to avoid fighting initial layout.
      setTimeout(() => { try { details.open = false; } catch {} }, 50);
    }
  } catch {
    // ignore
  }
}

function setSimPaused(v) {
  sim.paused = !!v;
  prefs.paused = sim.paused;
  savePrefs(prefs);
  updateSimUi();
}

function toggleSimPaused() {
  setSimPaused(!sim.paused);
}

function setVictoriaStationsVisible(v) {
  victoriaStationsVisible = !!v;
  // Toggle visibility for ALL lines with stations, not just Victoria
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.stationsLayer?.mesh) layers.stationsLayer.mesh.visible = victoriaStationsVisible;
  }
  prefs.victoriaStationsVisible = victoriaStationsVisible;
  savePrefs(prefs);
}
function setVictoriaLabelsVisible(v) {
  victoriaLabelsVisible = !!v;
  // Toggle labels for ALL lines, not just Victoria
  for (const [lineId, layers] of lineShaftLayers) {
    layers.stationsLayer?.setLabelsVisible?.(victoriaLabelsVisible);
  }
  prefs.victoriaLabelsVisible = victoriaLabelsVisible;
  savePrefs(prefs);
}

function setVictoriaShaftsVisible(v) {
  victoriaShaftsVisible = !!v;
  // Toggle visibility for ALL lines with shafts, not just Victoria
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.shaftsLayer?.group) layers.shaftsLayer.group.visible = victoriaShaftsVisible;
  }
  if (victoriaShaftsLayer?.group) victoriaShaftsLayer.group.visible = victoriaShaftsVisible;
  prefs.victoriaShaftsVisible = victoriaShaftsVisible;
  savePrefs(prefs);
}

// Hook up HUD controls (optional)
{
  const stCb = document.getElementById('victoriaStations');
  if (stCb) {
    stCb.checked = victoriaStationsVisible;
    stCb.addEventListener('change', () => setVictoriaStationsVisible(stCb.checked));
  }
  const lbCb = document.getElementById('victoriaLabels');
  if (lbCb) {
    lbCb.checked = victoriaLabelsVisible;
    lbCb.addEventListener('change', () => setVictoriaLabelsVisible(lbCb.checked));
  }

  const shCb = document.getElementById('victoriaShafts');
  if (shCb) {
    shCb.checked = victoriaShaftsVisible;
    shCb.addEventListener('change', () => setVictoriaShaftsVisible(shCb.checked));
  }

  const resetBtn = document.getElementById('resetPrefs');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetPrefsAndCache();
      location.reload();
    });
  }

  const pauseBtn = document.getElementById('togglePause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleSimPaused();
    });
  }

  const focusAllBtn = document.getElementById('focusAll');
  if (focusAllBtn) {
    focusAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // Reset solo dropdown to all lines
      applySoloSelection('all');
      const soloSelect = document.getElementById('soloLine');
      if (soloSelect) soloSelect.value = 'all';
      deleteUrlParam('focus');
      updateSimUi();
      // Focus camera on all lines
      const pts = [];
      for (const [lineId, group] of lineGroups.entries()) {
        if (!group?.visible) continue;
        const cps = lineCenterPoints.get(lineId);
        if (cps && cps.length) pts.push(...cps);
      }
      focusCameraOnStations({ stations: pts.map(pos => ({ pos })), controls, camera, pad: 1.18 });
    });
  }

  const copyLinkBtn = document.getElementById('copyLink');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = new URL(location.href);
      // Ensure the current sim sliders are represented.
      url.searchParams.set('t', String(sim.timeScale));
      url.searchParams.set('vz', String(sim.verticalScale));
      url.searchParams.set('hx', String(sim.horizontalScale));

      // Preserve focus param if present; otherwise, omit.
      const focusId = normalizeLineId(getUrlStringParam('focus'));
      if (!focusId || focusId === 'all') url.searchParams.delete('focus');

      const text = url.toString();

      try {
        await navigator.clipboard.writeText(text);
        setNetStatus({ kind: 'ok', text: 'Link copied' });
      } catch {
        // Fallback: prompt-based copy.
        window.prompt('Copy link:', text);
      }
    });
  }

  // Initialize pause UI on load.
  updateSimUi();
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;

  // FPS controls now use: S=forward, W=fast-forward, X=backward, A=left, D=right
  // Arrow keys = look direction
  // These are handled in updateFpsControls() above

  // Non-conflicting shortcuts (letters not used by FPS controls)
  if (e.key === 'v' || e.key === 'V') {
    setVictoriaStationsVisible(!victoriaStationsVisible);
    const stCb = document.getElementById('victoriaStations');
    if (stCb) stCb.checked = victoriaStationsVisible;
  }
  if (e.key === 'l' || e.key === 'L') {
    setVictoriaLabelsVisible(!victoriaLabelsVisible);
    const lbCb = document.getElementById('victoriaLabels');
    if (lbCb) lbCb.checked = victoriaLabelsVisible;
  }
  // Shafts toggle moved to Shift+S (conflicts with S=forward)
  if ((e.key === 's' || e.key === 'S') && e.shiftKey) {
    setVictoriaShaftsVisible(!victoriaShaftsVisible);
    const shCb = document.getElementById('victoriaShafts');
    if (shCb) shCb.checked = victoriaShaftsVisible;
  }
  // Reset view to curated straight-down position
  if (e.key === 'r' || e.key === 'R') {
    camera.position.copy(INITIAL_VIEW.position);
    controls.target.copy(INITIAL_VIEW.target);
    controls.update();
  }
  if (e.key === 'f' || e.key === 'F') {
    // Cycle through lines in the solo dropdown
    const soloSelect = document.getElementById('soloLine');
    if (soloSelect) {
      const options = Array.from(soloSelect.options).filter(o => !o.disabled);
      const curIdx = options.findIndex(o => o.value === soloSelect.value);
      const nextIdx = (curIdx + 1) % options.length;
      soloSelect.value = options[nextIdx].value;
      applySoloSelection(soloSelect.value);
      if (soloSelect.value === 'all') deleteUrlParam('focus');
      else setUrlParam('focus', soloSelect.value);
      updateSimUi();
    }
  }
  // Focus all moved to Shift+A (conflicts with A=left movement)
  if ((e.key === 'a' || e.key === 'A') && e.shiftKey) {
    // Reset to all lines
    applySoloSelection('all');
    const soloSelect = document.getElementById('soloLine');
    if (soloSelect) soloSelect.value = 'all';
    deleteUrlParam('focus');
    updateSimUi();
    const pts = [];
    for (const [lineId, group] of lineGroups.entries()) {
      if (!group?.visible) continue;
      const cps = lineCenterPoints.get(lineId);
      if (cps && cps.length) pts.push(...cps);
    }
    focusCameraOnStations({ stations: pts.map(pos => ({ pos })), controls, camera, pad: 1.18 });
  }
  if (e.key === ' ' || e.code === 'Space') {
    // Pause/resume the simulation.
    e.preventDefault();
    toggleSimPaused();
  }

  // Help overlay toggle
  if (e.key === '?' || e.key === '/' || e.key.toLowerCase() === 'h') {
    const helpOverlay = document.getElementById('helpOverlay');
    if (helpOverlay) {
      helpOverlay.classList.toggle('visible');
    }
  }
  if (e.key === 'Escape') {
    const helpOverlay = document.getElementById('helpOverlay');
    if (helpOverlay) {
      helpOverlay.classList.remove('visible');
    }
  }
});

// ---------- Animate ----------
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();

  // Update FPS controls before orbit controls (keyboard takes precedence)
  updateFpsControls(dt);

  // Re-enable OrbitControls when not using FPS controls
  if (!fpsControls.active && !controls.enabled) {
    controls.enabled = true;
    // Sync controls target with current camera direction
    const lookDistance = 1000; // default look distance
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    controls.target.copy(camera.position).add(forward.multiplyScalar(lookDistance));
  }

  controls.update();

  const simDt = sim.paused ? 0 : (dt * sim.timeScale);
  for (const train of sim.trains) {
    // dwell at stations
    if (train.userData._pausedLeft > 0) {
      train.userData._pausedLeft = Math.max(0, train.userData._pausedLeft - simDt);
      continue;
    }

    const du = (train.userData.cruiseMps * simDt) / Math.max(1e-6, train.userData.curveLengthM);
    let u = train.userData.t + train.userData.dir * du;

    // wrap
    if (u >= 1) u -= 1;
    if (u < 0) u += 1;

    // station arrival detection (very simple): if we crossed the next station u.
    const stations = train.userData.stationUs;
    if (stations.length > 0) {
      const idx = train.userData.nextStationIndex;
      const targetU = stations[idx];

      const prevU = train.userData.t;
      const crossed = train.userData.dir === 1
        ? (prevU <= targetU && u >= targetU) || (prevU > u && (u >= targetU || prevU <= targetU))
        : (prevU >= targetU && u <= targetU) || (prevU < u && (u <= targetU || prevU >= targetU));

      if (crossed) {
        u = targetU;
        train.userData._pausedLeft = train.userData.dwellSec;
        // advance station index
        if (train.userData.dir === 1) {
          train.userData.nextStationIndex = (idx + 1) % stations.length;
        } else {
          train.userData.nextStationIndex = (idx - 1 + stations.length) % stations.length;
        }
      }
    }

    train.userData.t = u;
    train.position.copy(train.userData.curve.getPointAt(u));
  }

  // Update station label projections for ALL lines
  let updateCallCount = 0;
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.stationsLayer?.update) {
      layers.stationsLayer.update({ camera, renderer });
      updateCallCount++;
    }
  }
  if (updateCallCount === 0 && lineShaftLayers.size > 0) {
    // Station updates skipped
  }

  // Update environment based on camera height (sky/fog/background)
  if (skyDome) {
    updateEnvironment(camera, scene, skyDome, renderer);
  }
  
  // Update lighting based on camera position
  updateLighting(camera, atmosphereLights);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
