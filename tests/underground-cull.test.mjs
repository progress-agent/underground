import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUndergroundLayers, createUndergroundCull, isAboveGroundView, cullModeFor, INSIDE_MIN } from '../src/underground-cull.js';

// D-040 (Jordan, 26Sep26s): trade-offs 7 and 8 on, with no ribbons kept above
// ground. Plain objects stand in for the scene: only name, userData, visible
// and children are read.
const node = (name, extra = {}) => ({ name, visible: true, userData: {}, children: [], ...extra });
function scene() {
  const whirl = node('tideway-whirlpools');
  const tidewayTunnel = node('tideway-tunnel-west');
  const kids = [
    node('terrainMesh'), node('terrainUnderside'), node('geological-strata'), node('geology-exterior'),
    node('crossrail-tunnel'), node('sewer-tunnels'), node('thamesRiver'), node('surfaceGeometry'), node('overground'),
    node('tideway-system', { children: [tidewayTunnel, node('tideway-glow-west'), whirl] }),
    node('line:central'), node('line:dlr'),
    node('', { userData: { kind: 'station-markers', surfaceOnly: false } }),
    node('', { userData: { kind: 'station-markers', surfaceOnly: true } }),
    node('', { userData: { kind: 'unified-shafts' } }),
    node('clouds'), node('bridges'), node('airports'),
  ];
  return { children: kids, whirl, tidewayTunnel };
}

test('the set is the underground layers, less what is seen from above ground', () => {
  const sc = scene();
  const names = collectUndergroundLayers(sc).map(o => o.name || o.userData.kind);
  assert.deepEqual(names.sort(), [
    'crossrail-tunnel', 'geological-strata', 'geology-exterior', 'line:central', 'line:dlr', 'sewer-tunnels',
    'station-markers', 'terrainUnderside', 'tideway-glow-west', 'tideway-tunnel-west', 'unified-shafts',
  ]);
  assert.ok(!collectUndergroundLayers(sc).includes(sc.whirl), 'whirlpools are seen through the water');
  const markers = collectUndergroundLayers(sc).filter(o => o.userData.kind === 'station-markers');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].userData.surfaceOnly, false, 'Overground markers stay');
});

test('hidden only while drawing, and exactly what was visible is restored', () => {
  const sc = scene(), cull = createUndergroundCull({ scene: sc });
  const central = sc.children.find(c => c.name === 'line:central');
  const dlr = sc.children.find(c => c.name === 'line:dlr');
  dlr.visible = false; // the solo-line filter hid it
  let during = null;
  cull.render(true, () => { during = { central: central.visible, tunnel: sc.tidewayTunnel.visible, whirl: sc.whirl.visible, terrain: sc.children[0].visible }; });
  assert.deepEqual(during, { central: false, tunnel: false, whirl: true, terrain: true });
  assert.equal(central.visible, true, 'restored after the draw');
  assert.equal(dlr.visible, false, 'never un-hides what another owner hid');
  assert.equal(cull.status.hidden, 10);
  // Restored even if the draw throws.
  assert.throws(() => cull.render(true, () => { throw new Error('boom'); }));
  assert.equal(central.visible, true);
  // Inactive: draws with nothing touched.
  cull.render(false, () => { during = central.visible; });
  assert.equal(during, true);
  assert.equal(cull.status.hidden, 0);
});

test('above ground means above the surface, out of the river and well inside the edge', () => {
  const base = { belowSurface: false, submerged: false, insideness: 1 };
  assert.equal(isAboveGroundView(base), true);
  assert.equal(isAboveGroundView({ ...base, belowSurface: true }), false);
  assert.equal(isAboveGroundView({ ...base, submerged: true }), false);
  assert.equal(isAboveGroundView({ ...base, insideness: 0.99 }), false, 'near or beyond the edge the cliff shows');
  assert.equal(isAboveGroundView({ ...base, insideness: INSIDE_MIN }), true);
});

// ── s02:T (sprint 02Oct26f, D-048 item 7): the 'lines' mode beyond the edge ──
test('cullModeFor: full well inside, lines for any other above-ground camera, none below ground or in water', () => {
  const base = { belowSurface: false, submerged: false, insideness: 1 };
  assert.equal(cullModeFor(base), 'full');
  assert.equal(cullModeFor({ ...base, insideness: INSIDE_MIN }), 'full');
  assert.equal(cullModeFor({ ...base, insideness: 0.998 }), 'lines', 'in the 750 m edge band the cliff may show: lines only');
  assert.equal(cullModeFor({ ...base, insideness: 0 }), 'lines', 'beyond the ring a bore is visible from above: lines only');
  assert.equal(cullModeFor({ ...base, belowSurface: true }), null);
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: 0 }), null, 'an exterior view of the cliff is taken from below the ground');
  assert.equal(cullModeFor({ ...base, submerged: true }), null);
  assert.equal(cullModeFor({ ...base, submerged: true, insideness: 0 }), null);
  // Agrees with isAboveGroundView wherever the old rule applied.
  for (const insideness of [0, 0.5, 0.99, INSIDE_MIN, 1]) for (const belowSurface of [false, true]) for (const submerged of [false, true]) {
    const a = { belowSurface, submerged, insideness };
    assert.equal(cullModeFor(a) === 'full', isAboveGroundView(a));
  }
});

test("the 'lines' set is only the top-level line groups: never the geology, the skirt, the chalk column or the markers", () => {
  const sc = scene();
  const names = collectUndergroundLayers(sc, [], { linesOnly: true }).map(o => o.name);
  assert.deepEqual(names.sort(), ['line:central', 'line:dlr']);
  // The default set is unchanged.
  assert.equal(collectUndergroundLayers(sc).length, 11);
});

test("render takes 'lines': hides only the line groups for the draw and restores them", () => {
  const sc = scene(), cull = createUndergroundCull({ scene: sc });
  const central = sc.children.find(c => c.name === 'line:central'), strata = sc.children.find(c => c.name === 'geological-strata');
  let during = null;
  cull.render('lines', () => { during = { central: central.visible, strata: strata.visible, tunnel: sc.tidewayTunnel.visible }; });
  assert.deepEqual(during, { central: false, strata: true, tunnel: true });
  assert.equal(central.visible, true);
  assert.equal(cull.status.mode, 'lines');
  assert.equal(cull.status.hidden, 2);
  cull.render(true, () => { during = central.visible; });
  assert.equal(during, false);
  assert.equal(cull.status.mode, 'full', 'true still means the whole set');
  assert.equal(cull.status.hidden, 11);
  cull.render(null, () => { during = central.visible; });
  assert.equal(during, true);
  assert.equal(cull.status.mode, null);
  assert.equal(cull.status.hidden, 0);
});
