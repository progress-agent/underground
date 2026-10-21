// opening-jobs.js — the heavy pure jobs of the opening, runnable on any thread (sprint 21Oct26w, lane L,
// approaches G and F). A runner is a small state machine the worker keeps between messages (the terrain normal
// map's grain field is computed once, before the elevations exist, and read when they arrive). The same runner
// serves the main-thread fallback, so a worker that cannot start changes where the arithmetic runs and nothing
// else. No DOM, no three.js.

import {
  terrainGrainPixels, terrainRoughnessPixels, undersideGrainPixels, sobelNormalPixels,
  terrainNormalGrainField, terrainNormalPixels, chalkGrainPixels, chalkRoughnessPixels,
} from './texture-pixels.js';
import { setChalkRing, chalkDisplacementField } from './chalk-field.js';

export const JOBS = ['terrainNormalGrain', 'terrainNormal', 'terrainSet', 'chalkSet', 'chalkDisplacement'];

/** @returns {(job: string, args: any) => { result: any, transfer: ArrayBuffer[] }} */
export function createJobRunner() {
  const state = { grain: null };
  return function run(job, args = {}) {
    switch (job) {
      case 'terrainNormalGrain': {
        // 1.3 s of fbmNoise over 2048 x 2048, independent of the heights; kept here until they arrive.
        state.grain = terrainNormalGrainField(2048);
        return { result: true, transfer: [] };
      }
      case 'terrainNormal': {
        const pixels = terrainNormalPixels(args.heights, args.width, args.height, 2048, 3.0, state.grain);
        state.grain = null;
        return { result: pixels, transfer: [pixels.buffer] };
      }
      case 'terrainSet': {
        const grain = terrainGrainPixels();
        const roughness = terrainRoughnessPixels();
        const undersideGrain = undersideGrainPixels();
        const undersideNormal = sobelNormalPixels(undersideGrain, 1024, 1024);
        return { result: { grain, roughness, undersideGrain, undersideNormal },
          transfer: [grain.buffer, roughness.buffer, undersideGrain.buffer, undersideNormal.buffer] };
      }
      case 'chalkSet': {
        const grain = chalkGrainPixels();
        const roughness = chalkRoughnessPixels();
        const normal = sobelNormalPixels(grain, 512, 512);
        return { result: { grain, roughness, normal }, transfer: [grain.buffer, roughness.buffer, normal.buffer] };
      }
      case 'chalkDisplacement': {
        // The floor's displacement at every plane vertex (world X = x + centreX, Z likewise), rim-flattened
        // against the decimated M25 ring the main thread built.
        setChalkRing(args.ring);
        const disp = chalkDisplacementField(args.x, args.z, args.centerX, args.centerZ);
        return { result: disp, transfer: [disp.buffer] };
      }
      default:
        throw new Error(`unknown opening job ${job}`);
    }
  };
}
