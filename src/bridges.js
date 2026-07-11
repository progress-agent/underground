import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VERTICAL_EXAGGERATION } from './terrain.js';
import { WATER_LEVEL_M } from './thames.js';
import { RENDER_ORDER, WATER_LIFT } from './render-layers.js';

const BNG_REF_E = 530000;
const BNG_REF_N = 180400;

const COLOURS_BY_SLUG = {
  hammersmith: { steel: 0x315f4d },
  albert: { steel: 0x9fc9be, accent: 0xf0d8b8 },
  chelsea: { steel: 0xc9d1d8 },
  'millennium-foot': { steel: 0xbfc7ce },
  tower: { stone: 0xc9bfa7, steel: 0x4f78a8, accent: 0x2f5f96 },
  qe2: { steel: 0xd7e1e8, accent: 0xb9c7d2 },
  'golden-jubilee-foot': { steel: 0xd7dce0 },
};

const materials = {
  stone: new THREE.MeshStandardMaterial({
    color: 0x9a927f,
    roughness: 0.82,
    metalness: 0.05,
    fog: true,
  }),
  steel: new THREE.MeshStandardMaterial({
    color: 0x58636d,
    roughness: 0.56,
    metalness: 0.28,
    fog: true,
  }),
  rail: new THREE.MeshStandardMaterial({
    color: 0x3f454c,
    roughness: 0.62,
    metalness: 0.34,
    fog: true,
  }),
  accent: new THREE.MeshStandardMaterial({
    color: 0x527aa5,
    roughness: 0.5,
    metalness: 0.32,
    fog: true,
  }),
};

function bngToScene({ e, n }) {
  return {
    x: e - BNG_REF_E,
    z: -(n - BNG_REF_N),
  };
}

function bridgeMaterial(family, bridge) {
  const base = bridge.kind === 'rail' || bridge.kind === 'rail+foot'
    ? materials.rail
    : materials[family];
  const mat = base.clone();
  const override = COLOURS_BY_SLUG[bridge.curatedSlug]?.[family];
  if (override) {
    mat.color.setHex(override);
  } else if (family === 'stone' || family === 'steel') {
    const seed = bridge.chainM % 997;
    const tint = 0.92 + (seed / 997) * 0.12;
    mat.color.multiplyScalar(tint);
  }
  return mat;
}

function axisFrame(bridge, lateralOffset = 0) {
  const a = bngToScene(bridge.axis.a);
  const b = bngToScene(bridge.axis.b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / (length || 1);
  const uz = dz / (length || 1);
  const nx = -uz;
  const nz = ux;

  return {
    a,
    b,
    length,
    ux,
    uz,
    nx,
    nz,
    midpoint: {
      x: (a.x + b.x) / 2 + nx * lateralOffset,
      z: (a.z + b.z) / 2 + nz * lateralOffset,
    },
    rotationY: Math.atan2(-dz, dx),
  };
}

function worldFromLocal(frame, x, z) {
  return {
    x: frame.midpoint.x + x * frame.ux + z * frame.nx,
    z: frame.midpoint.z + x * frame.uz + z * frame.nz,
  };
}

function footingY(getTerrainMeshSurfaceY, frame, x, z, deckBottomY) {
  const world = worldFromLocal(frame, x, z);
  const y = getTerrainMeshSurfaceY?.({ x: world.x, z: world.z });
  if (Number.isFinite(y)) return Math.min(y, deckBottomY - 2);
  return WATER_LEVEL_M * VERTICAL_EXAGGERATION - 3 * VERTICAL_EXAGGERATION;
}

function box(widthX, heightY, depthZ, x, y, z) {
  const g = new THREE.BoxGeometry(widthX, heightY, depthZ);
  g.translate(x, y, z);
  return g;
}

function verticalCylinder(radius, height, x, y, z, radialSegments = 8) {
  const g = new THREE.CylinderGeometry(radius, radius, height, radialSegments, 1);
  g.translate(x, y, z);
  return g;
}

function tubeBetween(a, b, radius, radialSegments = 6) {
  return new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, radius, radialSegments);
}

function addPier(geoms, getTerrainMeshSurfaceY, frame, x, z, widthX, depthZ, deckBottomY) {
  const foot = footingY(getTerrainMeshSurfaceY, frame, x, z, deckBottomY);
  const height = Math.max(3, deckBottomY - foot);
  geoms.push(box(widthX, height, depthZ, x, foot + height / 2, z));
}

