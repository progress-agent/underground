// texture-pixels.js — the pixel arithmetic of the procedural textures, free of the DOM (sprint 21Oct26w, lane L,
// approach G).
//
// Every loop below is the one that lived in textures.js, moved verbatim: same constants, same operation order,
// same writes into a Uint8ClampedArray (which is what ImageData.data is, so its rounding and clamping are
// identical). They return the RGBA bytes; textures.js wraps them in a canvas texture exactly as before, and
// src/workers/opening-worker.js runs them off the main thread from boot. tests/texture-pixels.test.mjs holds the
// SHA-256 of each output against hashes produced by running 7c2d4bd's own textures.js under a canvas shim.
//
// Math.sin and friends are the same V8 implementation in a worker as on the main thread, so the bytes agree.

import { hash2d, fbmNoise } from './noise.js';

/** Terrain topside grain: 1024 px, tiled 16x16. */
export function terrainGrainPixels() {
  const size = 1024;
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Multi-frequency noise grain
      const n1 = fbmNoise(x * 0.02, y * 0.02, 4);
      const n2 = hash2d(x * 0.5, y * 0.5);
      const n3 = fbmNoise(x * 0.005, y * 0.005, 2);
      const v = (n1 * 0.6 + n2 * 0.15 + n3 * 0.25);
      // Warm earth tones: tint towards brown
      const base = Math.floor(v * 50 + 205);
      d[i]     = Math.min(255, base);           // R — slightly warm
      d[i + 1] = Math.min(255, base - 8);       // G — slightly less
      d[i + 2] = Math.min(255, base - 18);      // B — cooler = warmer overall
      d[i + 3] = 255;
    }
  }
  return d;
}

/** Terrain roughness variation: 512 px, tiled 16x16. */
export function terrainRoughnessPixels() {
  const size = 512;
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbmNoise(x * 0.015, y * 0.015, 3);
      // Roughness range 0.75-0.95 (quite rough earth/clay)
      const v = Math.floor(n * 51 + 191); // 191-242 mapped from 0.75-0.95
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return d;
}

/** Underside rock grain: 1024 px, tiled 24x24. */
export function undersideGrainPixels() {
  const size = 1024;
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Horizontal stratification — dominant grain direction
      const strata = Math.sin(y * 0.08 + fbmNoise(x * 0.01, y * 0.003, 3) * 6) * 0.5 + 0.5;

      // Fine noise grain
      const grain = fbmNoise(x * 0.03, y * 0.03, 4);

      // Fissure lines (sharp vertical cracks)
      const fissure = Math.pow(Math.abs(Math.sin(x * 0.15 + hash2d(Math.floor(x * 0.02), Math.floor(y * 0.02)) * 20)), 8);

      // Combine: strata dominant, grain adds detail, fissures darken
      const v = (strata * 0.55 + grain * 0.35 + 0.1) * (1 - fissure * 0.3);
      const base = Math.floor(v * 80 + 160);

      // Warm rock tones
      d[i]     = Math.min(255, base + 5);
      d[i + 1] = Math.min(255, base - 2);
      d[i + 2] = Math.min(255, base - 12);
      d[i + 3] = 255;
    }
  }
  return d;
}

/**
 * Sobel-derived normal map from a grain image (the underside's, and the chalk floor's): 512 px output.
 * @param {Uint8ClampedArray} sd  the grain image's RGBA bytes (only the red channel is read)
 * @param {number} sw  grain width
 * @param {number} sh  grain height
 */
