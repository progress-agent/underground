# Surface trains: the Tube and DLR trains on the open-air track

Sprint 30Sep26w, D-041 item 2, Lane T. Jordan, 30Sep26w: the open-air Tube and DLR are drawn exactly like the Overground, trains included. Built on Lane R's surface railway (`docs/tube-surface-rail.md`).

## Files

| File | What it is |
|---|---|
| `src/surface-train-map.js` | The mapping from the underground timetable to the open-air track; the rolling-stock table and the three profile geometries. Pure functions, unit-tested in node. |
| `src/surface-trains.js` | The renderer: track networks built from Lane R's paths, one mapping per curve, the instanced cars. |
| `src/main.js` (`s30:T` blocks) | Created once the surface railway exists; updated each frame right after `updateTrains`; follows Master with the other structures; `window.__ug.surfaceTrains`. |
| `scripts/capture-surface-trains.mjs` | Reproduces the lane's captures (it seeks the simulation time for each shot). |
| `tests/surface-trains.test.mjs`, `tests/surface-trains.spec.js` | Unit and browser checks. |

## The same trains as the timetable

Every surface train is a tube train of `trains.js` (`trainSystem.allTrains`): its place is `trainStateAt(ud, simT)`, a parameter `u` along the train's curve, mapped onto the track. Nothing about a surface train is stored between frames, so:

- two loads at the same simulation time draw the same trains in the same places;
- a train advances while offscreen, and the shared pause and speed apply (the clock is `trainSystem.simTime`, which `updateTrains` advances by the frame's elapsed time times the speed, and not at all when paused);
- a train leaving a portal carries on along the surface, and one entering a tunnel carries on in its bore.

A car is drawn only where its centre is on open track (the drawn track's own class); in a tunnel the underground train, in its `line:` group, is the one drawn.

## The mapping

### Tube lines: from the station-chord curve to the track

A Tube train's curve is a CatmullRom through the line's **stations** (the same curve as the bores). Between two stations it is a smooth chord, not the railway; on the open-air Metropolitan it cuts a bend by up to about 850 m. The track is Lane R's surface railway, which for every line covers the whole route, tunnels included (Central's main corridor alone is 4,293 samples, about 51 km).

1. **Anchors.** Each stop of the timetable (`stationUs`) finds its control point by its share of the polyline length (the formula `main.js` uses to make it), and that control point is one of the line's TfL stops within 60 m. The stop list is not one per control point where a branch carries `_stationIndices` (the District's two Fulham bridge points on the Wimbledon branch; matching by index there anchored each stop at the station before it, found and fixed during the build and held by a unit test).
2. **Track between stations.** Each station is placed on the line's track network (the nearest node within 300 m), and consecutive stations are joined by the shortest route over it (A*). The network is the line's own corridors plus every stretch of another line's corridor, Tube or Overground, its colour is laid on as a shared-track band; corridor pieces join end to nearest node within 60 m (the twin collapse leaves junction gaps up to about 32 m). A route outside 0.6 to 1.6 times the chord (plus 300 m), or wholly in tunnel, is refused.
3. **Progress.** Between two anchors a train's progress along the route is linear in `u`, so it runs at constant speed between stations and dwells exactly at each station's place on the track.
4. **Portals.** Every change between tunnel and open track along a route adds an anchor at the chord's point nearest the portal, so the along-track part of the jump at a portal is zero by construction.

Runs (chains of mapped intervals) ending at a station on open track are extended by 80 m, so a train dwelling at a terminus is drawn whole: along the drawn track while it carries on, straight on for whatever is left (a straight extension alone put dwelling Central and Metropolitan cars off a curving track).

### DLR: snapping the profile's curve

