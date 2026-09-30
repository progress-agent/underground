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

- `branches[]`: corridors this line **owns** (draws). `points` are `[lon, lat]`; `segments` are `{i0, i1, class}` per source segment (segment *i* joins points *i* and *i+1*), classes `surface`, `tunnel`, `viaduct`, `cutting`, `embankment`, exactly as `overground.json`.
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
- **DLR**: the shared DLR profile (`src/dlr-profile.js`) now takes the deck measured from the EA LiDAR: last-return DSM 1 m deck minus DTM 1 m ground, sampled every 3 m along each elevated or embankment edge and filtered along the track (a railway deck cannot climb faster than about 6%, so what rises abruptly above it, such as the roofs at Canary Wharf, Heron Quays and Tower Gateway, a train or a gantry, is removed). Every consumer of the profile (the line, trains, markers, shafts, hover and this railway) takes the same deck. Sources per node: `lidar` (measured, `surveyed: true`), `interpolated` (under something standing over the track, taken between the measured deck either side, flagged), `fallback` (the illustrative class estimate, 8 m or 3 m, flagged). On the current data: 1,499 of 1,659 elevated nodes measured (median 7.0 m), 160 interpolated, none on the fallback.
- **Where the DLR railway and the profile differ, by design:** the profile sinks cuttings and portal approaches below ground (3 m, ramping to 30 m at 6%); the surface railway draws every non-tunnel sample at least 1 m above the terrain (D-024: only a tunnel may sit below ground), so a cutting reads as track at grade between dark bands.

## Renderer

- One top-level group per line, `surface-rail-<line>` (never `line:`; D-040's cull hides `line:*` from above-ground cameras). Victoria and Waterloo & City have none (wholly in tunnel).
- Tunnels are skipped; the open runs either side stop at the portal.
- Meshes per line: `stripe`, `ballast`, `masonry` (viaduct deck and piers), `earth` (embankment skirts), `cutShadow`, and `band` (this line's colour on another line's track, 0.4 above the stripe with a polygon offset). `userData.type` is `surface-rail`; the hover picker includes them.
- Station markers: one `surfaceOnly` layer per line with open-air stops, registered as `surface:<line>` beside the line layers; one marker per station across lines.
- No per-instance colour (D-015): each line has its own materials; markers are uniform instances.

## Known gaps (source data, v2)

- **Metropolitan**: the v2 delivery has no Uxbridge branch. Rayners Lane to Uxbridge is drawn (the Piccadilly's track, with a Metropolitan band inferred from TfL stops); Harrow-on-the-Hill to Rayners Lane is not drawn.
- **Central**: no Ealing Broadway branch (North Acton to Ealing Broadway) and no Hainault loop (Leytonstone to Woodford via Newbury Park and Hainault) in v2.
- **Tower Gateway**: the terminus canopy reads as the deck for the last 80 m (a roof at the end of the line has no deck beyond it to bridge from).
- **Overground viaducts**: `overground.js` has never drawn its viaduct decks or piers: the masonry list mixes indexed pier boxes with non-indexed strips, `mergeGeometries` refuses it and returns null (the baseline's `mergeGeometries` console errors). The Tube and DLR normalise their geometry before merging; the Overground is left as it is, since this sprint keeps it pixel-identical.
