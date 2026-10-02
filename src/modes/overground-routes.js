// overground-routes.js: "Line · towards X" for the Overground's platforms in the Pedestrian
// chooser (sprint 02Oct26f, lane O, D-048 item 5). Pure: no THREE, no DOM; tests/overground-routes.test.mjs
// pins it in node.
//
// SOURCE: TfL's Route Sequence API for the six lines, pinned to the bundled copy in
// public/data/tfl/route-sequence-overground/<line>.json (scripts/cache-tfl.mjs --overground), loaded by
// main.js into ctx.tubeRoutes under the ids `og:<line>`. It is NOT in route-sequence/: main.js builds
// a Tube line for every key of that directory's index.
//
// A platform is a station plus a direction of travel. The Overground's pieces fork and rejoin (the Weaver
// splits at Hackney Downs, the Windrush south of New Cross Gate), so the NEXT station along the walker's
// path is not always the one the trains take: ogNextStations looks past junctions to every next station
// reachable from a platform (the next on the path, plus, at each junction strictly before it, each
// continuation except straight back; 4 hops and 8 km at most), and the destinations are the union of the
// trains that call at this station and then at any of them (tube-routes.js `towards`). A direction with
// no station ahead (a terminus or a siding) has no row.
import { nextStation, pointAt, headingAt } from './pedestrian-tunnels.js';

export const OG_NEXT_MAX_HOPS = 4;
export const OG_NEXT_MAX_M = 8000;
const BACK_PROBE_M = 80;     // "straight back" is read over this much track: a pair of joined pieces start with a kink of a few metres
const BACK_DOT = 0.7;        // about 45 degrees

const _a = {}, _b = {};
/** The unit plan direction of travel from s over `len` metres of path in sense dir (clamped to the path), or null. */
function chordHeading(path, s, dir, len = BACK_PROBE_M) {
  const s1 = Math.min(path.length, Math.max(0, s + dir * len));
  pointAt(path, s, _a); pointAt(path, s1, _b);
  const x = _b.x - _a.x, z = _b.z - _a.z, l = Math.hypot(x, z);
  return l > 1e-6 ? { x: x / l, z: z / l } : null;
}
/** Does leaving (q, s, dd) go straight back the way `back` points? */
function isBack(q, s, dd, back) {
  const h = chordHeading(q, s, dd);
  return !!h && !!back && h.x * back.x + h.z * back.z > BACK_DOT;
}

/** "og:weaver" -> "Weaver" (the line's name when no route data names it). */
export function ogLineName(lineId) {
  const id = String(lineId || '').replace(/^og:/, '');
  return id ? id[0].toUpperCase() + id.slice(1) : '';
}

/**
 * Every next station reachable from (pathId, s) travelling `dir`: [{ s, id, ids?, name, path, dir }].
 */
export function ogNextStations(net, pathId, s, dir, { maxHops = OG_NEXT_MAX_HOPS, maxM = OG_NEXT_MAX_M } = {}) {
  const out = [];
  const seen = new Set();
  const walk = (pid, s0, d0, hops, dist) => {
    const p = net.paths[pid];
    if (!p) return;
    const key = `${pid}:${Math.round(s0 * 10)}:${d0}`;
    if (seen.has(key)) return;
    seen.add(key);
    const nxt = nextStation(p, s0, d0);
    for (const j of p.junctions || []) {
      if (d0 > 0 ? !(j > s0 + 1e-6) : !(j < s0 - 1e-6)) continue;                       // behind the walker
      if (nxt && (d0 > 0 ? !(j < nxt.s - 1e-6) : !(j > nxt.s + 1e-6))) continue;          // at or past the station (a path end counts when none)
      if (hops >= maxHops) continue;
      const dj = dist + Math.abs(j - s0);
      if (dj > maxM) continue;
      const back = chordHeading(p, j, -d0);                                               // where the walker came from
      for (const e of net.junctionAt.get(`${pid}:${j}`) || []) {
        if (e.path === pid && Math.abs(e.s - j) < 1e-6) continue;                         // this vertex on this path: the way on is the main flow
        const q = net.paths[e.path];
        for (const dd of [1, -1]) {
          if (dd > 0 ? e.s >= q.length - 1e-6 : e.s <= 1e-6) continue;
          if (isBack(q, e.s, dd, back)) continue;                                         // straight back the way it came
          walk(e.path, e.s, dd, hops + 1, dj);
        }
      }
    }
    if (nxt && dist + Math.abs(nxt.s - s0) <= maxM) out.push({ ...nxt, path: pid, dir: d0 });
  };
  walk(pathId, s, dir, 0, 0);
  return out;
}

