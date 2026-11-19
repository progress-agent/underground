# Ground at human scale (D-061)

`?groundcue=0..1` tunes the cue, with 0 an exact off switch and 0.5 the default.
It works on R's existing carriageway/pavement ribbons and bridge variant. It adds
no geometry, textures, attributes, draw calls or emission. The tuning parameter preserves the cinematic opening; explicit `fast=1` still
skips it. Developer controls:
`__ug.roads.groundCue.setStrength(value)`, `.strength`, `.weight`.

The pavement is a modest lightening of the asphalt, with darker joints, a kerb
stone and its narrow shadow line. Strength affects all these terms together.
There is no new displacement or collision step: the kerb upstand is suggested
by colour only. Road widths and pavement bands retain R's sourced/estimated
dimensions, documented in [roads.md](roads.md).

| Feature | Size and provenance |
|---|---|
| Paving grid | 600 x 600 mm pitch, D-061 and the study's UK flag-size direction. [Marshalls commercial 600 x 600 slabs](https://www.marshalls.co.uk/landscaping/commercial-paving/600x600-paving-slabs) independently confirms that plan size. Pitch includes the joint; no surveyed London paving layout is claimed. |
| Joint | 5 mm, an informed estimate for a narrow filled square-edge flag joint, less than 1% of the sourced 600 mm pitch. The study does not supply a joint width. |
| Kerb plan width | 125 mm, [Marshalls HB2/Saxon kerb specification](https://www.marshalls.co.uk/landscaping/kerb/products/saxon-kerb-and-edging). The product's 255 mm is the whole stone depth, not an upstand. |
| Suggested kerb upstand | 125 mm, [TfL Streetscape Guidance, kerbs](https://foi.tfl.gov.uk/FOI-2377-1718/Streetscape%20Guidance%202009%20-%20full%20document.pdf). No actual raised face is drawn, in accordance with the shader-only constraint. |
| Kerb shadow line | 45 mm wide, informed illustrative estimate: about one third of the typical 125 mm upstand. It represents local occlusion, not a sun-accurate projected shadow. |
| Material grain | 40 mm smooth mottle cells, an informed estimate for clusters of several aggregate grains, following the study's few-centimetre tarmac direction. These are material clusters, not individual stones or a claim about asphalt grading. The same faint mottle underlies the pavement. |

Coordinates are high-precision horizontal world X/Z in metres. Derivatives use
a second varying relative to a camera-near 4m origin, subtracted at the vertex.
This preserves fragment precision; the paving phase still uses absolute world
coordinates, so moving that origin never moves the pattern. The road tangent
is reconstructed from the screen derivatives of R's across-road coordinate and
world position, through their Jacobian. This aligns the 600 mm grid with each
road without another vertex attribute. Along-road paving phase uses fixed 6m
world panels, an informed precision choice of ten flag pitches. This bounds
direction error without camera-dependent phase jumps. Joints resolve to their
mean at panel seams; this is an estimated procedural paving layout. At bends, the grid belongs to each road
segment; it is an estimated paving layout, not a continuous surveyed bond.

Each joint is filtered to at least a pixel and attenuated by true-width/drawn-
width. Its analytic mean is subtracted, and detail fades out from 0.15 to 0.35
pixels' worth of cells. Noise fades between 0.12 and 0.25 cells per pixel. Kerbs
and the modest pavement tint have conservative footprint fades too. Thus distant
detail resolves to R's asphalt, including when viewed obliquely from street level.
Drone and Balloon suppress the cue uniformly, including at low altitude, to keep
the fixed aerial gate views unchanged. Ground views and low Deity inspection use
the height envelope, full through 12 m and zero from 40 m above local terrain,
comfortably before D-061's 60 m limit and the Bank aerial pose. It accounts for
Master. Roads reuse the existing below-surface and submerged predicates.

Both material variants receive the shader hook and cache key before R compiles
them during road loading. Strength and height are uniforms, never defines or
material swaps. Entering Pedestrian requires no cue program. Night's existing
incident amber light reflects the resulting diffuse colour; emissive stays zero.
At night the colour term also fades with the existing lamp-pool field, reaching
zero between pools. This fade adds no light.

No body, camera, audio, terrain artwork, opening or phone-control code changes.
