// drone.js: Drone conveyance mode. OWNED BY LANE A3 (sprint 23Sep26w, D-037).
// Lane A1 ships this as a STUB that falls back to Deity behaviour. Replace the
// body of createDroneMode() with the real mode; keep the export name and the id 'drone'
// and key '3'. The mode contract, the ctx fields and helper services are
// documented in src/modes/registry.js and src/modes/index.js.

import { createStubMode } from './stub.js';

/**
 * @param {object} ctx shared mode context (see src/modes/index.js)
 * @returns {object} a mode object (see src/modes/registry.js)
 */
// eslint-disable-next-line no-unused-vars
export function createDroneMode(ctx) {
  return createStubMode({ id: 'drone', label: 'Drone', key: '3' });
}
