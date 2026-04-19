/**
 * audio.js — Spatial audio engine for Underground
 *
 * Phase 1: Ambient foundation
 * - 3-bus architecture (ambient, point source, UI placeholder)
 * - Procedural ambient beds: city hum, underground rumble, transition layer
 * - Procedural wind (brown noise + altitude-dependent bandpass)
 * - Lowpass filter underground transition (20kHz → 1.5kHz smoothstep)
 * - Autoplay gesture handling (piggybacks on first canvas interaction)
 * - HUD volume control + tab visibility fade
 *
 * Phase 2: Spatial sources
 * - SourcePool (24 PannerNodes, equalpower, acquire/release with gain fade)
 * - Train point sources (moving, positions from trainSystem.allTrains)
 * - Thames virtual-point emitters (closest-point-on-polyline, 3-6 dynamic)
 * - Distance-based activation/deactivation (4km cull radius)
 * - 3-tier audio LOD (micro <300m, meso 300-5000m, macro >5km = muted)
 * - Pool reassignment throttled to ~10Hz, position updates ~20Hz
 *
 * Integration: main.js calls updateAudio(dt, state) per frame.
 * Static data (trainSystem ref, Thames polyline) passed once via initSpatialSources().
 */

import * as THREE from 'three';

// ── State ──────────────────────────────────────────────────────────────────

let ctx = null;             // AudioContext
let listener = null;        // THREE.AudioListener (camera sync)
let masterGain = null;
let compressor = null;
let ambientBus = null;
let pointSourceBus = null;  // Phase 2
let uiBus = null;           // Phase 4

// Ambient layers
let surfaceSource = null;
let surfaceGain = null;
let undergroundSource = null;
let undergroundGain = null;
let transitionSource = null;
let transitionGain = null;

// Wind
let windSource = null;
let windGain = null;
let windBandpass = null;

// Underground lowpass on ambient bus
let undergroundLP = null;

// State tracking
let _initialised = false;
let _masterVolume = 0.6;
let _muted = false;
let _tabVisible = true;

// Throttle counters
let _frameCount = 0;

// ── Phase 2: Spatial source pool ──────────────────────────────────────────

const POOL_SIZE = 24;
const POOL_FADE = 0.12;          // gain fade time for acquire/release
const ASSIGN_INTERVAL = 6;       // pool reassignment every 6 frames (~10Hz)
const POS_UPDATE_INTERVAL = 3;   // panner position update every 3 frames (~20Hz)
const MAX_TRAIN_SOURCES = 16;
const MAX_THAMES_SOURCES = 6;
const TRAIN_REF_DIST = 80;       // PannerNode refDistance (metres)
const THAMES_REF_DIST = 150;
const CULL_DISTANCE = 4000;      // beyond this distance, don't activate source
const LOD_MICRO_ALT = 300;       // full spatial audio
const LOD_MESO_ALT = 5000;       // reduced sources, then muted above

let _trainBuffer = null;
let _thamesBuffer = null;
let _pool = [];
let _poolReady = false;
let _trainSystemRef = null;
let _thamesPolyline = null;       // [{x, z}, ...] scene coordinates
let _assignCounter = 0;
let _posCounter = 0;
let _entityToSlot = new Map();    // 'train-{i}' | 'thames-{i}' → pool index

// ── Procedural noise generators ────────────────────────────────────────────

/**
 * Create a looping brown noise buffer.
 * Brown noise = integrated white noise, giving a -6dB/octave roll-off.
 * Sounds like distant rumble / ocean / HVAC. Perfect for city + underground.
 */
function createBrownNoiseBuffer(ctx, durationSec = 4) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + (0.02 * white)) / 1.02;
      data[i] = last * 3.5; // amplify
    }
    // Crossfade last 0.1s into first 0.1s for seamless loop
    const fadeLen = Math.floor(sampleRate * 0.1);
    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      data[i] = data[i] * t + data[length - fadeLen + i] * (1 - t);
    }
  }
  return buffer;
}

/**
 * Create a pink-ish noise buffer (softer than white, brighter than brown).
 * Used for the city surface ambience — has more high-frequency presence.
 */
