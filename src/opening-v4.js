// opening-v4.js: opening study variant 4, "The film" (sprint 21Oct26w, lane V). A PROTOTYPE PREVIEW: never live, never merged.
//
// A short full-screen film (recorded from this very app, with a faked, perfectly smooth assembly) covers the first five
// seconds while the real scene loads behind it without a veil. At rest the film dissolves into the live scene at the same
// pose, and the live plunge begins. Part A (the fake assembly, record mode only) is `filmStateAt`; part B (the recorder)
// is scripts/record-opening-film.mjs; part C (the live page) is `createOpeningV4`.
import * as THREE from 'three';
import { createOpeningPath, cappedStartAltM, easeOutCubic } from './opening-path.js';
import { VISTA_BY_ID } from './opening-vistas.js';
import { riseUniforms } from './opening-rise.js';

// ── the variant's numbers (hard-coded; the film is recorded for exactly these) ───────────────────────────────────────
export const V4 = {
  vistaId: 'hampstead',   // rule V4: no eligible vista has p95 <= 33.3 ms, so the lowest p95 not taken by V1 to V3
  startAltM: 18000,
  filmLiftM: 1000,        // the film opens this much higher and settles onto the hand-over pose
  totalMs: 12000,
  tauMs: 600,
  filmMs: 4966.7,         // 149 frames at 30 fps: the last frame is the rest pose
  filmFrames: 150,
  fps: 30,
  cloudT0: 0,
  master: 1.1,
  focalLength: 30,        // lensSystem.getFocalLength() at the recording (the settings guard compares)
};
const FILM_REST_CLOUD = V4.cloudT0 + V4.filmMs / 1000;

/** The path the variant flies (S 18,000 m up behind the crossing, down to the landing). */
export function buildV4Path(masterValue = V4.master) {
  const v = VISTA_BY_ID[V4.vistaId];
  return createOpeningPath({ C: v.C, surfaceYAtC: v.surfaceYAtC, E: v.E, L: v.L, startAltM: V4.startAltM,
    master: masterValue, totalMs: V4.totalMs, tauMs: V4.tauMs });
}

// ── Part A: what the film shows at film time `ms` (pure) ─────────────────────────────────────────────────────────────
export const RISE = { startMs: 2000, endMs: 4200, bandM: 1500, halfSpanM: 12000 };
export function filmStateAt(ms) {
  const span = RISE.halfSpanM * 2 + RISE.bandM;
  const u = Math.min(1, Math.max(0, (ms - RISE.startMs) / (RISE.endMs - RISE.startMs)));
  return {
    water: ms >= 600,           // Thames, reservoirs, canals
    artwork: ms >= 1300,        // ground artwork and park names
    infra: ms >= 1900,          // M25, airports, docks, bridges
    buildings: ms >= RISE.startMs,
    front: ms < RISE.startMs ? -1 : u * span,
    landmarks: ms >= RISE.startMs + 0.6 * (RISE.endMs - RISE.startMs),
    rail: ms >= 4200,           // Overground, open-air track and trains, surface station markers
    labels: ms >= 4200,         // station labels
  };
}

/** The film camera: 1,000 m higher at t = 0, easing out to rest at the hand-over pose on the last frame. */
export function filmCameraPos(S, ms, out = new THREE.Vector3()) {
  const lift = V4.filmLiftM * 5 * (1 - easeOutCubic(Math.min(1, ms / V4.filmMs)));
  return out.set(S.x, S.y + lift, S.z);
}

export const LATE_RECORD_IDS = ['canals', 'reservoirs', 'surfaceTrains', 'seaLife', 'motorway', 'cliff', 'airports', 'flights'];

