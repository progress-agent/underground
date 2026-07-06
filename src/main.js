import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import proj4 from 'proj4';
import { fetchRouteSequence, fetchBundledRouteSequenceIndex, fetchTubeLines } from './tfl.js';
import { loadStationDepthAnchors, depthForStation, debugDepthStats, buildDepthInterpolator } from './depth.js';
import { tryCreateTerrainMesh, xzToTerrainUV, terrainHeightToWorldY, getTerrainSurfaceY, getTerrainMeshSurfaceY, TERRAIN_CONFIG, VERTICAL_EXAGGERATION } from './terrain.js';
import { createSkyDome, updateEnvironment, createAtmosphere, updateLighting } from './environment.js';
import { createStationMarkers, cleanStationName } from './stations.js';
import { createUnifiedShafts } from './shafts.js';
import { registerStationForShafts, getShaftRegistry } from './shaft-registry.js';
import { loadThamesData, createThamesVolume, WATER_LEVEL_M } from './thames.js';
import { loadM25Data, generateM25Mask, applyM25Mask, createM25Road, createThamesWaterfalls, initM25Boundary, isInsideM25, sampleM25Insideness } from './m25.js';
import { loadTidewayData, createTidewaySystem, addTidewayToLegend, snapTidewayShaftsToTerrain } from './tideway.js';
import { loadCrossrailData, createCrossrailTunnel, addCrossrailToLegend } from './crossrail.js';
import { createGeologicalStrata, addGeologyToLegend, getChalkSurfaceY, CHALK_TOP_Y } from './geology.js';
import { loadReservoirData, createReservoirs, addReservoirsToLegend } from './reservoirs.js';
import { loadCanalData, createCanals, addCanalsToLegend } from './canals.js';
import { loadSewerData, createSewerTunnels, addSewersToLegend } from './sewers.js';
import { lookupInfraMeta, lookupLineMeta } from './infra-meta.js';
import { createTrainSystem, createTrains, updateTrains, disposeTrains } from './trains.js';
import { createSurfaceTexture, rasteriseTile, applySurfaceTexture, setSurfaceTextureEnabled, sceneBBoxToUVBounds } from './surface-texture.js';
import { createTileBuildings, disposeTileGeometry, setSurfaceGeometryVisible } from './surface-geometry.js';
import { initSurfaceLoader, updateSurfaceLoader, getFullSceneBBox, makeTileDedup, getSurfaceLoaderStats } from './surface-loader.js';
import { initThamesMask, isInThames } from './thames-mask.js';
import { initThamesZones, getZoneAt, nearestThamesSegment } from './thames-zones.js';
import { RENDER_ORDER } from './render-layers.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createLensSystem } from './lens.js';
import { initAudio, updateAudio, setMasterVolume, setMuted, setTabVisible, isAudioReady, initSpatialSources } from './audio.js';
import { createIntro } from './intro.js';
import { initIntroTuner } from './intro-tuner.js';
import { initLandscapeLock } from './landscape-lock.js';
import { initControlsGuide } from './controls-guide.js';
import { initCushionLuma, sampleCushion, resetCushion, _cushionState } from './cushion-luma.js';
import { initReadout } from './readout.js';

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

