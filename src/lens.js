/**
 * lens.js — Physically-motivated lens character simulation.
 *
 * Couples barrel distortion, chromatic aberration, and vignetting
 * to a focal-length slider. Dolly mode moves the camera so wide/tele
 * delivers the true perceptual feel rather than a simple crop.
 *
 * Based on multi-model consultation (Gemini, GPT-5.2, Kimi K2.5).
 * See _REPORTS/02Mar26m/wAr-LensSimulation-1730.md
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ── Shader definition ──────────────────────────────────────────────
// Single fullscreen pass: cubic radial distortion + chromatic aberration + vignette.
// Filmic-GL model: r' = r * (1 + k*r² + kcube*r²^1.5)
const LensCharacterShader = {
  name: 'LensCharacterShader',

  uniforms: {
    tDiffuse:           { value: null },
    k:                  { value: 0.0 },     // radial distortion (neg=barrel, pos=pincushion)
    kcube:              { value: 0.0 },     // cubic correction for ultra-wide
    dispersion:         { value: 0.0 },     // chromatic aberration magnitude
    vignetteIntensity:  { value: 0.0 },     // cos⁴ vignette strength
    scale:              { value: 1.0 },     // compensate barrel zoom-out
    aspectRatio:        { value: 1.0 },     // keep distortion circular
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float k;
    uniform float kcube;
    uniform float dispersion;
    uniform float vignetteIntensity;
    uniform float scale;
    uniform float aspectRatio;

    varying vec2 vUv;

    // Apply radial distortion to a UV offset from centre.
    // Returns distorted UV in screen space.
    vec2 distortUV(vec2 uv, float kk, float kkc) {
      // Centre and correct for aspect ratio so distortion is circular
      vec2 centred = (uv - 0.5) / scale;
      centred.x *= aspectRatio;

      float r2 = dot(centred, centred);
      float r = sqrt(r2);

      // Brown-Conrady: r' = r * (1 + k*r² + kcube*r³)
      float f = 1.0 + kk * r2 + kkc * r2 * r;

      centred *= f;
      centred.x /= aspectRatio;
      return centred + 0.5;
    }

    void main() {
      // Per-channel radial offset for chromatic aberration
      float rK    = k * (1.0 + dispersion);
      float rKc   = kcube * (1.0 + dispersion);
      float bK    = k * (1.0 - dispersion);
      float bKc   = kcube * (1.0 - dispersion);

      vec2 uvR = distortUV(vUv, rK, rKc);
      vec2 uvG = distortUV(vUv, k, kcube);
      vec2 uvB = distortUV(vUv, bK, bKc);

      // Sample each channel (clamp to avoid wrapping artefacts)
      float red   = texture2D(tDiffuse, clamp(uvR, 0.0, 1.0)).r;
      float green = texture2D(tDiffuse, clamp(uvG, 0.0, 1.0)).g;
      float blue  = texture2D(tDiffuse, clamp(uvB, 0.0, 1.0)).b;

      vec3 col = vec3(red, green, blue);

      // Cos⁴ vignette — natural light falloff approximation
      vec2 vigUv = vUv - 0.5;
      vigUv.x *= aspectRatio;
      float d2 = dot(vigUv, vigUv);
      float vig = 1.0 - vignetteIntensity * d2 * 2.0;
      vig = clamp(vig * vig, 0.0, 1.0);
      col *= vig;

      // Black out anything that fell outside the frame
      if (uvG.x < 0.0 || uvG.x > 1.0 || uvG.y < 0.0 || uvG.y > 1.0) {
        col = vec3(0.0);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// ── Focal length → lens params mapping ─────────────────────────────
// GPT-5.2's log-scale + smoothstep curve, tuned for cinematic feel.
function smoothstep(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function computeLensParams(focalMm) {
  // Normalise to 0-1 range on a log scale (12mm=0, 200mm=1)
  const t = (Math.log(focalMm) - Math.log(12)) / (Math.log(200) - Math.log(12));
  const s = smoothstep(t);

  const kVal = lerp(-0.35, 0.05, s);                         // barrel → pincushion
  const kcubeVal = focalMm < 24 ? lerp(0.15, 0.0, t / 0.25) : 0; // cubic for ultra-wide only
  const dispersionVal = lerp(0.008, 0.0, s);                 // CA strongest at wide
  const vignetteVal = lerp(0.45, 0.0, s);                    // corner darkening at wide
  const scaleVal = 1 + Math.max(0, -kVal) * 0.5;             // compensate barrel zoom-out

  return { k: kVal, kcube: kcubeVal, dispersion: dispersionVal, vignetteIntensity: vignetteVal, scale: scaleVal };
}

// ── Factory ────────────────────────────────────────────────────────
/**
 * Create the lens simulation system.
 * Inserts a ShaderPass into the EffectComposer between bloom and OutputPass.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {EffectComposer} composer
 * @param {OrbitControls} controls
 * @returns {{ setFocalLength, updateAspect, getFocalLength, pass }}
 */
export function createLensSystem(camera, composer, controls) {
  // Set 35mm full-frame gauge so setFocalLength maps correctly to FOV
  camera.filmGauge = 36;

  const lensPass = new ShaderPass(LensCharacterShader);
  lensPass.uniforms.aspectRatio.value = camera.aspect;

  // Insert between bloom (idx 1) and OutputPass (currently idx 2 → pushed to 3)
  composer.insertPass(lensPass, 2);

  let currentMm = 35;

  function setFocalLength(mm) {
    mm = Math.max(12, Math.min(200, mm));
    const oldMm = currentMm;
    currentMm = mm;

    // Update camera projection (Three.js maps focal length to FOV via filmGauge)
    camera.setFocalLength(mm);
    camera.updateProjectionMatrix();

    // Update shader uniforms
    const params = computeLensParams(mm);
    lensPass.uniforms.k.value = params.k;
    lensPass.uniforms.kcube.value = params.kcube;
    lensPass.uniforms.dispersion.value = params.dispersion;
    lensPass.uniforms.vignetteIntensity.value = params.vignetteIntensity;
    lensPass.uniforms.scale.value = params.scale;

    // Dolly: move camera along camera→target vector to preserve framing
    if (oldMm !== mm && oldMm > 0) {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
      const currentDist = dir.length();
      const ratio = mm / oldMm;
      const newDist = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, currentDist * ratio)
      );
      dir.normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(dir);
    }
  }

  function updateAspect(aspect) {
    lensPass.uniforms.aspectRatio.value = aspect;
  }

  function getFocalLength() {
    return currentMm;
  }

  // Apply initial 35mm settings
  setFocalLength(35);

  return { setFocalLength, updateAspect, getFocalLength, pass: lensPass };
}
