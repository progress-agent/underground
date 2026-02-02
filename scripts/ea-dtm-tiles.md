# EA LiDAR Composite DTM (1m) tiles

Download from:
https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc

Place GeoTIFF tiles (5km) under:
`data/sources/ea_dtm_1m/`

Then run:

```bash
node scripts/build-heightmap.mjs --src data/sources/ea_dtm_1m --out data/terrain/london
```

Outputs:
- `data/terrain/london_height_u16.png`
- `data/terrain/london_height.json`

