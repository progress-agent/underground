// open-track.js: where each Tube and DLR line's track is drawn in the open, as
// a lookup the Pedestrian tunnel uses to find its portals (sprint 30Sep26w
// integration, D-041). Pure: no scene, no DOM; node tests pin it.
//
// Lane R draws the open-air Tube and DLR as surface railway from
// public/data/tube-surface.json (src/tube-surface-rail.js). A line runs on its
// own corridors and on every stretch of another owner's corridor its colour is
// laid on as a shared-track band (another Tube line's, or the Overground's:
// the Bakerloo on the Lioness, the District on the Mildmay). Lane T lays its
// trains on the same set (surface-trains.js linePieces); this index follows
// the same rule so the walk ends where the trains come out:
//   * own corridors and Tube owners' bands: a sample is open where Lane R
//     draws it (surface-rail.js drawnOpenFlags: a lone open sample between
//     tunnel ones is not drawn, so it is not a portal either);
//   * bands on Overground corridors: open wherever the Overground is not in
//     tunnel (it draws every class).
//
//   const idx = buildOpenTrackIndex({ data, ownerPaths, overgroundPaths })
//     data            the parsed tube-surface.json (surfaceRail.data)
//     ownerPaths      Map lineId -> [path by branch index, or null] (surfaceRail.paths)
//     overgroundPaths Map overgroundId -> [path by branch] (overground userData.linePaths), optional
//   idx.classAt(lineId, x, z, reachM) -> 1 open, 0 tunnel, null (no track of the line within reachM, in plan)
//   idx.lines                          -> line ids with track in the index
import { drawnOpenFlags } from '../surface-rail.js';
import { pathRange } from '../tube-surface-rail.js';

export const OPEN_TRACK_CELL_M = 100;

export function buildOpenTrackIndex({ data, ownerPaths, overgroundPaths = null, cell = OPEN_TRACK_CELL_M }) {
  const byLine = new Map(); // lineId -> { x: [], z: [], open: [], grid: Map }
  const add = (lineId, pts, flags, r0 = 0, r1 = pts.length - 1) => {
    let L = byLine.get(lineId);
    if (!L) { L = { x: [], z: [], open: [], grid: new Map() }; byLine.set(lineId, L); }
    for (let i = r0; i <= r1; i++) {
      const k = L.x.length, p = pts[i];
      L.x.push(p.x); L.z.push(p.z); L.open.push(flags[i] ? 1 : 0);
      const g = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      if (!L.grid.has(g)) L.grid.set(g, []);
      L.grid.get(g).push(k);
    }
  };
  for (const line of data?.lines || []) {
    const paths = ownerPaths?.get(line.id) || [];
    line.branches.forEach((b, bi) => {
      const path = paths[bi];
      if (!path || path.length < 2) return;
      const flags = drawnOpenFlags(path);
      add(line.id, path, flags);
      for (const band of b.bands || []) {
        const r = pathRange(path, band.j0, band.j1);
        if (!r) continue;
        for (const l of band.lines) if (l !== line.id) add(l, path, flags, r[0], r[1]);
      }
    });
  }
  for (const og of data?.overgroundShared || []) {
    const path = overgroundPaths?.get(og.overground)?.[og.branch];
    if (!path || path.length < 2) continue;
    const r = pathRange(path, og.j0, og.j1);
    if (!r) continue;
    const flags = path.map(p => (p.cls === 'tunnel' ? 0 : 1));
    for (const l of og.lines) add(l, path, flags, r[0], r[1]);
  }
  return {
    lines: [...byLine.keys()],
    classAt(lineId, x, z, reachM) {
      const L = byLine.get(lineId);
      if (!L) return null;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell), R = Math.ceil(reachM / cell);
      let best = -1, bd = reachM;
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const k of L.grid.get(`${cx + a},${cz + b}`) || []) {
        const d = Math.hypot(L.x[k] - x, L.z[k] - z);
        if (d <= bd) { bd = d; best = k; }
      }
      return best < 0 ? null : L.open[best];
    },
  };
}
