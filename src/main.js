import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fetchTubeLines, fetchRouteSequence } from './tfl.js';
import { loadStationDepthAnchors, depthForStation } from './depth.js';
import { tryCreateTerrainMesh } from './terrain.js';

// ---------- Scene ----------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0b1020, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1020, 120, 520);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 55, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 10;
controls.maxDistance = 500;

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
  const grid = new THREE.GridHelper(900, 90, 0x6b7280, 0x334155);
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

// crude geo projection: lon/lat -> x/z (metres-ish scaled) centred on London
const ORIGIN = { lat: 51.5074, lon: -0.1278 };
const SCALE = 1200; // tweak for visual size
function llToXZ(lat, lon) {
  const x = (lon - ORIGIN.lon) * Math.cos(ORIGIN.lat * Math.PI / 180);
  const z = (lat - ORIGIN.lat);
  return { x: x * SCALE, z: -z * SCALE };
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

function addLineFromStopPoints(lineId, colour, stopPoints, depthAnchors) {
  // stopPoints: [{lat, lon, name, id, naptanId?}]
  const centerPts = stopPoints
    .filter(sp => Number.isFinite(sp.lat) && Number.isFinite(sp.lon))
    .map(sp => {
      const { x, z } = llToXZ(sp.lat, sp.lon);
      // Depth: use station anchor if available, else heuristic by line.
      const depthM = depthForStation({ naptanId: sp.id, lineId, anchors: depthAnchors });
      // Scale metres into our scene units (SCALE ~ 1200 per deg; just pick a vertical multiplier)
      const y = -depthM * 0.6;
      return new THREE.Vector3(x, y, z);
    });

  if (centerPts.length < 2) return null;

  const { leftCurve, rightCurve } = buildOffsetCurvesFromCenterline(centerPts, 1.15);

  const segs = Math.max(80, centerPts.length * 10);
  const radius = 0.95;

  const leftMesh = new THREE.Mesh(new THREE.TubeGeometry(leftCurve, segs, radius, 10, false), frostedTubeMaterial(colour));
  const rightMesh = new THREE.Mesh(new THREE.TubeGeometry(rightCurve, segs, radius, 10, false), frostedTubeMaterial(colour));

  leftMesh.userData.lineId = lineId;
  rightMesh.userData.lineId = lineId;

  scene.add(leftMesh, rightMesh);

  function makeTrain(curve, phase = 0) {
    const train = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(colour), emissiveIntensity: 1.6 })
    );
    train.userData = { t: (Math.random() + phase) % 1, speed: 0.018 + Math.random() * 0.01, curve };
    scene.add(train);
    return train;
  }

  // One train each way for MVP.
  const trainA = makeTrain(leftCurve, 0.0);
  const trainB = makeTrain(rightCurve, 0.5);

  return { meshes: [leftMesh, rightMesh], trains: [trainA, trainB] };
}

const trains = [];

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
      const built = addLineFromStopPoints(id, colour, sps, depthAnchors);
      if (built) trains.push(...built.trains);
      console.log('built', id, 'stops', sps.length);
    }

    // frame the camera roughly over the network
    controls.target.set(0, -18, 0);
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

// ---------- Animate ----------
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  controls.update();

  for (const train of trains) {
    const u = (train.userData.t + train.userData.speed * dt) % 1;
    train.userData.t = u;
    const pos = train.userData.curve.getPointAt(u);
    train.position.copy(pos);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
