// Sprint 25Sep26f Lane E (D-039): rail truth at the river.
//  - District line crosses on Fulham Railway Bridge (Putney) and Kew Railway
//    Bridge, not in tunnel.
//  - Thames Tunnel (Wapping to Rotherhithe) sits about 5 m below the bed, sourced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { RAIL_BRIDGE_CROSSINGS, THAMES_TUNNEL, findBridgeCrossings, crossingDeckEnds, tubeOnDeckY } from '../src/rail-truth.js';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const bridges = JSON.parse(readFileSync(new URL('../public/data/bridges.json', import.meta.url))).bridges;
const ref = { e: BNG_REF_E, n: BNG_REF_N };
const ll = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:27700', [lon, lat]); return { x: e - BNG_REF_E, z: -(n - BNG_REF_N) }; };

test('crossing data matches the bridges bridges.js draws (axis and clearance)', () => {
  for (const c of RAIL_BRIDGE_CROSSINGS) {
    const b = bridges.find(x => x.curatedSlug === c.bridge);
    assert.ok(b, c.bridge);
    assert.equal(b.name, c.name);
    assert.deepEqual(c.axis, { a: b.axis.a, b: b.axis.b });
    assert.equal(c.clearanceM, b.clearanceM);
    assert.match(b.kind, /rail/);
  }
  assert.deepEqual(RAIL_BRIDGE_CROSSINGS.map(c => c.bridge).sort(), ['fulham-rail', 'kew-rail']);
});

test('the District chords Putney Bridge to East Putney and Gunnersbury to Kew Gardens find their bridges', () => {
  const stations = {
    'Putney Bridge': ll(51.468262, -0.208731), 'East Putney': ll(51.459205, -0.211),
    Gunnersbury: ll(51.491803, -0.275267), 'Kew Gardens': ll(51.477058, -0.285241),
  };
  for (const c of RAIL_BRIDGE_CROSSINGS) {
    const pts = c.between.map(n => stations[n]);
    const hits = findBridgeCrossings('district', pts, ref);
    assert.equal(hits.length, 1, c.name);
    assert.equal(hits[0].crossing.bridge, c.bridge);
    // Deck ends run in the direction of travel.
    const d = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    assert.ok(d(pts[0], hits[0].ends.a) < d(pts[0], hits[0].ends.b));
    // And reversed travel still matches, with the ends swapped.
    const back = findBridgeCrossings('district', pts.slice().reverse(), ref);
    assert.equal(back.length, 1);
    assert.ok(d(pts[1], back[0].ends.a) < d(pts[1], back[0].ends.b));
  }
  // Other lines never pick up a District crossing; a chord far from any bridge finds nothing.
  assert.equal(findBridgeCrossings('piccadilly', [stations['Putney Bridge'], stations['East Putney']], ref).length, 0);
  assert.equal(findBridgeCrossings('district', [ll(51.51, -0.1), ll(51.50, -0.1)], ref).length, 0);
});

test('deck ends overshoot the axis so the line lands on both banks', () => {
  for (const c of RAIL_BRIDGE_CROSSINGS) {
    const ends = crossingDeckEnds(c, ref);
    const axisLen = Math.hypot(c.axis.b.e - c.axis.a.e, c.axis.b.n - c.axis.a.n);
    assert.ok(Math.abs(ends.lengthM - axisLen - 50) < 1e-6);
  }
});

test('a tube resting on a deck sits above the deck top and above the water', () => {
  const VE = 5, water = 2 * VE + 2, deck = water + 5.9 * VE;
  const y = tubeOnDeckY(deck, VE, 4.5);
  assert.ok(y - 4.5 >= deck + 0.6 * VE - 1e-9);
  assert.ok(y > water);
});

test('Thames Tunnel depth is the sourced figure: 7 ft cover + half of a 20 ft bore, about 5 m', () => {
  assert.ok(Math.abs(THAMES_TUNNEL.crownCoverM - 7 * 0.3048) < 0.01);
  assert.ok(Math.abs(THAMES_TUNNEL.boreHeightM - 20 * 0.3048) < 0.01);
  assert.ok(Math.abs(THAMES_TUNNEL.centreBelowBedM - (THAMES_TUNNEL.crownCoverM + THAMES_TUNNEL.boreHeightM / 2)) < 0.05);
  assert.ok(THAMES_TUNNEL.centreBelowBedM > 4 && THAMES_TUNNEL.centreBelowBedM < 6);
  assert.ok(THAMES_TUNNEL.sources.length >= 2);
});