// Boot-log gate: verbose "X added to scene" style logs only when ?debug=1
const __ugDebugEnabled = new URLSearchParams(location.search).get('debug') === '1';
function dbg(...args) {
  if (__ugDebugEnabled) console.log(...args);
}

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
// #compass and #altimeter replaced by src/readout.js module

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Filmic tone mapping (applied by OutputPass at the end of the composer
// chain — scene renders linear HDR into the HalfFloat target). AgX chosen
// over ACES after A/B: preserves the warm terracotta/gold identity and
// ceiling detail underground where ACES crushes mids to black.
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.15;
// Use a lighter background so scene is visible even if nothing renders
renderer.setClearColor(0x1a1a2e, 1);
app.appendChild(renderer.domElement);
// On mobile browsers, allow OrbitControls to handle gestures without the page
// also panning/zooming.
renderer.domElement.style.touchAction = 'none';
renderer.domElement.style.webkitTapHighlightColor = 'transparent';

// Per-tooltip framebuffer luma sampler — drives `.cushion-light` polarity
// on `#hoverTip` so the Halo cushion adapts to the scene under each hover.
initCushionLuma(renderer);

const scene = new THREE.Scene();
// Re-enabled fog with lighter color for better above-ground visibility
scene.fog = new THREE.Fog(0x1a2a3a, 800, 20000);

// ── Bloom post-processing (makes headlight beams glow) ──
// EffectComposer's default render target is single-sampled, so
// renderer's antialias:true flag never reaches the screen once RenderPass
// draws into it. Build the target explicitly with samples:4 (MSAA) so
// geometry edges are anti-aliased before bloom/output passes run.
const composerPixelRatio = renderer.getPixelRatio();
const composerRenderTarget = new THREE.WebGLRenderTarget(
  window.innerWidth * composerPixelRatio,
  window.innerHeight * composerPixelRatio,
  { samples: 4, type: THREE.HalfFloatType }
);
const composer = new EffectComposer(renderer, composerRenderTarget);
// RenderPass and camera added after camera creation (below)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1.0, 50000);
// Street-level view looking across central London
const INITIAL_VIEW = {
  position: new THREE.Vector3(-200, 85, 400),   // Above terrain (central London ground ≈ Y=75 at VE=5)
  target: new THREE.Vector3(0, 20, 0)            // Looking slightly down into the network
};
camera.position.copy(INITIAL_VIEW.position);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(INITIAL_VIEW.target);
controls.minDistance = 10;
controls.maxDistance = 40000;
// Lock controls during initial load to prevent accidental movement
controls.enabled = false;

// Mobile touch v1 — D-001 §4.
// - 1 finger: pan (move across the map)
// - 2 fingers: pinch to dolly, twist to rotate
// OrbitControls' `touches` config cannot express full Google-Earth vocabulary
// (no parallel-drag pitch, no 3-finger altitude); that's v2 via a bespoke
// Pointer-Events layer. This config ships a viable mobile experience for the
// personal/friends audience.
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.touches = {
  ONE: THREE.TOUCH.PAN,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};

// D-002 chalk slowdown base speeds. Zoom/pan are scaled by substrateSpeedFactor
// per-frame in tick() so mouse users feel the same drag as keyboard flight.
// Captured ONCE (never compounded) — the tick multiplies base × factor.
const _baseZoomSpeed = controls.zoomSpeed;
const _basePanSpeed = controls.panSpeed;

// ── Finish EffectComposer setup now that camera exists ──
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55,  // strength — moderate, let window brightness drive the glow
  0.4,   // radius — moderate spread for warm halo
  0.88   // threshold — catch amber windows, not terrain/stations
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ── Lens character simulation (barrel distortion, CA, vignette) ──
const lensSystem = createLensSystem(camera, composer, controls);

// ── Train system (shared state) ──
const trainSystem = createTrainSystem({ scene, renderer, camera });

// ── Audio — autoplay gesture ──
// AudioContext requires a user gesture to start. Piggyback on first interaction.
{
  let audioStarted = false;
  function tryStartAudio() {
    if (audioStarted) return;
    audioStarted = true;
    initAudio(camera);
    document.removeEventListener('click', tryStartAudio);
    document.removeEventListener('keydown', tryStartAudio);
    document.removeEventListener('pointerdown', tryStartAudio);
  }
  document.addEventListener('click', tryStartAudio, { once: false });
  document.addEventListener('keydown', tryStartAudio, { once: false });
  document.addEventListener('pointerdown', tryStartAudio, { once: false });
}

// ── Tab visibility — fade audio when backgrounded ──
document.addEventListener('visibilitychange', () => {
  setTabVisible(!document.hidden);
});

// ---------- FPS-style Keyboard Controls ----------
// WASD translate + Q/E vertical + arrow keys rotate. Shift-hold OR the HUD
// flight toggle multiplies speed by sprintMultiplier (3×).
const fpsControls = {
  enabled: true,
  moveSpeed: 500.0,          // base movement speed (units/sec)
  sprintMultiplier: 3.0,     // Shift-hold or HUD flight toggle
  flightToggle: false,       // latching 3× toggle, mirrors Shift
  rotateSpeed: 1.0,          // arrow key rotation speed (rad/sec)
  keys: new Set(),           // currently pressed keys (lowercase .key)
  active: false,             // true when any movement key is held
};

// Hoisted scratch for updateFpsControls — zero per-frame allocation while a
// movement key is held (was 4×Vector3 + Euler + quaternion clone per frame).
const _fwd = new THREE.Vector3();
const _fwdXZ = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rotFwd = new THREE.Vector3();
const _surfQuery = { x: 0, z: 0 }; // reused arg for getTerrainMeshSurfaceY

// D-002 substrate speed multiplier — applied in the movement funnel. Default
// 1.0 (no effect); a later wave (chalk slowdown) drives it via window.__ug.
let substrateSpeedFactor = 1.0;

// Left-button (ROTATE) drag flag. r161 OrbitControls has no getState(); we
// track the drag locally. Set on a capture-phase left pointerdown (before
// OrbitControls dispatches 'start'), cleared on pointerup/cancel/blur.
// Consumed by the rotate re-pivot (gate) and the hover cascade (skip mid-drag).
let _dragActive = false;

// Rising-edge tracker for the fps damping handover (see tick()).
let _fpsWasActive = false;

window.addEventListener('keydown', (e) => {
  fpsControls.keys.add(e.key.toLowerCase());
});

window.addEventListener('keyup', (e) => {
  fpsControls.keys.delete(e.key.toLowerCase());
});

// Clear stuck keys when window loses focus (prevents runaway movement on
// cmd-tab away mid-hold — a keyup may never fire in that case).
window.addEventListener('blur', () => {
  fpsControls.keys.clear();
});

// Prevent default scrolling for control keys
window.addEventListener('keydown', (e) => {
  const controlKeys = ['s', 'w', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  if (controlKeys.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
}, { passive: false });

function updateFpsControls(dt) {
  if (!fpsControls.enabled) return;

  const keys = fpsControls.keys;
  const hasFpsKey = ['w', 's', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
    .some(k => keys.has(k));

  fpsControls.active = hasFpsKey;

  if (!hasFpsKey) return;

  // Disable OrbitControls while using FPS controls to prevent fighting
  controls.enabled = false;

  const moveSpeed = fpsControls.moveSpeed;
  const sprinting = keys.has('shift') || fpsControls.flightToggle;
  const speedMult = sprinting ? fpsControls.sprintMultiplier : 1.0;

  // D-002 speed regimes (design LOCKED). Above ground, horizontal reach scales
  // with real altitude (0.3×–20× of base) so low flying is precise and high
  // flying covers ground fast. Below ground, constant base (no depth scaling) —
  // chalk slowdown will later come via substrateSpeedFactor. surfaceY===null
  // (terrain not yet loaded, or outside the mesh) falls to the constant base.
  _surfQuery.x = camera.position.x;
  _surfQuery.z = camera.position.z;
  const surfaceY = getTerrainMeshSurfaceY(_surfQuery);
  let regimeSpeed = moveSpeed;
  if (surfaceY !== null && camera.position.y >= surfaceY) {
    const alt = (camera.position.y - surfaceY) / VERTICAL_EXAGGERATION; // real m
    regimeSpeed = moveSpeed * THREE.MathUtils.clamp(alt / 500, 0.3, 20);
  }
  const effectiveSpeed = regimeSpeed * speedMult * substrateSpeedFactor;

  // Get camera's current forward direction (from camera matrix)
  camera.getWorldDirection(_fwd);

  // Project forward onto XZ plane for movement (keep Y separate)
  _fwdXZ.set(_fwd.x, 0, _fwd.z).normalize();

  // Right vector is perpendicular to forward in XZ plane
  _right.set(-_fwd.z, 0, _fwd.x).normalize();

  // Calculate movement direction (standard FPS convention: W forward, S back)
  _moveDir.set(0, 0, 0);
  if (keys.has('w')) _moveDir.add(_fwdXZ);
  if (keys.has('s')) _moveDir.sub(_fwdXZ);
  if (keys.has('a')) _moveDir.sub(_right);
  if (keys.has('d')) _moveDir.add(_right);
  if (keys.has('e')) _moveDir.y += 1;
  if (keys.has('q')) _moveDir.y -= 1;

  // Apply movement — translate-together preserves controls offset invariant
  // so minDistance/maxDistance/polar clamps survive (see
  // _REPORTS/24Apr26f/sources/consult-0109/loopback-gemini-target.md §3).
  if (_moveDir.lengthSq() > 0) {
    _moveDir.normalize();
    // Single funnel for all speed (regime × sprint × substrate).
    const displacement = _moveDir.multiplyScalar(effectiveSpeed * dt);
    // Vertical (Q/E) scaled by 0.5×VE=2.5 so real vertical speed is half of
    // real horizontal speed (Y has VE=5, so /5 gives real metres).
    displacement.y *= 2.5;
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
    // Get current rotation (reuse hoisted Euler; no quaternion clone)
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');

    // Apply yaw (Y axis rotation)
    _euler.y += yaw;

    // Apply pitch (X axis rotation) with clamping
    _euler.x = THREE.MathUtils.clamp(_euler.x + pitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);

    // Set new rotation
    camera.quaternion.setFromEuler(_euler);

    // Update OrbitControls target to match new look direction
    const lookDistance = camera.position.distanceTo(controls.target);
    _rotFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).add(_rotFwd.multiplyScalar(lookDistance));
  }
}

// ---------- HUD 3× flight toggle (latching, mirrors Shift-hold) ----------
{
  const btn = document.getElementById('flightSprint');
  if (btn) {
    const render = () => {
      const on = fpsControls.flightToggle;
      btn.textContent = `Fast flight: ${on ? 'on' : 'off'}`;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.style.background = on ? 'rgba(201,184,150,0.22)' : 'rgba(255,255,255,0.06)';
      btn.style.borderColor = on ? 'rgba(201,184,150,0.55)' : 'rgba(255,255,255,0.14)';
      btn.style.color = on ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.88)';
    };
    btn.addEventListener('click', () => {
      fpsControls.flightToggle = !fpsControls.flightToggle;
      render();
    });
    render();
  }
}

// ---------- OrbitControls ROTATE-start re-pivot ----------
// When the user begins a rotate drag, adopt whatever is under the pointer as
// the new pivot. Preserves offset by translating camera.position by the same
// delta as controls.target — no visual jump (Cesium/Mapbox pattern).
// See _REPORTS/24Apr26f/sources/consult-0109/loopback-gemini-target.md §6.
{
  const repivotRaycaster = new THREE.Raycaster();
  const lastNdc = new THREE.Vector2(0, 0);
  let haveNdc = false;

  const updateNdcFromEvent = (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const rawX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const rawY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    // Lens distortion maps screen NDC to framebuffer NDC — raycast against
    // what the user sees, not the undistorted pixel.
    const corrected = lensSystem?.distortNdc
      ? lensSystem.distortNdc(rawX, rawY)
      : { x: rawX, y: rawY };
    lastNdc.set(corrected.x, corrected.y);
    haveNdc = true;
  };
  renderer.domElement.addEventListener('pointerdown', updateNdcFromEvent);
  renderer.domElement.addEventListener('pointermove', updateNdcFromEvent);

  // Track left-button drag state locally (r161 has no controls.getState()).
  // Capture phase so the flag is set BEFORE OrbitControls' own bubble-phase
  // pointerdown handler fires and dispatches its synchronous 'start' event —
  // otherwise the re-pivot handler below would read a stale (false) flag.
  // button 0 === controls.mouseButtons.LEFT === THREE.MOUSE.ROTATE. Restrict
  // to pointerType 'mouse' so a touch pinch/pan (whose pointerdown also reports
  // button 0) does not spuriously re-pivot — the previous getState() gate was
  // dead code, so this behaviour is entirely new and must not regress touch.
  controls.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button === 0 && ev.pointerType === 'mouse') _dragActive = true;
  }, true);
  const clearDrag = () => { _dragActive = false; };
  window.addEventListener('pointerup', clearDrag, true);
  window.addEventListener('pointercancel', clearDrag, true);
  window.addEventListener('blur', clearDrag);

  // Candidate targets: terrain first (broad, reliable hit), then surface
  // buildings, then line tubes. Stations/shafts/infra are fine fallbacks but
  // terrain+buildings cover ~all visible frames.
  const collectRepivotTargets = () => {
    const targets = [];
    if (terrain?.mesh) targets.push(terrain.mesh);
    if (terrain?.undersideMesh) targets.push(terrain.undersideMesh);
    if (surfaceGeometryGroup) {
      surfaceGeometryGroup.traverse(obj => {
        if (obj.isMesh || obj.isInstancedMesh) targets.push(obj);
      });
    }
    for (const m of linePickables) targets.push(m);
    return targets;
  };

  controls.addEventListener('start', () => {
    // Only re-pivot on a left-button ROTATE drag. r161 OrbitControls exposes no
    // getState(); _dragActive is set true only for button 0 (LEFT === ROTATE),
    // so a middle/right dolly or pan leaves it false and preserves the pivot.
    if (!_dragActive) return;
    if (!haveNdc) return;
    if (intro.isRunning?.()) return;

    const targets = collectRepivotTargets();
    if (targets.length === 0) return;

    repivotRaycaster.setFromCamera(lastNdc, camera);
    const hits = repivotRaycaster.intersectObjects(targets, true);
    if (!hits || hits.length === 0) return;

    // Translate both camera and target by the same delta → offset preserved,
    // no spherical discontinuity, no clamp violation.
    const delta = hits[0].point.clone().sub(controls.target);
    if (delta.lengthSq() < 1e-6) return;
    controls.target.add(delta);
    camera.position.add(delta);
  });
}

// ---------- Landscape lock (Week-1 Step 3) ----------
// Portrait + narrow viewport → full-screen rotate-device overlay. iOS Safari
// silently rejects screen.orientation.lock(), so CSS + matchMedia is the
// load-bearing path.
const landscapeLock = initLandscapeLock();

// ---------- Control-guide widget (D-003) ----------
// Round 4 widget — typographic-grid keys, glow-on-press, timed caption fade,
// "Hold shift to go faster" reveal. Self-contained — fires on ug:intro-done.
// Click/touch dispatches synthetic KeyboardEvents so the existing window
// keydown handler drives fpsControls.keys.
const controlsGuide = initControlsGuide();
const readout = initReadout();

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
const urlHorizontalScale = getUrlNumberParam('hx');

// Optional: pre-focus camera on a line id (e.g. ?focus=victoria)
const urlFocusLine = getUrlStringParam('focus');

const sim = {
  trains: [],
  paused: prefs.paused ?? false,
  // 1 = real-time, >1 = sped up
  timeScale: urlTimeScale ?? (prefs.timeScale ?? 8),
  verticalScale: VERTICAL_EXAGGERATION,
  horizontalScale: urlHorizontalScale ?? (prefs.horizontalScale ?? 1.0),
};

