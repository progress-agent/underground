# London City wet docks

Royal Albert Dock and King George V Dock use the complete OpenStreetMap wet-water polygons way121158887 and way190792949, retaining53 and72 distinct shoreline vertices. Same-name brownfield polygons are excluded. `scripts/prepare-airport-docks.mjs <archived-city-docks-osm.json>` projects these exact rings into canonical BNG scene coordinates, retains the source timestamp and SHA256, and writes `src/airport-docks-data.json`. The source snapshot is in project `review/transport/city-docks-osm.json`. Attribution is © OpenStreetMap contributors, ODbL1.0.

The water reference is4.26m above Ordnance Datum, published in [Newham's2017 Strategic Flood Risk Assessment, section2.12.9](https://www.newham.gov.uk/downloads/file/1384/newham-sfra-2017-part1). It is a published impounded dock level, not a current gauge observation. The adjacent14.26m text describes depth at the King George V Dock lock gate; it is not used as whole-dock bathymetry.

`createAirportDockWater({VE:5})` creates two meshes sharing the existing calm reservoir water material, including its global water animation/tuning. A dock-only opacity1 override prevents the bright chalk floor exposed by the visual terrain mask from tinting the water grey; reservoir and Thames defaults remain unchanged. There is no new colour palette, structure scaling or per-instance colouring. Rendered canonical Y is4.26×VE+the existing2-scene-unit WATER_LIFT, giving23.3 atVE5. This separation offset is a rendering convention, never added to the physical level shown to the user. Water depth shading attributes are neutral zero because bathymetry is unknown. Disposal unregisters the material from the shared animation registry.

`installAirportDockTerrainMask(material)` must run after `applyM25Mask`, on terrain top and underside. It chains the prior shader hook and cache key, and discards fragments only inside either exact wet polygon, with bounding-box rejection before each polygon test. It changes no terrain vertices, source samples, source datums, airport foundation queries or outside-polygon land. This is explicitly a visual water-surface mask, not a terrain carve or invented bathymetry. It prevents coarsely interpolated shoreline terrain from covering the plane. The returned function removes the mask and restores the previous hook. Install only when the water meshes have been constructed successfully, and dispose both together on failure/removal.

Integration API:

```js
import {createAirportDockWater, installAirportDockTerrainMask,
  getAirportDockSurfaceY, getAirportDockInfo} from './airport-docks.js';
const water = createAirportDockWater({VE:5});
scene.add(water); // canonical world, independent of Structure
const removeTop = installAirportDockTerrainMask(terrain.topMat);
const removeUnder = installAirportDockTerrainMask(terrain.undersideMat);
// Add water.userData.pickables to the existing raycast list.
```

`getAirportDockSurfaceY({x,z},VE=5)` returns rendered canonical Y or null outside water. `getAirportDockInfo({x,z})` returns name, kind, OSM ID, referenceLevelM, datum, levelMeaning and sourceUrl. Mesh userData has type`airport-dock` and the same metadata, plus renderLiftY. The HUD and hover should identify the published4.26m AOD reference and unknown bathymetry rather than treating the visually masked terrain sample as a dock bed. Global Master uses the existing canonical camera/raycast mechanism, so no helper-side multiplier applies.

The dock addition alone needs no terrain bake regeneration. Adding Kenley/Damyns terrain patches and replacement building footprints does require the shared bake and airport suppression fingerprint refresh. Four browser-free tests verify triangulated area and winding, both exact shoreline rings, dry runway/terminal control points, physical/render datum separation, material cleanup, M25 hook composition, source-identical shader uniforms and disposal. GPU verification is the independent reviewer’s next step.

```sh
npx playwright test tests/airport-docks.spec.js tests/airports.spec.js tests/airport-dtm.spec.js --reporter=line
```


Independent GPU diagnosis confirmed the compositing cause: renderOrder3 alone retained grey water, opacity1 restored dark blue, and hiding geology restored blue at the original0.52 opacity. The correction therefore changes only dock opacity through the existing water factory override. It adds no dock bed, depth value or bathymetry. A regression verifies opaque docks, unchanged reservoir opacity0.52, shared palette/material registration, and unchanged physical reference/neutral depth attributes.