function createPinkNoiseBuffer(ctx, durationSec = 6) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * durationSec;
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    // Voss-McCartney algorithm (simplified 3-octave)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    }
    // Crossfade for seamless loop
    const fadeLen = Math.floor(sampleRate * 0.1);
    for (let i = 0; i < fadeLen; i++) {
      const t = i / fadeLen;
      data[i] = data[i] * t + data[length - fadeLen + i] * (1 - t);
    }
  }
  return buffer;
}

/**
 * Train rumble buffer: brown noise with slight harmonic grit.
 * Filtered per-source through lowpass to sound like mechanical vibration.
 */
function createTrainBuffer(ctx) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 3;
  const buffer = ctx.createBuffer(1, length, sampleRate); // mono for spatial
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + (0.02 * white)) / 1.02;
    // Add faint impulse clicks for rail-joint character
    const click = (Math.random() < 0.0003) ? (Math.random() - 0.5) * 0.4 : 0;
    data[i] = last * 3.5 + click;
  }
  const fadeLen = Math.floor(sampleRate * 0.1);
  for (let i = 0; i < fadeLen; i++) {
    const t = i / fadeLen;
    data[i] = data[i] * t + data[length - fadeLen + i] * (1 - t);
  }
  return buffer;
}

/**
 * Thames water buffer: brown + pink blend for flowing water character.
 * Longer loop (8s) for organic variation. Mono for spatial panning.
 */
function createThamesBuffer(ctx) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 8;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = (brown + (0.02 * white)) / 1.02;
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    data[i] = brown * 1.4 + pink * 0.6;
  }
  const fadeLen = Math.floor(sampleRate * 0.2);
  for (let i = 0; i < fadeLen; i++) {
    const t = i / fadeLen;
    data[i] = data[i] * t + data[length - fadeLen + i] * (1 - t);
  }
  return buffer;
}

// ── Procedural source builders ─────────────────────────────────────────────

function createLoopingSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  // Randomise start position so layers don't phase-lock
  src.loopStart = 0;
  src.loopEnd = buffer.duration;
  src.start(0, Math.random() * buffer.duration);
  return src;
}

/**
 * City surface ambience: pink noise shaped with gentle highpass + lowpass
 * to sound like distant urban hum (traffic, HVAC, general city).
 */
function buildSurfaceLayer(ctx, bus) {
  const buffer = createPinkNoiseBuffer(ctx, 6);
  const src = createLoopingSource(ctx, buffer);

  // Shape: narrow the band to 120-3000Hz so it reads as distant city,
  // not broadband static. Heavy lowpass tames the harshness.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 120;
  hp.Q.value = 0.7;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  lp.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.value = 0.3;

  src.connect(hp).connect(lp).connect(gain).connect(bus);
  return { source: src, gain };
}

/**
 * Underground rumble: deep brown noise, heavy lowpass.
 * The physical sound of being inside a tunnel — machinery, ventilation, earth.
 */
function buildUndergroundLayer(ctx, bus) {
  const buffer = createBrownNoiseBuffer(ctx, 4);
  const src = createLoopingSource(ctx, buffer);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  lp.Q.value = 1.0;

  // Add subtle 50Hz electrical hum
  const hum = ctx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 50;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.015; // very subtle
  hum.connect(humGain);
  hum.start();

  // 100Hz harmonic
  const hum2 = ctx.createOscillator();
  hum2.type = 'sine';
  hum2.frequency.value = 100;
  const humGain2 = ctx.createGain();
  humGain2.gain.value = 0.008;
  hum2.connect(humGain2);
  hum2.start();

  const gain = ctx.createGain();
  gain.gain.value = 0.0;

  src.connect(lp).connect(gain).connect(bus);
  humGain.connect(gain);
  humGain2.connect(gain);

  return { source: src, gain, hum, hum2 };
}

/**
 * Transition layer: mid-frequency filtered noise that blends between
 * surface and underground. Sounds like muffled air movement in a stairwell.
 */
function buildTransitionLayer(ctx, bus) {
  const buffer = createBrownNoiseBuffer(ctx, 5);
  const src = createLoopingSource(ctx, buffer);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 600;
  bp.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.value = 0.0;

  src.connect(bp).connect(gain).connect(bus);
  return { source: src, gain };
}