// Persist current values back to prefs so the next load (without URL params)
// uses the last-seen settings.
prefs.timeScale = sim.timeScale;
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

  // ── Focal length slider ──
  const flEl = document.getElementById('focalLength');
  const flOut = document.getElementById('focalLengthValue');
  const initialFl = getUrlNumberParam('fl') ?? prefs.focalLength ?? 30;
  if (flEl) {
    flEl.value = String(initialFl);
    if (flOut) flOut.textContent = `${initialFl}mm`;
    lensSystem.setFocalLength(initialFl);

    flEl.addEventListener('input', () => {
      const mm = Number(flEl.value) || 30;
      lensSystem.setFocalLength(mm);
      prefs.focalLength = mm;
      savePrefs(prefs);
      if (flOut) flOut.textContent = `${mm}mm`;
    });

    flEl.addEventListener('change', () => {
      const mm = Number(flEl.value) || 30;
      if (mm === 30) deleteUrlParam('fl');
      else setUrlParam('fl', mm);
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

// ---------- Thames (flat-level 3D volume) ----------
let thamesMesh = null;
const thamesDataPromise = loadThamesData();

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
  
  // Thames data must load before terrain so we can carve the river valley
  thamesDataPromise.then(thamesData => {
    tryCreateTerrainMesh({ opacity: 1.0, wireframe: false, thamesData }).then(result => {
      if (!result) {
        grid.visible = true;
        return;
      }
      terrain = result;
      scene.add(result.mesh);
      if (result.undersideMesh) scene.add(result.undersideMesh);
      if (result.contourLines) scene.add(result.contourLines);

      // Reposition tubes + stations to terrain-relative depth, then snap shafts.
      snapAllTubesToTerrain();
      snapAllShaftsToTerrain();
      snapTidewayShaftsToTerrain(getTerrainMeshSurfaceY);

      // Build Thames 3D volume (flat water level, no terrain sampling needed)
      if (thamesData) {
        thamesMesh = createThamesVolume(thamesData, getTerrainMeshSurfaceY, {
          color: 0x1a3d5c,
          opacity: 0.45,
        });
        if (thamesMesh) {
          scene.add(thamesMesh);
        }
        // Initialise Thames river corridor mask for building exclusion
        if (thamesData.points) {
          initThamesMask(thamesData.points);
          // Init zone segments for hover-tooltip nearest-segment lookup
          initThamesZones(thamesData.points);
        }

        // Register spatial audio sources (trains added dynamically, Thames static)
        initSpatialSources({
          trainSystem,
          thamesPoints: thamesData.points,
        });
      }

      // Reservoirs — data fetch started at module scope, create now that terrain is ready
      reservoirDataPromise.then(data => {
        if (data) {
          reservoirsMesh = createReservoirs(data, llToXZ, getTerrainMeshSurfaceY);
          if (reservoirsMesh) {
            scene.add(reservoirsMesh);
            addReservoirsToLegend();
            dbg('Reservoirs added to scene');
          }
        }
      });

      // Canals — data fetch started at module scope, create now that terrain is ready
      canalDataPromise.then(data => {
        if (data) {
          canalsMesh = createCanals(data, llToXZ, getTerrainMeshSurfaceY);
          if (canalsMesh) {
            scene.add(canalsMesh);
            addCanalsToLegend();
            dbg('Canals added to scene');
          }
        }
      });

      // Apply M25 world boundary: mask terrain, add road ring + cliff pillar
      m25DataPromise.then(m25Data => {
        if (!m25Data?.points?.length) return;

        // Generate mask and apply to both terrain materials
        const maskTex = generateM25Mask(m25Data.points);
        if (result.topMat) applyM25Mask(result.topMat, maskTex);
        if (result.undersideMat) applyM25Mask(result.undersideMat, maskTex);

        // Chalk floor — build now that the M25 ring is available (rim-flatten),
        // then clip it with the same mask as the terrain (same UV→world map).
        geologyGroup = createGeologicalStrata(m25Data.points, sim.verticalScale);
        if (geologyGroup) {
          scene.add(geologyGroup);
          if (geologyGroup.userData.chalkMat) applyM25Mask(geologyGroup.userData.chalkMat, maskTex);
          addGeologyToLegend();
          dbg('Chalk floor added to scene');
        }

        // M25 road ring
        m25Road = createM25Road(m25Data.points, getTerrainMeshSurfaceY);
        if (m25Road) scene.add(m25Road);

        // Thames waterfalls at disc edge (needs both Thames and M25 data)
        if (thamesData?.points?.length) {
          const waterfalls = createThamesWaterfalls(thamesData.points, m25Data.points, getTerrainMeshSurfaceY);
          if (waterfalls) scene.add(waterfalls);
        }

        dbg('M25 world boundary applied');

        // ── Surface features: tiled progressive loading ──
        // Create parent group for per-tile building meshes
        surfaceGeometryGroup = new THREE.Group();
        surfaceGeometryGroup.name = 'surfaceGeometry';
        surfaceGeometryGroup.visible = true; // hybrid surface on by default
        scene.add(surfaceGeometryGroup);

        initSurfaceLoader({
          onTileLoaded: (tileData, tileEntry) => {
            // Rasterise parks + roads into persistent full-map texture
            if (surfaceTexState) {
              rasteriseTile(surfaceTexState, tileData);
            }
            // Filter buildings: M25 boundary + Thames river corridor exclusion
            const filteredBuildings = tileData.buildings
              ? tileData.buildings.filter(b => isInsideM25(b.cx, b.cz) && !isInThames(b.cx, b.cz))
              : [];
            // Create buildings as InstancedMesh for this tile
            const mesh = createTileBuildings(
              filteredBuildings, getTerrainMeshSurfaceY,
              VERTICAL_EXAGGERATION, makeTileDedup(tileEntry.file)
            );
            if (mesh) {
              mesh.name = `buildings-${tileEntry.file}`;
              surfaceGeometryGroup.add(mesh);
            }
          },
          onTileDisposed: (tileEntry) => {
            // Remove tile's building mesh from scene
            const meshName = `buildings-${tileEntry.file}`;
            const mesh = surfaceGeometryGroup.getObjectByName(meshName);
            if (mesh) {
              surfaceGeometryGroup.remove(mesh);
              disposeTileGeometry(mesh);
            }
          },
        }).then(manifest => {
          const fullBBox = getFullSceneBBox();

          // Create persistent 4096² texture spanning full M25 area
          surfaceTexState = createSurfaceTexture(fullBBox, 4096);

          // Inject surface shader into terrain material (chains after M25 mask)
          if (result.topMat) {
            const uvBounds = sceneBBoxToUVBounds(fullBBox);
            applySurfaceTexture(result.topMat, surfaceTexState.texture, uvBounds);
            setSurfaceTextureEnabled(result.topMat, true); // hybrid surface on by default
            surfaceTextureMaterial = result.topMat;
          }

          surfaceDataLoaded = true;
          dbg(`Surface loader ready: ${manifest.tiles.length} tiles, ${manifest.cols}×${manifest.rows} grid`);
        }).catch(err => console.warn('Surface loader failed:', err.message));
      });
    });
  });
  
  // Legacy surface plane removed — terrain mesh provides surface visual at full opacity
}

// Helper: snap all line shafts to current terrain height (module-scoped
// so it's accessible from both the terrain .then() callback and the
// per-line shaft loading code).
function snapAllShaftsToTerrain() {
  if (unifiedShaftLayer) {
    unifiedShaftLayer.updateGroundYPositions(getTerrainMeshSurfaceY);
  }
}

// Snap all tube centerPts, geometry, stations, and shaft platformY to terrain surface.
// Called once after terrain loads so that depth is terrain-relative, not sea-level-relative.
function snapAllTubesToTerrain() {
  if (!terrain) return;
  let snappedTubes = 0;
  let snappedStations = 0;

  // 4a. Update centerPt Y values to terrain-relative depth
  for (const [lineId, branches] of lineBranchCenterPts) {
    for (const branchPts of branches) {
      for (const pt of branchPts) {
        const surfaceY = getTerrainMeshSurfaceY({ x: pt.x, z: pt.z });
        if (surfaceY !== null) {
          pt.y = surfaceY - (pt._depthM ?? 0) * sim.verticalScale;
        }
      }
    }
  }

  // 4a-ii. River-clearance clamp: ensure tubes pass below water surface
  const VE = sim.verticalScale;
  const MIN_RIVER_CLEARANCE_M = 8; // metres below water surface
  const waterY = WATER_LEVEL_M * VE;
  const minRiverY = waterY - MIN_RIVER_CLEARANCE_M * VE;

  for (const [lineId, branches] of lineBranchCenterPts) {
    for (const branchPts of branches) {
      for (const pt of branchPts) {
        const surfaceY = getTerrainMeshSurfaceY({ x: pt.x, z: pt.z });
        // If terrain surface is at or below water level, this point is over the river
        if (surfaceY !== null && surfaceY <= waterY) {
          pt.y = Math.min(pt.y, minRiverY);
        }
      }
    }
  }

  // 4a-iii. Synthetic mid-river control points: prevent CatmullRom arcing above water
  for (const [lineId, branches] of lineBranchCenterPts) {
    for (const branchPts of branches) {
      for (let i = branchPts.length - 2; i >= 0; i--) {
        const a = branchPts[i];
        const b = branchPts[i + 1];
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const midSurfaceY = getTerrainMeshSurfaceY({ x: midX, z: midZ });

        // Only act if the midpoint is over the river
        if (midSurfaceY === null || midSurfaceY > waterY) continue;

        // Check if linear interpolation between a and b would sit above clearance
        const midLerpY = (a.y + b.y) / 2;
        if (midLerpY <= minRiverY) continue;

        // Splice in a synthetic control point clamped below water
        const synPt = new THREE.Vector3(midX, minRiverY, midZ);
        synPt._depthM = MIN_RIVER_CLEARANCE_M;
        synPt._synthetic = true;
        branchPts.splice(i + 1, 0, synPt);
      }
    }
  }

  // 4b. Rebuild tube geometry for each line
  for (const [lineId, branches] of lineBranchCenterPts) {
    const group = lineGroups.get(lineId);
    if (!group) continue;
    const colour = lineColoursById.get(lineId) ?? 0xffffff;

    // Remove old tube meshes and train groups from scene group
    const toRemove = [];
    for (const child of [...group.children]) {
      if (child === group) continue;
      toRemove.push(child);
    }
    // Dispose old trains via train system before removing
    const oldTrains = toRemove.filter(c => c.isGroup && c.userData.lineId);
    if (oldTrains.length > 0) disposeTrains(trainSystem, oldTrains);
    for (const obj of toRemove) {
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    // Remove old entries from linePickables
    const oldMeshes = lineMeshesById.get(lineId) || [];
    for (const m of oldMeshes) {
      const idx = linePickables.indexOf(m);
      if (idx >= 0) linePickables.splice(idx, 1);
    }

    // Remove old trains for this line from sim.trains
    sim.trains = sim.trains.filter(t => {
      if (t.parent === group) return false;
      return true;
    });

    // Rebuild per branch
    const newMeshes = [];
    const mergedCenterPts = [];

    for (const centerPts of branches) {
      if (centerPts.length < 2) continue;
      mergedCenterPts.push(...centerPts);

      const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);
      const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, twinTunnelsEnabled ? tunnelOffsetM : 0);

      const segs = Math.max(80, centerPts.length * 10);
      const radius = 4.5;

      const leftMesh = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
      const rightMesh = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
      leftMesh.userData.lineId = lineId;
      rightMesh.userData.lineId = lineId;
      leftMesh.userData.type = 'tube-line';
      rightMesh.userData.type = 'tube-line';
      leftMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
      rightMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;

      newMeshes.push(leftMesh, rightMesh);
      linePickables.push(leftMesh, rightMesh);
      group.add(leftMesh, rightMesh);

      // Recreate trains on new curves (density scales with track length)
      const branchTrains = createTrains({ system: trainSystem, leftCurve, rightCurve, stationUs, lineId, colour, group });
      sim.trains.push(...branchTrains);
      snappedTubes++;
    }

    lineMeshesById.set(lineId, newMeshes);
    lineCenterPoints.set(lineId, mergedCenterPts);
  }

  // 4c. Update station markers (terrain-relative depth + surfaceY for labels)
  for (const [lineId, layers] of lineShaftLayers) {
    if (!layers.stationsLayer?.stations) continue;
    const stations = layers.stationsLayer.stations;

    for (const st of stations) {
      if (st.depthM == null) continue;
      const surfaceY = getTerrainMeshSurfaceY({ x: st.pos.x, z: st.pos.z });
      if (surfaceY !== null) {
        st.pos.y = surfaceY - st.depthM * sim.verticalScale;
        st.surfaceY = surfaceY;
      }
    }

    // Rebuild InstancedMesh matrices with updated positions
    const mesh = layers.stationsLayer.mesh;
    if (mesh) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < stations.length; i++) {
        dummy.position.copy(stations[i].pos);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    snappedStations += stations.length;
  }

  // 4d. Update unified shaft platformY from updated centerPts
  if (unifiedShaftLayer) {
    unifiedShaftLayer.updatePlatformYPositions(lineCenterPoints);
  }

  dbg(`snapAllTubesToTerrain: ${snappedTubes} tube branches, ${snappedStations} stations repositioned to terrain-relative depth`);
}

// ---------- M25 world boundary ----------
let m25Road = null;
const m25DataPromise = loadM25Data();
m25DataPromise.then(data => {
  if (data?.points?.length) initM25Boundary(data.points);
});

// ---------- Surface features (tiled progressive loading) ----------
let surfaceGeometryGroup = null;  // Parent group for per-tile building InstancedMeshes
let surfaceTextureMaterial = null; // Terrain material ref for texture toggle
let surfaceTexState = null;       // { texture, pixels, size, bbox } from createSurfaceTexture
let surfaceDataLoaded = false;

// Module-scoped function assigned inside buildNetworkMvp (needs cross-block access)
let applySoloSelection = () => {};

// ---------- Tideway + Lee Tunnel (Super Sewer system) ----------
let tidewayMesh = null;
loadTidewayData().then(tidewayData => {
  if (tidewayData) {
    tidewayMesh = createTidewaySystem(tidewayData, llToXZ, sim.verticalScale);
    if (tidewayMesh) {
      scene.add(tidewayMesh);
      addTidewayToLegend();
      if (terrain) snapTidewayShaftsToTerrain(getTerrainMeshSurfaceY);
      dbg('Tideway + Lee Tunnel system added to scene');
    }
  }
});

// ---------- Crossrail/Elizabeth Line (deep rail infrastructure) ----------
let crossrailMesh = null;
loadCrossrailData().then(crossrailData => {
  if (crossrailData) {
    crossrailMesh = createCrossrailTunnel(crossrailData, llToXZ, sim.verticalScale);
    if (crossrailMesh) {
      scene.add(crossrailMesh);
      addCrossrailToLegend();
      dbg('Crossrail added to scene');
    }
  }
});

// ---------- Geological Strata (London Clay & Chalk bedrock) ----------
// Created inside the M25 promise (see terrain .then chain) so the chalk floor
// can be rim-flattened against the M25 ring and clipped by the same mask as
// the terrain. Declared here at module scope; assigned once M25 data resolves.
let geologyGroup = null;

// ---------- Reservoirs (surface water polygons) ----------
// Data fetch starts immediately; creation deferred until terrain is ready (see terrain .then() chain)
let reservoirsMesh = null;
const reservoirDataPromise = loadReservoirData();

// ---------- Canals (surface water ribbons) ----------
// Data fetch starts immediately; creation deferred until terrain is ready (see terrain .then() chain)
let canalsMesh = null;
const canalDataPromise = loadCanalData();

// ---------- Sewer Tunnels (underground infrastructure) ----------
let sewersMesh = null;
loadSewerData().then(data => {
  if (data) {
    sewersMesh = createSewerTunnels(data, llToXZ, sim.verticalScale);
    if (sewersMesh) {
      scene.add(sewersMesh);
      addSewersToLegend();
      dbg('Sewer tunnels added to scene');
    }
  }
});

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
// Per-branch centerPts with _depthM stashed on each Vector3 (for terrain snap).
const lineBranchCenterPts = new Map(); // lineId -> [[branchPts], ...]
// Line colour cache (hex) for tube rebuild after terrain snap.
const lineColoursById = new Map();     // lineId -> hex colour
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
    thickness: 0.6,
    ior: 1.28,
    attenuationColor: new THREE.Color(0x9fb3c8),
    attenuationDistance: 8.0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.6,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: 0.0,
    fog: true,
    depthWrite: true,
  });
}

