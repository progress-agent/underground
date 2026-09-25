// Tideway + Lee Tunnel sewer system visualization module
//
// Thames Tideway Tunnel: 25km, 21 shaft sites, 4 diameter sections
// Lee Tunnel: 6.9km from Abbey Mills to Beckton, with the deepest shaft in London
// Connection spurs: Frogmore (1.1km) and Greenwich (4.6km)

import * as THREE from 'three';
import { RENDER_ORDER } from './render-layers.js';
import { createTunnelMaterial, createGlowMaterial, injectInfraHaze } from './infra-materials.js';
import { getTerrainMeshSurfaceY } from './terrain.js';
import { isInThames } from './thames-mask.js';
import { WATER_TOP_Y } from './thames.js';
import { FORESHORE_SITE_IDS, WHIRLPOOL, findNearest, buildWhirlpoolGeometry, createWhirlpoolMaterial } from './tideway-whirlpool.js';

// Infra haze band (see infra-materials.js). Wider than Crossrail's — Tideway
// and Lee are shorter features that never formed a horizon band; the haze is
// applied for distance-treatment coherence with Crossrail, not as a band kill.
const HAZE_BAND = { near: 2500, far: 9000 };

let tidewayRouteData = null;
let tidewayShaftData = null;
let leeTunnelData = null;

// Shaft cylinders stored for terrain snapping
let shaftMeshes = [];
// Whirlpools on the river bed where a foreshore shaft meets it (25Sep26f).
let whirlpoolGroup = null;
let whirlpoolMaterial = null;
let whirlpoolTime = 0;
// Every tunnel tube and the route points it was built from, so a tunnel can be
// rebuilt through its shafts' snapped positions (25Sep26f fix round 1): a shaft
// moved into open water or off the bank takes its tunnel vertex with it, so the
// shaft still meets the tunnel it serves.
let tunnelBuilds = [];
let moduleLlToXZ = null;
let appliedTunnelKey = '';

let moduleVE = 5;

// ---------- Section diameters (from 2014 Order) ----------
const SECTION_RADIUS = {
  west: 3.25,    // 6.5m ID
  central: 3.6,  // 7.2m ID
  east: 3.6,     // 7.2m ID
};

// Section boundary site IDs (where TBMs were launched/received)
const SECTION_BOUNDARIES = ['ttw-carnwath', 'ttw-kirtling', 'ttw-chambers'];

// Human-readable section names for tooltips
const SECTION_DISPLAY_NAMES = {
  west: 'Western Section (Acton – Carnwath Road)',
  wc: 'West-Central (Carnwath Road – Kirtling Street)',
  ec: 'East-Central (Kirtling Street – Chambers Wharf)',
  east: 'Eastern Section (Chambers Wharf – Abbey Mills)',
  full: 'Thames Tideway Tunnel',
};

// ---------- Materials ----------
// All from the shared angle-stable factory (infra-materials.js): FrontSide +
// depthWrite:true means exactly one wall layer composites at every view angle
// (the old DoubleSide materials read opaque axially, ghost-faint broadside).
// Emissive lift gives a contrast floor over the bright chalk floor, where the
// old 0.5-alpha navy washed out at every underground distance.

function makeTidewayTunnelMaterial() {
  return injectInfraHaze(
    createTunnelMaterial({ color: 0x1d4ed8, opacity: 0.6 }), HAZE_BAND);
}

function makeTidewayGlowMaterial() {
  return injectInfraHaze(
    createGlowMaterial({ color: 0x3b82f6, opacity: 0.15 }), HAZE_BAND);
}

// Shafts: NO transmission — MeshPhysicalMaterial transmission is fresnel
// view-angle dependent (opaque navy at 200m, washed-out at range in the old
// look) and its transmission pass samples only the opaque scene. A fixed
// opacity + mild emissive is angle- and distance-stable.
function makeTidewayShaftMaterial(isMainDrive = false) {
  return createTunnelMaterial({
    color: 0x1d4ed8,
    opacity: 0.5,
    emissiveIntensity: isMainDrive ? 0.10 : 0.07,
    roughness: 0.5,
    metalness: 0.0,
  });
}

function makeLeeShaftMaterial() {
  return createTunnelMaterial({
    color: 0x6b4423,
    opacity: 0.5,
    emissive: 0x4a3728,
    emissiveIntensity: 0.07,
    roughness: 0.5,
    metalness: 0.0,
  });
}

