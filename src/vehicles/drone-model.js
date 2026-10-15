// drone-model.js: the Drone seen from outside (sprint 14Oct26w, lane D, D-053 items 2 and 3). Built in code from the
// mock's drone (Working/player-mock-01Oct26h/src/characters.js createDrone), at its true size: 0.54 m across the
// rotors, about 300 triangles. Real metres inside a group whose matrix is composeTrueProportionMatrix, so it keeps its
// size at every Master (D-039).
//
// DETERMINISTIC. The rotors turn as a function of the mode clock alone (droneBladeAngle), never of a random draw or of
// the frame count; no per-instance colour (D-015), every mesh has its own plain material.
import { composeTrueProportionMatrix } from '../true-proportion.js';

export const DRONE = Object.freeze({
  bodyM: [0.14, 0.06, 0.22],     // width, height, length (z, the nose is -Z)
  armReachM: 0.17,               // each rotor sits at (+-0.17, +-0.17)
  rotorRadiusM: 0.10,
  bladeM: [0.19, 0.004, 0.012],
  rotorHz: 47.3,                 // rad/s of the blade angle
  rotorStepRad: 1.1,             // per-rotor phase
  ledRadiusM: 0.012,
});

/** The angle of rotor i's blade at mode-clock time t (radians). Pure. */
export const droneBladeAngle = (t, i) => t * DRONE.rotorHz + DRONE.rotorStepRad * i;

export function createDroneModel({ THREE }) {
  const group = new THREE.Group();
  group.name = 'player-drone';
  group.matrixAutoUpdate = false;
  group.visible = false;
  const rig = new THREE.Group();
  group.add(rig);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.55 });
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; rig.add(m); return m; };

  add(new THREE.BoxGeometry(...DRONE.bodyM), dark);
  add(new THREE.BoxGeometry(0.08, 0.05, 0.06), pale).position.set(0, -0.005, -0.15);     // camera pod, at the nose
  const blades = [];
  const R = DRONE.armReachM;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const len = Math.hypot(R, R);
    const arm = add(new THREE.BoxGeometry(0.03, 0.02, len), dark);
    arm.position.set(sx * R / 2, 0, sz * R / 2);
    arm.rotation.y = Math.atan2(sx, sz);
    const disc = add(new THREE.CircleGeometry(DRONE.rotorRadiusM, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    disc.position.set(sx * R, 0.035, sz * R);
    disc.renderOrder = 5;
    const blade = add(new THREE.BoxGeometry(...DRONE.bladeM),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    blade.position.set(sx * R, 0.036, sz * R);
    blade.renderOrder = 6;
    blades.push(blade);
    const led = add(new THREE.SphereGeometry(DRONE.ledRadiusM, 6, 4), new THREE.MeshBasicMaterial({ color: sz < 0 ? 0x53e07a : 0xff4a3d }));
    led.position.set(sx * R, -0.02, sz * R);
  });

  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3();
  const info = { visible: false, bladeAngles: [0, 0, 0, 0] };

  /**
   * @param {{ x: number, y: number, z: number, yaw: number, pitch: number, roll: number }} st
   *   the drone's centre (canonical) and its attitude in real space (yaw 0 faces -Z, positive left; pitch positive
   *   nose up; roll positive banks left)
   * @param {number} time  the mode clock (seconds)
   */
  function update(st, time) {
    p.set(st.x, st.y, st.z);
    e.set(st.pitch, st.yaw, st.roll, 'YXZ');
    q.setFromEuler(e);
    composeTrueProportionMatrix(group.matrix, p, q);
    group.matrixWorldNeedsUpdate = true;
    for (let i = 0; i < blades.length; i++) {
      const a = droneBladeAngle(time, i);
      blades[i].rotation.y = a;
      info.bladeAngles[i] = a;
    }
    group.updateWorldMatrix(true, true);
  }

  function setVisible(on) { group.visible = !!on; info.visible = !!on; }

  let triangles = 0;
  group.traverse((o) => { if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });

  return { group, rig, blades, update, setVisible, triangles, get visible() { return group.visible; }, debug: () => ({ visible: group.visible, bladeAngles: info.bladeAngles.slice(), triangles }) };
}
