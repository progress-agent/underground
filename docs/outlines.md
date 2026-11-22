# Real footprint trial

`?outlines=0` is the default. `a` selects the bounded on-road trial; `b` selects
irregular buildings. Neither is a preference and neither changes the default.
Data inherit the existing sources: © OpenStreetMap contributors, ODbL 1.0,
and © Microsoft Building Footprints. Microsoft publishes
[GlobalMLBuildingFootprints under CDLA Permissive 2.0](https://github.com/microsoft/GlobalMLBuildingFootprints#license).
The inherited Microsoft source is the 2026-02-03 UK release; this trial
downloads no new dataset. Payload metadata records both source credits.
The inherited app and source-merger labels call Microsoft data ODbL; those
pre-existing labels are not independent evidence of that licence grant.

Prepare a local surface overlay first:

```sh
node scripts/surface-overlay.mjs prepare
node scripts/outlines/prepare.mjs --snapshot /absolute/R-network-snapshot --commit NETWORK_COMMIT
```

The snapshot contains the committed `scripts/roads/network.mjs`,
`scripts/roads/polygons.mjs`, their `src/coordinates.js` dependency, and the
committed corrected `public/data/roads/network.bin.gz` copied to `network.bin.gz`.
It needs access to the installed dependencies. The script refuses to write into
the main surface store or through a linked output. It creates only
`baked/outlines-a.z.bin`, `baked/outlines-b.z.bin`, and `baked/outlines-meta.json`.
No production promotion is performed.

Selection uses the globally deduplicated bake population, including landmark,
airport, M25 and Thames exclusions. The on-road criterion includes every
corrected surface carriageway class, including service and R's other class
(unclassified, living_street, road, pedestrian and track), plus the drawn
non-tunnel Overground/Tube rail beds. Road bridges, tunnels and non-zero layers
are excluded to avoid treating projected vertical crossings as ground intrusions.
A footprint cuts more than 1 m into a corridor if it intersects the corridor's
finite polygon eroded inward by 1 m. The minimum-area, true-area rectangle must
cut it and the original ring must clear the entire relevant corridor union.
The query covers the whole rectangle and ring. Rail uses the project's derived
coordinate origin and the renderer's 9 m half-bed width.

The irregular criterion is area/MBR-area <0.85, and the largest *outward-only*
distance of a ring point from the true-area rectangle >3 m. Recesses inside the
rectangle do not count. Both sets preserve original rings without simplification.
A ring whose offline roof triangulation disagrees with its filled area by more
than 1% retains its existing box. This avoids missing or overlapping roofs from
malformed source polygons; no substitute outline is invented.

The current source population is 1,274,389. Corrected network
`82d491b28c4cbe1214925c15e0ab98439e38caef` selects 13,870 on-road and
44,993 irregular buildings. The on-road union includes 3,604 buildings cutting
ordinary roads, 9,402 service roads, 1,192 other roads and 134 rail beds; these
group counts overlap. The narrower research denominator would select 3,982,
but excludes service/other roads and does not implement O2's full definition.
Roof-area validation retains boxes for 37 and 249 malformed source rings,
so payloads contain 13,833 and 44,744 buildings (0.267% and 0.553% below
eligible populations). Metadata records every rejected source centre and area,
the corridor breakdown, full hashes, counts, byte sizes and the network commit.
Station and map-edge suppression at runtime can further reduce drawn counts,
exactly as for boxes.

## UGO1 layout

All values little endian. Header: ASCII UGO1, u32 version 1, u32 chunk count,
u32 selected building count. Directory: u32 absolute byte offset and u32 byte
length per chunk. Chunks are aligned to four bytes and bounded by 8,192 vertices,
128 buildings, and the source tile. A single exceptionally large ring can exceed
the target chunk size but cannot exceed the u16 vertex address range.

Chunk header: u32 building count, u32 vertex count, u32 index count. Each 48-byte
building record stores six float32 values (source x/z, rectangle centre x/z,
height, base in true metres), then six u32 values (ring size, first vertex,
first index, index count, tile index, source record ordinal). Ring sizes are
u32, with no 255-vertex cap. Vertices are 8 float32 values: xyz, base,
source-centre x/z, height, cumulative wall distance. Two vertices per ring point
plus a seam pair serve both walls and offline-triangulated roofs. Indices are
u16. Normals are flat derivatives, avoiding a redundant vertex normal buffer.

The renderer imports after landing and completion of the baked boxes. Each
chunk is decoded and matched in small planning slices without changing visible
instances. Its geometry and collision grid are prepared and uploaded before one
atomic commit compacts retained instance runs and publishes the outline mesh
and collision layer together. No half-compacted instance range is ever drawn.
Vertices and collision prisms inherit the matched instance's final base and
height, including legacy DEM corrections and late bank anchoring. Instances
with fitted bank foundations retain their boxes and existing foundation faces;
the loader reports their count. This prevents orphaned rectangular foundation
faces or floating wall feet in the optional trial. Source and rectangle centres both match the
existing square and lane B's oriented payload. Original matrix capacity remains
allocated during the optional trial, so matrix savings are not claimed. The
geometry is retained while moving; collision grids are built with each loading
chunk and reused, without movement-time rebuilding. Displayed-prism raycasts
and face identity use the same real wall rings, height multiplier and base as
the rendered geometry. Day, night and depth shaders share the base-anchored
height law and the opening rise uniforms.

The shared window shader receives a true perimeter coordinate and source-centre
hash. Roof fragments are excluded by a derivative wall-normal test. The trial
adds no colour attributes or textures. Off creates no trial buffers, payload
request, outline material, or renderer import.

Full regeneration check:

```sh
UG_OUTLINE_SNAPSHOT=/absolute/R-network-snapshot node --test tests/outline-buildings.test.mjs
```

Measurements and limitations are in lane O's sprint evidence and RESULT.md.