function makeLeeTunnelMaterial() {
  return injectInfraHaze(
    createTunnelMaterial({ color: 0x6b4423, opacity: 0.6 }), HAZE_BAND);
}

function makeLeeGlowMaterial() {
  return injectInfraHaze(
    createGlowMaterial({ color: 0x8b6914, opacity: 0.15 }), HAZE_BAND);
}

function makeSpurMaterial() {
  return injectInfraHaze(
    createTunnelMaterial({ color: 0x1d4ed8, opacity: 0.5, roughness: 0.5, metalness: 0.1 }),
    HAZE_BAND);
}

// ---------- CSV Parsers ----------

function parseTidewayRouteCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const points = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 6) {
      points.push({
        id: parts[0].trim(),
        name: parts[1].trim(),
        depth: parseFloat(parts[2]),
        lat: parseFloat(parts[3]),
        lon: parseFloat(parts[4]),
        section: parts[5].trim(),
        notes: parts[6] || '',
      });
    }
  }
  return { points };
}

function parseTidewaySitesCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const sites = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 8) {
      sites.push({
        id: parts[0].trim(),
        name: parts[1].trim(),
        section: parts[2].trim(),
        type: parts[3].trim(),
        diameter: parseFloat(parts[4]),
        depth: parseFloat(parts[5]),
        lat: parseFloat(parts[6]),
        lon: parseFloat(parts[7]),
        notes: parts[8] || '',
      });
    }
  }
  return { sites };
}

function parseLeeTunnelCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const entries = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length >= 8) {
      entries.push({
        id: parts[0].trim(),
        name: parts[1].trim(),
        type: parts[2].trim(),
        diameter: parseFloat(parts[3]),
        depth: parseFloat(parts[4]),
        lat: parseFloat(parts[5]),
        lon: parseFloat(parts[6]),
        notes: parts[7] || '',
      });
    }
  }
  return { entries };
}

// ---------- Data Loading ----------

export async function loadTidewayData() {
  try {
    const [routeResp, sitesResp, leeResp] = await Promise.all([
      fetch('/data/tideway_depths.csv'),
      fetch('/data/tideway_sites.csv'),
      fetch('/data/lee_tunnel.csv'),
    ]);

    if (!routeResp.ok) throw new Error('Tideway route data not found');
    if (!sitesResp.ok) throw new Error('Tideway sites data not found');
    if (!leeResp.ok) throw new Error('Lee Tunnel data not found');

    const [routeCSV, sitesCSV, leeCSV] = await Promise.all([
      routeResp.text(), sitesResp.text(), leeResp.text(),
    ]);

    tidewayRouteData = parseTidewayRouteCSV(routeCSV);
    tidewayShaftData = parseTidewaySitesCSV(sitesCSV);
    leeTunnelData = parseLeeTunnelCSV(leeCSV);

    console.log(`Loaded Tideway: ${tidewayRouteData.points.length} route pts, ${tidewayShaftData.sites.length} shaft sites, ${leeTunnelData.entries.length} Lee Tunnel entries`);
    return { route: tidewayRouteData, sites: tidewayShaftData, lee: leeTunnelData };
  } catch (e) {
    console.warn('Could not load Tideway/Lee data:', e.message);
    return null;
  }
}

// ---------- Tunnel Section Builder ----------

function buildTunnelSection(points, llToXZ, VE, radius, segments = 200, placeOf = null) {
  if (points.length < 2) return null;

  const curvePoints = points.map(p => {
    const xz = placeOf?.(p) ?? llToXZ(p.lat, p.lon);
    return new THREE.Vector3(xz.x, -(p.depth * VE), xz.z);
  });

  const curve = new THREE.CatmullRomCurve3(curvePoints);
  curve.curveType = 'catmullrom';
  curve.tension = 0.5;

  const segsPerPoint = Math.max(20, Math.round(segments / Math.max(1, points.length - 1)));
  const totalSegs = segsPerPoint * (points.length - 1);

  const tubeGeo = new THREE.TubeGeometry(curve, totalSegs, radius, 12, false);
  const glowGeo = new THREE.TubeGeometry(curve, Math.round(totalSegs * 0.6), radius + 0.5, 12, false);

  return { tubeGeo, glowGeo, curve };
}