export function sobelNormalPixels(sd, sw, sh) {
  const size = 512;
  const d = new Uint8ClampedArray(size * size * 4);

  function sampleHeight(sx, sy) {
    const px = ((sx % sw) + sw) % sw;
    const py = ((sy % sh) + sh) % sh;
    return sd[(py * sw + px) * 4] / 255;
  }

  const strength = 2.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Map to source coordinates
      const sx = (x / size) * sw;
      const sy = (y / size) * sh;

      // Sobel operator — 3×3 kernel for horizontal/vertical gradients
      const tl = sampleHeight(sx - 1, sy - 1);
      const t  = sampleHeight(sx,     sy - 1);
      const tr = sampleHeight(sx + 1, sy - 1);
      const l  = sampleHeight(sx - 1, sy);
      const r  = sampleHeight(sx + 1, sy);
      const bl = sampleHeight(sx - 1, sy + 1);
      const b  = sampleHeight(sx,     sy + 1);
      const br = sampleHeight(sx + 1, sy + 1);

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // Normal vector (tangent space)
      const nx = -dX * strength;
      const ny = -dY * strength;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      // Encode to RGB: [-1,1] → [0,255]
      d[i]     = Math.floor((nx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  return d;
}

/**
 * The terrain normal map's micro-grain field, the 1.3 s part of the normal map and independent of the
 * heights: fbmNoise(x * 0.04, y * 0.04, 3) for every output pixel, in doubles (not rounded), so a worker can
 * compute it before the elevations exist and the final pass reads exactly the numbers it would have computed.
 */
export function terrainNormalGrainField(outputSize = 2048) {
  const field = new Float64Array(outputSize * outputSize);
  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) field[y * outputSize + x] = fbmNoise(x * 0.04, y * 0.04, 3);
  }
  return field;
}

/**
 * Heightmap-derived normal map for the terrain topside (not tiled).
 * @param {Float32Array} heightFloats  normalised 0-1 heights
 * @param {Float64Array} [grainField]  terrainNormalGrainField(outputSize); computed per pixel when absent
 */
export function terrainNormalPixels(heightFloats, hmWidth, hmHeight, outputSize = 2048, strength = 3.0, grainField = null) {
  const d = new Uint8ClampedArray(outputSize * outputSize * 4);

  // Pre-compute step size in heightmap space per output pixel
  const hxStep = (hmWidth - 1) / outputSize;
  const hyStep = (hmHeight - 1) / outputSize;

  function sampleHM(sx, sy) {
    const px = Math.max(0, Math.min(hmWidth - 1, Math.round(sx)));
    const py = Math.max(0, Math.min(hmHeight - 1, Math.round(sy)));
    return heightFloats[py * hmWidth + px];
  }

  for (let y = 0; y < outputSize; y++) {
    for (let x = 0; x < outputSize; x++) {
      const i = (y * outputSize + x) * 4;

      // Map output pixel to heightmap coordinates
      const hx = x * hxStep;
      const hy = y * hyStep;

      // Finite-difference gradients (central difference)
      const left  = sampleHM(hx - 1, hy);
      const right = sampleHM(hx + 1, hy);
      const up    = sampleHM(hx, hy - 1);
      const down  = sampleHM(hx, hy + 1);

      let dx = (right - left) * strength;
      let dy = (down - up) * strength;

      // Composite micro-grain noise for clay particle feel
      const grain = grainField ? grainField[y * outputSize + x] : fbmNoise(x * 0.04, y * 0.04, 3);
      dx += (grain - 0.5) * 0.1;
      dy += (grain - 0.5) * 0.1;

      // Normal vector (tangent space)
      const nz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + nz * nz);

      // Encode [-1,1] → [0,255]
      d[i]     = Math.floor((-dx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.floor((-dy / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  return d;
}

/** Chalk grain: 512 px, tiled 12x12. */
export function chalkGrainPixels() {
  const size = 512;
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Powdery chalk base
      const powder = fbmNoise(x * 0.025, y * 0.025, 3) * 0.6 + 0.4;

      // Flint inclusions (sparse dark spots)
      const flint = hash2d(Math.floor(x * 0.08), Math.floor(y * 0.08));
      const isFlint = flint > 0.92 ? 0.6 : 1.0;

      const v = powder * isFlint;
      const base = Math.floor(v * 55 + 200);

      // Chalk is warm cream
      d[i]     = Math.min(255, base + 3);
      d[i + 1] = Math.min(255, base);
      d[i + 2] = Math.min(255, base - 8);
      d[i + 3] = 255;
    }
  }
  return d;
}

/** Chalk roughness: 256 px, tiled 12x12. */
export function chalkRoughnessPixels() {
  const size = 256;
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbmNoise(x * 0.02, y * 0.02, 2);
      // Roughness 0.85-1.0 (very rough chalk)
      const v = Math.floor(n * 38 + 217);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return d;
}

/** The pixel size of each square texture above (the canvases textures.js makes). */
export const TEXTURE_SIZES = {
  terrainGrain: 1024, terrainRoughness: 512, undersideGrain: 1024, undersideNormal: 512,
  terrainNormal: 2048, chalkGrain: 512, chalkRoughness: 256, chalkNormal: 512,
};
