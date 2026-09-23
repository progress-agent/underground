// deity.js: the Deity mode (sprint 23Sep26w, D-037, lane A1).
//
// Deity IS the original navigation, unchanged: absolute directions, look does
// not steer travel, two speeds, no acceleration, buildings passable. Its
// motion code stays in main.js updateFpsControls exactly as it was; this mode
// object only declares itself and returns false from update() so that code
// runs. It is the only mode in which buildings are passable.
//
// Its physics-panel tunables are bound to the existing fpsControls fields and
// default to their shipped values (base 500, sprint 3x, turn 1 rad/s), so an
// untuned Deity is byte-for-byte the historical feel.

export const DEITY_TUNABLES = Object.freeze([
  { key: 'speed', label: 'Base speed', unit: 'm/s', min: 50, max: 2000, step: 10, default: 500 },
  { key: 'sprint', label: 'Fast (Shift)', unit: '×', min: 1, max: 10, step: 0.1, default: 3 },
  { key: 'turn', label: 'Arrow turn', unit: 'rad/s', min: 0.2, max: 4, step: 0.05, default: 1 },
]);

export function createDeityMode({ fpsControls, physics }) {
  const params = physics?.register('deity', 'Deity', DEITY_TUNABLES);
  const apply = () => {
    if (!params || !fpsControls) return;
    fpsControls.moveSpeed = params.speed;
    fpsControls.sprintMultiplier = params.sprint;
    fpsControls.rotateSpeed = params.turn;
  };
  apply();
  physics?.onChange((id) => { if (id === 'deity') apply(); });
  return {
    id: 'deity',
    label: 'Deity',
    key: '1',
    hint: 'WASD fly · Q/E down/up · arrows turn · Shift fast · drag to orbit',
    look: 'none',
    solid: false,
    stub: false,
    update: () => false,
  };
}
