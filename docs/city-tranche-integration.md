# City tranche integration

All six changes meet in `src/main.js`: the compact schematic Tube map, whole-scene Master height, sourced Stratford terrain correction, mapped DLR profiles, nine airport models and sourced M25/A282 motorway. Component source and modelling limitations remain documented in `mini-map.md`, `vertical-scale.md`, `dlr-profile.md`, `airports.md` and `m25-motorway.md`. GPU acceptance is pending the coordinated final bake and browser review.

## Height and camera contract

Geometry and physical queries remain canonical VE5. Master ranges 1–10, default5, and modifies the paired camera view matrices through `createVerticalScaleController`. It applies a displayed vertical ratio `Master / 5` to the entire scene, including objects added later. Camera position, quaternion, flight, picking results and physical depth/altitude values stay canonical. Structure remains a separate 1–5 control, default5, applied around each structure's terrain/water base. Its component argument is `Structure / 5`.

Effective structure dimensions are therefore `real metres × Master × Structure / 5`. Defaults5/5 show5× structure height; Master1/Structure1 show0.2×; Master5/Structure1 show real structure height. The live hint beneath the controls states the actual compounded factor. An integration test measures the87m Heathrow tower at17.4 displayed metres for1/1. Master is persisted as `masterHeight` and the `mh` query parameter. Reset restores5 and removes height/lens/time/horizontal query overrides. `?buildings=baked&mh=...` preserves the cinematic opening.

The mini-map consumes the final camera matrices after each camera update. Its cone unprojects actual left/right horizontal screen rays, with pitch, lens shifts and nonrigid Master view accounted for. Its cache includes every matrix/projection component it consumes. A near-vertical view displays the position ring without an unstable cone. A continuous, regularised geographic-to-schematic transform moves between stations; the diagram and marker use the same transform. Outside coverage is explicitly indicated. It does not use nearest-station snapping or render geographic rail geometry.

`Copy link` now serialises canonical `view=x,y,z,targetX,targetY,targetZ` plus the existing rendering/scale settings. All six pose values must be finite, within±1,000,000 and describe a nonzero direction. Invalid data leaves the camera unchanged. A valid pose restores after intro handling and is suitable for exact qualitative review links. `__ug.getShareUrl()` returns that URL.

## Coordinate and source bounds

`src/coordinates.js` is the one shared scene origin: WGS84 Trafalgar datum51.5074,-0.1278 projected to BNG E530028.7469586737/N180380.09351556934. BNG source adapters use `x = E − originE`, `z = originN − N`. This corrects the former fixed E530000/N180400 translation rather than shifting already correct data a second time.

| Input/consumer | Conversion |
|---|---|
| TfL latitude/longitude, DLR graph, mini-map station anchors | `main.llToXZ` projects to BNG relative to shared origin |
| Terrain source raster | BNG bounds and shared origin, exact rendered-triangle sampler |
| Thames volume, carve, corridor mask, depth profile, named zones, audio emitters | Each source BNG point converted once using shared origin |
| Curated Thames bridges and Overground | BNG converted once with shared origin |
| M25 mask, distance field, cliff curtain, waterfalls, chalk boundary | Same approved40m support ring converted once |
| Airport/motorway compiled geometry, surface tiles and retained landmark polygons | Already canonical XZ; no additional translation |
| Ground atlas | Retains source tile `sceneBBox`; shader subregion comes from loaded terrain bounds |

`getTerrainBounds()` supplies the actual render bounds to chalk geometry and surface/mask UV adapters. The source terrain began as70×50km, BNG E490000..560000/N155000..205000. The genuine southern DTM extension gives effective N151093.75..205000,513×553 rendered vertices and70×53.90625km extent. The original grid spacing is preserved. The separately sourced2km Stratford patch replaces the roof-contaminated DSM samples; verified bare-earth patches for all nine airport campuses are included through the required `airport-dtm.json` asset. Source hashes and attribution are retained in terrain metadata and copied into building bake metadata.

The ground atlas is not stretched over this extension: `ground.bin` carries its source scene bounds, `loadBakedGround` verifies those bounds against the tile manifest, and `sceneBBoxToUVBounds` places that exact region within the enlarged terrain. An independent inverse test recovers all original atlas bounds. Rebuild the ground atlas because the shared Thames mask origin changed, not to invent missing southern tile coverage. The terrain source outside validated patches remains the documented Copernicus DSM; source datum limitations are recorded in project `vertical/southern-extension.md`.

## DLR and transport lifecycle

DLR initial branches use the mapped graph and branch-specific platform positions. Source platform nodes resolve TfL entrance-coordinate ambiguity at Bank, Greenwich and the separate Stratford branches. Dense rail samples carry signed ground-relative profile metadata; only returned station indices become train stops. Terrain resnapping refreshes the adapter once, skips the generic Tube depth/river-clamp path and updates platform markers from their original graph nodes. Real tunnels remain underground. Only underground DLR platforms register shafts. DLR hover states above/below ground with “modelled”, and no longer presents the default18m Tube estimate.

Structure changes re-evaluate positive DLR clearances while retaining negative tunnel/cutting depth. Existing DLR train objects retain phase, dwell and identity while their curves and station parameters update. Master never changes these physical values. Marker bounds update after resnapping.

