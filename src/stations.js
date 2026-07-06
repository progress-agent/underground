import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';

// Track which station names already have a label to avoid duplicates
// when the same station appears on multiple lines (e.g. Farringdon on Circle + Metropolitan + H&C)
const _labelledNames = new Set();
const _labelledNamesUG = new Set();

// Module-level label fade distance — shared across all station layers,
// read every frame by each layer's update() so slider changes apply instantly.
let _labelMaxDistance = 9000;

// ---- Shared screen-space declutter grid (surface labels, all layers) ----
// The above-ground label set spans many per-line layers, each calling update()
// independently within a single render tick. To dedupe "walls of text" across
// ALL layers we keep ONE module-level coarse screen grid, reset once per render
// frame (keyed on renderer.info.render.frame). Cell arrays are preallocated and
// marked stale by a per-frame stamp — no per-frame clearing/allocation.
const CELL_W = 92;
const CELL_H = 46;
let _gridCols = 0;
let _gridRows = 0;
let _gridStamp = null;    // Int32Array — frame stamp that last claimed each cell
let _gridPriority = null; // Int8Array  — incumbent priority tier per cell
let _gridDist = null;     // Float64Array — incumbent effective (sticky) distance
let _gridEl = null;       // Array — incumbent element per cell
let _frameToken = -1;     // last seen renderer frame number
let _frameStamp = 0;      // monotonic per-frame stamp used to mark live cells

// Shared per-frame surface (above-ground) policy — computed once per frame.
let _surfCutoff = 0;      // hard distance cutoff (scene units), altitude-scaled
let _surfFadeStart = 0;   // distance at which opacity starts fading
let _surfMinPriority = 0; // minimum priority tier allowed to show

const STICKY = 0.9;       // incumbent-from-last-frame treated as 10% closer
const CHALLENGER_MARGIN = 0.9; // same-tier challenger must be clearly closer

function ensureGrid(w, h) {
  const cols = Math.max(1, Math.ceil(w / CELL_W));
  const rows = Math.max(1, Math.ceil(h / CELL_H));
  if (cols !== _gridCols || rows !== _gridRows || !_gridStamp) {
    _gridCols = cols;
    _gridRows = rows;
    const n = cols * rows;
    _gridStamp = new Int32Array(n);
    _gridPriority = new Int8Array(n);
    _gridDist = new Float64Array(n);
    _gridEl = new Array(n).fill(null);
  }
}

// Detect a new render frame and, if so, recompute shared surface policy + mark
// the grid stale. Cheap short-circuit for the 2nd..Nth layer within one tick.
function beginLabelFrameIfNeeded(camera, renderer, terrainSurfaceY, w, h) {
  const token = renderer?.info?.render?.frame ?? (_frameToken + 1);
  if (token === _frameToken) return;
  _frameToken = token;
  _frameStamp++; // stamp mismatch marks every cell empty — no clearing needed
  ensureGrid(w, h);

  const surfY = Number.isFinite(terrainSurfaceY) ? terrainSurfaceY : 0;
  const altY = Math.max(0, camera.position.y - surfY);
  const HIGH_ALT = 12000; // scene units above ground → priority-tier-only regime
  // Cutoff reaches full-network range once well off the deck (~6k) so elevated
  // BUT distant framings (e.g. the oblique beauty pose) still reach the centre;
  // street level stays tight so only nearby labels show. Screen grid + priority
  // filter do the actual decluttering from there.
  const reachT = Math.min(1, altY / 6000);
  _surfCutoff = 2500 + Math.pow(reachT, 1.2) * (60000 - 2500);
  _surfFadeStart = _surfCutoff * 0.62;
  // At high altitude only interchanges/termini survive (fading with distance).
  _surfMinPriority = altY >= HIGH_ALT ? 1 : 0;
}

