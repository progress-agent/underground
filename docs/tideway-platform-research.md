# Tideway foreshore sites: research for sprint 06Nov26f (lane R)

Compiled by wA from two research agents' files (`R/sites-west.md`, `R/sites-east.md`, written 06Nov26f 00:30 to 01:05 GMT from
Tideway, the 2014 Order (DCO) drawings, borough planning documents, OpenStreetMap, Wikimedia Commons and Geograph). Source
photos: `~/.wisdom/scratch/underground/sprint-06Nov26f/R/photos/<id>-<n>.jpg`, each credited in its site section (some are
reference-only, unlicensed: never commit any photo). Every figure is tagged MEASURED, DERIVED or ESTIMATED.

## What the research changes (read before the site sections)

1. **Positions.** All eight of the game's current site coordinates (`public/data/tideway_sites.csv`) are 50 m to 590 m off the
   built structures. Each site section gives a corrected anchor; build at the corrected anchor.
2. **Albert is two structures** about 140 m apart: **Isle of Effra** and **Effra Quay**. Both are built.
3. **Chambers Wharf has no permanent structure in the river.** The cofferdam was temporary and is being removed; what stays
   is a new river wall on about the old line, a small paved operational area on land with the shaft covers, three vent columns,
   a kiosk and an artwork. Do not build a river platform there.
4. **Names as built:** putney (Putney Embankment Foreshore), chelsea (Chelsea Quay), heathwall (Heathwall Quay), albert (Isle of
   Effra and Effra Quay), victoria (Tyburn Quay), blackfriars (Bazalgette Embankment), kemp (King Edward Memorial Park
   Foreshore), chambers (Chambers Wharf). Use the built names in labels or hover text if the game shows one.
5. **Datums.** Tideway drawings use ATD (Tunnel Datum) = AOD + 100 m; the site sections convert to m AOD. Levels come from
   planning drawings (many marked illustrative), not as-built surveys: treat them as the best figures available.
6. **Vent columns** are a family: mostly about 5.1 m tall, twisted or flared, dark bronze or cast iron; counts per site:
   putney 1, chelsea 2, heathwall uncertain (none seen on the river platform; one on land at Middle Wharf), albert 2 at Effra
   Quay (plus two slim green columns on Isle of Effra, uncertain), victoria 2, blackfriars 3, kemp 5 (2 twisted 5.4 m, 3 plain
   up to 6 m), chambers 3.
7. **Conflicts the build must follow the research on, and the report must name:** heathwall's area (556 m² from drawings
   against Tideway's "a fifth of an acre", about 809 m²); blackfriars' area and length (1 or 1.5 acres; 218 m or 250 m); which
   Albert structure sits over the shaft; Albert's vent material (cast iron or bronze). Each site section says which figure it
   recommends.


---

# Tideway foreshore structures, west group: putney, chelsea, heathwall, albert

Research for the UnderGround permanent-structure build. Compiled 06Nov26f by a wA research agent.

Number tags: **MEASURED** = stated in a named source; **DERIVED** = computed by me from a source (working shown); **ESTIMATED** = my judgement (basis stated).

## Read this first: sources, datums and the two kinds of geometry

