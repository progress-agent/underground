// board-model.js: the skateboard seen from outside (sprint 14Oct26w, lane D, D-053 item 2). The Kenney Mini Skate
// `skateboard.glb` (CC0, 240 triangles) scaled to a real board, 0.80 m long, with its own texture
// (`Textures/colormap.png`, named by the GLB with a relative path: a wrong path gives a black or white board
// without an error, so the loader's texture is checked by the specs).
//
// ORIGIN. The wheels' bottom at the walker's feet point, on the ground; the deck top is 0.157 m up. The group's matrix
// is composeTrueProportionMatrix, so the board keeps its real size at every Master (D-039). Heading is the travel
// direction in the walker's yaw convention; an ollie pitches the nose up for the first quarter second; the deck rolls
// 0.35 of the walker's lean.
import { composeTrueProportionMatrix } from '../true-proportion.js';

export const BOARD = Object.freeze({
  lengthM: 0.80,
  ollieNoseUpRad: 0.35,
  ollieNoseUpS: 0.25,
  deckRollPerLean: 0.35,
});

/** The nose-up angle (radians) of an ollie `airT` seconds after take-off. Pure. */
export const ollieNoseUp = (airT) => (airT > 0 && airT < BOARD.ollieNoseUpS ? BOARD.ollieNoseUpRad * Math.sin(Math.PI * Math.min(1, airT / BOARD.ollieNoseUpS)) : 0);

export function createBoardModel({ THREE, gltf }) {
  const group = new THREE.Group();
  group.name = 'player-board';
  group.matrixAutoUpdate = false;
  group.visible = false;
  const model = gltf.scene;
  group.add(model);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; meshes.push(o); } });
  // Stand it on y = 0, centred, at a real length. The Kenney board's long axis is Z (0.30 x 0.137 x 0.70 m native),
  // and its nose is taken as -Z, the walker's yaw 0.
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const s = BOARD.lengthM / Math.max(size.x, size.z);
  model.scale.multiplyScalar(s);
  model.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);

  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3();
  let triangles = 0;
  for (const m of meshes) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;

  /**
   * @param {{ x: number, y: number, z: number, heading: number, lean: number, airT: number }} st
   *   the wheels' contact point (canonical), the travel heading, the walker's lean (positive left) and the time in
   *   the air since take-off (0 on the ground)
   */
  function update(st) {
    p.set(st.x, st.y, st.z);
    e.set(ollieNoseUp(st.airT || 0), st.heading || 0, BOARD.deckRollPerLean * (st.lean || 0), 'YXZ');
    q.setFromEuler(e);
    composeTrueProportionMatrix(group.matrix, p, q);
    group.matrixWorldNeedsUpdate = true;
    group.updateWorldMatrix(true, true);
  }

  return {
    group, model, meshes, triangles, update,
    setVisible(on) { group.visible = !!on; },
    get visible() { return group.visible; },
    get texture() { return meshes[0]?.material?.map ?? null; },
  };
}
