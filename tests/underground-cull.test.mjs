import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUndergroundLayers, createUndergroundCull, isAboveGroundView, INSIDE_MIN } from '../src/underground-cull.js';

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
