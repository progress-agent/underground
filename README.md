# UnderGround

A small Three.js/Vite prototype that renders a depth-aware London Underground network using TfL route sequences, plus an optional terrain heightmap for the Victoria AOI.

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

## Controls

- Mouse: orbit/pan/zoom (OrbitControls)
- Keyboard:
  - `V` toggle Victoria line station markers
  - `L` toggle Victoria line station labels

## URL parameters

- `t` time scale multiplier (default `8`)
- `vz` vertical scale multiplier for depths (default `3.0`)
- `hx` horizontal scale multiplier for lon/lat projection (default `1.0`)

Example:

`/?t=12&vz=2.5&hx=1.2`

## Data notes

- `data/station_depths.csv` contains curated station/platform depth anchors (metres below ground), with citations.
- Terrain assets/pipeline notes live under `data/` and `scripts/`.
