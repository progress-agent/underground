# Airport bare-earth terrain corrections

The legacy Copernicus DSM contains airport roofs in the ground mesh. Independent EA comparison found the BA Fleet Support Unit at Heathrow resting on44.760m ground instead of22.959m bare earth. Terminal4 differed by6.227m and Terminal3 by3.876m. The correction replaces covered source heights with validated Environment Agency DTM before mesh geometry, colours, normals, contours, airport anchors and bake samplers are constructed.

`public/data/terrain/airport-dtm.json` is a required runtime asset containing nine bounded25m exports. `scripts/prepare-airport-dtm.mjs --source-dir /absolute/source/directory` reads archived TIFFs, fetching missing exports from their exact EA WCS URLs. It rejects incorrect dimensions, Float32 type, compression, CRS, transform, tile layout, truncated tiles and any missing/nonphysical sample. Heathrow additionally requires the independently validated SHA256 `b9a514279c6058d4f8a28ad40a1c036e43f8963a114df59d90336ce1fd4affee`. Every patch records its URL, full source SHA256, BNG bounds and physical units. Source TIFFs and separate validation records are archived in project `Working/city-tranche-12Sep26s/vertical/airport-dtm/`.

| Campus | BNG bounds west,south,east,north | Samples | Largest building-centre DSM excess over EA before correction |
|---|---|---:|---:|
| Heathrow |504000,173000,511000,178000|56000|21.801m|
| London City |541000,179000,544000,181000|9600|3.508m|
| Biggin Hill |540000,159000,543000,163000|19200|4.476m|
| RAF Northolt |508000,184000,511000,186000|9600|3.617m|
| Elstree |515000,195000,517000,198000|9600|2.595m|
| Denham |502000,188000,504000,190000|6400|1.740m|
| Stapleford |548000,196000,551000,199000|14400|1.998m|
| Kenley |531000,156000,535000,160000|25600|Not asserted|
| Damyns Hall |554000,181000,558000,185000|25600|Not asserted|

All176000 samples are valid. Pixel centres are sampled bilinearly. A250m smoothstep blend lies wholly inside each verified source boundary; exterior pixels remain unchanged. Every mapped airport building and runway vertex lies inside the full-weight core. There is no flattening, nodata substitution, extrapolation beyond source coverage or guessed vertical offset. The smaller campus differences are not asserted to be solely roof contamination because source datum and sampling differences also contribute.

The [EA catalogue](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m) identifies the2022 composite as bare earth in metres relative to Ordnance Datum Newlyn. The legacy Copernicus source uses EGM2008, with no documented ODN conversion in this repository. The mixed-source datum caveat in the southern-extension record remains; this patch does not claim a uniform surveyed ODN grid.

The existing render grid remains513×553 vertices, roughly137×98m, including the genuine southern extension. Corrected BA Fleet Support ground is22.889m, within0.071m of the25m EA sample. Across the original84 airport building centres the maximum absolute mesh-versus-EA difference is1.494m, reflecting the retained coarse render mesh. The before/after comparison JSONs preserve every building result. Terrain origin remains the shared projected reference E530028.7469586737,N180380.09351556934; effective bounds remain[490000,151093.75,560000,205000].

`terrain.js` retains its existing integration API and additionally exports `AIRPORT_TERRAIN_URL`, `validateAirportTerrainCorrections` and `applyAirportTerrainCorrections`. `meta.airportTerrainCorrections` records the nine applied source hashes and changed sample counts. A missing, HTML or invalid airport correction rejects terrain construction explicitly. Load terrain before airports/motorway, regenerate shared baked assets, and verify this new JSON is served with the existing Stratford and southern assets.

Five new browser-free tests cover source validation and rejection, exact pixel-centre sampling, continuous covered blends, full-weight campus coverage, unchanged exterior source pixels, independent ray/triangle agreement, roof-mound removal and missing-asset failure. The combined command also exercises the existing origin/southern margin, master-height, DLR and motorway regressions:

```sh
npx playwright test tests/airport-dtm.spec.js tests/terrain-anomaly.spec.js tests/vertical-scale.spec.js tests/dlr-profile.spec.js tests/m25-motorway.spec.js --reporter=line
```

All26 checks pass. GPU review and the shared bake remain the coordinator's next steps.

Kenley and Damyns Hall add51200 validated physical values with no nodata, preserving all seven previous source hashes and every City terrain value. The nine-site tests cover89 building anchors, full-weight runway coverage including chart-derived Damyns07/25, and membership of every runway vertex in the mapped M25/A282 ring. New source SHA256 values are ae2034edc9c4d04954aee357a51920e568ad063d908f451003571daa9ef95dd9 (Kenley) and b010425b90bca2eec7b6bdf55ffb9c684126d7bd538122d70b76138283f02087 (Damyns Hall).
