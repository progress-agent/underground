// surface-texture.js — Shader-based surface features (parks + roads)
//
// Creates a persistent RGBA DataTexture spanning the full M25 area.
// Tile data from surface-loader.js is incrementally rasterised into it
// as tiles load (parks → A channel, roads → B channel).
// Buildings are handled by surface-geometry.js (instanced 3D boxes).
//
// The terrain material already has an onBeforeCompile callback from the M25
// mask module (m25.js). This module chains AFTER it — never replaces it.
//
// UV convention:
//   vM25Uv (raw mesh UV after rotateX(-PI/2)):
//     u=0 west,  u=1 east
//     v=0 south,  v=1 north
//
//   DataTexture with flipY=false:
//     pixel row 0 → v=0 (south), row (size-1) → v=1 (north)
//     pixel col 0 → u=0 (west),  col (size-1) → u=1 (east)
//
//   This means the texture and vM25Uv use the same orientation — no flip needed.

import * as THREE from 'three';

// ─── BNG / scene reference (must match terrain.js, m25.js) ──────────────────
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Terrain BNG bounds (from london_full_height.json metadata)
const TERRAIN_BNG = {
  minE: 490000, maxE: 560000,  // 70 km E-W
  minN: 155000, maxN: 205000,  // 50 km N-S
};

// ─── Coordinate helpers ─────────────────────────────────────────────────────

/**
 * Convert scene X to BNG easting.
 */
function sceneXToEasting(x) {
  return x + BNG_REF_E;
}

/**
 * Convert scene Z to BNG northing.
 * Scene Z is inverted: north = negative Z.
 */
function sceneZToNorthing(z) {
  return -z + BNG_REF_N;
}

/**
 * Convert scene (x, z) to terrain mesh UV (matching vM25Uv).
 *   u = 0 at west (minE),  u = 1 at east  (maxE)
 *   v = 0 at south (minN), v = 1 at north (maxN)
 *
 * Note: this is the RAW MESH UV convention, not xzToTerrainUV() from terrain.js
 * which uses the opposite v direction (v=0 north, v=1 south).
 */
function sceneToMeshUV(x, z) {
  const e = sceneXToEasting(x);
  const n = sceneZToNorthing(z);
  return {
    u: (e - TERRAIN_BNG.minE) / (TERRAIN_BNG.maxE - TERRAIN_BNG.minE),
    v: (n - TERRAIN_BNG.minN) / (TERRAIN_BNG.maxN - TERRAIN_BNG.minN),
  };
}

// ─── Rasterisation utilities ────────────────────────────────────────────────

/**
 * Convert a scene coordinate to a pixel position in the data texture.
 *
 * The data's sceneBBox defines the region of interest. Pixels outside this
 * bbox are simply never written (remain zeroed).
 *
 * @param {number} sceneX    Scene X coordinate
 * @param {number} sceneZ    Scene Z coordinate
 * @param {object} bbox      { minX, maxX, minZ, maxZ } in scene coords
 * @param {number} size      Texture resolution (pixels)
 * @returns {{ px: number, py: number }} pixel coords, or null if outside
 */
function sceneToPx(sceneX, sceneZ, bbox, size) {
  const rangeX = bbox.maxX - bbox.minX;
  const rangeZ = bbox.maxZ - bbox.minZ;
  if (rangeX === 0 || rangeZ === 0) return null;

  const normX = (sceneX - bbox.minX) / rangeX;
  // Z axis: minZ is most-negative (north), maxZ is most-positive (south).
  // Texture row 0 = v=0 = south = maxZ.  Row (size-1) = v=1 = north = minZ.
  // So pixel-Y increases from south to north:
  const normY = (bbox.maxZ - sceneZ) / rangeZ;

  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null;

  return {
    px: Math.round(normX * (size - 1)),
    py: Math.round(normY * (size - 1)),
  };
}