/**
 * Procedural wind: brown noise through altitude-dependent bandpass.
 * Higher altitude = higher centre frequency (thinner air).
 * Louder at altitude, silent underground.
 */
function buildWindLayer(ctx, bus) {
  const buffer = createBrownNoiseBuffer(ctx, 4);
  const src = createLoopingSource(ctx, buffer);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 400;
  bp.Q.value = 0.6;

  const gain = ctx.createGain();
  gain.gain.value = 0.0;

  src.connect(bp).connect(gain).connect(bus);
  return { source: src, gain, bandpass: bp };
}

// ── Source Pool ────────────────────────────────────────────────────────────

/**
 * Create the pool of reusable PannerNode chains.
 * Each entry: BufferSource → BiquadFilter → GainNode → PannerNode → pointSourceBus
 * BufferSource is recreated on each activation (Web Audio limitation).
 */
function initPool() {
  _pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const panner = new PannerNode(ctx, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: TRAIN_REF_DIST,
      maxDistance: CULL_DISTANCE,
      rolloffFactor: 1.0,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
    });

    filter.connect(gain);
    gain.connect(panner);
    panner.connect(pointSourceBus);

    _pool.push({
      filter,
      gain,
      panner,
      source: null,
      active: false,
      type: null,       // 'train' | 'thames'
      entityKey: null,   // 'train-{i}' or 'thames-{i}'
    });
  }
  _poolReady = true;
}

/**
 * Activate a pool slot for a given entity.
 * Creates a new BufferSource (they're single-use) and fades in.
 */
function acquireSlot(slotIdx, type, entityKey) {
  const slot = _pool[slotIdx];
  if (slot.active) releaseSlot(slotIdx);

  const buffer = type === 'train' ? _trainBuffer : _thamesBuffer;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = buffer.duration;
  src.start(0, Math.random() * buffer.duration);
  src.connect(slot.filter);

  // Configure filter per type
  if (type === 'train') {
    slot.filter.type = 'lowpass';
    slot.filter.frequency.value = 350;
    slot.filter.Q.value = 1.2;
    slot.panner.refDistance = TRAIN_REF_DIST;
  } else {
    slot.filter.type = 'bandpass';
    slot.filter.frequency.value = 900;
    slot.filter.Q.value = 0.5;
    slot.panner.refDistance = THAMES_REF_DIST;
  }

  slot.source = src;
  slot.active = true;
  slot.type = type;
  slot.entityKey = entityKey;
  _entityToSlot.set(entityKey, slotIdx);

  // Fade in
  slot.gain.gain.setTargetAtTime(type === 'train' ? 0.7 : 0.5, ctx.currentTime, POOL_FADE);
}

/**
 * Release a pool slot — fade out, then stop source.
 */
function releaseSlot(slotIdx) {
  const slot = _pool[slotIdx];
  if (!slot.active) return;

  const key = slot.entityKey;
  if (key) _entityToSlot.delete(key);

  slot.gain.gain.setTargetAtTime(0, ctx.currentTime, POOL_FADE);

  // Stop the source after fade completes
  const src = slot.source;
  if (src) {
    try { src.stop(ctx.currentTime + POOL_FADE * 5); } catch (_) { /* already stopped */ }
    try { src.disconnect(); } catch (_) { /* already disconnected */ }
  }

  slot.source = null;
  slot.active = false;
  slot.type = null;
  slot.entityKey = null;
}

// ── Thames polyline helpers ───────────────────────────────────────────────

/**
 * Find the closest point on the Thames polyline to a given XZ position.
 * Returns { x, z, segIdx, dist } — the projected point and segment index.
 */
function closestPointOnThames(px, pz) {
  if (!_thamesPolyline || _thamesPolyline.length < 2) return null;

  let bestDist = Infinity;
  let bestX = 0, bestZ = 0, bestSeg = 0;

  for (let i = 0; i < _thamesPolyline.length - 1; i++) {
    const a = _thamesPolyline[i];
    const b = _thamesPolyline[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-6) continue;

    // Project point onto segment, clamp t to [0,1]
    let t = ((px - a.x) * dx + (pz - a.z) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const cx = a.x + t * dx;
    const cz = a.z + t * dz;
    const dist = Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));

    if (dist < bestDist) {
      bestDist = dist;
      bestX = cx;
      bestZ = cz;
      bestSeg = i;
    }
  }

  return { x: bestX, z: bestZ, segIdx: bestSeg, dist: bestDist };
}

