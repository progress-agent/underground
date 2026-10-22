// Render economies (sprint 24Sep26h, Lane R, D-038): savings that leave the
// picture unchanged. Every one is on by default and can be switched off at
// runtime, so before/after timings and pixel comparisons run ABBA in a single
// page load (tests/render-economies.spec.js, Working/sprint-24Sep26h/economies/).
//
//   ?econ=0              all off (the e367efd behaviour)
//   ?econ=-shadowCache   everything except the named ones (an economy in DEFAULT_OFF stays off)
//   ?econ=dsplit,m25Cull only the named ones
//
// Visible trade-offs are deliberately NOT here; they are listed for Jordan in
// the economies report and never ship on by default. The one exception is
// underAbove: trade-offs 7 and 8 of the sprint 25Sep26f report, which Jordan
// approved on 26Sep26s (D-040), ribbons and all (underground-cull.js).

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
  trainBatch: 'Tube trains drawn as one instanced body mesh and one instanced window mesh per line (per-line colour, no per-instance colour)',
  // s16:R (sprint 16Oct26f, D-054): economies that leave the picture unchanged and cut the weak machine's cost
  trainCull: 'Tube trains are not posed or batched for a frame whose render hides every line group (the underground cull)',
  shadowFloat: 'The shadow cache compares what the GPU receives (float32 light matrices), so a last-bit wobble does not repeat the shadow map',
  shadowSnap: 'The sun shadow fit snaps along the light as well as across it, so a moving body does not re-render the shadow map every frame',
  edgeLineSize: 'The beyond-the-edge track lines read the canvas height taken before the names were written (no forced layout inside the render)',
  m25Chunks: 'M25 fleet: a vehicle remembers its route chunk until it could have left it, so culled vehicles cost no chainage and search',
  underAbove: 'Underground layers (lines, ribbons, trains, shafts, tunnels, geology, terrain underside) are not drawn from an above-ground camera (D-040: approved trade-offs 7 and 8)',
};

// ── s16:R ── economies that exist but ship OFF (sprint 16Oct26f); s21:T: the list is now empty. shadowSnap shipped on in
// sprint 21Oct26w (D-055 item 1, Jordan: "Let's switch it on as we might need those frames later"), against the
// recommendation: it saves about 1 ms a frame at the body views, and at the Westminster Bridge pose its frame differs from
// the unsnapped one by about 587 of 5.2M pixels (0.011%, 4 levels in most runs, 5 in one; the pin allows 6), above the 0.002% tolerance every economy is held
// to. That accepted difference is pinned in tests/render-economies-s16.spec.js (P7). The mechanism stays so a future
// off-by-default economy has a home: createEconomies leaves a DEFAULT_OFF member off unless the URL names it
// (`?econ=name,...`, the named ones only); at runtime `__ug.economies.set(name, true)`. `?econ=-shadowSnap`, `?econ=0`,
// a named-only list without it, and `__ug.economies.set('shadowSnap', false)` all switch shadowSnap off. parseEconomies
// itself is unchanged: it still reports every economy on for an absent `econ`.
export const DEFAULT_OFF = new Set();
function namedOn(search) {
  let raw = null;
  try { raw = new URLSearchParams(search).get('econ'); } catch { raw = null; }
  return new Set((raw ?? '').split(',').map(s => s.trim()).filter(p => p && !p.startsWith('-')).map(p => p.replace(/^\+/, '')));
}
// ── /s16:R ──

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
  { const named = namedOn(search); for (const k of DEFAULT_OFF) if (!named.has(k)) flags[k] = false; } // s16:R: DEFAULT_OFF
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