/**
 * Point-in-polygon test (ray casting, even-odd rule).
 *
 * @param {number}   x       Test X
 * @param {number}   y       Test Y
 * @param {number[][]} poly  Array of [x, y] pairs
 * @returns {boolean}
 */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) &&
        x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Signed distance from point (px, py) to the line segment (ax, ay)→(bx, by).
 * Returns the perpendicular distance (always >= 0).
 */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    // Degenerate segment — just point distance
    const ex = px - ax, ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX, ey = py - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

// ─── Texture creation + incremental rasterisation ───────────────────────────

/**
 * Create an empty RGBA DataTexture for the full surface area.
 *
 * Channel encoding:
 *   R = unused (0)
 *   G = unused (0)
 *   B = road presence     (0 or 255)
 *   A = park presence     (0 or 255)
 *
 * Tiles are rasterised incrementally via rasteriseTile().
 *
 * @param {object} fullBBox  { minX, maxX, minZ, maxZ } — full M25-area scene bbox
 * @param {number} [size]    Texture resolution in pixels (default 4096)
 * @returns {{ texture: THREE.DataTexture, pixels: Uint8Array, size: number, bbox: object }}
 */
export function createSurfaceTexture(fullBBox, size = 4096) {
  const pixels = new Uint8Array(size * size * 4); // RGBA, initialised to 0

  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  console.log(`Surface texture created: ${size}×${size} (empty, awaiting tiles)`);
  return { texture: tex, pixels, size, bbox: fullBBox };
}

/**
 * Rasterise a single tile's parks and roads into the persistent texture.
 *
 * Parks are written to the A channel, roads to the B channel.
 * The fullBBox (stored in texState.bbox) maps scene coords to pixel positions
 * across the entire texture — each tile's features land in the correct region.
 *
 * @param {{ texture, pixels, size, bbox }} texState  From createSurfaceTexture()
 * @param {object} tileData  Parsed tile JSON (parks, roads arrays)
 */
export function rasteriseTile(texState, tileData) {
  const { pixels, size, bbox } = texState;
  const t0 = performance.now();
  let parkCount = 0, roadCount = 0;

  // Rasterise parks (original leisure=park, landuse=grass)
  if (tileData.parks) {
    for (const park of tileData.parks) {
      if (!park.polygon || park.polygon.length < 3) continue;
      rasterisePolygon(park.polygon, bbox, size, pixels, (idx) => {
        pixels[idx + 3] = 255; // A = green
      });
      parkCount++;
    }
  }

  // Rasterise supplementary greenery (wood, heath, farmland, etc.)
  if (tileData.greenery) {
    for (const green of tileData.greenery) {
      if (!green.polygon || green.polygon.length < 3) continue;
      rasterisePolygon(green.polygon, bbox, size, pixels, (idx) => {
        pixels[idx + 3] = 255; // A = green (same channel as parks)
      });
      parkCount++;
    }
  }

  if (tileData.roads) {
    for (const road of tileData.roads) {
      if (!road.points || road.points.length < 2) continue;
      rasteriseRoad(road.points, road.width || 10, bbox, size, pixels);
      roadCount++;
    }
  }

  texState.texture.needsUpdate = true;

  const elapsed = (performance.now() - t0).toFixed(1);
  console.log(`Surface tile rasterised: ${parkCount} parks, ${roadCount} roads (${elapsed}ms)`);
}

/**
 * Rasterise a polygon into the pixel buffer, calling `paintFn(pixelIndex)`
 * for every pixel inside the polygon.
 *
 * Uses scanline fill: compute the polygon's bounding box in pixel space,
 * then test each pixel with point-in-polygon.
 *
 * Polygon vertices are in scene coordinates [x, z].
 */