The motorway initialises only after final terrain. `update(paused ? 0 : dt * timeScale, camera)` receives one simulation-time multiplier, shared with Overground. Structure updates its geometry through the component setter; Master acts through the camera. Its slow traffic is modelled, not live traffic. The sourced M25/A282 ring has an approved40m support margin, including Stapleford and the southernmost road. Public `m25.json` stores both exact source points and the component's repaired support points. Mask, physical curtain, chalk rim, waterfalls, inside/outside queries and bake all consume the same support boundary.

Curated `qe2` and `runnymede` bridge groups are hidden only after motorway construction succeeds, including the case where bridges load later. On motorway failure the prior ring and curated bridges remain. Motorway hover names the mapped motorway and modelled profile without presenting inferred dimensions as survey facts.

## Airport suppression and failure behaviour

Airports initialise after terrain and before live/baked building ingestion. Suppression uses one shared pure predicate in `airport-suppression.js`, based on replaced footprint polygons, source IDs and the bounded tower guard. It runs before generic-building dedup and landmark-neighbour retention. Coincident source footprints also match within3m in both directions with area agreement, covering integer-rounded concave polygons whose centres lie in courtyards. There is no broad campus or bounding-box clearing. Airport groups, including static aircraft, persist across live/baked switches.

The building compiler records a SHA256 suppression signature and payload hash in companion metadata. Runtime verifies metadata/header counts, hash and active airport signature. A bake with airport holes cannot activate if airport construction failed or source footprints differ. Failure uses the existing live-building path with its original generic buildings visible. Old unsuppressed payloads lack source footprints and cannot prove courtyard-centre exclusion. With active airports they are rejected in favour of the live path; with failed airport initialisation they remain usable as generic-building fallback. The suppression signature includes algorithm version2. Face indices are preserved through picking to the airport resolver; only supported tower heights are shown, and other modelled heights are omitted from factual hover fields.

## Validation and coordinated run

Browser-free checks completed:22 tests across mini-map, master, DLR and integration pass. These include bounded transform continuity/no folds, unprojected cone direction, lens-shift cache invalidation, master raycasting, airport live/baked predicate parity, failed/mismatched suppression metadata, real source coordinate consistency, support-ring parity and atlas bounds. Component owners separately verify terrain, airports and motorway. Syntax checks pass for main and bake scripts. An accidental browser selection was interrupted and is excluded from acceptance.

After the final source freeze, run from the repo, in order:

```sh
npm run bake
npm run bake:verify
npm run bake:ground
npm run build
```

The first command updates `buildings.bin`, `meta.json` and `landmark-footprints.json` using the shared corrected terrain sampler. Ground bake updates `ground.bin`/`ground-meta.json`. No surface source tiles need a second coordinate shift. Do not evaluate stale baked data against new terrain.

Browser-free regression command:

```sh
npx playwright test tests/mini-map.spec.js tests/vertical-scale.spec.js tests/dlr-profile.spec.js tests/city-tranche-integration.spec.js --workers=1 --grep-invert integrated
```

Under the root's exclusive GPU slot, with all writers paused:

```sh
npx playwright test tests/mini-map.spec.js tests/city-tranche-integration.spec.js --workers=1 --grep integrated
```

Then existing opening/render-settings, readout, hover, bridges, Overground-grade and structure-rail-refinement specs are the relevant regression surfaces. The root coordinates exact selection and capture order to avoid competing WebGL contexts. `scripts/capture-city-tranche.mjs` belongs to the independent capture worker and emits exact review URLs with images. Required views include the opening, Stratford/East India, Heathrow/nine airports, M25/Dartford/southern terrain support, master1/5/10, Structure1/5, and the compact mini-map at desktop and supported landscape mobile sizes. Existing portrait landscape-lock behaviour is preserved.


## Final detail and dock follow-up

Motorway traffic now uses projected-size near/far detail with hysteresis, compact instance prefixes and stable vehicle identities. Every vehicle remains represented, including both northbound bores. The overview traffic submission drops from653856triangles to27244. Main still supplies simulation dt once; no renderer quality floor or source road geometry changes. See `m25-motorway.md` for diagnostics and independent partition checks.

Airport coverage now includes the sourced Kenley glider field and Damyns Hall, bringing the component to nine sites. Integration assertions read the actual airport data count. Changed airport source data and suppression signatures require the final bake.

The City overlay attaches a separate canonical dock-water group and installs exact wet-polygon terrain masks after the M25 shader hooks, on both top and underside. It preserves canonical source terrain and does not invent bathymetry. The independent Structure setting leaves dock-water vertices fixed; Master applies through the scene view. Picking identifies the named dock and its published4.26m AOD reference level, explicitly not a live measurement. Inside those wet polygons, the altimeter uses the physical reference level, excluding the visual water separation lift, and submerged detection uses the rendered water plane. The existing Thames interior shell remains Thames-only. Failed dock construction leaves the original terrain visible. Component data and provenance are documented by the airport owner.


The legacy canal dataset also contains10m centreline ribbons through the docks. When dock water is attached, those canal materials receive the same exact wet-polygon mask, chained after their water shading. Picking mirrors that mask at the actual canal intersection: it drops canal hits inside active dock polygons only. This avoids the older canal priority stealing the dock name even where the ribbon lies below the water surface, while preserving every outside connecting segment and hover. Failed dock construction leaves canal rendering/picking unchanged. The dock-specific material is opaque to prevent exposed chalk beneath the visual terrain mask from tinting the water grey; shared river/canal/reservoir defaults are unchanged.