function addDeck(geoms, length, width, deckY, thicknessY, isRail = false) {
  const depth = isRail ? Math.max(3.2, width) : width;
  geoms.push(box(length, thicknessY, depth, 0, deckY, 0));

  if (isRail) {
    const railY = deckY + thicknessY * 0.72;
    geoms.push(box(length, thicknessY * 0.55, 0.9, 0, railY, depth / 2 - 0.35));
    geoms.push(box(length, thicknessY * 0.55, 0.9, 0, railY, -depth / 2 + 0.35));
  }
}

function supportPositions(spanM, length, preferredSpacing = 55) {
  const pierCount = Math.max(2, Math.min(7, Math.round(spanM / preferredSpacing) + 1));
  const usable = Math.min(length * 0.78, spanM * 1.08);
  const start = -usable / 2;
  const step = usable / (pierCount - 1);
  return Array.from({ length: pierCount }, (_, i) => start + step * i);
}

function buildArchBridge(ctx) {
  const { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY } = ctx;
  const geoms = [];
  const length = frame.length;
  const width = Math.max(bridge.deckWidthM, bridge.kind.includes('rail') ? 11 : 8);
  addDeck(geoms, length, width, deckY, deckThicknessY, bridge.kind.includes('rail'));

  const supports = supportPositions(bridge.spanM, length, 42);
  for (const x of supports) {
    addPier(geoms, getTerrainMeshSurfaceY, frame, x, 0, 3.4, width + 1.8, deckBottomY);
  }

  const archRadius = bridge.kind.includes('rail') ? 0.65 : 0.5;
  const ribZs = [-width * 0.38, width * 0.38];
  for (let i = 0; i < supports.length - 1; i++) {
    const x0 = supports[i] + 1.4;
    const x1 = supports[i + 1] - 1.4;
    const ySpring = deckBottomY - Math.min(20, 3.8 * VERTICAL_EXAGGERATION);
    const yCrown = deckBottomY - 0.5 * VERTICAL_EXAGGERATION;
    for (const z of ribZs) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(x0, ySpring, z),
        new THREE.Vector3((x0 + x1) / 2, yCrown, z),
        new THREE.Vector3(x1, ySpring, z),
      );
      geoms.push(new THREE.TubeGeometry(curve, 14, archRadius, 6));
    }
  }

  return [{ family: 'stone', geoms }];
}

function buildBeamBridge(ctx, options = {}) {
  const { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY } = ctx;
  const geoms = [];
  const isRail = bridge.kind.includes('rail');
  const length = frame.length;
  const width = Math.max(bridge.deckWidthM, isRail ? 11 : 9);
  const thickness = deckThicknessY * (options.cantilever ? 1.55 : 1.25);

  addDeck(geoms, length, width, deckY, thickness, isRail);
  geoms.push(box(length, thickness * 1.15, 0.75, 0, deckY - thickness * 0.25, width / 2 + 0.45));
  geoms.push(box(length, thickness * 1.15, 0.75, 0, deckY - thickness * 0.25, -width / 2 - 0.45));

  const supports = supportPositions(bridge.spanM, length, 60);
  for (const x of supports.slice(1, -1)) {
    addPier(geoms, getTerrainMeshSurfaceY, frame, x, 0, 4.2, Math.min(width + 3, 18), deckBottomY);
    if (options.cantilever) {
      geoms.push(box(Math.min(28, length * 0.16), thickness * 1.2, width + 1.5, x, deckBottomY - thickness * 0.65, 0));
    }
  }

  return [{ family: 'steel', geoms }];
}

function buildSuspensionBridge(ctx) {
  const { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY } = ctx;
  const solidGeoms = [];
  const cableGeoms = [];
  const length = frame.length;
  const width = Math.max(bridge.deckWidthM, 4);
  addDeck(solidGeoms, length, width, deckY, deckThicknessY, false);

  const towerHeightM = {
    hammersmith: 22,
    albert: 24,
    chelsea: 25,
    'millennium-foot': 10,
    'teddington-foot': 12,
  }[bridge.curatedSlug] ?? 18;
  const towerHeight = towerHeightM * VERTICAL_EXAGGERATION;
  const towerX = Math.min(length * 0.34, bridge.spanM * 0.36);
  const towerXs = [-towerX, towerX];
  const towerZs = width < 6 ? [0] : [-width / 2 - 0.8, width / 2 + 0.8];
  for (const x of towerXs) {
    for (const z of towerZs) {
      addPier(solidGeoms, getTerrainMeshSurfaceY, frame, x, z, 2.8, 2.8, deckBottomY);
      solidGeoms.push(box(2.8, towerHeight, 2.8, x, deckY + towerHeight / 2, z));
    }
    if (towerZs.length > 1) {
      solidGeoms.push(box(3.2, 2.2 * VERTICAL_EXAGGERATION, width + 3.6, x, deckY + towerHeight * 0.82, 0));
    }
  }

  const cableRadius = bridge.curatedSlug === 'millennium-foot' ? 0.24 : 0.38;
  for (const z of towerZs) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-towerX, deckY + towerHeight * 0.86, z),
      new THREE.Vector3(0, deckY + Math.max(5, towerHeightM * 0.22) * VERTICAL_EXAGGERATION, z),
      new THREE.Vector3(towerX, deckY + towerHeight * 0.86, z),
    );
    cableGeoms.push(new THREE.TubeGeometry(curve, 24, cableRadius, 6));
    const hangerCount = Math.max(4, Math.min(10, Math.round(bridge.spanM / 28)));
    for (let i = 1; i < hangerCount; i++) {
      const t = i / hangerCount;
      const p = curve.getPoint(t);
      cableGeoms.push(tubeBetween(p, new THREE.Vector3(p.x, deckY + deckThicknessY * 0.8, z), 0.14, 5));
    }
  }

  return [
    { family: 'steel', geoms: solidGeoms },
    { family: 'accent', geoms: cableGeoms },
  ];
}

