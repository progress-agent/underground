# Every road

Road data © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).
The source is the 80 October 2026 Overpass answers in `scripts/.cache/roads-overpass/`.
`node scripts/roads/prepare.mjs` generates `public/data/roads/` deterministically. It uses the
app's terrain and the drawn outer M25 barrier ring. It never changes the shared surface store.
Run it again when the terrain or Thames bridge geometry changes. Tests regenerate into `/tmp`
and compare the manifest, network and every geometry block byte for byte.
The four corrected reservoir feet use the actual dry bank triangles via the same highest-support
query as buildings and navigation, before road clearance. Rails nearby are sampled every 2m
before simplification so narrow bank slopes are retained. These are compiler sampling choices,
not surveyed dimensions. Bank data is ready before compiling, with no runtime refresh race.

The binary `network.bin.gz` preserves OSM way ID, class, width, both pavement widths, layer,
bridge and tunnel flags, and centreline in centimetres. Tunnels are retained in the data but
omitted from the drawn blocks. Footpaths, cycleways, bridleways, steps and paths are excluded;
`pedestrian`, `living_street`, `track`, `road`, `unclassified` and `service` are included as in
the October report. M25/A282 refs are excluded because the game draws that motorway separately.
The generator clips individual segments against the actual map edge, then simplifies to 1m.

Carriageway default widths are the October proof's **estimates**, in metres: motorway 12,
trunk 10, primary 9, secondary 8, tertiary 7, residential 6, service 3.5, other 4.5. Tagged
`width:carriageway` or `width` overrides them, including explicit feet. These values describe
individual OSM carriageways, not both sides of an independently mapped divided road.
[OSM width semantics](https://wiki.openstreetmap.org/wiki/Key:width).

Pavements use OSM `sidewalk`, `sidewalk:both`, `sidewalk:left`, `sidewalk:right` and their width
tags. `separate` means that the pavement exists, although separately mapped footways are not
drawn by this layer. Without a tag, primary through residential gets a 2m band on each side;
motorways, trunk roads, service and other classes get none. The 2m width is an **informed
estimate**, based on the Department for Transport's preferred unobstructed pedestrian width,
not a claim that every London street meets that guidance:
[Inclusive Mobility, section 4.2](https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians).
[OSM sidewalk semantics](https://wiki.openstreetmap.org/wiki/Key:sidewalk).

Some legacy Thames decks are narrower than the mapped carriageways. An **informed estimate**
widens the road-bearing deck to the envelope of its parallel OSM carriageways, their class/tag
widths and pavement bands, plus a 250mm edge allowance. The road compiler uses that same deck
geometry, so a rail never falls off a narrow authored deck into the river. The generated
`bridge-decks.bin.gz` stores immutable VE5 positions and terrain feet for 16 mesh parts,
217,856 bytes decoded. After landing the runtime prepares one part per frame, preserving the
original mesh and material identities. Roads off, below ground and submerged restore the
original deck geometry; the roads-off opening and day look remain identical to live.

Thames road surfaces follow the bridge deck's own subdivided triangles at the two
endpoints of its affine Master morph, including bank ramps. An additional 30m road approach
blends deck ends into terrain. Other OSM bridge flags use the chord joining their terrain landings, held above the local
terrain. This is an **informed estimate** derived from those two sampled elevations, rather
than adding arbitrary headroom above already elevated landings. Its inferred clearance is
the chord above the terrain depression; no surveyed deck elevation is claimed. The bridge
ribbon itself is the deck surface; piers and parapets for these smaller crossings are not
authored. Layer is preserved in the network for later
refinement. No real-world height is asserted by a tooltip.

Runtime blocks use 16-bit positions: X/Z at 125mm, vertical at 10mm real in canonical VE5,
and 16-bit indices. Each block has at most 65,000 vertices. Three bytes per vertex carry
ribbon half-width at 250mm, left pavement width at 100mm with the across-road side in its
high bit, and right pavement width at 100mm. A bridge
adds a signed 16-bit vertical morph delta. Upward winding is checked for every triangle.
Sampling splits both road rails at the terrain grid edges and triangle diagonals before quantisation; each rail then removes redundant samples within 250mm horizontal and 30mm real vertical deviation, including its Master morph delta;
a 60mm real canonical lift plus polygon offset (-4 factor and units) prevents ground fighting.
These are landscape surfaces: the terrain/lift follow Master. Only the bridge's structural
clearance counter-scales with Master. Roads use a diffuse Lambert material with the existing scene lights and shadows. No
additional lights or emissive materials are used.

Desktop loads combined 8km blocks for every class (subdivided at the vertex cap). Phone
uses its separate 8km major-road blocks, plus 2km minor-road blocks whose bounds are within 1.8km of the camera below 120m.
This guarantees every street within 1km of a walker, with a further 800m buffer. Minor roads
are disposed beyond the range, rather than just hidden. At altitude only the major roads stay.
The fetch and gzip decode start after landing; one already built block is attached per frame.
The HUD Roads toggle and `?roads=0` stop loading and dispose the buffers. Roads are hidden
for the existing below-surface and submerged predicates and are FrontSide only as a second guard.

Lane K's hook is `createRoadMaterial()` in `src/roads.js`. Chain its `onBeforeCompile` and
`customProgramCacheKey`, on **both** `roads.material` and `roads.bridgeMaterial`; no clone is
used. Fragment varyings: `vRoadWorld` is world X/Z in metres; `vRoad` is (signed across,
ribbon half-width, left pavement width, right pavement width), in metres. Negative across is
OSM left, with the unequal pavement offset already accounted for. The R base is uniform asphalt;
the bands carry their classification for K to add kerbs and paving. The material's light pool
is incident amber light in `reflectedLight.indirectDiffuse`; `totalEmissiveRadiance` stays zero.
