# Corrected network hand-off, sprint 21Nov26s

This data checkpoint is for building-clearance work. Read `network.bin.gz`
with `readRoadNetwork(file)` from `scripts/roads/network.mjs`. It returns
`{id, cls, width, left, right, bridge, tunnel, layer, p}` records in horizontal
metres, in the app's coordinate frame. UGN1 is unchanged. Width and paired
pavement decisions are already applied in the binary.

`scripts/roads/polygons.mjs` exports `carriagewayPolygons(road)`,
`carriagewayIndex(roads)` and `pavementPolygons(road, index)`. The latter clips
pavements out of other same-layer, same-bridge-status carriageways. There is no
height or terrain dependency in these plan-view helpers. The bake applies the
same clipping after fitting terrain, bridges and bank support.

The first data checkpoint deliberately precedes the complete ribbon rebake and
look changes. Its network is usable by B and O independently of the renderer's
manifest. The final lane commit supplies a matching full road manifest and
ribbons, and its byte-identical regeneration test.

Widths take `width:carriageway` or `width`, else lanes times 3.2m, else class
width halved for one-way ways. The lane figure is the sprint's informed estimate
(D-062), representing an urban traffic lane between constrained 3m and typical
3.65m conventions. Existing pavement-width tagging and the 2m class estimate
are retained. Opposing parallel one-way segments with the same name/ref,
class, layer and bridge status are paired within 3 to 40m. Length-weighted
midpoint votes select the side towards the other carriageway; that pavement
is removed. Unpaired ways retain their tagged/class pavements. Roundabouts do
not pair. The final manifest reports paired and unpaired way counts.

Source data: © OpenStreetMap contributors, ODbL 1.0,
https://www.openstreetmap.org/copyright. No network request is needed: the
compiler uses the 80 cached October OSM answers.

`node --test tests/road-junctions.test.mjs` covers the four width rules, five
real dual carriageways (North Circular Road, Great West Road, Eastern Avenue,
Western Avenue and Watford Way), geometric outer-side selection, unpaired
retention, junction clipping and the compact network reader.