// ---------- Shaft Cylinder Builder ----------

function buildShaftCylinder(site, llToXZ, VE, material) {
  // Unit cylinder scaled per-shaft. Open-ended (25Sep26f, D-039): a shaft has
  // no cap, so nothing is drawn at or above the ground or river bed; a
  // foreshore shaft's mouth is the whirlpool on the bed.
  const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
  const mesh = new THREE.Mesh(geo, material);

  const r = site.diameter / 2;
  const h = site.depth * VE;
  mesh.scale.set(r, h, r);

  const xz = llToXZ(site.lat, site.lon);
  // Position: centre of cylinder hangs from surface
  // Default: top at Y=0, bottom at Y=-h. Will be snapped to terrain later.
  mesh.position.set(xz.x, -h / 2, xz.z);

  mesh.userData = {
    shaftId: site.id,
    name: site.name,
    depth: site.depth,
    diameter: site.diameter,
    xz: { x: xz.x, z: xz.z },
    sourceXZ: { x: xz.x, z: xz.z },
    foreshore: FORESHORE_SITE_IDS.has(site.id),
    halfHeight: h / 2,
  };

  mesh.name = `shaft-${site.id}`;
  return mesh;
}

// ---------- Main System Creator ----------

export function createTidewaySystem(data, llToXZ, verticalScale = 3.0) {
  if (!data || !data.route?.points?.length) return null;

  const VE = verticalScale;
  moduleVE = verticalScale;
  moduleLlToXZ = llToXZ;
  tunnelBuilds = [];
  appliedTunnelKey = '';
  const group = new THREE.Group();
  group.name = 'tideway-system';
  shaftMeshes = [];

  const routePoints = data.route.points;

  // ---- 2a. Split route into 4 tunnel sections at main drive shaft positions ----
  const sections = splitRouteIntoSections(routePoints);

  for (const sec of sections) {
    const radius = SECTION_RADIUS[sec.section] || 3.6;
    const result = buildTunnelSection(sec.points, llToXZ, VE, radius);
    if (!result) continue;

    const tunnel = new THREE.Mesh(result.tubeGeo, makeTidewayTunnelMaterial());
    tunnel.name = `tideway-tunnel-${sec.name}`;
    tunnel.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    tunnel.userData = {
      type: 'tideway-tunnel',
      name: SECTION_DISPLAY_NAMES[sec.name] || `Tideway ${sec.name}`,
      diameter: radius * 2,
    };
    group.add(tunnel);

    const glow = new THREE.Mesh(result.glowGeo, makeTidewayGlowMaterial());
    glow.name = `tideway-glow-${sec.name}`;
    glow.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    group.add(glow);
    tunnelBuilds.push({ tube: tunnel, glow, points: sec.points.map(p => ({ ...p, key: `ttw:${p.id.replace(/^ttw-/, '')}` })),
      radius, segments: 200 });
  }

  // ---- 2b. Vertical shaft cylinders (Tideway) ----
  const tidewayShaftsGroup = new THREE.Group();
  tidewayShaftsGroup.name = 'tideway-shafts';
  tidewayShaftsGroup.renderOrder = RENDER_ORDER.SHAFT;

  for (const site of data.sites.sites) {
    // Skip system modifications (no deep cylindrical shaft)
    if (site.type === 'system-mod') continue;

    const isMainDrive = site.type === 'main-drive' || site.type === 'reception';
    const mat = makeTidewayShaftMaterial(isMainDrive);
    const mesh = buildShaftCylinder(site, llToXZ, VE, mat);
    mesh.userData.type = 'tideway-shaft';
    mesh.userData.routeKey = `ttw:${site.id}`;
    mesh.renderOrder = RENDER_ORDER.SHAFT;
    tidewayShaftsGroup.add(mesh);
    shaftMeshes.push(mesh);
  }
  group.add(tidewayShaftsGroup);

  whirlpoolGroup = new THREE.Group();
  whirlpoolGroup.name = 'tideway-whirlpools';
  whirlpoolMaterial?.dispose();
  whirlpoolMaterial = createWhirlpoolMaterial();
  group.add(whirlpoolGroup);

  // ---- 2c. Connection tunnel spurs ----

  // Frogmore spur: Carnwath → Dormay → KGP
  const frogmorePts = [
    findSite(data.sites.sites, 'carnwath') || { lat: 51.4717, lon: -0.1870, depth: 42 },
    findSite(data.sites.sites, 'dormay') || { lat: 51.4575, lon: -0.1890, depth: 24 },
    findSite(data.sites.sites, 'kgp') || { lat: 51.4540, lon: -0.1935, depth: 21 },
  ];
  const frogmore = buildTunnelSection(frogmorePts, llToXZ, VE, 1.4, 60);
  if (frogmore) {
    const frogmoreMesh = new THREE.Mesh(frogmore.tubeGeo, makeSpurMaterial());
    frogmoreMesh.name = 'tideway-spur-frogmore';
    frogmoreMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    frogmoreMesh.userData = {
      type: 'tideway-tunnel',
      name: 'Frogmore Connection Spur',
      diameter: 2.8,
    };
    group.add(frogmoreMesh);
    tunnelBuilds.push({ tube: frogmoreMesh, glow: null, points: frogmorePts, radius: 1.4, segments: 60 });
  }

  // Greenwich spur: Chambers → Earl → Deptford → Greenwich
  const greenwichPts = [
    findSite(data.sites.sites, 'chambers') || { lat: 51.5010, lon: -0.0745, depth: 58 },
    findSite(data.sites.sites, 'earl') || { lat: 51.4830, lon: -0.0375, depth: 51 },
    findSite(data.sites.sites, 'deptford') || { lat: 51.4800, lon: -0.0280, depth: 48 },
    findSite(data.sites.sites, 'greenwich') || { lat: 51.4835, lon: -0.0100, depth: 46 },
  ];
  const greenwich = buildTunnelSection(greenwichPts, llToXZ, VE, 2.5, 80);
  if (greenwich) {
    const greenwichMesh = new THREE.Mesh(greenwich.tubeGeo, makeSpurMaterial());
    greenwichMesh.name = 'tideway-spur-greenwich';
    greenwichMesh.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
    greenwichMesh.userData = {
      type: 'tideway-tunnel',
      name: 'Greenwich Connection Spur',
      diameter: 5.0,
    };
    group.add(greenwichMesh);
    tunnelBuilds.push({ tube: greenwichMesh, glow: null, points: greenwichPts, radius: 2.5, segments: 80 });
  }

  // ---- 2d. Lee Tunnel ----
  if (data.lee?.entries?.length) {
    const leeRoutePoints = data.lee.entries; // All entries define the route
    const leeResult = buildTunnelSection(leeRoutePoints, llToXZ, VE, 3.6, 100);
    if (leeResult) {
      const leeTunnel = new THREE.Mesh(leeResult.tubeGeo, makeLeeTunnelMaterial());
      leeTunnel.name = 'lee-tunnel';
      leeTunnel.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
      leeTunnel.userData = {
        type: 'lee-tunnel',
        name: 'Lee Tunnel',
        diameter: 7.2,
        length: 6.9,
        depthRange: '68–98m',
      };
      group.add(leeTunnel);

      const leeGlow = new THREE.Mesh(leeResult.glowGeo, makeLeeGlowMaterial());
      leeGlow.name = 'lee-glow';
      leeGlow.renderOrder = RENDER_ORDER.INFRA_TUNNEL;
      group.add(leeGlow);
      tunnelBuilds.push({ tube: leeTunnel, glow: leeGlow, points: leeRoutePoints.map(p => ({ ...p, key: `lee:${p.id}` })),
        radius: 3.6, segments: 100 });
    }

    // Lee Tunnel shafts (brown-tinted)
    const leeShaftsGroup = new THREE.Group();
    leeShaftsGroup.name = 'lee-shafts';
    leeShaftsGroup.renderOrder = RENDER_ORDER.SHAFT;

    for (const entry of data.lee.entries) {
      if (entry.type !== 'shaft') continue;
      const mat = makeLeeShaftMaterial();
      const mesh = buildShaftCylinder(entry, llToXZ, VE, mat);
      mesh.userData.type = 'lee-shaft';
      mesh.userData.routeKey = `lee:${entry.id}`;
      mesh.renderOrder = RENDER_ORDER.SHAFT;
      leeShaftsGroup.add(mesh);
      shaftMeshes.push(mesh);
    }
    group.add(leeShaftsGroup);
  }

  console.log(`Tideway system: ${shaftMeshes.length} shafts, ${sections.length} tunnel sections, 2 spurs, Lee Tunnel`);
  return group;
}

