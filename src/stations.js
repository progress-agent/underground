import * as THREE from 'three';

// Track which station names already have a label to avoid duplicates
// when the same station appears on multiple lines (e.g. Farringdon on Circle + Metropolitan + H&C)
const _labelledNames = new Set();

function cleanStationName(name) {
  return name.replace(/\s+(Underground|DLR) Station$/i, '');
}

function ensureOverlayRoot() {
  let root = document.getElementById('station-overlay');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'station-overlay';
  document.body.appendChild(root);
  return root;
}

function createOverlayLayer(root, className) {
  const layer = document.createElement('div');
  layer.className = className;
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  root.appendChild(layer);
  return layer;
}

export function createStationMarkers({
  scene,
  stations,
  colour = 0x0098d4,
  size = 1.0,
  labels = true,
}) {
  // ---- 3D markers (fast): InstancedMesh spheres ----
  const geo = new THREE.SphereGeometry(size, 10, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.0,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.9,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, stations.length);
  mesh.frustumCulled = true;
  mesh.renderOrder = 5;
  mesh.userData.kind = 'station-markers';
  mesh.userData.stations = stations; // Store for raycasting lookup

  const dummy = new THREE.Object3D();
  for (let i = 0; i < stations.length; i++) {
    dummy.position.copy(stations[i].pos);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  // ---- Dual HTML label system ----
  // Surface labels: project at Y=0 (street level), visible above ground
  // Underground labels: project at actual station depth, visible below ground
  const root = ensureOverlayRoot();
  const surfaceLayer = createOverlayLayer(root, 'station-overlay-layer station-layer-surface');
  const undergroundLayer = createOverlayLayer(root, 'station-overlay-layer station-layer-underground');
  const surfaceEls = [];
  const undergroundEls = [];

  if (labels) {
    for (const st of stations) {
      const name = cleanStationName(st.name);
      if (_labelledNames.has(name)) {
        surfaceEls.push(null);
        undergroundEls.push(null);
        continue;
      }
      _labelledNames.add(name);

      // Surface label
      const surfEl = document.createElement('div');
      surfEl.className = 'station-label station-label-surface';
      surfEl.textContent = name;
      surfaceLayer.appendChild(surfEl);
      surfaceEls.push(surfEl);

      // Underground label
      const ugEl = document.createElement('div');
      ugEl.className = 'station-label station-label-underground';
      ugEl.textContent = name;
      undergroundLayer.appendChild(ugEl);
      undergroundEls.push(ugEl);
    }
  }

  let labelsVisible = labels;
  function setLabelsVisible(v) {
    labelsVisible = !!v;
    surfaceLayer.style.display = labelsVisible ? 'block' : 'none';
    undergroundLayer.style.display = labelsVisible ? 'block' : 'none';
  }
  setLabelsVisible(labelsVisible);

  const tmpSurface = new THREE.Vector3();
  const tmpUnderground = new THREE.Vector3();
  let updateCount = 0;

  function update({ camera, renderer }) {
    updateCount++;
    if (!labelsVisible) return;
    if (surfaceEls.length === 0) return;

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const cameraAboveGround = camera.position.y >= 0;

    // Toggle layer visibility based on camera position
    surfaceLayer.style.display = cameraAboveGround ? 'block' : 'none';
    undergroundLayer.style.display = cameraAboveGround ? 'none' : 'block';

    // Only project labels for the active layer
    const activeEls = cameraAboveGround ? surfaceEls : undergroundEls;

    for (let i = 0; i < stations.length; i++) {
      const el = activeEls[i];
      if (!el) continue;

      const st = stations[i];

      if (cameraAboveGround) {
        // Surface: project station XZ at Y=0
        tmpSurface.set(st.pos.x, 0, st.pos.z);
        tmpSurface.project(camera);

        if (tmpSurface.z > 1) { el.style.display = 'none'; continue; }

        const x = (tmpSurface.x * 0.5 + 0.5) * w;
        const y = (1 - (tmpSurface.y * 0.5 + 0.5)) * h;

        if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { el.style.display = 'none'; continue; }

        const d = camera.position.distanceTo(tmpSurface.set(st.pos.x, 0, st.pos.z));
        const alpha = THREE.MathUtils.clamp(1.0 - (d - 500) / 5000, 0.55, 1.0);

        el.style.display = 'block';
        el.style.left = `${x.toFixed(1)}px`;
        el.style.top = `${y.toFixed(1)}px`;
        el.style.transform = 'translate(-50%, -50%)';
        el.style.opacity = alpha.toFixed(3);
      } else {
        // Underground: project at actual station depth
        tmpUnderground.copy(st.pos);
        tmpUnderground.project(camera);

        if (tmpUnderground.z > 1) { el.style.display = 'none'; continue; }

        const x = (tmpUnderground.x * 0.5 + 0.5) * w;
        const y = (1 - (tmpUnderground.y * 0.5 + 0.5)) * h;

        if (x < -40 || x > w + 40 || y < -20 || y > h + 20) { el.style.display = 'none'; continue; }

        const d = camera.position.distanceTo(st.pos);
        const alpha = THREE.MathUtils.clamp(1.0 - (d - 200) / 2000, 0.55, 1.0);

        el.style.display = 'block';
        el.style.left = `${x.toFixed(1)}px`;
        el.style.top = `${y.toFixed(1)}px`;
        el.style.transform = 'translate(-50%, -50%)';
        el.style.opacity = alpha.toFixed(3);
      }
    }
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    for (let i = 0; i < surfaceEls.length; i++) {
      const name = cleanStationName(stations[i].name);
      if (surfaceEls[i]) {
        _labelledNames.delete(name);
        surfaceEls[i].remove();
      }
      if (undergroundEls[i]) undergroundEls[i].remove();
    }
    surfaceLayer.remove();
    undergroundLayer.remove();
  }

  return { mesh, stations, setLabelsVisible, update, dispose };
}