// ── Part C: the director ─────────────────────────────────────────────────────────────────────────────────────────────
export function createOpeningV4(deps) {
  const { camera, scene, intro, gate, lateLayers, cloudSystem, masterHeight, lensSystem, path, layers,
    setGroundArtwork, baked, isBypassed } = deps;
  const q = new URLSearchParams(location.search);
  const record = q.get('film') === 'record';
  const debug = q.has('filmDebug');
  const wrap = document.getElementById('ugFilmWrap');
  const video = document.getElementById('ugFilm');
  const veil = document.getElementById('loadingBar');
  const root = document.documentElement;
  const t0 = performance.now();

  const opening = (window.__ugOpening = {
    variant: 4, startAltM: path.startAltM, vista: V4.vistaId, phases: [],
    params: { ostart: q.get('ostart'), ovista: q.get('ovista'), honoured: { start: false, vista: false } },
  });
  function mark(phase, extra = {}) {
    const st = gate.getState();
    const detail = { phase, at: performance.now(), stage: st.stage, fraction: st.fraction, ...extra };
    opening.phases.push(detail);
    try { window.dispatchEvent(new CustomEvent('ug:opening-phase', { detail })); } catch (_) { /* noop */ }
  }

  let gateReady = false, filmEnded = false, filmPlaying = false, handedOver = false, fallback = false;
  let firstTick = true, handoverAt = 0, crossingMarked = false, landed = false, doneAdded = false;
  let beginTimer = 0, filmEndedAt = 0;

  // The film does not apply: a deep link, a record run, or a settings mismatch. The veil then does the job it always did.
  function dropFilm(reason, phase) {
    if (wrap) wrap.remove();
    root.classList.add('ug-nofilm');
    if (veil) veil.style.visibility = 'visible';
    fallback = true;
    if (phase) mark(phase, { reason });
  }

  // ── record mode ──────────────────────────────────────────────────────────────────────────────────────────────────────
  let filmMsNow = null, recordReady = false;
  const S = path.S, L = path.L;
  const minX = S.x - RISE.halfSpanM;
  function applyVisible(o, v) { if (o && o.visible !== v) o.visible = v; }
  function applyFilm(ms) {
    const st = filmStateAt(ms);
    const l = layers();
    for (const o of l.water) applyVisible(o, st.water);
    for (const o of l.infra) applyVisible(o, st.infra);
    for (const o of l.rail) applyVisible(o, st.rail);
    for (const o of l.parks) applyVisible(o, st.artwork);
    applyVisible(l.buildings, st.buildings);
    applyVisible(l.landmarks, st.landmarks);
    setGroundArtwork(st.artwork);
    riseUniforms.uRiseMinX.value = minX;
    riseUniforms.uRiseBand.value = RISE.bandM;
    riseUniforms.uRiseFront.value = st.front;
    document.body.classList.toggle('ug-film-nolabels', !st.labels);
    filmCameraPos(S, ms, camera.position);
    camera.lookAt(L.x, L.y, L.z);
    camera.updateMatrixWorld(true);
    cloudSystem.setTimeOverride(V4.cloudT0 + ms / 1000);
  }
  function enterRecordMode() {
    document.body.classList.add('ug-film-recording');
    root.classList.add('ug-nofilm');
    if (wrap) wrap.remove();
    for (const id of LATE_RECORD_IDS) { try { lateLayers.request(id); } catch (_) { /* not defined: skipped */ } }
  }
  function recordUpdate() {
    if (!recordReady) {
      const allLate = LATE_RECORD_IDS.every(id => { const st = lateLayers.state(id); return st === 'attached' || st === 'failed'; });
      if (gateReady && allLate && baked().isDone()) {
        recordReady = true;
        filmMsNow = 0;
        window.__ugFilm = {
          ready: true,
          focalLength: lensSystem.getFocalLength(),
          master: masterHeight.value,
          frames: V4.filmFrames, fps: V4.fps,
          renderAt(ms) { filmMsNow = ms; applyFilm(ms); },
        };
      }
      return;
    }
    if (filmMsNow !== null) applyFilm(filmMsNow);
  }

  // ── live mode ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const aspectZoom = () => {
    const a = window.innerWidth / window.innerHeight;
    return a > 16 / 9 ? a / (16 / 9) : 1;
  };
  function setZoom(z) {
    if (Math.abs(camera.zoom - z) > 1e-6) { camera.zoom = z; camera.updateProjectionMatrix(); }
  }

  function startFilm() {
    if (!video) return dropFilm('no video element', 'film-fallback');
    video.addEventListener('playing', () => { if (!filmPlaying) { filmPlaying = true; mark('film-start'); } });
    video.addEventListener('ended', () => { filmEnded = true; mark('film-end'); });
    video.addEventListener('error', () => { if (!handedOver && !fallback) dropFilm('video error', 'film-fallback'); });
    const p = video.play();
    if (p && p.catch) p.catch(() => { /* autoplay refused: the 2 s check below falls back */ });
  }

  function doHandover() {
    handedOver = true;
    handoverAt = performance.now();
    // The live frame at this instant is the film's last frame: camera at pose 0, clouds on the film's clock.
    mark('handover');
    mark('cover-lifted');
    requestAnimationFrame(() => {
      // The live frame has rendered under the film; fade the film out, then start the descent.
      if (!wrap) { beginDescent(); return; }
      wrap.classList.add('done');
      doneAdded = true;
      const go = () => { clearTimeout(beginTimer); wrap.removeEventListener('transitionend', go); wrap.remove(); beginDescent(); };
      wrap.addEventListener('transitionend', go);
      beginTimer = setTimeout(go, 600);
    });
  }
  let began = false;
  function beginDescent() {
    if (began) return;
    began = true;
    intro.begin();
    mark('descent-begin');
  }

  function liveUpdate(dt) {
    if (firstTick) {
      firstTick = false;
      mark('cover-on');
      if (!fallback) startFilm();
    }
    const now = performance.now();
    if (!fallback && !handedOver) {
      // Safety net: a film that is not playing 2 s after the first tick is dropped (not the moment, a net).
      if (video && !filmPlaying && !video.paused && video.currentTime > 0) { filmPlaying = true; mark('film-start'); }
      if (video && video.ended && !filmEnded) { filmEnded = true; mark('film-end'); }
      if (!filmPlaying && now - t0 > 4000) dropFilm('not playing', 'film-fallback');
    }
    if (!fallback) setZoom(handedOver ? zoomAfter() : aspectZoom());
    // Cloud clock: pinned at the film's rest time until hand-over, then running from it until landing.
    if (!landed) {
      cloudSystem.setTimeOverride(handedOver ? FILM_REST_CLOUD + (now - handoverAt) / 1000 : FILM_REST_CLOUD);
    }
    if (!handedOver && !fallback) {
      if (filmEnded && gateReady && !filmEndedAt) filmEndedAt = now;
      if (filmEnded && gateReady && (lateOk() || now - filmEndedAt > 3000)) doHandover();
      else if (filmEnded && !opening.phases.some(p => p.phase === 'film-hold')) mark('film-hold');
    }
    if (fallback && gateReady && !began) {
      // No film: the veil path as before (the gate's default reveal, done here because onReady replaced it).
      if (veil) veil.classList.add('done');
      mark('cover-lifted');
      beginDescent();
    }
    if (began && !crossingMarked && intro.isPlaying() && intro.getPlayedMs() >= path.msAtArc(path.uC)) {
      crossingMarked = true;
      mark('crossing');
    }
  }
  // After hand-over the zoom eases back to 1 over the descent's first 3 s (easeInOutCubic).
  function zoomAfter() {
    const z0 = aspectZoom();
    if (z0 === 1 || !began) return z0;
    const t = Math.min(1, intro.getPlayedMs() / 3000);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    return z0 + (1 - z0) * e;
  }
  // Layers that are visible from 18,000 m and requested at boot must be attached before the hand-over.
  const WAIT_LATE = ['canals', 'reservoirs', 'surfaceTrains'];
  function lateOk() {
    return WAIT_LATE.every(id => { const s = lateLayers.state(id); return s === null || s === 'attached' || s === 'failed'; });
  }

  window.addEventListener('ug:intro-done', () => {
    if (record) return;
    landed = true;
    cloudSystem.setTimeOverride(null);
    setZoom(1);
    mark('landed', { camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z } });
  });

  // ── boot ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (record) enterRecordMode();
  else if (isBypassed()) dropFilm('deep link');
  else if (masterHeight.value !== V4.master || Math.abs(lensSystem.getFocalLength() - V4.focalLength) > 0.01) {
    dropFilm('settings differ from the recording', 'film-skipped');
  } else {
    // The deferred layers the film's frame shows are requested at once, and awaited at the hand-over.
    for (const id of WAIT_LATE) { try { lateLayers.request(id); } catch (_) { /* skipped */ } }
  }

  return {
    onReady() { gateReady = true; },
    update(dt) {
      if (record) { recordUpdate(); return; }
      liveUpdate(dt);
    },
    get handedOver() { return handedOver; },
    get debug() { return debug; },
  };
}