// Importance tier used for both the altitude priority filter and grid arbitration:
// 2 = terminus / major hub (3+ lines), 1 = interchange (2 lines), 0 = minor stop.
// Gold styling (isTerminus) rides on top; this drives declutter precedence.
function labelPriority(st) {
  const lc = st.lineCount || 1;
  if (st.isTerminus || lc >= 3) return 2;
  if (lc >= 2) return 1;
  return 0;
}

// ---- Dirty-checked DOM writes (only touch style on real change) ----
function showLabel(el, x, y, opacity) {
  if (el._dispShown !== true) { el.style.display = 'block'; el._dispShown = true; }
  if (el._txSet !== true) { el.style.transform = 'translate(-50%, -50%)'; el._txSet = true; }
  const lx = x.toFixed(1);
  if (el._lx !== lx) { el.style.left = `${lx}px`; el._lx = lx; }
  const ly = y.toFixed(1);
  if (el._ly !== ly) { el.style.top = `${ly}px`; el._ly = ly; }
  const op = opacity >= 0.999 ? '1' : opacity.toFixed(3);
  if (el._op !== op) { el.style.opacity = op; el._op = op; }
}

function hideLabel(el) {
  if (el._dispShown !== false) { el.style.display = 'none'; el._dispShown = false; }
}

function setLayerDisplay(layerEl, show) {
  const v = show ? 'block' : 'none';
  if (layerEl._dispState !== v) { layerEl.style.display = v; layerEl._dispState = v; }
}

export function cleanStationName(name) {
  return name.replace(/\s+(Underground|DLR) Station$/i, '');
}

// Size multiplier based on how many tube lines serve a station:
// 1 line → small (minor stop), 2 lines → baseline (interchange),
// 3+ or terminus → large (major hub / end of line)
function lineSizeMultiplier(lineCount, isTerminus) {
  if (lineCount >= 3) return 1.5;
  if (isTerminus || lineCount === 2) return 1.0;
  return 0.75;
}

function ensureOverlayRoot() {
  let root = document.getElementById('station-overlay');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'station-overlay';
  document.body.appendChild(root);
  return root;
}

function createOverlayLayer(root, className) {
  const layer = document.createElement('div');
  layer.className = className;
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  root.appendChild(layer);
  return layer;
}