// Geo projection: lon/lat -> x/z in *metres* (local tangent plane-ish), centred on London.
// This makes scene units ≈ metres, so train speeds and station spacing can feel real.
const ORIGIN = { lat: 51.5074, lon: -0.1278 };

// OSGB36 / British National Grid — Helmert 7-param datum transform from WGS84
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
// Derived from proj4 — consistent with Helmert transform, not independently looked-up.
const [BNG_REF_E, BNG_REF_N] = proj4('EPSG:4326', 'EPSG:27700', [ORIGIN.lon, ORIGIN.lat]);

function llToXZ(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  const x = (e - BNG_REF_E) * sim.horizontalScale;
  const z = -(n - BNG_REF_N) * sim.horizontalScale;
  return { x, z };
}

// Shared station registry: all lines use same X/Z for stations with same NaPTAN ID
// This ensures interchanges show vertical stacks, not offset tubes
const sharedStationPositions = new Map(); // naptanId -> { x, z, lat, lon }
const stationLineCount = new Map(); // naptanId -> number of tube lines serving this station

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
  const allBranchCenterPts = []; // per-branch (for terrain snap rebuild)
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
      const pt = new THREE.Vector3(pos.x, y, pos.z);
      pt._depthM = depthM; // stash for terrain-relative repositioning
      centerPts.push(pt);
    }

    allCenterPts.push(...centerPts);
    allBranchCenterPts.push(centerPts);

    const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);
    const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, twinTunnelsEnabled ? tunnelOffsetM : 0);

    const segs = Math.max(80, centerPts.length * 10);
    const radius = 4.5;

    const leftMesh = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
    const rightMesh = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
    leftMesh.userData.lineId = lineId;
    rightMesh.userData.lineId = lineId;
    leftMesh.userData.type = 'tube-line';
    rightMesh.userData.type = 'tube-line';
    leftMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    rightMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;

    allMeshes.push(leftMesh, rightMesh);
    linePickables.push(leftMesh, rightMesh);
    group.add(leftMesh, rightMesh);

    // Trains per branch (density scales with track length)
    const branchTrains = createTrains({ system: trainSystem, leftCurve, rightCurve, stationUs, lineId, colour, group });
    sim.trains.push(...branchTrains);
    allTrains.push(...branchTrains);
  }

  // Keep merged center points for camera focus
  lineCenterPoints.set(lineId, allCenterPts);
  // Per-branch data for terrain snap rebuild
  lineBranchCenterPts.set(lineId, allBranchCenterPts);
  lineColoursById.set(lineId, colour);

  // Track all meshes for hover highlight
  lineMeshesById.set(lineId, allMeshes);

  if (allMeshes.length === 0) return null;
  return { group, meshes: allMeshes, trains: allTrains };
}

// (trains are kept in sim.trains)

// Victoria station markers/labels (legacy - now per-line tracking below)
let victoriaStationsLayer = null;
// prefs keys migrated from victoria*Visible -> generic *Visible (04Jul26 sweep);
// fall back to the old key so existing localStorage prefs still apply.
let stationsVisible = prefs.stationsVisible ?? prefs.victoriaStationsVisible ?? true;
let labelsVisible = prefs.labelsVisible ?? prefs.victoriaLabelsVisible ?? true;

// Victoria station shafts visibility (legacy - now per-line tracking below)
let shaftsVisible = prefs.shaftsVisible ?? prefs.victoriaShaftsVisible ?? true;