/**
 * Generate virtual Thames emitter positions around the closest point.
 * Returns up to `count` positions spaced along the polyline.
 */
function getThamesEmitters(px, pz, count) {
  const closest = closestPointOnThames(px, pz);
  if (!closest) return [];

  const emitters = [{ x: closest.x, z: closest.z, segIdx: closest.segIdx }];
  const spacing = 250; // metres between emitters

  // Walk upstream and downstream from closest segment
  for (let dir = -1; dir <= 1; dir += 2) {
    for (let step = 1; emitters.length < count; step++) {
      const idx = closest.segIdx + dir * step;
      if (idx < 0 || idx >= _thamesPolyline.length - 1) break;
      const seg = _thamesPolyline[idx];
      const next = _thamesPolyline[idx + 1];
      const mx = (seg.x + next.x) * 0.5;
      const mz = (seg.z + next.z) * 0.5;
      // Only add if far enough from existing emitters
      const distFromClosest = Math.sqrt(
        (mx - closest.x) * (mx - closest.x) + (mz - closest.z) * (mz - closest.z)
      );
      if (distFromClosest > spacing * step * 0.5) {
        emitters.push({ x: mx, z: mz, segIdx: idx });
      }
      if (emitters.length >= count) break;
    }
  }

  return emitters;
}

// ── Spatial update (called from updateAudio) ──────────────────────────────

/**
 * Per-frame spatial source management.
 * Handles pool assignment, LOD tiers, and position updates.
 */
function updateSpatialSources(state) {
  if (!_poolReady || !ctx) return;

  const { cameraPosition, altitude, isUnderground } = state;
  const camX = cameraPosition.x;
  const camZ = cameraPosition.z;
  const t = ctx.currentTime;

  // ── LOD tier ──
  const realAlt = Math.abs(altitude);
  if (realAlt > LOD_MESO_ALT) {
    // Macro tier: mute all point sources
    if (pointSourceBus.gain.value > 0.01) {
      pointSourceBus.gain.setTargetAtTime(0, t, 0.3);
    }
    return;
  }

  // Restore point source bus if re-entering from macro
  const targetBusGain = realAlt > LOD_MICRO_ALT
    ? 0.8 * (1 - (realAlt - LOD_MICRO_ALT) / (LOD_MESO_ALT - LOD_MICRO_ALT))
    : 0.8;
  pointSourceBus.gain.setTargetAtTime(Math.max(0, targetBusGain), t, 0.2);

  // ── Pool assignment (throttled) ──
  _assignCounter++;
  if (_assignCounter >= ASSIGN_INTERVAL) {
    _assignCounter = 0;
    reassignPool(camX, camZ, realAlt);
  }

  // ── Position updates (throttled) ──
  _posCounter++;
  if (_posCounter >= POS_UPDATE_INTERVAL) {
    _posCounter = 0;
    updatePoolPositions();
  }
}

/**
 * Reassign pool slots to the nearest entities.
 * Runs at ~10Hz to avoid per-frame overhead.
 */