export function createStationMarkers({
  scene,
  stations,
  colour = 0x0098d4,
  size = 1.0,
  labels = true,
}) {
  // ---- 3D markers (fast): InstancedMesh spheres ----
  const geo = new THREE.SphereGeometry(size, 10, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.0,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.2,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, stations.length);
  mesh.frustumCulled = true;
  mesh.renderOrder = RENDER_ORDER.STATION;
  mesh.userData.kind = 'station-markers';
  mesh.userData.stations = stations; // Store for raycasting lookup

  const dummy = new THREE.Object3D();
  for (let i = 0; i < stations.length; i++) {
    dummy.position.copy(stations[i].pos);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  // ---- Dual HTML label system ----
  // Surface labels: project at Y=0 (street level), visible above ground
  // Underground labels: project at actual station depth, visible below ground
  const root = ensureOverlayRoot();
  const surfaceLayer = createOverlayLayer(root, 'station-overlay-layer station-layer-surface');
  const undergroundLayer = createOverlayLayer(root, 'station-overlay-layer station-layer-underground');
  const surfaceEls = [];
  const undergroundEls = [];

  if (labels) {
    for (const st of stations) {
      const name = cleanStationName(st.name);
      const isDuplicate = _labelledNames.has(name);

      // Surface: dedup (shared stations overlap at Y=0)
      if (isDuplicate) {
        surfaceEls.push(null);
      } else {
        _labelledNames.add(name);
        const surfEl = document.createElement('div');
        surfEl.className = 'station-label station-label-surface';
        surfEl.textContent = name;
        const surfFontPx = Math.max(7, 11 * lineSizeMultiplier(st.lineCount || 1, st.isTerminus));
        surfEl.style.fontSize = `${surfFontPx.toFixed(1)}px`;
        if (st.isTerminus) surfEl.style.color = '#f5e6a3';
        surfEl._priority = labelPriority(st);
        // Estimated on-screen half-width (px) — drives width-aware grid claiming
        // so wide central hub labels reserve the cells they physically cover.
        surfEl._estHalfPx = 0.26 * surfFontPx * name.length + 6;
        surfaceLayer.appendChild(surfEl);
        surfaceEls.push(surfEl);
      }

      // Underground: deduplicate by cleaned name (interchanges share position)
      if (_labelledNamesUG.has(name)) {
        undergroundEls.push(null);
      } else {
        _labelledNamesUG.add(name);
        const ugEl = document.createElement('div');
        ugEl.className = 'station-label station-label-underground';
        ugEl.textContent = name;
        ugEl._sizeMultiplier = lineSizeMultiplier(st.lineCount || 1, st.isTerminus);
        ugEl._priority = labelPriority(st);
        if (st.isTerminus) ugEl.style.color = '#f5e6a3';
        undergroundLayer.appendChild(ugEl);
        undergroundEls.push(ugEl);
      }
    }
  }

  let labelsVisible = labels;
  function setLabelsVisible(v) {
    labelsVisible = !!v;
    surfaceLayer.style.display = labelsVisible ? 'block' : 'none';
    undergroundLayer.style.display = labelsVisible ? 'block' : 'none';
  }
  setLabelsVisible(labelsVisible);

  const tmpSurface = new THREE.Vector3();
  const tmpUnderground = new THREE.Vector3();
  let updateCount = 0;

  function update({ camera, renderer, terrainSurfaceY, insideM25 = true }) {
    updateCount++;
    if (!labelsVisible) return;
    if (surfaceEls.length === 0) return;

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    // When outside M25, always show surface labels (never underground mode)
    const cameraAboveGround = !insideM25 || (Number.isFinite(terrainSurfaceY)
      ? camera.position.y >= terrainSurfaceY
      : camera.position.y >= 0);

    // Reset shared declutter grid + surface policy once per render frame
    // (first layer to run this tick does the work; the rest short-circuit).
    beginLabelFrameIfNeeded(camera, renderer, terrainSurfaceY, w, h);

    // Toggle layer visibility based on camera position (dirty-checked)
    setLayerDisplay(surfaceLayer, cameraAboveGround);
    setLayerDisplay(undergroundLayer, !cameraAboveGround);

    if (cameraAboveGround) {
      updateSurface(camera, w, h);
    } else {
      updateUnderground(camera, w, h);
    }
  }

  // ---- Above-ground branch: altitude-aware distance policy + screen grid ----
  function updateSurface(camera, w, h) {
    const cutoff = _surfCutoff;
    const fadeStart = _surfFadeStart;
    const fadeRange = Math.max(1, cutoff - fadeStart);
    const minPriority = _surfMinPriority;

    for (let i = 0; i < stations.length; i++) {
      const el = surfaceEls[i];
      if (!el) continue;
      const st = stations[i];
      const priority = el._priority || 0;

      // Cheap 3D pre-cull BEFORE any projection: altitude priority + distance.
      if (priority < minPriority) { hideLabel(el); continue; }
      const d = camera.position.distanceTo(st.pos);
      if (d > cutoff) { hideLabel(el); continue; }

      // Project station XZ at terrain surface (or Y=0 fallback)
      tmpSurface.set(st.pos.x, st.surfaceY ?? 0, st.pos.z);
      tmpSurface.project(camera);
      if (tmpSurface.z > 1) { hideLabel(el); continue; }

      const x = (tmpSurface.x * 0.5 + 0.5) * w;
      const y = (1 - (tmpSurface.y * 0.5 + 0.5)) * h;
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { hideLabel(el); continue; }

      // Screen-space declutter: at most one label per covered grid cell.
      // Priority wins; then nearer-to-camera. Stickiness biases the currently
      // visible label. Wide labels claim the horizontal run of cells they cover.
      const eff = d * (el._dispShown ? STICKY : 1.0);
      let col = (x / CELL_W) | 0;
      if (col < 0) col = 0; else if (col >= _gridCols) col = _gridCols - 1;
      let row = (y / CELL_H) | 0;
      if (row < 0) row = 0; else if (row >= _gridRows) row = _gridRows - 1;

      let span = ((el._estHalfPx || 0) / CELL_W) | 0;
      if (span > 2) span = 2; // bound the per-label cost
      let c0 = col - span; if (c0 < 0) c0 = 0;
      let c1 = col + span; if (c1 >= _gridCols) c1 = _gridCols - 1;

      // Decide against every covered cell before claiming any.
      let win = true;
      for (let c = c0; c <= c1 && win; c++) {
        const j = row * _gridCols + c;
        if (_gridStamp[j] !== _frameStamp) continue;
        const ip = _gridPriority[j];
        if (priority < ip) { win = false; break; }
        if (priority === ip) {
          const margin = c === col ? CHALLENGER_MARGIN : 1.0;
          if (eff >= _gridDist[j] * margin) { win = false; break; }
        }
      }
      if (!win) { hideLabel(el); continue; }

      // Challenger wins — evict prior incumbents and claim every covered cell.
      for (let c = c0; c <= c1; c++) {
        const j = row * _gridCols + c;
        if (_gridStamp[j] === _frameStamp) {
          const prev = _gridEl[j];
          if (prev && prev !== el) hideLabel(prev);
        }
        _gridStamp[j] = _frameStamp;
        _gridPriority[j] = priority;
        _gridDist[j] = eff;
        _gridEl[j] = el;
      }

      const alpha = d <= fadeStart ? 1.0
        : THREE.MathUtils.clamp(1.0 - (d - fadeStart) / fadeRange, 0.0, 1.0);
      showLabel(el, x, y, alpha);
    }
  }

  // ---- Below-ground branch: unchanged visual behaviour, dirty-checked writes ----
  function updateUnderground(camera, w, h) {
    for (let i = 0; i < stations.length; i++) {
      const el = undergroundEls[i];
      if (!el) continue;
      const st = stations[i];

      const d = camera.position.distanceTo(st.pos);
      if (d > _labelMaxDistance) { hideLabel(el); continue; }

      tmpUnderground.copy(st.pos);
      tmpUnderground.project(camera);
      if (tmpUnderground.z > 1) { hideLabel(el); continue; }

      const x = (tmpUnderground.x * 0.5 + 0.5) * w;
      const y = (1 - (tmpUnderground.y * 0.5 + 0.5)) * h;
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { hideLabel(el); continue; }

      const fadeRange = _labelMaxDistance - 150;
      const alpha = d <= 150 ? 1.0 : THREE.MathUtils.clamp(1.0 - (d - 150) / fadeRange, 0.0, 1.0);
      const baseFontSize = d <= 150 ? 13 : THREE.MathUtils.lerp(13, 8, (d - 150) / fadeRange);
      const fontSize = baseFontSize * (el._sizeMultiplier || 1);

      showLabel(el, x, y, alpha);
      const fs = `${fontSize.toFixed(1)}px`;
      if (el._fs !== fs) { el.style.fontSize = fs; el._fs = fs; }
      const z = Math.max(1, Math.floor(10000 - d));
      if (el._zi !== z) { el.style.zIndex = z; el._zi = z; }
    }
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    for (let i = 0; i < surfaceEls.length; i++) {
      const name = cleanStationName(stations[i].name);
      if (surfaceEls[i]) {
        _labelledNames.delete(name);
        surfaceEls[i].remove();
      }
      if (undergroundEls[i]) {
        _labelledNamesUG.delete(name);
        undergroundEls[i].remove();
      }
    }
    surfaceLayer.remove();
    undergroundLayer.remove();
  }

  return { mesh, stations, setLabelsVisible, update, dispose };
}
