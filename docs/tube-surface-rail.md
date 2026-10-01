# Open-air Tube and DLR as surface railway

Sprint 30Sep26w, D-041 item 2, Lane R. Jordan (27Sep26u): the DLR, much of it elevated, drawn at its real height, and the open-air stretches of the Tube lines drawn like the Overground. Ruled 30Sep26w: exactly like the Overground, stripe included; shared track drawn once with each line's colour side by side; below-ground sections keep the underground look and stay hidden from above ground. The Elizabeth line waits for the main-line wave (item 1).

## Files

| File | What it is |
|---|---|
| `scripts/prepare-tube-surface.mjs` | Builds the dataset from the Prog v2 delivery (`Working/prog-rail-geometry-11Jul26s/v2/tube-surface-sections.json`), following `build-overground-data.py`. |
| `public/data/tube-surface.json` | The dataset (tracked). |
| `scripts/prepare-dlr-deck-heights.mjs`, `scripts/ea-lidar-wcs.mjs` | Measure the DLR's decks from the Environment Agency LiDAR over WCS (the endpoint family of `scripts/prepare-*-dtm.mjs`). Raw rasters cache in `scripts/.cache/ea-lidar-dlr/`. |
| `src/dlr-deck-heights.json` | Measured deck heights per OSM node of `src/dlr-profile-data.json` (tracked, bundled). |
| `src/surface-rail.js` | The earthworks archetype language, moved out of `overground.js` unchanged and shared. |
| `src/overground.js` | The Overground, built from `surface-rail.js`; byte-identical geometry (fingerprint in `tests/surface-rail.spec.js`). |
| `src/tube-surface-rail.js` | The Tube and DLR renderer. |

Rebuild: `node scripts/prepare-tube-surface.mjs` (reads `public/data/overground.json` for shared track, so rerun it after regenerating the Overground), and `node scripts/prepare-dlr-deck-heights.mjs` (offline once the rasters are cached).

## Dataset (`public/data/tube-surface.json`)

`lines[]`, in the order that decides who owns shared track: bakerloo, central, circle, district, hammersmith-city, jubilee, metropolitan, northern, piccadilly, victoria, waterloo-city, dlr. Ids are the app's (`hammersmith` and `waterloo` in the source are mapped).

