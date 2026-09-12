# M25 motorway and supported terrain boundary

This component draws real mapped M25 carriageways and the A282 Dartford closure, with stationary geometry and slowly moving illustrative traffic. It replaces the coarse grey ring, which misplaced the orbital boundary and clipped Stapleford outside the city.

## Integration

```js
import {
  createMotorway, getMotorwayBoundary, MOTORWAY_DATA,
  MOTORWAY_REPLACED_BRIDGES,
} from './m25-motorway.js';
const motorway=createMotorway({getSurfaceY:getTerrainMeshSurfaceY,VE:5,heightScale:getBuildingHeightScale()});
scene.add(motorway);
// Shared simulation time is applied ONCE, by the caller:
motorway.userData.update(paused?0:dt*timeScale,camera);
motorway.userData.setHeightScale(getBuildingHeightScale());
```

`getSurfaceY({x,z})` returns canonical pre-master Y, already carrying terrain VE. The component carries no master multiplier. Master-height integration should treat it like other canonical meshes and instance matrices. Initialise after final terrain, then build/register the group before suppressing older geometry. Creation throws on missing terrain; preserve the old road/bridges on failure and report the missing coverage. Do not clamp absent DEM pixels or silently skip the southern route.

Both static road geometry and instanced vehicles use source X/Z without horizontal scaling. All coordinates are BNG metres relative to the proj4 projection of WGS84 51.5074,-0.1278. The precise origin is in `MOTORWAY_DATA.originBNG`, matching the app's runtime projection, rather than the older fixed530000/180400 helper.

Successful creation replaces the old M25 outline mesh and the existing curated bridges whose slugs are listed by `MOTORWAY_REPLACED_BRIDGES`, currently `qe2` and `runnymede`. Only suppress those bridge groups after motorway success. The new road follows both real carriageways across Runnymede and supplies their support piers; the A282 southbound road includes the QEII approach deck, piers, pylons and cable fans. Leaving the old complete bridge decks attached creates duplicates at mismatched alignments. All other curated bridge groups remain.

The motorway is generated against immutable terrain. If the terrain mesh itself is replaced after creation, dispose/recreate the motorway against the new sampler. There is intentionally no per-frame terrain sampling or undocumented refresh method. Structure height updates deck rises, barriers and vehicle height about their ground/water bases. Underground road floor profiles stay fixed when Structure changes. Master scales the whole scene exactly once externally. `dispose()` releases geometry/materials and detaches the group.

Meshes carry `userData.type='motorway'`, plain names and part names; static `userData.pickables` can join the hover system. No exact road height or historic date is asserted by the tooltip. `userData.routes`, `roadPaths`, `pointAt(routeId,distance)`, `getElapsed()` and `stats` expose verification data.

## Boundary and terrain support

`getMotorwayBoundary(40)` returns a closed array of `[x,z]` canonical points, already offset outwards by40m. Use this exact boundary for the terrain mask, the cutaway curtain, geology exterior and their baked counterparts. Do not apply a second offset. It follows the true outer carriageway, not a hand-drawn ellipse. One small self-crossing caused by offsetting a sharp lane split is repaired by removing the offset loop; road coordinates remain unchanged. The resulting980point support polygon is simple, and every mapped road vertex is inside it.

Convert to the existing BNG public shape using `e=x+originBNG[0]`, `n=originBNG[1]-z`. Keep the source unbuffered ring separately if needed for semantic motorway position: `MOTORWAY_DATA.boundary.points` is the982point centreline enclosure with3m simplification tolerance. Mask and curtain must consume the same support ring or half the road hangs beyond the cliff. Forty metres allows the modestly widened carriageways and a visible shoulder of ground beyond the outer edge.

| BNG extent | Source ring | Support ring,40m |
|---|---:|---:|
| Minimum easting |501527.487|501487.475|
| Maximum easting |558869.397|558909.404|
| Minimum northing |152432.204|152392.183|
| Maximum northing |203333.024|203373.070|

**Terrain dependency:** the old documented terrain southern edge is northing155000, which does not cover this real orbital alignment. Root/vertical team must supply genuine source coverage through the full support bounds plus interpolation-cell margin before final validation. Merely enlarging the mask cannot invent the missing terrain. Airport-boundary evidence in the project motorway directory proves all seven airport centres and every runway vertex inside the new ring, including Stapleford; the old proxy failed Stapleford.

## Sources and road construction

The archived Overpass response contains1197 OSM ways, selected by M25/A282 ref across motorway, trunk and link classes, with node IDs, coordinates and original tags. A282 is a trunk road, so a motorway-only filter would omit it. `scripts/prepare-m25-motorway.mjs /absolute/path/to/m25-a282-osm.json` prunes dead-end spurs and traces closed directed circuits through shared OSM nodes. It never bridges a missing link by a geographic chord. Eight genuine branch variants remain, all190.5–190.9km long. Their union has819 distinct mapped ways, each drawn once. Node-continuity checks require every join to be exact after projection.

