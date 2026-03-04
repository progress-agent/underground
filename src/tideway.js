// Tideway + Lee Tunnel sewer system visualization module
//
// Thames Tideway Tunnel: 25km, 21 shaft sites, 4 diameter sections
// Lee Tunnel: 6.9km from Abbey Mills to Beckton, with the deepest shaft in London
// Connection spurs: Frogmore (1.1km) and Greenwich (4.6km)

import * as THREE from 'three';

let tidewayRouteData = null;
let tidewayShaftData = null;
let leeTunnelData = null;

// Shaft cylinders stored for terrain snapping
let shaftMeshes = [];

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

function makeTidewayTunnelMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    transparent: true,
    opacity: 0.5,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
}

function makeTidewayGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.15,
  });
}

function makeTidewayShaftMaterial(isMainDrive = false) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    transparent: true,
    opacity: 0.45,
    roughness: 0.5,
    metalness: 0.0,
    transmission: 0.35,
    thickness: 1.5,
    ior: 1.45,
    clearcoat: 0.1,
    emissive: 0x1d4ed8,
    emissiveIntensity: isMainDrive ? 0.10 : 0.07,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

function makeLeeShaftMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x6b4423,
    transparent: true,
    opacity: 0.45,
    roughness: 0.5,
    metalness: 0.0,
    transmission: 0.35,
    thickness: 1.5,
    ior: 1.45,
    clearcoat: 0.1,
    emissive: 0x4a3728,
    emissiveIntensity: 0.07,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

function makeLeeTunnelMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x6b4423,
    transparent: true,
    opacity: 0.5,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
}

function makeLeeGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x8b6914,
    transparent: true,
    opacity: 0.15,
  });
}

function makeSpurMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    transparent: true,
    opacity: 0.4,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
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

function buildTunnelSection(points, llToXZ, VE, radius, segments = 200) {
  if (points.length < 2) return null;

  const curvePoints = points.map(p => {
    const xz = llToXZ(p.lat, p.lon);
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
  // Unit cylinder scaled per-shaft
  const geo = new THREE.CylinderGeometry(1, 1, 1, 16);
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
    tunnel.userData = {
      type: 'tideway-tunnel',
      name: SECTION_DISPLAY_NAMES[sec.name] || `Tideway ${sec.name}`,
      diameter: radius * 2,
    };
    group.add(tunnel);

    const glow = new THREE.Mesh(result.glowGeo, makeTidewayGlowMaterial());
    glow.name = `tideway-glow-${sec.name}`;
    group.add(glow);
  }

  // ---- 2b. Vertical shaft cylinders (Tideway) ----
  const tidewayShaftsGroup = new THREE.Group();
  tidewayShaftsGroup.name = 'tideway-shafts';

  for (const site of data.sites.sites) {
    // Skip system modifications (no deep cylindrical shaft)
    if (site.type === 'system-mod') continue;

    const isMainDrive = site.type === 'main-drive' || site.type === 'reception';
    const mat = makeTidewayShaftMaterial(isMainDrive);
    const mesh = buildShaftCylinder(site, llToXZ, VE, mat);
    mesh.userData.type = 'tideway-shaft';
    tidewayShaftsGroup.add(mesh);
    shaftMeshes.push(mesh);
  }
  group.add(tidewayShaftsGroup);

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
    frogmoreMesh.userData = {
      type: 'tideway-tunnel',
      name: 'Frogmore Connection Spur',
      diameter: 2.8,
    };
    group.add(frogmoreMesh);
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
    greenwichMesh.userData = {
      type: 'tideway-tunnel',
      name: 'Greenwich Connection Spur',
      diameter: 5.0,
    };
    group.add(greenwichMesh);
  }

  // ---- 2d. Lee Tunnel ----
  if (data.lee?.entries?.length) {
    const leeRoutePoints = data.lee.entries; // All entries define the route
    const leeResult = buildTunnelSection(leeRoutePoints, llToXZ, VE, 3.6, 100);
    if (leeResult) {
      const leeTunnel = new THREE.Mesh(leeResult.tubeGeo, makeLeeTunnelMaterial());
      leeTunnel.name = 'lee-tunnel';
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
      group.add(leeGlow);
    }

    // Lee Tunnel shafts (brown-tinted)
    const leeShaftsGroup = new THREE.Group();
    leeShaftsGroup.name = 'lee-shafts';

    for (const entry of data.lee.entries) {
      if (entry.type !== 'shaft') continue;
      const mat = makeLeeShaftMaterial();
      const mesh = buildShaftCylinder(entry, llToXZ, VE, mat);
      mesh.userData.type = 'lee-shaft';
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
  return { lat: site.lat, lon: site.lon, depth: site.depth };
}

// ---------- Terrain Snapping ----------

export function snapTidewayShaftsToTerrain(getTerrainMeshSurfaceY) {
  if (!getTerrainMeshSurfaceY) return;

  for (const mesh of shaftMeshes) {
    const ud = mesh.userData;
    const surfaceY = getTerrainMeshSurfaceY({ x: ud.xz.x, z: ud.xz.z });
    if (surfaceY === null || !Number.isFinite(surfaceY)) continue;

    // Tunnel centreline is at Y = -(depth * VE)
    // Shaft must span from surfaceY (top) down to tunnelY (bottom)
    const tunnelY = -(ud.depth * moduleVE);
    const newHeight = Math.max(1, surfaceY - tunnelY);

    mesh.scale.y = newHeight;
    mesh.position.y = (surfaceY + tunnelY) / 2;
  }
}

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