function reassignPool(camX, camZ, altitude) {
  // ── Gather candidates with distances ──
  const candidates = [];

  // Trains
  if (_trainSystemRef) {
    const trains = _trainSystemRef.allTrains;
    const maxTrains = altitude > LOD_MICRO_ALT ? 3 : MAX_TRAIN_SOURCES;
    for (let i = 0; i < trains.length; i++) {
      const pos = trains[i].position;
      const dx = pos.x - camX;
      const dz = pos.z - camZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < CULL_DISTANCE) {
        candidates.push({ key: `train-${i}`, type: 'train', dist, idx: i });
      }
    }
    // Sort by distance, limit
    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length > maxTrains) candidates.length = maxTrains;
  }

  // Thames virtual emitters
  if (_thamesPolyline) {
    const maxThames = altitude > LOD_MICRO_ALT ? 2 : MAX_THAMES_SOURCES;
    const emitters = getThamesEmitters(camX, camZ, maxThames);
    for (let i = 0; i < emitters.length; i++) {
      const em = emitters[i];
      const dx = em.x - camX;
      const dz = em.z - camZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < CULL_DISTANCE) {
        candidates.push({ key: `thames-${em.segIdx}`, type: 'thames', dist, idx: em.segIdx });
      }
    }
  }

  // Sort all candidates by distance
  candidates.sort((a, b) => a.dist - b.dist);

  // ── Determine which entities need slots ──
  const wantedKeys = new Set(candidates.slice(0, POOL_SIZE).map(c => c.key));

  // Release slots for entities no longer wanted
  for (let i = 0; i < _pool.length; i++) {
    const slot = _pool[i];
    if (slot.active && !wantedKeys.has(slot.entityKey)) {
      releaseSlot(i);
    }
  }

  // Acquire slots for new entities
  for (const cand of candidates) {
    if (_entityToSlot.has(cand.key)) continue; // already assigned
    // Find a free slot
    const freeIdx = _pool.findIndex(s => !s.active);
    if (freeIdx === -1) break; // pool exhausted
    acquireSlot(freeIdx, cand.type, cand.key);
  }
}

/**
 * Update PannerNode positions for all active pool slots.
 * Runs at ~20Hz. Train positions come from live trainSystem data.
 * Thames positions are static (polyline midpoints).
 */
