import { LANDMARK_INFO } from './landmark-info.js';
import * as THREE from 'three';
import { createRenderQuality } from './render-quality.js';
import { createAdaptiveQuality } from './adaptive-quality.js';
import { createVerticalScaleController } from './vertical-scale.js';
// ── s25:S ──
import { bindMasterController, onMasterChange, structureHeightScale, boreRadiusM, tubeAxisAttribute, patchTrueProportionMaterial } from './true-proportion.js';
import * as TrueProportion from './true-proportion.js';
// ── /s25:S ──
import { createMiniMap } from './mini-map.js';
import { createAirports, isAirportBuilding, getAirportHoverInfo, AIRPORT_DATA } from './airports.js';
import { createAirportDockWater, installAirportDockTerrainMask, getAirportDockSurfaceY, getAirportDockInfo } from './airport-docks.js';
import { airportSuppressionSignature } from './airport-suppression.js';
import { createDlrProfile } from './dlr-profile.js';
import { createMotorway, MOTORWAY_REPLACED_BRIDGES } from './m25-motorway.js';
// ── sprint:F ──
import { createFlights } from './flights.js';
// ── /sprint:F ──
// ── sprint:integrate ──
// One world wind (D-037): aircraft choose runways from the same surface wind
// the Balloon drifts on. Wired once, at module evaluation, before any flight
// is planned (setWindSource clears the runway cache, so never re-wire live).
import { setWindSource, getFlightWind } from './flights.js';
import { getSurfaceWind } from './wind.js';
setWindSource(getSurfaceWind);
// ── /sprint:integrate ──
import { BNG_REF_E, BNG_REF_N } from './coordinates.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import proj4 from 'proj4';
import { fetchRouteSequence, fetchBundledRouteSequenceIndex, fetchTubeLines } from './tfl.js';
import { loadStationDepthAnchors, depthForStation, debugDepthStats, buildDepthInterpolator } from './depth.js';
import { tryCreateTerrainMesh, xzToTerrainUV, terrainHeightToWorldY, getTerrainSurfaceY, getTerrainMeshSurfaceY, getStructuralSurfaceY, getTerrainBounds, TERRAIN_CONFIG, VERTICAL_EXAGGERATION, applyParkUndersideTexture, getTerrainRiverBed } from './terrain.js';
import { createParkLabels } from './park-labels.js';
import { createSkyDome, updateEnvironment, createAtmosphere, updateLighting, ENV_CONFIG } from './environment.js';
// ── sprint:D ──
import { createSunSystem } from './sun.js';
// ── /sprint:D ──
// ── s24:S ──
import { createSkySystem } from './sky.js';
import { attachSky } from './environment.js';
// ── /s24:S ──
import { createStationMarkers, cleanStationName, getLabelPolicy } from './stations.js';
import { createUnifiedShafts } from './shafts.js';
import { registerStationForShafts, getShaftRegistry } from './shaft-registry.js';
import { loadThamesData, createThamesVolume, WATER_LEVEL_M, WATER_TOP_Y, updateWater } from './thames.js';
import { createThamesProfileSampler } from './thames-profile.js';
import { loadM25Data, generateM25Mask, applyM25Mask, createM25Road, createThamesWaterfalls, computeThamesCrossings, initM25Boundary, isInsideM25, sampleM25Insideness } from './m25.js';
import { createGeologyExterior } from './geology-exterior.js';
// ── sprint:B ──
import { getMapEdgePointsBNG, getMapEdgeRing, trimRibbonVolumeToRing, isOffMapEdge } from './m25-edge.js';
// Buildings between the outer barrier and the bake's support ring would stand
// over the void now the ground ends at the barrier; suppress them alongside
// any existing suppression (airports).
const withOffMapSuppression = (suppress) => (b) => isOffMapEdge(b) || !!suppress?.(b);
// ── /sprint:B ──
import { loadTidewayData, createTidewaySystem, addTidewayToLegend, snapTidewayShaftsToTerrain } from './tideway.js';
import { loadCrossrailData, createCrossrailTunnel, addCrossrailToLegend } from './crossrail.js';
import { getInfraHazeStrength } from './infra-materials.js';
import { buildCrownRibbons } from './crown-ribbon.js';
import { createGeologicalStrata, addGeologyToLegend, getChalkSurfaceY, CHALK_TOP_Y, updateGeologyClarity } from './geology.js';
import { loadReservoirData, createReservoirs, addReservoirsToLegend } from './reservoirs.js';
import { loadCanalData, createCanals, addCanalsToLegend } from './canals.js';
import { createBridges } from './bridges.js';
import { createOverground } from './overground.js';
import { loadSewerData, createSewerTunnels, addSewersToLegend } from './sewers.js';
import { lookupInfraMeta, lookupLineMeta } from './infra-meta.js';
import { createTrainSystem, createTrains, updateTrains, disposeTrains } from './trains.js';
import { createSurfaceTexture, rasteriseTile, applySurfaceTexture, setSurfaceTextureEnabled, sceneBBoxToUVBounds } from './surface-texture.js';
import { loadBakedGround } from './baked-ground.js';
import { createTileBuildings, disposeTileGeometry, setSurfaceGeometryVisible, setBuildingHeightScale, getBuildingHeightScale, getBuildingMaterial } from './surface-geometry.js';
import { initSurfaceLoader, updateSurfaceLoader, getFullSceneBBox, makeTileDedup, getSurfaceLoaderStats, resetLoadedTiles } from './surface-loader.js';
import { fetchBakedBuildings, createBakedBuildingBuilder } from './baked-buildings.js';
import { fetchLandmarkFootprints, createLandmarkModels } from './landmark-models.js';
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
// ── s24:O ──
import { createOpeningGate } from './loading-gate.js';
import { applyShadowPolicy } from './sun.js';
import { getSurfaceTileStates } from './surface-loader.js';
// ── /s24:O ──
import { initLandscapeLock } from './landscape-lock.js';
import { initControlsGuide } from './controls-guide.js';
import { initCushionLuma, sampleCushion, resetCushion, _cushionState } from './cushion-luma.js';
import { initReadout } from './readout.js';
import { getWaterTuningSurface } from './water-material.js';
import { createMaterialResistance } from './material-resistance.js';
import { applyRiverBedMaterial, setRiverMaterialSubmerged } from './river-materials.js';
import { createUnderwaterSurface } from './underwater-surface.js';
// ── sprint:C ──
import { createSeaLife } from './sea-life.js';
// ── /sprint:C ──
// ── s25:W ──
import { updateTidewayWhirlpools, setTidewayWhirlpoolTime, getTidewayWhirlpools } from './tideway.js';
import { clampSewersUnderRiverBed, getSewerRoutes } from './sewers.js';
import { getAirportDockBedY } from './airport-docks.js';
// ── /s25:W ──
// ── s24:R ──
import { createEconomies, isShown } from './render-economies.js';
import { installDoubleSideSplit } from './double-side-split.js';
import { createShadowCache, casterVersionOf } from './shadow-cache.js';
import { setTrainEconomies, trainBatchStats } from './trains.js';
// ── /s24:R ──
// ── sprint:A1 ──
import { installModes } from './modes/index.js';
import { deityRegimeSpeed } from './modes/deity-speed.js';
import { getMasterBus } from './audio.js';
// ── /sprint:A1 ──
// ── s25:P ──
import { createTubeInterior } from './tube-interior.js';
// ── /s25:P ──

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
// The existing lens pass samples scene depth to keep surface refraction off
// opaque riverbanks/bed. This target is only read while post writes to rt2.
composerRenderTarget.depthTexture = new THREE.DepthTexture(
  composerRenderTarget.width, composerRenderTarget.height, THREE.UnsignedIntType);
const composer = new EffectComposer(renderer, composerRenderTarget);
// With an explicit target, r161 treats its physical dimensions as CSS size.
// Normalise before adding passes, or DPR is applied twice to every bloom level
// until the first window resize (4x unnecessary post-processing pixels at DPR2).
composer.setSize(window.innerWidth, window.innerHeight);
// A1 (05Sep26s): the post ping-pong buffer does not need MSAA — only the pass
// that draws the scene does. EffectComposer builds renderTarget2 as
// `renderTarget.clone()`, so it silently inherited samples:4 and every bloom /
// lens / output pass was resolving a second 4x HalfFloat target for nothing.
// RenderPass has needsSwap:false and draws into readBuffer, so pointing
// readBuffer at the MSAA target and writeBuffer at a plain one keeps the scene
// at 4x while the post chain runs single-sampled. Pixel-identical by
// construction; measured +7% overview / +12% street / +11% underground
// (M5, dpr 2). Do not "tidy" these two assignments away — without the role
// flip the scene lands in the non-MSAA target and all edge AA is lost.
composer.renderTarget2.dispose();
composer.renderTarget2 = new THREE.WebGLRenderTarget(
  composerRenderTarget.width,
  composerRenderTarget.height,
  { samples: 0, type: THREE.HalfFloatType }
);
composer.renderTarget2.texture.name = 'EffectComposer.rt2';
composer.readBuffer = composer.renderTarget1;
composer.writeBuffer = composer.renderTarget2;
// RenderPass and camera added after camera creation (below)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1.0, 50000);
// All city data and camera poses remain canonical VE5. One paired view-matrix
// transform changes the display of every current and late-loaded scene layer.
const masterHeight = createVerticalScaleController({ camera, value: 1.1 });
// ── s25:S ── D-039: Master stretches the landscape only; every structure hears
// Master through true-proportion.js and keeps its true proportions.
bindMasterController(masterHeight);
// Filled in by the HUD block: flush() runs any pending structure morph now
// (tests and tools); morphs counts completed CPU morph passes.
const structureMorph = { flush: () => {}, morphs: 0, pending: false };
// ── /s25:S ──
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

// D6: half-width of the CLAY/CHALK readout hysteresis band (total ~10 units)
// around getChalkSurfaceY(x,z).
const CHALK_HYSTERESIS_HALF = 5;

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
const underwaterSurface = createUnderwaterSurface({ camera, lensPass: lensSystem.pass,
  sceneTarget: composer.renderTarget1 });
const renderQuality = createRenderQuality({ renderer, composer });
let syncRenderQualityUi = () => {};
const adaptiveQuality = createAdaptiveQuality({ apply: quality => {
  renderQuality.set(quality);
  syncRenderQualityUi();
} });

// ── s24:R ──
// Render economies (sprint 24Sep26h, D-038): savings that leave the picture
// unchanged, each switchable (?econ=0 restores the e367efd path for ABBA).
const economies = createEconomies();
const doubleSideSplit = installDoubleSideSplit({ renderer, scene, enabled: economies.on('dsplit') });
let shadowCache = null;
let _s24LayerEconomyVersion = 0;
const _s24Applied = new WeakMap();
const _s24Viewport = { w: 0, h: 0 };
economies.onChange((name, value) => {
  if (name === 'dsplit') doubleSideSplit.setEnabled(value);
  if (name === 'shadowCache') shadowCache?.invalidate();
  _s24LayerEconomyVersion++;
});
function applyLayerEconomies() {
  const on = economies.flags;
  const apply = (group, fn) => {
    if (!group || _s24Applied.get(group) === _s24LayerEconomyVersion) return;
    fn(group.userData); _s24Applied.set(group, _s24LayerEconomyVersion);
  };
  apply(motorwayGroup, u => u.setEconomies?.({ frustumCulling: on.m25Cull, fogCulling: on.m25FogCull, instanceRanges: on.instanceRanges, hiddenSkip: on.hiddenSkip }));
  apply(overgroundGroup, u => u.setEconomies?.({ compact: on.instanceRanges, ranges: on.instanceRanges, skipHidden: on.hiddenSkip }));
  apply(flightsGroup, u => u.setEconomies?.({ ranges: on.instanceRanges, skipHidden: on.hiddenSkip, pool: on.flightsPool, cull: on.flightCull }));
  setTrainEconomies({ reusePose: on.trainPose, batch: on.trainBatch });
}
// ── /s24:R ──

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

// Item B clarity signals (chalk-relative, computed each tick — see tick()).
// Ramps are mutable so they can be tuned live via window.__ug without a reload.
let _clayClarityRamp = ENV_CONFIG.clayClarityRamp;   // scene units above chalk to full daylight
let _chalkClarityRamp = ENV_CONFIG.chalkClarityRamp; // scene units below chalk to full clarity
let _clayLift = 1;      // last computed clay clarity gradient [0,1]
let _chalkClarity = 0;  // last computed inside-chalk clarity [0,1]

// ── Submerged (Thames water volume, 12Jul26u) ──────────────────────────────
// Shared water classification for readout, atmosphere and keyboard speed.
// Thames membership follows rendered cross-sections AND actual carved terrain;
// the narrower building suppression corridor is not a navigation boundary.
function waterSurfaceAt(x,z) {
  const dockY=airportDockGroup?getAirportDockSurfaceY({x,z},VERTICAL_EXAGGERATION):null;
  return dockY ?? (thamesMesh?.userData.navigation?.containsXZ(x,z)?WATER_TOP_Y:null);
}
function isSubmergedAt(x, y, z) {
  // Docks retain their published impounded surface reference. They have no
  // bathymetry dataset; do not fabricate a floor while fixing the Thames.
  const dockY=airportDockGroup?getAirportDockSurfaceY({x,z},VERTICAL_EXAGGERATION):null;
  if(dockY!==null)return y<dockY && y>(getAirportDockBedY({x,z},VERTICAL_EXAGGERATION) ?? -Infinity); // s25:W dock bed
  return thamesMesh?.userData.navigation?.contains({x,y,z}) ?? false;
}
function classifySubstrateAt(point) {
  if(isSubmergedAt(point.x,point.y,point.z))return 'WATER';
  const surface=getTerrainMeshSurfaceY(point);
  if(point.y >= (surface ?? 0))return 'AIR';
  return point.y < getChalkSurfaceY(point.x,point.z) ? 'CHALK' : 'CLAY';
}
const materialResistance=createMaterialResistance({classify:classifySubstrateAt,
  riverNormal:(point,movement)=>{
    const dock=airportDockGroup?getAirportDockSurfaceY(point,VERTICAL_EXAGGERATION):null;
    return dock!==null?null:thamesMesh?.userData.navigation?.outwardNormal(point,movement);
  }});
