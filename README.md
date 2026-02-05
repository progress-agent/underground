# UnderGround

A small Three.js/Vite prototype that renders a depth-aware London Underground network using TfL route sequences, plus an optional terrain heightmap for the Victoria AOI.

## Features

- **3D tube tunnels**: Twin tunnels for each line with realistic separation
- **Station shafts**: Vertical shafts connecting surface to platform level (248 stations across all 11 Underground lines + DLR)
  - Deep tube lines (132 stations): Victoria (16, curated depths), Bakerloo (25), Central (22), Jubilee (27), Northern (12), Piccadilly (28), Waterloo & City (2)
  - Sub-surface lines (116 stations): Circle (28), District (33), Hammersmith & City (29), Metropolitan (14)
  - Light rail: DLR (12 stations)
- **Terrain heightmap**: EA LiDAR data for surface visualization
- **Interactive camera**: Focus on individual lines or all visible lines

## Quick start

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Offline cache (recommended)

To bundle the latest TfL route sequences for offline use / more stable demos:

```bash
npm run cache:tfl
```

This writes JSON into `public/data/tfl/route-sequence/` and updates `index.json`.

## Controls

- Mouse: orbit/pan/zoom (OrbitControls)
- In-scene interaction:
  - Hover a line to see its name
  - Shift+Click a line to toggle its visibility
- Keyboard:
  - `V` toggle station markers
  - `L` toggle station labels
  - `Shift+S` toggle station shafts
  - `F` focus camera on a line (cycles through visible lines)
  - `Shift+A` focus camera on all currently-visible lines
  - `S`/`W`/`X` move forward/fast-forward/backward (FPS mode)
  - `A`/`D` strafe left/right (FPS mode)
  - `Q`/`E` move up/down (FPS mode)
  - Arrow keys look direction (FPS mode)
  - `Space` pause/resume the simulation

## URL parameters

- `t` time scale multiplier (default `8`)
- `vz` vertical scale multiplier for depths (default `3.0`)
- `hx` horizontal scale multiplier for lon/lat projection (default `1.0`)

Example:

`/?t=12&vz=2.5&hx=1.2`

## Data sources

- **Tube depth data**: TfL "Bakerloo, Central and Victoria Lines — Tube depths" PDF
- **Route sequences**: TfL Unified API (`/Line/{id}/Route/Sequence` endpoints)
- **Terrain**: Environment Agency LiDAR DTM (1m resolution) via data.gov.uk
- **Coordinate system**: Origin at Trafalgar Square (51.5074°N, -0.1278°W)

## Project structure

```
src/           # Main application source
  main.js      # Scene setup, tunnel rendering, camera control
  depth.js     # Station depth loading and heuristics
  stations.js  # Station marker visualization
  shafts.js    # Vertical shaft rendering
  terrain.js   # Heightmap integration
scripts/       # Data generation utilities
  *_shafts.mjs          # Generate shaft JSON for each line (11 lines)
  build-heightmap.mjs   # Process EA LiDAR tiles
  cache-tfl.mjs         # Cache TfL route sequences for offline use
public/data/   # Static assets served at runtime
  */shafts.json         # Station positions & depths for each line (11 lines)
  tfl/                  # Cached TfL route sequences
  station_depths.csv    # Curated depth anchors
```
