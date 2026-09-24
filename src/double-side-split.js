// Double-sided transparent split (sprint 24Sep26h, Lane R, D-038).
//
// three r161 draws every `transparent && side === DoubleSide` object in two
// passes (back faces, then front faces) and flips `material.side` with
// `material.needsUpdate = true` around each pass (WebGLRenderer.renderObject).
// Every flip bumps the material version, so each of the ~368 such objects
// forces two full program lookups (getParameters + cache-key string) per
// frame: about 9,400 a second, 4 to 5ms of main thread at street and river.
//
// This module reproduces those exact draws without the churn. For the main
// scene's render only, each qualifying mesh temporarily renders with a
// FrontSide derivative of its material, and a temporary child renders the
// BackSide derivative. A custom transparent sort places the back child
// immediately before its parent, which is the order three's own two-pass
// produced (same group order, render order, depth, then object id). The draws,
// programs and blend order are identical, so the picture is unchanged by
// construction; the spec tests/render-economies.spec.js checks it per view.
//
// Outside that render call nothing changes: mesh.material is the app's own
// DoubleSide material (hover, raycasts, tuning and uniforms all see it), and
// the back child is detached. Derived materials inherit every property from
// the original through the prototype chain (so opacity, colour, maps and
// version changes flow through), overriding only `side`.

import * as THREE from 'three';

const DEFAULT_OBJECT_BEFORE_RENDER = THREE.Object3D.prototype.onBeforeRender;
const DEFAULT_MATERIAL_BEFORE_RENDER = THREE.Material.prototype.onBeforeRender;

/** Would three draw this object with its two-pass DoubleSide path, and can we
 * reproduce it exactly? Conservative: anything unusual keeps the default path. */
export function qualifiesForSplit(o) {
  const m = o?.material;
  return !!(o && o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh
    && !o.morphTargetInfluences && m && !Array.isArray(m)
    && m.transparent === true && m.side === THREE.DoubleSide && m.forceSinglePass === false
    && !(m.transmission > 0) && o.castShadow !== true
    && o.onBeforeRender === DEFAULT_OBJECT_BEFORE_RENDER
    && m.onBeforeRender === DEFAULT_MATERIAL_BEFORE_RENDER);
}

function derive(material, side) {
  const d = Object.create(material);
  d.side = side;           // the only own property that differs
  d._listeners = {};       // own dispatcher: renderer dispose hooks stay per object
  d.__dsOriginal = material;
  return d;
}

/** Same comparison as three's reversePainterSortStable, except that a split
 * mesh's back child sorts with its parent's id, immediately before it. */
export function splitAwareTransparentSort(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  const ka = a.object.__dsKey ?? a.id, kb = b.object.__dsKey ?? b.id;
  if (ka !== kb) return ka - kb;
  return (a.object.__dsBack === true ? 0 : 1) - (b.object.__dsBack === true ? 0 : 1);
}

export function installDoubleSideSplit({ renderer, scene, enabled = true, rescanFrames = 60 }) {
  const pairs = new Map();     // original material -> { back, front, maps: [] }
  const entries = new Map();   // mesh -> { back: Mesh }
  const attached = [];         // meshes swapped for the current render
  let on = !!enabled, renders = 0, lastScan = -Infinity;
  const stats = { candidates: 0, splitLastRender: 0, rescans: 0, uniformSyncs: 0 };

  renderer.setTransparentSort(splitAwareTransparentSort);

  function pairFor(material) {
    let p = pairs.get(material);
    if (!p) {
      p = { back: derive(material, THREE.BackSide), front: derive(material, THREE.FrontSide), maps: [] };
      pairs.set(material, p);
      material.addEventListener('dispose', () => {
        p.back.dispose(); p.front.dispose(); pairs.delete(material);
      });
    }
    return p;
  }

  // Shaders that create fresh uniform objects in onBeforeCompile (the water
  // material does) give each compiled material its own uniform map. The app
  // updates only the most recently compiled one (the map it keeps in
  // userData), so the newest map's entries are shared into every other map of
  // the same original. Shared entries mean both passes read the same values.
  function referencedByUserData(material, map) {
    for (const v of Object.values(material.userData || {})) {
      if (v === map) return true;
      if (v && typeof v === 'object') for (const k in map) if (map[k] === v) return true;
    }
    return false;
  }
  function syncUniforms(material, p) {
    const fresh = [];
    for (const m of [material, p.back, p.front]) {
      const u = renderer.properties.get(m).uniforms;
      if (u && !p.maps.includes(u) && !fresh.includes(u)) fresh.push(u);
    }
    if (!fresh.length) return;
    const canonical = fresh.find(u => referencedByUserData(material, u)) ?? fresh[fresh.length - 1];
    for (const other of [...p.maps, ...fresh]) {
      if (other === canonical) continue;
      for (const k in canonical) other[k] = canonical[k];
    }
    p.maps.push(...fresh);
    if (p.maps.length > 12) p.maps.splice(0, p.maps.length - 12);
    stats.uniformSyncs++;
  }

  function rescan() {
    const seen = new Set();
    scene.traverse(o => {
      if (o.__dsBack) return;
      if (qualifiesForSplit(o)) {
        seen.add(o);
        if (!entries.has(o)) {
          const back = new THREE.Mesh(o.geometry, null);
          back.name = `${o.name || 'mesh'}:back-pass`;
          back.__dsBack = true;
          back.raycast = () => {};
          back.matrixAutoUpdate = false; // identity: its world matrix is its parent's
          entries.set(o, { back });
        }
      }
    });
    for (const o of [...entries.keys()]) if (!seen.has(o)) entries.delete(o);
    stats.candidates = entries.size;
    stats.rescans++;
  }

  function before(targetScene) {
    if (!on || targetScene !== scene || scene.overrideMaterial) return;
    if (renders - lastScan >= rescanFrames) { rescan(); lastScan = renders; }
    for (const [mesh, e] of entries) {
      if (!mesh.parent || !qualifiesForSplit(mesh)) continue;
      const original = mesh.material, p = pairFor(original);
      syncUniforms(original, p);
      const back = e.back;
      back.geometry = mesh.geometry;
      back.material = p.back;
      back.renderOrder = mesh.renderOrder;
      back.layers.mask = mesh.layers.mask;
      back.frustumCulled = mesh.frustumCulled;
      back.receiveShadow = mesh.receiveShadow;
      back.__dsKey = mesh.id;
      back.parent = mesh;
      back.matrixWorld.copy(mesh.matrixWorld);
      back.matrixWorldNeedsUpdate = true;
      mesh.children.push(back);
      e.saved = original;
      mesh.material = p.front;
      attached.push(mesh);
    }
    stats.splitLastRender = attached.length;
  }

  function after() {
    for (const mesh of attached) {
      const e = entries.get(mesh);
      if (e) {
        mesh.material = e.saved; e.saved = null;
        const i = mesh.children.lastIndexOf(e.back);
        if (i >= 0) mesh.children.splice(i, 1);
        e.back.parent = null;
      }
    }
    attached.length = 0;
  }

  const render = renderer.render.bind(renderer);
  renderer.render = function renderWithDoubleSideSplit(targetScene, camera) {
    before(targetScene);
    try { return render(targetScene, camera); } finally { if (attached.length) after(); renders++; }
  };

  return {
    stats,
    get enabled() { return on; },
    setEnabled(v) { on = !!v; if (on) lastScan = -Infinity; },
    rescan: () => { lastScan = -Infinity; },
    entries,
    pairOf: material => pairs.get(material) ?? null,
  };
}