// Per-line station layer tracking (supports all 11 Underground lines + DLR)
const lineShaftLayers = new Map(); // lineId -> { stationsLayer }
let unifiedShaftLayer = null; // single frosted-glass shaft layer for all stations
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
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'tideway', textContent: 'Tideway + Lee Tunnel' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'geology', textContent: 'Geology' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'reservoirs', textContent: 'Reservoirs' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'canals', textContent: 'Canals' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'sewers', textContent: 'Sewers' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { disabled: true, textContent: '───────────' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'surface-hybrid', textContent: 'Surface (Hybrid)' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'surface-texture', textContent: 'Surface (Texture)' }));
        soloSelect.appendChild(Object.assign(document.createElement('option'), { value: 'surface-geometry', textContent: 'Surface (Geometry)' }));

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
      const isInfra = ['crossrail', 'tideway', 'geology', 'reservoirs', 'canals', 'sewers', 'surface-texture', 'surface-geometry', 'surface-hybrid'].includes(val);
      const isSurface = val === 'surface-texture' || val === 'surface-geometry' || val === 'surface-hybrid';

      // Tube lines + their stations: show all or just selected
      for (const id of wanted) {
        const visible = val === 'all' || id === val;
        setLineVisible(id, visible);

        // Toggle per-line station markers and labels
        const layers = lineShaftLayers.get(id);
        if (layers) {
          if (layers.stationsLayer?.mesh) layers.stationsLayer.mesh.visible = visible;
          if (layers.stationsLayer?.setLabelsVisible) layers.stationsLayer.setLabelsVisible(visible);
        }
      }

      // Unified shafts: filter by line or show all
      if (unifiedShaftLayer) {
        if (val === 'all') {
          unifiedShaftLayer.setFilteredLines(null);
        } else if (!isInfra) {
          unifiedShaftLayer.setFilteredLines(new Set([val]));
        }
      }

      // Infrastructure: visible when "all" or when specifically solo'd
      if (tidewayMesh) tidewayMesh.visible = val === 'all' || val === 'tideway';
      if (crossrailMesh) crossrailMesh.visible = val === 'all' || val === 'crossrail';
      if (geologyGroup) geologyGroup.visible = val === 'all' || val === 'geology';
      if (reservoirsMesh) reservoirsMesh.visible = val === 'all' || val === 'reservoirs';
      if (canalsMesh) canalsMesh.visible = val === 'all' || val === 'canals';
      if (sewersMesh) sewersMesh.visible = val === 'all' || val === 'sewers';

      // Surface features: hybrid (texture + geometry) enabled for "all" mode
      if (surfaceTextureMaterial) {
        setSurfaceTextureEnabled(surfaceTextureMaterial, val === 'all' || val === 'surface-texture' || val === 'surface-hybrid');
      }
      if (surfaceGeometryGroup) {
        setSurfaceGeometryVisible(surfaceGeometryGroup, val === 'all' || val === 'surface-geometry' || val === 'surface-hybrid');
      }

      // Focus camera on the selected line / feature
      // Surface modes: don't move camera — features are full-map, visible wherever you are
      if (!isSurface && !isInfra && val !== 'all') {
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

        // Populate stationLineCount from TfL stopPoint.lines (Underground mode only)
        for (const sp of sps) {
          if (!sp.id || stationLineCount.has(sp.id)) continue;
          stationLineCount.set(sp.id, (sp.lines || []).length || 1);
        }

        const ds = debugDepthStats({ lineId: id, stopPoints: sps, anchors: depthAnchors });
        addLineFromStopPoints(id, colour, sps, depthAnchors, sim, { branches });
        setLineVisible(id, true);

        // Station markers + labels + shafts for all lines
        const DEEP_LINES_WITH_SHAFTS = new Set(['victoria', 'bakerloo', 'central', 'jubilee', 'northern', 'piccadilly', 'waterloo-city', 'circle', 'district', 'hammersmith-city', 'metropolitan', 'dlr']);
        if (DEEP_LINES_WITH_SHAFTS.has(id)) {
          // Build interpolated depth map from all branches (matches tube centerline)
          const branchArrays = branches && branches.length > 0 ? branches : [sps];
          const interpolatedDepths = new Map();
          for (const branchStops of branchArrays) {
            const validBranch = branchStops.filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon));
            if (validBranch.length < 2) continue;
            const interp = buildDepthInterpolator(validBranch, depthAnchors);
            for (const sp of validBranch) {
              const d = interp(sp.id);
              if (d !== null && !interpolatedDepths.has(sp.id)) {
                interpolatedDepths.set(sp.id, d);
              }
            }
          }

          // Identify terminus stations (first + last of each branch)
          const terminusIds = new Set();
          for (const br of branchArrays) {
            if (br.length >= 2) {
              terminusIds.add(br[0].id);
              terminusIds.add(br[br.length - 1].id);
            }
          }

          const stations = sps
            .filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon))
            .map(sp => {
              const { x, z } = llToXZ(sp.lat, sp.lon);
              const depthM = interpolatedDepths.get(sp.id) ?? depthForStation({ naptanId: sp.id, lineId: id, anchors: depthAnchors });
              const y = -depthM * sim.verticalScale;
              return {
                id: sp.id,
                name: sp.name,
                pos: new THREE.Vector3(x, y, z),
                depthM,
                lineCount: stationLineCount.get(sp.id) || 1,
                isTerminus: terminusIds.has(sp.id),
              };
            });

          // Dispose old per-line station layer if it exists
          const existing = lineShaftLayers.get(id);
          existing?.stationsLayer?.dispose?.();

          const stationsLayer = createStationMarkers({
            scene,
            stations,
            colour,
            size: 6.0,
            labels: true,
          });
          const sv = lineStationsVisible.get(id) ?? stationsVisible;
          const lv = lineLabelsVisible.get(id) ?? labelsVisible;
          stationsLayer.setLabelsVisible(lv);
          stationsLayer.mesh.visible = sv;

          // Register stations in shaft registry for unified shaft creation after loop
          for (const st of stations) {
            registerStationForShafts({
              naptanId: st.id,
              name: st.name,
              x: st.pos.x,
              z: st.pos.z,
              lineId: id,
              depthM: st.depthM,
              tflLineCount: st.lineCount || 1,
            });
          }

          // Store per-line station layer for later access (labels, markers, hover)
          lineShaftLayers.set(id, { stationsLayer });

          // Keep HUD checkboxes in sync
          if (id === 'victoria') {
            const stCb = document.getElementById('victoriaStations');
            if (stCb) stCb.checked = stationsVisible;
            const lbCb = document.getElementById('victoriaLabels');
            if (lbCb) lbCb.checked = labelsVisible;
            const shCb = document.getElementById('victoriaShafts');
            if (shCb) shCb.checked = shaftsVisible;
          }
        }

        loadedCount++;
      } catch (e) {
        console.warn('Failed to build line', id, e);
        failed.push(id);
      }
    }

    // Create unified shaft layer from registry (one frosted glass cylinder per station)
    unifiedShaftLayer = createUnifiedShafts({
      scene,
      registry: getShaftRegistry(),
      getTerrainMeshSurfaceY: terrain ? getTerrainMeshSurfaceY : null,
      verticalScale: sim.verticalScale,
    });
    if (unifiedShaftLayer?.group) {
      unifiedShaftLayer.group.visible = shaftsVisible;
    }
    dbg(`Unified shafts: ${getShaftRegistry().size} stations from shaft registry`);

    // If terrain already loaded, snap tubes to terrain-relative depth.
    // (Handles race condition: terrain may load before or after network.)
    // snap is idempotent — safe to call even if terrain callback already ran.
    if (terrain) {
      snapAllTubesToTerrain();
      snapAllShaftsToTerrain();
      snapTidewayShaftsToTerrain(getTerrainMeshSurfaceY);
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
      // Cinematic intro was started before network build began (main.js:1578)
      // so it runs concurrently with tile/terrain streaming. No controls call
      // here — intro.finalize() re-enables controls on every exit path.
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

// ---------- Cinematic intro (Track C) ----------
// Fire immediately — intro runs concurrently with network build / tile
// streaming. Camera descends from 5000m while terrain + buildings stream in
// beneath it. finalize() re-enables controls on every exit path.
const intro = createIntro({ camera, controls, fpsControls, llToXZ });
intro.run();
initIntroTuner({ intro, camera, controls });

buildNetworkMvp();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  lensSystem.updateAspect(camera.aspect);
});

// Module-level reference for the tooltip formatter — populated from inside the
// bare-block scope below so __ug (and tests) can call it directly.
let _formatInfraTooltipRef = null;

