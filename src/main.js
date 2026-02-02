import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Scene ----------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05070b, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070b, 40, 220);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 55, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 10;
controls.maxDistance = 500;

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(40, 120, 30);
scene.add(key);

const rim = new THREE.DirectionalLight(0x9bd6ff, 0.4);
rim.position.set(-60, 80, -40);
scene.add(rim);

// ---------- Ground / city haze ----------
{
  const geo = new THREE.PlaneGeometry(800, 800, 1, 1);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x070a12,
    shininess: 10,
    specular: 0x0b1a2a,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -6;
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
  const tube = new THREE.TubeGeometry(curve, 200, 2.6, 10, false);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x1d4ed8,
    transparent: true,
    opacity: 0.22,
    roughness: 0.15,
    metalness: 0.0,
    transmission: 0.9,
    thickness: 0.5,
    ior: 1.2,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    emissive: new THREE.Color(0x0b1e5b),
    emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(tube, mat);
  scene.add(mesh);
}

// ---------- Tube lines (placeholder) ----------
const LINE_COLOURS = {
  central: 0xdc241f,
  jubilee: 0x868f98,
  northern: 0x000000,
  piccadilly: 0x0019a8,
  victoria: 0x0098d4,
};

function frostedTubeMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    transparent: true,
    opacity: 0.38,
    roughness: 0.35,
    metalness: 0.0,
    transmission: 0.85,
    thickness: 0.7,
    ior: 1.25,
    clearcoat: 0.25,
    clearcoatRoughness: 0.55,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 0.12,
  });
}

function addDemoLine({ id, colour, points }) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
  const geo = new THREE.TubeGeometry(curve, 220, 1.4, 12, false);
  const mesh = new THREE.Mesh(geo, frostedTubeMaterial(colour));
  mesh.userData.lineId = id;
  scene.add(mesh);

  // a moving "train" point
  const train = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(colour), emissiveIntensity: 1.4 })
  );
  train.userData = { t: Math.random(), speed: 0.02 + Math.random() * 0.02, curve };
  scene.add(train);

  return { mesh, train };
}

const trains = [];
trains.push(
  addDemoLine({
    id: 'central',
    colour: LINE_COLOURS.central,
    points: [
      [-80, -2, 12],
      [-45, -8, 6],
      [-10, -14, 2],
      [22, -18, -10],
      [55, -16, -22],
      [85, -10, -35],
    ],
  }).train
);

trains.push(
  addDemoLine({
    id: 'jubilee',
    colour: LINE_COLOURS.jubilee,
    points: [
      [-65, -10, 30],
      [-35, -18, 18],
      [-6, -22, 10],
      [20, -20, 6],
      [52, -14, 0],
      [86, -12, -8],
    ],
  }).train
);

// ---------- TfL fetch (sanity check only) ----------
async function tflSanity() {
  try {
    const res = await fetch('https://api.tfl.gov.uk/Line/Mode/tube');
    if (!res.ok) throw new Error(`TfL HTTP ${res.status}`);
    const lines = await res.json();
    console.log('TfL tube lines:', lines.map(l => l.id));
  } catch (e) {
    console.warn('TfL fetch failed (ok for now):', e);
  }
}
tflSanity();

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