// ---------- Route Splitting ----------
// Split the main bore route into sections at the 3 drive shaft boundaries

function splitRouteIntoSections(routePoints) {
  // Find indices of section boundary points
  const carnwathIdx = routePoints.findIndex(p => p.id === 'ttw-carnwath');
  const kirtlingIdx = routePoints.findIndex(p => p.id === 'ttw-kirtling');
  const chambersIdx = routePoints.findIndex(p => p.id === 'ttw-chambers');

  if (carnwathIdx < 0 || kirtlingIdx < 0 || chambersIdx < 0) {
    // Fallback: single section if boundaries not found
    console.warn('Tideway section boundaries not found — rendering as single tube');
    return [{ name: 'full', section: 'central', points: routePoints }];
  }

  // Each section INCLUDES both endpoints (shared vertex for continuity)
  return [
    { name: 'west', section: 'west', points: routePoints.slice(0, carnwathIdx + 1) },
    { name: 'wc', section: 'central', points: routePoints.slice(carnwathIdx, kirtlingIdx + 1) },
    { name: 'ec', section: 'central', points: routePoints.slice(kirtlingIdx, chambersIdx + 1) },
    { name: 'east', section: 'east', points: routePoints.slice(chambersIdx) },
  ];
}

// ---------- Helpers ----------