// Last computed submerged blend [0,1] — short spatial smoothstep below the
// water top (see tick()); drives fog/lighting/audio and __ug exposure.
let _submergedBlend = 0;

// D6: CLAY/CHALK readout hysteresis state. Persists the last flip direction
// so the HUD label doesn't chatter when the camera sits right on the
// getChalkSurfaceY boundary — see the substrate classification in tick().
let _substrateInChalk = false;

// Left-button (ROTATE) drag flag. r161 OrbitControls has no getState(); we
// track the drag locally. Set on a capture-phase left pointerdown (before
// OrbitControls dispatches 'start'), cleared on pointerup/cancel/blur.
// Consumed by the rotate re-pivot (gate) and the hover cascade (skip mid-drag).
let _dragActive = false;

// Rising-edge tracker for the fps damping handover (see tick()).
let _fpsWasActive = false;

function isFormInput(target) {
  return target?.matches?.('input, select, textarea') || target?.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (isFormInput(e.target)) return;
  fpsControls.keys.add(e.key.toLowerCase());
});

window.addEventListener('keyup', (e) => {
  fpsControls.keys.delete(e.key.toLowerCase());
  // A release/repress can occur entirely between display frames. Clear
  // pressure synchronously so the next press cannot inherit an old hold.
  if(!['w','s','a','d','q','e'].some(key=>fpsControls.keys.has(key)))materialResistance.cancel();
});

// Clear stuck keys when window loses focus (prevents runaway movement on
// cmd-tab away mid-hold — a keyup may never fire in that case).
window.addEventListener('blur', () => {
  fpsControls.keys.clear();
  materialResistance.cancel();
});

