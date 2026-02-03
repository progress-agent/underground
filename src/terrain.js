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

    // Convenience sampler: read "height" from the displacement map by sampling the same
    // texture used by the terrain material. This is approximate (no geo alignment yet)
    // but good enough to drive surface markers.
    // Returns a value in [0..1] where 0 is black and 1 is white.
    let heightSampler = null;
    try {
      const img = tex.image;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      heightSampler = (u, v) => {
        const uu = Math.min(1, Math.max(0, u));
        const vv = Math.min(1, Math.max(0, v));
        const x = Math.round(uu * (canvas.width - 1));
        const y = Math.round((1 - vv) * (canvas.height - 1)); // flip v (canvas origin top-left)
        const i = (y * canvas.width + x) * 4;
        return data[i] / 255; // red channel
      };
    } catch {
      // ignore
    }

    return { mesh, meta, widthM, heightM, heightSampler };
  } catch {
    return null;
  }
}

export function terrainHeightToWorldY({ h01, displacementScale = 60, displacementBias = -30, baseY = -6 } = {}) {
  // MeshStandardMaterial displacement: y += h * scale + bias
  // Our plane is centered at baseY.
  const h = Number.isFinite(h01) ? h01 : 0;
  return baseY + (h * displacementScale + displacementBias);
}

export function xzToTerrainUV({
  x,
  z,
  terrainSize = 24000,
} = {}) {
  // PlaneGeometry(size,size) is centered at origin.
  // Convert world x/z -> UV [0..1]
  const u = (x + terrainSize / 2) / terrainSize;
  const v = (z + terrainSize / 2) / terrainSize;
  return { u, v };
}
