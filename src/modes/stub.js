// stub.js: placeholder conveyance mode (sprint 23Sep26w, lane A1).
// A stub is selectable, shows a "coming" hint and behaves exactly like Deity
// (update returns false, look 'none', buildings passable). Lanes A2 and A3
// replace the stubs by rewriting pedestrian.js, drone.js and balloon.js; the
// registry, keys and HUD need no change.

export function createStubMode({ id, label, key }) {
  return {
    id,
    label,
    key,
    hint: `${label} mode is coming. Deity controls meanwhile.`,
    look: 'none',
    solid: false,
    stub: true,
    update: () => false,
  };
}
