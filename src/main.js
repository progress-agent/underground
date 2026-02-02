import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchTubeLines, fetchRouteSequence } from './tfl.js';
import { loadStationDepthAnchors, depthForStation, debugDepthStats } from './depth.js';
import { tryCreateTerrainMesh } from './terrain.js';
import { createStationMarkers } from './stations.js';

// ---------- Scene ----------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0b1020, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1020, 2500, 15000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 50000);
camera.position.set(0, 900, 2200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 10;
controls.maxDistance = 25000;

// ---------- Simulation params ----------
const sim = {
  trains: [],
  timeScale: Number(new URLSearchParams(location.search).get('t')) || 8, // 1 = real-time, >1 = sped up
  verticalScale: Number(new URLSearchParams(location.search).get('vz')) || 3.0,
  horizontalScale: Number(new URLSearchParams(location.search).get('hx')) || 1.0,
};

// HUD controls (optional)
{
  const el = document.getElementById('timeScale');
  const out = document.getElementById('timeScaleValue');
  if (el) {
    // initialise from URL param t
    el.value = String(sim.timeScale);
    const apply = () => {
      const v = Number(el.value) || 1;
      const url = new URL(location.href);
      url.searchParams.set('t', String(v));
      location.href = url.toString();
    };
    el.addEventListener('change', apply);
    if (out) out.textContent = `${sim.timeScale}×`;
  }

  const vEl = document.getElementById('verticalScale');
  const vOut = document.getElementById('verticalScaleValue');
  if (vEl) {
    vEl.value = String(sim.verticalScale);
    const applyV = () => {
      const v = Number(vEl.value) || 1;
      const url = new URL(location.href);
      url.searchParams.set('vz', String(v));
      location.href = url.toString();
    };
    vEl.addEventListener('change', applyV);
    if (vOut) vOut.textContent = `${sim.verticalScale.toFixed(2)}×`;
  }

  const hEl = document.getElementById('horizontalScale');
  const hOut = document.getElementById('horizontalScaleValue');
  if (hEl) {
    hEl.value = String(sim.horizontalScale);
    const applyH = () => {
      const v = Number(hEl.value) || 1;
      const url = new URL(location.href);
      url.searchParams.set('hx', String(v));
      location.href = url.toString();
    };
    hEl.addEventListener('change', applyH);
    if (hOut) hOut.textContent = `${sim.horizontalScale.toFixed(2)}×`;
  }
}

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(40, 120, 30);
scene.add(key);

const rim = new THREE.DirectionalLight(0x9bd6ff, 0.65);
rim.position.set(-60, 80, -40);
scene.add(rim);

// ---------- Ground (terrain if available, else transparent wireframe grid) ----------
{
  const grid = new THREE.GridHelper(24000, 120, 0x6b7280, 0x334155);
  grid.position.y = -6;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  // Attempt to load generated terrain heightmap (EA LiDAR DTM pipeline output)
  tryCreateTerrainMesh().then(result => {
    if (!result) return;
    scene.add(result.mesh);
  });

  // faint "surface" plane to catch light but not obscure the network
  const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x0b1223,
    transparent: true,
    opacity: 0.08,
    shininess: 10,
    specular: 0x1b3b66,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -6.05;
  scene.add(mesh);
}

// ---------- Thames (placeholder ribbon) ----------
{
  const points = [
    new THREE.Vector3(-90, -5.5, 30),
    new THREE.Vector3(-50, -5.5, 15),
    new THREE.Vector3(-10, -5.5, 10),
    new THREE.Vector3(30, -5.5, 0),
    new THREE.Vector3(70, -5.5, -18),
    new THREE.Vector3(110, -5.5, -40),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  // River as a distinct surface ribbon (not a tube)
  const tube = new THREE.TubeGeometry(curve, 200, 1.0, 8, false);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x1d4ed8,
    transparent: true,
    opacity: 0.35,
    roughness: 0.08,
    metalness: 0.02,
    emissive: new THREE.Color(0x0b1e5b),
    emissiveIntensity: 0.25,
  });

  // Flatten the tube into a ribbon-ish mesh by scaling Y heavily.
  const mesh = new THREE.Mesh(tube, mat);
  mesh.scale.y = 0.10;
  mesh.position.y = -2.0;
  scene.add(mesh);
}

// ---------- Tube lines (real TfL route sequences) ----------
// Brand-ish colours (can refine later)
const LINE_COLOURS = {
  bakerloo: 0xb36305,
  central: 0xdc241f,
  circle: 0xffd300,
  district: 0x00782a,
  'hammersmith-city': 0xf3a9bb,
  jubilee: 0x868f98,
  metropolitan: 0x9b0056,
  northern: 0x000000,
  piccadilly: 0x0019a8,
  victoria: 0x0098d4,
  'waterloo-city': 0x93ceba,
};

function frostedTubeMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    transparent: true,
    opacity: 0.42,
    roughness: 0.45,
    metalness: 0.0,
    transmission: 0.82,
    thickness: 0.9,
    ior: 1.28,
    clearcoat: 0.22,
    clearcoatRoughness: 0.6,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 0.10,
  });
}

// Geo projection: lon/lat -> x/z in *metres* (local tangent plane-ish), centred on London.
// This makes scene units ≈ metres, so train speeds and station spacing can feel real.
const ORIGIN = { lat: 51.5074, lon: -0.1278 };
const METRES_PER_DEG_LAT = 111_320;
function metresPerDegLonAt(latDeg) {
  return 111_320 * Math.cos(latDeg * Math.PI / 180);
}
function llToXZ(lat, lon) {
  const dLon = lon - ORIGIN.lon;
  const dLat = lat - ORIGIN.lat;
  const x = dLon * metresPerDegLonAt(ORIGIN.lat) * sim.horizontalScale;
  const z = dLat * METRES_PER_DEG_LAT * sim.horizontalScale;
  return { x, z: -z };
}

function buildOffsetCurvesFromCenterline(centerPts, halfSpacing = 1.0) {
  // Create two offset polylines (left/right) in XZ plane.
  // For each point, estimate tangent and take a perpendicular in XZ.
  const left = [];
  const right = [];

  for (let i = 0; i < centerPts.length; i++) {
    const p = centerPts[i];
    const pPrev = centerPts[Math.max(0, i - 1)];
    const pNext = centerPts[Math.min(centerPts.length - 1, i + 1)];

    const tangent = new THREE.Vector3().subVectors(pNext, pPrev);
    tangent.y = 0;
    tangent.normalize();

    // perpendicular in XZ: (x,z) -> (-z,x)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    left.push(new THREE.Vector3().copy(p).addScaledVector(normal, halfSpacing));
    right.push(new THREE.Vector3().copy(p).addScaledVector(normal, -halfSpacing));
  }

  return {
    leftCurve: new THREE.CatmullRomCurve3(left),
    rightCurve: new THREE.CatmullRomCurve3(right),
  };
}

function stationUsFromPolyline(centerPts) {
  // Convert station polyline vertices into approximate curve parameters u in [0,1]
  // by using cumulative distances along the polyline.
  let total = 0;
  const cum = [0];
  for (let i = 1; i < centerPts.length; i++) {
    total += centerPts[i].distanceTo(centerPts[i - 1]);
    cum.push(total);
  }
  if (total <= 0) return centerPts.map(() => 0);
  return cum.map(d => d / total);
}

function addLineFromStopPoints(lineId, colour, stopPoints, depthAnchors, sim) {
  // stopPoints: [{lat, lon, name, id, naptanId?}]
  const centerPts = stopPoints
    .filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon))
    .map(sp => {
      const { x, z } = llToXZ(sp.lat, sp.lon);
      // Depth: use station anchor if available, else heuristic by line.
      const depthM = depthForStation({ naptanId: sp.id, lineId, anchors: depthAnchors });
      const y = -depthM * sim.verticalScale;
      return new THREE.Vector3(x, y, z);
    });

  if (centerPts.length < 2) return null;

  const stationUs = stationUsFromPolyline(centerPts).sort((a, b) => a - b);

  const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, 1.15);

  const segs = Math.max(80, centerPts.length * 10);
  const radius = 4.5;

  const leftMesh = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
  const rightMesh = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false), frostedTubeMaterial(colour));

  leftMesh.userData.lineId = lineId;
  rightMesh.userData.lineId = lineId;

  scene.add(leftMesh, rightMesh);

  function makeTrain(curve, phase = 0, dir = +1) {
    const train = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(colour), emissiveIntensity: 1.6 })
    );

    // Roughly-Tube-like motion:
    // - line speeds typically ~30–50 km/h; include dwell at stations.
    // - We treat scene units as metres, so these are m/s.
    const cruiseMps = (lineId === 'victoria' ? 14.5 : 12.0); // ~52 km/h vs ~43 km/h
    const dwellSec = 22;

    const curveLengthM = curve.getLength();

    train.userData = {
      t: (Math.random() + phase) % 1,
      curve,
      dir,
      curveLengthM,
      stationUs,
      nextStationIndex: dir === 1 ? 0 : stationUs.length - 1,
      cruiseMps,
      dwellSec,
      // internal state
      _pausedLeft: 0,
    };

    // Place initially
    train.position.copy(curve.getPointAt(train.userData.t));

    scene.add(train);
    sim.trains.push(train);
    return train;
  }

  // One train each way for MVP.
  const trainA = makeTrain(leftCurve, 0.0, +1);
  const trainB = makeTrain(rightCurve, 0.5, -1);

  return { meshes: [leftMesh, rightMesh], trains: [trainA, trainB] };
}

