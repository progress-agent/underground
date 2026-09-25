// Rail truth at the river (sprint 25Sep26f, D-039 Lane E).
//
// Two corrections Jordan asked for, kept as data plus pure helpers so the
// Node tests can check them without a browser.
//
// 1. Thames Tunnel (Wapping to Rotherhithe, Windrush line). Drawn with every
//    other Overground tunnel at 20 m below the local ground, which under the
//    river put it 20 m below the carved bed. Brunel's tunnel is shallow: "it was
//    planned to pass within seven feet of the river bed in places" (Smithsonian
//    Magazine, "The Epic Struggle to Tunnel Under the Thames"), and the bore is
//    20 ft (6.1 m) high (Thames Tunnel, Wikipedia; Grace's Guide). The drawn line
//    is the bore's centre: crown cover 7 ft (2.13 m) + half the bore height
//    (3.05 m) = 5.2 m below the bed.
//
// 2. District line at Putney and Kew. The line crosses the Thames on railway
//    bridges, Fulham Railway Bridge (Putney Bridge to East Putney) and Kew
//    Railway Bridge (Gunnersbury to Kew Gardens), not in tunnel. Every tube line
//    was clamped under the river bed wherever it met the river, which drove the
//    District under both. The crossing points below lift it onto the bridge
//    decks drawn by bridges.js from the same axes and clearances
//    (public/data/bridges.json; tests assert the copies agree).

export const THAMES_TUNNEL = {
  /** Bore centre below the river bed, metres (7 ft cover + 3.05 m half-height). */
  centreBelowBedM: 5.2,
  crownCoverM: 2.13,
  boreHeightM: 6.1,
  sources: [
    'https://www.smithsonianmag.com/history/the-epic-struggle-to-tunnel-under-the-thames-14638810/',
    'https://en.wikipedia.org/wiki/Thames_Tunnel',
  ],
};

/**
 * Sourced railway-bridge crossings of the Thames by tube lines. Axis ends are
 * BNG metres, copied from bridges.json (`axis.a`, `axis.b`); clearance is the
 * deck soffit above the modelled water level, also from bridges.json.
 */
export const RAIL_BRIDGE_CROSSINGS = [
  { lineId: 'district', bridge: 'fulham-rail', name: 'Fulham Railway Bridge',
    between: ['Putney Bridge', 'East Putney'],
    axis: { a: { e: 524427, n: 175501 }, b: { e: 524500, n: 175748 } }, clearanceM: 5.9,
    source: 'https://en.wikipedia.org/wiki/Fulham_Railway_Bridge' },
  { lineId: 'district', bridge: 'kew-rail', name: 'Kew Railway Bridge',
    between: ['Gunnersbury', 'Kew Gardens'],
    axis: { a: { e: 519526, n: 177444 }, b: { e: 519609, n: 177579 } }, clearanceM: 5.5,
    source: 'https://en.wikipedia.org/wiki/Kew_Railway_Bridge' },
];

/** Bridge deck thickness in real metres (bridges.js: 1.2 m, centred on deckY). */
export const BRIDGE_DECK_THICKNESS_M = 1.2;
/** Axis overshoot so the deck points reach both banks' landings. */
const AXIS_OVERSHOOT_M = 25;

function segIntersect(a, b, c, d) {
  const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c.x - a.x, qz = c.z - a.z;
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** Scene XZ ends of a crossing's deck, extended to the landings. */
export function crossingDeckEnds(crossing, bngRef) {
  const toXZ = p => ({ x: p.e - bngRef.e, z: -(p.n - bngRef.n) });
  const a = toXZ(crossing.axis.a), b = toXZ(crossing.axis.b);
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  const ox = dx / l * AXIS_OVERSHOOT_M, oz = dz / l * AXIS_OVERSHOOT_M;
  return { a: { x: a.x - ox, z: a.z - oz }, b: { x: b.x + ox, z: b.z + oz }, lengthM: l + 2 * AXIS_OVERSHOOT_M };
}

/**
 * Find where a tube branch polyline crosses a sourced railway bridge. The
 * branch is drawn through its stations, so the crossing is the station-to-
 * station chord that crosses the river within 400 m of the bridge (the chord
 * can pass some way from the real bridge on a curving route).
 *
 * @param {Array<{x:number,z:number}>} pts  branch centre points in order
 * @returns {Array<{index:number, crossing:object, ends:{a,b}}>} index = chord start
 */
export function findBridgeCrossings(lineId, pts, bngRef) {
  const out = [];
  for (const crossing of RAIL_BRIDGE_CROSSINGS) {
    if (crossing.lineId !== lineId) continue;
    const ends = crossingDeckEnds(crossing, bngRef);
    // The chord crosses the river near the bridge: test it against a line
    // ALONG the river (perpendicular to the bridge axis) through the deck's
    // midpoint, 400 m either way. The axis itself runs parallel to the chord.
    const mx = (ends.a.x + ends.b.x) / 2, mz = (ends.a.z + ends.b.z) / 2;
    const ux = (ends.b.x - ends.a.x) / ends.lengthM, uz = (ends.b.z - ends.a.z) / ends.lengthM;
    const L = 400;
    const la = { x: mx - uz * L, z: mz + ux * L }, lb = { x: mx + uz * L, z: mz - ux * L };
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i]._bridge || pts[i + 1]._bridge) continue;
      const hit = segIntersect(pts[i], pts[i + 1], la, lb);
      if (!hit) continue;
      // Orient the deck ends with the direction of travel.
      const da = Math.hypot(pts[i].x - ends.a.x, pts[i].z - ends.a.z);
      const db = Math.hypot(pts[i].x - ends.b.x, pts[i].z - ends.b.z);
      out.push({ index: i, crossing, ends: da <= db ? ends : { a: ends.b, b: ends.a, lengthM: ends.lengthM } });
    }
  }
  return out;
}

/**
 * Scene Y for a tube centreline resting on a bridge deck.
 * @param {number} deckY      bridge deck centre, scene Y (registry deckY)
 * @param {number} vScale     scene units per real vertical metre for structures
 * @param {number} tubeRadius scene units
 */
export function tubeOnDeckY(deckY, vScale, tubeRadius) {
  return deckY + (BRIDGE_DECK_THICKNESS_M / 2) * vScale + tubeRadius;
}