function buildCableStayedBridge(ctx) {
  const { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY, deckOffsets } = ctx;
  const solidGeoms = [];
  const cableGeoms = [];
  const length = frame.length;
  const isQe2 = bridge.curatedSlug === 'qe2';
  const width = Math.max(bridge.deckWidthM, 4);
  const pylonHeightM = isQe2 ? 86 : 26;
  const pylonHeight = pylonHeightM * VERTICAL_EXAGGERATION;
  const pylonXs = isQe2
    ? [-Math.min(length * 0.24, bridge.spanM * 0.25), Math.min(length * 0.24, bridge.spanM * 0.25)]
    : [-Math.min(length * 0.22, bridge.spanM * 0.22), Math.min(length * 0.22, bridge.spanM * 0.22)];

  for (const offset of deckOffsets) {
    addDeck(solidGeoms, length, width, deckY, deckThicknessY, false);
    if (offset !== 0) {
      solidGeoms[solidGeoms.length - 1].translate(0, 0, offset);
    }
  }

  for (const x of pylonXs) {
    addPier(solidGeoms, getTerrainMeshSurfaceY, frame, x, 0, isQe2 ? 8 : 3.2, isQe2 ? 7 : 3.2, deckBottomY);
    solidGeoms.push(box(isQe2 ? 8 : 3.2, pylonHeight, isQe2 ? 7 : 3.2, x, deckY + pylonHeight / 2, 0));
    const fanPoints = isQe2 ? 8 : 5;
    for (let i = 1; i <= fanPoints; i++) {
      const reach = (i / fanPoints) * Math.min(length * 0.38, bridge.spanM * 0.42);
      const top = new THREE.Vector3(x, deckY + pylonHeight * (0.45 + 0.45 * i / fanPoints), 0);
      for (const dir of [-1, 1]) {
        const deckX = x + dir * reach;
        if (Math.abs(deckX) > length * 0.48) continue;
        const deckZs = deckOffsets.length > 1 ? deckOffsets : [-width * 0.34, width * 0.34];
        for (const z of deckZs) {
          cableGeoms.push(tubeBetween(top, new THREE.Vector3(deckX, deckY + deckThicknessY, z), isQe2 ? 0.22 : 0.14, 5));
        }
      }
    }
  }

  return [
    { family: 'steel', geoms: solidGeoms },
    { family: 'accent', geoms: cableGeoms },
  ];
}