// ---------- Click-to-focus / shift-click toggle + hover tooltip ----------
{
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const tip = document.getElementById('hoverTip');
  let lastHoverLineId = null;

  function prettyLineName(lineId) {
    const raw = String(lineId || '').replace(/-/g, ' ');
    if (raw === 'dlr') return 'DLR';
    if (raw === 'hammersmith city') return 'Hammersmith & City line';
    if (raw === 'waterloo city') return 'Waterloo & City line';
    const titled = raw.replace(/\b\w/g, c => c.toUpperCase());
    return titled + ' line';
  }

  function moveTip(ev, lineId) {
    if (!tip) return;
    if (!lineId) {
      tip.style.display = 'none';
      tip.style.transform = 'translate(-9999px, -9999px)';
      lastHoverLineId = null;
      resetCushion();
      return;
    }

    const name = prettyLineName(lineId);
    if (lastHoverLineId !== lineId) {
      tip.innerHTML = `<b>${name}</b>`;
      tip.style.display = 'block';
      lastHoverLineId = lineId;
    }

    const x = (ev.clientX ?? 0) + 12;
    const y = (ev.clientY ?? 0) + 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  function getMouseNdc(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const rawX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const rawY = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);

    // The lens distortion post-process shader displaces rendered pixels on
    // screen: the pixel at screen NDC (rawX, rawY) actually shows content
    // from a different position in the undistorted framebuffer. Map through
    // the same distortion so the raycaster hits what the user visually sees.
    const corrected = lensSystem.distortNdc(rawX, rawY);
    mouse.x = corrected.x;
    mouse.y = corrected.y;
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

  // Hoisted out of pickStationUnderPointer — refilled in place each call so a
  // per-pointermove raycast allocates no array.
  const _allStationMeshes = [];

  function pickStationUnderPointer(ev) {
    getMouseNdc(ev);
    raycaster.setFromCamera(mouse, camera);
    // Check station markers from all line shaft layers
    _allStationMeshes.length = 0;
    for (const [, layers] of lineShaftLayers) {
      if (layers.stationsLayer?.mesh) {
        _allStationMeshes.push(layers.stationsLayer.mesh);
      }
    }
    if (_allStationMeshes.length === 0) return null;
    const hits = raycaster.intersectObjects(_allStationMeshes, false);
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
        m.material.thickness = 0.6;
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

    const depthM = station.depthM;
    const depthLabel = depthM > 0 ? `${Math.round(depthM)}m below ground` : 'Surface station';

    tip.innerHTML = `<b>${cleanStationName(station.name)}</b><br/><span class="muted">${depthLabel}</span>`;
    tip.style.display = 'block';
    lastHoverLineId = null; // Reset so transition back to line hover updates text

    const x = (ev.clientX ?? 0) + 12;
    const y = (ev.clientY ?? 0) + 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ---------- Infrastructure hover ----------

  // Display name lookup for line IDs.
  //   LINE_DISPLAY(id)             -> bare canonical name ("Northern", "Hammersmith & City", "DLR").
  //                                   Used in station-shaft tooltip subtitle (multi-line list — the
  //                                   word "line" is implicit in context, suppressed here for compactness).
  //   LINE_DISPLAY_WITH_SUFFIX(id) -> bare canonical name + lowercase " line" suffix
  //                                   ("Northern line", "Hammersmith & City line"), EXCEPT DLR which
  //                                   stays bare (it's a Light Railway, not a Line — TfL convention).
  //                                   Used as the title on tube-line tooltips.
  // Unknown ids fall through to a Title-Case version of the id.
  const _LINE_DISPLAY_MAP = {
    'bakerloo': 'Bakerloo', 'central': 'Central', 'circle': 'Circle',
    'district': 'District', 'hammersmith-city': 'Hammersmith & City', 'jubilee': 'Jubilee',
    'metropolitan': 'Metropolitan', 'northern': 'Northern', 'piccadilly': 'Piccadilly',
    'victoria': 'Victoria', 'waterloo-city': 'Waterloo & City', 'elizabeth': 'Elizabeth',
    'dlr': 'DLR',
  };
  function LINE_DISPLAY(id) {
    return _LINE_DISPLAY_MAP[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
  }
  function LINE_DISPLAY_WITH_SUFFIX(id) {
    const base = LINE_DISPLAY(id);
    if (!base) return '';
    if (id === 'dlr') return base; // DLR is a Light Railway, not a Line
    return `${base} line`;
  }

  // Priority tiers — lower = higher priority (small features beat large surfaces)
  const INFRA_TIER = {
    'tideway-shaft': 1, 'lee-shaft': 1, 'crossrail': 1, 'chalk-marker': 1,
    'tideway-tunnel': 2, 'lee-tunnel': 2, 'sewer': 2, 'station-shaft': 2,
    'tube-line': 3,
    'canal': 3, 'reservoir': 3,
    'thames': 4, 'chalk': 4,
  };

  // Large-area surface types that would intercept every ray — exclude from pickables.
  // Thames is now PICKABLE (zone-aware tooltip via hitPoint nearest-segment lookup).
  // Priority tier 4 ensures any tunnel/shaft/sewer hit at the same pixel beats it.
  const UNPICKABLE_TYPES = new Set(['chalk']);

  function collectInfraPickables() {
    const pickables = [];
    // Chalk mesh excluded via UNPICKABLE_TYPES — 80km² plane intercepts every downward ray.
    // Chalk-marker (small sphere) is kept.
    // thamesMesh now included — small features (shafts/tunnels) beat it via INFRA_TIER.
    // Tube line meshes (linePickables) are flat-pushed below — they live in lineGroups
    // but iterating linePickables directly avoids walking every line group.
    const sources = [tidewayMesh, crossrailMesh, sewersMesh, reservoirsMesh, canalsMesh, geologyGroup, thamesMesh, unifiedShaftLayer?.group];
    for (const src of sources) {
      if (!src || !src.visible) continue;
      // Single mesh with userData.type
      if (src.userData?.type && !UNPICKABLE_TYPES.has(src.userData.type)) {
        pickables.push(src); continue;
      }
      // Group — check children (two levels deep for nested groups)
      if (src.children) {
        for (const child of src.children) {
          if (child.userData?.type && !UNPICKABLE_TYPES.has(child.userData.type)) {
            pickables.push(child); continue;
          }
          if (child.children) {
            for (const gc of child.children) {
              if (gc.userData?.type && !UNPICKABLE_TYPES.has(gc.userData.type)) pickables.push(gc);
            }
          }
        }
      }
    }
    // Tube line tubes (left+right per branch). Each carries userData.type='tube-line' + lineId.
    // Parent (lineGroup) visibility controls solo-line filtering — check it, not mesh.visible.
    for (const m of linePickables) {
      if (!m || m.userData?.type !== 'tube-line') continue;
      if (m.parent && m.parent.visible === false) continue;
      pickables.push(m);
    }
    return pickables;
  }

  function pickInfraUnderPointer(ev) {
    const pickables = collectInfraPickables();
    if (pickables.length === 0) return null;

    getMouseNdc(ev);
    raycaster.setFromCamera(mouse, camera);

    // Use recursive:true so child meshes inside any accidentally-collected
    // Groups are still tested, and force-update world matrices on source
    // groups to guarantee transforms are current after async load.
    const infraSources = [tidewayMesh, crossrailMesh, sewersMesh, reservoirsMesh, canalsMesh, geologyGroup, thamesMesh, unifiedShaftLayer?.group];
    for (const src of infraSources) {
      if (src) src.updateMatrixWorld(true);
    }
    // Tube line meshes live in lineGroups; refresh world matrices so picks land on correct geometry.
    for (const g of lineGroups.values()) g.updateMatrixWorld(true);

    const hits = raycaster.intersectObjects(pickables, true);
    if (!hits || hits.length === 0) return null;

    // Sort by priority tier first, then distance
    let best = hits[0];
    let bestTier = INFRA_TIER[best.object.userData?.type] ?? 99;
    for (let i = 1; i < hits.length; i++) {
      const tier = INFRA_TIER[hits[i].object.userData?.type] ?? 99;
      if (tier < bestTier || (tier === bestTier && hits[i].distance < best.distance)) {
        best = hits[i];
        bestTier = tier;
      }
    }
    // Return mesh + hitPoint so per-class formatters can do spatial lookups
    // (e.g. Thames zone resolution via nearestThamesSegment(hit.point)).
    return { mesh: best.object, hitPoint: best.point };
  }

  // ---------- Tooltip rendering helpers ----------
  //
  // Single shared formatter (Wave 1 plan §4 — locked):
  //   - Header with optional per-class subtitle
  //   - Tabular Plex Mono body for {WIDTH, DEPTH, DATE}
  //   - Rows omitted entirely if value is null/undefined
  //   - Unnamed canal/reservoir => minimal one-row tooltip (type only)
  //   - Chalk/chalk-marker keep string-only semantics (special-cased)
  //
  // Data merge: lookupInfraMeta(mesh) provides defaults; mesh.userData
  // fields take precedence (existing data wins on conflict).

  function _isLikelyOsmAutoName(name) {
    // OSM bulk-export rows leave names like "Canal 1085535988" or
    // "Reservoir 147855520" — treat as effectively unnamed.
    if (!name) return true;
    return /^(Canal|Reservoir)\s+\d+$/i.test(name)
        || /^Reservoir\s*[№#]\d+$/i.test(name);
  }

  function _renderInfraTable(rows) {
    // rows: array of [label, value] pairs; value already stringified.
    // Skips rows with null/undefined/empty value.
    const trs = [];
    for (const [label, value] of rows) {
      if (value === null || value === undefined || value === '') continue;
      trs.push(`<tr><th>${label}</th><td>${value}</td></tr>`);
    }
    if (!trs.length) return '';
    return `<table>${trs.join('')}</table>`;
  }

  _formatInfraTooltipRef = formatInfraTooltip;
  function formatInfraTooltip(mesh, hitPoint = null) {
    const ud = mesh.userData;
    const t = ud.type;

    // Special-cases that retain string-only semantics (per Jordan-locked):
    if (t === 'chalk') {
      return `<b>Chalk Boundary</b><br/><span class="muted">${ud.depth} - ${ud.description}</span>`;
    }
    if (t === 'chalk-marker') {
      return `<b>Chalk Boundary</b><br/><span class="muted">${ud.label}</span>`;
    }
    if (t === 'thames') {
      // Zone-aware tooltip: nearest waypoint segment -> zone -> tabular layout.
      // Falls back to plain "River Thames" header if hitPoint missing or zones
      // not yet initialised.
      let zone = null;
      if (hitPoint) {
        const segIdx = nearestThamesSegment(hitPoint.x, hitPoint.z);
        if (segIdx !== null) zone = getZoneAt(segIdx);
      }
      const title = 'River Thames';
      const subtitle = zone ? zone.name : null;
      const rows = [];
      if (zone) {
        rows.push(['WIDTH', `~${zone.meanWidth}m`]);
        // Always show mean+max in metres; if mean===max, just print one value
        const depthVal = (zone.maxDepth > zone.meanDepth)
          ? `${zone.meanDepth}m mean (${zone.maxDepth}m max)`
          : `${zone.meanDepth}m`;
        rows.push(['DEPTH', depthVal]);
      }
      const header = subtitle
        ? `<b>${title}</b><div class="sub">${subtitle}</div>`
        : `<b>${title}</b>`;
      return header + _renderInfraTable(rows);
    }

    // Merge meta (gap-filler) with userData (authoritative).
    const meta = lookupInfraMeta(mesh) || {};
    const merged = {
      name: ud.name ?? meta.name,
      diameter: ud.diameter ?? meta.diameter,
      depth: ud.depth ?? meta.depth,
      installed: ud.installed ?? meta.installed,
      engineer: ud.engineer ?? meta.engineer,
    };

    // Per-class header (title + optional subtitle):
    let title = merged.name || 'Infrastructure';
    let subtitle = null;

    switch (t) {
      case 'tideway-shaft':
        title = 'Thames Tideway Tunnel';
        subtitle = merged.name || null;
        break;
      case 'lee-shaft':
        title = 'Lee Tunnel';
        subtitle = merged.name || null;
        break;
      case 'tideway-tunnel': {
        if (merged.name && merged.name !== 'Thames Tideway Tunnel') {
          title = 'Thames Tideway Tunnel';
          subtitle = merged.name;
        } else {
          title = merged.name || 'Thames Tideway Tunnel';
        }
        break;
      }
      case 'lee-tunnel':
        title = 'Lee Tunnel';
        break;
      case 'crossrail': {
        // Strip existing "Crossrail - " / "Elizabeth Line " prefix off section names
        const raw = merged.name || '';
        const section = raw
          .replace(/^Crossrail\s*[—–\-\/]\s*/i, '')
          .replace(/^Elizabeth Line\s*/i, '')
          .trim();
        title = 'Elizabeth Line';
        subtitle = section || 'Crossrail';
        break;
      }
      case 'sewer':
        title = 'London Sewerage';
        subtitle = merged.name || (ud.tunnelId || null);
        break;
      case 'station-shaft': {
        // Station shafts show NAME + LINE LIST + DATE only. Depth + width
        // live on the line tubes themselves (see 'tube-line' case below) —
        // a station serving multiple lines has different platform depths
        // per line, so depth on the station shaft conflates them.
        title = meta.name || merged.name || 'Station';
        const lineNames = (ud.lines || []).map(LINE_DISPLAY).filter(Boolean);
        subtitle = lineNames.length ? lineNames.join(' • ') : null;
        // Force-clear depth/diameter/engineer so the row-emission below skips them.
        merged.depth = null;
        merged.diameter = null;
        merged.engineer = null;
        break;
      }
      case 'tube-line': {
        // Hover on a Tube line tube: line name + approximate width + approximate
        // depth at this point. Width comes from line-registry diameter (or null
        // for sub-surface lines). Depth derived by finding the nearest station
        // on this line in the unified shaft layer and reading its FOI depth.
        // "Approximate" by design — Jordan-locked at brief.
        const lineId = ud.lineId;
        const lineMeta = lookupLineMeta([lineId]) || {};
        title = LINE_DISPLAY_WITH_SUFFIX(lineId) || 'Tube line';
        subtitle = null;
        // Width — registry value, formatted with leading tilde to read as approximate.
        if (lineMeta.diameter != null) {
          merged.diameter = (typeof lineMeta.diameter === 'number')
            ? `~${lineMeta.diameter}m`
            : `~${lineMeta.diameter}`; // string forms (e.g. "3.81-4.35m") already include unit
        } else {
          merged.diameter = null;
        }
        // Depth — nearest station-shaft on this lineId, by 2D distance to hitPoint.
        merged.depth = null;
        if (hitPoint && unifiedShaftLayer?.group) {
          let bestNaptan = null;
          let bestDist = Infinity;
          unifiedShaftLayer.group.traverse(child => {
            const cud = child.userData;
            if (cud?.type !== 'station-shaft') return;
            if (!cud.lines || !cud.lines.includes(lineId)) return;
            if (!cud.naptanId) return;
            const dx = child.position.x - hitPoint.x;
            const dz = child.position.z - hitPoint.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist) { bestDist = d2; bestNaptan = cud.naptanId; }
          });
          if (bestNaptan) {
            // Synthesise a fake mesh shape for lookupInfraMeta — it only reads userData.naptanId.
            const stationMeta = lookupInfraMeta({ userData: { naptanId: bestNaptan } });
            if (stationMeta && stationMeta.depth != null) {
              merged.depth = `~${Math.round(stationMeta.depth)}m`;
            }
          }
        }
        // Engineer + installed not surfaced on line hover (they're on station shafts).
        merged.engineer = null;
        merged.installed = null;
        break;
      }
      case 'canal':
        if (_isLikelyOsmAutoName(merged.name)) {
          // Minimal one-row tooltip per Jordan-locked decision
          return `<b>Canal</b>`;
        }
        title = 'Canal';
        subtitle = merged.name;
        break;
      case 'reservoir':
        if (_isLikelyOsmAutoName(merged.name)) {
          return `<b>Reservoir</b>`;
        }
        title = 'Reservoir';
        subtitle = merged.name;
        break;
    }

    // Per-class table rows.
    // Rule: numeric depth -> "<n>m"; string depth (e.g. "68-98m" / "~60m") passes through as-is.
    // Crossrail STATION MARKERS (no tunnelId, smaller geometry) omit diameter row.
    const rows = [];

    // Diameter row — only when meaningful for the class.
    // Sewer userData no longer carries the rendering-geometry diameter (4m
    // uniform was misleading; real Bazalgette sections vary 1.5-4.5m and are
    // egg-shaped). Sewers fall through to the generic merged.diameter check
    // below and emit WIDTH only when the registry supplies a verified value.
    if (t === 'crossrail') {
      // Crossrail station markers (have userData.depth but no tunnelId) lack a meaningful
      // diameter — they're rectangular caverns, not bored tubes. Detect via absence of
      // tunnelId AND geometry hint (markers are small spheres).
      const isStationMarker = !ud.tunnelId && mesh.geometry?.type === 'SphereGeometry';
      if (!isStationMarker && merged.diameter != null) {
        rows.push(['WIDTH', `${merged.diameter}m`]);
      }
    } else if (merged.diameter != null && t !== 'canal' && t !== 'reservoir') {
      // Numeric diameter -> append "m"; string diameter -> already formatted (incl. unit).
      const widthVal = (typeof merged.diameter === 'number')
        ? `${merged.diameter}m`
        : String(merged.diameter);
      rows.push(['WIDTH', widthVal]);
    }

    // Depth row
    if (merged.depth !== null && merged.depth !== undefined && t !== 'canal' && t !== 'reservoir') {
      const depthVal = (typeof merged.depth === 'number')
        ? `${Math.round(merged.depth)}m`
        : String(merged.depth);   // already includes 'm' in registry strings
      rows.push(['DEPTH', depthVal]);
    }

    // Installed row
    if (merged.installed !== null && merged.installed !== undefined) {
      rows.push(['DATE', String(merged.installed)]);
    }

    // Engineer row (currently sewer-only; registry-driven so any class can adopt)
    if (merged.engineer) {
      rows.push(['ENGINEER', String(merged.engineer)]);
    }

    // Reservoir/canal extras (area / length) — surface features, no depth/diameter
    if (t === 'reservoir' && ud.area != null) {
      rows.push(['AREA', `${ud.area.toFixed(0)} ha`]);
    }
    if (t === 'canal' && ud.length != null) {
      rows.push(['LENGTH', `${ud.length.toFixed(1)} km`]);
    }

    const header = subtitle
      ? `<b>${title}</b><div class="sub">${subtitle}</div>`
      : `<b>${title}</b>`;

    return header + _renderInfraTable(rows);
  }

  function moveInfraTip(ev, mesh, hitPoint = null) {
    if (!tip || !mesh) return;
    tip.innerHTML = formatInfraTooltip(mesh, hitPoint);
    tip.style.display = 'block';
    lastHoverLineId = null; // Reset so transition back to line hover updates text
    const x = (ev.clientX ?? 0) + 12;
    const y = (ev.clientY ?? 0) + 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  function onPointerMove(ev) {
    // Skip the whole hover cascade (up to three full-scene raycasts) while a
    // rotate drag is active — tooltips are irrelevant mid-drag and the raycasts
    // are the dominant per-move cost. Clear any lingering tip on the way in.
    if (_dragActive) {
      setHoverHighlight(null);
      return;
    }

    // Tier 1: Station hover (highest priority)
    const station = pickStationUnderPointer(ev);
    if (station) {
      moveStationTip(ev, station);
      setHoverHighlight(null);
      return;
    }

    // Tier 2: Infrastructure hover
    const infraHit = pickInfraUnderPointer(ev);
    if (infraHit) {
      moveInfraTip(ev, infraHit.mesh, infraHit.hitPoint);
      setHoverHighlight(null);
      return;
    }

    // Tier 3: Line hover
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

function setStationsVisible(v) {
  stationsVisible = !!v;
  // Toggle visibility for ALL lines with stations
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.stationsLayer?.mesh) layers.stationsLayer.mesh.visible = stationsVisible;
  }
  prefs.stationsVisible = stationsVisible;
  savePrefs(prefs);
}
function setLabelsVisible(v) {
  labelsVisible = !!v;
  // Toggle labels for ALL lines
  for (const [lineId, layers] of lineShaftLayers) {
    layers.stationsLayer?.setLabelsVisible?.(labelsVisible);
  }
  prefs.labelsVisible = labelsVisible;
  savePrefs(prefs);
}

function setShaftsVisible(v) {
  shaftsVisible = !!v;
  // Toggle unified shaft layer visibility
  if (unifiedShaftLayer?.group) unifiedShaftLayer.group.visible = shaftsVisible;
  prefs.shaftsVisible = shaftsVisible;
  savePrefs(prefs);
}

// Hook up HUD controls (optional)
{
  const stCb = document.getElementById('victoriaStations');
  if (stCb) {
    stCb.checked = stationsVisible;
    stCb.addEventListener('change', () => setStationsVisible(stCb.checked));
  }
  const lbCb = document.getElementById('victoriaLabels');
  if (lbCb) {
    lbCb.checked = labelsVisible;
    lbCb.addEventListener('change', () => setLabelsVisible(lbCb.checked));
  }

  const shCb = document.getElementById('victoriaShafts');
  if (shCb) {
    shCb.checked = shaftsVisible;
    shCb.addEventListener('change', () => setShaftsVisible(shCb.checked));
  }

  // ── Audio volume HUD ──
  const volSlider = document.getElementById('audioVolume');
  const volOut = document.getElementById('audioVolumeValue');
  const muteBtn = document.getElementById('audioMute');
  // Default muted on first boot (matches audio.js _muted default)
  let audioMuted = true;
  if (muteBtn) muteBtn.textContent = 'Unmute';
  if (volSlider) volSlider.disabled = true;
  if (volSlider) {
    volSlider.addEventListener('input', () => {
      const v = Number(volSlider.value) / 100;
      setMasterVolume(v);
      if (volOut) volOut.textContent = `${volSlider.value}%`;
    });
  }
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      audioMuted = !audioMuted;
      setMuted(audioMuted);
      muteBtn.textContent = audioMuted ? 'Unmute' : 'Mute';
      if (volSlider) volSlider.disabled = audioMuted;
    });
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
      url.searchParams.set('hx', String(sim.horizontalScale));
      const fl = lensSystem.getFocalLength();
      if (fl !== 35) url.searchParams.set('fl', String(fl));
      else url.searchParams.delete('fl');

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

// Non-direction keyboard shortcuts removed — only S/W/X/A/D, Q/E, arrows remain active.

// ---------- Animate ----------
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();

  // Cinematic intro — owns camera while running (no-op when not running)
  intro.update(dt);

  // Update FPS controls before orbit controls (keyboard takes precedence)
  updateFpsControls(dt);

  // Re-enable OrbitControls when not using FPS controls
  if (!intro.isRunning() && !fpsControls.active && !controls.enabled) {
    controls.enabled = true;
    // Sync controls target with current camera direction
    const lookDistance = 1000; // default look distance
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    controls.target.copy(camera.position).add(forward.multiplyScalar(lookDistance));
  }

  // Skip OrbitControls update while the intro owns the camera — controls.enabled=false
  // only blocks input handlers, not update() itself, whose final lookAt(target) would
  // otherwise override intro's lookAt(OXC) and desync renderer vs label projection.
  //
  // Damping handover: while fps controls are actively moving the camera, do NOT
  // run controls.update() — residual OrbitControls damping momentum would bleed
  // into fps-driven frames. On the rising edge of fps activation, flush any
  // pending damping deltas exactly once with damping disabled (so update() zeroes
  // sphericalDelta/panOffset instead of decaying them), which prevents a visible
  // kick when control hands back on key release.
  if (fpsControls.active) {
    if (!_fpsWasActive) {
      const prevDamping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = prevDamping;
    }
    // else: fps owns the camera this frame — skip update() entirely.
  } else if (!intro.isRunning()) {
    controls.update();
  }
  _fpsWasActive = fpsControls.active;

  // Readout widget — substrate, altitude, compass
  const azimuth = controls.getAzimuthalAngle();
  const surfaceYAtCamera = getTerrainMeshSurfaceY({ x: camera.position.x, z: camera.position.z });
  const realAltM = surfaceYAtCamera !== null
    ? Math.round((camera.position.y - surfaceYAtCamera) / VERTICAL_EXAGGERATION)
    : Math.round(camera.position.y / VERTICAL_EXAGGERATION);
  const cameraInsideM25 = isInsideM25(camera.position.x, camera.position.z);
  const isUnderground = cameraInsideM25 && (surfaceYAtCamera !== null
    ? camera.position.y < surfaceYAtCamera
    : camera.position.y < 0);

  // Substrate: chalk top ≈ 60m below sea level at VE=5 = -300 scene units (mOD reference)
  const CHALK_TOP_Y = -60 * VERTICAL_EXAGGERATION;
  let substrate = 'AIR';
  if (isUnderground) {
    if (isInThames(camera.position.x, camera.position.z)) substrate = 'WATER';
    else if (camera.position.y < CHALK_TOP_Y) substrate = 'CHALK';
    else substrate = 'CLAY';
  }
  readout.update(azimuth, realAltM, substrate);

  // ── Chalk-entry regime (D3.2/D3.3) + M25 edge blend (D5) ──────────────────
  // chalkBlend: smoothstep over camera Y crossing the LOCAL displaced chalk
  // surface ±30 (the same analytic surface the floor is built from, so felt =
  // seen). insideness: continuous M25 membership over a ~1500m band. The chalk
  // white-out and slowdown are gated by insideness so they only happen within
  // the disc — outside, there is no chalk stratum to cloud or slow through.
  const chalkSurfaceY = getChalkSurfaceY(camera.position.x, camera.position.z);
  const insideness = sampleM25Insideness(camera.position.x, camera.position.z);
  const chalkBlend = (1 - THREE.MathUtils.smoothstep(
    camera.position.y, chalkSurfaceY - 30, chalkSurfaceY + 30
  )) * insideness;

  // D-002 chalk slowdown: 1.0 (clay/air) → 0.5 (full chalk), lerped by chalkBlend
  // so it never snaps. Drives keyboard flight (movement funnel) AND mouse
  // zoom/pan (scaled from captured base values — multiply, never compound).
  substrateSpeedFactor = 1.0 - 0.5 * chalkBlend;
  controls.zoomSpeed = _baseZoomSpeed * substrateSpeedFactor;
  controls.panSpeed = _basePanSpeed * substrateSpeedFactor;

  // Controls-guide reveal: fire once when camera drops within 500 scene units
  // (~100m altimeter at VE=5) of the terrain surface. forceReveal() is
  // idempotent — sticky once triggered, so ascending after reveal keeps the
  // widget visible. Falls back to absolute Y when surfaceY is unavailable
  // (camera outside terrain mesh) so the widget still reveals at altitude
  // over central London on the first frame post-intro.
  if (controlsGuide && !controlsGuide.isRevealed()) {
    const altSceneUnits = surfaceYAtCamera !== null
      ? camera.position.y - surfaceYAtCamera
      : camera.position.y;
    if (altSceneUnits < 500) controlsGuide.forceReveal();
  }

  // Update surface tile loader (camera-proximity based loading/unloading)
  updateSurfaceLoader(camera.position.x, camera.position.z);

  // Update all trains (simulation, orientation, LOD, SpotLight pool)
  updateTrains(trainSystem, sim, camera, dt);

  // Update station label projections for ALL lines
  let updateCallCount = 0;
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.stationsLayer?.update) {
      layers.stationsLayer.update({ camera, renderer, terrainSurfaceY: surfaceYAtCamera, insideM25: cameraInsideM25 });
      updateCallCount++;
    }
  }
  if (updateCallCount === 0 && lineShaftLayers.size > 0) {
    // Station updates skipped
  }

  // Update environment based on camera height (sky/fog/background)
  if (skyDome) {
    updateEnvironment(camera, scene, skyDome, renderer, { insideness, chalkBlend });
  }

  // Update lighting based on camera position
  updateLighting(camera, atmosphereLights, { insideness, chalkBlend });

  // Update spatial audio (ambient crossfades, filter sweeps, wind)
  if (isAudioReady()) {
    updateAudio(dt, {
      cameraPosition: camera.position,
      altitude: realAltM,
      isUnderground,
      surfaceY: surfaceYAtCamera,
      focalLength: lensSystem.getFocalLength(),
    });
  }

  composer.render();
  sampleCushion();
  requestAnimationFrame(tick);
}

