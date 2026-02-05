import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStationMarkers, updateStationLabels } from './stations.js';
import { depthScale, metersToWorldUnits } from './depth.js';
import { createGeologicalStrata } from './geology.js';

let scene, camera, renderer, controls;
let tubeLines, tidewayTunnel, crossrail, geology;
let stationMarkers = [];

// Configuration
const CONFIG = {
    camera: {
        fov: 45,
        near: 1,
        far: 10000,
        initialPosition: [0, -800, 600]
    },
    depth: {
        exaggeration: 15,  // Vertical exaggeration for depth
        maxDepth: -80      // Maximum depth in meters
    }
};

export function init() {
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('webgl-canvas');

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.Fog(0x0a0a0a, 200, 2000);

    // Camera setup
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(
        CONFIG.camera.fov,
        aspect,
        CONFIG.camera.near,
        CONFIG.camera.far
    );
    camera.position.set(...CONFIG.camera.initialPosition);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Controls
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 2000;
    controls.minDistance = 100;
    controls.target.set(0, 0, 0);

    // Lighting
    setupLighting();

    // Create infrastructure layers
    createTubeLines();
    createTidewayTunnel();
    createCrossrail();
    createGeologyLayer();

    // Create station markers with labels
    stationMarkers = createStationMarkers(scene, CONFIG.depth.exaggeration);

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    setupLayerToggles();

    // Hide loading
    document.getElementById('loading').style.display = 'none';

    // Animation loop
    animate();

    // Update labels initially and on camera movement
    updateLabels();
    controls.addEventListener('change', updateLabels);
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, -100, 200);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x4CAF50, 0.5, 500);
    pointLight.position.set(0, 0, 100);
    scene.add(pointLight);
}

function createTubeLines() {
    tubeLines = new THREE.Group();
    
    // Central line (red) - deeper
    const centralLine = createLineCurve([
        { x: -200, y: -100, z: -45 * CONFIG.depth.exaggeration },
        { x: -100, y: -50, z: -40 * CONFIG.depth.exaggeration },
        { x: 0, y: 0, z: -35 * CONFIG.depth.exaggeration },
        { x: 100, y: 50, z: -38 * CONFIG.depth.exaggeration },
        { x: 200, y: 100, z: -42 * CONFIG.depth.exaggeration }
    ], 0xDC241F, 4);
    tubeLines.add(centralLine);

    // Northern line (black) - deep
    const northernLine = createLineCurve([
        { x: -150, y: 150, z: -50 * CONFIG.depth.exaggeration },
        { x: -80, y: 80, z: -45 * CONFIG.depth.exaggeration },
        { x: 0, y: 0, z: -48 * CONFIG.depth.exaggeration },
        { x: 80, y: -80, z: -52 * CONFIG.depth.exaggeration },
        { x: 150, y: -150, z: -55 * CONFIG.depth.exaggeration }
    ], 0x000000, 4);
    tubeLines.add(northernLine);

    // District line (green) - shallow
    const districtLine = createLineCurve([
        { x: -250, y: 0, z: -8 * CONFIG.depth.exaggeration },
        { x: -150, y: 50, z: -10 * CONFIG.depth.exaggeration },
        { x: 0, y: 0, z: -12 * CONFIG.depth.exaggeration },
        { x: 150, y: -50, z: -10 * CONFIG.depth.exaggeration },
        { x: 250, y: 0, z: -8 * CONFIG.depth.exaggeration }
    ], 0x007229, 3);
    tubeLines.add(districtLine);

    // Circle line (yellow) - very shallow
    const circlePoints = [];
    for (let i = 0; i <= 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        circlePoints.push({
            x: Math.cos(angle) * 180,
            y: Math.sin(angle) * 180,
            z: -5 * CONFIG.depth.exaggeration
        });
    }
    const circleLine = createLineCurve(circlePoints, 0xFFD700, 3);
    tubeLines.add(circleLine);

    scene.add(tubeLines);
}

