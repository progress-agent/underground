import * as THREE from 'three';
import { VERTICAL_EXAGGERATION } from './terrain.js';

// BNG reference — must match terrain.js
const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

// Terrain BNG bounds (from london_full_height.json)
const TERRAIN_BNG = {
  minE: 490000, maxE: 560000,
  minN: 155000, maxN: 205000,
  widthE: 70000,  // 560000 - 490000
  heightN: 50000, // 205000 - 155000
};

/**
 * Fetch M25 route data from public/data/m25.json.
 * Format matches thames.json convention: { name, crs, points: [{ e, n }, ...] }
 */
export async function loadM25Data() {
  try {
    const res = await fetch('/data/m25.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await res.json();
  } catch (err) {
    console.warn('Failed to load M25 data:', err);
    return null;
  }
}

/**
 * Convert BNG easting/northing to scene XZ coordinates.
 * Matches terrain.js / thames.js convention.
 */
function bngToScene(e, n) {
  return {
    x: e - BNG_REF_E,
    z: -(n - BNG_REF_N),
  };
}

/**
 * Convert BNG coordinates to mask UV [0,1].
 * u=0 at west edge (minE), u=1 at east edge (maxE).
 * v=0 at north edge (maxN), v=1 at south edge (minN).
 * This matches the terrain mesh UV convention (v=0 → north, v=1 → south).
 */
function bngToMaskUV(e, n) {
  return {
    u: (e - TERRAIN_BNG.minE) / TERRAIN_BNG.widthE,
    v: 1.0 - (n - TERRAIN_BNG.minN) / TERRAIN_BNG.heightN,
  };
}

/**
 * Render M25 polygon to a canvas mask (white inside, black outside).
 * Used as a discard mask in terrain material shaders.
 *
 * @param {Array<{e:number,n:number}>} points  M25 BNG waypoints (closed ring)
 * @param {number} [size]   Output texture resolution
 * @param {number} [feather] Edge feather in pixels
 * @returns {THREE.CanvasTexture}
 */
export function generateM25Mask(points, size = 2048, feather = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Black background (outside M25 = discard)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Draw M25 polygon in white (inside = keep)
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const { u, v } = bngToMaskUV(points[i].e, points[i].n);
    const px = u * size;
    const py = v * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Feathered edge: draw a slightly smaller polygon with blur
  // to soften the disc boundary
  if (feather > 0) {
    // Stroke the boundary in grey with blur for soft edge
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.filter = `blur(${feather}px)`;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const { u, v } = bngToMaskUV(points[i].e, points[i].n);
      const px = u * size;
      const py = v * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Inject M25 mask discard into a MeshStandardMaterial via onBeforeCompile.
 * Fragments outside the M25 polygon are discarded.
 *
 * @param {THREE.MeshStandardMaterial} material  Material to modify
 * @param {THREE.Texture} maskTexture            M25 mask texture
 */
export function applyM25Mask(material, maskTexture) {
  material.userData.m25Mask = maskTexture;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.m25Mask = { value: maskTexture };

    // Inject custom varying in VERTEX shader to pass raw UV (no texture transforms).
    // vMapUv includes map.repeat (16× for grain, 24× for underside) — unusable for 1:1 mask.
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

    // Inject mask sampling in FRAGMENT shader using the raw UV varying
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform sampler2D m25Mask;
varying vec2 vM25Uv;
void main() {`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  float m25Alpha = texture2D(m25Mask, vM25Uv).r;
  if (m25Alpha < 0.5) discard;`
    );
  };

  // Force recompilation
  material.needsUpdate = true;
}

/**
 * Create the M25 road surface — a dark ribbon snapped to terrain.
 *
 * @param {Array<{e:number,n:number}>} points          M25 BNG waypoints
 * @param {function}                   getSurfaceY     (x,z) → world Y
 * @param {object}                     [options]
 * @returns {THREE.Mesh}
 */
export function createM25Road(points, getSurfaceY, options = {}) {
  const {
    width = 30,        // road width in scene units (metres)
    color = 0x1a1a1a,  // dark asphalt
  } = options;

  // Convert BNG points to scene coordinates
  const scenePts = points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return new THREE.Vector3(x, y !== null ? y + 2 : 0, z);
  });

  // Build road ribbon geometry
  const halfW = width / 2;
  const vertCount = scenePts.length * 2;
  const positions = new Float32Array(vertCount * 3);

  for (let i = 0; i < scenePts.length; i++) {
    const p = scenePts[i];
    const prev = scenePts[Math.max(0, i - 1)];
    const next = scenePts[Math.min(scenePts.length - 1, i + 1)];

    // Tangent direction
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const tLen = Math.sqrt(tx * tx + tz * tz) || 1;

    // Perpendicular in XZ plane
    const nx = -tz / tLen;
    const nz = tx / tLen;

    const base = i * 2 * 3;
    // Left vertex
    positions[base]     = p.x + nx * halfW;
    positions[base + 1] = p.y;
    positions[base + 2] = p.z + nz * halfW;
    // Right vertex
    positions[base + 3] = p.x - nx * halfW;
    positions[base + 4] = p.y;
    positions[base + 5] = p.z - nz * halfW;
  }

  // Index buffer: triangle strip as indexed triangles
  const triCount = (scenePts.length - 1) * 2;
  const indices = new Uint32Array(triCount * 3);
  let idx = 0;
  for (let i = 0; i < scenePts.length - 1; i++) {
    const b = i * 2;
    // Two triangles per segment
    indices[idx++] = b;     indices[idx++] = b + 2; indices[idx++] = b + 1;
    indices[idx++] = b + 1; indices[idx++] = b + 2; indices[idx++] = b + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'm25Road';
  mesh.renderOrder = 0;

  console.log(`M25 road: ${scenePts.length} points, ${triCount} triangles, ${width}m wide`);
  return mesh;
}

/**
 * Create the cliff pillar — vertical walls descending from the M25 ring
 * down into the void, giving the appearance of a clay disc atop a chalk column.
 *
 * Vertex colours graduate through geological strata:
 *   terrain brown → chalk cream → dark grey
 *
 * @param {Array<{e:number,n:number}>} points       M25 BNG waypoints
 * @param {function}                   getSurfaceY  (x,z) → world Y
 * @param {object}                     [options]
 * @returns {THREE.Mesh}
 */
export function createCliffPillar(points, getSurfaceY, options = {}) {
  const {
    bottomY = -1500,   // bottom of pillar in scene units
  } = options;

  const VE = VERTICAL_EXAGGERATION;

  // Strata colour stops (depth below terrain surface → colour)
  const strataColours = [
    { depth: 0,    color: new THREE.Color(0x7a6044) },   // Terrain brown (surface)
    { depth: 100,  color: new THREE.Color(0x8d7456) },   // London clay
    { depth: 300,  color: new THREE.Color(0xd4c9a8) },   // Chalk cream
    { depth: 800,  color: new THREE.Color(0x9e9485) },   // Greensand grey
    { depth: 1500, color: new THREE.Color(0x4a4a4a) },   // Deep grey
  ];

  function getStrataColor(depthBelow) {
    const d = Math.abs(depthBelow);
    for (let i = strataColours.length - 1; i >= 0; i--) {
      if (d >= strataColours[i].depth) {
        const next = strataColours[Math.min(i + 1, strataColours.length - 1)];
        if (i === strataColours.length - 1) return strataColours[i].color.clone();
        const t = (d - strataColours[i].depth) / (next.depth - strataColours[i].depth);
        return strataColours[i].color.clone().lerp(next.color, t);
      }
    }
    return strataColours[0].color.clone();
  }

  // Convert points to scene coordinates
  const scenePts = points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return { x, z, surfaceY: y !== null ? y : 50 };
  });

  // Each segment has 4 vertices (2 top, 2 bottom) and 2 triangles
  // But we need vertical subdivisions for strata colouring
  const VERT_DIVS = 8; // vertical subdivisions per segment
  const segCount = scenePts.length - 1; // ring is closed, last = first
  const vertsPerSeg = (VERT_DIVS + 1) * 2; // inner + outer at each vertical level
  const totalVerts = segCount * vertsPerSeg;
  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indicesArr = [];

  for (let seg = 0; seg < segCount; seg++) {
    const p0 = scenePts[seg];
    const p1 = scenePts[seg + 1];
    const segBase = seg * vertsPerSeg;

    for (let v = 0; v <= VERT_DIVS; v++) {
      const t = v / VERT_DIVS;
      // Interpolate Y from surface to bottom
      const y0 = p0.surfaceY + t * (bottomY - p0.surfaceY);
      const y1 = p1.surfaceY + t * (bottomY - p1.surfaceY);

      const vi = segBase + v * 2;

      // Start-side vertex
      positions[vi * 3]     = p0.x;
      positions[vi * 3 + 1] = y0;
      positions[vi * 3 + 2] = p0.z;

      // End-side vertex
      positions[(vi + 1) * 3]     = p1.x;
      positions[(vi + 1) * 3 + 1] = y1;
      positions[(vi + 1) * 3 + 2] = p1.z;

      // Strata colour based on depth below surface
      const depth0 = Math.abs(p0.surfaceY - y0);
      const depth1 = Math.abs(p1.surfaceY - y1);
      const col0 = getStrataColor(depth0);
      const col1 = getStrataColor(depth1);

      colors[vi * 3]     = col0.r;
      colors[vi * 3 + 1] = col0.g;
      colors[vi * 3 + 2] = col0.b;

      colors[(vi + 1) * 3]     = col1.r;
      colors[(vi + 1) * 3 + 1] = col1.g;
      colors[(vi + 1) * 3 + 2] = col1.b;
    }

    // Triangles for this segment's vertical quads
    for (let v = 0; v < VERT_DIVS; v++) {
      const topLeft = segBase + v * 2;
      const topRight = topLeft + 1;
      const botLeft = segBase + (v + 1) * 2;
      const botRight = botLeft + 1;

      // Two triangles per quad (facing outward)
      indicesArr.push(topLeft, botLeft, topRight);
      indicesArr.push(topRight, botLeft, botRight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indicesArr), 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'm25Cliff';

  console.log(`M25 cliff pillar: ${segCount} segments × ${VERT_DIVS} vertical divs = ${indicesArr.length / 3} triangles`);
  return mesh;
}

/**
 * Find where a ray from a point in a direction intersects the M25 polygon boundary.
 * Returns { x, z, surfaceY } in scene coordinates, or null.
 */
function findRayM25Intersection(originX, originZ, dirX, dirZ, m25ScenePts) {
  let bestT = Infinity;
  let bestPt = null;

  for (let i = 0; i < m25ScenePts.length - 1; i++) {
    const p0 = m25ScenePts[i];
    const p1 = m25ScenePts[i + 1];

    // Line segment: p0 + s * (p1 - p0), s ∈ [0,1]
    // Ray: origin + t * dir, t > 0
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;

    const denom = dirX * dz - dirZ * dx;
    if (Math.abs(denom) < 1e-10) continue;

    const t = ((p0.x - originX) * dz - (p0.z - originZ) * dx) / denom;
    const s = ((p0.x - originX) * dirZ - (p0.z - originZ) * dirX) / denom;

    if (t > 0 && s >= 0 && s <= 1 && t < bestT) {
      bestT = t;
      bestPt = {
        x: originX + t * dirX,
        z: originZ + t * dirZ,
        surfaceY: p0.surfaceY + s * (p1.surfaceY - p0.surfaceY),
      };
    }
  }

  return bestPt;
}

/**
 * Create Thames waterfall geometry at the disc edge.
 * The Thames flows off the M25 boundary at two points (east and west).
 * Each waterfall is a ribbon that arcs from horizontal to vertical, fading out.
 *
 * @param {Array<{e:number,n:number,w:number,d:number}>} thamesPoints  Thames BNG waypoints
 * @param {Array<{e:number,n:number}>}                   m25Points     M25 BNG waypoints
 * @param {function}                                     getSurfaceY   (x,z) → world Y
 * @returns {THREE.Group}
 */
export function createThamesWaterfalls(thamesPoints, m25Points, getSurfaceY) {
  const group = new THREE.Group();
  group.name = 'thamesWaterfalls';

  if (!thamesPoints?.length || !m25Points?.length) return group;

  // Convert M25 points to scene coordinates with surface Y
  const m25Scene = m25Points.map(p => {
    const { x, z } = bngToScene(p.e, p.n);
    const y = getSurfaceY({ x, z });
    return { x, z, surfaceY: y !== null ? y : 50 };
  });

  // Thames endpoints and flow directions
  const endpoints = [
    { // West end (first point in Thames data)
      pt: thamesPoints[0],
      next: thamesPoints[1],
      dirSign: -1, // flowing westward off the edge
      width: thamesPoints[0].w || 100,
    },
    { // East end (last point in Thames data)
      pt: thamesPoints[thamesPoints.length - 1],
      prev: thamesPoints[thamesPoints.length - 2],
      dirSign: 1,  // flowing eastward off the edge
      width: thamesPoints[thamesPoints.length - 1].w || 300,
    },
  ];

  for (const ep of endpoints) {
    const { x: epX, z: epZ } = bngToScene(ep.pt.e, ep.pt.n);

    // Flow direction from Thames data
    let dirX, dirZ;
    if (ep.next) {
      const { x: nx, z: nz } = bngToScene(ep.next.e, ep.next.n);
      dirX = epX - nx; // reverse: flowing away from next
      dirZ = epZ - nz;
    } else {
      const { x: px, z: pz } = bngToScene(ep.prev.e, ep.prev.n);
      dirX = epX - px; // forward: flowing away from prev
      dirZ = epZ - pz;
    }
    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

    // Find where the flow direction ray hits the M25 boundary
    const intersection = findRayM25Intersection(epX, epZ, dirX, dirZ, m25Scene);
    if (!intersection) continue;

    // Build waterfall arc: horizontal approach → 90° curve → vertical fall
    const surfaceY = intersection.surfaceY;
    const halfW = Math.min(ep.width, 200) / 2;
    const arcRadius = 150;  // radius of the curve from horizontal to vertical
    const fallLength = 500; // vertical fall distance

    // Perpendicular direction for ribbon width
    const perpX = -dirZ;
    const perpZ = dirX;

    // Arc samples: 0° = horizontal approach, 90° = vertical fall
    const ARC_SAMPLES = 12;
    const FALL_SAMPLES = 8;
    const totalSamples = ARC_SAMPLES + FALL_SAMPLES;

    const positions = new Float32Array((totalSamples + 1) * 2 * 3);
    const alphas = new Float32Array((totalSamples + 1) * 2);

    for (let i = 0; i <= totalSamples; i++) {
      let px, py, pz, alpha;

      if (i <= ARC_SAMPLES) {
        // Arc section: 0 → 90 degrees
        const angle = (i / ARC_SAMPLES) * (Math.PI / 2);
        // Arc center is at intersection point, offset upward by arcRadius
        const arcOffsetX = Math.sin(angle) * arcRadius;
        const arcOffsetY = (1 - Math.cos(angle)) * arcRadius;

        px = intersection.x + dirX * arcOffsetX;
        pz = intersection.z + dirZ * arcOffsetX;
        py = surfaceY + 2 - arcOffsetY;
        alpha = 1.0;
      } else {
        // Vertical fall section
        const fallT = (i - ARC_SAMPLES) / FALL_SAMPLES;
        px = intersection.x + dirX * arcRadius;
        pz = intersection.z + dirZ * arcRadius;
        py = surfaceY + 2 - arcRadius - fallT * fallLength;
        alpha = 1.0 - fallT; // fade out
      }

      // Taper width during fall
      const taperT = i / totalSamples;
      const taperW = halfW * (1.0 - taperT * 0.6); // narrow to 40% at bottom

      const vi = i * 2;
      // Left vertex
      positions[vi * 3]     = px + perpX * taperW;
      positions[vi * 3 + 1] = py;
      positions[vi * 3 + 2] = pz + perpZ * taperW;
      alphas[vi] = alpha;
      // Right vertex
      positions[(vi + 1) * 3]     = px - perpX * taperW;
      positions[(vi + 1) * 3 + 1] = py;
      positions[(vi + 1) * 3 + 2] = pz - perpZ * taperW;
      alphas[vi + 1] = alpha;
    }

    // Index buffer
    const triCount = totalSamples * 2;
    const indices = new Uint32Array(triCount * 3);
    let idx = 0;
    for (let i = 0; i < totalSamples; i++) {
      const b = i * 2;
      indices[idx++] = b;     indices[idx++] = b + 2; indices[idx++] = b + 1;
      indices[idx++] = b + 1; indices[idx++] = b + 2; indices[idx++] = b + 3;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    // Custom material with vertex alpha for fade-out
    const material = new THREE.MeshStandardMaterial({
      color: 0x1a3d5c,
      emissive: 0x0a1e3d,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.05,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Inject vertex alpha into the shader
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `attribute float alpha;
varying float vAlpha;
void main() {`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  vAlpha = alpha;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `varying float vAlpha;
void main() {`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `#include <output_fragment>
  gl_FragColor.a *= vAlpha;`
      );
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `thamesWaterfall_${ep.dirSign > 0 ? 'east' : 'west'}`;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  console.log(`Thames waterfalls: ${group.children.length} created`);
  return group;
}