function findSite(sites, id) {
  const site = sites.find(s => s.id === id);
  if (!site) return null;
  return { lat: site.lat, lon: site.lon, depth: site.depth, key: `ttw:${site.id}` };
}

// ---------- Terrain Snapping ----------
//
// Sprint 25Sep26f (D-039, Lane W). Idempotent: every call starts again from
// each site's source position, so the several snap calls in main.js agree.
//  - Foreshore sites (built in the river) and any site whose point lies in the
//    modelled river: the shaft stands at the nearest point with open water all
//    round a whirlpool disc, its top at the rendered bed under the funnel; a
//    whirlpool marks where it meets the bed. Nothing stands above the bed.
//  - Land sites: an underground-only shaft whose open top sits a metre below
//    the ground. A land site whose mapped point falls in the modelled water is
//    moved to the nearest dry ground instead of standing in the river.
// The physical floor (getTerrainMeshSurfaceY, which includes the refined river
// bed) is used, not the pre-refinement structural grid: that grid returns the
// 2.15 m OD shelf in the channel, which is what stood the old cylinders up to
// just under the water top.

const LAND_TOP_BELOW_M = 1.0;       // open land shaft top, metres below ground
const WET_DEPTH_Y = 3;              // bed at least this far (canonical) below the water top
const MAX_SITE_MOVE_M = 150;       // land sites mapped into the water
const MAX_FORESHORE_MOVE_M = 300;  // foreshore sites mapped to a riverside centroid