/**
 * The terminal stations reached from (pathId, s) travelling `dir`: the same walk as ogNextStations, carried to
 * the ends (the fallback when no route data names the destinations). Returns the last station on each terminal
 * path end, as names.
 */
export function ogTerminalStations(net, pathId, s, dir, { maxHops = 14 } = {}) {
  const out = new Map();
  const seen = new Set();
  const go = (pid, s0, d0, hops) => {
    const p = net.paths[pid];
    if (!p || hops > maxHops) return;
    const key = `${pid}:${Math.round(s0 * 10)}:${d0}`;
    if (seen.has(key)) return;
    seen.add(key);
    const end = d0 > 0 ? p.length : 0;
    const around = (j, at) => {
      const back = chordHeading(p, j, -d0);
      let any = false;
      for (const e of net.junctionAt.get(`${pid}:${j}`) || []) {
        if (e.path === pid && Math.abs(e.s - j) < 1e-6) continue;
        const q = net.paths[e.path];
        for (const dd of [1, -1]) {
          if (dd > 0 ? e.s >= q.length - 1e-6 : e.s <= 1e-6) continue;
          if (isBack(q, e.s, dd, back)) continue;
          any = true;
          go(e.path, e.s, dd, hops + 1);
        }
      }
      return any;
    };
    for (const j of p.junctions || []) {
      if (d0 > 0 ? !(j > s0 + 1e-6 && j < end - 1e-6) : !(j < s0 - 1e-6 && j > end + 1e-6)) continue;   // mid-path forks
      around(j);
    }
    const onward = (d0 > 0 ? end > s0 + 1e-6 : end < s0 - 1e-6) && (p.junctions || []).some(j => Math.abs(j - end) < 1e-6) && around(end);
    if (!onward) {
      const S = p.stations || [];
      const ahead = d0 > 0 ? S.filter(x => x.s > s0 + 1e-6) : S.filter(x => x.s < s0 - 1e-6);
      const last = d0 > 0 ? ahead.at(-1) : ahead[0];
      if (last) out.set(last.name, last);
    }
  };
  go(pathId, s, dir, 0);
  return [...out.values()];
}

/**
 * The chooser rows of one Overground stop (tube-routes.js platformRows delegates here): one per direction in
 * which a train can leave it. Rows are { key, lineId, lineName, colour, stop, dir, next, towards, heading, label }.
 * @param {object} deps  { routes, lineColour, towards, joinOr, cleanStationName } (tube-routes.js's own, passed in)
 */
export function overgroundRows(net, stop, { routes = null, lineColour = () => null, towards, joinOr, cleanStationName } = {}) {
  const path = net?.paths?.[stop.path];
  if (!path) return [];
  const rows = [];
  const ids = stop.ids?.length ? stop.ids : (stop.id ? [stop.id] : []);
  for (const dir of [1, -1]) {
    if (dir > 0 ? stop.s >= path.length - 1e-6 : stop.s <= 1e-6) continue;
    const nexts = ogNextStations(net, stop.path, stop.s, dir);
    if (!nexts.length) continue;   // a terminus or a siding: nothing leaves this way
    const set = new Set();
    if (routes) {
      for (const nx of nexts) {
        for (const id of ids) for (const nid of (nx.ids?.length ? nx.ids : [nx.id])) {
          if (!id || !nid) continue;
          for (const d of towards(routes, { stationId: id, nextId: nid }).destinations) set.add(d);
        }
      }
    }
    // No route data for it: the last station each continuation reaches (the same walk, to the ends).
    if (!set.size) {
      for (const t of ogTerminalStations(net, stop.path, stop.s, dir)) {
        const nm = cleanStationName(t.name);
        if (nm && !ids.includes(t.id)) set.add(nm);
      }
      if (!set.size) for (const nx of nexts) { const nm = cleanStationName(nx.name); if (nm) set.add(nm); }
    }
    const destinations = [...set].sort((a, b) => a.localeCompare(b));
    const label = joinOr(destinations);
    const first = nexts.slice().sort((a, b) => Math.abs(a.s - stop.s) - Math.abs(b.s - stop.s))[0];
    const lineName = routes?.lineName || ogLineName(stop.lineId);
    const key = `${stop.lineId}|${stop.id ?? stop.name}|${nexts.map(n => n.id ?? n.name).sort().join(',')}`;
    rows.push({
      key, lineId: stop.lineId, lineName, colour: lineColour(stop.lineId) ?? null, stop, dir,
      next: { id: first.id, name: cleanStationName(first.name) },
      towards: destinations,
      heading: headingAt(path, stop.s, dir),
      label: label ? `${lineName} · towards ${label}` : lineName,
    });
  }
  return rows;
}
