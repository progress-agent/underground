# Landmark and rail refinement, 12Sep26s

The O2 and Westminster models are illustrative architecture built over mapped positions. Dimensions in tooltips remain real metres regardless of the Structure height setting.

## References and modelling choices

- [RSHP: Millennium Dome](https://rshp.com/projects/culture-and-leisure/the-millennium-dome/): shallow roof,50m apex, twelve100m masts. [TensiNet's engineer-credited entry](https://www.tensinet.com/index.php/component/tensinet/?id=4042&view=project) describes a spherical cap,320m roof cable net and30m central ring. The365m overall site diameter is a different measurement. Geometry uses160m roof radius,5m rim and45m rise. The rim height,12m outward mast lean, lattice reduction and cable repeats are authored approximations. Mast feet retain the audited OSM locations.
- [Parliament: Big Ben facts](https://www.parliament.uk/about/living-heritage/building/palace/big-ben/facts-figures/):96.3m tower, four7m dials. [Restoration architect/House of Commons exterior photographs](https://www.riba.org/explore/awards/uk-awards/regional-awards/2025/london-awards/elizabeth-tower/) establish white dials, Prussian blue details, Gothic openings and tiered roofs. Clock centres near56m and roof stages are corroborated by detailed OSM parts, including ways1139769330,363744574,363275237 and1139769319. Clock reading is illustrative.
- [Parliament: towers](https://www.parliament.uk/about/living-heritage/building/palace/architecture/palacestructure/towers-of-parliament/): Central Tower91.4m and Victoria Tower98.5m masonry. The model deliberately follows Parliament's Central Tower height, despite a78m mapped stack. [Victoria Tower flagstaff](https://www.parliament.uk/about/living-heritage/building/cultural-collections/archives/victoriatower/purposebuilthome/) reaches approximately120m overall. Heights refer to different endpoints.
- [Historic England listing](https://historicengland.org.uk/listing/the-list/list-entry/1226284): river frontage, Gothic bays, buttresses and pinnacles. Repeated decoration and simplified roof ranges follow the retained outer footprint; the source does not contain usable courtyard rings, so the model does not reconstruct those interiors.

## Height and rail behaviour

The Structure height control applies1–5x to buildings, landmarks, bridges, railway earthworks and train bodies. Terrain and underground infrastructure retain their established vertical datum. Bridge feet remain grounded; subdivided deck approaches meet the banks as clearance above water changes. The historic5x bridge geometry restores exactly.

Overground paths are sampled at intervals no greater than12m to follow the terrain between source vertices. Surface and cutting track use a1m railhead clearance, embankments up to4m including clearance, and viaducts up to9m. Distance-based approaches taper these class estimates. These are illustrative elevations based on OSM classes, not a surveyed vertical alignment. Existing tunnel depths and source corridor gaps are retained.

All six lines have named hover labels and instanced multi-car schematic services. Services advance offscreen, pause with the shared simulation and use the shared speed control. Their positions, spacing, direction and end-of-fragment reversals are animation choices, not live TfL positions or timetables. Station positions remain the TfL coordinates added in the preceding pass.
