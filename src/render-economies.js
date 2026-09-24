// Render economies (sprint 24Sep26h, Lane R, D-038): savings that leave the
// picture unchanged. Every one is on by default and can be switched off at
// runtime, so before/after timings and pixel comparisons run ABBA in a single
// page load (tests/render-economies.spec.js, Working/sprint-24Sep26h/economies/).
//
//   ?econ=0              all off (the e367efd behaviour)
//   ?econ=-shadowCache   everything except the named ones
//   ?econ=dsplit,m25Cull only the named ones
//
// Visible trade-offs are deliberately NOT here; they are listed for Jordan in
// the economies report and never ship on by default.

export const ECONOMIES = {
  dsplit: 'Double-sided transparent objects drawn as explicit back/front passes (no program churn)',
  m25Cull: 'M25 fleet: vehicles outside the view frustum are not recomputed or uploaded',
  m25FogCull: 'M25 fleet: vehicles wholly beyond fog.far (drawn in pure fog colour over fogged ground) are skipped too',
  flightsPool: 'Flights: the per-frame aircraft list is built into pooled records with cached variants (no per-frame allocation)',
  flightCull: 'Flights: aircraft outside the view frustum get no instance',
  instanceRanges: 'Instanced fleets upload only the live instance range',
  hiddenSkip: 'Layers that are hidden skip their pose and matrix work (time still advances)',
  shadowCache: 'Shadow map re-rendered only when the sun, the fit or the casters change',
  labelViewport: 'Station labels read the canvas size once per frame',
  trainPose: 'Tube trains reuse their pose while dwelling and when their line is hidden',
};

export function parseEconomies(search = '') {
  const flags = Object.fromEntries(Object.keys(ECONOMIES).map(k => [k, true]));
  let raw = null;
  try { raw = new URLSearchParams(search).get('econ'); } catch { raw = null; }
  if (raw === null || raw === '' || raw === '1') return flags;
  if (raw === '0') { for (const k in flags) flags[k] = false; return flags; }
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const exclusive = parts.every(p => p.startsWith('-'));
  if (!exclusive) for (const k in flags) flags[k] = false;
  for (const p of parts) {
    const name = p.replace(/^[-+]/, '');
    if (name in flags) flags[name] = !p.startsWith('-');
  }
  return flags;
}

export function createEconomies(search = typeof location === 'undefined' ? '' : location.search) {
  const flags = parseEconomies(search);
  const listeners = new Set();
  return {
    flags,
    on: name => flags[name] === true,
    set(name, value) {
      if (!(name in flags)) throw new Error(`Unknown render economy: ${name}`);
      flags[name] = !!value;
      for (const fn of listeners) fn(name, flags[name]);
      return flags[name];
    },
    setAll(value) { for (const k in flags) this.set(k, value); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    describe: () => ({ ...ECONOMIES }),
  };
}

/** True when the object and every ancestor are visible (three's own test for
 * whether a subtree is drawn at all). */
export function isShown(object) {
  for (let o = object; o; o = o.parent) if (o.visible === false) return false;
  return true;
}