- `branches[]`: corridors this line **owns** (draws). `points` are `[lon, lat]`; `segments` are `{i0, i1, class}` per source segment (segment *i* joins points *i* and *i+1*), classes `surface`, `tunnel`, `viaduct`, `cutting`, `embankment`, exactly as `overground.json`. A DLR branch with `source: "dlr-profile"` is raised track the v2 source lacks, taken from `src/dlr-profile-data.json` (transform 5).
- `branches[].bands[]`: `{j0, j1, lines, inferred?}`. Over this corridor's segments `j0 .. j1-1`, `lines` share the track, owner first. The renderer splits the 9 m stripe into `lines.length` side-by-side bands, owner on the left. `inferred` lists lines placed by TfL stops rather than their own OSM route (below).
- `overgroundShared[]`: bands on Overground corridors, `{overground, branch, j0, j1, lines}` with `j` indexing that branch's points in `overground.json`. The Overground draws the track; the Tube line's colour is laid beside the Overground's.
- `stations[]`: TfL stops with `surface` (the line's own nearest track within 300 m is not tunnel), `trackClass`, `railOffsetM`, and `trackInferredFrom` where the stop sits on another line's track.
- `portals[]`, per line: see below.
- `summary`: source, collapsed and drawn lengths, shared lengths by owner, covered ways opened.

### Transforms

1. **Twins.** OSM route relations carry both running tracks and every service variant as separate trails. Longest first, a stretch within 32 m (the Overground's pair rule) of kept track of the same line, parallel (within 35 degrees) and at the same level, is dropped. One centreline per corridor.
2. **Covered ways.** A tunnel run under 60 m between open track (a road overbridge: Rayners Lane, Hillingdon under the A40) is drawn as open track, and counted in `summary.coveredWaysOpened`.
3. **Shared track.** A stretch within 30 m of an Overground corridor or of an earlier line's corridor, parallel, at a compatible level, for at least 150 m, is that corridor's track. Levels: tunnel, raised, at grade; a viaduct under 200 m is a bridge and meets either. Tunnels are never shared (nothing below ground is drawn by the surface railway, and each line keeps its whole bored route). Four-track corridors (Metropolitan with Jubilee, District with Piccadilly) fall within 30 m and are drawn as one corridor with both colours: two 18 m beds would overlap.
4. **Source gap repair from TfL stops.** Where at least three of a line's stops have no own track within 300 m but lie within 150 m of one other line's drawn corridor, that corridor carries this line too. The only case: the Metropolitan's Uxbridge branch (Rayners Lane to Uxbridge) on the Piccadilly's track.
5. **The DLR's level is also its deck (fix round 2).** For the DLR alone, the level in transforms 1 and 3 is also read from the shared profile: the deck the renderer lays each point on (`dlrHeightAt`, through `sampleForSurfaceRail` in `src/dlr-profile.js`, the same choice `src/tube-surface-rail.js` makes), not only the source class.
   - *A second collapse pass that only adds.* Transform 1 runs unchanged; then every DLR stretch beside kept track in plan but on a deck more than `DLR_TWIN_DECK_TOL_M` (1.5 m) away from it there is a structure, not a twin, and is added from `DLR_MIN_DECK_PIECE_M` (30 m). Nothing kept before is moved or dropped: the 26 DLR corridors of fix round 1 are unchanged. Before, north of Canning Town the flyover over the Jubilee (OSM ways 156792940 and 694613992, decks to 8.8 m) was dropped as the other running track of the lower viaduct beside it (145452870, to 4.1 m), so its deck was drawn nowhere. The pass adds 15 such stretches, 1.9 km (`summary.deckSeparatedM`): that flyover, the flyover at West India Quay (11 m) and the ramps beside it, a 10 m viaduct beside a ramp by Royal Victoria, ramps beside the viaducts at Blackwall and East India and on the Beckton branch by Royal Albert, and short ones at Crossharbour, Heron Quays and Shadwell. A comparison at the one deck (a running track 3 to 5 m from its twin) is covered, so no second deck is drawn for it.
   - *Piers.* A DLR viaduct run shorter than the 110 m pier spacing stands on one pier at its middle (`pierShortRuns` in `buildCorridor`, which the Overground does not pass).
   - *For Lane T.* These added stretches (and the profile's) are short structures beside or over other DLR track, not through routes: a train that must run continuously is better laid on the shared profile's branches (`dlrProfile.buildBranch`), which the stretches follow at the same decks.
   - *Raised DLR is never shared.* A DLR stretch on a deck above `DLR_SHARE_MAX_DECK_M` (1.5 m) is its own, whatever the source class (the short-bridge rule and the gap fill included): an owner would draw it at the owner's height. What the DLR shares today (3.3 km with the Jubilee from Canning Town to Stratford, 0.2 km with the Mildmay at Stratford) is its at-grade track; `tests/tube-surface.test.mjs` holds that.
   - *Raised track the source lacks.* The profile's elevated and embankment edges, chained into trails, are offered to the DLR's collapse after the v2 trails, so they only add decks v2 has nowhere at that level and height: the Tower Gateway viaduct (v2 has only the Bank branch's tunnel beside it), the approach into Stratford from Pudding Mill Lane, and a ramp between Poplar and All Saints (four corridors, 548 m, `summary.fromProfileM`). At-grade profile track is not taken: where v2 and the profile disagree about a tunnel (the Beckton branch), v2 decides, as it does for every other line.
   - Result: of the 1,430 LiDAR-measured DLR decks above 1.5 m, 1,427 are drawn by the DLR's own track within the collapse's reach (32 m) at their height (before: 1,359); the other three are single nodes where ways meet. The Tube lines' data, every shared band and every portal are unchanged; Tower Gateway station is now classed open-air, on its viaduct (it was classed tunnel from the Bank branch 100 m away).

## Portals (for Lane T and the Pedestrian lane)

Per line, computed on the line's own collapsed track **before** sharing, so every line has its own even on shared track:

```
{ id: "metropolitan-3", lineId, lon, lat, e, n,          // BNG metres; scene x = e - BNG_REF_E, z = -(n - BNG_REF_N)
  branch, point,                                          // index into the line's collapsed pieces (not the drawn branches)
  bearingIntoOpenDeg,                                     // grid bearing from the tunnel into the open
  openClass,                                              // class of the open track at the mouth
  tunnelM, openM,                                         // lengths of tunnel and open track either side (m)
  minor,                                                  // tunnel < 400 m (an underpass) or open < 150 m (a daylight gap): not the mouth of a real tunnel
  nearestStation: { name, naptan, distanceM } }
```

Filter on `!minor` for the mouths of real tunnels: for example the Bakerloo at Queen's Park, the Jubilee and Metropolitan north of Finchley Road, the Northern at Golders Green, East Finchley and the Hendon tunnel, the Central at Stratford and White City, the Piccadilly at Barons Court, Hounslow West and Arnos Grove, the District and Hammersmith & City at Whitechapel and Bow Road, the DLR's Bank branch near Tower Gateway, the Lewisham branch's river tunnel between Mudchute and Greenwich, and the Woolwich branch at King George V. The sub-surface lines have many minor portals: the short open cuttings in central London.

## Heights

- **Tube lines**: the Overground's archetype lifts (surface 0, embankment 3 m, viaduct 8 m, cutting at grade, 1 m rail head), built at canonical VE5 and morphed with Master exactly as the Overground (true proportions, D-039).
- **DLR**: the shared DLR profile (`src/dlr-profile.js`) now takes the deck measured from the EA LiDAR: last-return DSM 1 m deck minus DTM 1 m ground, sampled every 3 m along each elevated or embankment edge and filtered along the track (a railway deck cannot climb faster than about 6%, so what rises abruptly above it, such as the roofs at Canary Wharf, Heron Quays and Tower Gateway, a train or a gantry, is removed). The line, trains, markers and shafts are built on the profile and stand on its decks; this railway lays each of its points on the profile too, so its decks are the same, except where listed next. Sources per node: `lidar` (measured, `surveyed: true`), `interpolated` (under something standing over the track, taken between the measured deck either side, flagged), `fallback` (the illustrative class estimate, 8 m or 3 m, flagged). On the current data: 1,499 of 1,659 elevated nodes measured (median 7.0 m), 160 interpolated, none on the fallback.
- **Where this railway draws the DLR other than the profile, by design (and the hover says so):**
  1. *Cuttings and portal approaches.* The profile sinks cuttings and portal approaches below ground (3 m, ramping to 30 m at 6%); the surface railway draws every non-tunnel sample at least 1 m above the terrain (D-024: only a tunnel may sit below ground), so a cutting reads as track at grade between dark bands.
  2. *Shared track.* The DLR's at-grade track shared with the Jubilee and the Mildmay is drawn as a band on the owner's corridor, at the owner's height (1 m rail head, or the Mildmay's cutting at grade). Raised DLR track is never shared (transform 5).
  3. *Twin running tracks.* One centreline is drawn per corridor; the other running track's nodes lie under its deck, whose height is its own (within 1.5 m of theirs, transform 5).
- **DLR heights at every Master (fix round 1):** the whole above-ground clearance is a structure drawn at true size (D-039), the profile's 1 m minimum included. Before, the minimum was not scaled with 1 / Master, so it floored every deck at Master metres: at Master 3 every deck under 3 m was drawn at 3 m, and at Master 10 only 6.9% of the measured decks were drawn at their height (now 99.9%, on flat ground). The profile's `groundRelativeM` is the height drawn, in true metres (below ground, the real depth); `deckM` is the deck under the point.
- **The hover** (`dlrHeightLabel` in `src/dlr-profile.js`, used by the DLR line, its station markers and this railway): the height it prints is the deck the point stands on, as measured (`LiDAR`) or estimated (`modelled`), at every Master; without a deck (surface, cutting, tunnel), the profile's height or depth there. Where what is drawn under the pointer departs from it by 0.05 m or more (and shows at the printed 0.1 m), it adds how high it is drawn there, for example `Elevated railway · ~10.6m above ground (LiDAR; drawn ~25.6m above the terrain here)` or `Railway cutting · ~3.0m below ground (modelled; drawn ~1.0m above the terrain here)`. Before fix round 1 it printed (y − ground) / VE, which is the deck × 1 / Master: a 7.92 m LiDAR deck read `~7.2m` at Master 1.1 and `~2.6m` at Master 3.
- **What the hover reads (fix round 2).** Before, the railway's hover sampled the profile's track nearest the pointer in plan, so it could describe a different piece of track from the one drawn under the pointer: over the DLR's band on the Jubilee north of Canning Town it read the flyover above it (`~8.8m above ground (LiDAR)` over a stripe drawn at 1.2 m), and on about 290 m of viaduct (near Bow, by East India) a neighbouring segment. Now:
  1. every merged mesh keeps, per piece, its first face and the path (or shared-track span) it was built from, so the hover hit's face names the piece of track under the pointer, and the point is read on that piece's centreline (`describe(mesh, hit, faceIndex)` in `src/tube-surface-rail.js`);
  2. on the DLR's own track the profile is read exactly as the railway laid that point (`sampleForSurfaceRail`, by the source class), and the height drawn is the geometry's there, above the terrain at the centreline, in true metres; on a band the DLR's at-grade track is read and the height drawn is the owner's;
  3. above ground (D-040's cull active) the underground layer's bores are not drawn, so where the pointer's ray meets this railway a bore it also passes through (the DLR's, on a viaduct) no longer takes the hover (`pickInfraUnderPointer`, s30:R block in `src/main.js`); the DLR line's own hover (below ground) reads the profile in three dimensions (`sample({x, z, y})`), so at a flyover it reads the deck the pointer is on.

  `tests/surface-rail.spec.js` casts a ray down at every vertex of the DLR's drawn centrelines and bands at Masters 1.1, 3 and 10 and checks the height the hover gives as drawn against the geometry under the hit; checks every measured elevated node's deck where the drawn track passes through it; and holds the Canning Town flyover, the band under it and the verifier's real-pointer positions.
- **Where the drawn DLR deck departs from the measured one.** In the app at Master 1.1, 508 of the profile's 2,538 raised nodes are drawn 0.05 m or more off their deck: 305 by more than 1 m, 156 by more than 5 m, at most 22.9 m. Three causes:
  1. *The 8% grade limit over dips in the app's terrain* (the large ones). The deck is laid on the app's terrain, and around Canary Wharf that terrain is the DSM: it rises to 26 to 32 m OD where the LiDAR DTM under the track reads 4 to 7 m. Where it drops back to street or dock level, the grade limit keeps the deck level with its neighbours on the raised terrain, so it is drawn well above the local ground: West India Quay (136 nodes more than 1 m off), Heron Quays (55), South Quay (16) and Canary Wharf (7). The measured deck there is 13 to 16 m OD (`deckOD` in `src/dlr-deck-heights.json`); drawing it at that altitude needs the terrain under Canary Wharf corrected, as the Stratford patch was, not a different deck. The terrain is landscape, so the departure grows with Master (at Master 10, 235 nodes more than 5 m off).
  2. *The 1 m minimum clearance* where the LiDAR reads the deck at grade (113 measured nodes below 1 m, for example 39 near Elverson Road): drawn at 1 m.
  3. *Portal approaches*, eased down to the tunnel mouth: 12 nodes drawn lower than their deck, 6 of them by more than 1 m near Tower Gateway.

## Renderer

- One top-level group per line, `surface-rail-<line>` (never `line:`; D-040's cull hides `line:*` from above-ground cameras). Victoria and Waterloo & City have none (wholly in tunnel).
- Tunnels are skipped; the open runs either side stop at the portal.
- Meshes per line, three draws at most: `stripe` (the line's own material, exactly the Overground's stripe), `dressing` (ballast, viaduct deck and piers, embankment skirts and cutting bands in one mesh, the Overground's four colours baked into the vertices), and `band` (this line's colour on another line's track, 0.4 above the stripe with a polygon offset). `userData.type` is `surface-rail`; the hover picker includes them. Each mesh keeps, outside `userData`, the first face and the source path of every piece merged into it (fix round 2), which is how a hover hit names the track under it.
- Cost, measured on the Mac Studio with other lanes on the GPU (indicative): 35 extra draw calls at the standard overview (644 before, +5.4%), 31 to 32 at street and river, 9 to 12 at the M25 edge and Heathrow; triangles +1 to 2%. Building takes about 200 ms of main thread at load, yielded line by line (longest task about 86 ms); a Master change morphs it in about 55 ms, rate-limited with the other structures. `scripts/capture-surface-rail.mjs` reproduces the lane's before and after frames and the Overground pixel check.
- Station markers: one `surfaceOnly` layer per line with open-air stops, registered as `surface:<line>` beside the line layers; one marker per station across lines.
- No per-instance colour (D-015): each line has its own materials; markers are uniform instances.

## Known gaps (source data, v2)

- **Metropolitan**: the v2 delivery has no Uxbridge branch. Rayners Lane to Uxbridge is drawn (the Piccadilly's track, with a Metropolitan band inferred from TfL stops); Harrow-on-the-Hill to Rayners Lane is not drawn.
- **Central**: no Ealing Broadway branch (North Acton to Ealing Broadway) and no Hainault loop (Leytonstone to Woodford via Newbury Park and Hainault) in v2.
- **Tower Gateway**: the terminus canopy reads as the deck for the last 80 m (a roof at the end of the line has no deck beyond it to bridge from). The v2 source has no Tower Gateway viaduct at all (only the Bank branch's tunnel beside it); it is drawn from the shared profile (transform 5), so this railway, the line and the station marker stand on the same, canopy-high, deck there.
- **DLR from Pudding Mill Lane into Stratford**: missing from v2 too; its raised part (147 m) is drawn from the profile, its at-grade part (OSM ways 146416314 and 147380481, about 160 m) is not drawn.
- **DLR decks drawn nowhere**: three single nodes where ways meet (21095189 and 1752783162, 170 m from Greenwich station; 242606493, 360 m from Pudding Mill Lane).
- **Overground viaducts**: `overground.js` has never drawn its viaduct decks or piers: the masonry list mixes indexed pier boxes with non-indexed strips, `mergeGeometries` refuses it and returns null (the baseline's `mergeGeometries` console errors). The Tube and DLR normalise their geometry before merging; the Overground is left as it is, since this sprint keeps it pixel-identical.
