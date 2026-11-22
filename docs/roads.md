# Every road

Road data © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).
The source is the 80 October 2026 Overpass answers in `scripts/.cache/roads-overpass/`.
`node scripts/roads/prepare.mjs` generates `public/data/roads/` deterministically. It uses the
app's terrain and the drawn outer M25 barrier ring. It never changes the shared surface store.
Run it again when the terrain or Thames bridge geometry changes. Tests regenerate into `/tmp`
and compare the manifest, network and every geometry block byte for byte.
The four corrected reservoir feet use the actual highest dry-bank triangles, including
neighbouring reservoirs whose terrain was not changed, before road clearance. The compiler
constructs the same full bank inventory as runtime; a four-body subset would miss overlapping
neighbour surfaces. Underwater basin beds are excluded from this dry road support query. Rails nearby are sampled every 2m
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
`width:carriageway` or `width` overrides them, including explicit feet. Without a tagged width, `lanes` takes the sprint’s labelled 3.2m urban-lane estimate (D-062); otherwise a one-way way takes half its class width. These values describe
individual OSM carriageways, not both sides of an independently mapped divided road.
[OSM width semantics](https://wiki.openstreetmap.org/wiki/Key:width).

Pavements use OSM `sidewalk`, `sidewalk:both`, `sidewalk:left`, `sidewalk:right` and their width
tags. `separate` means that the pavement exists, although separately mapped footways are not
drawn by this layer. Without a tag, primary through residential gets a 2m band on each side;
motorways, two-way trunk roads, service and other classes get none. Untagged one-way trunk roads receive the same 2m estimate. Opposing parallel one-way carriageways are paired by shared name/ref, class, layer and bridge status within 3 to 40m; the pavement towards the paired carriageway is removed. Explicit no-pavement tags remain authoritative, and unpaired ways retain their tagged/class bands. The manifest reports both counts. The 2m width is an **informed
estimate**, based on the Department for Transport's preferred unobstructed pedestrian width,
not a claim that every London street meets that guidance:
[Inclusive Mobility, section 4.2](https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians).
[OSM sidewalk semantics](https://wiki.openstreetmap.org/wiki/Key:sidewalk).

Some legacy Thames decks are narrower than the mapped carriageways. An **informed estimate**
widens the road-bearing deck to the envelope of its parallel OSM carriageways, their class/tag
widths and pavement bands, plus a 250mm edge allowance. The road compiler uses that same deck
geometry, so a rail never falls off a narrow authored deck into the river. The generated
`bridge-decks.bin.gz` stores immutable VE5 positions and terrain feet for 20 mesh parts,
262,144 bytes decoded on this network. After landing the runtime prepares one part per frame, preserving the
original mesh and material identities. Roads off, below ground and submerged restore the
original deck geometry; the roads-off opening and day look remain identical to live.

Thames road surfaces follow the bridge deck's own subdivided triangles at the two
endpoints of its affine Master morph, including bank ramps. An additional 30m road approach
blends deck ends into terrain. Other OSM bridges retain the chord joining their terrain landings, held above local terrain.
A mapped crossing over a lower-layer, non-tunnel road now constrains that chord: an
**informed estimate** uses 5.30m road headroom from [DMRB CD 127, Table 4.1](https://www.standardsforhighways.co.uk/tses/attachments/10442706-b592-42c8-85f8-2a0c779a8e37)
plus an estimated 0.70m structural deck depth (a schematic beam depth, not a survey of
an individual bridge). The extra elevation blends smoothly to zero at both terrain
landings. Shared endpoints are junctions, not overpasses. This corrects flyovers where
coarse terrain has no depression beneath the bridge. It does not invent a road-clearance
hump at canal or railway crossings, or alter curated Thames decks. The bridge ribbon
is its estimated deck surface; smaller-crossing piers and parapets remain unauthored.

Runtime blocks use 16-bit positions: X/Z at 125mm, vertical at 10mm real in canonical VE5,
and 16-bit indices. Blocks containing the exact bank overlay instead use Float32 positions
in the same encoded coordinate frame; quantising a clipped boundary to 125mm could cross
a bank edge with a height discontinuity. Each block has at most 65,000 vertices. The header
word at byte 24 stores an optional aerial-index count. Byte 28 is a flags word: bit 0 adds
a normalised Int16 across-road coordinate after both indices; bit 1 selects Float32 positions.
Zero flags retain the original layout. The optional coordinate preserves paving phase at
interior clipping vertices. Three bytes per vertex carry
ribbon half-width and two pavement widths. The half-width base byte carries quarters
of a metre; bit 6 in each pavement byte carries its two fractional bits, giving
1/16m half-width precision without another attribute. Pavement widths use the lower
six bits at 100mm. Bit 7 of the left byte is the rail side; bit 7 of the right byte
suppresses markings in a junction. Old UGR4 has zero fractional bits and remains
decodable. A 3.2m carriageway is therefore represented to within 62.5mm, rather than
rounding its semantic width to 3.0m. A bridge
adds a signed 16-bit vertical morph delta. Upward winding is checked for every triangle.
Sampling splits both road rails at the terrain grid edges and triangle diagonals before quantisation; each rail then removes redundant samples within 250mm horizontal and 30mm real vertical deviation, including its Master morph delta;
a 60mm real canonical lift plus polygon offset (-4 factor and units) prevents ground fighting.
These are landscape surfaces: the terrain/lift follow Master. Only the bridge's structural
clearance counter-scales with Master. Roads use a diffuse Lambert material with the existing scene lights and shadows. No
additional lights or emissive materials are used.

Within 110m bounding regions around the four repaired bank feet, the compiler intersects
road faces with the actual terrain and all neighbouring dry-bank triangles. The upper
surface, including crossings between overlapping bank planes, replaces edge-only chords.
An inferred bridge retains its existing chord where it clears the support and meets the
bank where it was buried; its remaining physical clearance keeps the Master counter-scale.
Float32 overlay scraps below 10cm² or thinner than 5mm are removed as a numerical mesh
cleanup, not as surveyed dimensions. Boundary vertices that round onto the adjoining face
move 2 to 10mm towards their own face interior before their final support is sampled.
Each bridge face retains its own underlying support plane when calculating physical rise;
it does not borrow the higher bank at a shared boundary vertex.
Small affected road runs keep their full aerial index;
the rest retain the existing simplification bounds.

Junctions have butt caps at their mapped nodes. After terrain/bank fitting, the
compiler clips each pavement band against other same-layer carriageways. Shared
carriageway regions carry a marking-suppression bit. Touching carriageway quads
are grouped into conservative convex marking regions, removing internal seams
between quads without letting paint cross a junction. Pavement clipping still
uses the actual carriageway polygons. `scripts/roads/measure-junctions.mjs` reruns
both the byte-identical legacy bake and the corrected bake, measuring stored
pavement triangles against the union of other same-layer carriageways.

Each spatial part has separate, compact near and far files with just the vertices
its own index references. The `lod` and `pair` fields identify mutually exclusive
files. The manifest’s `desktopGPUBytes` is the sum of all asset variants, not
runtime residency. The runtime keeps every detailed desktop part within 1.8km
below 120m and uses aerial parts elsewhere. The phone keeps detailed major roads
and minor-road blocks within 1.8km through 350m, with compact major roads elsewhere.
This exceeds the 1km walker guarantee. All nearby detail survives a turn; distant
parts preload a camera cone expanded by the 0.85 projection factor and 250m bounds
margin. Parts outside that cone are disposed. These are rendering distances, not
claims about the mapped streets. LOD replacements attach before their predecessor
is disposed, so loading a new level does not create a blank road.

Aerial simplification retains every road, endpoint and width, reducing only
interior rail samples within the smaller of 2m or a quarter carriageway width
horizontally and 1m vertically (rendering estimates). Bridges and repaired bank
regions retain their full topology. Index/position compaction is offline; the
browser creates typed-array views and attaches one part per frame after landing.
The Roads toggle and `?roads=0` stop loading and dispose the buffers. Roads retain
the existing below-surface/submerged predicates and FrontSide back-face guard.

Look 2 is the default: darker asphalt, lighter pavement and the existing near-ground
kerb/slab cue. Look 3 adds centre and edge lines and faint asphalt mottle through
the same two materials and uniform, without extra draw calls or a switch-time
compile. `?roadlook=2|3` and the HUD select both paths. The 100mm line widths follow
[Traffic Signs Manual chapter 5 (2018), figures 2-1 and 2-6](https://assets.publishing.service.gov.uk/media/5c4ace6ded915d38a0611abc/traffic-signs-manual-chapter-05.pdf).
The continuous centre line is illustrative, not a surveyed traffic-control plan.
The 0.3m edge inset is an informed rendering estimate: the existing 0.125m kerb
and 0.045m shadow cue plus 0.13m breathing room. The 1.7m mottle scale and 4% colour
variation are visual settings from the prototype, not surveyed asphalt properties.
Strips preserve average coverage as they become sub-pixel; mottle resolves to its
mean before it aliases. Neither treatment is emissive.

The old raster-road term is uniform-disabled once ribbons are visible, without
rebaking the ground atlas. The opening retains the original raster until landing
and road attachment. Roads off restores the exact original raster contribution.

Lane K's hook is `createRoadMaterial()` in `src/roads.js`. Chain its `onBeforeCompile` and
`customProgramCacheKey`, on **both** `roads.material` and `roads.bridgeMaterial`; no clone is
used. Fragment varyings: `vRoadWorld` is world X/Z in metres; `vRoad` is (signed across,
ribbon half-width, left pavement width, right pavement width), in metres. Negative across is
OSM left, with the unequal pavement offset already accounted for. The R base is uniform asphalt;
the bands carry their classification for K to add kerbs and paving. The material's light pool
is incident amber light in `reflectedLight.indirectDiffuse`; `totalEmissiveRadiance` stays zero.