The OSM source/licence/timestamp and per-way source IDs are in `src/m25-motorway-data.json`. Retain © OpenStreetMap contributors attribution and [ODbL source credit](https://www.openstreetmap.org/copyright) on the existing attribution surface. The mask uses the maximum-enclosure clockwise circuit. Traffic selects one clockwise path plus one for each real northbound Dartford bore; common anticlockwise sections split/stagger the density instead of doubling a queue.

[National Highways identifies A282 as the M25 closure](https://nationalhighways.co.uk/media/5tuiduey/dartford-free-flow-charging-seven-year-post-opening-evaluation.pdf). Its [crossing maintenance reference](https://nationalhighways.co.uk/roads-and-travel/road-projects/south-east/a282-dartford-crossing-maintenance-and-repairs/) confirms southbound QEII bridge and two northbound tunnels. Those actual mapped alignments are retained. Bell Common and Holmesdale also retain their mapped tunnel flags.

Each carriageway is built on its own mapped centreline. Width uses source lane count,3.5m authored lane width plus2.4m shoulder allowance, exaggerated1.18×. Road points are densified to no more than12m. Ground is sampled at centre and both pavement edges; the deck clears the maximum. Each embankment foot uses its own retained edge elevation, including final way endpoints, and pivots there when Structure changes. This prevents a downhill foundation from hanging at the uphill deck datum. Lane marks, two edge stripes, barrier top/side faces, and embankment foundations are batched by material. Tagged bridges get raised approach profiles and piers; tunnels receive smooth portal-to-portal underground profiles rather than a second road drawn on the surface.

Vertical road profiles are illustrative, explicitly **not surveyed elevations**: ordinary bridge lift6m with110m approach transitions; ordinary tunnel depression6m below an interpolated portal datum; Dartford centre floor approximated25m below the app's river datum. QEII's default54m clearance/86m pylon proportions preserve the existing curated bridge's visual datum, rather than presenting a new factual clearance measurement. Pylons are placed450m apart, supported by the [original Structural Engineering International paper](https://www.tandfonline.com/doi/abs/10.2749/101686692780616067). Bridge approaches join the mapped2907m OSM road segment smoothly. Hovers omit these illustrative vertical dimensions.

## Traffic and verification

Traffic is illustrative congestion, not current conditions. Cars use separate body, blue body, roof and tyre instance batches, without instance colours. Default13622cars are distributed into slowly moving clusters at2.5m/s, about9km/h. Lane choice remains within mapped source carriageways and travel direction follows one-way source order. Both northbound tunnel variants have staggered phases.

Simulation phase advances for every vehicle, regardless of detail level or camera position. There is no distance coverage cutoff. Matrix updates run every third frame; a paused simulation with unchanged camera matrices, lens and viewport performs no upload. Near cars keep body colour, roof and tyre geometry in compact instance prefixes. Alternate-colour slots are no longer submitted as tiny hidden boxes.

Far vehicles each use one oriented two-triangle silhouette. Detail is selected from a conservative native-pixel diameter using the actual camera view/projection matrices, including Master, lens and pitch. Native viewport size is independent of the adaptive rendering scale. Below2.5px a car becomes a silhouette; it returns to full detail above3.5px. The hysteresis band prevents repeated switching at the threshold. Rectangles face the view and follow the projected source-road heading, while their centres retain the exact canonical lane position and phase. Both body colours are retained, without instance colours. This affects vehicle detail only, never road geometry, source coverage, or the renderer's quality settings.

`userData.vehicleAt(id)` returns current canonical lane position, source road/route, lane, distance and stable identity. Each traffic mesh exposes `userData.vehicleIds` with the active prefix defined by `mesh.count`, plus `lod` and `routeId`. Body/blue/farBody/farBlue prefixes partition all13622vehicles exactly once; roof/tyre prefixes repeat the near identities. `userData.trafficLod` reports near/far counts, submitted traffic triangles, active draw calls, last update CPU cost and thresholds. `stats.drawCalls` reports active component batches; `allocatedDrawCalls` includes currently empty near/far batches.

At the captured overview, all13622vehicles use27244triangles instead of653856, a95.8% reduction. Static road details remain938636triangles on the preceding terrain snapshot, with small changes possible after sourced terrain refinements. Node CPU sampling on the updated terrain measured overview active-update median1.73ms compared with3.22ms before, and0.74ms averaged over90frame calls compared with1.17ms. These are CPU diagnostics, not a GPU frame-rate promise. Close views retain detailed vehicles and the final native-DPR2 manual/automatic comparisons remain required.

Eleven Node-only Playwright checks cover exact source joins, both bores, credible circuit lengths, simple support polygon, all road/airport vertices enclosed, finite/batched geometry, terrain clearance away from tunnels, slow progression, pause/distant phase/loop seam, structure roundtrip, actual foundation support on a sloping analytic terrain at Structure1x/5x, and absence of per-frame terrain queries. Run `npx playwright test tests/m25-motorway.spec.js`.

Still required from the independent integrated review: full source terrain coverage; same support boundary across live/baked mask, curtain and geology; removal of duplicate old road/QEII/Runnymede meshes after success; oblique motorway/crossing captures at1x/5x Structure and low/high Master; visible traffic in both directions, pause/speed, and real-GPU comparison against the accepted build. The earlier integrated candidate has completed GPU review; this LOD revision awaits the next exclusive capture slot.

Shared source-node endpoints reconcile the clearance required by every adjoining ordinary road width and tangent. Rendered roads and traffic receive the same final profile; the regression checks every ordinary edge at structure 1x and 5x, shared endpoint continuity, and traffic/deck agreement.

Ordinary road strips now sample the centre and transverse quarter/edge positions at longitudinal quarter points. A measured interior ridge above the endpoint envelope by more than0.05 canonical scene metres triggers local bisection, bounded at six levels from the existing12m maximum segment. At that limit only the measured residual raises that short segment’s endpoint envelope. Actual edge foot samples remain fixed and the refined samples enter both road and traffic routes before profile generation. No uniform road lift or per-frame terrain queries are introduced. Diagnostics report `adaptiveSamples` and `maximumClearanceAdjustmentY`. The interior-ridge regression checks32 longitudinal fractions and five transverse positions at structure1x and5x.
