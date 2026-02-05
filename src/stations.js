import * as THREE from 'three';

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
      const el = document.createElement('div');
      el.className = 'station-label';
      // Strip redundant suffix for readability
      el.textContent = st.name.replace(/\s+Underground Station$/i, '');
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
    let behindCount = 0;
    let offscreenCount = 0;
    let hiddenNames = [];

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const el = labelEls[i];

      tmp.copy(st.pos);
      tmp.project(camera);

      // Less aggressive behind-camera check: only hide if well behind (z > 1.5)
      // and reduce opacity for marginal cases instead of hiding completely
      const behind = tmp.z > 1.5;
      const marginal = tmp.z > 1 && tmp.z <= 1.5;

      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;

      // quick reject off-screen
      if (x < -40 || x > w + 40 || y < -20 || y > h + 20) {
        el.style.display = 'none';
        offscreenCount++;
        if (offscreenCount <= 3) hiddenNames.push(st.name + '(offscr)');
        continue;
      }

      // distance-based fade: labels visible from further away, minimum 0.35 opacity
      const d = camera.position.distanceTo(st.pos);
      let alpha = THREE.MathUtils.clamp(1.0 - (d - 150) / 800, 0.35, 1.0);
      
      // Reduce opacity for marginal behind-camera positions
      if (marginal) alpha *= 0.5;

      el.style.display = 'block';
      visibleCount++;
      // Center the pill label on the projected point.
      // (Translate order matters: percentage is based on the element's box.)
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = alpha.toFixed(3);
    }
    
    if (updateCount % 30 === 0) {
      window.mobileDebug?.show(`vis:${visibleCount}/${labelEls.length} cam:${camera.position.z.toFixed(0)}`);
    }
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    for (const el of labelEls) el.remove();
    layer.remove();
  }

  return { mesh, stations, setLabelsVisible, update, dispose };
}
