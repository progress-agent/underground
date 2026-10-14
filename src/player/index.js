// player/index.js: the player, assembled (sprint 14Oct26w, lane P, D-053 item 2). One object holds the figure
// (loaded after the opening); the camera rig, the view rules and the Pedestrian binding live in their own modules
// (camera-rig.js, view-rules.js, third-person.js, on-foot.js). Lane D reuses all of it for the skateboard, the
// Drone and the Balloon.
//
// TEST SURFACE (dev handle window.__ug.player): debug(), loaded, figure, group (the top-level `player` scene group,
// whose `visible` this code never writes).
import { MANNEQUIN } from './mannequin-manifest.js';
import { createFigureLoader } from './figure-loader.js';

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {object} o.scene
 */
export function createPlayer({ THREE, scene, manifest = MANNEQUIN }) {
  const group = new THREE.Group();
  group.name = 'player';
  scene.add(group);
  const loader = createFigureLoader({ THREE, parent: group, manifest });
  let visible = false;

  /**
   * Draw the figure for a frame. st: { x, y, z (canonical feet), heading, state ('ground'|'air'|'swim'), speed,
   * clock }. show=false hides it (first person, underground).
   */
  function update(dt, st, show = true) {
    const fig = loader.figure;
    if (!fig) { visible = false; return; }
    if (!show) {
      if (visible) { fig.setVisible(false); fig.clearPoses(); }
      visible = false;
      return;
    }
    visible = true;
    fig.setVisible(true);
    fig.update(dt, st);
  }

  return {
    group,
    load: () => loader.load(),
    get loaded() { return loader.loaded; },
    get status() { return loader.status; },
    get figure() { return loader.figure; },
    get visible() { return visible; },
    get screenRect() { return null; },
    update,
    project: () => null,
    setShadowEnabled() {},
    debug() {
      const fig = loader.figure;
      const fd = fig?.debug();
      return {
        loaded: loader.loaded, visible: !!(fig && fig.visible && visible), clip: fd?.clip ?? null, heading: fig?.heading ?? 0,
        poseWeights: {},
      };
    },
  };
}