// Prevent default scrolling for control keys
window.addEventListener('keydown', (e) => {
  if (isFormInput(e.target)) return;
  const controlKeys = ['s', 'w', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  if (controlKeys.includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
}, { passive: false });

// ── sprint:A1 ──
// Conveyance modes (D-037). Installed at the end of module evaluation; a mode
// that owns the camera this frame replaces the Deity keyboard code below.
let modeSystem = null;
// ── /sprint:A1 ──
function updateFpsControls(dt) {
  if (!fpsControls.enabled) return;
  // ── sprint:A1 ──
  if (modeSystem?.update(dt)) {
    fpsControls.active = true;   // holds OrbitControls off in tick()
    controls.enabled = false;
    materialResistance.cancel();
    return;
  }
  // ── /sprint:A1 ──

  const keys = fpsControls.keys;
  const hasFpsKey = ['w', 's', 'a', 'd', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
    .some(k => keys.has(k));

  fpsControls.active = hasFpsKey;

  if (!hasFpsKey) { materialResistance.cancel(); return; }

  // Disable OrbitControls while using FPS controls to prevent fighting
  controls.enabled = false;

  const moveSpeed = fpsControls.moveSpeed;
  const sprinting = keys.has('shift') || fpsControls.flightToggle;
  const speedMult = sprinting ? fpsControls.sprintMultiplier : 1.0;

  // Submerged check (12Jul26u): inside the Thames water volume the terrain
  // query below returns the CARVED BED, so the camera reads as "above ground"
  // at tiny altitude and the D-002 clamp pins speed to the 0.3× crawl. A
  // submerged camera is an underground-style regime: constant base speed.
  const submerged = isSubmergedAt(camera.position.x, camera.position.y, camera.position.z);

  // D-002 speed regimes (design LOCKED). Above ground, horizontal reach scales
  // with real altitude (0.3×–20× of base) so low flying is precise and high
  // flying covers ground fast. Below ground, constant base (no depth scaling) —
  // chalk slowdown will later come via substrateSpeedFactor. surfaceY===null
  // (terrain not yet loaded, or outside the mesh) falls to the constant base.
  _surfQuery.x = camera.position.x;
  _surfQuery.z = camera.position.z;
  const surfaceY = getTerrainMeshSurfaceY(_surfQuery);
  // ── sprint:A1 ──
  // D-037 water rule (supersedes D-020 §3): a submerged camera moves at the
  // speed just above the surface at the same point, not the constant base
  // (measured 500 vs 150 m/s, 3.33x). See src/modes/deity-speed.js.
  const regimeSpeed = deityRegimeSpeed({
    moveSpeed, y: camera.position.y, surfaceY, submerged, VE: VERTICAL_EXAGGERATION,
    waterSurfaceY: submerged ? waterSurfaceAt(camera.position.x, camera.position.z) : null,
  });
  const effectiveSpeed = regimeSpeed * speedMult * substrateSpeedFactor;
  fpsControls.lastSpeed = effectiveSpeed; // controller speed (scene units/s) for tests
  // ── /sprint:A1 ──

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
    // Vertical (Q/E) parity (12Jul26u, Jordan-locked): 1.0 — ON-SCREEN
    // scene-unit parity with horizontal. The old 2.5 factor compensated for
    // real-metre speed under VE=5, but what the eye tracks is scene units,
    // and unequal on-screen rates made Q/E feel sluggish next to WASD.
    displacement.y *= 1.0;
    const allowed=materialResistance.apply(camera.position,displacement,dt);
    camera.position.add(allowed);
    controls.target.add(allowed);
  } else materialResistance.cancel();

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
// When the user begins a rotate drag, adopt the DEPTH of whatever is under the
// pointer as the new orbit radius: controls.target is re-placed on the CURRENT
// view ray at the clicked point's depth. Only the target moves, and it stays
// on the view axis, so update()'s lookAt(target) is a no-op — zero camera
// translation AND zero rotation on engage. (The earlier translate-both
// approach — moving target AND camera by hit.point - target — preserved the
// OFFSET but not the VIEW: it teleported the camera by |hit - target|, ~25km
// at altitude, because target is habitually re-synced to a fixed 1000 units
// ahead of the camera by the FPS hand-back and intro finalize. The consult
// doc's "no visual jump" claim for that pattern was wrong.)
{
  const repivotRaycaster = new THREE.Raycaster();
  const lastNdc = new THREE.Vector2(0, 0);
  const _repivotDir = new THREE.Vector3();
  const _repivotTmp = new THREE.Vector3();
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
    if (ev.button === 0 && ev.pointerType === 'mouse') {
      // Refresh NDC here (capture fires before OrbitControls' bubble handler
      // dispatches 'start') so the raycast uses THIS click's pixel even when
      // no pointermove preceded it, e.g. first click after alt-tab.
      updateNdcFromEvent(ev);
      _dragActive = true;
    }
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

    // Re-pivot along the CURRENT view ray at the clicked point's depth. Only
    // controls.target moves, and it stays on the view axis, so update()'s
    // lookAt(target) is a no-op: zero camera motion on engage. Offset
    // DIRECTION is unchanged, so polar/azimuth clamps are untouched; clamping
    // the depth ourselves prevents update()'s internal radius clamp from
    // dollying the camera when a hit lies beyond maxDistance.
    camera.getWorldDirection(_repivotDir);
    const depth = _repivotTmp.copy(hits[0].point).sub(camera.position).dot(_repivotDir);
    if (!(depth > 0)) return; // degenerate / behind-camera guard
    const d = THREE.MathUtils.clamp(depth, controls.minDistance, controls.maxDistance);
    controls.target.copy(camera.position).addScaledVector(_repivotDir, d);
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
const initialMasterHeight = getUrlNumberParam('mh') ?? prefs.masterHeight ?? 1.1;
masterHeight.setValue(Number.isFinite(initialMasterHeight) ? initialMasterHeight : 1.1);
renderQuality.set({ scale: prefs.renderScale ?? 1, samples: prefs.edgeSamples ?? 4 });
let renderQualityMode = prefs.renderMode === 'manual' ? 'manual' : 'auto';
if (renderQualityMode === 'auto') adaptiveQuality.start(performance.now());

function setRenderQualityMode(next) {
  renderQualityMode = next === 'manual' ? 'manual' : 'auto';
  prefs.renderMode = renderQualityMode;
  if (renderQualityMode === 'auto') {
    adaptiveQuality.start(performance.now());
  } else {
    const quality = renderQuality.get();
    prefs.renderScale = quality.scale;
    prefs.edgeSamples = quality.samples;
  }
  savePrefs(prefs);
  syncRenderQualityUi();
}
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

// ── Buildings render path (06Sep26u) ──
//   'live'  — per-tile JSON: parse, M25 + river filter, terrain lookup, dedup
//             and InstancedMesh build on every tile arrival, repeated each time
//             a disposed tile re-enters LOAD_RADIUS. The path since day one.
//   'baked' — one precompiled UGB1 payload (scripts/bake-surface.mjs), whole
//             city resident from load, never disposed, no per-arrival work.
//
// LIVE IS THE DEFAULT and stays the default until the baked path has been
// assessed in Jordan's hands. ?buildings=baked overrides for one visit;
// the HUD toggle persists the choice.
const urlBuildingsPath = getUrlStringParam('buildings');
// Keep the live ground path for controlled comparison and graceful recovery.
let groundPath = getUrlStringParam('ground') === 'live' ? 'live' : 'baked';
let buildingsPath = (urlBuildingsPath === 'baked' || urlBuildingsPath === 'live')
  ? urlBuildingsPath
  : (prefs.buildingsPath === 'baked' ? 'baked' : 'live');

// Assigned by the HUD block below so an async payload failure can correct the
// toggle's label. Declared HERE, above that block: it is assigned at module
// evaluation, so a declaration further down the file is a TDZ throw at boot.
let renderBuildingsToggle = () => {};
let bridgesGroup = null;
let overgroundGroup = null;
let landmarkGroup = null;
let airportsGroup = null;
let airportInitError = null;
let airportDockGroup = null;
let airportDockInitError = null;
let motorwayGroup = null;
let motorwayInitError = null;
// ── sprint:F ──
// Living air traffic (flights.js). The integrator wires setWindSource(getSurfaceWind).
let flightsGroup = null;
let flightsInitError = null;
// ── /sprint:F ──
function syncMotorwayBridges() {
  if (!motorwayGroup || !bridgesGroup) return;
  for (const slug of MOTORWAY_REPLACED_BRIDGES) {
    const bridge = bridgesGroup.userData.registry.get(slug);
    if (bridge) bridge.group.visible = false;
  }
}
let airportFingerprintPromise = null;
let dlrProfile = null;
const dlrStationPoints = [];

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
  const scaleInput = document.getElementById('renderScale');
  const scaleValue = document.getElementById('renderScaleValue');
  const edgeInput = document.getElementById('edgeQuality');
  const modeInput = document.getElementById('renderMode');
  const syncQualityControls = () => {
    const q = renderQuality.get();
    const automatic = renderQualityMode === 'auto';
    if (modeInput) modeInput.value = renderQualityMode;
    if (scaleInput) scaleInput.disabled = automatic;
    if (edgeInput) edgeInput.disabled = automatic;
    if (scaleInput) scaleInput.value = String(Math.round(q.scale * 100));
    if (scaleValue) scaleValue.textContent = `${Math.round(q.scale * 100)}%`;
    if (edgeInput) edgeInput.value = String(q.samples);
  };
  const applyQualityControls = () => {
    if (renderQualityMode !== 'manual') return;
    const q = renderQuality.set({
      scale: scaleInput ? Number(scaleInput.value) / 100 : renderQuality.get().scale,
      samples: edgeInput ? Number(edgeInput.value) : renderQuality.get().samples,
    });
    prefs.renderScale = q.scale;
    prefs.edgeSamples = q.samples;
    savePrefs(prefs);
    syncQualityControls();
  };
  syncRenderQualityUi = syncQualityControls;
  syncQualityControls();
  modeInput?.addEventListener('change', () => setRenderQualityMode(modeInput.value));
  scaleInput?.addEventListener('input', () => {
    if (scaleValue) scaleValue.textContent = `${scaleInput.value}%`;
  });
  // Commit once on release, avoiding framebuffer reallocations during dragging.
  scaleInput?.addEventListener('change', applyQualityControls);
  edgeInput?.addEventListener('change', applyQualityControls);
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

  // ── s25:S ── Structures at true proportions (D-039, supersedes the D-023
  // Structure slider and the D-036 Structure 2 default). There is no Structure
  // control any more and the old bh= parameter is ignored: every structure's
  // height factor follows Master (1 / Master for VE5-authored geometry), so the
  // camera's Master / 5 display stretch cancels it and buildings, landmarks,
  // bridges, rail earthworks, airports and the M25 stand at real proportions
  // while the landscape under them is stretched. The shader uniforms (buildings,
  // tube bores, markers) follow at once; the CPU morphs (bridges, airports,
  // M25, rail, DLR resnap) are rate-limited as below.
  if (prefs.buildingHeight !== undefined) { delete prefs.buildingHeight; savePrefs(prefs); }
  // CPU morph cost measured on the M5 (25Sep26f): motorway ~145ms, airports
  // ~29ms, Overground ~21ms, bridges ~10ms, plus the DLR resnap. So during a
  // Master drag or the Pedestrian ease they run at most every MORPH_GAP_MS
  // (leading and trailing edge; the trailing pass always lands the final
  // value), while buildings, landmarks, bores, trains and markers follow Master
  // every frame for free.
  const MORPH_GAP_MS = 200;
  let lastMorphAt = -Infinity, morphTimer = null;
  const morphStructures = () => {
    if (morphTimer !== null) { clearTimeout(morphTimer); morphTimer = null; }
    structureMorph.pending = false;
    lastMorphAt = performance.now();
    const value = getBuildingHeightScale();
    landmarkGroup?.userData.setHeightScale(value);
    bridgesGroup?.userData.setHeightScale(value);
    overgroundGroup?.userData.setHeightScale(value);
    airportsGroup?.userData.setHeightScale(value);
    motorwayGroup?.userData.setHeightScale(value);
    if (dlrProfile && terrain && lineBranchCenterPts.has('dlr')) snapAllTubesToTerrain({ onlyLine: 'dlr' });
    refreshOvergroundStationMarkers();
    structureMorph.morphs++;
  };
  const scheduleMorph = () => {
    if (structureMorph.pending) return;
    structureMorph.pending = true;
    const wait = Math.max(0, lastMorphAt + MORPH_GAP_MS - performance.now());
    morphTimer = setTimeout(() => { morphTimer = null; requestAnimationFrame(() => { if (structureMorph.pending) morphStructures(); }); }, wait);
  };
  const applyStructureScale = ({ immediate = false } = {}) => {
    setBuildingHeightScale(structureHeightScale());
    // Landmarks are a group scale: free, so they never lag the terrain.
    landmarkGroup?.userData.setHeightScale(getBuildingHeightScale());
    syncHeightExplanation();
    if (immediate) morphStructures(); else scheduleMorph();
  };
  structureMorph.flush = () => { if (structureMorph.pending) morphStructures(); };
  applyStructureScale({ immediate: true });
  onMasterChange(() => applyStructureScale());
  // ── /s25:S ──

  const mhEl = document.getElementById('masterHeight');
  const mhOut = document.getElementById('masterHeightValue');
  const syncMasterHeight = () => {
    if (mhEl) mhEl.value = String(masterHeight.value);
    if (mhOut) mhOut.textContent = `${masterHeight.value.toFixed(1)}\u00d7`;
    syncHeightExplanation();
  };
  syncMasterHeight();
  mhEl?.addEventListener('input', () => {
    masterHeight.setValue(Number(mhEl.value));
    prefs.masterHeight = masterHeight.value;
    savePrefs(prefs);
    syncMasterHeight();
    _clearHoverForMotion?.();
  });
  mhEl?.addEventListener('change', () => {
    if (masterHeight.value === 1.1) deleteUrlParam('mh');
    else setUrlParam('mh', masterHeight.value);
  });

  // ── Baked city toggle (06Sep26u) ──
  // Swaps the buildings render path in place so a live/baked comparison happens
  // inside one session. Off is the live per-tile path and remains the default.
  //
  // Lives in THIS HUD block, not the fps-controls one that holds Fast flight:
  // both run at module evaluation, and only this one runs after `buildingsPath`
  // is initialised. Reading it from the earlier block is a TDZ throw at boot.
  const bakedBtn = document.getElementById('bakedBuildings');
  if (bakedBtn) {
    const renderBaked = () => {
      const on = buildingsPath === 'baked';
      bakedBtn.textContent = `Baked city: ${on ? 'on' : 'off'}`;
      bakedBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      bakedBtn.style.background = on ? 'rgba(201,184,150,0.22)' : 'rgba(255,255,255,0.06)';
      bakedBtn.style.borderColor = on ? 'rgba(201,184,150,0.55)' : 'rgba(255,255,255,0.14)';
      bakedBtn.style.color = on ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.88)';
    };
    renderBuildingsToggle = renderBaked;
    bakedBtn.addEventListener('click', () => {
      setBuildingsPath(buildingsPath === 'baked' ? 'live' : 'baked');
      renderBaked();
    });
    renderBaked();
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

// ── sprint:D ──
// Time-of-day sun (Dawn to Dusk) and near-camera shadows, persisted in prefs.
// Controls are inserted into the settings HUD above the Rendering row.
const sunSystem = createSunSystem({ renderer, scene, lights: atmosphereLights, prefs, savePrefs });
// ── s24:R ──
shadowCache = createShadowCache({ renderer, light: atmosphereLights.sun });
// ── /s24:R ──
sunSystem.mountControls(document.getElementById('renderMode')?.closest('p') ?? null);
// ── /sprint:D ──

// ── s24:S ──
// Visible sun disc and analytic sky (D-038). Looks switch with ?sky=<name> or
// the hidden Sky row (shown with ?sky=, or by double-clicking "Sun:").
// updateEnvironment drives it each frame; nothing else in the tick changes.
const skySystem = createSkySystem({ scene });
attachSky(skySystem);
skySystem.mountControls(document.getElementById('sunShadows')?.closest('p') ?? null);
// ── /s24:S ──

// Keep rim light for tube highlighting
const rim = new THREE.DirectionalLight(0x9bd6ff, 0.65);
rim.position.set(-60, 80, -40);
scene.add(rim);

// ---------- Thames (flat-level 3D volume) ----------
let thamesMesh = null;
let parkLabelsGroup = null;
let parkUndersideController = null;
let thamesProfileSampler = null;
// ── sprint:C ──
let seaLife = null; // silent sea life in the Thames, drawn only while submerged
// ── /sprint:C ──
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
    thamesProfileSampler = createThamesProfileSampler(thamesData?.points);
    tryCreateTerrainMesh({ opacity: 1.0, wireframe: false, thamesData }).then(result => {
      if (!result) {
        grid.visible = true;
        return;
      }
      terrain = result;
      scene.add(result.mesh);
      if (result.undersideMesh) scene.add(result.undersideMesh);
      if (result.contourLines) scene.add(result.contourLines);
      createParkLabels({getSurfaceY:getTerrainMeshSurfaceY}).then(group=>{
        parkLabelsGroup=group;
        scene.add(group);
      }).catch(error=>console.error('Park inscriptions unavailable:',error.message));

      // Replacements must exist before any live or baked airport buildings
      // are suppressed. Keep this group across buildings-path switches.
      try {
        airportsGroup = createAirports({ getSurfaceY: getStructuralSurfaceY,
          VE: VERTICAL_EXAGGERATION, heightScale: getBuildingHeightScale() });
        scene.add(airportsGroup);
        airportFingerprintPromise = airportSuppressionSignature(AIRPORT_DATA);
      } catch (error) {
        airportInitError = error.message;
        airportsGroup = null;
        console.warn(`Airport models unavailable (${error.message}); retaining generic buildings`);
      }
      // ── sprint:F ──
      try {
        flightsGroup?.userData.dispose();
        flightsGroup = createFlights({ getSurfaceY: getStructuralSurfaceY,
          VE: VERTICAL_EXAGGERATION, getHeightScale: getBuildingHeightScale });
        scene.add(flightsGroup);
      } catch (error) {
        flightsInitError = error.message;
        flightsGroup = null;
        console.warn(`Flights unavailable (${error.message})`);
      }
      // ── /sprint:F ──

      try {
        airportDockGroup=createAirportDockWater({VE:VERTICAL_EXAGGERATION});
        scene.add(airportDockGroup);
      } catch(error) {
        airportDockInitError=error.message;
        console.warn(`Airport dock water unavailable (${error.message}); retaining terrain`);
      }

      // Initialise Thames river corridor helpers before snapping tubes, because
      // the river-bed clearance clamp depends on the same corridor mask.
      if (thamesData?.points) {
        initThamesMask(thamesData.points);
        initThamesZones(thamesData.points);
      }

      // Reposition tubes + stations to terrain-relative depth, then snap shafts.
      snapAllTubesToTerrain();
      snapAllShaftsToTerrain();
      snapTidewayShaftsToTerrain(getStructuralSurfaceY);
      // ── s25:W ──
      // Victorian sewers under the modelled river bed, like the tube lines.
      clampSewersUnderRiverBed();
      // ── /s25:W ──

      // Build Thames 3D volume (flat water level, no terrain sampling needed)
      if (thamesData) {
        thamesMesh = createThamesVolume(thamesData, getTerrainMeshSurfaceY);
        if (thamesMesh) {
          scene.add(thamesMesh);
          underwaterSurface.setGeometry(thamesMesh.userData.surfaceGeometry);
        }

        // Register spatial audio sources (trains added dynamically, Thames static)
        initSpatialSources({
          trainSystem,
          thamesPoints: thamesData.points,
        });
      }

      // ── sprint:C ──
      // Sea life on the same cross-sections as the water volume. The octopus
      // clings to a drawn bridge pier, so the bridge axes come along too.
      if (thamesMesh && thamesData?.points) {
        fetch('/data/bridges.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
          .then(data => {
            seaLife = createSeaLife({ thamesPoints: thamesData.points, navigation: thamesMesh.userData.navigation,
              bridges: data?.bridges ?? [], VE: VERTICAL_EXAGGERATION, topY: WATER_TOP_Y, waterLevelM: WATER_LEVEL_M });
            scene.add(seaLife.group);
          }).catch(error => console.warn('Sea life unavailable:', error.message));
      }
      // ── /sprint:C ──

      createBridges({ getTerrainMeshSurfaceY, heightScale:getBuildingHeightScale() }).then(group => {
        if (group) {
          bridgesGroup = group;
          scene.add(bridgesGroup);
          syncMotorwayBridges();
          dbg('Bridges added to scene');
        }
      }).catch(err => {
        console.warn('Could not create Thames bridges:', err.message);
      });

      // Overground surface rail — needs the terrain mesh for at-grade Y (D-019)
      createOverground({ getTerrainMeshSurfaceY: getStructuralSurfaceY, projectStation: llToXZ, heightScale:getBuildingHeightScale() }).then(group => {
        if (group) {
          overgroundGroup = group;
          scene.add(overgroundGroup);
          initialiseOvergroundStations();
          dbg('Overground rail added to scene');
        }
      }).catch(err => {
        console.warn('Could not create Overground rail:', err.message);
      });

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
            if(airportDockGroup?.parent && airportDockGroup.visible) {
              // The old centreline dataset includes two dock ribbons. Clip
              // only their exact wet-polygon overlap, keeping connections.
              const materials=new Set();
              canalsMesh.traverse(mesh=>{if(mesh.isMesh)materials.add(mesh.material);});
              for(const material of materials)installAirportDockTerrainMask(material);
            }
            scene.add(canalsMesh);
            addCanalsToLegend();
            dbg('Canals added to scene');
          }
        }
      });

      // Apply M25 world boundary: mask terrain, add road ring + cliff pillar
      m25DataPromise.then(m25Data => {
        if (!m25Data?.points?.length) {
          // Dock water is independently sourced; its paired wet-polygon mask
          // must also exist when the optional M25 boundary fetch fails.
          if(airportDockGroup) {
            if(result.topMat)installAirportDockTerrainMask(result.topMat);
            if(result.undersideMat)installAirportDockTerrainMask(result.undersideMat);
          }
          applyRiverBedMaterial(result.topMat);
          return;
        }
        const supportPoints = m25Data.supportPoints || m25Data.points;
        // ── sprint:B ──
        // Map edge = outer face of the outer carriageway (D-037). Rendering
        // only: terrain/chalk mask, waterfalls, skirt notches and the cliff use
        // it; membership (isInsideM25) and the bake keep the support ring.
        let mapEdgePoints = supportPoints;
        try { mapEdgePoints = getMapEdgePointsBNG(); } catch (error) { console.warn(`Map edge unavailable (${error.message}); using support ring`); }
        // ── /sprint:B ──

        // Generate mask and apply to both terrain materials
        const maskTex = generateM25Mask(mapEdgePoints); // sprint:B
        if (result.topMat) applyM25Mask(result.topMat, maskTex);
        if (result.undersideMat) applyM25Mask(result.undersideMat, maskTex);
        // Exact wet polygons hide terrain only when their water replacement
        // exists. Chain after M25, whose installer owns the preceding hook.
        if(airportDockGroup) {
          if(result.topMat)installAirportDockTerrainMask(result.topMat);
          if(result.undersideMat)installAirportDockTerrainMask(result.undersideMat);
        }
        applyRiverBedMaterial(result.topMat);

        // Chalk floor — build now that the M25 ring is available (rim-flatten),
        // then clip it with the same mask as the terrain (same UV→world map).
        geologyGroup = createGeologicalStrata(supportPoints, sim.verticalScale);
        if (geologyGroup) {
          scene.add(geologyGroup);
          if (geologyGroup.userData.chalkMat) applyM25Mask(geologyGroup.userData.chalkMat, maskTex);
          addGeologyToLegend();
          dbg('Chalk floor added to scene');
        }

        // Both carriageways and Dartford routes use mapped OSM geometry.
        // Keep the established ring and curated bridges as failure fallback.
        try {
          motorwayGroup = createMotorway({ getSurfaceY: getStructuralSurfaceY,
            VE: VERTICAL_EXAGGERATION, heightScale: getBuildingHeightScale() });
          scene.add(motorwayGroup);
          syncMotorwayBridges();
        } catch (error) {
          motorwayInitError = error.message;
          console.warn(`Motorway unavailable (${error.message}); retaining previous road and bridges`);
          m25Road = createM25Road(m25Data.points, getStructuralSurfaceY);
          if (m25Road) scene.add(m25Road);
        }

        // Thames waterfalls at disc edge (needs both Thames and M25 data)
        let thamesCrossings = [];
        if (thamesData?.points?.length) {
          const waterfalls = createThamesWaterfalls(thamesData.points, mapEdgePoints, getTerrainMeshSurfaceY); // sprint:B
          if (waterfalls) scene.add(waterfalls);
          // Boundary crossings feed the skirt notch so water spills over cleanly.
          thamesCrossings = computeThamesCrossings(thamesData.points, mapEdgePoints, getTerrainMeshSurfaceY); // sprint:B
        }
        // ── sprint:B ──
        // The river ends at the cliff where its waterfall spills, rather than
        // floating on past the map edge (thames.json runs 3.4km W / 1km E past it).
        if (thamesMesh && mapEdgePoints !== supportPoints) {
          const edgeRing = getMapEdgeRing();
          trimRibbonVolumeToRing(thamesMesh.geometry, edgeRing);
          if (thamesMesh.userData.interiorShell) trimRibbonVolumeToRing(thamesMesh.userData.interiorShell.geometry, edgeRing);
        }
        // ── /sprint:B ──

        // Exterior tapered column (D1): clay disc skirt + fading chalk column.
        // FrontSide-outward, so invisible from inside the disc; the skirt is
        // notched at the Thames crossings so the waterfalls spill over the edge.
        geologyExteriorGroup = createGeologyExterior(
          mapEdgePoints, CHALK_TOP_Y, getTerrainMeshSurfaceY, thamesCrossings // sprint:B
        );
        if (geologyExteriorGroup) {
          geologyExteriorGroup.visible = geologyGroup ? geologyGroup.visible : true;
          scene.add(geologyExteriorGroup);
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
            // DEV-only arrival-cost accounting. Vite substitutes `false` for
            // import.meta.env.DEV in a production build and the branches are
            // eliminated, so this costs nothing shipped. It exists because the
            // remaining flight stutter has to be ATTRIBUTED rather than guessed
            // at: with buildings baked, whatever hitch survives is rasterise
            // (measured here) plus the tile's own JSON parse (measured in
            // scripts/measure-baked.mjs), and only one of those is worth a
            // second compiler.
            const _t0 = import.meta.env.DEV ? performance.now() : 0;

            // Rasterise parks + roads into persistent full-map texture
            if (surfaceTexState && groundPath === 'live') {
              rasteriseTile(surfaceTexState, tileData);
            }
            const _tRaster = import.meta.env.DEV ? performance.now() : 0;
            // A baked ground texture never changes on tile arrivals. The
            // loader runs only if at least one layer is live (or has fallen
            // back). Fully baked flight does not request source tile JSON.
            if (buildingsPath === 'baked') {
              if (import.meta.env.DEV) recordArrivalCost(_tRaster - _t0, 0);
              return;
            }

            // Filter buildings: M25 boundary + Thames river corridor exclusion
            const filteredBuildings = tileData.buildings
              ? tileData.buildings.filter(b => isInsideM25(b.cx, b.cz) && !isInThames(b.cx, b.cz))
              : [];
            // Create buildings as InstancedMesh for this tile
            const mesh = createTileBuildings(
              filteredBuildings, getStructuralSurfaceY,
              VERTICAL_EXAGGERATION, makeTileDedup(tileEntry.file),
              withOffMapSuppression(airportsGroup ? isAirportBuilding : null) // sprint:B
            );
            if (mesh) {
              mesh.name = `buildings-${tileEntry.file}`;
              surfaceGeometryGroup.add(mesh);
            }
            if (import.meta.env.DEV) recordArrivalCost(_tRaster - _t0, performance.now() - _tRaster);
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
        }).then(async manifest => {
          const fullBBox = getFullSceneBBox();

          // Create persistent 4096² texture spanning full M25 area
          if (groundPath === 'baked') {
            try {
              surfaceTexState = await loadBakedGround(fullBBox);
              renderer.initTexture(surfaceTexState.texture);
              dbg('Baked ground ready: full-city parks and roads');
            } catch (err) {
              groundPath = 'live';
              console.warn(`Baked ground unavailable (${err.message}); using live tiles`);
            }
          }
          if (!surfaceTexState) surfaceTexState = createSurfaceTexture(fullBBox, 4096);

          // Inject surface shader into terrain material (chains after M25 mask)
          if (result.topMat) {
            const uvBounds = sceneBBoxToUVBounds(fullBBox);
            applySurfaceTexture(result.topMat, surfaceTexState.texture, uvBounds);
            setSurfaceTextureEnabled(result.topMat, true); // hybrid surface on by default
            surfaceTextureMaterial = result.topMat;
          }
          if(result.undersideMat) {
            parkUndersideController=applyParkUndersideTexture(result.undersideMat,
              surfaceTexState.texture,sceneBBoxToUVBounds(fullBBox));
          }

          surfaceDataLoaded = true;
          dbg(`Surface loader ready: ${manifest.tiles.length} tiles, ${manifest.cols}×${manifest.rows} grid`);

          // Kick the baked payload only once the terrain and the group exist.
          // A failure here is NOT fatal and must not be: it falls back to the
          // live path, which is the whole point of keeping this behind a
          // switch. A missing payload on a deploy would otherwise be a blank
          // city rather than a slower one.
          if (buildingsPath === 'baked') activateBakedBuildings();
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
    unifiedShaftLayer.updateGroundYPositions(getStructuralSurfaceY);
  }
}

// Snap all tube centerPts, geometry, stations, and shaft platformY to terrain surface.
// Called once after terrain loads so that depth is terrain-relative, not sea-level-relative.
function snapAllTubesToTerrain({ onlyLine = null } = {}) {
  if (!terrain) return;
  let snappedTubes = 0;
  let snappedStations = 0;
  if (!onlyLine || onlyLine === 'dlr') dlrProfile?.refresh({ structureScale: getBuildingHeightScale() });

  // 4a. Update centerPt Y values to terrain-relative depth
  for (const [lineId, branches] of lineBranchCenterPts) {
    if (onlyLine && lineId !== onlyLine) continue;
    for (const branchPts of branches) {
      if (lineId === 'dlr') {
        dlrProfile.resnap(branchPts,{ structureScale:getBuildingHeightScale(), refreshTerrain:false });
        continue;
      }
      for (const pt of branchPts) {
        const surfaceY = getStructuralSurfaceY({ x: pt.x, z: pt.z });
        if (surfaceY !== null) {
          pt.y = surfaceY - (pt._depthM ?? 0) * sim.verticalScale;
        }
      }
    }
  }

  // 4a-ii. River-clearance clamp: ensure tubes pass below local river bed
  const VE = sim.verticalScale;
  const RIVER_BED_CLEARANCE_M = 2; // metres below local bathymetric bed
  const waterY = WATER_LEVEL_M * VE;
  const SYNTHETIC_RIVER_SAMPLE_M = 35;

  function riverClearanceY(x, z) {
    const prof = thamesProfileSampler?.sampleAt(x, z);
    const localDepthM = prof?.d ?? 3;
    return {
      y: waterY - (localDepthM + RIVER_BED_CLEARANCE_M) * VE,
      depthM: localDepthM,
    };
  }

  function isRiverCorridorPoint(x, z) {
    if (isInThames(x, z)) return true;
    const surfaceY = getTerrainMeshSurfaceY({ x, z });
    return surfaceY !== null && surfaceY <= waterY;
  }

  for (const [lineId, branches] of lineBranchCenterPts) {
    if (lineId === 'dlr' || (onlyLine && lineId !== onlyLine)) continue;
    for (const branchPts of branches) {
      for (const pt of branchPts) {
        if (isRiverCorridorPoint(pt.x, pt.z)) {
          const clearance = riverClearanceY(pt.x, pt.z);
          pt.y = Math.min(pt.y, clearance.y);
        }
      }
    }
  }

  // 4a-iii. Synthetic river-bed control points: prevent CatmullRom arcing into the river volume
  for (const [lineId, branches] of lineBranchCenterPts) {
    if (lineId === 'dlr' || (onlyLine && lineId !== onlyLine)) continue;
    for (const branchPts of branches) {
      for (let i = branchPts.length - 2; i >= 0; i--) {
        const a = branchPts[i];
        const b = branchPts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const horizontalLen = Math.sqrt(dx * dx + dz * dz);
        const sampleCount = Math.max(2, Math.ceil(horizontalLen / SYNTHETIC_RIVER_SAMPLE_M));
        const inserts = [];

        for (let j = 1; j < sampleCount; j++) {
          const t = j / sampleCount;
          const x = a.x + dx * t;
          const z = a.z + dz * t;
          if (!isRiverCorridorPoint(x, z)) continue;

          const clearance = riverClearanceY(x, z);
          const lerpY = a.y + (b.y - a.y) * t;
          if (lerpY <= clearance.y) continue;

          const synPt = new THREE.Vector3(x, clearance.y, z);
          synPt._depthM = clearance.depthM + RIVER_BED_CLEARANCE_M;
          synPt._synthetic = true;
          inserts.push(synPt);
        }

        if (inserts.length > 0) {
          branchPts.splice(i + 1, 0, ...inserts);
        }
      }
    }
  }

  // 4b. Rebuild tube geometry for each line
  for (const [lineId, branches] of lineBranchCenterPts) {
    if (onlyLine && lineId !== onlyLine) continue;
    const group = lineGroups.get(lineId);
    if (!group) continue;
    const colour = lineColoursById.get(lineId) ?? 0xffffff;

    // Remove old tube meshes and train groups from scene group
    const toRemove = [];
    for (const child of [...group.children]) {
      if (child === group) continue;
      // DLR height changes keep train phase/dwell state; only their paths move.
      if (lineId === 'dlr' && child.isGroup && child.userData.lineId === 'dlr') continue;
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
    // ...including crown ribbons (their geometry/material were already
    // disposed by the group-children sweep above; this is the bookkeeping).
    const oldRibbons = lineRibbonsById.get(lineId) || [];
    for (const m of oldRibbons) {
      const idx = linePickables.indexOf(m);
      if (idx >= 0) linePickables.splice(idx, 1);
    }
    lineRibbonsById.delete(lineId);

    // Remove old trains for this line from sim.trains
    if (lineId !== 'dlr') sim.trains = sim.trains.filter(t => {
      if (t.parent === group) return false;
      return true;
    });

    // Rebuild per branch
    const newMeshes = [];
    const mergedCenterPts = [];
    const ribbonCurves = [];

    for (const centerPts of branches) {
      if (centerPts.length < 2) continue;
      mergedCenterPts.push(...centerPts);

      const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);
      const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, twinTunnelsEnabled ? tunnelOffsetM : 0);

      const segs = lineSegmentCount(lineId, centerPts);
      const radius = boreRadiusM(lineId); // s25:S true bore, drawn round at every Master

      const leftMesh = new THREE.Mesh(tubeAxisAttribute(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false)), frostedTubeMaterial(colour)); // s25:S
      const rightMesh = new THREE.Mesh(tubeAxisAttribute(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false)), frostedTubeMaterial(colour)); // s25:S
      leftMesh.userData.lineId = lineId;
      rightMesh.userData.lineId = lineId;
      leftMesh.userData.type = 'tube-line';
      rightMesh.userData.type = 'tube-line';
      leftMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
      rightMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;

      newMeshes.push(leftMesh, rightMesh);
      linePickables.push(leftMesh, rightMesh);
      group.add(leftMesh, rightMesh);
      ribbonCurves.push({ curve: leftCurve, segments: segs, baseRadius: radius - 0.1 }, { curve: rightCurve, segments: segs, baseRadius: radius - 0.1 }); // s25:S

      // Recreate trains on new curves (density scales with track length)
      if (lineId === 'dlr' && centerPts._trains) {
        for (const train of centerPts._trains) {
          const ud=train.userData;ud.curve=ud.dir>0?leftCurve:rightCurve;
          ud.curveLengthM=ud.curve.getLength();ud.stationUs=stationUs;
          train.position.copy(ud.curve.getPointAt(ud.t));
        }
      } else {
        const branchTrains = createTrains({ system: trainSystem, leftCurve, rightCurve, stationUs, lineId, colour, group });
        if (lineId === 'dlr') centerPts._trains = branchTrains;
        sim.trains.push(...branchTrains);
      }
      snappedTubes++;
    }

    // Rebuild crown ribbons on the snapped curves (same helper as the
    // initial build in addLineFromStopPoints — keep the two sites in lockstep).
    attachCrownRibbons(lineId, colour, group, ribbonCurves);

    lineMeshesById.set(lineId, newMeshes);
    lineCenterPoints.set(lineId, mergedCenterPts);
  }

  // 4c. Update station markers (terrain-relative depth + surfaceY for labels)
  for (const [lineId, layers] of lineShaftLayers) {
    if (onlyLine && lineId !== onlyLine) continue;
    if (!layers.stationsLayer?.stations) continue;
    const stations = layers.stationsLayer.stations;

    for (const st of stations) {
      if (lineId === 'dlr') {
        const point=dlrProfile.station({id:st.id,nodeIndex:st.dlrProfile.nodeIndex,structureScale:getBuildingHeightScale()});
        st.pos.copy(point);st.depthM=point._depthM;st.dlrProfile=point._dlrProfile;
        st.surfaceY=getStructuralSurfaceY(st.pos);
        continue;
      }
      if (st.depthM == null) continue;
      const surfaceY = getStructuralSurfaceY({ x: st.pos.x, z: st.pos.z });
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
      mesh.computeBoundingSphere();
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
  if (data?.points?.length) initM25Boundary(data.supportPoints || data.points);
});

// ---------- Surface features (tiled progressive loading) ----------
let surfaceGeometryGroup = null;  // Parent group for per-tile building InstancedMeshes
let surfaceTextureMaterial = null; // Terrain material ref for texture toggle
let surfaceTexState = null;       // { texture, pixels, size, bbox } from createSurfaceTexture
let surfaceDataLoaded = false;

// Baked-buildings state. bakedMeshes is retained across a toggle back to
// 'live' so returning to 'baked' is a re-attach rather than a rebuild — an A/B
// comparison has to happen inside ONE browser session (camera state and
// OrbitControls settling both drift between reloads), so the swap must be cheap
// in both directions.
let bakedPayload = null;
let bakedBuilder = null;
let bakedMeshes = [];
let bakedLoadMs = 0;
let landmarkDataPromise = null;


// Per-frame slice spent turning payload records into instance matrices. Six
// milliseconds leaves room inside a 16.7ms budget on a machine already drawing
// the city; the whole 1.2M-building set completes in a fraction of a second of
// wall clock and then never runs again.
const BAKED_BUILD_BUDGET_MS = 6;

// Rolling per-arrival cost log, DEV only (see onTileLoaded). Bounded so a long
// session cannot grow it without limit.
const arrivalCosts = [];
function recordArrivalCost(rasteriseMs, buildingsMs) {
  arrivalCosts.push({ rasteriseMs, buildingsMs, at: performance.now() });
  if (arrivalCosts.length > 2000) arrivalCosts.shift();
}

/**
 * Load (once) and build the baked payload into the surface group.
 *
 * Failure is non-fatal by design: it warns, reverts to the live path and lets
 * the loader repopulate. A payload missing from a deploy must degrade to a
 * slower city, never a blank one.
 */
async function activateBakedBuildings() {
  if (!surfaceGeometryGroup) return;

  // Already built — a toggle back is a re-attach, not a rebuild.
  if (bakedMeshes.length) {
    for (const m of bakedMeshes) surfaceGeometryGroup.add(m);
    if (landmarkGroup) surfaceGeometryGroup.add(landmarkGroup);
    dbg(`Baked buildings: re-attached ${bakedMeshes.length} tile meshes`);
    return;
  }

  try {
    const t0 = performance.now();
    const airportFingerprint = airportsGroup ? await airportFingerprintPromise : null;
    landmarkDataPromise ||= fetchLandmarkFootprints().catch(err => { landmarkDataPromise = null; throw err; });
    const [payload, footprints] = await Promise.all([
      bakedPayload || fetchBakedBuildings(undefined, { airportFingerprint }), landmarkDataPromise,
    ]);
    bakedPayload = payload;
    bakedLoadMs = Math.round(performance.now() - t0);

    // The path may have been switched back while the fetch was in flight.
    if (buildingsPath !== 'baked') return;
    // A second toggle may have awaited the same fetch. The first activation
    // owns the incremental builder; never create a second set of tile meshes.
    if (bakedBuilder) {
      for (const mesh of bakedMeshes) surfaceGeometryGroup.add(mesh);
      if (landmarkGroup) surfaceGeometryGroup.add(landmarkGroup);
      return;
    }

    if (!landmarkGroup) landmarkGroup = createLandmarkModels(footprints, {
      getSurfaceY: getStructuralSurfaceY,
      VE: VERTICAL_EXAGGERATION,
      heightScale: getBuildingHeightScale(),
    });
    surfaceGeometryGroup.add(landmarkGroup);

    bakedBuilder = createBakedBuildingBuilder(bakedPayload, {
      VE: VERTICAL_EXAGGERATION,
      material: getBuildingMaterial(),
      suppressBuilding: withOffMapSuppression(airportsGroup && !bakedPayload.airportSuppression ? isAirportBuilding : null), // sprint:B
      onMesh: (mesh) => {
        bakedMeshes.push(mesh);
        // A switch during the incremental build must not mix both cities.
        if (buildingsPath === 'baked') surfaceGeometryGroup.add(mesh);
      },
    });
    dbg(`Baked buildings: ${(bakedPayload.bytes / 1048576).toFixed(2)}MB, ${bakedPayload.buildings.toLocaleString()} buildings across ${bakedPayload.tiles.length} tiles, fetched+parsed in ${bakedLoadMs}ms`);
  } catch (err) {
    console.warn(`Baked buildings unavailable (${err.message}) — falling back to the live tile path`);
    buildingsPath = 'live';
    bakedBuilder = null;
    resetLoadedTiles();
    // The toggle already painted itself 'on' before the fetch resolved. Without
    // this it keeps claiming a path that is not running.
    renderBuildingsToggle();
  }
}

/** Detach the baked meshes without discarding them. */
function deactivateBakedBuildings() {
  for (const m of bakedMeshes) surfaceGeometryGroup?.remove(m);
  if (landmarkGroup) surfaceGeometryGroup?.remove(landmarkGroup);
}

/** Remove every live per-tile building mesh from the surface group. */
function clearLiveBuildingMeshes() {
  if (!surfaceGeometryGroup) return 0;
  const live = surfaceGeometryGroup.children.filter(c => c.name?.startsWith('buildings-'));
  for (const m of live) {
    surfaceGeometryGroup.remove(m);
    disposeTileGeometry(m);
  }
  return live.length;
}

/**
 * Switch the buildings render path at runtime.
 *
 * A reload would be simpler, but the comparison this exists to serve has to
 * happen in one session: OrbitControls.update() runs even with controls
 * disabled, so two visits to the same camera coordinates settle differently and
 * matched captures taken across a reload are not matched.
 *
 * @param {'live'|'baked'} next
 */
function setBuildingsPath(next) {
  if (next !== 'live' && next !== 'baked') return;
  if (next === buildingsPath) return;
  buildingsPath = next;
  prefs.buildingsPath = next;
  savePrefs(prefs);
  if (next === 'live') deleteUrlParam('buildings'); else setUrlParam('buildings', next);

  if (next === 'baked') {
    const cleared = clearLiveBuildingMeshes();
    dbg(`Buildings path -> baked (cleared ${cleared} live tile meshes)`);
    activateBakedBuildings();
  } else {
    deactivateBakedBuildings();
    // Loaded tiles hold no building meshes while baked was active, so they have
    // to re-fire onTileLoaded. Returning them to 'idle' sends them back through
    // the ordinary arrival path rather than inventing a second one.
    const reset = resetLoadedTiles();
    dbg(`Buildings path -> live (${reset} tiles queued for reload)`);
  }
}

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
      if (terrain) snapTidewayShaftsToTerrain(getStructuralSurfaceY);
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
let geologyExteriorGroup = null;

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
  // TfL canonical DLR teal. Added 10Jul26f (Item A) — DLR previously fell
  // through to the 0xffffff white fallback, so this also re-tints the DLR
  // tunnels themselves (deliberate, flagged).
  dlr: 0x00a4a7,
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
// Crown ribbon meshes by lineId (colour ribbon + optional casing). SEPARATE
// from lineMeshesById on purpose: setHoverHighlight hard-resets every mesh in
// that map with glass-material values (opacity 0.42 / thickness 0.6) that
// would stomp the opaque ribbon material.
const lineRibbonsById = new Map();


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

// D-021 (05Sep26s, Jordan's call: "sharp is fine, makes no visible difference").
// Tube glass without `transmission`. This completes the 10Jul26f transparency
// pass, which dropped transmission from shafts.js and tideway.js on taste
// grounds but never touched the tube lines. What is behind the glass now shows
// through sharp instead of refracted and blurred — visible only underground and
// close up. The cost it removes is not cosmetic: a transmissive material makes
// three.js run a full second scene render into its own MSAA HalfFloat target
// with a mip chain, 1,228 extra draw calls here. Measured +33% overview /
// +32% street / +27% underground (M5, dpr 2).
//
// Unlike the shafts, opacity is NOT compensated upward (they went 0.27 -> 0.33).
// Jordan assessed the uncompensated A/B and passed it; if the tubes ever read
// thin, ~0.50 is the equivalent bump. thickness / ior / attenuation* are gone
// because they are inert without transmission, not because the look changed.
function frostedTubeMaterial(hex) {
  const { base, emissive } = brightenIfTooDark(hex);
  return patchTrueProportionMaterial(new THREE.MeshPhysicalMaterial({ // s25:S round bore at every Master
    color: base,
    transparent: true,
    opacity: 0.42,
    roughness: 0.45,
    metalness: 0.0,
    transmission: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.6,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: 0.0,
    fog: true,
    depthWrite: true,
  }), { mode: 'axis' });
}

// Geo projection: lon/lat -> x/z in *metres* (local tangent plane-ish), centred on London.
// This makes scene units ≈ metres, so train speeds and station spacing can feel real.
// Shared OSGB36/BNG definition and exact origin live in coordinates.js.

function llToXZ(lat, lon) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]);
  const x = (e - BNG_REF_E) * sim.horizontalScale;
  const z = -(n - BNG_REF_N) * sim.horizontalScale;
  return { x, z };
}

