import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';

// Track which station names already have a label to avoid duplicates
// when the same station appears on multiple lines (e.g. Farringdon on Circle + Metropolitan + H&C)
const _labelledNames = new Set();
const _labelledNamesUG = new Set();

// Module-level label fade distance — shared across all station layers,
// read every frame by each layer's update() so slider changes apply instantly.
let _labelMaxDistance = 9000;

// ---- Item C: half-scale IM Fell English labels + per-priority distance tiers ----
// Surface font: was max(7, 11 * mult) -> 16.5/11/8.25px. Half scale with a
// legibility floor. FLAG: 6px is at the floor for an antiqua face — Jordan
// judges by screenshot; expect a possible nudge of SURF_MIN_PX to 7.
const SURF_BASE_PX = 5.5;
const SURF_MIN_PX = 7;
// Underground font: was lerp(13, 8) over the fade window. Halved, with a hard
// floor applied AFTER the per-station size multiplier.
const UG_FONT_NEAR_PX = 6.5;
const UG_FONT_FAR_PX = 4;
const UG_FONT_MIN_PX = 5;
// Distance-tier multipliers indexed by labelPriority():
//   0 = single-line stop (culls at ~55% of the shared reach)
//   1 = interchange (unchanged)
//   2 = terminus / 3+ line hub (reaches ~145%)
const PRIO_DIST_MULT = [0.55, 1.0, 1.45];
// Cap the boosted priority-2 surface reach so labels stay inside the fog.
const SURF_CUTOFF_CAP = 65000;

// Shared exact rectangle arbitration, both label regimes and every line layer.
// Canvas font metrics are cached per label/size; no layout reads during flight.
// Retained introspection values for the former grid; rectangles now arbitrate.
const CELL_W = 56;
const CELL_H = 28;
let _frameToken = -1;
let _accepted = [];
let _measureContext;
let _fontReady = false;

export function stationApproachScale(distance) {
  const t = THREE.MathUtils.clamp((1400 - distance) / 1200, 0, 1);
  return 1 + t * t * (3 - 2 * t);
}

export function stationLabelFont(distance, baseFontPx) {
  return baseFontPx * stationApproachScale(distance);
}