// (trains are kept in sim.trains)

// Victoria station markers/labels
let victoriaStationsLayer = null;
let victoriaStationsVisible = true;
let victoriaLabelsVisible = true;

async function buildNetworkMvp() {
  try {
    const depthAnchors = await loadStationDepthAnchors();

    // Render all TfL tube lines we know about (TfL ids include hyphens for some lines)
    const wanted = [
      'bakerloo','central','circle','district','hammersmith-city',
      'jubilee','metropolitan','northern','piccadilly','victoria','waterloo-city'
    ];

    for (const id of wanted) {
      const colour = LINE_COLOURS[id] ?? 0xffffff;
      const seq = await fetchRouteSequence(id);

      // MVP: pick the longest stopPointSequence as our route spine
      const sequences = seq.stopPointSequences || [];
      const longest = sequences.reduce((best, cur) =>
        (!best || (cur.stopPoint?.length || 0) > (best.stopPoint?.length || 0)) ? cur : best
      , null);

      const sps = longest?.stopPoint || [];
      const ds = debugDepthStats({ lineId: id, stopPoints: sps, anchors: depthAnchors });
      addLineFromStopPoints(id, colour, sps, depthAnchors, sim);
      console.log('built', id, 'stops', sps.length, 'depth[m] min/max', ds.min, ds.max);

      // Victoria line station markers + labels (from TfL route sequence stop points)
      if (id === 'victoria') {
        const stations = sps
          .filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon))
          .map(sp => {
            const { x, z } = llToXZ(sp.lat, sp.lon);
            const depthM = depthForStation({ naptanId: sp.id, lineId: id, anchors: depthAnchors });
            const y = -depthM * sim.verticalScale;
            return {
              id: sp.id,
              name: sp.name,
              pos: new THREE.Vector3(x, y, z),
            };
          });

        victoriaStationsLayer?.dispose?.();
        victoriaStationsLayer = createStationMarkers({
          scene,
          stations,
          colour,
          size: 0.55,
          labels: true,
        });
        victoriaStationsLayer.setLabelsVisible(victoriaLabelsVisible);
        victoriaStationsLayer.mesh.visible = victoriaStationsVisible;
      }
    }

    // frame the camera roughly over the network
    controls.target.set(0, -120, 0);
  } catch (e) {
    console.warn('Network build failed:', e);
  }
}

buildNetworkMvp();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- UI toggles ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'v' || e.key === 'V') {
    victoriaStationsVisible = !victoriaStationsVisible;
    if (victoriaStationsLayer?.mesh) victoriaStationsLayer.mesh.visible = victoriaStationsVisible;
  }
  if (e.key === 'l' || e.key === 'L') {
    victoriaLabelsVisible = !victoriaLabelsVisible;
    victoriaStationsLayer?.setLabelsVisible?.(victoriaLabelsVisible);
  }
});

// ---------- Animate ----------
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  controls.update();

  const simDt = dt * sim.timeScale;
  for (const train of sim.trains) {
    // dwell at stations
    if (train.userData._pausedLeft > 0) {
      train.userData._pausedLeft = Math.max(0, train.userData._pausedLeft - simDt);
      continue;
    }

    const du = (train.userData.cruiseMps * simDt) / Math.max(1e-6, train.userData.curveLengthM);
    let u = train.userData.t + train.userData.dir * du;

    // wrap
    if (u >= 1) u -= 1;
    if (u < 0) u += 1;

    // station arrival detection (very simple): if we crossed the next station u.
    const stations = train.userData.stationUs;
    if (stations.length > 0) {
      const idx = train.userData.nextStationIndex;
      const targetU = stations[idx];

      const prevU = train.userData.t;
      const crossed = train.userData.dir === 1
        ? (prevU <= targetU && u >= targetU) || (prevU > u && (u >= targetU || prevU <= targetU))
        : (prevU >= targetU && u <= targetU) || (prevU < u && (u <= targetU || prevU >= targetU));

      if (crossed) {
        u = targetU;
        train.userData._pausedLeft = train.userData.dwellSec;
        // advance station index
        if (train.userData.dir === 1) {
          train.userData.nextStationIndex = (idx + 1) % stations.length;
        } else {
          train.userData.nextStationIndex = (idx - 1 + stations.length) % stations.length;
        }
      }
    }

    train.userData.t = u;
    train.position.copy(train.userData.curve.getPointAt(u));
  }

  // Victoria station label projection
  victoriaStationsLayer?.update?.({ camera, renderer });

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
