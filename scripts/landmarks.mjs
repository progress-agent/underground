// Named-site registry — the ONE source the bake compiler reads twice.
//
// Round one chosen by Jordan 06Sep26u. Landmarks are modelled as real OSM
// footprint extrusion + a hand-authored crown (the bridges.js archetype idiom),
// which creates two obligations on the compiler that pull in opposite
// directions and are both served from this file:
//
//   SUPPRESSION — a hand-modelled building stands where the map data already
//   puts a generic grey box. Every source building whose centre falls within
//   `suppressRadiusM` of the site is dropped from the baked set.
//
//   POLYGON RETENTION — the bake's entire size win comes from discarding the
//   outline polygon (723MB of JSON to ~13MB of binary), because the renderer
//   only needs centre, height and area to place a box. Landmarks need those
//   polygons back. They are written to a small side-file instead, keyed by
//   site id, so the main payload stays lean.
//
// Coordinates are DERIVED, not eyeballed: WGS84 lat/lon -> EPSG:27700 via proj4,
// then x = easting - 530000, z = -(northing - 180400). Regenerate the same way.
// Coordinates are scene space: x = BNG easting - 530000, z = -(northing - 180400).
// `crown` names the geometry archetype the renderer will author per site; it is
// not read by the compiler, and is recorded here so the two halves cannot drift.

export const LANDMARKS = [
  { id: 'shard',          name: 'The Shard',                    x: 2903, z: 268, suppressRadiusM:  70, crown: 'tapered-spike',  station: 'London Bridge' },
  { id: 'st-pauls',       name: "St Paul's Cathedral",          x: 2050, z: -744, suppressRadiusM: 110, crown: 'dome-two-towers', station: "St Paul's" },
  { id: 'westminster',    name: 'Palace of Westminster',        x: 259, z: 893, suppressRadiusM: 180, crown: 'gothic-clock-tower', station: 'Westminster' },
  { id: 'gherkin',        name: '30 St Mary Axe',               x: 3304, z: -855, suppressRadiusM:  55, crown: 'lathe',          station: 'Aldgate' },
  { id: 'london-eye',     name: 'London Eye',                   x: 610, z: 461, suppressRadiusM:  90, crown: 'wheel',          station: 'Waterloo' },
  { id: 'battersea',      name: 'Battersea Power Station',      x: -1072, z: 2885, suppressRadiusM: 190, crown: 'four-chimneys',  station: 'Battersea Power Station' },
  { id: 'canary-wharf',   name: 'One Canada Square + cluster',  x: 7552, z: 100, suppressRadiusM: 220, crown: 'pyramid-cluster', station: 'Canary Wharf' },
  { id: 'bt-tower',       name: 'BT Tower',                     x: -781, z: -1528, suppressRadiusM:  45, crown: 'cylinder-shaft', station: 'Goodge Street' },
  { id: 'the-o2',         name: 'The O2',                       x: 9133, z: 269, suppressRadiusM: 210, crown: 'dome-twelve-masts', station: 'North Greenwich' },
  { id: 'wembley',        name: 'Wembley Stadium',              x: -10633, z: -5126, suppressRadiusM: 230, crown: 'bowl-arch',      station: 'Wembley Park' },
];

// Tower Bridge is DELIBERATELY ABSENT. It is already modelled in src/bridges.js
// (44m towers, cone caps, high walkway) and is bridge geometry, not a building,
// so it has no map-derived box under it to suppress.

/** True if (x, z) falls inside any landmark's suppression disc. */
export function isSuppressed(x, z) {
  for (const L of LANDMARKS) {
    const dx = x - L.x, dz = z - L.z;
    if (dx * dx + dz * dz <= L.suppressRadiusM * L.suppressRadiusM) return L.id;
  }
  return null;
}