export function labelBounds(x, y, width, fontSize) {
  // Includes breathing room around the actual glyph advance and CSS line box.
  return {left:x-width/2-5, right:x+width/2+5,
    top:y-fontSize*.6-3, bottom:y+fontSize*.6+3};
}
export function labelBoundsOverlap(a,b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
export function labelRank(priority,distance,shown=false) {
  // An approached local station wins over a distant hub. Inside that radius,
  // closeness wins continuously rather than competing importance tiers.
  return {priority:distance<650?3:priority,
    distance:distance*(shown ? .9 : 1)};
}

function labelWidth(el,fontSize) {
  if (!_measureContext) _measureContext=document.createElement('canvas').getContext('2d');
  const ready=_fontReady;
  if (el._widthReady!==ready || !el._emWidth) {
    _measureContext.font='100px "IM Fell English", "Railway Sans", serif';
    el._emWidth=_measureContext.measureText(el.textContent).width/100;
    el._widthReady=ready;
  }
  return el._emWidth*fontSize;
}
function placeLabel(el,x,y,opacity,fontSize,distance) {
  const fs=fontSize.toFixed(1);
  if(el._fs!==fs) {el.style.fontSize=`${fs}px`;el._fs=fs;}
  const bounds=labelBounds(x,y,labelWidth(el,Number(fs)),Number(fs));
  const rank=labelRank(el._priority||0,distance,el._dispShown);
  const collisions=_accepted.filter(item=>labelBoundsOverlap(bounds,item.bounds));
  for(const item of collisions) {
    if(rank.priority<item.rank.priority ||
      (rank.priority===item.rank.priority && rank.distance>=item.rank.distance*.9)) {
      hideLabel(el);return;
    }
  }
  for(const item of collisions) {hideLabel(item.el);_accepted.splice(_accepted.indexOf(item),1);}
  _accepted.push({el,bounds,rank});
  showLabel(el,x,y,opacity);
}

// Shared per-frame surface (above-ground) policy — computed once per frame.
let _surfCutoff = 0;      // hard distance cutoff (scene units), altitude-scaled
let _surfFadeStart = 0;   // distance at which opacity starts fading
let _surfMinPriority = 0; // minimum priority tier allowed to show

// Detect a new render frame and, if so, recompute shared surface policy + mark
// previous accepted rectangles stale. Cheap short-circuit for the 2nd..Nth layer within one tick.
function beginLabelFrameIfNeeded(camera, renderer, terrainSurfaceY, w, h) {
  const token = renderer?.info?.render?.frame ?? (_frameToken + 1);
  if (token === _frameToken) return;
  _frameToken = token;
  _accepted.length = 0;
  _fontReady=document.fonts?.check('12px "IM Fell English"') ?? true;

  const surfY = Number.isFinite(terrainSurfaceY) ? terrainSurfaceY : 0;
  const altY = Math.max(0, camera.position.y - surfY);
  const HIGH_ALT = 12000; // scene units above ground → priority-tier-only regime
  // Cutoff reaches full-network range once well off the deck (~6k) so elevated
  // BUT distant framings (e.g. the oblique beauty pose) still reach the centre;
  // street level stays tight so only nearby labels show. Measured rectangles + priority
  // filter do the actual decluttering from there.
  const reachT = Math.min(1, altY / 6000);
  _surfCutoff = 2500 + Math.pow(reachT, 1.2) * (60000 - 2500);
  _surfFadeStart = _surfCutoff * 0.62;
  // At high altitude only interchanges/termini survive (fading with distance).
  _surfMinPriority = altY >= HIGH_ALT ? 1 : 0;
}

// Importance tier used for both the altitude priority filter and label arbitration:
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

// Test/tuning introspection: the live per-frame surface policy plus the Item C
// named constants. Read-only snapshot — exposed on window.__ug.labelPolicy.
export function getLabelPolicy() {
  return {
    surfCutoff: _surfCutoff,
    surfFadeStart: _surfFadeStart,
    surfMinPriority: _surfMinPriority,
    surfCutoffCap: SURF_CUTOFF_CAP,
    labelMaxDistance: _labelMaxDistance,
    prioDistMult: [...PRIO_DIST_MULT],
    declutter: 'measured-rectangles',
    cellW: CELL_W,
    cellH: CELL_H,
    surfBasePx: SURF_BASE_PX,
    surfMinPx: SURF_MIN_PX,
  };
}

export function cleanStationName(name) {
  if(name==='Bethnal Green Rail Station')return 'Bethnal Green (Overground)'; // distinct from the Central line station
  const cleaned = name.replace(/\s+(Underground|DLR|Rail) Station$/i, '');
  return ({'London Euston':'Euston', 'London Liverpool Street':'Liverpool Street', 'Richmond (London)':'Richmond', 'New Cross ELL':'New Cross', 'Queens Park (London)':"Queen's Park", 'Shepherds Bush':"Shepherd's Bush"})[cleaned] || cleaned;
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
  surfaceOnly = false,
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
  // Surface labels: project at each station terrain surface, visible above ground
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

      // Surface: dedup shared stations at the same terrain anchor
      if (isDuplicate) {
        surfaceEls.push(null);
      } else {
        _labelledNames.add(name);
        const surfEl = document.createElement('div');
        surfEl.className = 'station-label station-label-surface';
        surfEl.textContent = name;
        const surfFontPx = Math.max(SURF_MIN_PX,
          SURF_BASE_PX * lineSizeMultiplier(st.lineCount || 1, st.isTerminus));
        surfEl.style.fontSize = `${surfFontPx.toFixed(1)}px`;
        if (st.isTerminus) surfEl.style.color = '#f5e6a3';
        surfEl._priority = labelPriority(st);
        surfEl._baseFontPx = surfFontPx;
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

  function update({ camera, renderer, terrainSurfaceY, insideM25 = true, hideForChalk = false, hideForWater = false }) {
    updateCount++;
    if (!labelsVisible) return;

    // Item B: while the camera is inside the chalk, ALL station labels hide —
    // one dirty-checked layer-level write per layer covers both paths, and
    // display restores automatically next frame when the flag drops. Hover
    // tooltips (#hoverTip) are a separate path and stay active.
    if (hideForChalk || hideForWater) {
      setLayerDisplay(surfaceLayer, false);
      setLayerDisplay(undergroundLayer, false);
      return;
    }

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
    setLayerDisplay(undergroundLayer, !cameraAboveGround && !surfaceOnly);
    if (surfaceOnly && !cameraAboveGround) return;

    if (cameraAboveGround) {
      updateSurface(camera, w, h);
    } else {
      updateUnderground(camera, w, h);
    }
  }

  // ---- Above-ground branch: altitude-aware distance policy + measured rectangles ----
  function updateSurface(camera, w, h) {
    const minPriority = _surfMinPriority;

    for (let i = 0; i < stations.length; i++) {
      const el = surfaceEls[i];
      if (!el) continue;
      const st = stations[i];
      const priority = el._priority || 0;

      // Cheap 3D pre-cull BEFORE any projection: altitude priority + distance.
      // Per-priority reach: singles cull sooner, termini/hubs reach further
      // (capped so the boosted reach stays inside the fog).
      if (priority < minPriority) { hideLabel(el); continue; }
      const distMult = PRIO_DIST_MULT[priority] ?? 1.0;
      const cutoff = Math.min(_surfCutoff * distMult, SURF_CUTOFF_CAP);
      const fadeStart = _surfFadeStart * distMult;
      const fadeRange = Math.max(1, cutoff - fadeStart);
      const d = camera.position.distanceTo(st.pos);
      if (d > cutoff) { hideLabel(el); continue; }

      // Project station XZ at terrain surface (or Y=0 fallback)
      tmpSurface.set(st.pos.x, st.surfaceY ?? 0, st.pos.z);
      tmpSurface.project(camera);
      if (tmpSurface.z > 1) { hideLabel(el); continue; }

      const x = (tmpSurface.x * 0.5 + 0.5) * w;
      const y = (1 - (tmpSurface.y * 0.5 + 0.5)) * h;
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { hideLabel(el); continue; }

      const alpha = d <= fadeStart ? 1.0
        : THREE.MathUtils.clamp(1.0 - (d - fadeStart) / fadeRange, 0.0, 1.0);
      // matrixWorldInverse includes the Master view transform. Use the anchor
      // actually drawn, not platform depth, for perceptual approach distance.
      tmpSurface.set(st.pos.x, st.surfaceY ?? 0, st.pos.z).applyMatrix4(camera.matrixWorldInverse);
      const visualDistance=tmpSurface.length();
      placeLabel(el,x,y,alpha,stationLabelFont(visualDistance,el._baseFontPx),visualDistance);
    }
  }

  // ---- Below-ground branch: retained distant appearance, approach growth and declutter ----
  function updateUnderground(camera, w, h) {
    for (let i = 0; i < stations.length; i++) {
      const el = undergroundEls[i];
      if (!el) continue;
      const st = stations[i];

      // Per-priority reach mirrors the surface path: singles cull sooner,
      // termini / 3+-line hubs stay visible further into the dark.
      const effMax = _labelMaxDistance * (PRIO_DIST_MULT[el._priority || 0] ?? 1.0);
      const d = camera.position.distanceTo(st.pos);
      if (d > effMax) { hideLabel(el); continue; }

      tmpUnderground.copy(st.pos);
      tmpUnderground.project(camera);
      if (tmpUnderground.z > 1) { hideLabel(el); continue; }

      const x = (tmpUnderground.x * 0.5 + 0.5) * w;
      const y = (1 - (tmpUnderground.y * 0.5 + 0.5)) * h;
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { hideLabel(el); continue; }

      const fadeStart = Math.max(150, effMax * 0.02);
      const fadeRange = Math.max(1, effMax - fadeStart);
      const fadeT = d <= fadeStart ? 0
        : THREE.MathUtils.clamp((d - fadeStart) / fadeRange, 0.0, 1.0);
      const alpha = 1.0 - fadeT;
      const baseFontSize = THREE.MathUtils.lerp(UG_FONT_NEAR_PX, UG_FONT_FAR_PX, fadeT);
      const distantFont = Math.max(UG_FONT_MIN_PX, baseFontSize * (el._sizeMultiplier || 1));
      tmpUnderground.copy(st.pos).applyMatrix4(camera.matrixWorldInverse);
      const visualDistance=tmpUnderground.length();
      const fontSize=stationLabelFont(visualDistance,distantFont);

      placeLabel(el,x,y,alpha,fontSize,visualDistance);
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
