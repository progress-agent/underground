// assembly-mask.js (s21:V2): hides the landmark models whose centre the rise front has not reached yet, inside the render
// call only (the pattern of underground-cull.js), so compile, warm-ups and hover still see them.
import * as THREE from 'three';

export function createAssemblyMask({ getGroup, getOrigin, getFront }) {
  const centres = new WeakMap();
  const box = new THREE.Box3();
  const hidden = [];
  function centreOf(child) {
    let c = centres.get(child);
    if (!c) {
      box.setFromObject(child);
      c = box.isEmpty() ? { x: child.position.x, z: child.position.z } : { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
      centres.set(child, c);
    }
    return c;
  }
  return {
    render(fn) {
      const group = getGroup();
      const front = getFront();
      if (!group || !(front < 1e8)) return fn();
      const o = getOrigin();
      hidden.length = 0;
      for (const child of group.children) {
        if (!child.visible) continue;
        const c = centreOf(child);
        if (Math.hypot(c.x - o.x, c.z - o.z) > front) { child.visible = false; hidden.push(child); }
      }
      try { return fn(); } finally { for (const child of hidden) child.visible = true; hidden.length = 0; }
    },
  };
}
