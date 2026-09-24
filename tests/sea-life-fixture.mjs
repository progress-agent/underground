// Node-side fixture for sea-life specs: the Thames navigation predicate built
// from the same shared cross-sections as the rendered volume, with the
// illustrative profile bed standing in for the refined terrain floor.
import fs from 'node:fs';
import { buildThamesCrossSections, createThamesProfileSampler } from '../src/thames-profile.js';
import { createThamesNavigation } from '../src/thames-navigation.js';
import { BNG_REF_E, BNG_REF_N } from '../src/coordinates.js';

const root = new URL('../public/data/', import.meta.url);
export const THAMES = JSON.parse(fs.readFileSync(new URL('thames.json', root), 'utf8'));
export const BRIDGES = JSON.parse(fs.readFileSync(new URL('bridges.json', root), 'utf8')).bridges;
export const VE = 5, TOP_Y = 12, WATER_LEVEL_M = 2;

export function makeNavigation() {
  const cs = buildThamesCrossSections(THAMES.points, { samples: 1500, VE, waterLevelM: WATER_LEVEL_M, topY: TOP_Y });
  const sampler = createThamesProfileSampler(THAMES.points);
  const bedY = ({ x, z }) => (WATER_LEVEL_M - sampler.sampleAt(x, z).d) * VE;
  return createThamesNavigation(cs.positions, bedY, TOP_Y);
}
export const bngToScene = (e, n) => ({ x: e - BNG_REF_E, z: -(n - BNG_REF_N) });
