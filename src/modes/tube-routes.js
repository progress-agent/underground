// tube-routes.js: "Line · towards X" for the Pedestrian platform chooser
// (sprint 30Sep26w, D-041, Lane P). Pure logic, no THREE and no DOM, so node
// tests pin it against the bundled TfL data.
//
// SOURCE: TfL's Route Sequence API, pinned to the bundled copy in
// public/data/tfl/route-sequence/<line>.json (tfl.js; `?tfl=live` for a
// refresh check). Each file's `orderedLineRoutes` lists every service pattern
// as { name: "Walthamstow Central  &harr;  Brixton ", naptanIds: [...] } in
// running order. A platform is a station plus a direction of travel, and the
// trains that call there in that direction are exactly the routes in which the
// station is followed by the next station that way. Their destinations are the
// right-hand side of each route's name, which is how TfL itself names them
// ("Morden  via Bank"). So:
//
//   towards({ routes, stationId, nextId })
//     -> { destinations: ['Edgware', 'High Barnet', ...], label: 'Edgware, High Barnet or Mill Hill East' }
//
// A "via" clause is kept only while the via station is still ahead ("Morden
// via Bank" from Camden Town southbound, plain "Edgware" northbound from
// Euston), and dropped when the same destination is reached more than one way
// from this platform (both Northern branches to Morden from Chalk Farm).
//
// platformRows(net, entrance, { tubeRoutes, lineColour }) lists one row per
// platform at a station for the chooser: every stop on every line, in each
// direction a train can leave it, deduplicated (two branch paths through the
// same station and direction are one platform).

import { headingAt, nextStation } from './pedestrian-tunnels.js';

const ARROW = /\s*(?:&harr;|↔|<->)\s*/;

/** Collapse TfL's padding ("Morden  via Bank " -> "Morden via Bank"). */
const tidy = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Station name without the " Underground Station" style suffix. */
export function cleanStationName(name) {
  return tidy(name).replace(/\s+(Underground|DLR|Rail)\s+Station$/i, '').replace(/\s+Station$/i, '').trim();
}

/** A route's destination, from its own name ("A  &harr;  B  via C" -> { base: 'B', via: 'C' }). */
export function routeDestination(route, names = null) {
  const name = String(route?.name ?? '');
  const parts = name.split(ARROW);
  let right = parts.length > 1 ? tidy(parts[parts.length - 1]) : '';
  if (!right && names && route?.naptanIds?.length) right = cleanStationName(names.get(route.naptanIds.at(-1)) ?? '');
  const m = /^(.*?)\s+via\s+(.+)$/i.exec(right);
  return m ? { base: tidy(m[1]), via: tidy(m[2]) } : { base: right, via: null };
}

/** "A", "A or B", "A, B or C". */
export function joinOr(list) {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
}

/**
 * Destinations of the trains that leave `stationId` for `nextId`.
 * @param {{ orderedLineRoutes: {name, naptanIds}[], names?: Map<string,string> }} routes
 */
export function towards(routes, { stationId, nextId }) {
  const list = routes?.orderedLineRoutes || [];
  const names = routes?.names || null;
  const found = new Map(); // base -> Set of via ('' for none)
  for (const r of list) {
    const ids = r?.naptanIds || [];
    for (let i = 0; i < ids.length - 1; i++) {
      if (ids[i] !== stationId || ids[i + 1] !== nextId) continue;
      const d = routeDestination(r, names);
      if (!d.base) continue;
      let via = d.via;
      if (via && names) {
        // Keep "via X" only while X is still ahead on this route.
        const v = via.toLowerCase();
        const ahead = ids.slice(i + 1).some(id => cleanStationName(names.get(id) ?? '').toLowerCase().startsWith(v));
        if (!ahead) via = null;
      }
      if (!found.has(d.base)) found.set(d.base, new Set());
      found.get(d.base).add(via ?? '');
      break;
    }
  }
  const destinations = [];
  for (const [base, vias] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) {
    const named = [...vias].filter(Boolean);
    // One way there from this platform: say which. Several: just the place.
    if (named.length === 1 && vias.size === 1) destinations.push(`${base} via ${named[0]}`);
    else destinations.push(base);
  }
  return { destinations, label: joinOr(destinations) };
}

/**
 * The chooser rows for one station site (an entrance of the tunnel network).
 * Each row: { key, lineId, lineName, colour, stop, dir, next, towards, label }.
 * Sorted by line name, then label. `exclude(stop, dir, row)` drops rows.
 */
export function platformRows(net, entrance, { tubeRoutes = new Map(), lineColour = () => null, exclude = null } = {}) {
  const rows = [];
  const seen = new Set();
  for (const stop of entrance?.stops || []) {
    const path = net?.paths?.[stop.path];
    if (!path) continue;
    const routes = tubeRoutes.get?.(stop.lineId) ?? null;
    for (const dir of [1, -1]) {
      if (dir > 0 ? stop.s >= path.length - 1e-6 : stop.s <= 1e-6) continue;
      const next = nextStation(path, stop.s, dir);
      let t = next && stop.id ? towards(routes, { stationId: stop.id, nextId: next.id }) : { destinations: [], label: '' };
      // No route data for this pair: the last station the path reaches that way.
      if (!t.label) {
        const S = path.stations;
        const end = dir > 0 ? S.at(-1) : S[0];
        const endName = end && Math.abs(end.s - stop.s) > 1e-6 ? cleanStationName(end.name) : (next ? cleanStationName(next.name) : '');
        t = { destinations: endName ? [endName] : [], label: endName };
      }
      const key = `${stop.lineId}|${stop.id ?? stop.name}|${next?.id ?? t.label}`;
      if (seen.has(key)) continue;
      const lineName = routes?.lineName || stop.lineId;
      const row = {
        key, lineId: stop.lineId, lineName, colour: lineColour(stop.lineId) ?? null, stop, dir,
        next: next ? { id: next.id, name: cleanStationName(next.name) } : null,
        towards: t.destinations,
        heading: headingAt(path, stop.s, dir),
        label: t.label ? `${lineName} · towards ${t.label}` : lineName,
      };
      if (exclude && exclude(stop, dir, row)) { seen.add(key); continue; }
      seen.add(key);
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.lineName.localeCompare(b.lineName) || a.label.localeCompare(b.label));
  return rows;
}
