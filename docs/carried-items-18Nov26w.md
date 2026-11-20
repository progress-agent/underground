# Carried items, 18Nov26w

The four bank ground elevations and outlines in `src/reservoir-foot-data.json`
are exact subsets of `public/data/deep-water.json`, including the Environment
Agency survey URLs, hashes and methods. This changes no water level or crest.
The retained source transects are in `data/water-bank-profiles.json`; the survey
recipe is `scripts/measure-water-banks.mjs`.

The terrain correction reaches the modelled 3:1 bank foot plus 200 m, then
returns to the original elevation through a 400 m smoothstep. These are
**rendering estimates**, chosen to keep a full approximately 137 m grid-cell
diagonal clear of the foot and avoid a visible step. They are not surveyed
floodplain dimensions. Original lower land is retained. At the shared Staines
divider, the North plateau meets the higher recorded ground; each basin's
separate outer foot reaches its own recorded ground elevation.

Terrain triangles, terrain navigation, the ground normal map and live building
bases all receive the same correction. Existing baked building bases receive
the barycentrically interpolated terrain delta at runtime. No surface asset is
rebaked, and no new terrain geometry, texture or rendering program is added.

The vent finish descriptions and source links remain in
`docs/tideway-platform-research.md` and `src/tideway-platforms.json`: dark bronze
at Victoria, grey cast iron at Blackfriars, warm brown iron at KEMP, dark grey
cast iron at Chambers. The colour conversion in `ventFinishColor`, roughness
0.58 and metalness 0.35 are **rendering estimates** calibrated through the
existing AgX exposure, not measurements of the real materials. They lift the
previous almost-black diffuse reflectance enough to reveal the casting relief.
The columns retain the same daylight, moonlight, fog and true-proportion
transforms as the platforms. A normalised byte per vertex selects their
roughness and metalness in the shared opaque, non-emissive Standard shader;
paving retains its original 0.86 / 0.08 values. Columns, walls and approaches
share each site's original draw. Primitive indices are retained rather than
expanding all triangles, so the finish adds no texture or extra deck draw.

The label occluder projects only nearby vent bounds, applies the existing lens
mapping and checks that a vent is nearer than the station anchor. An overlap
hides that name for the frame; ordinary views continue through the unchanged
station-label policy. It does not hide names for an entire platform footprint.

Water outlines: © OpenStreetMap contributors, ODbL 1.0,
https://www.openstreetmap.org/copyright, as in the source inventory. No source
photographs, licensed fonts or new survey downloads are included.

A final bank-triangle audit found two map boxes on dry slopes at Staines North
and Bessborough. `reservoir-buildings.js` sets their bases to the higher of the
terrain and actual bank mesh. Existing instances are adjusted once when the
bank layer arrives, with refreshed bounds; both building decoders use the same
function for later arrivals. This also covers live tiles loaded after a flight.
Tile bounds and any existing collision index are refreshed after an adjustment,
including retained baked meshes from an early switch between building paths.
The culling sphere retains the decoder's original box-derived policy.

## Bank-neighbour foundations, fix round 2

A centre anchor alone leaves the corners of a box above or below a slope. Affected
city tiles now carry four foundation offsets per instance. The bottom wall vertices
meet the highest actual dry bank or terrain support at their respective footprint
corners; the roof stays horizontal. The offsets follow landscape Master, while the
roof retains the existing true-height law. Colour and sun-depth variants use the
same offsets, including after day/night material switches. Unaffected tiles retain
their original geometry and programs. The decoder handles later live/baked arrivals,
and retained city tiles receive the correction when banks attach.

Dry support includes neighbouring banks and excludes submerged basin beds. The
independent check-2 corner method is retained as a before measurement; a supplementary
measurement applies the actual foundation vertex offsets and includes all neighbouring
bank meshes, rather than treating a matrix's centre datum as every wall foot.

Fitting only four corners still leaves a straight wall above a concave slope.
Small foundation faces continue those walls to dry bank/terrain support, sampled
at most every 250mm along the wall, with a 4mm physical overlap into the ground
(rendering choices, not surveyed dimensions). They share one non-emissive city-colour
material, carry no windows, and follow the landscape so they remain in contact at
every Master. They are children of their city tile and are disposed with it. Roof
datums, building heights and footprints are retained.