function updatePoolPositions() {
  for (let i = 0; i < _pool.length; i++) {
    const slot = _pool[i];
    if (!slot.active) continue;

    let wx = 0, wz = 0, wy = 0;

    if (slot.type === 'train' && _trainSystemRef) {
      const match = slot.entityKey.match(/^train-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        const train = _trainSystemRef.allTrains[idx];
        if (train) {
          wx = train.position.x;
          wy = train.position.y;
          wz = train.position.z;
        } else {
          // Train was removed (line switch) — release
          releaseSlot(i);
          continue;
        }
      }
    } else if (slot.type === 'thames' && _thamesPolyline) {
      const match = slot.entityKey.match(/^thames-(\d+)$/);
      if (match) {
        const segIdx = parseInt(match[1], 10);
        if (segIdx < _thamesPolyline.length - 1) {
          const a = _thamesPolyline[segIdx];
          const b = _thamesPolyline[segIdx + 1];
          wx = (a.x + b.x) * 0.5;
          wz = (a.z + b.z) * 0.5;
          wy = 10; // water surface level * VE=5 ≈ 10
        }
      }
    }

    slot.panner.positionX.setValueAtTime(wx, ctx.currentTime);
    slot.panner.positionY.setValueAtTime(wy, ctx.currentTime);
    slot.panner.positionZ.setValueAtTime(wz, ctx.currentTime);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialise the audio system. Must be called inside a user gesture handler.
 * @param {THREE.PerspectiveCamera} camera
 * @returns {boolean} true if initialised successfully
 */
export function initAudio(camera) {
  if (_initialised) return true;

  try {
    // Use THREE.AudioListener for automatic camera position/orientation sync
    listener = new THREE.AudioListener();
    camera.add(listener);
    ctx = listener.context;

    // Master output chain: masterGain → compressor → destination
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(ctx.destination);

    masterGain = ctx.createGain();
    masterGain.gain.value = _masterVolume;
    masterGain.connect(compressor);

    // ── Ambient bus ──
    ambientBus = ctx.createGain();
    ambientBus.gain.value = 0.35;

    // Global lowpass for underground muffling
    undergroundLP = ctx.createBiquadFilter();
    undergroundLP.type = 'lowpass';
    undergroundLP.frequency.value = 20000;
    undergroundLP.Q.value = 0.5;

    ambientBus.connect(undergroundLP).connect(masterGain);

    // Build ambient layers
    const surface = buildSurfaceLayer(ctx, ambientBus);
    surfaceSource = surface.source;
    surfaceGain = surface.gain;

    const underground = buildUndergroundLayer(ctx, ambientBus);
    undergroundSource = underground.source;
    undergroundGain = underground.gain;

    const transition = buildTransitionLayer(ctx, ambientBus);
    transitionSource = transition.source;
    transitionGain = transition.gain;

    const wind = buildWindLayer(ctx, ambientBus);
    windSource = wind.source;
    windGain = wind.gain;
    windBandpass = wind.bandpass;

    // ── Point source bus ──
    pointSourceBus = ctx.createGain();
    pointSourceBus.gain.value = 0.8;
    pointSourceBus.connect(masterGain);

    // ── Source pool + procedural spatial buffers ──
    _trainBuffer = createTrainBuffer(ctx);
    _thamesBuffer = createThamesBuffer(ctx);
    initPool();

    // ── UI bus (Phase 4 placeholder) ──
    uiBus = ctx.createGain();
    uiBus.gain.value = 0.3;
    uiBus.connect(masterGain);

    // Resume context (autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    _initialised = true;
    console.log('[audio] Initialised — procedural ambient engine running');
    return true;

  } catch (err) {
    console.warn('[audio] Failed to initialise:', err.message);
    return false;
  }
}

/**
 * Per-frame update. Drives all gain crossfades and filter sweeps.
 *
 * @param {number} dt - Delta time in seconds
 * @param {object} state
 * @param {THREE.Vector3} state.cameraPosition
 * @param {number} state.altitude - Real-world metres (camera.position.y / VE)
 * @param {boolean} state.isUnderground
 * @param {number|null} state.surfaceY - Terrain mesh Y at camera XZ (or null)
 * @param {number} state.focalLength - Current lens focal length in mm
 */
export function updateAudio(dt, state) {
  if (!_initialised || !ctx || ctx.state === 'closed') return;

  _frameCount++;
  const t = ctx.currentTime;
  const TAU = 0.15; // smoothing time constant for setTargetAtTime

  // ── Underground transition parameter ──
  // u = 0 (above ground) → 1 (deep underground)
  // Uses real-world depth, not exaggerated mesh Y
  const { altitude, isUnderground, surfaceY, cameraPosition } = state;

  let u = 0;
  if (isUnderground && surfaceY !== null) {
    // surfaceY is in mesh space (already exaggerated), altitude is real-world
    // Compute real depth below surface
    const realSurfaceAlt = surfaceY / 5; // divide by VE
    const depth = Math.max(0, realSurfaceAlt - altitude);
    const uRaw = Math.min(depth / 30, 1); // 30m transition zone
    u = uRaw * uRaw * (3 - 2 * uRaw); // smoothstep
  } else if (isUnderground) {
    // No terrain data but underground flag set — assume moderate depth
    u = 0.7;
  }

  // ── Ambient bed crossfading ──
  // Surface: full above, fades out underground
  surfaceGain.gain.setTargetAtTime(1.0 - u, t, TAU);
  // Underground rumble: silent above, full below
  undergroundGain.gain.setTargetAtTime(u * 0.85, t, TAU);
  // Transition layer: peaks at the threshold (u ≈ 0.3-0.7)
  const transitionPeak = Math.sin(u * Math.PI); // peaks at u=0.5
  transitionGain.gain.setTargetAtTime(transitionPeak * 0.4, t, TAU);

  // ── Underground lowpass filter sweep ──
  // 20kHz (open air) → 1500Hz (deep underground)
  const lpFreq = 20000 * (1 - u) + 1500 * u;
  undergroundLP.frequency.setTargetAtTime(lpFreq, t, TAU);
  // Slight Q increase underground for "boxy tunnel" resonance
  undergroundLP.Q.setTargetAtTime(0.5 + u * 1.5, t, TAU);

  // ── Wind ──
  // Louder at altitude, silent underground. Frequency rises with altitude.
  const altAboveGround = isUnderground ? 0 : Math.max(0, altitude);
  const windAltNorm = Math.min(altAboveGround / 5000, 1); // 0-5km range

  // Wind volume: fades in above 50m, peaks at high altitude
  const windVol = isUnderground
    ? 0
    : Math.min(1, Math.max(0, (altAboveGround - 50) / 300)) * (0.15 + windAltNorm * 0.45);
  windGain.gain.setTargetAtTime(windVol, t, TAU * 2);

  // Wind frequency: 300Hz at ground level → 900Hz at 5km (thinner air)
  const windFreq = 300 + windAltNorm * 600;
  windBandpass.frequency.setTargetAtTime(windFreq, t, TAU * 3);

  // ── Macro altitude scaling ──
  // Above 5km, fade everything except wind to near-silence
  if (!isUnderground && altitude > 2000) {
    const macroFade = Math.min(1, (altitude - 2000) / 3000); // 2-5km fade
    const ambientScale = 1 - macroFade * 0.85;
    ambientBus.gain.setTargetAtTime(0.35 * ambientScale, t, TAU * 3);
  } else {
    ambientBus.gain.setTargetAtTime(0.35, t, TAU * 3);
  }

  // ── Phase 2: Spatial sources ──
  updateSpatialSources(state);
}

/**
 * Set master volume (0.0 – 1.0). Persisted across the session.
 */
export function setMasterVolume(v) {
  _masterVolume = Math.max(0, Math.min(1, v));
  if (masterGain && ctx) {
    const target = _muted ? 0 : _masterVolume;
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }
}

/**
 * Get current master volume.
 */
export function getMasterVolume() {
  return _masterVolume;
}

/**
 * Mute/unmute. Does NOT change the stored volume.
 */
export function setMuted(muted) {
  _muted = muted;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(
      muted ? 0 : _masterVolume,
      ctx.currentTime, 0.05
    );
  }
}

/**
 * Tab visibility handler. Fades to 0 when hidden, restores when visible.
 * Avoids suspend/resume which causes audible pops.
 */
export function setTabVisible(visible) {
  _tabVisible = visible;
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(
      visible && !_muted ? _masterVolume : 0,
      ctx.currentTime, 0.1
    );
  }
}

