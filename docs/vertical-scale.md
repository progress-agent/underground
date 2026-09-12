# Master height integration contract

`createVerticalScaleController({camera,value:5})` from `src/vertical-scale.js` installs one camera transform. Range 1–10, default 5, independently adjustable from Structure height. All existing and future geometry, world queries, camera positions and OrbitControls targets remain in the application's canonical VE5 coordinates. Do not multiply terrain, depth data, water, airports, vehicles or structure heights by this controller's ratio.

Root integration:

1. Construct once after the main PerspectiveCamera exists, before its first render. Pass initial `mh` URL/persisted `masterHeight` value, default 5. Expose controller as `window.__ug.masterHeight` for integration tests.
2. Add Master height beside Structure height. On input, call `masterHeight.setValue(Number(input.value))`, update output from the returned/clamped value, save preferences and clear hover. On change, write `mh` unless default. Preserve the existing focused-control keyboard guard. Reset must clear the preference/URL and restore 5.
3. Keep `sim.verticalScale`, `VERTICAL_EXAGGERATION`, `TERRAIN_CONFIG.verticalExaggeration`, structure controller and every physical height/depth sampler at existing canonical values. No geometry rebuild or callback registration is needed; new/late-loaded layers inherit the camera transform exactly once.
4. Existing `camera.updateMatrixWorld(true)` after movement, renderer matrix refreshes, station labels' `.project(camera)` and `Raycaster.setFromCamera` all use the same paired matrices. Do not replace the main camera after installing without disposing/reinstalling the controller. Camera world/projection matrix inverses must remain paired. The controller supports PerspectiveCamera and OrthographicCamera.
5. Physical HUD altitude remains `(camera.position.y - canonicalSurfaceY)/5`, with existing water/chalk/underground predicates. Ray hit points remain canonical, so tooltip metres and x/z data lookup remain unchanged. Audio positions stay physical canonical positions. Mini-map uses canonical position and horizontal forward; no master scaling belongs in its geography.

The view is `R_display^-1 * S_y(master/5) * T(-cameraPosition)`. Display rotation is formed from the canonical camera forward/up vectors after scaling; this keeps the OrbitControls target and W-flight direction centred at any pitch. It is mathematically equivalent to scaling world geometry and camera altitude about Ordnance Datum while aiming at the correspondingly scaled target. Neither camera pose nor geometry is actually rewritten.

`camera.matrixWorld` is the inverse display view, intentionally non-rigid. `.project()`, `.unproject()`, frustum culling and raycasting therefore agree. Camera `.position`, `.quaternion` and `.matrix` remain canonical, as do `.getWorldPosition()` and the centre-ray `.getWorldDirection()`. Do not decompose the display `matrixWorld` to derive a physical camera quaternion/scale; use canonical `.quaternion` or controller-free pose objects. Picking thresholds and ray distances remain canonical metres/scene units, preserving existing hit tolerances. Raw THREE.Sprite billboards that assume rigid view matrices need a visual check; current station labels are projected HTML, and all authored geometry follows model-view matrices.

`setValue` rejects non-finite values and clamps positive bounds, ensuring no singular view. Repeated renderer updates start from saved canonical matrices, preventing cumulative scaling. `dispose()` restores original camera methods and matrices. A duplicate controller is rejected.

## History and verification

Historical slider added in 1680b1a modified only `sim.verticalScale` for tube depths; it was removed in c9e2962. It cannot cover the current terrain, water and independent structure systems. The new controller applies globally while retaining their two physical datums.

Five browser-free Playwright cases pass: combined pitch/master cases and transitions, explicit scaled-scene projection equivalence, perspective/orthographic ray hits, independent structure scale, manual/repeated matrix refreshes, input bounds and exact default/restoration. GPU integration acceptance remains required: ±60° flight, pointer hover, opening, labels, water/near clipping, sky/fog, live/baked swaps, new airport/motorway layers and mini-map cone. Passing matrix checks does not substitute for those rendered checks.
