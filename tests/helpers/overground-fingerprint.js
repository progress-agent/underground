// Fingerprint of everything the Overground draws as track (sprint 30Sep26w,
// Lane R). Runs IN THE PAGE (pass to page.evaluate). overground.js was
// generalised into surface-rail.js; this proves it still builds the same
// geometry with the same materials, independent of the GPU: every track mesh's
// vertex positions (FNV-1a over the Float32 bytes), vertex count, render
// order, material colour, emissive and emissive intensity, in scene order.
// Trains are excluded: overground-trains.js is untouched and its matrices
// depend on elapsed time. Only fields both c820ea9 and later builds carry are
// read (the new userData.part is ignored).
export function overgroundFingerprint() {
  const u = window.__ug, og = u.overground;
  const fnv = (h, bytes) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  const lines = {};
  let total = 2166136261 >>> 0, meshes = 0, vertices = 0;
  og.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData?.type !== 'overground-line') return;
    const p = o.geometry.attributes.position;
    // Positions as built (the true-proportion morph rewrites Y from the
    // retained originals, so a fresh page at the same Master reads the same).
    const bytes = new Uint8Array(p.array.buffer, p.array.byteOffset, p.array.byteLength);
    const m = o.material;
    const desc = `${o.userData.lineId}|${p.count}|${o.renderOrder}|${m.color?.getHexString()}|${m.emissive?.getHexString()}|${m.emissiveIntensity}|${m.roughness}|${m.metalness}|${m.side}`;
    let h = fnv(2166136261 >>> 0, new TextEncoder().encode(desc));
    h = fnv(h, bytes);
    (lines[o.userData.lineId] ||= []).push(h.toString(16));
    total = fnv(total, new TextEncoder().encode(h.toString(16)));
    meshes++; vertices += p.count;
  });
  return { total: total.toString(16), meshes, vertices, lines };
}
