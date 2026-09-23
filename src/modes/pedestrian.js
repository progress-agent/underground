// pedestrian.js: Pedestrian conveyance mode. OWNED BY LANE A2 (sprint 23Sep26w, D-037).
// Lane A1 ships this as a STUB that falls back to Deity behaviour. Replace the
// body of createPedestrianMode() with the real mode; keep the export name and the id 'pedestrian'
// and key '2'. The mode contract, the ctx fields and helper services are
// documented in src/modes/registry.js and src/modes/index.js.

import { createStubMode } from './stub.js';

/**
 * @param {object} ctx shared mode context (see src/modes/index.js)
 * @returns {object} a mode object (see src/modes/registry.js)
 */
// eslint-disable-next-line no-unused-vars
export function createPedestrianMode(ctx) {
  return createStubMode({ id: 'pedestrian', label: 'Pedestrian', key: '2' });
}
