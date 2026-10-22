// opening-v2.js (s21:V2): opening study variant 2, "From the landing outwards". A PROTOTYPE PREVIEW, never live.
//
// The page opens on the sky; when the terrain, water and M25 exist the camera tilts down to the landing; the city rises
// in a ring spreading from the crossing point while the descent is already under way; a governor keeps the camera
// behind the build. Everything is a function of the frame deltas (clamped to 50 ms), nothing random.
import * as THREE from 'three';
import { riseUniforms } from './opening-rise.js';
import { getBuildingHeightScale } from './surface-geometry.js';

const SKY_PITCH_DEG = 32;       // displayed degrees above the horizon (brief says 20; 32 keeps the whole frame sky at fov 55)
const TILT_MS = 2000;
const FRONT_MPS = 1500;         // metres of plan per second
const BEGIN_FRONT_M = 2000;
const HOLD_ALT_M = 2500;
const TALLEST_Y = 320 * 5;      // canonical y units
const MAX_STEP = 0.05;

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createOpeningV2({ camera, intro, gate, path, vista, startAltM, masterHeight, getBuilder, getLandmarkGroup, setPumpMs, params = {} }) {
  const record = window.__ugOpening = { variant: 2, startAltM, vista: vista.id, vistaName: vista.name, phases: [], params };
  const mark = (phase, extra = {}) => {
    const st = gate.getState();
    const detail = { phase, at: performance.now(), stage: st.stage, fraction: st.fraction, ...extra };
    record.phases.push(detail);
    try { window.dispatchEvent(new CustomEvent('ug:opening-phase', { detail })); } catch (_) { /* noop */ }
  };

  const C = path.C, S = path.S;
  const hx = path.L.x - C.x, hz = path.L.z - C.z, hl = Math.hypot(hx, hz) || 1;
  const ux = hx / hl, uz = hz / hl;
  // Sky look: a canonical direction of vertical slope k displays as k * ratio.
  const qSky = new THREE.Quaternion();
  const qL = new THREE.Quaternion();
  {
    const tmp = camera.clone();
    tmp.position.copy(S);
    const k = Math.tan(SKY_PITCH_DEG * Math.PI / 180) / (masterHeight?.ratio || 1);
    const d = new THREE.Vector3(ux, k, uz).normalize().multiplyScalar(1000);
    tmp.lookAt(S.x + d.x, S.y + d.y, S.z + d.z); tmp.updateMatrixWorld(true);
    qSky.copy(tmp.quaternion);
    tmp.lookAt(path.L); tmp.updateMatrixWorld(true);
    qL.copy(tmp.quaternion);
  }
  // Governor caps (arc fractions). The 2,500 m cap: bisection on the path's height.
  const capY = path.C.y + HOLD_ALT_M * 5;
  let capLow;
  {
    let lo = 0, hi = path.uA;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (path.pointAtArc(mid).y > capY) lo = mid; else hi = mid; }
    capLow = hi;
  }

  let ticks = 0, clock = 0;
  let phase = 'sky';             // sky | tilt | descent
  let tiltT = 0;
  let sweepStart = null, sweepT = 0;
  let begun = false, beginAt = null;
  let cityComplete = false, gateDone = false, crossed = false, holding = false, holdEver = false, risen = false;
  let rate = 1, front = 0;

  const settled = (id) => gate.readiness.isSettled(id);
  riseUniforms.uRiseFront.value = 0; // nothing rises into view before the sweep starts
  document.body.classList.add('ug-opening-v2');
  window.addEventListener('ug:intro-done', () => {
    riseUniforms.uRiseFront.value = 1e9;
    mark('landed', { camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z } });
  }, { once: true });

  function setFront(f) {
    front = f;
    riseUniforms.uRiseFront.value = f;
  }

  function update(dt) {
    if (intro.getPhase() === 'bypassed' || intro.getPhase() === 'done' && risen) return;
    const step = Math.min(Math.max(0, dt || 0), MAX_STEP);
    clock += step;
    if (ticks++ === 0) { mark('cover-on'); camera.quaternion.copy(qSky); camera.updateMatrixWorld(true); }
    const builder = getBuilder();

    // The rise is anchored on the crossing.
    riseUniforms.uRiseOrigin.value.set(C.x, C.z);
    riseUniforms.uRiseDepth.value = TALLEST_Y * Math.max(0.05, getBuildingHeightScale()) * 1.1;

    if (phase === 'sky') {
      camera.quaternion.copy(qSky); camera.updateMatrixWorld(true);
      if (settled('terrain') && settled('water') && settled('m25')) {
        phase = 'tilt'; tiltT = 0;
        mark('tilt-start'); mark('cover-lifted');
        document.body.classList.add('ug-opening-v2-watched');
        setPumpMs?.(10);
      }
    }
    if (phase === 'tilt' || phase === 'descent') {
      // Sweep begins at the later of tilt-start and the builder existing.
      if (sweepStart === null && builder) { sweepStart = clock; sweepT = 0; mark('sweep-start'); }
      if (sweepStart !== null) {
        sweepT += step;
        const r = FRONT_MPS * sweepT;
        const cr = builder ? builder.completeRadius({ x: C.x, z: C.z }) : 0;
        if (!risen) setFront(Math.min(r, cr));
        if (!cityComplete && builder?.isDone() && getLandmarkGroup() && settled('ground')) { cityComplete = true; mark('city-complete'); }
      } else if (!risen) setFront(0);
    }
    if (phase === 'tilt') {
      tiltT += step * 1000;
      const k = easeInOutCubic(Math.min(1, tiltT / TILT_MS));
      camera.quaternion.slerpQuaternions(qSky, qL, k);
      camera.updateMatrixWorld(true);
      if (tiltT >= TILT_MS && !begun) {
        mark('tilt-end');
        phase = 'descent'; // wait for the front before beginning
      }
    }
    if (phase === 'descent' && !begun) {
      camera.quaternion.copy(qL); camera.updateMatrixWorld(true);
      if (front >= BEGIN_FRONT_M) { begun = true; mark('descent-begin'); intro.begin(); }
    }

    if (begun) {
      if (!gateDone && gate.stage() === 'done') gateDone = true;
      const played = intro.getPlayedMs();
      // Governor: where the camera may be at most.
      const cap = !cityComplete ? capLow : (!gateDone ? path.uA : 1);
      const target = cap >= 1 ? 1 : Math.min(1, Math.max(0, (path.msAtArc(cap) - played) / 600));
      rate += (target - rate) * Math.min(1, step / 0.25);
      if (!holding && rate < 0.5 && target < 0.5) { holding = true; holdEver = true; mark('hold-start'); }
      else if (holding && rate >= 0.5) { holding = false; mark('hold-end'); }
      if (!crossed && path.arcAt(played) >= path.uC) {
        crossed = true; mark('crossing');
        // Below the ground nothing of the rise can be seen: finish it.
        risen = true; riseUniforms.uRiseFront.value = 1e9;
      }
    }
    // Title fades with the tilt.
    // (CSS handles it through the body class.)
  }

  const frontNow = () => (risen ? 1e9 : riseUniforms.uRiseFront.value);
  return {
    update,
    rate: () => rate,
    onGateReady: () => mark('gate-done'),
    skipOpen: () => gate.stage() === 'done',
    maskFront: frontNow,
    origin: () => ({ x: C.x, z: C.z }),
    info: () => ({ phase, begun, cityComplete, gateDone, rate, front, holdEver }),
  };
}