tick();

// Dev-only debug exposure for Playwright / console testing
if (import.meta.env.DEV) {
  window.__ug = {
    camera, controls, scene, lineShaftLayers, getTerrainMeshSurfaceY, VERTICAL_EXAGGERATION,
    getChalkSurfaceY, CHALK_TOP_Y,
    trainSystem, composer, bloomPass, lensSystem, isAudioReady,
    fpsControls, intro, landscapeLock, controlsGuide, readout,
    nearestThamesSegment, getZoneAt,
    // D-002 substrate speed multiplier — read live, settable by a later wave
    // (chalk slowdown) to throttle movement through dense strata.
    get substrateSpeedFactor() { return substrateSpeedFactor; },
    set substrateSpeedFactor(v) { substrateSpeedFactor = v; },
    cushionLuma: { sample: sampleCushion, reset: resetCushion, state: _cushionState },
    // formatInfraTooltip is closure-scoped to the tooltip block (~L1714-2268).
    // _formatInfraTooltipRef is assigned from inside that block and read via
    // this getter so it lands on __ug after init order resolves.
    get formatInfraTooltip() { return _formatInfraTooltipRef; },
    // Getters so live values are read (set after async loading)
    get unifiedShaftLayer() { return unifiedShaftLayer; },
    get surfaceLoaderStats() { return getSurfaceLoaderStats(); },
    get surfaceGeometryGroup() { return surfaceGeometryGroup; },
    // Sum of populated instance counts across all per-tile building InstancedMeshes.
    // This is what the Phase 0b fix actually guards: tiles can be `state='loaded'`
    // yet render zero buildings if the dedup Set rejects them. Assert against this
    // getter (not stats.loaded) to catch the zero-render regression.
    get buildingInstanceCount() {
      if (!surfaceGeometryGroup) return 0;
      let total = 0;
      surfaceGeometryGroup.traverse((obj) => {
        if (obj.isInstancedMesh && obj.name && obj.name.startsWith('buildings-')) {
          total += obj.count;
        }
      });
      return total;
    },
  };
}