let miniMap = null;
try {
  miniMap = createMiniMap({ camera, projectStation: llToXZ, onFocus: () => fpsControls.keys.clear() });
} catch (error) {
  console.warn(`Tube orientation map unavailable: ${error.message}`);
}
try {
  dlrProfile = createDlrProfile({ project: llToXZ, sampleSurfaceY: getStructuralSurfaceY, verticalExaggeration: VERTICAL_EXAGGERATION });
} catch (error) {
  console.warn(`DLR elevation profile unavailable: ${error.message}`);
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
  const indices = centerPts._stationIndices || cum.map((_,i)=>i);
  return indices.map(i => cum[i] / total);
}

function lineSegmentCount(lineId,points) {
  if(lineId!=='dlr')return Math.max(80,points.length*10);
  let length=0;for(let i=1;i<points.length;i++)length+=points[i].distanceTo(points[i-1]);
  return Math.max(80,Math.ceil(length/25));
}

function dlrLocationLabel(profile) {
  if(!profile)return 'DLR';
  const names={elevated:'Elevated railway',embankment:'Railway embankment',surface:'Surface railway',tunnel:'Underground railway',cutting:'Railway cutting',portal:'Tunnel portal'};
  const name=names[profile.classification]||'DLR';
  if(profile.classification==='portal')return name;
  const relative=profile.groundRelativeM;
  return Number.isFinite(relative)?`${name} · ~${Math.abs(relative).toFixed(1)}m ${relative<0?'below':'above'} ground (modelled)`:name;
}