function rasterisePolygon(polygon, bbox, size, pixels, paintFn) {
  // Convert polygon vertices to pixel coords
  const pxPoly = [];
  let minPx = size, maxPx = 0, minPy = size, maxPy = 0;

  for (const [sx, sz] of polygon) {
    const p = sceneToPx(sx, sz, bbox, size);
    if (!p) continue;
    pxPoly.push([p.px, p.py]);
    if (p.px < minPx) minPx = p.px;
    if (p.px > maxPx) maxPx = p.px;
    if (p.py < minPy) minPy = p.py;
    if (p.py > maxPy) maxPy = p.py;
  }

  if (pxPoly.length < 3) return;

  // Clamp bounding box to texture
  minPx = Math.max(0, minPx);
  maxPx = Math.min(size - 1, maxPx);
  minPy = Math.max(0, minPy);
  maxPy = Math.min(size - 1, maxPy);

  // Scanline fill
  for (let py = minPy; py <= maxPy; py++) {
    for (let px = minPx; px <= maxPx; px++) {
      if (pointInPolygon(px, py, pxPoly)) {
        const idx = (py * size + px) * 4;
        paintFn(idx);
      }
    }
  }
}

/**
 * Rasterise a road (polyline with width) into the B channel.
 *
 * For each segment between consecutive points, compute a bounding box
 * padded by half the road width, then test each pixel's distance to
 * the segment. Pixels within halfWidth are painted.
 *
 * Points are in scene coordinates [x, z].
 */
function rasteriseRoad(points, width, bbox, size, pixels) {
  const halfW = width / 2;

  // Convert all points to pixel space
  const pxPts = [];
  for (const [sx, sz] of points) {
    const p = sceneToPx(sx, sz, bbox, size);
    if (p) pxPts.push(p);
  }

  if (pxPts.length < 2) return;

  // Compute pixel-space half-width (approximate from scene→pixel scale)
  const rangeX = bbox.maxX - bbox.minX;
  const pxPerUnit = (size - 1) / rangeX;
  const halfWPx = Math.max(1, halfW * pxPerUnit);

  for (let i = 0; i < pxPts.length - 1; i++) {
    const a = pxPts[i];
    const b = pxPts[i + 1];

    // Bounding box of this segment, padded by halfWPx
    const minPx = Math.max(0, Math.floor(Math.min(a.px, b.px) - halfWPx));
    const maxPx = Math.min(size - 1, Math.ceil(Math.max(a.px, b.px) + halfWPx));
    const minPy = Math.max(0, Math.floor(Math.min(a.py, b.py) - halfWPx));
    const maxPy = Math.min(size - 1, Math.ceil(Math.max(a.py, b.py) + halfWPx));

    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const d = distToSegment(px, py, a.px, a.py, b.px, b.py);
        if (d <= halfWPx) {
          const idx = (py * size + px) * 4;
          pixels[idx + 2] = 255; // B = road
        }
      }
    }
  }
}

// ─── Shader injection ───────────────────────────────────────────────────────

/**
 * GLSL fragment inserted after #include <color_fragment>.
 * Reads the surface data texture and blends feature colours onto terrain.
 *
 * Priority (later overwrites earlier): park → road.
 * Buildings are rendered as 3D geometry, not terrain shader.
 */
const SURFACE_FRAG = /* glsl */ `
  // --- Surface features (surface-texture.js) ---
  if (surfaceEnabled > 0.5) {
    // Map terrain mesh UV to surface texture UV within the bounds sub-region
    vec2 suv = (vM25Uv - surfaceBoundsMin) / (surfaceBoundsMax - surfaceBoundsMin);

    if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
      vec4 sf = texture2D(surfaceTex, suv);

      float road   = sf.b;   // road presence
      float park   = sf.a;   // park presence

      // Parks: muted green overlay
      if (park > 0.5) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.35, 0.15), 0.7);
      }

      // Roads: dark asphalt
      if (road > 0.5) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.14, 0.13), 0.8);
      }
    }
  }
`;

/**
 * Inject surface feature colouring into the terrain material's shader.
 *
 * Chains AFTER the existing onBeforeCompile (M25 mask) — never replaces it.
 *
 * @param {THREE.MeshStandardMaterial} material  Terrain topside material
 * @param {THREE.DataTexture}          tex       Surface data texture
 * @param {object}                     bounds    { minU, maxU, minV, maxV }
 *   UV range within the terrain mesh where the surface texture applies.
 *   These are in vM25Uv space (u: west→east, v: south→north).
 */