function buildTowerBridge(ctx) {
  const { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY } = ctx;
  const stoneGeoms = [];
  const steelGeoms = [];
  const length = frame.length;
  const width = Math.max(bridge.deckWidthM, 18);
  const towerX = Math.min(length * 0.28, bridge.spanM * 0.3);
  const towerHeight = 44 * VERTICAL_EXAGGERATION;

  steelGeoms.push(box(length, deckThicknessY * 1.25, width, 0, deckY, 0));
  steelGeoms.push(box(towerX * 1.72, deckThicknessY * 1.5, 1.1, 0, deckY + deckThicknessY, width / 2 + 0.8));
  steelGeoms.push(box(towerX * 1.72, deckThicknessY * 1.5, 1.1, 0, deckY + deckThicknessY, -width / 2 - 0.8));

  for (const x of [-towerX, towerX]) {
    addPier(stoneGeoms, getTerrainMeshSurfaceY, frame, x, 0, 17, width + 8, deckBottomY);
    stoneGeoms.push(box(17, towerHeight, width + 8, x, deckY + towerHeight / 2, 0));
    stoneGeoms.push(box(21, 5 * VERTICAL_EXAGGERATION, width + 11, x, deckY + towerHeight + 2.5 * VERTICAL_EXAGGERATION, 0));
    const cap = new THREE.ConeGeometry(15, 8 * VERTICAL_EXAGGERATION, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(x, deckY + towerHeight + 9 * VERTICAL_EXAGGERATION, 0);
    stoneGeoms.push(cap);
  }

  const walkwayY = deckY + 31 * VERTICAL_EXAGGERATION;
  steelGeoms.push(box(towerX * 2 - 8, 2.6 * VERTICAL_EXAGGERATION, 3, 0, walkwayY, width * 0.33));
  steelGeoms.push(box(towerX * 2 - 8, 2.6 * VERTICAL_EXAGGERATION, 3, 0, walkwayY, -width * 0.33));

  return [
    { family: 'stone', role: 'towers', geoms: stoneGeoms },
    { family: 'steel', role: 'deck', geoms: steelGeoms },
  ];
}

function createBridgeMeshes(bridge, getTerrainMeshSurfaceY) {
  const deckY = (WATER_LEVEL_M + bridge.clearanceM) * VERTICAL_EXAGGERATION + WATER_LIFT;
  const deckThicknessY = 1.2 * VERTICAL_EXAGGERATION;
  const deckBottomY = deckY - deckThicknessY / 2;
  const deckOffsets = bridge.curatedSlug === 'golden-jubilee-foot' ? [-11, 11] : [0];
  const frame = axisFrame(bridge, 0);
  const ctx = { bridge, frame, deckY, deckBottomY, deckThicknessY, getTerrainMeshSurfaceY, deckOffsets };

  let parts;
  if (bridge.archetype === 'arch') parts = buildArchBridge(ctx);
  else if (bridge.archetype === 'suspension') parts = buildSuspensionBridge(ctx);
  else if (bridge.archetype === 'cable-stayed') parts = buildCableStayedBridge(ctx);
  else if (bridge.archetype === 'cantilever') parts = buildBeamBridge(ctx, { cantilever: true });
  else if (bridge.archetype === 'bascule') parts = buildTowerBridge(ctx);
  else parts = buildBeamBridge(ctx);

  const bridgeGroup = new THREE.Group();
  bridgeGroup.name = `bridge:${bridge.curatedSlug}`;
  bridgeGroup.position.set(frame.midpoint.x, 0, frame.midpoint.z);
  bridgeGroup.rotation.y = frame.rotationY;
  bridgeGroup.userData = {
    type: 'bridge',
    name: bridge.name,
    kind: bridge.kind,
    archetype: bridge.archetype,
    curatedSlug: bridge.curatedSlug,
  };

  const meshUserData = {
    type: 'bridge',
    name: bridge.name,
    kind: bridge.kind,
    archetype: bridge.archetype,
  };

  const meshes = [];
  for (const part of parts) {
    const geoms = part.geoms.filter(Boolean);
    if (!geoms.length) continue;
    const merged = mergeGeometries(geoms, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, bridgeMaterial(part.family, bridge));
    const role = part.role ?? (part.family === 'accent' ? 'cables' : 'deck');
    mesh.name = `bridge:${bridge.curatedSlug}:${role}`;
    mesh.userData = { ...meshUserData };
    mesh.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;
    bridgeGroup.add(mesh);
    meshes.push(mesh);
  }

  return {
    bridgeGroup,
    meshes,
    deckMesh: meshes.find(m => m.name.endsWith(':deck')) ?? meshes[0] ?? null,
    deckY,
    waterSurfaceY: WATER_LEVEL_M * VERTICAL_EXAGGERATION + WATER_LIFT,
    midpoint: frame.midpoint,
  };
}

export async function createBridges({ getTerrainMeshSurfaceY } = {}) {
  const res = await fetch('/data/bridges.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch bridges.json: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.bridges)) return null;

  const group = new THREE.Group();
  group.name = 'bridges';
  group.renderOrder = RENDER_ORDER.SURFACE_BRIDGE;

  const registry = new Map();
  for (const bridge of data.bridges) {
    const built = createBridgeMeshes(bridge, getTerrainMeshSurfaceY);
    group.add(built.bridgeGroup);
    registry.set(bridge.curatedSlug, {
      data: bridge,
      group: built.bridgeGroup,
      deckMesh: built.deckMesh,
      deckY: built.deckY,
      waterSurfaceY: built.waterSurfaceY,
      midpoint: built.midpoint,
    });
  }

  group.userData = {
    type: 'bridge-layer',
    count: registry.size,
    registry,
    waterSurfaceY: WATER_LEVEL_M * VERTICAL_EXAGGERATION + WATER_LIFT,
  };

  console.log(`Created ${registry.size} Thames bridges`);
  return group;
}
