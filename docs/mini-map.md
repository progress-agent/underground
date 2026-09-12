# Schematic Tube orientation map

The mini-map is an original, simplified topology-based diagram of eleven Tube lines plus DLR. It enlarges central interchanges, compresses outer branches and draws connections with horizontal, vertical and 45-degree segments. It does not draw geographic rail polylines or copy TfL map artwork. Eleven important places carry labels; intermediate stops are omitted.

## Source and rebuilding

Source: the repository's [TfL RouteSequence snapshot](../public/data/tfl/route-sequence/index.json), dated **4 February 2026**. `scripts/prepare-mini-map.mjs` records authored control positions, resolves TfL's modal station names through their shared ICS identifiers, and contracts only unselected degree-two stops in each source graph. Every diagram edge therefore retains a connected source walk; branches and named interchanges remain. The generated result is `src/mini-map-data.json`: 109 station/control points, 186 connections, 12 lines.

Run `node scripts/prepare-mini-map.mjs` to rebuild, or append `--check` to verify deterministic output. Missing source files, invalid coordinates and authored names absent from the source fail explicitly. No requests are made at runtime. Elizabeth and Overground are outside this compact diagram's current scope; DLR is included because its Docklands topology supports orientation around the new scene work. This is an orientation map, not a live journey planner.

TfL permits reuse/adaptation of its open data under the [Transport Data Service licence](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service), checked 12 September 2026. The visible `TfL data` disclosure contains the licence link and full attribution: Powered by TfL Open Data; Contains OS data © Crown copyright and database rights 2016; Geomni UK Map data © and database rights 2019. No roundel or official-status claim is used. The [Unified API reference](https://tfl.gov.uk/info-for/open-data-users/unified-api) describes this underlying source, and each source endpoint is retained in the generated JSON.

## Integration contract

```js
import { createMiniMap } from './mini-map.js';

// Once llToXZ's BNG origin and sim.horizontalScale are ready:
const miniMap = createMiniMap({
  camera,
  projectStation: llToXZ,
  onFocus: () => fpsControls.keys.clear(),
});

// Each tick, AFTER camera ownership, master-view transform and
// camera.updateMatrixWorld(true) have completed:
miniMap.update(frameTime);

// Development exposure, needed by the integrated browser test:
// window.__ug = { ..., miniMap };

// When tearing down the app:
miniMap.dispose();
```

The module owns its styles, section, static SVG and local event listeners. It requires no additional package or runtime fetch. `parent` optionally replaces `document.body`. `setCollapsed(boolean)` and `collapsed` support tests/host lifecycle. `mapping` exposes pure `map(x,z)`, `jacobian(x,z)`, `nodes` and `diagnostics` for independent evaluation. If initialisation fails, retain the scene and report the map failure rather than inventing a fallback network.

`projectStation` must return the same canonical X/Z coordinates as `camera.position`. It is sampled during construction, so rebuild the controller if horizontal scale or geographic origin changes. Vertical scale does not alter X/Z or require rebuilding. The module never moves the camera or changes its lens. `onFocus` clears any previously held movement key; map keydown events then stop before global flight handling. Keyup is deliberately allowed through to clear earlier presses.

## Continuous position and field of view

Geographic control positions first undergo a continuous, monotonic `asinh` compression of the existing scene X/Z coordinates. A regularised thin-plate transform fits the authored schematic positions. Fitting begins with low regularisation, checks the Jacobian across the entire finite normalised domain plus every control, and increases regularisation until orientation has a substantial positive margin. If no candidate passes it fails explicitly. The chosen transform also determines the station dots: marker and station positions are never independently snapped. Connections alone use octilinear doglegs.

On the production BNG projection, regularisation is 1. Dense independent finite-difference checks cover latitude 51.25–51.9 and longitude −0.9–0.55. These checks establish the tested area, not a proof over arbitrary map updates. Any source/control changes require rerunning the orientation test and reviewing the diagram. The map is an approximate orientation instrument, not a geographic survey or a nearest-station locator.

The evaluator bounds normalised inputs to ±4.5, so extreme off-city camera positions remain finite. Position moves continuously to the edge of the visible diagram. Outside the rectangular source-station envelope, or where the marker reaches the diagram boundary, the status says `Outside Tube coverage` and the marker has a dashed outline. The edge marker communicates off-map location without snapping the camera to a central station.

The cone reads the actual camera world and projection matrices. Its 17 samples are the horizontal screen-centre rays from the left to right edge, including projection offsets. The mapping's analytic local Jacobian transforms their horizontal directions. This respects focal length, aspect, camera pitch/roll and the non-rigid master view. A near-vertical camera shows the position ring with `Looking vertically`, because a facing wedge would not have a useful heading there.

## Layout and cost

Desktop: top-right, 320px wide, below the network-status badge and above the bottom-right readout. It follows the app's Railway Sans font and control treatment, with a light map surface to preserve familiar TfL line contrast, especially the black Northern line. It begins collapsed below 700px width or 570px height; the narrow layout is 260px when expanded. The map temporarily yields to an expanded HUD below 700px. Resize never steals focus. Manual collapse is a keyboard-accessible button with `aria-expanded` and a 44px touch target on small screens.

Only marker transform, cone path, marker outline and status text change during movement, at most about 15 times per second. Repeated identical poses do not touch the DOM. The static network is constructed once. Fitting took about 25ms in a local Node check; this is not a browser/frame-rate claim.

## Validation

`npx playwright test tests/mini-map.spec.js --grep-invert integrated --workers=1`: seven passing pure checks, no browser launched. They cover source branch presence, octilinear geometry, marker/station agreement, independent finite-difference orientation, local continuity across rivers/airports/off-line positions, cardinal camera headings, lens/aspect/pitch changes, and agreement with Three.js `unproject()` under a non-rigid master camera matrix.

`npx playwright test tests/mini-map.spec.js --workers=1`: adds the real integrated browser check, once `window.__ug.miniMap` is wired. This checks compact size, focus isolation, lens updates, collapse, mobile bounds and coexistence with expanded controls. Run browser checks only in the coordinator's serial slot. Final integrated visual review and performance comparison remain the coordinator's acceptance work.