The DLR's curve is not a chord: it is built from the DLR profile (`dlr-profile.js buildBranch`), which follows the mapped track node by node and stands on the measured decks. Each curve is sampled every 10 m and each sample snapped to the nearest drawn DLR track within 35 m (its own corridors and its shared-track bands), in three dimensions, so at a flyover the train stays on the deck its curve is on, preferring the piece it was already on. Two refusals, both found while testing: a snap clamped onto a segment's end is taken only within 10 m (past the end of a drawn piece every sample piled onto its end point, so near Pudding Mill Lane, where Lane R draws 160 m of at-grade track nowhere, a train halted and then leapt about 44 m), and a snap more than 8 m above or below the curve is refused (at Tower Gateway a viaduct sample landed on the Bank branch's tunnel beside it, blinking a car off). Where nothing is drawn within reach the curve point itself is used, at least 1 m above the terrain (D-024): 120 of 7,616 samples.

### Error bound

Plan distance between the underground train (on its curve) and the surface train (on the track, its lane included) at the same moment, measured over every curve of the app on 01Oct26h (bundled route data):

| | At a portal (max) | Anywhere on open track (max) |
|---|---|---|
| Tube | 490 m (Metropolitan; per-line p95 99 to 413 m) | 848 m (Metropolitan, the Chesham branch's 6 km curve; per-line p95 80 to 643 m) |
| DLR | 20 m | 40 m |

The pinned bounds (`PORTAL_ERROR_BOUND_M`, `TRACK_ERROR_BOUND_M` in `src/surface-train-map.js`) are 500 m and 900 m for the Tube, 25 m and 45 m for the DLR; `tests/surface-trains.spec.js` holds the portal bound at every portal of the app, and the renderer's pre-cull relies on the track bound.

For the Tube the portal figure is the chord curve's own distance from the tunnel mouth: the underground train is on the chord, so no mapping onto the drawn track can remove it. From above ground it never shows, because only the surface train is drawn there (D-040). From below ground both are drawn: the underground train runs on in its bore while its surface twin runs on the track. Moving the underground trains onto the real alignment would mean redrawing the bores, which is outside this lane.

Per line (portal max / open-track p95 / open-track max, metres): Bakerloo 114 / 80 / 187; Central 271 / 168 / 281; Circle 171 / 94 / 303; District 451 / 348 / 633; Hammersmith & City 143 / 447 / 636; Jubilee 142 / 445 / 705; Metropolitan 490 / 643 / 847; Northern 254 / 155 / 275; Piccadilly 343 / 286 / 459; DLR 20 / 21 / 40.

### Shared track

Both operators' trains run on shared track: the Tube line's trains are routed over the owner's corridor (the network includes every band its colour is on), so the Bakerloo runs on the Lioness's track to Harrow and the District on the Mildmay's to Richmond, alongside the Overground's own trains, which are untouched.

Lanes. Every train runs in the Overground's lanes, 2.6 m either side of the corridor's centreline, left-hand running. On the Overground's corridors the Tube line keeps those lanes: there the two operators really share the rails. Lane R draws track two Tube lines share as one corridor too, and there the lines are often separate pairs of a four-track railway (the Metropolitan beside the Jubilee, the District beside the Piccadilly, the DLR beside the Jubilee to Stratford): each line after the corridor's owner runs 3.4 m further out per band, easing in and out at 1 in 15 beyond the band's ends, so no car jumps sideways. Found while capturing: in the same lanes, a Metropolitan and a Jubilee train side by side were drawn as one.

## Rolling stock

Sources: the Wikipedia infoboxes for each stock (retrieved 01Oct26h). Dimensions over couplers; width over body; height rail to roof.

| Lines | Stock | Profile | Cars | Train (m) | Width (m) | Height (m) |
|---|---|---|---|---|---|---|
| Metropolitan | S8 | sub-surface | 8 (2 x 18.139 + 6 x 16.234) | 133.682 | 2.92 | 3.68 * |
| District, Circle, Hammersmith & City | S7 | sub-surface | 7 (2 x 18.139 + 5 x 16.234) | 117.448 | 2.92 | 3.68 * |
| Bakerloo | 1972 | deep tube | 7 | 113.552 | 2.641 | 2.875 |
| Central | 1992 | deep tube | 8 x 16.25 | 130 | 2.62 | 2.87 |
| Waterloo & City | 1992 | deep tube | 4 x 16.25 | 65 | 2.62 | 2.87 |
| Jubilee | 1996 | deep tube | 7 | 126.492 | 2.629 | 2.875 |
| Northern | 1995 | deep tube | 6 | 108.472 | 2.630 | 2.875 |
| Piccadilly | 1973 | deep tube | 6 | 106.810 | 2.629 | 2.888 |
| DLR | B07 | DLR | 3 units x 2 articulated sections | 84 (3 x 28) | 2.65 | 3.51 |

\* The S Stock infobox gives no height; 3.68 m is the sub-surface loading gauge height of the C69/C77 Stock it replaced on the same lines.

Cars are spaced evenly over the train's length with 0.6 m between bodies (the S Stock keeps its longer driving cars). The Victoria (2009 Stock) and the Waterloo & City have no open air, so no surface trains.

Three profiles, each a cross-section extruded along the car: **deep tube** (sides curving in to the roof to fit a 3.56 m bore), **sub-surface** (full-height straight sides, rounded cant rail) and **DLR**. Each line's stock is its profile scaled by its exact width, height and car length in the instance matrix (at most 1%; scale is not colour).

## Drawing

- In the Overground trains' style (`overground-trains.js`): instanced bodies, roofs and windows in the Overground's own materials (body and roof in its light grey, Jordan 23Sep26w; line identity stays on the track stripe).
- One InstancedMesh per profile and part, body (with its roof, which shares the body's grey, so one geometry and the body's material) and windows: six at most, and a mesh with no live cars is not drawn. No per-instance colour (D-015): variants are separate meshes.
- True proportions (D-039): each car's matrix is `trueHeadingBasis` at the rail morph's structure scale, aimed along the displayed track, so a car is its real size and shape at every Master, and it stands on the rail as the rail is morphed (the same rate-limited morph as the Overground and the surface railway).
- On a cross-slope: the rail morph pivots each vertex on the terrain under that vertex, so at a high Master the stripe follows the ground's slope across the track. A car in its lane (2.6 m off the centreline) is morphed the same way, about the terrain at its lane (`computeCrossSlopes`), so it rides the stripe. Found while testing: placed at the centreline's height, a Central line car stood 1.5 m off its stripe at Master 10.
- Junction hops: within a corridor Lane R's earthwork taper holds 4%, but a route crosses from one drawn piece to another at junctions, where a ground-level piece can meet the end of a viaduct piece 8 m up (the drawn deck simply ends). A car spanning that hop stood at up to 64 degrees (the Piccadilly by Acton Town, found while capturing). A run's track lift is grade-limited to 12%, raising the lower side, as the real railway climbs on an embankment the drawn ground piece does not show. On the DLR the limit applies to the rail's absolute height instead, the quantity the profile itself grade-limits (8%): its decks stay level over dips in the ground, so a limit on their height above the ground would lift them there (it did, at Master 10, before this was caught by the tests). Cars still follow the terrain's own slope where the stripe does (up to about 16 degrees on screen on the Metropolitan's Chiltern hillsides at Master 1.1).
- Measured (01Oct26h, every car at one moment, a ray straight down onto the drawn rail; canonical units, 5 per real metre at Master 1): at Master 1.1 the surface trains' 5th to 95th percentile is -0.05 to +0.07 units, at Master 10 -0.07 to +0.24 (within 0.5 m real). Five of 1,712 cars stood more than 2 units off at Master 1.1, all at junction throats where Lane R's drawn corridors do not meet: the DLR at Tower Gateway (the curve rides the Bank branch's lower ramp for about 40 m before the drawn Tower Gateway viaduct begins), at the start of the Canning Town flyover, on the West India Quay flyover's ramp (the ramp and flyover pieces end at different heights) and on the Beckton branch, and the District over the Gunnersbury join (nothing drawn under the 60 m hop). At Master 10 one more: a DLR train near South Quay follows its own curve on a lower track that the drawn railway does not have there, under the deck above it (at Master 1.1 the snap had put it on that deck). The Overground's own trains (`overground-trains.js`, untouched by this sprint) are placed at the centreline's height: at Master 10 their 5th to 95th percentile is -0.76 to +0.65 units (about 1.5 m real either way), at Master 1.1 -0.1 to +0.76. Reported, not changed (the Overground must stay as it is this sprint).
- One top-level group, `surface-trains`, never `line:`: D-040's cull leaves it drawn above ground and keeps hiding the underground trains in their `line:` groups.
- Economies, always on and none of them changing a pixel: live cars written to the front of each mesh and only that range uploaded; trains more than 12 km away in plan are not written (the Overground's distance cull), nor trains whose bounding sphere is outside the camera's frustum; a train is first tested at its underground position, which is within the error bound of its surface one, so most trains cost no mapping work at all; a hidden layer or line writes nothing.
- Cost (M2 Max, indicative, other lanes on the GPU): the per-frame update takes 0.03 to 0.10 ms at the five standard views at full CPU. At the weak-machine setup (4x CPU throttle, DPR 1), an in-page A/B at the street view, quality pinned with shadows on, put the whole lane at about 0.9 ms a frame (16.7 to 17.6 ms; about 0.2 ms the draws, the rest the update, which places about 35 trains and 210 cars there each frame), and about 0.1 ms at the river view. The street view sits close to Automatic's 19 ms shadow line, so on the weak setup Automatic drops shadows there more often than on Lane R's head; every view stays well above the 30 fps bar. Reductions made for it: body and roof merged (nine draws to six), one run sample per car, a segment search that starts from the previous car's.
- Mappings are built lazily, at most 6 ms of them per frame (about 75 ms for all 110 curves on the M2 Max), and rebuilt when a curve is (a resnap, or the DLR at a Master change); while a curve's new mapping waits, its train keeps its last one.
