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
The columns share one opaque, non-emissive Standard material and retain the
same daylight, moonlight, fog and true-proportion transforms as the platforms.
They are batched separately from the paving, one extra draw per deck site.

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
