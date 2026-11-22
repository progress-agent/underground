# Building orientation gate 0, sprint 21Nov26s

**Chosen default: area-preserving minimum-area rectangles (O1b).** On the corrected network, a road-aligned long axis clears major roads better, but loses far more than the permitted 0.01 mean IoU. Full machine-readable counts, means and City-box figures are in `building-orientation-gate0.json`.

Source population: 1,274,389, exactly the building bake's globally deduplicated population, after M25, Thames, landmark and airport exclusions. The reference roads are lane R's committed `82d491b28c4cbe1214925c15e0ab98439e38caef` UGN1 network. The actual carriageway quadrilaterals come from its `carriagewayPolygons`, not the former lane-insensitive widths. Rail covers the non-tunnel beds actually drawn by `overground.json` and `tube-surface.json`, at the existing 9 m half-width. Main-line rail outside those rendered datasets is not invented.

| Shape | Roads >1 m | Service/other >1 m | Rail >1 m | Roads or rail | All categories | Mean IoU |
|---|---:|---:|---:|---:|---:|---:|
| Today's square | 2.97515% | 4.49384% | 0.17930% | 3.13327% | 7.25916% | 0.60227 |
| Oriented rectangle | 0.55132% | 1.55565% | 0.14360% | 0.69013% | 2.18693% | 0.86082 |
| Road-aligned rectangle | 0.38897% | 3.76784% | 0.11276% | 0.49569% | 4.19009% | 0.56771 |
| Real outline | 0.34236% | 0.92319% | 0.14415% | 0.48415% | 1.39392% | n/a |

City box: x 1,400 to 3,400; z -2,000 to 0. Population 2,872. Oriented roads-or-rail intrusion 6.26741%, real outline 2.71588%; including service/other, 20.50836% and 13.68384% respectively. The source floor already exceeds 1% with service roads included. B2 therefore fails if every service/other carriageway is included, while the research's major-roads-or-rail measure passes. Both are reported, without silently treating services as absent.

The packed renderer's actual rectangles measure 0.69084% roads-or-rail and 2.18795% including service/other, mean IoU 0.86038. Quantisation therefore changes the headline by only 0.00071 percentage points.

For completeness, the JSON also reports the research's alternate road-frame fit, which permits either rectangle axis to follow the road. It measures 0.47262% roads-or-rail and mean IoU 0.83137. Its IoU loss of 0.02945 also exceeds 0.01, so either road-alignment interpretation selects O1b.

## Instrument corrections and definition

- One global dedup set, in bake filename order, before measuring shapes. 38,558 duplicate source rows removed.
- The union of the actual outline and all candidate rectangles determines the spatial query. 1,467 footprints/candidate shapes extend beyond the old ±80 m box.
- Outward deviation is distance outside the scaled rectangle in its local frame. Recesses inside it contribute zero. Corrected irregular set: 44,993.
- Original rings remain uncapped JS arrays; no byte-sized vertex count or subsequent binary offset exists. Five raw rings exceed 255 vertices and are fully processed.
- A >1 m incursion is positive-area intersection with a finite carriageway quad eroded inward by 1 m on every edge. The same erosion applies to finite rail-bed rectangles. This avoids rounded segment end caps extending into roads that are not drawn. It also makes the junction-seam convention explicit: each authored quad is eroded individually, rather than adding a different city-wide union/offset operation.
- O1b is the minimum-area hull rectangle scaled about its own centre to true polygon area. O2b fits in the nearest major-road/rail bearing frame, puts its **long axis on that bearing** as the acceptance requests, then preserves the same true area. If no such neighbour is within 50 m of the source centre, it retains O1b's bearing. Its IoU penalty includes the fact that many terraced plots have their long axis perpendicular to the street.
- The on-road-or-rail set where O1b intrudes and the real outline clears is 3,982 by this instrument.

## Reproduce

Read the three network files named by `R/NETWORK-READY` from its commit into an isolated scratch snapshot, preserving their paths. The snapshot needs `src/coordinates.js` from the same base and read-only Node dependency resolution. Do not edit R's tree.

```sh
node scripts/buildings/gate0.mjs \
  --network-module /absolute/snapshot/scripts/roads/network.mjs \
  --polygon-module /absolute/snapshot/scripts/roads/polygons.mjs \
  --network-file /absolute/snapshot/public/data/roads/network.bin.gz \
  --network-commit 82d491b28c4cbe1214925c15e0ab98439e38caef
```

After integrating R, those three paths can point to the merged tree itself. No network fetch occurs. The script rewrites the JSON deterministically. Source data: © OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright.
