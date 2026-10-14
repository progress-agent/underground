import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUndergroundLayers, createUndergroundCull, isAboveGroundView, cullModeFor, INSIDE_MIN, BEYOND_EDGE_KIND } from '../src/underground-cull.js';

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
  assert.equal(cullModeFor({ ...base, belowSurface: true }), null, 'below ground inside the ring');
  // s14:F (D-053 item 9): below the (hidden) ground beyond the edge the surface railway above the camera would show as a
  // near-black band from underneath, so that camera gets its own mode; well inside the ring it is still nothing.
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: 0 }), 'below', 'a camera below the hidden ground beyond the edge: the beyond-edge railway is hidden');
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: 0.5 }), 'below');
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: 0.998 }), 'below');
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: INSIDE_MIN }), null, 'below ground well inside the ring: nothing hidden');
  assert.equal(cullModeFor({ ...base, belowSurface: true, insideness: 1 }), null);
  assert.equal(cullModeFor({ ...base, submerged: true }), null);
  assert.equal(cullModeFor({ ...base, submerged: true, insideness: 0 }), null);
  // Agrees with isAboveGroundView wherever the old rule applied.
  for (const insideness of [0, 0.5, 0.99, INSIDE_MIN, 1]) for (const belowSurface of [false, true]) for (const submerged of [false, true]) {
    const a = { belowSurface, submerged, insideness };
    assert.equal(cullModeFor(a) === 'full', isAboveGroundView(a));
    if (submerged) assert.equal(cullModeFor(a), null, 'in the water nothing is hidden, whatever the edge');
    if (!belowSurface && !submerged) assert.ok(['full', 'lines'].includes(cullModeFor(a)), 'above ground: as on bf10309');
  }
});

test("the 'lines' set is the top-level line groups and (s14:F) the glass shafts: never the geology, the skirt, the chalk column or the markers", () => {
  const sc = scene();
  const names = collectUndergroundLayers(sc, [], { linesOnly: true }).map(o => o.name || o.userData.kind);
  assert.deepEqual(names.sort(), ['line:central', 'line:dlr', 'unified-shafts']);
  // The default set is unchanged.
  assert.equal(collectUndergroundLayers(sc).length, 11);
});

test("render takes 'lines': hides only the line groups and the shafts for the draw and restores them", () => {
  const sc = scene(), cull = createUndergroundCull({ scene: sc });
  const central = sc.children.find(c => c.name === 'line:central'), strata = sc.children.find(c => c.name === 'geological-strata');
  let during = null;
  const shafts = sc.children.find(c => c.userData?.kind === 'unified-shafts');
  cull.render('lines', () => { during = { central: central.visible, strata: strata.visible, tunnel: sc.tidewayTunnel.visible, shafts: shafts.visible }; });
  assert.deepEqual(during, { central: false, strata: true, tunnel: true, shafts: false });
  assert.equal(shafts.visible, true, 'the shafts are back after the draw');
  assert.equal(central.visible, true);
  assert.equal(cull.status.mode, 'lines');
  assert.equal(cull.status.hidden, 3, 'two line groups and the shafts group');
  cull.render(true, () => { during = central.visible; });
  assert.equal(during, false);
  assert.equal(cull.status.mode, 'full', 'true still means the whole set');
  assert.equal(cull.status.hidden, 11);
  cull.render(null, () => { during = central.visible; });
  assert.equal(during, true);
  assert.equal(cull.status.mode, null);
  assert.equal(cull.status.hidden, 0);
});

// ── s14:F (sprint 14Oct26w, D-053 item 9): the 'below' mode, the mirror of 'lines' for a camera under the hidden ground ──
const railScene = () => {
  const stripeOn = node('', { userData: { type: 'surface-rail', part: 'stripe' } });
  const stripeBeyond = node('', { userData: { type: 'surface-rail', part: 'stripe', beyondEdge: true } });
  const dressingBeyond = node('', { userData: { type: 'surface-rail', part: 'dressing', beyondEdge: true } });
  const central = node('surface-rail-central', { userData: { kind: 'surface-rail', lineId: 'central' }, children: [stripeOn, stripeBeyond, dressingBeyond] });
  const dlr = node('surface-rail-dlr', { userData: { kind: 'surface-rail', lineId: 'dlr' }, children: [node('', { userData: { type: 'surface-rail', part: 'stripe' } })] });
  const legibility = node('beyond-edge-track-lines', { userData: { kind: BEYOND_EDGE_KIND } });
  const sc = scene();
  sc.children.push(central, dlr, legibility);
  return { sc, central, stripeOn, stripeBeyond, dressingBeyond, legibility };
};

test("the 'below' set is the beyond-edge surface railway and its minimum-width lines: nothing of the lines, shafts, geology, cliff or chalk column", () => {
  const { sc, stripeBeyond, dressingBeyond, legibility } = railScene();
  const set = collectUndergroundLayers(sc, [], { mode: 'below' });
  assert.deepEqual(new Set(set), new Set([stripeBeyond, dressingBeyond, legibility]));
  assert.ok(set.every(o => !(o.name || '').startsWith('line:') && o.userData.kind !== 'unified-shafts'));
  // The default and 'lines' sets do not take the railway: from above it is what an above-ground camera should see.
  assert.ok(!collectUndergroundLayers(sc).some(o => o === stripeBeyond || o === legibility));
  assert.ok(!collectUndergroundLayers(sc, [], { linesOnly: true }).some(o => o === stripeBeyond || o === legibility));
});

test("render takes 'below': hides only the beyond-edge railway for the draw, restores it, leaves status.active false", () => {
  const { sc, central, stripeOn, stripeBeyond, dressingBeyond, legibility } = railScene(), cull = createUndergroundCull({ scene: sc });
  const shafts = sc.children.find(c => c.userData?.kind === 'unified-shafts'), line = sc.children.find(c => c.name === 'line:central');
  dressingBeyond.visible = false; // another owner (the solo-line filter) hid it
  let during = null;
  cull.render('below', () => { during = { on: stripeOn.visible, beyond: stripeBeyond.visible, leg: legibility.visible, shafts: shafts.visible, line: line.visible, group: central.visible }; });
  assert.deepEqual(during, { on: true, beyond: false, leg: false, shafts: true, line: true, group: true });
  assert.equal(stripeBeyond.visible, true); assert.equal(legibility.visible, true);
  assert.equal(dressingBeyond.visible, false, 'never un-hides what another owner hid');
  assert.equal(cull.status.mode, 'below'); assert.equal(cull.status.hidden, 2);
  assert.equal(cull.status.active, false, "'below' is not the above-ground cull: lane R's hover rule must keep the bore the pointer is on");
  assert.throws(() => cull.render('below', () => { throw new Error('boom'); }));
  assert.equal(stripeBeyond.visible, true, 'restored even if the draw throws');
  cull.render('lines', () => {}); assert.equal(cull.status.active, true);
  cull.render(true, () => {}); assert.equal(cull.status.active, true);
  cull.render(null, () => {}); assert.equal(cull.status.active, false); assert.equal(cull.status.hidden, 0);
});
