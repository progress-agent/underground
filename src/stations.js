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

function createOverlayLayer(root) {
  const layer = document.createElement('div');
  layer.className = 'station-overlay-layer';
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

  // ---- HTML labels (toggleable) ----
  const root = ensureOverlayRoot();
  const layer = createOverlayLayer(root);
  const labelEls = [];

  if (labels) {
    for (const st of stations) {
      const name = cleanStationName(st.name);
      if (_labelledNames.has(name)) {
        labelEls.push(null); // Placeholder to keep index alignment with stations[]
        continue;
      }
      _labelledNames.add(name);
      const el = document.createElement('div');
      el.className = 'station-label';
      el.textContent = name;
      layer.appendChild(el);
      labelEls.push(el);
    }
  }

  let labelsVisible = labels;
  function setLabelsVisible(v) {
    labelsVisible = !!v;
    layer.style.display = labelsVisible ? 'block' : 'none';
  }
  setLabelsVisible(labelsVisible);

  const tmp = new THREE.Vector3();
  let updateCount = 0;
  function update({ camera, renderer }) {
    updateCount++;
    if (!labelsVisible) {
      if (updateCount % 60 === 0) window.mobileDebug?.show('labels: hidden (toggle off)');
      return;
    }
    if (labelEls.length === 0) {
      if (updateCount % 60 === 0) window.mobileDebug?.show('labels: no elements');
      return;
    }

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    let visibleCount = 0;

    for (let i = 0; i < stations.length; i++) {
      const el = labelEls[i];
      if (!el) continue; // Deduplicated — no label for this station

      const st = stations[i];
      tmp.copy(st.pos);
      tmp.project(camera);

      // Check if behind camera (z > 1 in NDC means behind)
      if (tmp.z > 1) {
        el.style.display = 'none';
        continue;
      }

      const x = (tmp.x * 0.5 + 0.5) * w;
      // Proper Y-coordinate flip for CSS (WebGL Y up, CSS Y down)
      const y = (1 - (tmp.y * 0.5 + 0.5)) * h;

      // quick reject off-screen
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) {
        el.style.display = 'none';
        continue;
      }

      // distance-based fade: full opacity up close, fading at bird's-eye distances
      // range tuned for default camera altitude of ~4500m
      const d = camera.position.distanceTo(st.pos);
      const alpha = THREE.MathUtils.clamp(1.0 - (d - 500) / 5000, 0.55, 1.0);

      el.style.display = 'block';
      visibleCount++;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
      el.style.transform = 'translate(-50%, -50%)';
      el.style.opacity = alpha.toFixed(3);
    }
    
    if (updateCount % 60 === 0) {
      window.mobileDebug?.show(`vis:${visibleCount}/${labelEls.length} cam:${camera.position.z.toFixed(0)}`);
    }
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    for (let i = 0; i < labelEls.length; i++) {
      const el = labelEls[i];
      if (el) {
        _labelledNames.delete(cleanStationName(stations[i].name));
        el.remove();
      }
    }
    layer.remove();
  }

  return { mesh, stations, setLabelsVisible, update, dispose };
}