function createLineCurve(points, color, lineWidth) {
    const curvePoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const tubeGeometry = new THREE.TubeGeometry(curve, 64, lineWidth, 8, false);
    const tubeMaterial = new THREE.MeshPhongMaterial({ 
        color: color,
        emissive: color,
        emissiveIntensity: 0.2,
        shininess: 100
    });
    return new THREE.Mesh(tubeGeometry, tubeMaterial);
}

function createTidewayTunnel() {
    tidewayTunnel = new THREE.Group();

    // Tideway Tunnel (Thames Tideway) - very deep, under the Thames
    const tidewayPath = createLineCurve([
        { x: -300, y: 0, z: -65 * CONFIG.depth.exaggeration },
        { x: -200, y: -30, z: -68 * CONFIG.depth.exaggeration },
        { x: -100, y: -40, z: -70 * CONFIG.depth.exaggeration },
        { x: 0, y: -50, z: -72 * CONFIG.depth.exaggeration },
        { x: 100, y: -40, z: -70 * CONFIG.depth.exaggeration },
        { x: 200, y: -30, z: -68 * CONFIG.depth.exaggeration },
        { x: 300, y: 0, z: -65 * CONFIG.depth.exaggeration }
    ], 0x00BCD4, 6);  // Cyan color

    tidewayTunnel.add(tidewayPath);
    
    // FIX: Set initial visibility based on checkbox state
    const checkbox = document.getElementById('toggle-tideway');
    tidewayTunnel.visible = checkbox ? checkbox.checked : false;
    
    scene.add(tidewayTunnel);
}

function createCrossrail() {
    crossrail = new THREE.Group();

    // Crossrail (Elizabeth Line) - deep east-west
    const crossrailPath = createLineCurve([
        { x: -350, y: 0, z: -35 * CONFIG.depth.exaggeration },
        { x: -200, y: 20, z: -38 * CONFIG.depth.exaggeration },
        { x: -100, y: 10, z: -40 * CONFIG.depth.exaggeration },
        { x: 0, y: 0, z: -42 * CONFIG.depth.exaggeration },
        { x: 100, y: -10, z: -40 * CONFIG.depth.exaggeration },
        { x: 200, y: -20, z: -38 * CONFIG.depth.exaggeration },
        { x: 350, y: 0, z: -35 * CONFIG.depth.exaggeration }
    ], 0x9C27B0, 5);  // Purple color

    crossrail.add(crossrailPath);
    
    // FIX: Set initial visibility based on checkbox state
    const checkbox = document.getElementById('toggle-crossrail');
    crossrail.visible = checkbox ? checkbox.checked : false;
    
    scene.add(crossrail);
}

function createGeologyLayer() {
    geology = createGeologicalStrata(CONFIG.depth.exaggeration);
    
    // FIX: Set initial visibility based on checkbox state
    const checkbox = document.getElementById('toggle-geology');
    geology.visible = checkbox ? checkbox.checked : false;
    
    scene.add(geology);
}

function updateLabels() {
    updateStationLabels(stationMarkers, camera, renderer);
}

function setupLayerToggles() {
    document.getElementById('toggle-tube').addEventListener('change', (e) => {
        if (tubeLines) tubeLines.visible = e.target.checked;
    });

    document.getElementById('toggle-tideway').addEventListener('change', (e) => {
        if (tidewayTunnel) tidewayTunnel.visible = e.target.checked;
    });

    document.getElementById('toggle-crossrail').addEventListener('change', (e) => {
        if (crossrail) crossrail.visible = e.target.checked;
    });

    document.getElementById('toggle-geology').addEventListener('change', (e) => {
        if (geology) geology.visible = e.target.checked;
    });

    document.getElementById('toggle-labels').addEventListener('change', (e) => {
        const labels = document.querySelectorAll('.station-label');
        labels.forEach(label => {
            label.style.display = e.target.checked ? 'block' : 'none';
        });
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateLabels();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