function syncHeightExplanation() {
  const element=document.getElementById('heightExplanation');
  // ── s25:S ──
  if(element)element.textContent=`Master stretches the landscape ${masterHeight.value.toFixed(1)}× (terrain, river bed, geology and depths). Buildings and every structure stay at their true proportions.`;
  // ── /s25:S ──
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

// Crown ribbons (Item A): one merged colour-ribbon mesh per line (+ one
// casing mesh for CASING_LINES), built over the SAME offset curves as the
// tunnels — one ribbon per tunnel crown, left AND right (both carry trains).
// Shared by addLineFromStopPoints AND the snapAllTubesToTerrain 4b rebuild so
// the two sites cannot drift. Ribbons are pickable (Tier-2/3 hover from
// above) and live in lineRibbonsById, NOT lineMeshesById (hover-stomp trap).
function attachCrownRibbons(lineId, colour, group, ribbonCurves) {
  const ribbons = buildCrownRibbons({
    lineId,
    colour,
    curves: ribbonCurves,
    userData: { lineId, type: 'tube-line' },
  });
  for (const rm of ribbons) {
    group.add(rm);
    linePickables.push(rm);
  }
  lineRibbonsById.set(lineId, ribbons);
  return ribbons;
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
  const ribbonCurves = []; // per-tunnel-crown curves for the merged ribbon build

  for (const branchStops of branchArrays) {
    const validStopPoints = branchStops.filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon));
    if (validStopPoints.length < 2) continue;

    const interpolateDepth = buildDepthInterpolator(validStopPoints, depthAnchors);
    let centerPts = [];

    if (lineId === 'dlr') {
      const branch=dlrProfile.buildBranch({points:validStopPoints,structureScale:getBuildingHeightScale()});
      centerPts=branch.points;centerPts._stationIndices=branch.stationIndices;
      dlrStationPoints.push(...branch.stationPoints);
    } else {

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
    }

    allCenterPts.push(...centerPts);
    allBranchCenterPts.push(centerPts);

    const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);
    const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, twinTunnelsEnabled ? tunnelOffsetM : 0);

    const segs = lineSegmentCount(lineId, centerPts);
    const radius = boreRadiusM(lineId); // s25:S true bore, drawn round at every Master

    const leftMesh = new THREE.Mesh(tubeAxisAttribute(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false)), frostedTubeMaterial(colour)); // s25:S
    const rightMesh = new THREE.Mesh(tubeAxisAttribute(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false)), frostedTubeMaterial(colour)); // s25:S
    leftMesh.userData.lineId = lineId;
    rightMesh.userData.lineId = lineId;
    leftMesh.userData.type = 'tube-line';
    rightMesh.userData.type = 'tube-line';
    leftMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    rightMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;

    allMeshes.push(leftMesh, rightMesh);
    linePickables.push(leftMesh, rightMesh);
    group.add(leftMesh, rightMesh);
    ribbonCurves.push({ curve: leftCurve, segments: segs, baseRadius: radius - 0.1 }, { curve: rightCurve, segments: segs, baseRadius: radius - 0.1 }); // s25:S

    // Trains per branch (density scales with track length)
    const branchTrains = createTrains({ system: trainSystem, leftCurve, rightCurve, stationUs, lineId, colour, group });
    if (lineId === 'dlr') centerPts._trains = branchTrains;
    sim.trains.push(...branchTrains);
    allTrains.push(...branchTrains);
  }

  // Crown ribbons: merged per line, added to the line group so the solo-line
  // dropdown filters them for free.
  attachCrownRibbons(lineId, colour, group, ribbonCurves);

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
let tubeStationsReady = false;
function refreshOvergroundStationMarkers(){
  if(!overgroundGroup?.userData.stationsAttached)return;
  const dummy=new THREE.Object3D();
  for(const {id,stations} of overgroundGroup.userData.stationSets){
    const mesh=lineShaftLayers.get(id)?.stationsLayer?.mesh;if(!mesh)continue;
    stations.forEach((st,i)=>{dummy.position.copy(st.pos);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
  }
}
function initialiseOvergroundStations() {
  if (!tubeStationsReady || !overgroundGroup || overgroundGroup.userData.stationsAttached) return;
  const servedBy=new Map();
  for(const {stationsLayer} of lineShaftLayers.values())for(const station of stationsLayer.stations) {
    const name=cleanStationName(station.name);servedBy.set(name,Math.max(servedBy.get(name)||0,station.lineCount||1));
  }
  for(const {stations} of overgroundGroup.userData.stationSets)for(const station of stations) {
    const name=cleanStationName(station.name);servedBy.set(name,(servedBy.get(name)||0)+1);
  }
  for (const {id,colour,stations} of overgroundGroup.userData.stationSets) {
    for(const station of stations)station.lineCount=servedBy.get(cleanStationName(station.name))||1;
    const stationsLayer=createStationMarkers({scene,stations,colour,size:6,labels:true,surfaceOnly:true});
    stationsLayer.mesh.visible=stationsVisible;
    stationsLayer.setLabelsVisible(labelsVisible);
    lineShaftLayers.set(id,{stationsLayer});
  }
  overgroundGroup.userData.stationsAttached=true;
}
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
      if (geologyExteriorGroup) geologyExteriorGroup.visible = val === 'all' || val === 'geology';
      if (reservoirsMesh) reservoirsMesh.visible = val === 'all' || val === 'reservoirs';
      if (canalsMesh) canalsMesh.visible = val === 'all' || val === 'canals';
      if (sewersMesh) sewersMesh.visible = val === 'all' || val === 'sewers';

      // Surface features: hybrid (texture + geometry) enabled for "all" mode
      if (surfaceTextureMaterial) {
        setSurfaceTextureEnabled(surfaceTextureMaterial, val === 'all' || val === 'surface-texture' || val === 'surface-hybrid');
      }
      parkUndersideController?.setEnabled(val==='all'||val==='surface-texture'||val==='surface-hybrid');
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
      _s24TubeProgress = total ? current / total : 0; // s24:O (the opening gate owns the bar)
      const fill = document.getElementById('loadingFill');
      if (fill && intro.isBypassed()) {
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
          for (const branchStops of id==='dlr'?[]:branchArrays) {
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

          const sourceStops=new Map(sps.map(sp=>[sp.id,sp]));
          const stations = id==='dlr' ? [...new Map(dlrStationPoints.map(p=>[`${p.stationId}:${p._dlrProfile.nodeIndex}`,p])).values()].map(p=>({
            id:p.stationId,name:sourceStops.get(p.stationId)?.name || dlrProfile.data.stations[p.stationId].name,
            pos:p.clone(),depthM:p._depthM,dlrProfile:p._dlrProfile,network:'dlr',
            lineCount:stationLineCount.get(p.stationId)||1,isTerminus:terminusIds.has(p.stationId),
          })) : sps
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
              needsShaft: st.dlrProfile?.needsShaft,
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
      getTerrainMeshSurfaceY: terrain ? getStructuralSurfaceY : null,
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
      snapTidewayShaftsToTerrain(getStructuralSurfaceY);
    }

    tubeStationsReady = true;
    initialiseOvergroundStations();

    // Loading complete: set bar to 100% and hide it
    updateLoadingProgress(totalLines, totalLines);
    // Ensure minimum display time so loading feedback is visible even with fast cache
    const MIN_LOADING_DISPLAY_MS = 1200;
    const elapsed = Date.now() - window.loadingStartTime;
    const remaining = Math.max(0, MIN_LOADING_DISPLAY_MS - elapsed);
    setTimeout(() => {
      const loadingBar = document.getElementById('loadingBar');
      // s24:O: with the opening, the gate fades the bar when the whole
      // readiness set is complete; deep links keep this tube-line bar.
      if (loadingBar && intro.isBypassed()) loadingBar.classList.add('done');
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
// Existing Share link now includes an exact canonical camera pose. A valid
// view is an intentional location deep-link and follows the intro skip path.
const sharedView = getUrlStringParam('view')?.split(',').map(Number);
if (sharedView?.length === 6 && sharedView.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6)) {
  const position = new THREE.Vector3(...sharedView.slice(0,3));
  const target = new THREE.Vector3(...sharedView.slice(3));
  if (position.distanceToSquared(target) > .01) {
    camera.position.copy(position);
    controls.target.copy(target);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }
}
initIntroTuner({ intro, camera, controls });

// ── s24:O ──
// Opening gate (D-038): the honest loading bar holds the descent until what it
// shows is ready, shaders are compiled and warm-up frames rendered; then the
// descent plays silently from frame 0 (src/loading-gate.js). Deep links keep
// the compact tube-line bar over a progressively building scene (D-028).
let _s24TubeProgress = 0;
const _s24Failed = new Set();
thamesDataPromise.then(d => { if (!d?.points?.length) _s24Failed.add('thames'); }, () => _s24Failed.add('thames'));
m25DataPromise.then(d => { if (!d?.points?.length) _s24Failed.add('m25'); }, () => _s24Failed.add('m25'));
reservoirDataPromise.then(d => { if (!d) _s24Failed.add('reservoirs'); }, () => _s24Failed.add('reservoirs'));
canalDataPromise.then(d => { if (!d) _s24Failed.add('canals'); }, () => _s24Failed.add('canals'));
// Live path (the default without ?buildings=baked): waiting for every tile
// within the loader's 12km of both poses measured ~22s on the M5, over the
// plan's ~20s limit, so the bar waits for the descent's footprint instead:
// tiles whose centres lie within 6km of the path's ground track (about 34
// tiles, ~10s). The rest wait while the descent plays (see the loader call in
// tick) and then stream in, nearest first, after landing.
const S24_FOOTPRINT_M = 6000;
function _s24FootprintTiles() {
  if (!surfaceDataLoaded) return false;
  const p = intro.getParams();
  const vx = p.endX - p.startX, vz = p.endZ - p.startZ, vv = vx * vx + vz * vz || 1;
  let total = 0, settled = 0;
  for (const t of getSurfaceTileStates()) {
    const u = Math.max(0, Math.min(1, ((t.cx - p.startX) * vx + (t.cz - p.startZ) * vz) / vv));
    if (Math.hypot(t.cx - p.startX - vx * u, t.cz - p.startZ - vz * u) > S24_FOOTPRINT_M) continue;
    total++;
    if (t.state === 'loaded' || t.state === 'disposed') settled++;
  }
  return total && settled === total ? true : (total ? settled / total : false);
}
const _s24Or = (ready, failedKey) => ready ? true : (_s24Failed.has(failedKey) ? 'failed' : false);
const openingGate = createOpeningGate({
  intro, renderer, composer, scene, camera,
  el: document.getElementById('loadingBar'),
  coreIds: ['terrain', 'ground', 'buildings', 'tube'],
  items: [
    { id: 'terrain', label: 'Shaping the terrain', weight: 4,
      check: () => terrain ? true : (scene.children.some(c => c.isGridHelper && c.visible) ? 'failed' : false) },
    { id: 'water', label: 'Filling the Thames', weight: 1, check: () => _s24Or(!!thamesMesh, 'thames') },
    { id: 'm25', label: 'Laying the M25', weight: 1,
      check: () => _s24Or(!!(motorwayGroup || m25Road) && !!geologyGroup && !!geologyExteriorGroup, 'm25') },
    { id: 'airports', label: 'Building the airports', weight: 1, check: () => !!airportsGroup || !!airportInitError },
    { id: 'ground', label: 'Painting the ground', weight: 2,
      check: () => surfaceDataLoaded && (groundPath === 'baked' || _s24FootprintTiles() === true) },
    { id: 'buildings', label: 'Raising the buildings', weight: 4, check: () => {
      if (buildingsPath === 'baked') {
        if (!bakedBuilder) return false;
        const st = bakedBuilder.stats();
        return bakedBuilder.isDone() && !!landmarkGroup ? true : (st.tilesTotal ? st.tilesBuilt / st.tilesTotal : false);
      }
      return _s24FootprintTiles();
    } },
    { id: 'tube', label: 'Tracing the tube lines', weight: 3,
      check: () => tubeStationsReady && !!unifiedShaftLayer && document.querySelector('.station-label') ? true : _s24TubeProgress },
    { id: 'reservoirs', label: 'Filling the reservoirs', weight: 0.5, check: () => _s24Or(!!reservoirsMesh, 'reservoirs') },
    { id: 'canals', label: 'Cutting the canals', weight: 0.5, check: () => _s24Or(!!canalsMesh, 'canals') },
    { id: 'bridges', label: 'Spanning the river', weight: 0.5, check: () => !!bridgesGroup },
    { id: 'overground', label: 'Running the Overground', weight: 0.5,
      check: () => !!overgroundGroup?.userData?.stationsAttached },
    { id: 'parks', label: 'Naming the parks', weight: 0.5, check: () => !!parkLabelsGroup },
    { id: 'infrastructure', label: 'Tunnelling the infrastructure', weight: 1,
      check: () => !!(crossrailMesh && tidewayMesh && sewersMesh) },
  ],
  beforeCompile: () => { for (const child of scene.children) applyShadowPolicy(child); },
  whileWaiting: () => {
    // Behind the bar the frame is not being watched: spend more of it
    // building the baked city (the tick spends its usual 6ms slice as well).
    if (bakedBuilder && !bakedBuilder.isDone()) bakedBuilder.pump(24);
    // Live tiles load around the camera; also load around the landing, so
    // the descent does not stream tiles in (load 12km, unload 18km, and the
    // two poses are about 2.2km apart). Alternate 500ms loader windows.
    if (surfaceDataLoaded && !(buildingsPath === 'baked' && groundPath === 'baked')
      && Math.floor(performance.now() / 500) % 2 === 1) {
      const p = intro.getParams();
      updateSurfaceLoader(p.endX, p.endZ);
    }
  },
});
if (intro.isBypassed()) document.getElementById('loadingBar')?.classList.remove('veil');
// ── /s24:O ──

buildNetworkMvp();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderQuality.resize();
  lensSystem.updateAspect(camera.aspect);
});

// Module-level reference for the tooltip formatter — populated from inside the
// bare-block scope below so __ug (and tests) can call it directly.
let _formatInfraTooltipRef = null;
let _clearHoverForMotion = null;

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
      if (layers.stationsLayer?.mesh?.visible) {
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
    // Crown ribbons keep their own baselines (opaque material — never touch
    // opacity/thickness, only the emissive affordance).
    for (const ribbons of lineRibbonsById.values()) {
      for (const m of ribbons) {
        if (!m?.material) continue;
        m.material.emissiveIntensity = m.userData._baseEmissive ?? 0.22;
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
    const ribbons = lineRibbonsById.get(lineId);
    if (ribbons) {
      for (const m of ribbons) {
        if (!m?.material) continue;
        m.material.emissiveIntensity = m.userData._hoverEmissive ?? 0.45;
      }
    }
  }

  function moveStationTip(ev, station) {
    if (!tip) return;
    if (!station) {
      // Don't hide here - let line hover take over
      return;
    }

    const depthM = station.depthM;
    const depthLabel = station.network==='dlr' ? dlrLocationLabel(station.dlrProfile)
      : station.network==='overground' ? `London Overground · ${overgroundGroup.userData.registry.get(station.lineId).name} line` : depthM > 0 ? `${Math.round(depthM)}m below ground` : 'Surface station';

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
    'landmark': 0, 'airport': 0,
    'tideway-shaft': 1, 'lee-shaft': 1, 'crossrail': 1, 'chalk-marker': 1,
    'tideway-tunnel': 2, 'lee-tunnel': 2, 'sewer': 2, 'station-shaft': 2,
    'tube-line': 3, 'overground-line': 3, 'motorway': 3,
    'canal': 3, 'reservoir': 3,
    'thames': 4, 'airport-dock': 4, 'chalk': 4,
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
    const sources = [tidewayMesh, crossrailMesh, sewersMesh, reservoirsMesh, canalsMesh, geologyGroup, thamesMesh, overgroundGroup, unifiedShaftLayer?.group];
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
    if (landmarkGroup?.parent && landmarkGroup.visible && surfaceGeometryGroup.visible) {
      pickables.push(...landmarkGroup.userData.pickables);
    }
    if (airportsGroup?.visible) pickables.push(...airportsGroup.userData.pickables);
    if (motorwayGroup?.visible) pickables.push(...motorwayGroup.userData.pickables);
    if (airportDockGroup?.visible) pickables.push(...airportDockGroup.userData.pickables);
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
    const infraSources = [tidewayMesh, crossrailMesh, sewersMesh, reservoirsMesh, canalsMesh, geologyGroup, thamesMesh, overgroundGroup, airportsGroup, airportDockGroup, motorwayGroup, unifiedShaftLayer?.group];
    for (const src of infraSources) {
      if (src) src.updateMatrixWorld(true);
    }
    // Tube line meshes live in lineGroups; refresh world matrices so picks land on correct geometry.
    for (const g of lineGroups.values()) g.updateMatrixWorld(true);

    const hits = raycaster.intersectObjects(pickables, true).filter(hit=>{
      // Raycasting cannot see fragment-shader clipping. Mirror the exact
      // wet-polygon mask at the actual intersection, not the canal centre.
      return !(hit.object.userData?.type==='canal' && airportDockGroup?.parent
        && airportDockGroup.visible && getAirportDockInfo(hit.point));
    });
    if (hits.length === 0) return null;

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
    return { mesh: best.object, hitPoint: best.point, faceIndex: best.faceIndex };
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
  function formatInfraTooltip(mesh, hitPoint = null, faceIndex = null) {
    const ud = mesh.userData;
    const t = ud.type;
    if (t === 'tube-line' && ud.lineId === 'dlr') {
      const point=hitPoint?dlrProfile.sample({x:hitPoint.x,z:hitPoint.z,structureScale:getBuildingHeightScale()}):null;
      return `<b>DLR</b>${point?`<div class="sub">${dlrLocationLabel(point._dlrProfile)}</div>`:''}`;
    }
    if (t === 'motorway') return '<b>M25 / A282</b><div class="sub">Orbital motorway · mapped carriageways and modelled road profile</div>';
    if(t==='airport-dock') {
      const name=ud.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      return `<b>${name}</b><div class="sub">Impounded dock water</div>${_renderInfraTable([['REFERENCE LEVEL',`${ud.referenceLevelM.toFixed(2)}m AOD`]])}<div class="sub">Published reference level; not a live measurement</div>`;
    }
    if (t === 'airport') {
      const info = getAirportHoverInfo(mesh, faceIndex);
      const safeName = info.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      return `<b>${safeName}</b>${_renderInfraTable([['HEIGHT',info.heightM ? `${info.heightM}m` : null]])}`;
    }
    if(t === 'overground-line')return `<b>${overgroundGroup.userData.registry.get(ud.lineId).name} line</b><div class="sub">London Overground</div>`;
    if(t === 'landmark') {
      const info=LANDMARK_INFO[ud.landmarkId];
      return `<b>${info.name}</b>${_renderInfraTable([['HEIGHT',info.height],[info.dateLabel || 'COMPLETED',info.date]])}`;
    }

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
        const chainM = nearestThamesSegment(hitPoint.x, hitPoint.z);
        if (chainM !== null) zone = getZoneAt(chainM);
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

  function moveInfraTip(ev, mesh, hitPoint = null, faceIndex = null) {
    if (!tip || !mesh) return;
    tip.innerHTML = formatInfraTooltip(mesh, hitPoint, faceIndex);
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
    if (_dragActive || fpsControls.active) {
      onPointerLeave();
      return;
    }

    // Tier 1: Station hover (highest priority)
    const station = pickStationUnderPointer(ev);
    if (station) {
      moveStationTip(ev, station);
      setHoverHighlight(null);
      return;
    }

    // ── sprint:F ──
    // Aircraft: screen-space pick (small, fast-moving), only from above ground.
    if (flightsGroup?.visible) {
      const groundY = getStructuralSurfaceY({ x: camera.position.x, z: camera.position.z });
      if (!Number.isFinite(groundY) || camera.position.y > groundY) {
        getMouseNdc(ev);
        const flight = flightsGroup.userData.pick(mouse, camera, renderer.domElement.getBoundingClientRect());
        if (flight && tip) {
          tip.innerHTML = flightsGroup.userData.formatLabel(flight);
          tip.style.display = 'block';
          lastHoverLineId = null;
          tip.style.transform = `translate(${(ev.clientX ?? 0) + 12}px, ${(ev.clientY ?? 0) + 14}px)`;
          setHoverHighlight(null);
          return;
        }
      }
    }
    // ── /sprint:F ──

    // Tier 2: Infrastructure hover
    const infraHit = pickInfraUnderPointer(ev);
    if (infraHit) {
      moveInfraTip(ev, infraHit.mesh, infraHit.hitPoint, infraHit.faceIndex);
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
  _clearHoverForMotion = onPointerLeave;

  function onPointerDown(ev) {
    // Only left click / primary.
    // Ordinary clicks have no action here. Avoid an unused full line raycast
    // on every orbit start; Shift-click keeps the exact existing selection.
    if (ev.button !== 0 || !ev.shiftKey) return;

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
      masterHeight.setValue(1.1);
      for (const key of ['mh', 'bh', 'fl', 't', 'hx']) deleteUrlParam(key);
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
      const text = getShareUrl();

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

function getShareUrl(base = location.href) {
  const url = new URL(base);
  url.searchParams.set('t', String(sim.timeScale));
  url.searchParams.set('hx', String(sim.horizontalScale));
  url.searchParams.set('buildings', buildingsPath);
  url.searchParams.set('fl', String(lensSystem.getFocalLength()));
  url.searchParams.set('mh', String(masterHeight.value));
  url.searchParams.delete('bh'); // s25:S: structures are always true; bh= is ignored
  const direction=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  const target=camera.position.clone().addScaledVector(direction,1000);
  url.searchParams.set('view',[...camera.position.toArray(),...target.toArray()].map(n=>n.toFixed(3)).join(','));
  return url.toString();
}

// Non-direction keyboard shortcuts removed — only S/W/X/A/D, Q/E, arrows remain active.

// ---------- Animate ----------
let lastFrameTime = null;
function tick(frameTime) {
  // Integrate against the display frame, not callback scheduling jitter.
  // GPU/DOM work can delay JS within a frame without changing its timestamp.
  const dt = lastFrameTime === null ? 0 : Math.max(0, (frameTime - lastFrameTime) / 1000);
  lastFrameTime = frameTime;

  // ── s24:O ──
  // Opening gate first: it may start the descent, whose frame 0 is drawn below.
  openingGate.frame();
  // ── /s24:O ──
  // Cinematic intro — owns camera while running (no-op when not running)
  intro.update(dt);

  // Update FPS controls before orbit controls (keyboard takes precedence)
  // A delayed frame (asset upload, shader compilation, tab resume) must not
  // turn all missed wall-clock time into one large camera jump. Simulation
  // and audio retain their own elapsed time; bound only interactive motion.
  updateFpsControls(Math.min(dt, 0.05));
  // A stationary pointer must not leave a tooltip's synchronous GPU readback
  // running throughout keyboard flight. Hover resumes on the next pointer move.
  if (fpsControls.active && !_fpsWasActive) _clearHoverForMotion?.();

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
  // DOM label projection runs before renderer.render() flushes this matrix.
  camera.updateMatrixWorld(true);
  miniMap?.update(frameTime);

  // Readout widget — substrate, altitude, compass
  const azimuth = controls.getAzimuthalAngle();
  const dockAtCamera=airportDockGroup?getAirportDockInfo(camera.position):null;
  // Water's visual separation lift is not a physical elevation measurement.
  const surfaceYAtCamera = dockAtCamera ? dockAtCamera.referenceLevelM*VERTICAL_EXAGGERATION
    : getTerrainMeshSurfaceY({ x: camera.position.x, z: camera.position.z });
  const realAltM = surfaceYAtCamera !== null
    ? Math.round((camera.position.y - surfaceYAtCamera) / VERTICAL_EXAGGERATION)
    : Math.round(camera.position.y / VERTICAL_EXAGGERATION);
  const cameraInsideM25 = isInsideM25(camera.position.x, camera.position.z);
  const isUnderground = cameraInsideM25 && (surfaceYAtCamera !== null
    ? camera.position.y < surfaceYAtCamera
    : camera.position.y < 0);

  // D6: substrate readout. Below-surface is independent of M25 membership —
  // the earlier "AIR at -1076m outside the M25" contradiction came from
  // gating on isUnderground (which requires cameraInsideM25). Outside the
  // disc there is no modelled chalk shaft, but the depth-vs-chalk-datum
  // classification (CLAY above chalk top, CHALK below) still makes sense and
  // beats the false "AIR" reading. Only genuinely above the local terrain
  // surface is AIR, regardless of M25 state.
  const belowSurface = surfaceYAtCamera !== null
    ? camera.position.y < surfaceYAtCamera
    : camera.position.y < 0;

  // Shared analytic chalk surface (D3.1) — same function the atmosphere's
  // chalkBlend and the visible displaced floor use, so felt/seen/read agree.
  const chalkSurfaceY = getChalkSurfaceY(camera.position.x, camera.position.z);

  // Submerged first (12Jul26u): the shared isSubmergedAt predicate covers the
  // whole water column (bed → rendered top). The old belowSurface gate was
  // semantically inverted for water — inside the channel the terrain mesh IS
  // the carved bed, so a camera actually IN the water read AIR and only a
  // camera in the soil under the bed read WATER.
  const submerged = isSubmergedAt(camera.position.x, camera.position.y, camera.position.z);

  let substrate = 'AIR';
  if (submerged) {
    substrate = 'WATER';
    _substrateInChalk = false;
  } else if (belowSurface) {
    // CLAY/CHALK flip with a ~10-unit hysteresis band around chalkSurfaceY
    // so the label doesn't chatter right at the boundary. Direction-aware:
    // must overshoot the last-crossed side by CHALK_HYSTERESIS_HALF before
    // flipping back.
    const flipY = _substrateInChalk
      ? chalkSurfaceY + CHALK_HYSTERESIS_HALF
      : chalkSurfaceY - CHALK_HYSTERESIS_HALF;
    _substrateInChalk = camera.position.y < flipY;
    substrate = _substrateInChalk ? 'CHALK' : 'CLAY';
  } else {
    _substrateInChalk = false;
  }
  readout.update(azimuth, realAltM, substrate);

  // ── Chalk-entry regime (D3.2/D3.3) + M25 edge blend (D5) ──────────────────
  // insideness: continuous M25 membership over a ~1500m band. The chalk
  // white-out and slowdown are gated by insideness so they only happen within
  // the disc — outside, there is no chalk stratum to cloud or slow through.
  const insideness = sampleM25Insideness(camera.position.x, camera.position.z);
  const chalkBlend = (1 - THREE.MathUtils.smoothstep(
    camera.position.y, chalkSurfaceY - 30, chalkSurfaceY + 30
  )) * insideness;

  // ── Item B clarity signals (both chalk-relative via getChalkSurfaceY) ──────
  // clayLift: 0 at the chalk boundary (today's darkness) → 1 a ramp above it
  // (the existing daylight endpoint). chalkSurfaceY ≈ -300 ± ~120, so the ramp
  // top sits near street depth and any above-ground camera is 1 by construction.
  _clayLift = THREE.MathUtils.clamp(
    (camera.position.y - chalkSurfaceY) / _clayClarityRamp, 0, 1);
  // chalkClarity: 0 at/above the chalk surface (the clay-side white-out is
  // untouched by construction), 1 a short ramp below it. Gated by insideness —
  // outside the disc there is no modelled chalk interior.
  _chalkClarity = THREE.MathUtils.clamp(
    (chalkSurfaceY - camera.position.y) / _chalkClarityRamp, 0, 1) * insideness;

  // ── Submerged blend (12Jul26u) ─────────────────────────────────────────
  // Short SPATIAL smoothstep below the rendered water top — same pattern as
  // every other regime blend (chalkBlend ±30, clarity ramps). The 2-scene-unit
  // (0.4 real m) ramp kills half-in-half-out near-plane flicker at the water
  // plane while still reading as an instant plunge. 0 outside the corridor.
  _submergedBlend = submerged
    ? THREE.MathUtils.smoothstep(waterSurfaceAt(camera.position.x,camera.position.z) - camera.position.y, 0, 2)
    : 0;

  // Interior shell: opaque bank walls + endcaps. Drawn inside the volume AND
  // for any camera above ground. The terrain is a skin cut open at the exact
  // wet footprint, so without the shell the only thing between the bank and
  // the soil beyond it is the translucent water side wall: looking through the
  // surface at a bank showed the chalk floor and tube lines behind it (23Sep26w).
  // BackSide keeps the near bank culled from the land, so only walls seen
  // across or along the channel draw. Hidden for an underground camera outside
  // the channel, which keeps its translucent view of the river body.
  const _shell = thamesMesh?.userData?.interiorShell;
  const insideThames=thamesMesh?.userData.navigation?.contains(camera.position) ?? false;
  if (_shell) _shell.visible = insideThames || !belowSurface;
  setRiverMaterialSubmerged(insideThames);

  // Material resistance is now transient and held-key-only. Chalk cruising,
  // mouse/touch pan and dolly keep their ordinary speeds.
  substrateSpeedFactor = 1.0;
  controls.zoomSpeed = _baseZoomSpeed;
  controls.panSpeed = _basePanSpeed;

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
  // With both static layers resident there is no reason to fetch/parse source
  // tiles. Readiness also prevents a load racing the initial ground download.
  // s24:O: live tiles outside the descent footprint pause while the descent
  // plays (in-flight fetches still land) and resume at landing; streaming them
  // mid-flight cost frame gaps of up to 100ms on the M5.
  if (surfaceDataLoaded && !(buildingsPath === 'baked' && groundPath === 'baked') && !intro.isPlaying()) {
    updateSurfaceLoader(camera.position.x, camera.position.z);
  }

  // Baked buildings: spend a bounded slice per frame turning payload records
  // into instance matrices, then stop forever. Runs only while a build is in
  // flight — this is a few frames after load, not an ongoing per-frame cost.
  if (bakedBuilder && !bakedBuilder.isDone()) {
    if (bakedBuilder.pump(BAKED_BUILD_BUDGET_MS)) {
      const st = bakedBuilder.stats();
      dbg(`Baked buildings resident: ${st.buildings.toLocaleString()} across ${st.meshes} meshes, built in ${st.buildMs}ms of frame time (payload ${bakedLoadMs}ms)`);
    }
  }

  // ── s24:R ──
  applyLayerEconomies();
  // ── /s24:R ──
  // Update all trains (simulation, orientation, LOD, SpotLight pool)
  updateTrains(trainSystem, sim, camera, dt);

  // Overground trains (simple ping-pong runners, distance-culled)
  const surfaceSimulationDt = sim.paused ? 0 : dt * sim.timeScale;
  if (overgroundGroup) overgroundGroup.userData.update(surfaceSimulationDt, camera);
  motorwayGroup?.userData.update(surfaceSimulationDt, camera);
  // ── sprint:C ──
  seaLife?.update(surfaceSimulationDt, camera, { submerged });
  // ── /sprint:C ──
  // ── s25:W ──
  updateTidewayWhirlpools(surfaceSimulationDt, camera);
  // ── /s25:W ──
  // ── sprint:F ──
  flightsGroup?.userData.update(surfaceSimulationDt, camera);
  // ── /sprint:F ──

  // Update living-water shader uniforms.
  updateWater(dt);

  // ── s24:R ── canvas size read once per frame, before any label writes
  const _s24LabelViewport = economies.on('labelViewport')
    ? (_s24Viewport.w = renderer.domElement.clientWidth, _s24Viewport.h = renderer.domElement.clientHeight, _s24Viewport)
    : null;
  // ── /s24:R ──
  // Update station label projections for ALL lines
  let updateCallCount = 0;
  for (const [lineId, layers] of lineShaftLayers) {
    if (layers.stationsLayer?.update) {
      layers.stationsLayer.update({
        camera, renderer, terrainSurfaceY: surfaceYAtCamera, insideM25: cameraInsideM25,
        // Inside chalk every label hides (Item B); hover tooltips live in the
        // separate #hoverTip path and stay active. Submerged (12Jul26u) hides
        // them too — HTML overlays are not fogged, so labels would otherwise
        // shine through the opaque interior shell walls.
        hideForChalk: _chalkClarity > 0.5,
        hideForWater: submerged || s25InteriorHidesLabels(lineId), // s25:P
        viewport: _s24LabelViewport, // s24:R
      });
      updateCallCount++;
    }
  }
  if (updateCallCount === 0 && lineShaftLayers.size > 0) {
    // Station updates skipped
  }
  parkLabelsGroup?.userData.update({camera,viewportHeight:window.innerHeight,submerged,labelsVisible});

  // ── sprint:D ──
  // Air-substrate sun blend and shadow fit; must precede the environment and
  // lighting updates below. Automatic quality level 1+ drops shadows first.
  sunSystem.update({ camera, surfaceY: surfaceYAtCamera, submergedBlend: _submergedBlend,
    adaptiveShadows: renderQualityMode !== 'auto' || adaptiveQuality.get().shadows !== false });
  // ── /sprint:D ──
  // ── s24:R ── withdraw a shadow-map render that would repeat the last one
  shadowCache.update({
    enabled: economies.on('shadowCache'),
    active: sunSystem.status.active,
    heightScale: getBuildingHeightScale(),
    casterVersion: casterVersionOf([surfaceGeometryGroup, landmarkGroup, bridgesGroup, airportsGroup]) ^ sunSystem.status.policyChanges,
    settled: !bakedBuilder || bakedBuilder.isDone(),
  });
  // ── /s24:R ──

  // Update environment based on camera height (sky/fog/background)
  if (skyDome) {
    updateEnvironment(camera, scene, skyDome, renderer,
      { insideness, chalkBlend, clayLift: _clayLift, chalkClarity: _chalkClarity, submergedBlend: _submergedBlend });
  }

  // Update lighting based on camera position
  updateLighting(camera, atmosphereLights,
    { insideness, chalkBlend, clayLift: _clayLift, chalkClarity: _chalkClarity, submergedBlend: _submergedBlend });

  // Inside-chalk clarity: release the chalk sheet (opacity + depthWrite) so
  // the network above is visible looking up. 0-gated above the chalk surface.
  // (The old updateCrossrailClarity fade-threshold scaling is retired: the
  // infra haze that replaced the Crossrail alpha fade is driven to ZERO in
  // chalk by updateEnvironment, so distance visibility needs no per-module
  // release any more — see infra-materials.js.)
  updateGeologyClarity(_chalkClarity);

  // Update spatial audio (ambient crossfades, filter sweeps, wind)
  if (isAudioReady()) {
    updateAudio(dt, {
      cameraPosition: camera.position,
      altitude: realAltM,
      isUnderground,
      surfaceY: surfaceYAtCamera,
      focalLength: lensSystem.getFocalLength(),
      submergedBlend: _submergedBlend,
    });
  }

  if (renderQualityMode === 'auto') {
    const ready = surfaceDataLoaded && !intro.isRunning() && !document.hidden &&
      (buildingsPath !== 'baked' || bakedBuilder?.isDone());
    if (ready) adaptiveQuality.update(dt * 1000, frameTime);
    else adaptiveQuality.reset(frameTime);
  }
  underwaterSurface.update(renderer,dt,insideThames?_submergedBlend:0);
  // ── s24:R ── last word on M25 culling, after fog and camera are final for
  // this frame: write any skipped chunk that could now show (fix round 1).
  if (motorwayGroup?.userData.revalidate) { camera.updateMatrixWorld(); motorwayGroup.userData.revalidate(camera); }
  // ── /s24:R ──
  composer.render(dt);
  sampleCushion();
  requestAnimationFrame(tick);
}

// ── sprint:A1 ──
modeSystem = installModes({
  THREE, camera, controls, canvas: renderer.domElement, fpsControls,
  VE: VERTICAL_EXAGGERATION, masterHeight,
  getTerrainY: (x, z) => getTerrainMeshSurfaceY({ x, z }),
  getStructuralY: (x, z) => getStructuralSurfaceY({ x, z }),
  isSubmergedAt, waterSurfaceAt,
  // Both render paths: live 'buildings-*' tiles and baked 'baked-buildings-*'.
  getBuildingMeshes: () => (surfaceGeometryGroup?.visible
    ? surfaceGeometryGroup.children.filter(c => c.isInstancedMesh
      && (c.name?.startsWith('buildings-') || c.name?.startsWith('baked-buildings-')))
    : []),
  getHeightScale: getBuildingHeightScale,
  getMasterBus,
});
// ── /sprint:A1 ──
// ── sprint:A2 ──
// Pedestrian mode reads the tube network lazily (stations, platforms and the
// snapped tunnel centrelines); getters so it always sees the current snap.
modeSystem.ctx.tubeNetwork = {
  get branches() { return lineBranchCenterPts; },
  get stationLayers() { return lineShaftLayers; },
  // The rendered tunnels are twin bores this far either side of the centreline.
  get halfSpacing() { return twinTunnelsEnabled ? tunnelOffsetM : 0; },
};
// ── /sprint:A2 ──
// ── s25:P ──
// Pedestrian underground (Lane P, Jordan's note 10): the inside of the walker's
// bore (tube-interior.js). Invisible until Pedestrian mode shows it; the map
// devices that cross a bore (crown ribbons, station markers, station shafts)
// are hidden only while it is shown and restored exactly when it hides.
modeSystem.ctx.tubeInterior = createTubeInterior({
  scene,
  lineColour: (lineId) => lineColoursById.get(lineId),
  mapDevices: () => [...lineRibbonsById.values()].flat()
    .concat([...lineShaftLayers.values()].map(l => l.stationsLayer?.mesh).filter(Boolean))
    .concat(unifiedShaftLayer?.group ? [unifiedShaftLayer.group] : []),
});
// Station labels are HTML overlays, never occluded: inside the lining only the
// walker's own line keeps them (its next stations ahead), exactly as the
// submerged shell hides them all (hideForWater below).
function s25InteriorHidesLabels(lineId) {
  const lid = modeSystem?.ctx.tubeInterior?.lineId;
  return !!lid && lid !== lineId;
}
// ── /s25:P ──

requestAnimationFrame(tick);

// Dev-only debug exposure for Playwright / console testing
if (import.meta.env.DEV) {
  // Measurement harnesses (scripts/measure-*.mjs) need Frustum/Matrix4/Sphere in
  // page scope to answer "how much is actually being drawn" — renderer.info
  // describes only the composer's final fullscreen pass and cannot.
  window.__ugTHREE = THREE;
  window.__ug = {
    getTerrainRiverBed,
    materialResistance, classifySubstrateAt, underwaterSurface,
    get parkLabelsGroup() { return parkLabelsGroup; },
    camera, controls, scene, lineShaftLayers, getTerrainMeshSurfaceY, getStructuralSurfaceY, VERTICAL_EXAGGERATION,
    masterHeight, miniMap, llToXZ, sim, getShareUrl, dlrProfile,
    setBuildingHeightScale, getBuildingHeightScale,
    // ── s25:S ──
    structureMorph, trueProportion: TrueProportion,
    // ── /s25:S ──
    // Buildings render path (06Sep26u): 'live' | 'baked'
    setBuildingsPath,
    get buildingsPath() { return buildingsPath; },
    get groundPath() { return groundPath; },
    get groundReady() { return surfaceDataLoaded; },
    get surfaceTexState() { return surfaceTexState; },
    get bakedStats() {
      return bakedBuilder
        ? { ...bakedBuilder.stats(), payloadBytes: bakedPayload?.bytes ?? 0, loadMs: bakedLoadMs }
        : null;
    },
    getChalkSurfaceY, CHALK_TOP_Y,
    trainSystem, composer, bloomPass, lensSystem, renderQuality, isAudioReady,
    adaptiveQuality, setRenderQualityMode,
    get renderQualityMode() { return renderQualityMode; },
    fpsControls, intro, landscapeLock, controlsGuide, readout,
    // ── s24:O ──
    openingGate,
    // ── /s24:O ──
    // ── sprint:A1 ──
    get modes() { return modeSystem; },
    // ── /sprint:A1 ──
    nearestThamesSegment, getZoneAt,
    isInThames,
    // Submerged regime (12Jul26u): shared inside-the-river predicate + signals.
    isSubmergedAt,
    WATER_TOP_Y,
    get submergedBlend() { return _submergedBlend; },
    get thamesInteriorShell() { return thamesMesh?.userData?.interiorShell ?? null; },
    get thamesMesh() { return thamesMesh; },
    get overground() { return overgroundGroup; },
    water: getWaterTuningSurface(),
    get waterParams() { return getWaterTuningSurface().params; },
    setWaterParams: (next) => getWaterTuningSurface().setWaterParams(next),
    // D-002 substrate speed multiplier — read live, settable by a later wave
    // (chalk slowdown) to throttle movement through dense strata.
    get substrateSpeedFactor() { return substrateSpeedFactor; },
    set substrateSpeedFactor(v) { substrateSpeedFactor = v; },
    // Item B clarity signals (read-only) + runtime-tunable ramps.
    get clayLift() { return _clayLift; },
    get chalkClarity() { return _chalkClarity; },
    get clayClarityRamp() { return _clayClarityRamp; },
    set clayClarityRamp(v) { _clayClarityRamp = Math.max(1, v); },
    get chalkClarityRamp() { return _chalkClarityRamp; },
    set chalkClarityRamp(v) { _chalkClarityRamp = Math.max(1, v); },
    // Item C: live station-label policy snapshot (surface cutoff/fade, priority
    // distance multipliers, declutter cell size) — for specs and tuning.
    get labelPolicy() { return getLabelPolicy(); },
    // Infra haze strength (read-only) — driven by updateEnvironment each tick;
    // 1 in clay underground, 0 above ground / outside the disc / inside chalk.
    get infraHazeStrength() { return getInfraHazeStrength(); },
    cushionLuma: { sample: sampleCushion, reset: resetCushion, state: _cushionState },
    // formatInfraTooltip is closure-scoped to the tooltip block (~L1714-2268).
    // _formatInfraTooltipRef is assigned from inside that block and read via
    // this getter so it lands on __ug after init order resolves.
    get formatInfraTooltip() { return _formatInfraTooltipRef; },
    // Getters so live values are read (set after async loading)
    get unifiedShaftLayer() { return unifiedShaftLayer; },
    get lineCenterPoints() { return lineCenterPoints; },
    get lineBranchCenterPts() { return lineBranchCenterPts; },
    // Crown ribbon registry (Item A) — colour ribbon + optional casing per line.
    get lineRibbonsById() { return lineRibbonsById; },
    // Exposed so specs can force a tube rebuild and assert ribbon bookkeeping
    // (idempotent; runs in normal boot whenever terrain + network both load).
    snapAllTubesToTerrain,
    get thamesProfileSampler() { return thamesProfileSampler; },
    get bridgesGroup() { return bridgesGroup; },
    get bridgeRegistry() { return bridgesGroup?.userData?.registry ?? new Map(); },
    get surfaceLoaderStats() { return getSurfaceLoaderStats(); },
    getSurfaceTileStates, // s24:O
    get surfaceGeometryGroup() { return surfaceGeometryGroup; },
    get landmarkGroup() { return landmarkGroup; },
    get airportsGroup() { return airportsGroup; },
    get airportInitError() { return airportInitError; },
    get airportDockGroup() { return airportDockGroup; },
    get airportDockInitError() { return airportDockInitError; },
    getAirportDockInfo, getAirportDockSurfaceY,
    get motorwayGroup() { return motorwayGroup; },
    get motorwayInitError() { return motorwayInitError; },
    // ── sprint:F ──
    get flightsGroup() { return flightsGroup; },
    get flightsInitError() { return flightsInitError; },
    // ── /sprint:F ──
    getTerrainBounds,
    get arrivalCosts() { return arrivalCosts.slice(); },
    clearArrivalCosts() { arrivalCosts.length = 0; },
    // Sum of populated instance counts across all per-tile building InstancedMeshes.
    // This is what the Phase 0b fix actually guards: tiles can be `state='loaded'`
    // yet render zero buildings if the dedup Set rejects them. Assert against this
    // getter (not stats.loaded) to catch the zero-render regression.
    get buildingInstanceCount() {
      if (!surfaceGeometryGroup) return 0;
      let total = 0;
      // Counts BOTH render paths. The live path names its meshes
      // 'buildings-<tile file>' and the baked path 'baked-buildings-<index>';
      // the two prefixes are deliberately non-overlapping, because
      // clearLiveBuildingMeshes() distinguishes them by exactly this test and
      // must never sweep away the baked set.
      surfaceGeometryGroup.traverse((obj) => {
        if (!obj.isInstancedMesh || !obj.name) return;
        if (obj.name.startsWith('buildings-') || obj.name.startsWith('baked-buildings-')) {
          total += obj.count;
        }
      });
      return total;
    },
  };
  // ── sprint:integrate ──
  window.__ug.getFlightWind = getFlightWind;
  window.__ug.getSurfaceWind = getSurfaceWind;
  // ── /sprint:integrate ──
  // ── sprint:C ──
  Object.defineProperty(window.__ug, 'seaLife', { get: () => seaLife, enumerable: true });
  // ── /sprint:C ──
  // ── s25:W ──
  Object.defineProperty(window.__ug, 'tidewayWhirlpools', { get: () => getTidewayWhirlpools(), enumerable: true });
  window.__ug.setTidewayWhirlpoolTime = setTidewayWhirlpoolTime;
  window.__ug.getSewerRoutes = getSewerRoutes;
  window.__ug.getAirportDockBedY = getAirportDockBedY;
  // ── /s25:W ──
  // ── s24:R ──
  window.__ug.economies = economies;
  window.__ug.trainBatchStats = trainBatchStats;
  window.__ug.doubleSideSplit = doubleSideSplit;
  window.__ug.shadowCache = shadowCache;
  window.__ug.isShown = isShown;
  // ── /s24:R ──
}
