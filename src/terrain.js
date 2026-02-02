import * as THREE from 'three';

export async function tryCreateTerrainMesh() {
  // Looks for generated outputs from scripts/build-heightmap.mjs
  // Expected files (repo-relative):
  // - /data/terrain/london_height_u16.png
  // - /data/terrain/london_height.json
  try {
    const metaRes = await fetch('/data/terrain/london_height.json', { cache: 'no-store' });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();

    const tex = await new THREE.TextureLoader().loadAsync(`/data/terrain/${meta.heightmap}`);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const [xmin, ymin, xmax, ymax] = meta.bounds_m;
    const widthM = xmax - xmin;
    const heightM = ymax - ymin;

    // NOTE: Our scene currently uses a rough lat/lon projection scaling, not EPSG:27700.
    // For now we just create a local terrain plane for visual relief and tune scale by eye.
    // Next step: unify coordinates (convert station positions to EPSG:27700 meters).

    const size = 900; // match existing grid plane size
    const segments = 256;

    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x0b1223,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.10,
      displacementMap: tex,
      displacementScale: 18,
      displacementBias: -9,
      wireframe: true,
      wireframeLinewidth: 1,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = -6.0;

    return { mesh, meta, widthM, heightM };
  } catch {
    return null;
  }
}
