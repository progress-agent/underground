# UnderGround

A small Three.js/Vite prototype that renders a depth-aware London Underground network using TfL route sequences, plus an optional terrain heightmap for the Victoria AOI.

## Features

- **3D tube tunnels**: Twin tunnels for each line with realistic separation
- **Station shafts**: Vertical shafts connecting surface to platform level
  - Victoria line: 16 stations (curated depths)
  - Bakerloo line: 25 stations (heuristic depths)
  - Central line: 22 stations (heuristic depths)
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
  - Click a line to focus the camera
  - Shift+Click a line to toggle its visibility
- Keyboard:
  - `V` toggle Victoria line station markers
  - `L` toggle Victoria line station labels
  - `S` toggle Victoria line station shafts
  - `F` focus camera on the Victoria line
  - `A` focus camera on all currently-visible lines
  - `Space` pause/resume the simulation

## URL parameters

- `t` time scale multiplier (default `8`)
- `vz` vertical scale multiplier for depths (default `3.0`)
- `hx` horizontal scale multiplier for lon/lat projection (default `1.0`)

Example:

`/?t=12&vz=2.5&hx=1.2`

## Data notes

- `data/station_depths.csv` contains curated station/platform depth anchors (metres below ground), with citations.
- Terrain assets/pipeline notes live under `data/` and `scripts/`.
