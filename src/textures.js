// Procedural texture generators — all canvas-based, no external assets.
// Each function returns a THREE.CanvasTexture ready for material assignment.

import * as THREE from 'three';
import { hash2d, fbmNoise } from './noise.js';
import {
  terrainGrainPixels, terrainRoughnessPixels, undersideGrainPixels, sobelNormalPixels,
  terrainNormalPixels, chalkGrainPixels, chalkRoughnessPixels,
} from './texture-pixels.js';

// s21:L (approach G): the pixel arithmetic of every texture below lives in texture-pixels.js (DOM-free, so a
// worker can run it from boot). A texture is made from its pixels exactly as before: a canvas of the same size,
// putImageData, a CanvasTexture with the same wrap, repeat and colour space, so what reaches the GPU is the same
// bytes through the same path. The *TextureFrom(pixels) functions take pixels computed anywhere.

/** A canvas holding `pixels` (RGBA, size x size) wrapped as a CanvasTexture; the settings are applied by the caller. */
export function canvasTextureFromPixels(pixels, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(pixels);
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

/** RGBA bytes of a grain texture's canvas (the underside and chalk normal maps read its red channel). */
function pixelsOfTexture(tex) {
  const srcCanvas = tex.image;
  return srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;
}

/**
 * Terrain topside grain — multi-octave noise for earthy diffuse texture.
 * 1024px, tiled 16×16 on the terrain mesh.
 */
export function terrainGrainTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 1024);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export function generateTerrainGrainTexture() { return terrainGrainTextureFrom(terrainGrainPixels()); }

/**
 * Terrain roughness variation — prevents uniform shininess.
 * 512px, tiled 16×16.
 */
export function terrainRoughnessTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 512);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}
export function generateTerrainRoughnessTexture() { return terrainRoughnessTextureFrom(terrainRoughnessPixels()); }

/**
 * Underside rock grain — stratified layering with fissure lines.
 * 1024px, tiled 24×24. This is the key texture for the "visceral, tactile" rock face.
 */
export function undersideGrainTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 1024);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export function generateUndersideGrainTexture() { return undersideGrainTextureFrom(undersideGrainPixels()); }

/**
 * Sobel-derived normal map from underside grain texture.
 * Generates per-pixel surface normals for light-catching relief at grazing angles.
 * 512px, tiled 24×24.
 */
export function undersideNormalTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 512);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}
export function generateUndersideNormalMap(grainTexture) {
  const srcCanvas = grainTexture.image;
  return undersideNormalTextureFrom(sobelNormalPixels(pixelsOfTexture(grainTexture), srcCanvas.width, srcCanvas.height));
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
export function terrainNormalTextureFrom(pixels, outputSize = 2048) {
  const tex = canvasTextureFromPixels(pixels, outputSize);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  return tex;
}
export function generateTerrainNormalMap(heightFloats, hmWidth, hmHeight, outputSize = 2048, strength = 3.0) {
  return terrainNormalTextureFrom(terrainNormalPixels(heightFloats, hmWidth, hmHeight, outputSize, strength), outputSize);
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
export function chalkGrainTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 512);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export function generateChalkGrainTexture() { return chalkGrainTextureFrom(chalkGrainPixels()); }

/**
 * Chalk roughness — very rough powdery surface.
 * 256px, tiled 12×12.
 */
export function chalkRoughnessTextureFrom(pixels) {
  const tex = canvasTextureFromPixels(pixels, 256);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}
export function generateChalkRoughnessTexture() { return chalkRoughnessTextureFrom(chalkRoughnessPixels()); }