function floorAt(x, z, fallback) {
  const y = getTerrainMeshSurfaceY({ x, z });
  if (Number.isFinite(y)) return y;
  const f = fallback?.({ x, z });
  return Number.isFinite(f) ? f : null;
}
function isWetAt(x, z, fallback) {
  const f = floorAt(x, z, fallback);
  return f !== null && f < WATER_TOP_Y - WET_DEPTH_Y && isInThames(x, z);
}
function whirlpoolRadii(ud) {
  const inner = ud.diameter / 2;
  return { inner, outer: Math.max(WHIRLPOOL.minOuterM, inner * WHIRLPOOL.outerFactor) };
}
// A land shaft's whole footprint, not just its centre: the wall at radius r
// (plus a little) and a ring half way in, 32 samples each, and the centre.
const FOOTPRINT_SAMPLES = 32;
function footprintPoints(x, z, r) {
  const pts = [{ x, z }];
  for (const rr of [r + 0.5, r * 0.5]) for (let k = 0; k < FOOTPRINT_SAMPLES; k++) {
    const a = (k / FOOTPRINT_SAMPLES) * Math.PI * 2;
    pts.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr });
  }
  return pts;
}
// Any part of the footprint in the river: the corridor, or clearly bed.
function footprintTouchesWater(x, z, r, fallback) {
  for (const p of footprintPoints(x, z, r)) {
    const f = floorAt(p.x, p.z, fallback);
    if (isInThames(p.x, p.z) || (f !== null && f < WATER_TOP_Y - WET_DEPTH_Y)) return true;
  }
  return false;
}
function footprintDry(x, z, r, fallback) {
  for (const p of footprintPoints(x, z, r)) {
    const f = floorAt(p.x, p.z, fallback);
    // Low banks sit a little under the water top (Greenwich is 2.2 m OD), so
    // dry means out of the corridor and not down at bed level, as isWetAt.
    if (f === null || f < WATER_TOP_Y - WET_DEPTH_Y || isInThames(p.x, p.z)) return false;
  }
  return true;
}
// Lowest floor (ground, foreshore or bed) anywhere under the footprint.
function footprintLowestFloor(x, z, r, fallback) {
  let low = null;
  for (const p of footprintPoints(x, z, r)) {
    const f = floorAt(p.x, p.z, fallback);
    if (f !== null) low = low === null ? f : Math.min(low, f);
  }
  return low;
}
function ringWet(x, z, outer, fallback) {
  if (!isWetAt(x, z, fallback)) return false;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (!isWetAt(x + Math.cos(a) * (outer + 4), z + Math.sin(a) * (outer + 4), fallback)) return false;
  }
  return true;
}

export function snapTidewayShaftsToTerrain(getStructuralFallback) {
  const ready = Number.isFinite(getTerrainMeshSurfaceY({ x: 0, z: 0 })) || !!getStructuralFallback;
  if (!ready) return;
  for (const w of [...(whirlpoolGroup?.children ?? [])]) { w.geometry.dispose(); w.removeFromParent(); }

  for (const mesh of shaftMeshes) {
    const ud = mesh.userData;
    const src = ud.sourceXZ ?? ud.xz;
    const tunnelY = -(ud.depth * moduleVE);
    const { inner, outer } = whirlpoolRadii(ud);
    let river = false, at = { x: src.x, z: src.z, moved: 0 };
    const wet = ud.foreshore ? findNearest((x, z) => ringWet(x, z, outer, getStructuralFallback), src.x, src.z, MAX_FORESHORE_MOVE_M, 6) : null;
    if (wet) { river = true; at = wet; }
    else if (footprintTouchesWater(src.x, src.z, inner, getStructuralFallback)) {
      // A land site whose shaft wall (not only its centre) reaches into the
      // river: the nearest ground where the whole footprint is dry.
      const dry = findNearest((x, z) => footprintDry(x, z, inner, getStructuralFallback), src.x, src.z, MAX_SITE_MOVE_M, 2);
      if (dry) at = dry;
    }
    const surfaceY = floorAt(at.x, at.z, getStructuralFallback);
    if (surfaceY === null) continue;
    let topY;
    if (river) {
      // The shaft's open top sits just under the lowest bed sample across its
      // mouth, so nothing of it rises into the water; the whirlpool marks it.
      let low = surfaceY;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const f = floorAt(at.x + Math.cos(a) * inner, at.z + Math.sin(a) * inner, getStructuralFallback);
        if (f !== null) low = Math.min(low, f);
      }
      topY = low - (WHIRLPOOL.dipM + WHIRLPOOL.shaftBelowBedM) * moduleVE;
      const geometry = buildWhirlpoolGeometry({ cx: at.x, cz: at.z, innerR: 0.5, outerR: outer, VE: moduleVE,
        floorAt: (x, z) => { const f = floorAt(x, z, getStructuralFallback); return f === null ? null : Math.min(f, WATER_TOP_Y - 1); } });
      const whirl = new THREE.Mesh(geometry, whirlpoolMaterial);
      whirl.name = `whirlpool-${ud.shaftId}`;
      // Before the Thames water (SURFACE_WATER = 1), which composites over it.
      whirl.renderOrder = RENDER_ORDER.SURFACE_WATER - 1;
      // Hovering the whirlpool reads as its shaft.
      whirl.userData = { type: 'tideway-shaft', shaftId: ud.shaftId, name: ud.name, depth: ud.depth, diameter: ud.diameter,
        whirlpool: true, centre: { x: at.x, z: at.z } };
      whirlpoolGroup?.add(whirl);
    } else {
      // Under the lowest floor across the whole footprint, so no part of the
      // open top rises above sloping ground, a bank or a river bed.
      const low = footprintLowestFloor(at.x, at.z, inner, getStructuralFallback) ?? surfaceY;
      topY = Math.min(surfaceY, low) - LAND_TOP_BELOW_M * moduleVE;
    }
    ud.xz = { x: at.x, z: at.z };
    ud.inRiver = river;
    ud.movedM = at.moved;
    ud.topY = topY;
    const height = Math.max(1, topY - tunnelY);
    mesh.position.set(at.x, (topY + tunnelY) / 2, at.z);
    mesh.scale.y = height;
  }
  routeTunnelsThroughShafts();
}

