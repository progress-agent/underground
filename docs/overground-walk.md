# The Pedestrian walk on the Overground (sprint 02Oct26f, lane O, D-048 item 5)

All six Overground lines (Liberty, Lioness, Mildmay, Suffragette, Weaver, Windrush) are in the Pedestrian
walk network under the ids `og:<line>`. Every station is a stop, the Tube and DLR changes are card choices,
the walk rides the drawn track in the open, and the Overground tunnels are walked in the bore at the drawn 20 m.

## Where it lives

| File | What |
|---|---|
| `src/modes/overground-network.js` | Pure. Builds the Overground's branches and stations from `overgroundGroup.userData.linePaths` and `stationSets`. |
| `src/modes/overground-walk.js` | The walker's presenter on that track (`createOvergroundAirMap`) and the Overground trains through the walker (`overgroundPass`). |
| `src/modes/overground-routes.js` | "towards" rows that look past junctions (`ogNextStations`, `overgroundRows`). |
| `src/modes/pedestrian-tunnels.js` | `s02:O` edits: single bore for `og:`, `path.og`, station junctions, the interchange rule, portal finders skip `og:`. |
| `src/main.js` (`s02:O`) | `ctx.tubeNetwork.overground` (a getter), `ctx.overground`, the route data, the line colours. |
| `public/data/tfl/route-sequence-overground/` | TfL route sequences for the six lines. Never in `route-sequence/`: `main.js` builds a Tube line for every key of that index. Refresh with `node scripts/cache-tfl.mjs --overground`. |

The Tube and DLR code paths are unchanged: `lineBranchCenterPts`, `lineShaftLayers` and the station markers never
see the Overground (the walk merges `ctx.tubeNetwork.overground` into the maps it passes to `buildTunnelNetwork`).

## The network rules (constants in `overground-network.js`)

1. **Joins.** A drawn piece whose end is within 30 m of another piece of its line is joined at the nearest point
   Q. Q becomes a vertex of the other piece (or an existing vertex within 2.5 m is used) and its EXACT coordinates
   are appended to the joining end, so the rounded-metre junction keys match.
2. **Gaps.** While a line has more than one connected component, the shortest link from a component's end vertex to
   a vertex of another, up to 1000 m, is a connector walked in the bore at the drawn tunnel's formula
   (`ground + 5 + (-20) * VE`). The data has one: the Weaver's, about 825 m between the Liverpool Street
   fragment and the Hackney trunk, carrying Bethnal Green.
3. **Stations** (one listed twice by name within 100 m is one). The nearest point Q over the line's pieces, at
   distance d: at a piece END (or within one 12 m step of it) and 15 < d <= 450 m, a straight STUB from the end to
   the site (the station is its last vertex); else d <= 250 m, Q becomes a vertex of the nearest piece and of every
   other piece whose own nearest point is within d + 30 m and not an end (Hackney Downs sits on both Weaver
   trunks); else not a stop (`stub-too-long`, `no-track`). Cheshunt is 520 m past the Weaver's drawn end today
   (Lane T's track).
4. **A stop stands at its station's SITE** (`stop.x`, `stop.z`; the entrance is there too) while its platform is
   the track vertex at `s`. So the street's E, the interchange rule and a terminus reached on foot all use the
   real station point.
5. **Junctions** are keyed only at the vertices the source flags (`branch.ogJunction`: joins, connector ends, stub
   starts, and any vertex two pieces of a line share to the metre: the Enfield branch runs on the Cheshunt line's own
   track for 70 m, and a walker must be able to choose where they part). A station on two pieces is one junction
   group (`linkOvergroundStations`).

Each branch array carries `.og`, a record per vertex (`track`, `mix`, `stub`, `gap`); `liveY(rec)` is its
height now, read from the drawn sample (`overground.js setHeightScale` morphs it with Master), so the walker follows
Master with no rebuild and the presenter's cache key has no ratio (the DLR's mapper depends on it).

## Interchanges

An Overground stop, measured from its site, joins every Tube or DLR entrance within 40 m, or within 400 m with the
same name key (lower case, parentheticals removed, apostrophes removed, `&` read as "and", a leading "London "
optional). Several matches are merged into the nearest (Stratford's Central, Jubilee and DLR). Bethnal Green's two
stations are 461 m apart and stay separate. Every entrance gains `names[]`. `net.stats.ogInterchanges` lists every
pair, `net.stats.ogMerges` every merge.

## The walk

- The walker is on the drawn polyline 2.6 m to the left of its direction of travel (`OG_LANE_M`, the trains' own
  formula), eye `P.eye * VE * ratio` above the rail head. 60 and 200 m/s are measured along the track (the path's
  arc is the track's own arc).
- A tunnel run under 60 m between open runs is an overbridge: shown open, `y` straight between the open vertices
  either side. An open run under 60 m is dropped. Connectors are the bore.
- Overground trains in the walker's lane pass through it (`overgroundPass`, `passingState`): the proxy is the train
  on its drawn path at its lane offset. The other lane is 5.2 m away and never passes.
- The bore uses `tube-interior.js` as it is (a 3.56 m lining coloured with the line). True Overground bore sizes
  belong to the depth review of D-047 item 2.

## Cost

`buildTunnelNetwork` for the Overground alone is about 4 ms (node); each `ctx.tubeNetwork.overground` read is about
3 ms; map-edge marking steps Overground paths at 80 m (`OG_EDGE_STEP_M`) and skips the second-point test, since
the Overground's shown point is the path's own. A presenter builds in under 1 ms a line.

## Tests

`tests/overground-network.test.mjs`, `overground-walk.test.mjs`, `overground-routes.test.mjs` (node);
`tests/pedestrian-overground.spec.js` (the six routes, the four changes, "towards" text, a train passing through the
walker, Master independence, lazy mapping, cost). `scripts/capture-overground-walk.mjs` makes the captures.
