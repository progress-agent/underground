import * as THREE from 'three';

export async function tryCreateTerrainMesh({ opacity = 0.10 } = {}) {
  // Looks for generated outputs from scripts/build-heightmap.mjs
  // Expected files (repo-relative):
  // - /data/terrain/london_height_u16.png
  // - /data/terrain/london_height.json
  try {
    // Prefer Victoria AOI heightmap for now.
    const metaRes = await fetch('/data/terrain/victoria_dtm_u16.json', { cache: 'no-store' });
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

    // Our scene x/z are in local metres from ORIGIN (WGS84 tangent plane-ish).
    // The heightmap is in EPSG:27700 metres. We'll use it *visually* for now:
    // render a displaced plane roughly under the network.

    const size = 24000; // match grid size
    const segments = 256;

    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x0b1223,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity,
      displacementMap: tex,
      displacementScale: 60,
      displacementBias: -30,
      wireframe: true,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = -6.0;

    return { mesh, meta, widthM, heightM };
  } catch {
    return null;
  }
}