// A shaft moved from its mapped point (into open water for a foreshore site,
// or off the bank for a land site) takes its route vertex with it, so every
// shaft axis still meets its tunnel. The real Tideway runs under the river at
// the foreshore sites, so following the shaft into the channel is the truer
// line. Rebuilt only when a snapped position changes; same segment counts, so
// the draw and triangle cost is unchanged.
function routeTunnelsThroughShafts() {
  if (!moduleLlToXZ || !tunnelBuilds.length) return;
  const placed = new Map();
  for (const m of shaftMeshes) {
    const ud = m.userData;
    if (ud.routeKey && ud.xz) placed.set(ud.routeKey, ud.xz);
  }
  const key = [...placed].map(([k, p]) => `${k}:${p.x.toFixed(2)},${p.z.toFixed(2)}`).join('|');
  if (key === appliedTunnelKey) return;
  appliedTunnelKey = key;
  const placeOf = p => (p.key && placed.get(p.key)) || null;
  for (const b of tunnelBuilds) {
    const r = buildTunnelSection(b.points, moduleLlToXZ, moduleVE, b.radius, b.segments, placeOf);
    if (!r) continue;
    b.tube.geometry.dispose(); b.tube.geometry = r.tubeGeo;
    if (b.glow) { b.glow.geometry.dispose(); b.glow.geometry = r.glowGeo; } else r.glowGeo.dispose();
  }
}

// Beyond this range a whirlpool is sub-pixel (and under dark water): skip its
// draws. Visibility is a pure function of camera position.
export const WHIRLPOOL_DRAW_RANGE = 3000;
/** Advance the whirlpools' animation by simulation time (pause-aware). */
export function updateTidewayWhirlpools(dt, camera = null) {
  if (Number.isFinite(dt) && dt > 0) whirlpoolTime += dt;
  if (whirlpoolMaterial) whirlpoolMaterial.userData.whirlpoolUniforms.uTime.value = whirlpoolTime;
  const c = camera?.position;
  if (c && whirlpoolGroup) for (const w of whirlpoolGroup.children) {
    const k = w.userData.centre;
    w.visible = Math.hypot(k.x - c.x, k.z - c.z, (w.geometry.boundingSphere?.center.y ?? 0) - c.y) < WHIRLPOOL_DRAW_RANGE;
  }
}
export function setTidewayWhirlpoolTime(t) { whirlpoolTime = Math.max(0, +t || 0); updateTidewayWhirlpools(0); }
export function getTidewayWhirlpools() { return whirlpoolGroup; }

// ---------- Legend ----------

export function addTidewayToLegend() {
  const legend = document.getElementById('legend');
  if (!legend) return;

  // Separator
  const separator = document.createElement('div');
  separator.style.cssText = 'height: 1px; background: var(--border); margin: 8px 0;';
  legend.appendChild(separator);

  // Section header
  const header = document.createElement('div');
  header.className = 'legend-item';
  header.innerHTML = `<span class="legend-label" style="color: var(--fg-muted); font-size: 10px; text-transform: uppercase;">Infrastructure</span>`;
  legend.appendChild(header);

  // Tideway + Lee Tunnel combined
  const item = document.createElement('div');
  item.className = 'legend-item';
  item.innerHTML = `
    <div class="legend-line" style="background: linear-gradient(to right, #1d4ed8, #3b82f6, #6b4423);"></div>
    <span class="legend-label">Tideway + Lee Tunnel (21–98m)</span>
  `;
  legend.appendChild(item);
}
