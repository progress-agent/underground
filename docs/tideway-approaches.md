# Tideway approaches and Chelsea terraces

The site figures come from `tideway-platform-research.md`, the sprint research
copied into this repository. Its source URLs and datum qualifications apply.
The deck, outline, columns and covers retain their original researched figures.

The terrain grid cannot resolve a narrow embankment path. Each structure therefore
has an additional paved approach at the research's path level. A separate stair
joins that approach to dry model terrain. Neither the terrain nor the water mask
is changed. The tie-in distance is a rendering estimate derived from the terrain,
not an assertion about the length of the real works.

| Structure | Deck AOD m | Approach AOD m | Basis in the research |
| --- | ---: | ---: | --- |
| Putney | 5.54 | 4.54 | About 1 m above the Embankment pavement, inferred from seven steps. |
| Chelsea | 4.95 | 6.00 | DCO deck 4.95, pavement about 6.0, estimated 1 to 1.5 m down. |
| Heathwall | 5.41 | 5.41 | Level Thames Path connection, east entrance towards Middle Wharf. |
| Isle of Effra | 4.50 | 4.50 | DCO deck, photo shows level entrance. |
| Effra Quay | 6.40 | 5.90 | DCO deck about 0.5 m above Thames Path, gentle ramps. |
| Victoria | 5.40 | 4.40 | Research's inferred footway and entrance terrace, 1 m below viewing platform. |
| Blackfriars | 5.40 | 5.40 | Flat piazza and Thames Path at the flood-defence line. |
| King Edward Memorial Park | 5.60 | 5.60 | Within the research's 5.2 to 5.9 central-square/park-edge range. |
| Chambers Wharf | 4.65 | 4.65 | Block paving and river-wall walkway; wall top remains 5.30. Maintenance access only. |

Gateway positions, stair widths of 3 m, a 4 m Blackfriars path, a maximum
0.15 m riser and minimum 0.35 m tread are modelling choices. Blackfriars' 4 m
path width is sourced in its research section. Other widths and the exact terrain
tie-ins are estimates. The stairs are recomputed when Master changes so that
they still meet the terrain while keeping real-size treads and risers. Deck to
approach relationships, columns and furniture retain their true proportions.

Chelsea's planted end terraces are separate from its narrow floodable pedestrian
walkway. The research asks for 6 to 10 m around each end, 0.5 to 1.5 m lower
than the deck. The chosen total width is 8 m at each end, with three joined
brick-edged shelves at 4.40, 3.95 and 3.50 m AOD. The top level is the DCO figure;
the two lower levels and planting layout are estimates within the research range.
Closed end faces, soil surfaces and low rush/sedge clumps interpret the credited reference photos.
No photograph is shipped.

The dev registry's `builtBounds` includes each site's detail, walls, approach and
separate land column. `approach` describes its actual paved route and dry endpoint;
`approachMesh` and `wallMesh` point to the site detail mesh, which batches all works into the same opaque draw. `wallVertexRange` identifies the actual wall vertices in that rendered buffer. This supports the checker's independently
drawn masks under acceptance erratum 4. The complete Tideway shafts and connecting
tunnels remain accessible through the existing scene roots.

Adjacent approach strips omit only face intervals covered inside their joined concrete volume. Exposed risers, lower faces where terrain bases differ, outer sides and terminal caps remain. This reduces submitted internal geometry without changing the collision volumes or walking surfaces.