export function applySurfaceTexture(material, tex, bounds) {
  // Capture the existing callback (M25 mask injection)
  const existingCompile = material.onBeforeCompile;

  // Store references for runtime toggle
  material.userData.surfaceTex = tex;
  material.userData.surfaceEnabled = true;

  material.onBeforeCompile = (shader, renderer) => {
    // ── Run existing M25 mask injection FIRST ──
    if (existingCompile) existingCompile(shader, renderer);

    // ── Inject surface uniforms ──
    shader.uniforms.surfaceTex = { value: tex };
    shader.uniforms.surfaceBoundsMin = {
      value: new THREE.Vector2(bounds.minU, bounds.minV),
    };
    shader.uniforms.surfaceBoundsMax = {
      value: new THREE.Vector2(bounds.maxU, bounds.maxV),
    };
    shader.uniforms.surfaceEnabled = { value: 1.0 };

    // ── Fragment shader: uniform declarations ──
    // The M25 mask has already injected `uniform sampler2D m25Mask;` and
    // `varying vec2 vM25Uv;` into the fragment shader. Append our uniforms
    // after the M25 uniform so all declarations sit together.
    if (shader.fragmentShader.includes('uniform sampler2D m25Mask;')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        'uniform sampler2D m25Mask;',
        `uniform sampler2D m25Mask;
uniform sampler2D surfaceTex;
uniform vec2 surfaceBoundsMin;
uniform vec2 surfaceBoundsMax;
uniform float surfaceEnabled;`
      );
    } else {
      // Fallback: M25 mask not applied — inject everything ourselves.
      // vM25Uv must be declared here; the vertex shader may not have it.
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform sampler2D surfaceTex;
uniform vec2 surfaceBoundsMin;
uniform vec2 surfaceBoundsMax;
uniform float surfaceEnabled;
varying vec2 vM25Uv;
void main() {`
      );

      // Also inject the varying + assignment into the vertex shader
      if (!shader.vertexShader.includes('vM25Uv')) {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          `varying vec2 vM25Uv;
void main() {`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
  vM25Uv = uv;`
        );
      }
    }

    // ── Fragment shader: surface colour blending ──
    // Inject after #include <color_fragment> where diffuseColor is available.
    // Guard with #ifndef to avoid double-injection if the shader is
    // somehow compiled twice.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
#ifndef SURFACE_INJECTED
#define SURFACE_INJECTED
${SURFACE_FRAG}
#endif`
    );

    // Cache shader reference for runtime uniform updates (avoids recompile)
    material.userData._surfaceShader = shader;
  };

  // Force shader recompilation
  material.needsUpdate = true;
}

// ─── Runtime toggle ─────────────────────────────────────────────────────────

/**
 * Enable or disable surface feature rendering without recompiling the shader.
 *
 * Updates the `surfaceEnabled` uniform directly if the shader has already
 * been compiled; otherwise sets the flag in userData for the next compile.
 *
 * @param {THREE.MeshStandardMaterial} material
 * @param {boolean}                    enabled
 */
export function setSurfaceTextureEnabled(material, enabled) {
  material.userData.surfaceEnabled = enabled;

  if (material.userData._surfaceShader) {
    const u = material.userData._surfaceShader.uniforms.surfaceEnabled;
    if (u) u.value = enabled ? 1.0 : 0.0;
  }
}

// ─── Convenience: compute UV bounds from scene bbox ─────────────────────────

/**
 * Convert a scene-space bounding box to the mesh-UV bounds expected by
 * applySurfaceTexture.
 *
 * @param {object} sceneBBox  { minX, maxX, minZ, maxZ }
 * @returns {{ minU, maxU, minV, maxV }}
 */
export function sceneBBoxToUVBounds(sceneBBox) {
  const sw = sceneToMeshUV(sceneBBox.minX, sceneBBox.maxZ); // south-west corner
  const ne = sceneToMeshUV(sceneBBox.maxX, sceneBBox.minZ); // north-east corner

  return {
    minU: sw.u,
    maxU: ne.u,
    minV: sw.v,
    maxV: ne.v,
  };
}
