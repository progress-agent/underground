import * as THREE from 'three';

export async function loadLineShafts(lineId) {
  const id = String(lineId || '').trim().toLowerCase();
  if (!id) return null;
  const res = await fetch(`/data/${encodeURIComponent(id)}/shafts.json`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export function addShaftsToScene({
  scene,
  shaftsData,
  colour = 0x0098d4,
  platformYById = null,
  groundYById = null,
  kind = 'shafts',
} = {}) {
  if (!shaftsData?.shafts?.length) return null;

  const group = new THREE.Group();
  group.userData.kind = kind;

  const cubeSize = 18; // metres in our scene
  const platformGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const groundGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

  // A vertical "shaft" between surface and platform.
  // Unit height; we'll scale Y per-station.
  const shaftRadius = 2.2;
  const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, 1, 10, 1, true);

  const platformMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.65,
    roughness: 0.35,
  });
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.08,
    roughness: 0.6,
    transparent: true,
    opacity: 0.9,
  });

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
  });

  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(colour),
    emissiveIntensity: 0.25,
    roughness: 0.55,
    metalness: 0.0,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });

  // Keep handles so we can adjust ground/platform Y later (e.g., after terrain loads).
  const byId = new Map();

  function buildShaftBetween({ x, z, groundY, platformY }) {
    const h = Math.max(0.01, Math.abs(platformY - groundY));
    const midY = (platformY + groundY) * 0.5;

    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(x, midY, z);
    shaft.scale.y = h; // geometry height is 1

    return shaft;
  }

  for (const s of shaftsData.shafts) {
    const platform = new THREE.Mesh(platformGeo, platformMat);

    const platformY = (platformYById && s.id && Number.isFinite(platformYById[s.id]))
      ? platformYById[s.id]
      : s.platformY;

    const groundY = (groundYById && s.id && Number.isFinite(groundYById[s.id]))
      ? groundYById[s.id]
      : s.groundY;

    platform.position.set(s.x, platformY, s.z);

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(s.x, groundY, s.z);

    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(s.x, groundY, s.z),
      new THREE.Vector3(s.x, platformY, s.z),
    ]);
    const link = new THREE.Line(geom, lineMat);

    const shaft = buildShaftBetween({ x: s.x, z: s.z, groundY, platformY });

    group.add(shaft, link, platform, ground);
    if (s.id) byId.set(s.id, { link, platform, ground, shaft });
  }

  scene.add(group);
  return {
    group,
    shaftsData,
    updateGroundYById(nextGroundYById = {}) {
      for (const [id, parts] of byId.entries()) {
        const y = nextGroundYById[id];
        if (!Number.isFinite(y)) continue;

        parts.ground.position.y = y;

        // Update shaft geometry.
        if (parts.shaft) {
          const x = parts.ground.position.x;
          const z = parts.ground.position.z;
          const platformY = parts.platform.position.y;
          const h = Math.max(0.01, Math.abs(platformY - y));
          const midY = (platformY + y) * 0.5;
          parts.shaft.position.set(x, midY, z);
          parts.shaft.scale.y = h;
        }

        // Update line geometry endpoints in-place.
        const pos = parts.link.geometry.attributes.position;
        // vertex 0 (ground)
        pos.setY(0, y);
        pos.needsUpdate = true;
        parts.link.geometry.computeBoundingSphere();
      }
    },
    updatePlatformYById(nextPlatformYById = {}) {
      for (const [id, parts] of byId.entries()) {
        const y = nextPlatformYById[id];
        if (!Number.isFinite(y)) continue;

        parts.platform.position.y = y;

        // Update shaft geometry.
        if (parts.shaft) {
          const x = parts.ground.position.x;
          const z = parts.ground.position.z;
          const groundY = parts.ground.position.y;
          const h = Math.max(0.01, Math.abs(y - groundY));
          const midY = (y + groundY) * 0.5;
          parts.shaft.position.set(x, midY, z);
          parts.shaft.scale.y = h;
        }

        // Update line geometry endpoints in-place.
        const pos = parts.link.geometry.attributes.position;
        // vertex 1 (platform)
        pos.setY(1, y);
        pos.needsUpdate = true;
        parts.link.geometry.computeBoundingSphere();
      }
    },
    dispose() {
      scene.remove(group);

      // Dispose shared resources once.
      platformGeo.dispose();
      groundGeo.dispose();
      shaftGeo.dispose();
      platformMat.dispose();
      groundMat.dispose();
      lineMat.dispose();
      shaftMat.dispose();

      // Lines use per-station BufferGeometry; meshes share the geos above.
      for (const obj of group.children) {
        const geo = obj.geometry;
        if (!geo) continue;
        if (geo === platformGeo || geo === groundGeo || geo === shaftGeo) continue;
        geo.dispose?.();
      }
    }
  };
}
