// Procedural texture generators — all canvas-based, no external assets.
// Each function returns a THREE.CanvasTexture ready for material assignment.

import * as THREE from 'three';
import { hash2d, fbmNoise } from './noise.js';

/**
 * Terrain topside grain — multi-octave noise for earthy diffuse texture.
 * 1024px, tiled 16×16 on the terrain mesh.
 */
export function generateTerrainGrainTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Terrain roughness variation — prevents uniform shininess.
 * 512px, tiled 16×16.
 */
export function generateTerrainRoughnessTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

/**
 * Underside rock grain — stratified layering with fissure lines.
 * 1024px, tiled 24×24. This is the key texture for the "visceral, tactile" rock face.
 */
export function generateUndersideGrainTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Sobel-derived normal map from underside grain texture.
 * Generates per-pixel surface normals for light-catching relief at grazing angles.
 * 512px, tiled 24×24.
 */
export function generateUndersideNormalMap(grainTexture) {
  const srcCanvas = grainTexture.image;
  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // Sample source at reduced resolution
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const sd = srcData.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

/**
 * Heightmap-derived normal map for terrain topside.
 * Unlike the underside normal map (which derives from a tiled grain texture),
 * this computes normals from the actual heightmap elevation data — encoding
 * real London topography (hills, valleys, river channels) at per-pixel resolution.
 * Micro-grain noise is composited on top for clay particle surface detail.
 *
 * Maps 1:1 to terrain mesh UVs (NOT tiled).
 *
 * @param {Float32Array} heightFloats  Normalised 0-1 height values
 * @param {number}       hmWidth       Heightmap width in pixels (e.g. 1400)
 * @param {number}       hmHeight      Heightmap height in pixels (e.g. 1000)
 * @param {number}       [outputSize]  Output texture resolution (default 2048)
 * @param {number}       [strength]    Normal map strength multiplier
 * @returns {THREE.CanvasTexture}
 */
export function generateTerrainNormalMap(heightFloats, hmWidth, hmHeight, outputSize = 2048, strength = 3.0) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(outputSize, outputSize);
  const d = img.data;

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
      const grain = fbmNoise(x * 0.04, y * 0.04, 3);
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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  return tex;
}

/**
 * Tileable calm-water normal map. Low-frequency crossed ripples only, intended
 * for slow scrolling in the water shader rather than baked busy wave detail.
 */
export function generateWaterNormalMap(size = 256, strength = 1.6) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const slow = fbmNoise(u * 3.0, v * 3.0, 4);
      const cross = Math.sin((u * 2.0 + v * 0.72) * Math.PI * 2);
      const counter = Math.sin((u * -0.52 + v * 2.6) * Math.PI * 2 + 1.7);
      height[y * size + x] = slow * 0.58 + cross * 0.08 + counter * 0.05;
    }
  }

  const img = ctx.createImageData(size, size);
  const d = img.data;
  const sample = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const nz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + nz * nz);

      d[i]     = Math.floor((-dx / len * 0.5 + 0.5) * 255);
      d[i + 1] = Math.floor((-dy / len * 0.5 + 0.5) * 255);
      d[i + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * Chalk grain — powdery chalk with flint inclusions.
 * 512px, tiled 12×12.
 */
export function generateChalkGrainTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Chalk roughness — very rough powdery surface.
 * 256px, tiled 12×12.
 */
export function generateChalkRoughnessTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

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

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}