/**
 * Register spatial source data. Call once after train system and Thames data are available.
 *
 * @param {object} opts
 * @param {object} opts.trainSystem - The train system object (has .allTrains array)
 * @param {Array<{e:number,n:number}>} [opts.thamesPoints] - Thames BNG waypoints from thames.json
 */
export function initSpatialSources({ trainSystem, thamesPoints }) {
  if (trainSystem) {
    _trainSystemRef = trainSystem;
    console.log(`[audio] Registered train system (${trainSystem.allTrains.length} trains)`);
  }

  if (thamesPoints?.length) {
    // Convert BNG to scene coordinates (matches terrain.js convention)
    const BNG_REF_E = 530000;
    const BNG_REF_N = 180400;
    _thamesPolyline = thamesPoints.map(pt => ({
      x: pt.e - BNG_REF_E,
      z: -(pt.n - BNG_REF_N),
    }));
    console.log(`[audio] Registered Thames polyline (${_thamesPolyline.length} waypoints)`);
  }
}

/**
 * Debug: return current pool state. Remove before production deploy.
 */
export function getPoolDebug() {
  if (!_poolReady) return { ready: false };
  const active = _pool.filter(s => s.active);
  return {
    ready: true,
    poolSize: POOL_SIZE,
    activeSlots: active.length,
    trainSources: active.filter(s => s.type === 'train').length,
    thamesSources: active.filter(s => s.type === 'thames').length,
    entities: active.map(s => s.entityKey),
    trainSystemSize: _trainSystemRef?.allTrains?.length ?? 0,
    thamesWaypoints: _thamesPolyline?.length ?? 0,
  };
}

/**
 * Whether audio has been initialised.
 */
export function isAudioReady() {
  return _initialised;
}

/**
 * Clean up all audio resources.
 */
export function dispose() {
  if (!_initialised) return;

  // Release all pool slots
  for (let i = 0; i < _pool.length; i++) releaseSlot(i);
  _pool = [];
  _poolReady = false;
  _entityToSlot.clear();
  _trainSystemRef = null;
  _thamesPolyline = null;

  try {
    if (ctx && ctx.state !== 'closed') {
      ctx.close();
    }
  } catch (_) { /* ignore */ }
  _initialised = false;
  console.log('[audio] Disposed');
}