- **Built outlines come from OpenStreetMap.** All four sites have a mapped polygon of the finished public space (OSM ways 680919954, 1347515789, 1424652921, 1413447838, 1480924681, fetched live via Overpass on 06Nov26f). OSM is crowd-sourced, traced from aerial imagery or on-site survey, so treat these as about +/-1 to 2 m. I converted them to local metres with an equirectangular projection at the site latitude (x = east, z = north, origin at the polygon's area centroid). Area and dimensions computed from those vertices are DERIVED.
- **Levels come from the 2013 Development Consent Order (DCO) drawings**, "Book of plans" sections 8, 14, 16 and 17, on tideway.london. They are labelled ILLUSTRATIVE (Permanent works layout) or are parameter limits (Site works parameter plan). They are the only published levels I found; the detailed designs discharged later by the boroughs (2019 onwards) may differ by tens of centimetres. **All DCO levels are in Tunnel Datum (ATD) = AOD + 100 m**, stated on every sheet ("All levels are in metres and relate to the Tunnel Datum which is 100 metres below Ordnance Datum Newlyn"). I have converted every one to m AOD.
- **Tide levels** are from the PLA Tide Booklet 2026, page 19, "Chart Datum & Tidal Levels in the Port" (https://pla.co.uk/sites/default/files/2025-12/PLA-Tide-Booklet-2026.pdf). MEASURED values are above local chart datum (CD); I converted to AOD using the same table's "level of chart datum below ODN" column (DERIVED). Summary:

| PLA station (used for) | CD below ODN | MHWS (CD) | MLWS (CD) | HAT (CD) | MHWS m AOD | MLWS m AOD | HAT m AOD |
|---|---|---|---|---|---|---|---|
| Putney (putney) | 1.98 | 6.1 | 0.3 | 6.6 | +4.12 | -1.68 | +4.62 |
| Albert Bridge (chelsea, upstream bound) | 2.29 | 6.3 | 0.3 | 6.8 | +4.01 | -1.99 | +4.51 |
| Victoria Rail (chelsea, heathwall) | 2.44 | 6.5 | 0.3 | 6.9 | +4.06 | -2.14 | +4.46 |
| Vauxhall (heathwall, albert) | 2.59 | 6.6 | 0.3 | 7.1 | +4.01 | -2.29 | +4.51 |

Working: MHWS AOD = MHWS(CD) - (CD below ODN), e.g. Putney 6.1 - 1.98 = +4.12. Cross-check: the Environment Agency Chelsea gauge "usual range" (90% of the time) is -2.36 m to +4.23 m AOD, highest recorded +4.95 m AOD (16 Dec 2005) (https://riverlevels.uk/thames-tideway-chelsea-tidal), consistent with the table.

- **Ventilation column heights, project-wide rule.** The City of London poetry paper (Appendix 1, Tideway Poetry Supporting Document, 06 Apr 2023, https://democracy.cityoflondon.gov.uk/documents/s186035/Appendix%201.%20Tideway%20Poetry%20Supporting%20Document.pdf) states: "The ventilation columns are chimney structures with a 5.1m height above ground level for the Central contract (6m maximum elsewhere) and varying in cross sectional area." It also states the Albert Embankment Foreshore columns are **cast iron**, while Putney and Victoria Embankment are **bronze**; poems are engraved in a strip running up one edge, text in the lower 3.5 m, 60 mm Doves font, starting 300 mm above the base; columns are bolted below ground with hidden bolts and are up-lit. Gillespies names Ferrovial Laing O'Rourke (the Central contractor) as main contractor at Chelsea (https://www.gillespies.co.uk/stories/chelsea-quay-completes-in-time-for-rhs-chelsea-flower-show), so chelsea, heathwall and albert are Central-contract sites and 5.1 m applies to them (DERIVED). Putney is a West-contract site; Tideway states its column is 5 m (MEASURED).
- **Signature column form (all sites).** A slightly flared, twisted cylinder: one edge spirals up the shaft as a sharp ridge, the top is cut on a slant, the finish is a dark brown-black patina. Tideway: "twisting, flowing" form "inspired by computational fluid dynamics modelling of water flow" (https://tideway.london/news/press-releases/2022/april/super-sewer-s-first-riverside-ventilation-column-installed-along-putney-embankment). Hawkins\Brown: "Twisted bronze shafts are common to all pocket parks" (https://www.hawkinsbrown.com/projects/thames-riverside-parks/), which conflicts with the City of London paper on Albert's material (cast iron); see albert.
- **Architects.** Hawkins\Brown (architecture, all sites), with Gillespies co-designing the public realm at Chelsea; AECOM engineering, Studio Dekka lighting (Gillespies page above).

### Game position corrections (DERIVED from the OSM centroids)

| id | game now | best position (area centroid of the built space) | error in game |
|---|---|---|---|
| putney | 51.4665, -0.2105 | **51.466834, -0.215267** | about 330 m too far east (game point is on the Fulham side of Putney Bridge) |
| chelsea | 51.4850, -0.1600 | **51.484892, -0.153987** | about 420 m too far west |
| heathwall | 51.4826, -0.1360 | **51.483038, -0.135954** | about 49 m too far south (game point is inside the pumping station compound) |
| albert | 51.4920, -0.1215 | **Isle of Effra 51.487317, -0.125642** and **Effra Quay 51.488191, -0.124388** | about 470 to 590 m too far north (game point is near Lambeth Bridge) |

Working for the error: 1 degree of longitude at latitude 51.48 = 111,320 x cos(51.48) = 69,330 m; 1 degree of latitude = 110,574 m. Putney: (0.215267 - 0.2105) x 69,330 = 330 m. Chelsea: (0.1600 - 0.153987) x 69,330 = 417 m. Heathwall: (51.483038 - 51.4826) x 110,574 = 48 m. Albert to Isle: dlat 0.004683 x 110,574 = 518 m, dlon 0.004142 x 69,330 = 287 m, together 592 m.

Albert is **two separate structures** about 140 m apart; the game should draw both.

---

## putney: Putney Embankment Foreshore

### 1. Platform outline

- **Shape:** a four-sided platform (a trapezoid with rounded outer corners) built out from Putney Embankment just upstream (west) of Putney Bridge, between the University Boat Race stone and the bridge. Its long river face runs WNW to ESE, roughly parallel to the old wall. It is deeper at the downstream (bridge) end, where the old embankment wall recedes.
- **Built outline, OSM way 680919954** (MEASURED vertices; local metres DERIVED; x east, z north, origin 51.466834, -0.215267):
  `(-20.6,4.7) (-18.7,7.0) (-10.5,17.3) (-9.7,17.6) (-8.9,17.6) (18.6,-1.1) (19.3,-2.4) (19.2,-3.8) (8.8,-19.1)`
  - West (upstream) end: 16.1 m, bearing 039 (DERIVED).
  - River face: 33.2 m straight plus two rounded corners, bearing 124/304 (DERIVED). Corner radius about 1.5 m (DERIVED from the 0.8 to 1.5 m chamfer segments).
  - East (downstream, bridge) end: 18.5 m, bearing 214 (DERIVED).
  - Landward edge: 37.8 m, bearing 309 (DERIVED). This edge probably includes a strip of the existing embankment pavement, so the OSM area is larger than the structure proper.
  - Area: **695 m²** by OSM polygon (DERIVED); **500 m²** stated by Tideway for the new space ("500m2") (MEASURED, https://www.tideway.london/news/press-releases/2023/september/opening-of-new-riverside-space-at-putney-embankment-marks-step-forward-for-london-s-super-sewer/). The two differ because OSM includes approach paving; use about 500 to 550 m² for the platform itself.
- **Cross-check from the DCO** (Permanent works layout sheet 1, DCO-PP-05X-PUTEF-080010, 1:400 at A3, ILLUSTRATIVE, https://tideway.london/media/4553/208-putney-embankment-foreshore-plans.pdf p14): I measured the plotted outline at 200 dpi (1 px = 0.0508 m at 1:400): river face about 34 m, west end projecting about 12 m from the old wall line, east end about 19 m, area about 34 x (12 + 19) / 2 = 527 m² (DERIVED). This agrees with OSM and Tideway's 500 m².
- **Projection into the river:** about 12 m at the upstream end rising to about 19 m at the downstream end (DERIVED, DCO and OSM agree within 1 to 2 m).
- **Orientation:** long axis bearing about 124 to 129 degrees (DERIVED; OSM minimum bounding rectangle 37.9 x 20.1 m on bearing 129).
- **Terraces:** none. One level deck, with a short flight of about seven steps and a ramped/level vehicle access from the Embankment at the west end (photo putney-3; PUTEF.04 requires "level access ... for maintenance vehicles via Embankment/Lower Richmond Road"). Tactile strips mark level changes (Tideway site page).

### 2. Height and facing

- **Deck level:** DCO illustrative label **105.54 ATD = +5.54 m AOD** on the deck (MEASURED on the drawing, converted). Parameter plan: top of river wall **105.54 m minimum to 105.84 m maximum ATD = +5.54 to +5.84 m AOD** (MEASURED, Site works parameter plan DCO-PP-05X-PUTEF-080008, p12). Design principle PUTEF.05: "The surface of the foreshore structure shall sit at or above current flood defence level" (MEASURED, APP206.01 Design Principles, https://www.tideway.london/media/1896/app20601-design-principles.pdf, table 4.8).
- **Relative to water (DERIVED):** deck about 1.4 m above MHWS (+4.12 m AOD) and about 7.2 m above MLWS (-1.68 m AOD).
- **Relative to the existing embankment:** the deck stands about 1 m above the Embankment pavement at the west end (ESTIMATED from about seven steps of about 150 mm in photo putney-3). The Embankment road here is known to flood on big tides, which is why the deck is set higher.
- **River wall:** at low tide the outer wall stands about 4 to 5 m above the foreshore gravel (ESTIMATED from photo putney-2, using the 4.5 m tall vertical fender spacing and the railing). Foreshore level is not published; about +0.5 to +1.0 m AOD is a reasonable assumption (ESTIMATED).
- **Facing:** PUTEF.19: "The river wall of the foreshore structure shall be finished in natural stone with vertical timber fenders on the outer face and horizontal timber fenders on the upstream and downstream faces" (MEASURED). Built (photo putney-2): pale grey granite panels on the north (river) face with vertical dark timber fenders at roughly 2 m centres, grab chains hung in swags between them, "PUTNEY EMBANKMENT" lettering, and two small rectangular CSO outfall openings near the base at the downstream end; the east (bridge-facing) face reads as close-spaced vertical dark timber cladding. The October 2021 CLWG slides record "Installed timber façade" and "Completed casting all granite panels" (https://www.tideway.london/media/5233/191021-putef_barel-presentation.pdf). Granite is Cornish, "from the same quarry used for Putney Bridge" (Tideway 2023 press release).

### 3. Shaft cover

- CSO drop shaft **6 m internal diameter** (MEASURED, DCO Work No. 5a, Permanent works layout), **36 m deep** (MEASURED, Tideway site page https://tideway.london/locations/putney-embankment-foreshore/).
- Position: centred towards the **west (upstream) end** of the platform, about 8 m in from the river face (DERIVED from the DCO layout: shaft zone circle centre about 10 m from the west end and 7 to 8 m from the river face).
- Form: **flush**. Rectangular recessed access covers with steel frames, infilled with the granite paving, sit level with the deck (photo putney-1 shows several framed covers in the foreground). DCO shows valve, ventilation and air-treatment chambers below the east half, also with flush covers. No raised plinth.

### 4. Ventilation columns

- **Count on the foreshore structure: 1** signature column (MEASURED: "sculptural bronze ventilation column", Tideway 2023 press release; "first of 19 signature ventilation columns", Tideway 2022).
- **Height: 5 m** (MEASURED: "the 5m-high sculpture", Tideway 2022 press release above).
- **Diameter:** about 0.9 to 1.0 m at the base, flaring slightly to the top (ESTIMATED: in photo putney-1 and the Commons close-up its width roughly equals the 1.1 m handrail height; height to width about 5.5:1). DCO allowed "0.6m internal dia ventilation column, minimum 4m to 8m maximum height" (MEASURED, DCO layout).
- **Material and colour:** nickel aluminium bronze, "the same alloy used for ship propellers", cast in the Netherlands and patinated (MEASURED, Tideway 2022). Colour: very dark brown-black.
- **Form:** twisting cylinder with a spiral ridge and slanted top; engraved poem by Dorothea Smartt on Beverley Brook and the 1921 women's swim ("Beverley Brook seeks the Thames, finds her at Putney. 1921. Flappers plunge feet first, our city's finest swimmers riding her waters all the miles to Kew.") (MEASURED, Commons file description).
- **Position:** at the **north-west corner**, close to the curved river railing at the upstream end (photo putney-1 and the DCO layout, which puts the column zone at the NW corner).
- A second, smaller 6 m vent column "serving the interception chamber" was permitted on or by the listed bridge (DCO parameter table). I found no evidence of what was built there; it is not on the platform.

### 5. Other permanent features

- **Kiosk:** one electrical and control kiosk at the **west end of the platform, on the landward side**, marking the junction with the existing embankment beside the steps (PUTEF.12, photo putney-3). Clad in Cornish granite in horizontal coursed bands, with sandblasted dark-panel reliefs of a Thames skiff (Tideway 2023). Size about 3.5 m x 3 m in plan and about 2.5 to 3 m tall above the deck (ESTIMATED from photo putney-3; DCO allowed "2.5m from new foreshore structure"). A second, main kiosk is on Waterman's Green across the road, against the bridge abutment (PUTEF.06).
- **Railings:** continuous stainless steel post-and-rail balustrade with vertical bars, about 1.1 m high, set back from the edge; three bronze oar handrails (barge, wherry and skiff oars) set into it (Tideway 2023, photo putney-1).
- **Seating:** long granite block benches, some with timber tops, facing the river (photo putney-1; Tideway site page).
- **Paving:** mixed grey Cornish granite setts and slabs in a random pattern (photo putney-1).
- **Boat Race marker:** a bronze strip inlaid in the paving running from the University Boat Race stone to the new river wall (PUTEF.17; Tideway 2023).
- **Lighting:** subtle uplighting; a slim street-light column near the east end (photo putney-1).
- **Trees:** none on the platform; existing plane trees on the Embankment pavement behind it (OSM tree nodes 3456414324, 3456414325, 12747654433).
- **Artwork:** Claire Barclay, "Water Finds a Level" (oars, start-line marker, kiosk reliefs).
- **Pier:** none built. Putney Pier (London River Services) is immediately downstream, between the platform and the bridge. PUTEF.22 keeps the east end clear for vessel loading.

### 6. Sources

- Tideway site page: https://tideway.london/locations/putney-embankment-foreshore/ (shaft depth, kiosk, benches, paving)
- Tideway press release, 2023 opening: https://www.tideway.london/news/press-releases/2023/september/opening-of-new-riverside-space-at-putney-embankment-marks-step-forward-for-london-s-super-sewer/ (500 m², one bronze column, Cornish granite, oars, start line)
- Tideway press release, 2022 column: https://tideway.london/news/press-releases/2022/april/super-sewer-s-first-riverside-ventilation-column-installed-along-putney-embankment (5 m, nickel aluminium bronze)
- DCO Book of plans section 8: https://tideway.london/media/4553/208-putney-embankment-foreshore-plans.pdf (p12 Site works parameter plan; p14 Permanent works layout)
- Design Principles APP206.01, table 4.8 (PUTEF.01 to .24): https://www.tideway.london/media/1896/app20601-design-principles.pdf
- CLWG slides Oct 2021 and Sept 2023: https://www.tideway.london/media/5233/191021-putef_barel-presentation.pdf ; https://www.tideway.london/media/6390/clwg-putney-barn-elms-sept-23.pdf (opened to the public 15 September 2023)
- OSM way 680919954 (outline), nodes for trees, bench, Boat Race stone
- PLA Tide Booklet 2026 p19 (tides)

### 7. Photos

| file | source | author | licence | shows |
|---|---|---|---|---|
| `photos/putney-1.jpg` | https://commons.wikimedia.org/wiki/File:Putney_Embankment_Foreshore_New_embankment_at_Putney.jpg | Matt Brown | CC BY 2.0 | Finished deck looking east to Putney Bridge: grey granite paving with flush access covers, the dark bronze column at the NW corner, steel railing, granite benches with timber tops. |
| `photos/putney-2.jpg` | https://commons.wikimedia.org/wiki/File:New_embankment_on_the_Thames_Putney_Embankment_Foreshore.jpg | Matt Brown | CC BY 2.0 | The platform from Putney Bridge at low tide: pale granite river wall with vertical timber fenders and grab chains, two outfall openings, kiosk and column at the far (west) end. |
| `photos/putney-3.jpg` | https://commons.wikimedia.org/wiki/File:Putney,_Thames_Tideway_Tunnel_Embankment.jpg | AndyScott | CC0 | The granite kiosk with skiff reliefs beside the steps up from the pavement, with the bronze column behind. |

### Build summary (putney)

- **Footprint:** quadrilateral, centroid 51.466834, -0.215267. Local vertices (x east, z north, m): W1 (-20.6, 4.7), NW (-10.5, 17.3), NE (18.6, -1.1), SE (8.8, -19.1); round the NW and NE corners at about 1.5 m radius. River face 33 m on bearing 124; west end 16 m; east end 18.5 m. Landward edge W1 to SE ties into the existing embankment wall. Use about 500 to 550 m² net.
- **Deck:** flat at +5.54 m AOD; MHWS +4.12, MLWS -1.68. Deck about 1.4 m above MHWS, about 1 m above the Embankment pavement, about 4.5 to 5 m above the low-tide foreshore.
- **River wall:** vertical, pale grey granite panels, vertical dark timber fenders at about 2 m centres on the river face, dark timber cladding on the east face, chains between fenders. Two small dark outfall openings low on the north face near the NE corner.
- **Railing:** 1.1 m stainless post-and-rail with vertical bars, set back about 0.3 m from the edge, following the rounded corners.
- **Vent column:** 1, at about (-12, 13) near the NW corner, 5.0 m tall, about 0.95 m diameter, twisted cylinder with slanted top, very dark bronze (#2b241f or similar).
- **Shaft cover:** flush, 6 m internal shaft centred about (-8, 6); draw as a few framed rectangular covers in the paving, not a disc.
- **Kiosk:** granite box about 3.5 x 3 x 2.8 m at the west end on the landward side, next to a 7-step stair down to the pavement.
- **Finishes:** grey granite setts (light and mid grey mix); 3 to 4 granite bench blocks (about 3 x 0.8 x 0.5 m) along the south side facing north.

### Confidence (putney)

- Outline and area: **high** (OSM, DCO and Tideway agree).
- Deck and wall levels: **medium** (DCO illustrative, not as-built).
- Vent column count, height, material: **high**; diameter **medium** (estimated).
- Facing materials: **high**; fender spacing and outfall details **medium**.
- Kiosk size: **low**.
- Missing: as-built levels and dimensions (Wandsworth discharge-of-requirement drawings for PUTEF4 were not found online); exact column coordinates.

---

## chelsea: Chelsea Embankment Foreshore (built name: Chelsea Quay)

### 1. Platform outline

- **Shape:** a lens or crescent built out from Chelsea Embankment opposite the Bull Ring Gate of the Royal Hospital Chelsea: a straight landward edge along the embankment wall and a smoothly **curved, sweeping outer river wall** that bulges into the river, deepest a little west of centre. Planted **intertidal terraces** wrap both ends (east and west) at lower levels. Upper deck, lower floodable walkway and curved brick steps make it a **terraced** structure.
- **Built outline, OSM way 1347515789** (MEASURED vertices; DERIVED local metres; origin 51.484892, -0.153987):
  `(23.4,10.4) (25.8,17.5) (12.2,12.8) (6.8,11.2) (-10.6,6.1) (-20.3,3.2) (-27.0,1.2) (-22.7,-1.5) (-19.4,-7.8) (-14.3,-11.9) (-9.4,-13.7) (-3.9,-14.2) (1.2,-13.0) (3.6,-12.3) (5.6,-11.2) (10.1,-8.6) (13.1,-5.3) (15.1,-2.5) (16.2,1.0) (17.0,4.1)`
  - Landward edge (embankment line): 55.3 m, bearing 253/073, from (25.8, 17.5) to (-27.0, 1.2) (DERIVED). OSM maps two retaining-wall segments on this line (ways 1475963008, 20.0 m, and 1475963009, 17.1 m) with a gap between them about 18 m wide, which is the opening on the Monument Walk axis (CHEEF.06, CHEEF.12).
  - Maximum projection from that edge: **about 21.5 m**, at about (-4, -14) (DERIVED: perpendicular distance from the landward line).
  - Area: **802 m²** (DERIVED from OSM). This is the paved public area; the intertidal terraces at each end are extra and not mapped. No published area found.
- **DCO cross-check** (Permanent works layout sheet 1, DCO-PP-12X-CHEEF-140008, https://www.tideway.london/media/2039/214-chelsea-embankment-foreshore-plans.pdf p12, ILLUSTRATIVE): same lens shape, curved river wall from the Grosvenor College stairs end to the Ranelagh CSO end, with intertidal terraces "to match opposite side" at the west end and over the connection culvert at the east end.
- **Orientation:** long axis bearing about 073/253 (DERIVED; minimum bounding rectangle 55.3 x 22.0 m).

### 2. Height and facing

- **Levels (DCO illustrative, MEASURED on drawing, converted):** deck over the shaft **104.95 ATD = +4.95 m AOD**; terrace labels **104.40 ATD = +4.40 m AOD** at both ends; parapet label **106.55 ATD = +6.55 m AOD** at the east end. Parameter plan: top of river/parapet wall **105.45 to 106.00 ATD = +5.45 to +6.00 m AOD** (DCO-PP-12X-CHEEF, p10).
- **Relative to water (DERIVED, using MHWS about +4.0 to +4.06 m AOD, MLWS about -2.0 to -2.1 m AOD):** main deck about 0.9 m above MHWS; lower terraces only about 0.35 m above MHWS and below HAT (+4.46 to +4.51), which is why Tideway says parts of the space are **"floodable" at high tides** (MEASURED, https://tideway.london/locations/chelsea-quay/).
- **Relative to the embankment:** the public deck sits **below** the embankment pavement; you step down from Chelsea Embankment through the parapet opening (photo chelsea-1 shows the deck railing top roughly at pavement-parapet level). About 1 to 1.5 m lower (ESTIMATED from photo chelsea-1 and the DCO 4.95 vs 6.0 levels).
- **Facing:** **brick**, not granite. CHEEF.01: "The new river wall and parapet materials shall match the stone and brick of the existing wall" (MEASURED). Hawkins\Brown: "Organic design in clay bricks, referencing Bazalgette's original tunnels" (MEASURED). Built (photos): dark purple-brown and red-brown clay brick river wall in a sweeping curve, brick-on-edge copings, textured courses so algae can establish (Tideway site page). CHEEF.10: **no timber fenders** (MEASURED). Florian Roithmayr's artwork "Moving In" sets groups of coloured glazed bricks (white, orange, yellow, light and dark blue, teal) into vertical faces, steps and terraces (Tideway; photo chelsea-3).

### 3. Shaft cover

- CSO drop shaft **12 m internal diameter** (MEASURED, DCO Work No. 12a), **45 m deep** with a 50 m connection tunnel (MEASURED, Tideway via search summary of https://tideway.london/locations/chelsea-quay/).
- Position: near the centre of the deck, slightly west of centre and about 9 m in from the landward edge (DERIVED from DCO layout, where the shaft circle sits under the 104.95 label).
- Form: **flush** under brick paving, with square and rectangular recessed access covers infilled with brick in steel frames (photo chelsea-2). No plinth.

### 4. Ventilation columns

- **Count: 2** signature columns (MEASURED by photo chelsea-1; DCO allowed "2 No. 0.9m internal dia ventilation columns of 4m minimum to 8m maximum height" at the west end).
- **Height: 5.1 m** (DERIVED: Central-contract figure from the City of London paper, applied because Chelsea's contractor was FLO). DCO limit 4.0 to 8.0 m.
- **Diameter:** about 1.1 to 1.3 m (ESTIMATED: 0.9 m internal per DCO plus wall thickness and the visible flare; in photo chelsea-1 the columns are about 4 to 4.5 diameters tall).
- **Material and colour:** dark brown-black patinated metal; Hawkins\Brown says bronze for all sites (MEASURED claim), not independently confirmed for Chelsea. **Coloured lighting**: "Ventilation columns have coloured lighting to signal the tide coming in and going out" (MEASURED, Tideway site page); CHEEF.18: "shall not be flood lit".
- **Form:** twisted, flared signature columns, as Putney; poem by Dorothea Smartt on the lost River Westbourne.
- **Position:** at the **west end of the deck, close to the embankment wall**, standing as a pair about 3 to 4 m apart (photo chelsea-1, which looks east along the embankment). CHEEF.06 keeps columns, kiosks and trees out of the Monument Walk view axis.
- A separate small vent column (0.225 m internal, 6 m high in the DCO) was planned on the **north side of Chelsea Embankment**, in the line of the street trees (CHEEF.14). Not confirmed as built. Several slim dark posts, about 6 to 8 m tall, stand at the deck edges in photos chelsea-1 and chelsea-2; I could not confirm whether they are lighting columns or vent stacks (ESTIMATED: most likely lighting).

### 5. Other permanent features

- **Brick terraces and steps:** sweeping curved brick steps and seating terraces stepping down from the deck towards the river at the east end (photo chelsea-3), plus a lower floodable walkway "bringing the public to the water's edge" (Hawkins\Brown).
- **Coloured drum:** a round brick drum about 3 to 4 m diameter and about 1.5 m high, with bands of coloured glazed brick and a black capping band, near the north-west of the deck (photos chelsea-1, chelsea-3). Function not stated (ESTIMATED: it encloses plant or a kiosk; CHEEF.19 required kiosks "visually integrated into the design of the new river wall").
- **Intertidal terraces:** planted beds at the east and west ends, native rushes, grasses, sedge, sea aster and iris (Tideway site page), stepping down to the foreshore.
- **Railings:** black steel vertical-bar railings about 1.1 m high on top of the curved brick river wall, designed to be "visually unobtrusive" on the Royal Hospital axis (CHEEF.12); a red life-ring cabinet (photo chelsea-1).
- **Seating:** curved timber benches on dark bases; curved brick seating (Gillespies, photo chelsea-3).
- **Paving:** red-brown and dark clay brick pavers in herringbone and stretcher bond; a stone-slab threshold with inset steel letters "CHELSEA QUAY" along the embankment footway, with a long slot drain at the edge (photo chelsea-2).
- **Lamps:** listed Bazalgette "Lion's Foot" cast-iron lamp standards on the embankment parapet retained and refurbished (Tideway).
- **Trees:** none on the deck; London planes along the embankment (replacements per CHEEF.04).
- **Parish boundary marker** reinstated on the new wall (CHEEF.11).

### 6. Sources

- Tideway site page: https://tideway.london/locations/chelsea-quay/ (floodable, lighting on columns, terraces, planting, brick paving, Lion's Foot lamps, artwork)
- Hawkins\Brown project page: https://www.hawkinsbrown.com/projects/thames-riverside-parks/ (clay brick, organic design, lower walkway, bronze shafts)
- Gillespies press release: https://www.gillespies.co.uk/stories/chelsea-quay-completes-in-time-for-rhs-chelsea-flower-show (design team, FLO contractor, floodable walkway)
- DCO Book of plans section 14: https://www.tideway.london/media/2039/214-chelsea-embankment-foreshore-plans.pdf (p10 parameter plan; p12 permanent works layout)
- Design Principles APP206.01, table 4.20 (CHEEF.01 to .21): https://www.tideway.london/media/1896/app20601-design-principles.pdf
- City of London poetry paper (5.1 m Central columns): link in the header
- The Unfinished City blog, 26 Feb 2026 (two-colour tide lighting, raised and floodable terraces): https://www.theunfinishedcity.co.uk/2026/02/new-public-realms-along-river-thames.html
- OSM way 1347515789 and retaining walls 1475963008, 1475963009, 1347515791
- PLA Tide Booklet 2026 p19

### 7. Photos

| file | source | author | licence | shows |
|---|---|---|---|---|
| `photos/chelsea-1.jpg` | https://commons.wikimedia.org/wiki/File:Chelsea_Quay_from_Chelsea_Embankment_2025-05-03.jpg | Matt Brown | CC BY 2.0 | From the embankment pavement looking east: the pair of dark twisted columns at the west end, the coloured brick drum, the curved brick river wall with black railing, and the intertidal terrace below. |
| `photos/chelsea-2.jpg` | https://commons.wikimedia.org/wiki/File:Chelsea_Quay_2025-05-03.jpg | Matt Brown | CC BY 2.0 | The brick-paved deck with flush framed access covers and the "CHELSEA QUAY" lettered threshold; a crane is still working offshore (May 2025), but the deck is finished. |
| `photos/chelsea-3.jpg` | https://commons.wikimedia.org/wiki/File:Chelsea_Quay_coloured_bricks_2025-05-03.jpg | Matt Brown | CC BY 2.0 | The glazed coloured brick bands on the drum and the sweeping curved brick steps and terraces down towards the river. |

### Build summary (chelsea)

- **Footprint:** crescent, centroid 51.484892, -0.153987. Straight landward edge 55 m on bearing 073 from (-27.0, 1.2) to (25.8, 17.5); outer edge a smooth curve through the OSM vertices, maximum projection about 21.5 m at about (-4, -14). Add a planted intertidal terrace about 6 to 10 m wide wrapping each end, 0.5 to 1.5 m lower (ESTIMATED from DCO layout).
- **Levels:** main deck +4.95 m AOD; lower terraces and walkway +4.40; parapet/wall top about +5.5 to +6.0; embankment pavement about +6.0 (ESTIMATED). MHWS about +4.03, MLWS about -2.05. Deck about 0.9 m above MHWS and about 1 to 1.5 m below the pavement.
- **River wall:** vertical then curved in plan, dark purple-brown clay brick, no fenders, coloured glazed brick bands in places.
- **Railing:** black vertical-bar steel, 1.1 m, along the curved outer edge.
- **Vent columns:** 2, at about (-20, 0) and (-16, 1) near the west end against the embankment line, 5.1 m tall, about 1.2 m diameter, twisted dark bronze, emissive tide-coloured uplight at the base.
- **Shaft cover:** flush, 12 m internal shaft centred about (-5, -2); draw as framed square covers in the brick.
- **Drum:** brick cylinder about 3.5 m diameter x 1.5 m at about (-12, 2), striped with coloured glazed bricks, black cap.
- **Finishes:** red-brown and charcoal brick pavers; curved brick step terraces at the east end; timber curved benches.

### Confidence (chelsea)

- Outline: **high** for the paved area (OSM); **medium** for the intertidal terrace extents (DCO only).
- Levels: **medium** (DCO illustrative).
- Vent column count: **high**; height **medium** (derived from the Central-contract rule, not a Chelsea-specific statement); diameter **low to medium**; material **medium** (Hawkins\Brown only).
- Missing: as-built levels, terrace widths, column coordinates, what the drum and the slim posts are.

---

## heathwall: Heathwall Pumping Station (built name: Heathwall Quay)

### 1. Platform outline

- **What is in the river:** a near-rectangular foreshore structure built out in front of the Heathwall Pumping Station building on the south bank at Nine Elms, between the Battersea Barge and Riverlight (upstream, west) and Middle Wharf's jetty (downstream, east). It contains the Heathwall pumping station CSO interception and valve chamber and a smaller drop shaft. The main 16 m CSO drop shaft is **on land** at Middle Wharf to the east, not in the river (DCO layout DCO-PP-14X-HEAPS-160007; Dec 2019 CLWG slide: "Two shafts under construction: In land: combined sewage outlet shaft; In the cofferdam: pumping station shaft", https://tideway.london/media/3944/19-12-16-kirtling-n-heaps-clwg-slides-final.pdf).
- **Built outline, OSM way 1424652921** (MEASURED vertices; DERIVED local metres; origin 51.483038, -0.135954):
  `(17.1,-4.8) (14.8,-5.4) (-12.5,-12.5) (-15.3,-13.1) (-13.8,5.7) (11.0,13.7)`
  - West end: 18.9 m on bearing 005 (DERIVED).
  - River face: **26.1 m** on bearing 072 (DERIVED). The OSM sea-wall way 1424652925 and railing way 1424652924 follow exactly this edge.
  - East end: 19.5 m on bearing 162 (DERIVED).
  - Landward edge: about 31 m on bearing 255 (DERIVED).
  - Area: **556 m²** (DERIVED from OSM). Tideway: "around a fifth of an acre in size" (MEASURED, https://www.tideway.london/news/site-news/2025/august/mayor-of-london-opens-new-riverside-public-space-at-heathwall-quay/) = 0.2 x 4,047 = **about 809 m²** (DERIVED). The Tideway figure probably includes the new riverside walkway connecting to Middle Wharf; use 556 m² for the platform.
  - Minimum bounding rectangle 33.5 x 19.4 m, long axis bearing 075 (DERIVED).
- **Projection into the river:** about 15 to 19 m beyond the line of the adjacent river walls (DERIVED: the river face sits about 19 m north of the landward edge; the Riverlight wall to the west continues on bearing about 250 from the SW corner, OSM way 1424652925).
- **DCO cross-check:** the illustrative layout shows a five-sided structure angled out from the pumping station with the "Heathwall drop shaft (10m internal dia)" in its western half; the built OSM outline is a simpler quadrilateral of similar size.
- **Terraces:** none; one level deck. DCO parameter plan allowed intertidal terracing; none is visible in photos.

### 2. Height and facing

- **Levels (DCO, MEASURED on drawing, converted):** deck label **105.41 ATD = +5.41 m AOD** on the foreshore structure; top of river/parapet wall **105.41 to 105.85 ATD = +5.41 to +5.85 m AOD** (parameter plan, p9). The land shaft at Middle Wharf is labelled 104.50 ATD = +4.50 m AOD and the pumping-station area 105.85 ATD.
- **Relative to water (DERIVED):** deck about 1.4 m above MHWS (about +4.0 m AOD) and about 7.6 m above MLWS (about -2.2 m AOD).
- **Relative to the embankment:** level with the adjoining Thames Path (Tideway Walk) at Riverlight; Tideway stresses "level access across the space" (MEASURED, https://www.tideway.london/locations/heathwall-pumping-station/).
- **Facing:** the outer river wall is a plain grey concrete wall with a pale concrete coping (photo heathwall-1; brixtonbuzz photos of the outfall face show weathered concrete with timber rubbing strips on the older adjoining wall). Fair-faced concrete is ESTIMATED; no source names the wall finish. A PLA warning sign on the wall marks a submerged storm outlet extending 90 m.

### 3. Shaft cover

- In-river shaft: the pumping station drop shaft, **10 m internal diameter** (MEASURED, DCO), excavated to **26 m depth** (MEASURED, Dec 2019 CLWG slide 5). OSM maps it (way 1121945714) as a circle about **11.7 m external diameter** centred **51.483027, -0.136041** (DERIVED), i.e. in the **western half** of the platform, about (-6, -1) in local metres.
- Main CSO drop shaft: **16 m internal** (MEASURED, DCO Work No. 14a), on land at Middle Wharf, OSM way 1121945713, about 18.5 m external diameter, centred 51.482871, -0.135290 (DERIVED), about 50 m east-south-east of the platform centroid. Excavation was at 45 m depth in Dec 2019 (MEASURED).
- Form: **flush**. July 2023 CLWG minutes: "Shafts and chambers roofs poured and access covers installed" and "There are a number of access panels on site that provide us access to the tunnel" (MEASURED, https://www.tideway.london/media/6661/krst-and-heaps-clwg-19-july-2023-minutes-web.pdf). Framed paving-infill covers are visible in the deck (Tideway opening photo).

### 4. Ventilation columns

- **On the river platform: none seen.** The opening photos (Tideway, Brixton Buzz) show an open deck with benches, a totem sign and railings only.
- **At Middle Wharf (land, east of the pumping station building): at least 1** dark twisted signature column is visible standing behind the boundary wall (photo heathwall-3, top left). The DCO put the shaft ventilation column zone at Middle Wharf ("1.2m internal dia ventilation column of 4m minimum to 8m maximum height") and a 6 m column for the pumping-station interception chamber on the foreshore structure. Count at Middle Wharf: 1 confirmed (ESTIMATED that there is only one; a second could be hidden).
- **Height:** 5.1 m (DERIVED from the Central-contract rule). **Material:** not stated; dark patina like the others.
- **Note:** the July 2023 CLWG line "The ventilation column will then sit on top of the slab" sometimes quoted for Heathwall is about the **Kirtling Street** air treatment unit, not Heathwall (same minutes, item 2.4).

### 5. Other permanent features

- **Railings:** black steel vertical-bar balustrade about 1.1 m on a low concrete upstand with a pale coping along the river face and ends (photos heathwall-1, heathwall-2).
- **Security screen:** a tall black **vertical-fin steel fence**, about 2.5 to 3 m high (ESTIMATED), on a pale concrete plinth, along the landward (south) side separating the quay from the pumping station compound; it continues as "high-quality architectural fencing around the pumping station compound" (Tideway site page). Short steel anti-climb spikes at the fence ends over the water (Brixton Buzz).
- **Seating:** timber benches on stainless or granite supports facing the river, with wheelchair spaces at the ends (Tideway; OSM benches 13094934420 and 13094934421 near the east end).
- **Paving:** **Portuguese granite** (MEASURED, July 2023 CLWG minutes item 3.3), laid as long setts in grey, dark grey and green-grey tones in a random stretcher pattern (photos).
- **Signage:** a dark information totem near the centre (OSM node 13094934419); a steel portal gateway reading "HEATHWALL QUAY / TO MIDDLE WHARF" at the east entrance (Tideway opening photo).
- **Lighting:** slim black lamp columns with disc lanterns along the walkway (photos).
- **Middle Wharf jetty** (safeguarded wharf, existing, OSM way 201508649, 162 m² pier) stands just downstream; not part of the quay.
- **Artwork:** Tideway lists Isamu Noguchi's "Play Sculpture" (a red steel ring made from sewer pipe) for this site; I did not see it in the photos of the quay itself, so its position is unconfirmed.

### 6. Sources

- Tideway site page: https://www.tideway.london/locations/heathwall-pumping-station/ (level access, granite, benches, fencing, Noguchi, 45 m connection tunnel)
- Tideway news, Aug 2025 opening: https://www.tideway.london/news/site-news/2025/august/mayor-of-london-opens-new-riverside-public-space-at-heathwall-quay/ (a fifth of an acre)
- Brixton Buzz photo essay, Oct 2025: https://www.brixtonbuzz.com/2025/10/in-photos-thames-path-extended-as-heathwall-quay-opens-between-vauxhall-and-battersea-power-station/
- DCO Book of plans section 16: https://www.tideway.london/media/2037/216-heathwall-pumping-station-plans.pdf (p9 parameter plan; p11 permanent works layout)
- Design Principles APP206.01, table 4.24 (HEAPS.01 to .10): https://www.tideway.london/media/1896/app20601-design-principles.pdf
- CLWG slides Dec 2019 and minutes July 2023 (links above)
- OSM ways 1424652921 (quay), 1424652925 (sea wall), 1424652924 (railing), 1121945713 and 1121945714 (shafts), 361512529 (pumping station)

### 7. Photos

No CC-licensed photo of the finished quay exists on Wikimedia Commons or Geograph as of 06Nov26f (searched "Heathwall", "Heathwall Quay", "Nine Elms Tideway" and grid square TQ2977; the Geograph images there are of Nine Elms Lane). The three files below are from Brixton Buzz; **the page states no licence, so treat them as all rights reserved: reference for modelling only, do not redistribute or ship in the game.**

| file | source | author | licence | shows |
|---|---|---|---|---|
| `photos/heathwall-1.jpg` | https://i0.wp.com/www.brixtonbuzz.com/img/heathwall-quay-04.jpg | Brixton Buzz (article by mike urban, Oct 2025) | none stated (all rights reserved) | The finished deck looking north-west to Pimlico: granite setts, black vertical-fin screen on the left, black railing on a concrete upstand on the right, benches and totem. |
| `photos/heathwall-2.jpg` | https://i0.wp.com/www.brixtonbuzz.com/img/heathwall-quay-05.jpg | Brixton Buzz | none stated | The deck looking west (upstream) towards Battersea Power Station and the Battersea Barge, showing the full width and the river railing. |
| `photos/heathwall-3.jpg` | https://i0.wp.com/www.brixtonbuzz.com/img/heathwall-quay-01.jpg | Brixton Buzz | none stated | The Middle Wharf approach with the "MIDDLE WHARF TO HEATHWALL QUAY" portal; a dark twisted ventilation column stands behind the wall by the pumping station building. |

### Build summary (heathwall)

- **Footprint:** quadrilateral, centroid 51.483038, -0.135954. Local vertices (x east, z north, m): SW (-15.3, -13.1), NW (-13.8, 5.7), NE (11.0, 13.7), SE (17.1, -4.8). River face NW to NE, 26 m on bearing 072. Landward edge SE to SW abuts the pumping station frontage.
- **Deck:** flat at +5.41 m AOD; level with the Thames Path; MHWS about +4.0, MLWS about -2.2. Deck about 1.4 m above MHWS and about 6 m above the low-tide mud (ESTIMATED foreshore about -0.5 m AOD).
- **River wall:** vertical grey concrete with pale coping, no terraces.
- **Railing:** black vertical-bar steel, 1.1 m, on a 0.3 m concrete upstand, on the three river-facing sides.
- **Screen:** black vertical-fin fence about 2.7 m tall on a 0.4 m pale plinth along the landward edge.
- **Shaft cover:** flush; 10 m shaft centred about (-6, -1); framed covers in the paving.
- **Vent columns:** none on the platform. Place 1 signature column (5.1 m, about 1.2 m diameter, dark bronze) on land at Middle Wharf near 51.48290, -0.13540 (ESTIMATED from photo heathwall-3 and the DCO column zone).
- **Finishes:** grey and green-grey granite setts; 2 to 3 timber benches near the centre and east end; dark totem sign about 2.5 m tall.

### Confidence (heathwall)

- Outline: **high** (OSM sea wall, railing and area all coincide); area vs Tideway's figure **medium**.
- Levels: **medium** (DCO illustrative).
- Shaft position: **high** (OSM and DCO agree).
- Vent columns: **low** (count at Middle Wharf from one photo; none on the deck is fairly confident).
- Wall finish: **low to medium**.
- Missing: a CC-licensed photo; as-built levels; column count and exact position; Noguchi sculpture location.

---

## albert: Albert Embankment Foreshore (built names: Isle of Effra and Effra Quay)

Two separate foreshore structures on the south bank at Vauxhall, about 140 m apart, both "extending into the foreshore" (MEASURED, Tideway 2021 news, https://www.tideway.london/news/site-news/2021/april/shaft-secondary-lining-completed-at-albert-embankment):

- **Isle of Effra** (the DCO "interception structure"): a round platform on the **downstream (north-east) side of Vauxhall Bridge**, tucked against the bridge's south abutment and the SIS (MI6) building's river wall, over the Effra CSO interception chamber.
- **Effra Quay** (the DCO "shaft structure"): a raised quay north of the SIS building and Lack's Dock slipway, in front of Camelford House, over the main 16 m drop shaft. Carries the two ventilation columns.

### 1. Platform outline

**Isle of Effra**

- **Shape:** circular deck framed by a curved concrete parapet, with **planted intertidal terraces** stepping down around it (Hawkins\Brown: "a circular platform framed by terraces of intertidal planting, as a viewing point out in the river"). Three steel monopile dolphins with yellow tops stand in the river beyond it, linked by a floating boom (photo albert-3; DCO: "Steel monopile dolphins to prevent vessels from grounding on structure").
- **Built outline, OSM way 1413447838** (MEASURED vertices; DERIVED local metres; origin 51.487317, -0.125642):
  `(11.5,-2.2) (9.2,-5.6) (8.2,-7.1) (6.7,-9.4) (4.8,-12.2) (1.8,-11.6) (-5.5,-10.1) (-9.2,-5.9) (-11.8,-1.5) (-11.1,2.1) (-10.6,4.7) (-5.5,10.5) (-2.8,11.1) (0.0,11.7) (6.6,10.0) (10.4,4.0)`
  - About **23 m across** both ways (minimum bounding rectangle 22.5 x 23.0 m) (DERIVED); area **404 m²** (DERIVED). The south-east side (11.5,-2.2) to (4.8,-12.2) is straight, on bearing 214, and abuts the existing river wall line (OSM sea wall 1413447837 continues NE on the same bearing along the SIS frontage). The rest is a rounded arc projecting about **20 m** north-west into the river (DERIVED: perpendicular distance from that wall line to the far arc).
  - The DCO illustrative layout (DCO-PP-15X-ALBEF-170010, p14) shows the round top on a larger elongated terraced mound that wraps the bridge abutment and passes partly under the bridge; the terraces are not in the OSM polygon.

**Effra Quay**

- **Shape:** an elongated quay with a rounded river edge, running NNE-SSW along the river wall in front of Camelford House, about **42 m long and 20 to 25 m wide** (DERIVED; minimum bounding rectangle 41.8 x 24.9 m, long axis bearing about 027).
- **Built outline, OSM way 1480924681** (MEASURED vertices; DERIVED local metres; origin 51.488191, -0.124388):
  `(-3.9,17.8) (-7.6,15.0) (-14.4,0.1) (-14.4,-5.7) (-11.9,-11.6) (0.1,-24.7) (1.6,-21.6) (7.6,-7.7) (18.8,12.4) (14.8,14.8) (10.9,14.5)`
  - Area **798 m²** (DERIVED). The west side (x about -14) is the river edge; the east side, on bearing 023 to 029, is the landward Thames Path line. The polygon probably includes the widened Thames Path across the structure (ALBEF.11 requires a minimum 4 m path over it).
  - DCO (Permanent works layout sheet 2, DCO-PP-15X-ALBEF-170011, p15): a rounded-corner quay projecting from the "original outside face of river wall", with ramps "up to 0.5m above original ground level" at both ends.
- **Projection into the river:** about 15 to 18 m beyond the original wall face (ESTIMATED from the DCO sheet 2 drawing at 1:400, where the shaft zone square of about 19 m sits mostly outside the old wall).

### 2. Height and facing

- **Isle of Effra deck:** DCO illustrative **104.50 ATD = +4.50 m AOD**; terraces stepping down at **102.20, 101.51, 101.41, 101.20 ATD = +2.20, +1.51, +1.41, +1.20 m AOD** (MEASURED on drawing, converted). ALBEF.03: top of the interception structure "below the springing point of the bridge arch". Relative to water (DERIVED, Vauxhall MHWS +4.01, MLWS -2.29, HAT +4.51): deck about 0.5 m above MHWS and level with HAT, so on the very highest tides the deck is at water level. The terraces sit between MLWS and MHWS, which is the point (intertidal habitat, ALBEF.04). **Caution:** the built deck appears level with the Thames Path entrance in photo albert-1; the as-built deck may be higher than the DCO figure.
- **Isle parapet:** a curved, pale fair-faced concrete parapet wall about 1 to 1.5 m high with a stainless steel handrail on top (photo albert-1 and the Tidal Thames photo from the bridge; OSM wall 1413447833 tagged material=concrete, est_height=1.5). The outer walls below the parapet are also pale fair-faced concrete (ALBEF.19: "high quality fair faced concrete"). Boulders bed the terraces into the foreshore (ALBEF.05, photo albert-3).
- **Effra Quay deck:** DCO illustrative **106.40 ATD = +6.40 m AOD**, with the river wall at 106.00 ATD = +6.00 m AOD; ALBEF.10: "elevated to the existing flood defence level". Parameter plan: top of river/parapet wall **105.41 to 106.00 ATD = +5.41 to +6.00 m AOD** (Site works parameter plan DCO-PP-15X-ALBEF-170008, p12). Relative to water (DERIVED): about 2.4 m above MHWS, about 8.7 m above MLWS. About 0.5 m above the existing Thames Path, reached by gentle ramps (DCO).
- **Effra Quay wall:** pale buff fair-faced concrete with vertical timber fenders (photo "Vauxhall, view of Effra Quay", AndyScott, CC0, viewed but not saved); ALBEF.19.

### 3. Shaft cover

- Main CSO drop shaft **16 m internal diameter** (MEASURED, DCO Work No. 15a, sheet 2), **49 m deep** (MEASURED, Tideway 2021), under **Effra Quay**, centred towards its southern half (DERIVED from DCO sheet 2: shaft zone centred about 10 m inside the river edge).
- **Conflict:** The Tidal Thames blog (https://thetidalthames.com/2025/10/12/thames-path-along-albert-embankment-re-opened/) says darker granite on the **Isle of Effra** "traces a 16-metre-diameter shaft beneath the Isle". The DCO drawings put the 16 m shaft under the northern (Camelford House) structure and only the interception and valve chamber under the Isle. I trust the DCO; the dark ring on the Isle is probably the outline of the interception chamber, or a reference to the lost river Effra (ALBEF.20).
- Form: **flush** on both structures. Isle: grey granite with a darker granite band tracing a circle and the line of the Effra (Tidal Thames; photo albert-1 shows framed flush covers). Effra Quay: flush covers and inset uplights in grey granite (photo albert-2).

### 4. Ventilation columns

- **Effra Quay: 2** signature columns (MEASURED: "two five metre high Tideway tunnel ventilation columns on Effra Quay", Tidal Thames; photo albert-2).
  - **Height:** 5 m (MEASURED, Tidal Thames) / **5.1 m** (MEASURED, City of London paper, Central contract). Use 5.1 m. DCO: "2 No. 0.9m internal dia ventilation columns of 4m minimum to 6m maximum height".
  - **Diameter:** about 1.2 to 1.4 m at the top, a little less at the base (ESTIMATED from photo albert-2 and the Hawkins\Brown photo, where each column is about 4 diameters tall).
  - **Material and colour:** **cast iron** per the City of London paper ("one of the cast iron columns for the Tideway Albert Embankment Foreshore site prior to installation"); Hawkins\Brown says bronze for all sites. Sources differ; the City paper is specific to this site, so prefer **cast iron**, colour dark charcoal grey to black (photos).
  - **Form:** two twisted, flared cylinders side by side about 2 to 3 m apart, one slightly taller-looking, slanted tops; poems by Dorothea Smartt on the lost River Effra ("River Effra stubbornly underground, resurrects a coffin, sends it bobbing down the Thames", Tidal Thames).
  - **Position:** near the **south-west corner of Effra Quay, close to the river edge** (photo albert-2 and the Hawkins\Brown photo looking south towards SIS and Vauxhall Bridge). DCO put the column zone at the south-west by the air treatment chamber.
- **Isle of Effra:** no signature columns. **Two slim dark green cylindrical columns**, about 0.4 m diameter and about 6 m tall, stand at the landward (south-east) side of the circle by the entrance (photo albert-1, Tidal Thames bridge photo). These match the DCO's "2 No. 0.225m internal dia ventilation columns, 6m high" serving the Brixton Storm Relief interception (ESTIMATED identification). One more 0.225 m, 6 m column was planned by the Clapham Storm Relief chamber under the bridge abutment (DCO), not confirmed.

### 5. Other permanent features

- **Isle of Effra:** grey granite paving with darker lines (the lost Effra); 4 timber benches arranged around the centre (OSM nodes 12989301645 to 12989301648, wood, two with backs); stainless handrail on the concrete parapet; life rings; an entrance marked by lettered granite ("ISLE OF EFFRA"); two bronze A3 plaques by Richard Wentworth ("Negative" and "Positive"); planted intertidal terraces in curved concrete beds; three yellow-topped steel monopile dolphins with a yellow floating boom offshore; a lockable gate for SIS security closure (ALBEF.06).
- **Effra Quay:** dark vertical-bar railing on the curved river edge; six bronze sculptural seats in three sizes by Richard Wentworth, shaped like conjoined toilets (Hawkins\Brown; Unfinished City); timber benches with backs (OSM nodes 13378956750 and 13378956751, 8 seats each); zinc-clad "beach huts" hiding electrical and mechanical kit (Tidal Thames); stainless sign "EFFRA QUAY" set into granite; ladder and grab chains on the river wall; trees along the widened Thames Path (Thames Water); an information map board.
- **Context to draw nearby:** Vauxhall Bridge (1906, red-painted steel arches with bronze statues) immediately upstream of the Isle; the SIS building river wall with lion-head mooring rings and an ornamental colonnade on its terrace; Lack's Dock slipway (OSM node 306297337) between the SIS frontage and Effra Quay.

### 6. Sources

- Tideway site pages: https://tideway.london/locations/albert-embankment-foreshore ; https://tideway.london/locations/effra-quay-isle-of-effra/
- Tideway news 2021 (49 m shaft, two public spaces): link above
- Hawkins\Brown project page: https://www.hawkinsbrown.com/projects/thames-riverside-parks/
- Thames Water: https://www.thameswater.co.uk/about-us/community/days-out/riverside-spaces/discover-the-sites/effra-quay-and-isle-of-effra
- The Tidal Thames blog, 12 Oct 2025 (two 5 m columns, zinc huts, granite, 16 m shaft claim): https://thetidalthames.com/2025/10/12/thames-path-along-albert-embankment-re-opened/
- The Unfinished City, 26 Feb 2026 (Wentworth seats and plaques, semicircular benches): https://www.theunfinishedcity.co.uk/2026/02/new-public-realms-along-river-thames.html
- DCO Book of plans section 17: https://www.tideway.london/media/2036/217-albert-embankment-foreshore-plans.pdf (p12 parameter plan; p14 and p15 permanent works layouts)
- Design Principles APP206.01, table 4.26 (ALBEF.01 to .21): https://www.tideway.london/media/1896/app20601-design-principles.pdf
- City of London poetry paper (cast iron, 5.1 m): link in the header
- OSM ways 1413447838 (Isle), 1480924681 (Effra Quay), 1413447833 (Isle parapet), 1413447837 (sea wall), 378283142 (Vauxhall Bridge); bench and life-ring nodes
- PLA Tide Booklet 2026 p19

### 7. Photos

| file | source | author | licence | shows |
|---|---|---|---|---|
| `photos/albert-1.jpg` | https://commons.wikimedia.org/wiki/File:Isle_of_Effra_2025-06-27.jpg | Matt Brown | CC BY 4.0 | The finished Isle of Effra deck from its entrance: lettered granite, grey granite paving, timber benches, pale concrete parapet with stainless rail, one of the slim dark green columns on the left, Vauxhall Bridge behind. |
| `photos/albert-2.jpg` | https://commons.wikimedia.org/wiki/File:Ventilation_shafts_on_Effra_Quay_2025-06-27.jpg | Matt Brown | CC BY 4.0 | The two dark twisted ventilation columns on Effra Quay, granite deck with inset uplights, curved dark railing, Millbank Tower and the Palace of Westminster downstream. |
| `photos/albert-3.jpg` | https://commons.wikimedia.org/wiki/File:Floating_barrier_near_Isle_of_Effra_2025-06-27.jpg | Matt Brown | CC BY 4.0 | Looking downstream from the Isle: curved concrete parapet, intertidal planting, boulders, two yellow-topped steel dolphins and the floating boom, the SIS river wall on the right. |

### Build summary (albert)

Draw two structures.

**Isle of Effra**
- **Footprint:** near-circle about 23 m diameter, centroid 51.487317, -0.125642, flattened on its south-east side where it meets the river wall (straight edge 13 m on bearing 214 from (11.5, -2.2) to (4.8, -12.2)). It sits just downstream of Vauxhall Bridge's south abutment.
- **Deck:** +4.50 m AOD (DCO; possibly higher as built), grey granite with a darker circular band and a dark meandering line.
- **Parapet:** pale concrete, about 1.1 m above the deck, stainless handrail on top, following the circle.
- **Terraces:** 3 to 4 concentric planted concrete-edged steps outside the parapet on the north and west, down to about +1.2 m AOD, then boulders to the foreshore (foreshore about 0 to -1 m AOD, ESTIMATED). Make them about 2 to 3 m wide each (ESTIMATED from DCO).
- **Columns:** 2 slim dark green cylinders, 0.4 m diameter x 6 m, at the south-east side near the entrance.
- **Furniture:** 4 timber benches facing outwards in a ring around the centre.
- **River items:** 3 steel monopiles about 1 m diameter, rust-brown with yellow tops, about 5 to 10 m off the north and west edges, joined by a yellow floating boom.

**Effra Quay**
- **Footprint:** elongated rounded quay, centroid 51.488191, -0.124388, local vertices as listed above; long axis bearing about 027, about 42 x 22 m; river edge on the west/north-west.
- **Deck:** +6.40 m AOD, about 0.5 m above the Thames Path, ramps at both ends; mixed light and mid grey granite in a random pattern.
- **River wall:** pale buff concrete with vertical timber fenders; dark vertical-bar railing about 1.1 m along the curved river edge.
- **Vent columns:** 2, near the south-west end by the river edge, 5.1 m tall, about 1.3 m diameter, twisted, slanted tops, dark charcoal cast iron, 2 to 3 m apart.
- **Shaft cover:** flush, 16 m internal shaft (about 19 m external) centred in the southern half; framed covers and small circular uplights in the paving.
- **Furniture:** 2 long timber benches with backs; 6 bronze toilet-shaped seats; 2 or 3 small zinc-clad kiosks about 2.5 x 2 x 2.5 m on the landward side; trees along the Thames Path.

### Confidence (albert)

- Outlines: **high** (OSM, consistent with DCO and photos).
- Levels: **medium** for Effra Quay, **low to medium** for the Isle (DCO figure may be below the as-built).
- Effra Quay columns: count **high**, height **high**, material **medium** (sources conflict), diameter **low to medium**.
- Isle columns: **low** (identification from photos only).
- Terrace widths and dolphin positions: **low**.
- Missing: as-built levels; Lambeth discharge-of-requirement drawings (not found online); a source that settles where the 16 m shaft is.

---

## Gaps common to all four sites

- **As-built drawings.** The detailed architectural and landscape designs discharged under DCO Schedule 3 by Wandsworth, Kensington and Chelsea and Lambeth (2019 to 2022) would give exact as-built levels and dimensions. I did not locate them online in the time available. The Design and Access Statements (doc 7.04) on tideway.london (https://tideway.london/contact-us/document-library/project-design-and-engineering) are image-only PDFs whose text layer is unreadable; I relied on the Book of plans and Design Principles instead.
- **Column diameters** are estimated everywhere; no source gives an outside diameter.
- **Foreshore bed levels** at each wall foot are not published in what I read.

---

---
agent: wA (research subagent)
date: 06Nov26f
topic: Thames Tideway Tunnel permanent foreshore structures, east four sites (victoria, blackfriars, kemp, chambers)
type: research
project: UnderGround
---

# Tideway permanent foreshore structures: victoria, blackfriars, kemp, chambers

Tags used on every number: **MEASURED** (stated in a source), **DERIVED** (computed by me from a source; working shown), **ESTIMATED** (my judgement; basis stated).

## Read this first: four corrections to the game's current assumptions

1. **The `victoria` site is not "Bazalgette Embankment".** The Victoria Embankment Foreshore opened as **Tyburn Quay** (Tideway location page; Commons category; OSM `start_date=2025-10-23`, which I could not confirm from a primary source). **Bazalgette Embankment is the `blackfriars` site** (Tideway press release 2020 naming it; Tideway press release 13 Jan 2026 announcing its opening; City of London report 25 Jun 2025).
2. **`chambers` has no permanent in-river structure.** The large temporary cofferdam built into the river is being removed and "the river wall [returned] to its earlier alignment" (Tideway CLWG notes, 16 Jun 2025 and 15 Dec 2025). What is left above water is a new river wall on roughly the old line, plus a small block-paved operational area on land, three ventilation columns, a kiosk and an artwork. Drawing it as a platform in the river would be wrong.
3. **All four game positions are 140 m to 320 m off.** Each is in the river or in a park, not on the structure. Corrected points are in each site's Build summary, and in the table below.
4. **Datums.** All Tideway drawings use **ATD (Tunnel Datum) = AOD + 100 m** (stated on every DCO drawing: "Tunnel Datum which is 100 metres below Ordnance Datum Newlyn"). So 105.41 m ATD = 5.41 m AOD. I convert everything to m AOD below.

| id | game (lat, lon) | corrected anchor (lat, lon) | what the anchor is | offset (DERIVED) | OS grid (DERIVED) |
|---|---|---|---|---|---|
| victoria | 51.5075, -0.1190 | **51.50552, -0.12243** | drop-shaft centre / middle of platform | 324 m | TQ 304 801 (E530407 N180181) |
| blackfriars | 51.5095, -0.1050 | **51.51079, -0.10643** (platform centroid); shaft ~51.51072, -0.10730 | OSM area centroid; shaft estimated from DCO plan | 174 m | TQ 315 807 |
| kemp | 51.5095, -0.0490 | **51.50873, -0.04733** (platform centroid); shaft ~51.50869, -0.04743 | OSM polygon centroid; shaft from DCO plan, matches OSM vortex columns | 144 m | TQ 356 806 |
| chambers | 51.5014, -0.0678 | **51.50074, -0.06549** | drop-shaft centre (on land, behind the river wall) | 176 m | TQ 343 797 (E534372 N179752) |

Working for the offsets: haversine-style flat distance, 111,132 m per degree latitude, 111,320 x cos(lat) m per degree longitude. OS grid conversion: Helmert WGS84 to OSGB36 plus the OS Transverse Mercator formulae, checked against the Tower of London (51.5081, -0.0759 gave TQ 336 805, which is correct). Note that the game's TQ 342 798 for Chambers Wharf lands exactly on the **west end of the Chambers Wharf river wall** (DERIVED 51.50120, -0.06684), so it was probably a site reference point, not the shaft.

## Tide and level reference (applies to all four)

| level | value | source / tag |
|---|---|---|
| Mean High Water Springs (MHWS) | 3.90 m AOD (103.90 ATD) at Victoria, KEMP, Chambers; 3.85 m AOD at Blackfriars | MEASURED: DCO sections VCTEF-180014, KEMPF-250010, CHAWF-210011, BLABF-190024 |
| MHWS (updated, Chambers Wharf) | 4.03 m AOD (+104.03 ATD) | MEASURED: Tideway CLWG slides 15 Dec 2025, slide 11 |
| Mean High Water Neaps (Chambers) | 2.83 m AOD | MEASURED: same slide |
| Mean Low Water Springs | -2.50 m AOD Victoria; -2.65 Blackfriars; -2.80 KEMP and Chambers | MEASURED: same DCO sections (97.5, 97.35, 97.20 ATD) |
| Tidal range for the game | about 6.5 m spring range | DERIVED: 3.9 - (-2.6) |
| Flood defence level (wall tops) | 5.41 m AOD (Victoria, Blackfriars "2020 flood defence level"); 5.23 KEMP; 5.28 Chambers | MEASURED: same sections |

---

## victoria: Victoria Embankment Foreshore (opened as Tyburn Quay)

Opposite the London Eye, in front of Whitehall Gardens, between Hungerford Bridge (north) and Westminster. Tideway's site page calls it Tyburn Quay. The Sir Joseph Bazalgette memorial is "approximately 25m to the north of the site" (MEASURED, Planning Statement P.2.6).

### 1. Platform outline

- **Shape**: an orthogonal, stepped (castellated) rectangle projecting from the listed granite embankment wall: a narrow strip at each end and a deeper square "nose" in the middle. Designed as "an orthogonal shape to echo the existing Bazalgette projections, such as the listed Cleopatra's Needle/Whitehall Stairs and steamer piers" (MEASURED, Planning Statement P.5.36). The Guardian (Wainwright, 12 Aug 2025) describes "a more sober granite plaza raised on a square plinth".
- **As-built outline from OpenStreetMap** (way 1453910407, `barrier=wall`, traced along the new river edge). Vertices, south to north (lat, lon), then back along the embankment wall:
  `51.505293,-0.122728` (south tie-in at the old wall, by the outfall) → `51.505287,-0.122687` → `51.505266,-0.122555` → `51.505410,-0.122496` → `51.505377,-0.122290` → `51.505586,-0.122205` → `51.505610,-0.122358` → `51.505725,-0.122311` → `51.505750,-0.122467` → `51.505755,-0.122502` → `51.505734,-0.122510` → `51.505740,-0.122551` (north tie-in), then close along the embankment wall back to the start.
- **Area**: 1,069 m² (DERIVED: shoelace on the OSM vertices in local metres). Tideway states **1,085 m²** (MEASURED, tideway.london/locations/tyburn-quay). These agree within 2%, so the OSM outline is a good as-built trace. The DCO planning statement gave a permanent foreshore take of "0.1 ha" (MEASURED, P.5.99).
- **Dimensions in the structure's own axes** (DERIVED from the OSM vertices; wall chord bearing 14° from north, outward normal bearing 104°):
  - Length along the embankment wall: **51.2 m**.
  - South strip: projects **12.4 m** for the first **16.5 m** of wall length.
  - Central nose: projects **27.2 m** for the next **24.0 m** of wall length.
  - North strip: projects **16.5 m** for the next **13.2 m**, then a small 2.9 m step back to the wall over the last ~11 m.
  - Every edge is either parallel (14°) or perpendicular (104°) to the wall: a pure rectilinear polygon.
- **DCO maximum envelope** (Site works parameter plan DCO-PP-16X-VCTEF-180008, Jan 2013): my measurement of the orange "maximum extent" line gives about 50 m along the wall, 14 m projection at the north end, 23 m at the nose, about 860 m² (DERIVED, scaled at 1:1000 on A3 at 3.94 px/m; rough). It is the same family of shape as the OSM trace; later NMAs (2020) only moved the shaft parameter slightly westward (MEASURED, PINS decision letter 14 Aug 2020).
- **Terraces / levels**: three zones (MEASURED, P.5.26 to P.5.34): (a) a landward "embankment terrace" flush with the existing Embankment footway, with the kiosks and canopy; (b) a **raised central viewing platform about 1 m higher**, reached by steps and ramps; (c) **river-facing terraces stepping down towards the river "in approximately 400mm increments"**, arranged slightly asymmetrically to face south and east; "the lowest step would flood only at the highest tides (three times per typical year)". Tideway's page: "stepped terraces ... lower terraces occasionally flood at very high tides".

### 2. Height

- Top of river wall/parapet: **5.41 m AOD minimum** (105.41 m ATD) (MEASURED, VCTEF-180008 Typical Section A; the section drawing VCTEF-180014 labels this the "2020 flood defence level 105.41m ATD").
- Public space on top of the structure "at the same height as the flood defences" (MEASURED, P.4.59), so the raised platform is about **5.4 m AOD**.
- River terraces: top of terracing 5.55 m AOD minimum, lowest terrace **4.20 m AOD maximum** (MEASURED, VCTEF-180008 Typical Section B, 105.55 and 104.20 ATD). Lowest step therefore sits about 0.3 m above MHWS (3.90 m AOD), consistent with flooding a few times a year (DERIVED).
- Embankment terrace and footway level: about **4.4 m AOD** (ESTIMATED: raised platform 5.4 m minus the stated ~1 m level difference).
- Height above mean low water springs: about 7.9 m from MLWS (-2.5 m AOD) to the platform (DERIVED).
- Wall facing: **new granite river wall "set at a slight incline to reduce its apparent bulk"**, with horizontal grooves cut to mark tide heights (MEASURED, P.5.37). Paving: granite (MEASURED, Tideway page: "Granite is the main hard landscaping material").
- Balustrade: an open balustrade around the stepped terraces, solid parapet around the main structure (MEASURED, P.4.64, P.5.37). Tideway (Nov 2022) calls it "a bronze-finish balustrade around the foreshore structure"; in the photos it reads as dark/black vertical-bar railings.

### 3. Shaft cover

- Drop shaft: **13 m internal diameter, 51 m deep** (MEASURED, Tideway page; Planning Statement P.4.53 gives "approximately 13m").
- Cover: flush. "An inlaid ring of bronze in the ground marks the location of the gigantic drop shaft below the paving" (MEASURED, Guardian 12 Aug 2025). The paving is full of flush rectangular access hatches (visible in photo victoria-1).
- Position: under the central nose, about 29 m north of the south tie-in and 14 m out from the wall; centre **51.50552, -0.12243** (DERIVED from the blue shaft zone on VCTEF-180008 transferred onto the OSM outline; plus or minus 8 m).

### 4. Ventilation columns

- **Count: 2** (MEASURED: Commons file "Ventilation shafts - 17 May 2026" description "Two ventilation shafts on Tyburn Quay, each with an inscription about the River Tyburn"; City of London poetry report 6 Apr 2023 shows "Vent 1" and "Vent 2" at Tyburn Quay; Tideway Nov 2022 news: "The two Victoria poems both refer to the River Tyburn"; OSM node 13365748554 "Two stylised ventilation shafts").
  - The DCO also allowed "a smaller diameter ventilation column ... approximately 6m high" for the interception chamber (P.4.60). I found **no evidence it was built as a visible column**; treat as absent.
- **Height: 5 m** (MEASURED, Tideway news Nov 2022 "5m-high bronze"); **5.1 m above ground** (MEASURED, City of London poetry report §1.3.2, "5.1m height above ground level for the Central contract"). DCO cap: 6 m (MEASURED, DCO Sch.3 VCTEF5(2)).
- **Material and colour**: **bronze**; DCO requires "a dark bronze material" (MEASURED, VCTEF5(2)). Photos: dark brown-grey bronze, reads near-black against sky.
- **Form**: Tideway's "signature" twisted vortex column (DCO type B for this site). A tall tapered cylinder that is round at the base and flares to a larger, slightly elliptical and obliquely cut top, with a single sharp helical ridge running up the side where the two surfaces meet; the poem by Dorothea Smartt (about 150 characters, 60 mm Doves font, lower 3.5 m only) is engraved along that ridge (MEASURED, City of London poetry report §1.3.1). Two columns stand side by side about 2 m apart (ESTIMATED from photo victoria-2).
- **Diameter**: 1.2 m internal (MEASURED, DCO-stage figure for the signature columns, Planning Statement P.4.60 range and Chambers Wharf drop-in "1.2m in diameter at the base"). External about 1.3 m at the base and about 1.6 to 1.8 m across the flared top (ESTIMATED from photo victoria-2, scaled against people beside them).
- **Position**: OSM node at **51.505568, -0.122440**: about 34.5 m north of the south tie-in and 12 m out from the wall (DERIVED), i.e. on the raised central platform near its landward side. The planning statement's indicative design put "the twin ventilation columns ... in the southwestern corner of the raised central viewing platform" (MEASURED, P.5.24); photo victoria-1 shows them on the raised plinth with the London Eye behind to the right, consistent.

### 5. Other permanent features

- **Pavilion/kiosks with canopy** on the landward side: two stone-clad electrical and control kiosks plus amenity kiosks combined with a canopy to form the entrance (MEASURED, P.4.66 to P.4.67); built as "a faintly Miesian pavilion" housing a café and loos, "its stone walls inscribed with the profile of Bazalgette's sewer" (MEASURED, Guardian). Tideway page: café kiosk and accessible toilet; "three sewer profiles ... illustrated across building façades". Kiosk height cap including pergola **4 m** (MEASURED, DCO Sch.3 VCTEF4(2)). The canopy is a flat **black perforated metal roof on slim black steel posts** (photo victoria-1). OSM building footprints at 51.505541,-0.122608; 51.505337,-0.122689; 51.505722,-0.122536; roof at 51.505513,-0.122619.
- **Artwork**: Richard Wentworth's cast bronze sandbags, stacked and draped over the granite steps as perches (MEASURED, Tideway page; Guardian; photo victoria-1 shows one pile on the steps).
- **Seating**: timber benches facing upstream to Parliament; granite block benches on the terraces (MEASURED, Tideway page; photo victoria-1).
- **Trees**: new trees planted, number not stated; existing London plane tree pits improved with resin-bound gravel (MEASURED, Tideway page). Hawkins\Brown: London planes, Sturgeon lamp standards and sphinx benches reflect the street character (MEASURED, hawkinsbrown.com/projects/thames-riverside-parks).
- **Lettering**: "TYBURN QUAY" cut into the granite paving under the canopy (photo victoria-1).
- **Outfall**: OSM outfall node at 51.505252, -0.122745 just south of the structure.
- Replacement mooring for the Tattershall Castle was part of the DCO works (MEASURED, P.4.69).

### 6. Sources

- Tideway, Tyburn Quay location page: https://tideway.london/locations/tyburn-quay/ (area 1,085 m², shaft 51 m deep x 13 m wide, terraces, granite, kiosk, toilet, Wentworth sandbags).
- Tideway news, "Super sewer ventilation columns installed along Victoria Embankment", Nov 2022: https://www.tideway.london/news/site-news/2022/november/super-sewer-ventilation-columns-installed-along-victoria-embankment (5 m bronze, two Tyburn poems, bronze-finish balustrade).
- Planning Statement Appendix P, Victoria Embankment Foreshore (2013): https://tideway.london/media/1300/planning-statement_vctef.pdf (P.4.53 to P.4.69, P.5.21 to P.5.39, P.5.99).
- Book of Plans section 18 (DCO drawings VCTEF-180001 to 180044): https://www.tideway.london/media/1302/site-plan_victoria-embankment-foreshore.pdf (site works parameter plan 180008, section 180014 with levels).
- DCO, Thames Water Utilities Limited (Thames Tideway Tunnel) Order 2014, Schedule 3, para 16 (VCTEF4, VCTEF5): https://www.legislation.gov.uk/uksi/2014/2384/schedule/3/made/data.pdf
- PINS non-material change decision letter 14 Aug 2020: https://nsip-documents.planninginspectorate.gov.uk/published-documents/WW010001-006118-200814%20TTT%20DCO%20VCTEF-BLABF%20NMC%20Decision%20Letter-final.pdf
- City of London, Bazalgette Embankment poetry commission update, 6 Apr 2023 (column heights, poem placement, Tyburn Quay vents photographed): https://democracy.cityoflondon.gov.uk/documents/s186035/Appendix%201.%20Tideway%20Poetry%20Supporting%20Document.pdf
- Oliver Wainwright, The Guardian, 12 Aug 2025, "World's swankiest manhole covers?": https://www.theguardian.com/artanddesign/2025/aug/12/tideway-project-public-spaces-super-sewer-architecture
- Hawkins\Brown, Thames riverside parks: https://www.hawkinsbrown.com/projects/thames-riverside-parks/
- OpenStreetMap: relation 21838452 (Tyburn Quay), way 1453910407 (river edge wall), node 13365748554 (vent columns), retrieved via Overpass API 06 Nov 2026. OSM data © OpenStreetMap contributors, ODbL.
- Google Places "Tyburn Quay" 51.505763, -0.122291 (cross-check only).

### 7. Photos

- `victoria-1.jpg`: https://commons.wikimedia.org/wiki/File:Tyburn_Quay_-_2026-02-04.jpg, Matt Brown, CC BY 4.0, 4 Feb 2026. Shows: view east from under the black perforated canopy across granite paving lettered "TYBURN QUAY", granite steps up to the raised plinth with the two dark twisted columns, a bronze sandbag pile on the steps, black railings, London Eye beyond. Finished structure.
- `victoria-2.jpg`: https://commons.wikimedia.org/wiki/File:Ventilation_shafts_-_17_May_2026.jpg, Aethonatic, CC0, 17 May 2026. Shows: the two dark bronze twisted vent columns on the raised granite platform, engraved poem on the helical edge, Hungerford Bridge behind. Finished, in public use.

### Build summary

- **Outline**: use the 12 OSM vertices in §1 (WGS84) and close along the embankment wall. In local terms: a 51 m strip along the wall (bearing 14°), 12.4 m deep at the south, a 24 m wide by 27 m deep central square nose, 16.5 m deep at the north. Area about 1,070 m².
- **Levels** (m AOD): embankment footway and landward terrace ~4.4; raised central platform and wall tops 5.4; river-facing terraces stepping down in 0.4 m steps from ~5.4 to 4.2 at the outer edge; MHWS 3.9; MLWS -2.5. So at mean high water the deck stands ~1.5 m above the water; at low tide ~8 m, with mud foreshore exposed.
- **River wall**: pale grey granite, slightly battered (inclined) face with horizontal grooves; solid parapet round the main block, open dark railings round the stepped terraces.
- **Vent columns**: 2, 5.1 m tall, ~1.3 m base diameter flaring to ~1.7 m at an oblique top, twisted with one helical ridge, dark bronze (near-black brown). Position 51.505568, -0.122440, side by side ~2 m apart, on the raised platform.
- **Shaft cover**: flush; draw a bronze ring ~14 m diameter inlaid in the paving centred at 51.50552, -0.12243, plus scattered flush rectangular hatches.
- **Pavilion**: stone-clad kiosk blocks up to 4 m high along the landward side with a flat black perforated canopy on thin black posts between them.
- **Extras**: granite block benches on the terraces, a few bronze sandbag piles, a handful of trees on the landward side.

### Confidence

- Outline and area: **high** (OSM trace matches Tideway area to 2%).
- Levels: **medium-high** (DCO parameter values; built levels not published, but the design was required to meet them).
- Vent count, height, material: **high**. Column diameter: **medium** (internal 1.2 m stated; external estimated).
- Shaft centre: **medium** (plus or minus 8 m).
- Pavilion and canopy dimensions: **low-medium** (height cap known, plan size not found).
- Missing: Westminster's discharge-of-requirements approval drawings (would give exact kiosk and terrace dimensions); an as-built survey.

---

## blackfriars: Blackfriars Bridge Foreshore (opened as Bazalgette Embankment)

North bank, immediately west of (and partly under) Blackfriars Bridge, City of London. Named Bazalgette Embankment in 2020 (Tideway press release); opened January 2026 (Tideway press release 13 Jan 2026; Diamond Geezer blog, Jan 2026, "only opened earlier this week").

### 1. Platform outline

- **Shape**: a long tapering **wedge or blade**, broad and rounded at the west end, thinning to a narrow strip at the bridge. "The thin end of the wedge" is by the bridge; "the broad swooshy end" is to the west (MEASURED, Diamond Geezer). The DCO design was revised to "softening the geometry of the structure and introducing curved corners (most notably on the south-western corner)" and to cut projection into the channel by about 4 m (MEASURED, Planning Statement Appendix Q, Q.5.19, Q.5.27).
- **As-built outline from OpenStreetMap** (way 475978801 "Bazalgette Embankment", and the river-edge retaining wall way 1359837168). River edge, west tip to bridge (lat, lon):
  `51.510869,-0.107706` (west tip, on the old wall line) → `51.510734,-0.107550` → `51.510632,-0.107438` → `51.510591,-0.107351` → `51.510580,-0.107278` → `51.510596,-0.107096` → `51.510655,-0.106438` → `51.510730,-0.105557` → `51.510785,-0.104872` → `51.510788,-0.104589` (east end, under the bridge) → `51.510866,-0.104567`, then west along the old embankment wall line at **lat 51.51086 to 51.51087** back to the tip.
- **Dimensions** (DERIVED from OSM in local metres, origin at the centroid 51.510793, -0.106427; the old wall runs due east-west):
  - Length along the old wall: **218 m** (west tip to bridge). The Guardian says "the 250-metre long stretch" (MEASURED; likely includes the walkway east of and under the bridge). Sources differ.
  - Projection south from the old wall: **32 m** maximum about 30 m east of the west tip (DERIVED); ~28 m at 60 m from the tip; ~24 m at the midpoint; ~15 m at 150 m from the tip; ~9 m at the bridge.
  - West end: a rounded nose, radius roughly 15 to 20 m (ESTIMATED from the vertex curve).
- **Area**: OSM polygon **4,084 m²** (DERIVED, shoelace) = about 1.0 acre. Tideway's location page: "an area of around an acre" (MEASURED). Tideway's January 2026 press release: "a 1.5-acre public space" (MEASURED). **Sources conflict**; 1.5 acres (6,070 m²) probably counts the undercroft, steps and re-landscaped Embankment pavement as well. Draw the 4,084 m² wedge.
- **DCO maximum envelope** (BLABF-190010 site works parameter plan, Jan 2013): about 240 m along the wall and about 39 m maximum projection near the west end (DERIVED, measured on the A3 render at 1:2500, 0.635 m/px; coarse).
- **Levels and terraces**: "a central flat piazza is surrounded by steps, seated areas and changes of level"; "a raised terrace at the western tip ... large enough only for a few tables" (MEASURED, Diamond Geezer); "Raised, westward oriented terraces above flood level ... with seating" (MEASURED, Q.5.28a); a long planted terrace of beds (the green terraced area). A long pedestrian ramp descends from the bridge approach, with an enclosed undercroft beneath it (MEASURED, Diamond Geezer; City of London report).

### 2. Height

- Top of river wall/parapet: **5.41 m AOD minimum to 6.00 m AOD maximum** (105.41 to 106.00 m ATD) (MEASURED, BLABF-190010 Typical Section A). "2020 flood defence level 105.41m ATD" (MEASURED, section BLABF-190024).
- Deck: "the new public space on top of the structure would be at the same height as the flood defences" except where parapets are needed (MEASURED, Q.4.59). So the piazza is about **5.4 m AOD** (DERIVED); raised western terrace about 1 m higher (ESTIMATED). Guardian: most of the new spaces "slope subtly up towards the flood defence line".
- MHWS 3.85 m AOD; MLWS -2.65 m AOD (MEASURED, BLABF-190024). Deck stands ~1.5 m above MHWS and ~8 m above MLWS (DERIVED).
- River wall: the original Embankment wall here is "granite faced mass-gravity" (MEASURED, Q.5.116). The new wall's finish is not stated in what I found; photos (blackfriars-1) show pale granite-faced parapets with black railings on top. The DCO section shows "horizontal grooves mark river levels" and vertical timber fenders (MEASURED, BLABF-190024 annotations). Fenders were required by the PLA (MEASURED, Q.5.28k).
- Paving: "a broad granite expanse" (MEASURED, Guardian); Hawkins\Brown used "ductile iron in the paving at Blackfriars, to reference the iron deposits at the source of the Fleet" (MEASURED, Guardian quoting Fiona Stewart). Photo blackfriars-1 shows large grey-buff stone flags.

### 3. Shaft cover

- Drop shaft: **24 m internal diameter**, 53 m deep to invert (MEASURED, Q.4.56 and §4 of Appendix Q).
- Cover: flush, under the broad west end; "the paving is liberally scattered with rectangular access covers ... I lost count around 70" (MEASURED, Diamond Geezer). The DCO moved the shaft "closer to the existing river wall" (MEASURED, Q.5.19).
- Position: shaft centre about **51.51072, -0.10730** (DERIVED: shaft zone on BLABF-190010 lies 25 to 40 m east of the west tip and close to the old wall; transferred onto the OSM outline; plus or minus 15 m).
- A "ribbed rotunda" kiosk sits at the broad end; "too small a diameter to cover the invisible drop shaft", originally planned as a control cabin (MEASURED, Diamond Geezer). Diameter not found (ESTIMATED 6 to 8 m from his description).

### 4. Ventilation columns

- **Count: 3** (MEASURED: City of London poetry report §1.1.1 "each of the three ventilation columns"; Diamond Geezer "three twisty columns" at the western tip; photo blackfriars-2 shows three). The DCO had allowed five drop-shaft columns plus two smaller ones (Q.4.60 to Q.4.61); only three signature columns were built.
- **Height: 5.1 m above ground** (MEASURED, City of London poetry report §1.3.2, Central contract). DCO cap 6 m (MEASURED, Sch.3 BLABF6(2)). Photo blackfriars-2 shows **one of the three noticeably shorter** than the other two (ESTIMATED about 3.5 to 4 m, though perspective and a temporary barrier around its base in Sept 2025 make this uncertain).
- **Material and colour**: **cast iron** (MEASURED, poetry report §1.3.4; DCO-stage intent "black cast iron", Q.5.29a). As built they read **mid to dark grey**, "more grey than black" (MEASURED, Diamond Geezer; photo blackfriars-2).
- **Form**: the same signature twisted vortex form as Victoria (DCO type C for this site): round base flaring to an obliquely cut top, one helical ridge carrying the poem (three Smartt poems on the lost River Fleet).
- **Diameter**: 1.2 m internal (MEASURED, Q.4.60); external about 1.3 m base, 1.7 m top (ESTIMATED from photo).
- **Position**: western tip. OSM nodes for two of them at **51.510768, -0.107495** and **51.510795, -0.107571** (6 m apart, DERIVED); the third is unmapped, ESTIMATED within ~5 m of these.

### 5. Other permanent features

- **"Stages" by Nathan Coley**: five large dark sculptural forms in bespoke concrete with black aggregate (basalt/quartz), ranging **4 m to 9 m high** (MEASURED, Tideway location page). Named forms: **Kicker** (a thin pillar near the bridge), **Twins** (a pair rising out of the river wall, carrying timber fenders), **Zigzag** (the longest), **Waterwall** (the tallest, **8.8 m**, in a stepped pool with a cascade) (MEASURED: Diamond Geezer for names; Tideway press release 13 Jan 2026 for 8.8 m; Guardian "rising almost 10 metres"). Some are walkable platforms and form part of the flood defence. Photo blackfriars-1 shows two of them: sheer black slab faces about 9 m high with folded planes, one rising from the river wall.
- **Trees and planting**: **71 trees** plus shrubs, grasses, perennials and ferns on a planted terrace referencing the Fleet from woodland to meadow to marsh (MEASURED, Tideway page and press release).
- **Thames Path**: 4 m wide across the structure, 3 m east of the Fleet CSO (MEASURED, design principle BLABF.02, Q.5.150; Tideway page).
- **Bronze lion mooring rings** (1868, Timothy Butler) relocated from the old wall to line the new river edge (MEASURED, Diamond Geezer); DCO intended to retain most bronze-head mooring rings (Q.5.28e).
- **Undercroft and rifle range** under the bridge ramp: about **700 m²** and **280 m²** (MEASURED, City of London RASC report 25 Jun 2025), closed by unpolished metal panels / secure hoarding; public toilets at its western end.
- **Access**: new staircase from Blackfriars Bridge; long pedestrian ramp; lift east of the bridge to the relocated Blackfriars Pier (MEASURED, Q.5.28i to j; Tideway page).
- **Café**: Thames Water land "including a public café" (MEASURED, City report); likely in the rotunda.
- Retractable electronic bollards along the Embankment edge (MEASURED, Diamond Geezer).

### 6. Sources

- Tideway, Bazalgette Embankment location page: https://tideway.london/locations/bazalgette-embankment/ (around an acre, 71 trees, Thames Path 4 m and 3 m, Stages 4 m to 9 m).
- Tideway press release 13 Jan 2026, "Brand new 1.5 acre riverside park opens": https://tideway.london/news/press-releases/2026/january/brand-new-15-acre-riverside-park-opens-in-the-heart-of-london-following-super-sewer-works/ (1.5 acres, Waterwall 8.8 m).
- Planning Statement Appendix Q, Blackfriars Bridge Foreshore (2013): https://www.tideway.london/media/1174/planning-statement_blackfriars-bridge-foreshore.pdf (Q.4.56 to Q.4.65, Q.5.19, Q.5.27 to Q.5.29, Q.5.116, Q.5.150).
- Book of Plans section 19: https://www.tideway.london/media/2034/219-blackfriars-bridge-foreshore-plans.pdf (BLABF-190010 parameter plan; BLABF-190024 section AA with levels).
- DCO Schedule 3 para 17 (BLABF6): https://www.legislation.gov.uk/uksi/2014/2384/schedule/3/made/data.pdf
- City of London poetry commission update, 6 Apr 2023: https://democracy.cityoflondon.gov.uk/documents/s186035/Appendix%201.%20Tideway%20Poetry%20Supporting%20Document.pdf
- City of London RASC report, 25 Jun 2025: https://democracy.cityoflondon.gov.uk/documents/s220008/Blackfriars%20Foreshore%20RASC%2025%20June.pdf
- Diamond Geezer, "Bazalgette Embankment", Jan 2026: https://diamondgeezer.blogspot.com/2026/01/bazalgette-embakment.html
- The Guardian, 12 Aug 2025 (as above).
- OpenStreetMap ways 475978801 and 1359837168, nodes 13463886797 and 13463886798, via Overpass 06 Nov 2026 (ODbL).

### 7. Photos

- `blackfriars-1.jpg`: https://commons.wikimedia.org/wiki/File:Bazalgette_Embankment_2026-02-04.jpg, Matt Brown, CC BY 4.0, 4 Feb 2026. Shows: looking east along the finished embankment towards Blackfriars Bridge and St Paul's: stone paving, granite steps up to the Embankment with a bronze lion ring, the undercroft wall under the ramp, and two of Coley's black "Stages" slabs (one rising from the river wall). Finished.
- `blackfriars-2.jpg`: https://commons.wikimedia.org/wiki/File:Ventilation_shafts_on_Bazalgette_Embankment_2025-09-08.jpg, Matt Brown, CC BY 4.0, 8 Sep 2025. Shows: the three grey twisted cast iron vent columns at the western tip on pale granite setts with flush hatches and black railings, Waterloo Bridge behind. Taken four months before opening: a green temporary barrier still surrounds the base of the middle column, otherwise finished.

### Build summary

- **Outline**: the OSM wedge in §1. Straight north side on the old wall line (lat ~51.51086, running due east-west) for 218 m from the west tip (lon -0.107706) to Blackfriars Bridge (lon -0.10459). South face a gentle convex curve: 32 m out near the west end, ~24 m at mid-length, ~9 m at the bridge; rounded south-west nose. Area ~4,100 m².
- **Levels** (m AOD): deck and wall tops ~5.4 (parapets up to 6.0); raised west terrace ~6.4; MHWS 3.85; MLWS -2.65.
- **River wall**: pale granite face, black railings, vertical timber fenders, bronze lion-head rings along the edge.
- **Vent columns**: 3 at the west tip near 51.51077, -0.10753; two ~5.1 m and one shorter (~4 m, low confidence); ~1.3 m base flaring to ~1.7 m; grey cast iron.
- **Sculptures**: 5 black concrete slabs, 4 to 9 m tall (Waterwall 8.8 m with a stepped pool; Twins rising out of the river wall).
- **Planting**: a long terraced bed of 71 small trees along the landward side.
- **Shaft**: flush, centred ~51.51072, -0.10730, under the broad end, 24 m internal; draw a field of flush rectangular hatches. A small ribbed round kiosk (~7 m diameter, ESTIMATED) at the broad end.
- **East end**: ramp from the bridge approach down to the deck, with a metal-panelled undercroft beneath.

### Confidence

- Outline: **high** (OSM; matches "around an acre"). Length: **medium** (218 m OSM vs 250 m Guardian).
- Levels: **medium** (DCO parameters; deck level inferred).
- Vent count and material: **high**. Height of the third (short) column: **low**. Exact positions: **medium**.
- Stages sculptures: count **high**, individual footprints and heights other than Waterwall **low**.
- Missing: City of London discharge drawings (BLABF5, BLABF14, approved 9 Sep 2021) with the final landscape layout and levels; rotunda size.

---

## kemp: King Edward Memorial Park Foreshore (Shadwell / Wapping)

Extension of King Edward Memorial Park, Tower Hamlets, between the Grade II listed Rotherhithe Tunnel north ventilation rotunda (west) and Free Trade Wharf (east). Opened to the public **29 July 2026** (MEASURED, Tideway news Aug 2026). Architect: Weston Williamson + Partners for the east section (MEASURED, NLA project page and WWP listing via search result; not checked on WWP's own page).

### 1. Platform outline

- **Shape**: a rounded trapezoid projecting south-south-east from the old river wall: a broad rounded south-west corner by the rotunda, a straight river face running north-east, and a short return to the river wall at Free Trade Wharf. Photo kemp-1 (aerial, Jul 2026) shows exactly this.
- **As-built outline from OpenStreetMap** (way 635366997 "King Edward Memorial Park Foreshore"), clockwise from the east tie-in:
  `51.509037,-0.046835` (east tie-in, Free Trade Wharf) → `51.508849,-0.046830` → `51.508785,-0.046886` (south-east corner) → `51.508489,-0.047379` → `51.508463,-0.047537` → `51.508498,-0.047679` → `51.508539,-0.047737` → `51.508665,-0.047856` (west tie-in by the rotunda) → along the old river wall `51.508780,-0.047540` → `51.508957,-0.047054` → back to start.
- **Dimensions** (DERIVED from OSM in local metres; old wall line bearing ~60° from north):
  - Length along the old river wall: **82 m** (minimum bounding box 81.9 m x 33.9 m).
  - Projection: **~33 m** at the west (rounded) end, **~22 m** at the east corner.
  - DCO maximum envelope for comparison: ~87 m along the wall, ~29 m projection at the shaft, ~20 m at the east corner, area ~1,890 m² (DERIVED: the orange "maximum extent of top of river/parapet wall" on KEMPF-250005, scaled 1:1000 on A3 at 7.87 px/m at 200 dpi, shoelace on 8 traced vertices).
- **Area**: OSM polygon **2,085 m²** (DERIVED). Planning Statement: "approximately 0.2ha of reclaimed foreshore" (MEASURED, T.4.64). Tideway: "2,600m² public space" (MEASURED, Tideway page and Aug 2026 news), which includes the re-landscaped park edge. Draft works design summary: "increasing the overall area of open space ... by 0.26ha" (MEASURED, Nov 2020).
- **Terraces and levels**: "two complementary spaces: a central 'square' and a rich river edge" (MEASURED, design summary §3). A central square with wide curved precast-concrete terrace steps descending south to a **lower curved river-edge walkway** that wraps round the west end (photo kemp-2); "a long timber bench wraps around the lowest terrace"; "the western section of the lower walkway" is floodable, "designed to be overtopped during higher tides" (MEASURED, Tideway page and news). **Three stepped intertidal terraces**, planted, at the western, central and eastern points of the wall (MEASURED, committee report §3.4; design summary §3.4). Two grass mounds rising from the central area towards the park (MEASURED, Tideway).

### 2. Height

- River edge walkway / flood defence level: **5.23 m AOD** (105.23 m ATD) (MEASURED, DCO section KEMPF-250010).
- Top of river/parapet wall: **5.28 m AOD minimum to 5.85 m AOD maximum** (MEASURED, KEMPF-250005 Typical Sections A and B). Section A shows a "walkway" step below the parapet on the river side.
- Spot levels on the drawings across the park edge: 5.0 to 6.1 m AOD (MEASURED, 105.00 to 106.10 ATD annotations on KEMPF-250009/250010).
- MHWS 3.90 m AOD; MLWS -2.80 m AOD (MEASURED, KEMPF-250010). Mean low water is "some 30m from the river wall" here (MEASURED, T.2.3), so at low tide a wide mud and shingle foreshore is exposed in front of the structure.
- Lower floodable walkway: about **4.0 to 4.3 m AOD** (ESTIMATED: it is overtopped at higher spring tides, so it sits just above MHWS; no level found).
- Wall facing: a new river wall with **textured ecological concrete** "with spaces for fauna and invertebrates" (MEASURED, Tideway news); photo kemp-1 shows pale concrete walls with vertical timber fenders. The Environment Agency required a 0.3 m gap between the existing wall and the western intertidal terrace (MEASURED, committee §8.38).
- Surfaces: coloured asphalt (buff/yellow in the aerial), concrete and granite (MEASURED, Tideway page); granite setts on the lower walkway (photo kemp-2).

### 3. Shaft cover

- Drop shaft: **20 m internal diameter, ~60 m deep** (MEASURED, T.4.52). Sewer "60m below" (Tideway page).
- Cover: ground-level access covers within the central hardstanding, publicly accessible (MEASURED, T.4.54, T.4.65). No raised plinth.
- Position: centre **51.50869, -0.04743** (DERIVED: shaft zone centre on KEMPF-250005 at 29.8 m east and 2.3 m north of the west tie-in, transferred to the OSM outline; plus or minus 6 m). The two vortex columns mapped in OSM sit 3 to 4 m south of this point, inside the DCO "zone within which ventilation column(s) serving the shaft would be located", which is drawn inside the shaft circle. That agreement supports the position.

### 4. Ventilation columns

- **Count: 5** = 2 signature "vortex" columns + 3 non-signature ventilation columns (MEASURED, committee report §3.3 and §8.24 to 8.34; design summary §3.2 to 3.3).
- **Two vortex columns** (central foreshore, serving the drop shaft):
  - Height: **maximum 5.4 m** as approved (MEASURED, committee §8.30); DCO range 5.0 to 6.5 m (MEASURED, committee §8.28 and Sch.3 para 23).
  - Form: "twisted form", the signature column, with "a distinct and very much bespoke pattern" at the base inspired by the Rotherhithe Tunnel rotunda grilles (wave linework) (MEASURED, committee §8.31 to 8.32; photo kemp-3 shows the wave pattern).
  - Material and colour: **cast iron**; approved finish "warm greyish brown/bronze tone" (MEASURED, committee §8.32). The Nov 2020 draft said "dark grey, matt" (MEASURED, design summary §3.2). **The approved and built finish is the warm brown**; photos kemp-2 and kemp-3 show a brown, bronze-like patina.
  - Diameter: 1.2 m internal (MEASURED, T.4.58, DCO stage). External ~1.3 m base, ~1.7 m top (ESTIMATED from photo kemp-3).
  - Position: OSM nodes **51.508662, -0.047419** and **51.508649, -0.047454**, about 2.7 m apart (DERIVED), in the central square near the top of the terrace steps.
- **Three non-signature columns** (serving the interception chamber):
  - Height: **maximum 6 m** (MEASURED, committee §8.24; DCO table 6.0 m).
  - Form: "slim and simple", "more linear", clustered as a group of three in a flat planting bed (MEASURED, design summary §3.3; committee §8.25). Plain upright metal cylinders (ESTIMATED diameter 0.5 to 0.7 m: "smaller diameter" per T.4.59).
  - Colour: same warm greyish brown/bronze tone as the vortex columns (MEASURED, committee §8.32); the 2020 draft said "iron oxide paint finish" (design summary).
  - Position: eastern foreshore, around **51.50887, -0.04696** (ESTIMATED: centre of the DCO eastern column zone on KEMPF-250005, transferred to OSM coordinates; plus or minus 10 m).

### 5. Other permanent features

- **"Cargoes" by Hew Locke**: six cast bronze boats about **1 m long** on six precast concrete plinths, forming a trail from the foreshore into the park (MEASURED, design summary §3.6; Tideway). OSM artwork nodes at 51.508846,-0.046856; 51.508676,-0.047820; 51.508647,-0.047284; 51.508719,-0.048368 (four of six mapped).
- **Electrical and control kiosk** on the east boundary by Free Trade Wharf: **11.5 m wide x 2.223 m deep x 2.923 m high**, 0.878 to 1.02 m from the boundary wall (MEASURED, committee §8.11); brick back, full-height vertical hardwood fins on the front and sides, louvred doors, sedum/brown roof (MEASURED, design summary §3.1; Tideway). Two ~2.3 m fences close the gap behind it (MEASURED, §8.16). Approximate centre ~51.50917, -0.04692 (ESTIMATED from the DCO kiosk zone).
- **Relocated bandstand** (green octagonal roof, visible in kemp-1) moved closer to the foreshore (MEASURED, committee §3.4); OSM way 403916985 centre 51.508964, -0.047448.
- Integrated and standalone timber benches, two totem signs, removable bollards, balustrades and handrails (MEASURED, committee §3.4). River-edge balustrade: timber top rail on stainless posts with horizontal cable infill (photo kemp-2).
- Planting: five zones (foreshore planters, bank planter and grassed mound, central seated area trees, park interface) with new trees, perennials, shrubs (gorse visible) (MEASURED, committee §8.44; Tideway).
- Context to draw: the Grade II listed brick Rotherhithe Tunnel rotunda immediately west (51.5086, -0.0484 approx.; visible in kemp-1).

### 6. Sources

- Tideway location page: https://tideway.london/locations/king-edward-memorial-park-foreshore (2,600 m², vortex/bronze boats, kiosk, terraces, floodable walkway).
- Tideway news Aug 2026, "New riverside space opens in Wapping": https://tideway.london/news/site-news/2026/august/new-riverside-space-opens-in-wapping-following-super-sewer-works/ (opened 29 July; Cargoes; textured river wall).
- Tower Hamlets, KEMPF Permanent Above Ground Works Design Summary, Nov 2020 (ref 2120-TDWAY-TTTUN-990-ZZ-ZZ-759377): https://www.towerhamlets.gov.uk/Documents/Leisure-and-culture/Parks-and-open-spaces/KEMPFDraftWorksDesignSummary.pdf
- Tower Hamlets Development Committee report (PA/21/01190, Jan 2022): https://democracy.towerhamlets.gov.uk/mgConvert2PDF.aspx?ID=195883 (column counts, heights, finishes; kiosk dimensions).
- Planning Statement Appendix T, KEMPF (2013): https://www.tideway.london/media/1265/planning-statement_kempf.pdf (T.2.3, T.4.52 to T.4.65).
- Book of Plans section 25: https://tideway.london/media/1267/site-plan_kempf.pdf (KEMPF-250005 parameter plan; 250009 to 250010 landscape plan and section).
- DCO Sch.3 para 23: https://www.legislation.gov.uk/uksi/2014/2384/schedule/3/made/data.pdf
- NLA project page: https://nla.london/projects/tideway-king-edward-memorial-park-foreshore
- OpenStreetMap way 635366997, nodes 14067931335 etc., ways 1546811905 and 1546811906 (vortex columns, tagged `man_made=tower`), via Overpass 06 Nov 2026 (ODbL).

### 7. Photos

- `kemp-1.jpg`: https://commons.wikimedia.org/wiki/File:King_Edward_VII_Memorial_Park_with_Tideway_Tunnel_embankment_2026-07-08.jpg, Matt Brown, CC BY 4.0, 8 Jul 2026. Shows: oblique aerial (from an airship) of the finished foreshore: rounded west end next to the brick rotunda, pale concrete river wall with fenders, grey stepped terraces in the centre with the two dark vortex columns, buff asphalt paths, green-roofed bandstand, kiosk against Free Trade Wharf. Finished, three weeks before public opening.
- `kemp-2.jpg`: https://tideway.london/media/7746/tideway-king-edward-park_037.jpg, Tideway press image (Aug 2026); licence not stated, treat as © Tideway, reference only. Shows: curved white precast terrace steps down to the curved lower granite-sett walkway, timber-and-cable balustrade, the two brown vortex columns behind, Canary Wharf downstream. Finished.
- `kemp-3.jpg`: https://tideway.london/media/7747/tideway-king-edward-park_039.jpg, Tideway press image; © Tideway, reference only. Shows: a Hew Locke bronze galleon in front of the two warm-brown vortex columns with the wave-line pattern at their bases. Finished.

### Build summary

- **Outline**: the OSM polygon in §1: ~82 m along the old wall (bearing ~60°), ~33 m out at the rounded west end, ~22 m at the east corner, area ~2,100 m². River face straight and running north-east; west corner a large-radius curve (~15 m, ESTIMATED from kemp-1).
- **Levels** (m AOD): central square and wall tops ~5.2 to 5.9; curved terrace steps (5 to 6 risers, ESTIMATED from kemp-2) down to a lower walkway at ~4.0 to 4.3 that floods at big tides; MHWS 3.9; MLWS -2.8, with ~30 m of foreshore exposed at low water.
- **River wall**: pale textured concrete with vertical timber fenders; three small planted intertidal terrace ledges in the wall face (west, centre, east).
- **Vent columns**: 2 twisted vortex columns 5.4 m tall, ~1.3 m base flaring to ~1.7 m, warm brown-bronze with a wave-line band near the base, at 51.508662,-0.047419 and 51.508649,-0.047454; plus 3 plain slim cylinders up to 6 m, same brown, clustered in a planting bed at ~51.50887,-0.04696.
- **Shaft**: flush covers, centre ~51.50869,-0.04743, 20 m internal.
- **Kiosk**: 11.5 x 2.2 x 2.9 m box against the Free Trade Wharf boundary, timber fins, green roof.
- **Extras**: six 1 m bronze boats on low plinths, relocated green-roofed bandstand, two grass mounds, timber benches, buff asphalt paths.

### Confidence

- Outline: **high** (OSM plus aerial photo plus DCO envelope all agree). Area: **medium** (2,085 m² structure vs 2,600 m² Tideway public space).
- Column counts, heights, finishes: **high** (committee report). Column positions: vortex **high**, east cluster **low**.
- Levels: **medium** (DCO; lower walkway level estimated).
- Missing: the approved KEMPF landscape and levels drawings (5600-CVBJV-KEMPF series listed in the committee report) would give exact terrace levels and the east column positions.

---

## chambers: Chambers Wharf (Bermondsey)

South bank at Bermondsey Wall West / Loftie Street, next to Fountain Green Square, opposite Wapping. The main tunnel's eastern drive shaft. **Not a public space**: the land is owned by Thames Water and is to be redeveloped for housing by Berkeley Homes; the Thames Path here stays closed until that development is complete (MEASURED, CLWG minutes 15 Dec 2025).

### 1. Platform outline

- **There is no permanent platform in the river.** During construction a cofferdam extended about 50 m into the river (DERIVED: OSM site polygon way 32388672 reaches lat 51.50169 against the river wall line at ~51.50120 at the west end and ~51.50076 at the east end). It is being removed: "returning the site and the river wall to its earlier alignment" (MEASURED, CLWG notes 16 Jun 2025); 84 of 410 sheet piles pulled by June 2025; cofferdam and pile removal forecast to finish **June 2026, possibly September 2026** (MEASURED, CLWG minutes 15 Dec 2025). I found no confirmation that removal has finished as of 06 Nov 2026.
- **Permanent works**: a new river wall along "a slightly revised alignment" just in front of the old one, so the old wall need not be broken out (MEASURED, drop-in boards 29 May 2019; Southwark ref 19/AP/1465), plus a block-paved operational area over the shaft in the north-east corner of the site (MEASURED, CLWG notes Jun 2025).
- **River wall line** (DERIVED from DCO parameter plan CHAWF-210005, anchored to OSM's Loftie Street / Bermondsey Wall East junction at 51.500539, -0.065028; plan at 1:1000 on A3, 3.94 px/m):
  - East end (by Fountain Green Square): **51.50076, -0.06483**.
  - West end (by East Lane): **51.50120, -0.06684**.
  - Length **~148 m** (DERIVED), bearing ~289° from the east end. Consistent with the **145 m** intertidal terrace (MEASURED, drop-in boards).
  - Projection of the new wall face beyond the old line: **about 2 to 4 m** (ESTIMATED: the 1.5 m intertidal terrace plus the new wall thickness sit in front of the old wall).
- **Operational area**: block-paved hardstanding over the shaft and air-treatment chamber, to be handed to Thames Water; size not stated. About 40 x 30 m (ESTIMATED from the DCO "zone within which all permanent site structures would be located" on CHAWF-210005, which encloses the shaft and kiosk zones).

### 2. Height

- Walkway level along the river wall: **4.65 m AOD** (+104.65 ATD) (MEASURED, Tideway CLWG slides 15 Dec 2025, slide 11 intertidal section; I read "+104.65" from a low-resolution image, so treat the last digit as uncertain).
- Top of river/parapet wall: **5.28 m AOD minimum to 6.10 m AOD maximum** (105.28 to 106.10 ATD); flood defence level 5.28 m AOD (MEASURED, CHAWF-210005 Typical Section A; CHAWF-210011).
- MHWS 4.03 m AOD, MHWN 2.83 m AOD (MEASURED, slide 11); MHWS 3.90 (DCO), MLWS -2.80 m AOD (MEASURED, CHAWF-210011).
- Intertidal terrace: **145 m long, 1.5 m wide**, planted with salt-marsh species, built into the outer face at about MHWN to MHWS level; it "floods at high tides with boat wash and at very high tides" (MEASURED, drop-in boards slides 20 to 21). Section on slide 11 shows the terrace soil surface with a 2% fall just below the MHWS line, contained by gabion edging (MEASURED, visual reading of the section).
- Wall finish: **"ecological concrete" architectural cladding panels**, heavily textured (around 600 m² of habitat wall), with **wooden fenders** and emergency grab chains, all installed by Dec 2025 (MEASURED, drop-in boards slide 20; CLWG minutes Dec 2025). Railings: dark metal post-and-mesh balustrade (photo chambers-1).

### 3. Shaft cover

- Drop shaft: **~25 m internal diameter, ~57 m deep** (MEASURED, Planning Statement Appendix S, S.4.53).
- Cover: flush ground-level access covers within block paving (MEASURED, S.4.55; CLWG Jun 2025 "block paving over the shaft"); covers "specified to accept a paving treatment later" for the housing scheme (S.4.66). A **bronze "Tideway Plaque"** (circular, ~1 m, ESTIMATED from slide 12 photo) is set into the hardstanding (MEASURED, CLWG minutes Dec 2025).
- Position: centre **51.50074, -0.06549** (DERIVED: shaft zone centre on CHAWF-210005 is 31.7 m west and 22.1 m north of the Loftie Street / Bermondsey Wall East junction; the zone's north edge touches the river wall; plus or minus 10 m). Shaft zone in the parameter plan is ~39 m across including tolerances (DERIVED).

### 4. Ventilation columns

- **Count: 3** (MEASURED: drop-in boards 2019; Planning Statement S.4.59; CLWG minutes Dec 2025 "The permanent ventilation columns have now been installed").
- **Height: 5.1 m** (MEASURED, drop-in boards slides 5 and 9). DCO cap 6 m (MEASURED, Sch.3 CHAWF3(2)); the 2013 parameter plan allowed 4 to 8 m.
- **Base diameter: 1.2 m** (MEASURED, drop-in boards).
- **Material and colour**: cast iron, "dark grey / black" (MEASURED, drop-in boards). Photo chambers-1 shows them very dark brown-black.
- **Form**: signature twisted vortex column, DCO type C (MEASURED, CHAWF3). Each carries a ~150-character poem (MEASURED, drop-in boards). Residents were told the permanent columns are "a similar height but a more elegant shape" than the temporary ones (MEASURED, CLWG notes Jun 2025).
- **Position**: they "sit above the air treatment unit", not over the shaft (MEASURED, CLWG notes Jun 2025); DCO zone is between the shaft and the east end of the river wall. ESTIMATED centre of the group **51.50079, -0.06505** (from the purple zone on CHAWF-210005), arranged as a loose triangle a few metres apart (photo chambers-1).

### 5. Other permanent features

- **Electrical and control kiosk**: on the eastern boundary against the rear garden wall of 8 to 14 Fountain Green Square, 0.8 m off the wall; **~16 m long, 2.3 m high** (MEASURED, drop-in boards slide 11). The 2013 statement said ~4 x 2.5 x 2.5 m high (MEASURED, S.4.63), superseded. Dark grey steel louvred panels and doors on the west, north and south faces; dark grey brick on the east; brown roof with stones (MEASURED, drop-in boards; CLWG notes). Fenced and gated, no public access.
- **"Waveform" by Leo Fitzmaurice**: a cast bronze bell-like form ~500 mm diameter hung from a white-painted mast ~4 m high, with a short angled arm (MEASURED, drop-in boards slide 16; installed per CLWG minutes Dec 2025; photo in slide 12 shows the bell is stacked ring-like bronze, the mast a tapering white blade). Located by the river wall near the vent columns (photo chambers-1).
- **Tidal marker "CI"**: stainless triangle on the river wall marking 101 m ATD (1 m AOD), the tunnel invert reference (MEASURED, CLWG minutes Dec 2025).
- Hoardings around the remaining development plot: pale grey, same height as before (MEASURED, CLWG notes Jun 2025; construction hoarding was 3.6 m, S.5.89).
- Site offices left in place for the future developer (MEASURED, CLWG Jun 2025).

### 6. Sources

- Tideway, Chambers Wharf permanent works drop-in boards, 29 May 2019: https://tideway.london/media/5642/chambers-wharf_permanent-works-dropin-information-29may2019.pdf (columns 3 x 5.1 m x 1.2 m cast iron; kiosk 16 m x 2.3 m; Waveform; 145 m x 1.5 m intertidal terrace; Southwark refs 19/AP/1415 and 19/AP/1465).
- Tideway CLWG notes 16 Jun 2025: https://tideway.london/media/7387/250616-chambers-wharf-notes-website.pdf
- Tideway CLWG minutes 15 Dec 2025: https://www.tideway.london/media/7608/chambers-wharf-minutes-15-december-2025-website.pdf
- Tideway CLWG slides 15 Dec 2025: https://www.tideway.london/media/7588/chambers-wharf-clwg-slides-15-december-2025-002.pdf (slides 11 to 13: intertidal section with levels, columns and bell photos, cofferdam aerials).
- Planning Statement Appendix S, Chambers Wharf (2013): https://www.tideway.london/media/1188/planning-statement_chambers-wharf.pdf (S.4.53 to S.4.71, S.5.19 to S.5.30).
- Book of Plans section 21: https://www.tideway.london/media/1190/site-plan_chambers-wharf.pdf (CHAWF-210005 parameter plan; 210011 section).
- DCO Sch.3 para 19 (CHAWF3): https://www.legislation.gov.uk/uksi/2014/2384/schedule/3/made/data.pdf
- OpenStreetMap way 32388672 (construction site), Loftie Street and Bermondsey Wall East ways, via Overpass 06 Nov 2026 (ODbL).

### 7. Photos

- `chambers-1.jpg`: Tideway CLWG slide pack 15 Dec 2025, slide 12 (image extracted from the PDF above); © Tideway, licence not stated, reference only. Shows: the three dark twisted vent columns on new grey block paving, workers in a cherry picker fitting the bronze bell to the white "Waveform" mast, mesh balustrade on the river wall, Tower Bridge in the distance. **Near-complete, not finished** (scaffold tube, plant and barriers still present). No CC-licensed photo of the finished Chambers Wharf structures exists on Wikimedia Commons or Geograph as far as I could find.
- `chambers-2.jpg`: same slide pack, slide 11: the "Intertidal planting" cross-section diagram showing walkway level, MHWS and MHWN against the planted terrace. A drawing, not a photo; kept for the levels.

### Build summary

- **Do not build a platform in the river.** Build: a straight new river wall from 51.50076,-0.06483 (east) to 51.50120,-0.06684 (west), ~148 m, top at ~5.3 m AOD (parapets up to 6.1), textured pale concrete face with vertical timber fenders and a 1.5 m planted ledge just below the top on the river side; dark mesh railing on top. If the game time is before autumn 2026 a remnant cofferdam "island" may still stand offshore; otherwise open foreshore (MLWS -2.8 m AOD).
- **Operational area**: ~40 x 30 m of grey block paving at ~4.6 to 5.3 m AOD in the north-east corner of the site, with flush covers over a 25 m shaft centred ~51.50074,-0.06549 and a ~1 m bronze plaque.
- **Vent columns**: 3, 5.1 m tall, 1.2 m base, flaring twisted form, dark grey-black cast iron, grouped near 51.50079,-0.06505.
- **Kiosk**: ~16 x ~2.5 x 2.3 m box along the east boundary wall by Fountain Green Square, dark grey louvres, grey brick back.
- **Artwork**: white ~4 m mast with a ~0.5 m bronze bell on a short arm, by the river wall.
- **Rest of the site** (~1.9 ha): cleared development plot behind pale grey hoarding, Thames Path closed.

### Confidence

- "No in-river structure": **high** (two Tideway meeting records).
- River wall alignment and length: **medium** (DCO plan anchored to OSM streets; length matches the 145 m terrace).
- Column count, height, diameter, material: **high**. Column position: **low-medium**.
- Shaft position: **medium** (plus or minus 10 m). Kiosk size: **medium** (2019 submission; final approval not seen).
- Levels: **medium** (walkway level read from a low-resolution slide).
- Missing: Southwark approvals 19/AP/1415 and 19/AP/1465 drawings (not retrieved); confirmation that the cofferdam has gone; any finished CC-licensed photo.

---

## Cross-site notes for the builder

- **The signature vent column** is one family at all four sites: a cast (iron or bronze) tube, round at the base (~1.2 m internal, ~1.3 m external), twisting and flaring to a larger obliquely-cut top, with one sharp helical ridge carrying an engraved poem; heights 5.0 to 5.4 m as built. Fereday Pollard (Tideway lead architect) describes them as "twisting and flaring out as they rise to five metres, their form mimicking the path of the plummeting sewage vortex" (MEASURED, Guardian). One mesh can serve all four sites with per-site colour: Victoria dark bronze; Blackfriars mid-grey iron; KEMP warm brown-bronze (plus a wave band); Chambers dark grey-black.
- **Hatches**: every site's deck is scattered with flush rectangular access covers (Blackfriars ~70; "55 hatches in an area half the size of a tennis court" at one site, Guardian). A decal or normal-map pattern will read correctly.
- **Architects** (MEASURED via search results, not all checked on the firms' own pages): Hawkins\Brown for the central sites including Victoria and Blackfriars; Weston Williamson + Partners for the east section including KEMP; Fereday Pollard as lead architect coordinating the foreshore structures and the column design. I found nothing tying LDA Design to these four sites.

## Game modelling conventions, lane T

The figures above remain the source record. The runtime data distinguishes those figures from the following illustrative geometry choices: hatch grids and frame widths; the Isle interception chamber's 6 m cover-layout zone (not a claim about the chamber diameter); individual bench and sculpture positions where none was surveyed; tree crown and trunk profiles; rail section sizes and bar spacing; the repeating paving course; lamp and furniture profiles; the Chambers air-treatment paved apron; and bank-contact access interpolation necessitated by the coarse rendered terrain. These are estimated modelling details. They do not replace a published level, outline, column count or column height. Photographs are reference-only and are not redistributed.
