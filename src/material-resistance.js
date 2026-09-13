// Held-key-only tactile boundaries. No timers or queued movement survive a
// key release. Callers keep camera/target translation paired in canonical space.
const pointAt = (p, d, t) => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });
const length = p => Math.hypot(p.x, p.y, p.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (p, t) => ({ x: p.x * t, y: p.y * t, z: p.z * t });
const slowPair = (a, b) => (a === 'AIR' && b === 'CLAY') || (a === 'CLAY' && b === 'AIR') ||
  (a === 'CLAY' && b === 'CHALK') || (a === 'CHALK' && b === 'CLAY');

export function createMaterialResistance({ classify, riverNormal, duration = 0.7, slowFactor = 0.08 } = {}) {
  let state = null;
  function cancel() { state = null; }
  function transition(p, d, from = classify(p)) {
    // Sweep instead of checking endpoints: Shift-flight can cross a complete
    // river or several substrates in one display frame.
    const count = Math.max(1, Math.ceil(length(d) / 2));
    let lo = 0;
    for (let i = 1; i <= count; i++) {
      const hi = i / count, next = classify(pointAt(p, d, hi));
      if (next === from) { lo = hi; continue; }
      let left = lo, right = hi;
      for (let k = 0; k < 18; k++) {
        const mid = (left + right) / 2;
        if (classify(pointAt(p, d, mid)) === from) left = mid; else right = mid;
      }
      const point = pointAt(p, d, right);
      // Bisection may find an intervening thin water column before the coarse
      // endpoint's clay. Classify the actual first boundary, not that endpoint.
      return { t: right, from, to: classify(point), point };
    }
    return null;
  }
  function apply(p, d, dt) {
    if (!(dt > 0) || length(d) < 1e-9) { cancel(); return scale(d, 0); }
    if (state?.kind === 'slow') {
      if (dot(d, state.direction) <= 0) cancel();
      else {
        const slowTime = Math.min(dt, duration - state.elapsed);
        state.elapsed += dt;
        const result = scale(d, (slowTime * slowFactor + dt - slowTime) / dt);
        if (state.elapsed >= duration) cancel();
        return result;
      }
    }
    if (state?.kind === 'released') {
      if (classify(p) !== 'WATER') cancel();
      else if (dot(d, state.normal) > 0) return d;
      else cancel();
    }
    if (state?.kind === 'hold' && dot(d, state.normal) <= 1e-7) cancel();
    let travelled = 0, start = p, remainder = d;
    // Free transitions (air/water, clay/water) must not hide a later blocked
    // crossing in the same frame.
    for (let pass = 0; pass < 8; pass++) {
      const hit = transition(start, remainder);
      if (!hit) { if (state?.kind === 'hold') cancel(); return d; }
      const globalT = travelled + (1 - travelled) * hit.t;
      if (slowPair(hit.from, hit.to)) {
        state = { kind: 'slow', elapsed: dt * (1 - globalT), direction: { ...d } };
        return scale(d, globalT + (1 - globalT) * slowFactor);
      }
      if (hit.from === 'WATER' && hit.to === 'CLAY') {
        const normal = riverNormal(hit.point, d);
        // Only physically modelled Thames boundaries participate. A dock
        // surface datum alone cannot supply an invented riverbed/normal.
        if (!normal) { cancel(); return d; }
        if (state?.kind !== 'hold' || dot(normal, state.normal) < 0.25) {
          state = { kind: 'hold', elapsed: 0, normal };
        }
        state.normal = normal;
        state.elapsed += dt * (1 - globalT);
        if (state.elapsed >= duration) { state = { kind: 'released', normal }; return d; }
        const safeT = Math.max(0, globalT - 0.002 / length(d));
        const contact = pointAt(p, d, safeT);
        const leftover = scale(d, 1 - globalT);
        const outward = Math.max(0, dot(leftover, normal));
        const tangent = { x: leftover.x - normal.x * outward, y: leftover.y - normal.y * outward,
          z: leftover.z - normal.z * outward };
        // Curved banks and sloping bed can meet a second face during a slide.
        // Bound the tangent as well, retaining the accumulated pressure.
        const tangentHit = transition(contact, tangent, 'WATER');
        const fraction = tangentHit ? Math.max(0, tangentHit.t - 0.002 / (length(tangent) || 1)) : 1;
        const end = pointAt(contact, tangent, fraction);
        return { x: end.x - p.x, y: end.y - p.y, z: end.z - p.z };
      }
      travelled = Math.min(1, globalT + 0.002 / length(d));
      if (travelled >= 1) return d;
      start = pointAt(p, d, travelled);
      remainder = scale(d, 1 - travelled);
    }
    return d;
  }
  return { apply, cancel, get state() { return state ? { ...state } : null; } };
}
