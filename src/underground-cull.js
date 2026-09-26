// Underground layers are not drawn while the camera is above ground (D-040,
// 26Sep26s: Jordan's answers on trade-offs 7 and 8 of the sprint 25Sep26f
// report). Two reasons, one rule:
//   - the look: "there should be no overground ribbons for underground lines".
//     Where a Tube, DLR or Elizabeth line runs at or above the surface, its
//     bore, crown ribbon, trains and markers poked through the ground (the
//     teal DLR ribbon at Mudchute); from an above-ground camera nothing of an
//     underground line is drawn now;
//   - the cost: everything else in the set is already hidden by the opaque
//     ground from above, yet the renderer still walked, culled, sorted and
//     drew it. Measured 25Sep26f: 4.9ms a frame as lived on the M5, 9.7ms on
//     the weak-machine setup (geology alone 0.9 / 1.8ms).
//
// HOW: the set is hidden only for the duration of the render call and restored
// straight after, so nothing that reads `visible` between frames can tell:
// hover picking (which deliberately reaches underground lines through the
// ground), the solo-line filter and the layer toggles behave exactly as before.
// The trade-off sheets were made by zeroing object layers instead, which also
// blinded the hover raycaster; that is why this is not a layer mask.
//
// WHEN (all three): the camera above the local ground surface; not in the
// river (the bed is the floor there, but keep the water column exactly as it
// was); and well inside the map edge, where the cliff, skirt and chalk column
// are only ever seen from outside. The opening needs no exception: its descent
// lands underground, and the loading gate's warm-up frames (which call the
// composer directly, bypassing this) upload everything the landing shows while
// the bar is still up, so the underground appearing at the crossing costs no
// frame.
//
// NOT IN THE SET, though the harness hid them: the Tideway whirlpools, which
// sit on the river bed and are meant to be seen through the water from above,
// and the Overground station markers, which are surface markers.

/** Top-level scene objects that are wholly underground, by name. */
export const UNDERGROUND_LAYER_NAMES = new Set([
  'terrainUnderside', 'geological-strata', 'geology-exterior', 'crossrail-tunnel', 'sewer-tunnels',
]);
/** Children of an underground group that are seen from above ground. */
export const SEEN_FROM_ABOVE = new Set(['tideway-whirlpools']);
/** How far inside the map edge the camera must be: M25 insideness 1 is at
 * least half the 1500m edge band (750m) inside the ring. */
export const INSIDE_MIN = 0.999;

/** The objects to leave undrawn above ground, refilled into `out`. */
export function collectUndergroundLayers(scene, out = []) {
  out.length = 0;
  for (const c of scene.children) {
    const n = c.name || '';
    if (UNDERGROUND_LAYER_NAMES.has(n) || n.startsWith('line:') || c.userData?.kind === 'unified-shafts') out.push(c);
    else if (n === 'tideway-system') { for (const k of c.children) if (!SEEN_FROM_ABOVE.has(k.name)) out.push(k); }
    else if (c.userData?.kind === 'station-markers' && !c.userData.surfaceOnly) out.push(c);
  }
  return out;
}

/** Is this an above-ground view in which nothing underground can be seen? */
export function isAboveGroundView({ belowSurface, submerged, insideness }) {
  return !belowSurface && !submerged && insideness >= INSIDE_MIN;
}

export function createUndergroundCull({ scene }) {
  const set = [], hidden = [];
  const status = { active: false, hidden: 0 };
  /** Run `draw` with the underground set hidden when `active`; restores it after. */
  function render(active, draw) {
    status.active = !!active;
    if (!active) { status.hidden = 0; return draw(); }
    collectUndergroundLayers(scene, set);
    hidden.length = 0;
    for (const o of set) if (o.visible) { o.visible = false; hidden.push(o); }
    status.hidden = hidden.length;
    try { return draw(); } finally {
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
    }
  }
  return { render, status, collect: () => collectUndergroundLayers(scene, []) };
}
