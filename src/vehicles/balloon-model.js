// balloon-model.js: the Balloon seen from outside (sprint 14Oct26w, lane D, D-053 items 2 and 3). Built in code from
// the mock's balloon (characters.js createBalloon), at its true size: a 16 m wide, 16.5 m tall envelope whose mouth
// is 3.4 m above the basket floor (top 19.9 m), a 1.5 m wicker basket with walls 1.10 m high, four ropes, a burner
// and a flame. About 1,350 triangles.
//
// ORIGIN. The group's origin is the underside of the basket floor, which is the physics floor of the balloon
// (state.pos.y - BASKET_EYE_M x VE), so a landed basket sits on the ground. The sway rolls and pitches the whole
// thing about that origin.
//
// DETERMINISTIC. The flame's length is a function of the mode clock alone (balloonFlameLength); the envelope's
// colours are vertex colours (never per-instance colour, D-015).
import { composeTrueProportionMatrix } from '../true-proportion.js';

export const BALLOON = Object.freeze({
  envelopeSegments: 24,
  profilePoints: 25,
  radiusM: 8,
  mouthM: 3.4,             // the envelope's lowest point above the basket floor
  spanM: 16.5,             // its height from mouth to crown
  basketM: 1.5,            // outer width and depth
  wallHeightM: 1.10,
  wallThicknessM: 0.06,
  floorThicknessM: 0.06,
  innerHalfM: 0.69,        // the inside of a wall from the centre
  ringRadiusM: 2.2,        // where the ropes meet the mouth
  burnerM: [0.5, 0.3, 0.5],
  burnerY: 2.6,
  flameRadiusM: 0.28,
  flameBaseLengthM: 1.2,
});

/** The flame's length (m) at mode-clock time t. Pure. */
export const balloonFlameLength = (t) => BALLOON.flameBaseLengthM
  * (1 + 0.15 * Math.sin(2 * Math.PI * 7.1 * t) + 0.08 * Math.sin(2 * Math.PI * 17.3 * t));

/** The envelope's profile radius at t in 0..1 (m). Pure. */
export const envelopeRadius = (t) => BALLOON.radiusM * Math.pow(Math.sin(Math.PI * (0.07 + 0.93 * t)), 0.8);

export function createBalloonModel({ THREE }) {
  const group = new THREE.Group();
  group.name = 'player-balloon';
  group.matrixAutoUpdate = false;
  group.visible = false;

  const pts = [];
  for (let i = 0; i < BALLOON.profilePoints; i++) {
    const t = i / (BALLOON.profilePoints - 1);
    pts.push(new THREE.Vector2(envelopeRadius(t), BALLOON.mouthM + BALLOON.spanM * t));
  }
  const geo = new THREE.LatheGeometry(pts, BALLOON.envelopeSegments).toNonIndexed();
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const red = new THREE.Color(0xdc241f), cream = new THREE.Color(0xece7db);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const gore = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * BALLOON.envelopeSegments + 1e-4) % 2;
    const c = gore ? red : cream;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const envelope = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  envelope.name = 'player-balloon-envelope';
  envelope.frustumCulled = false;
  group.add(envelope);

  // The basket: four walls and a floor, open at the top so the passenger shows.
  const wicker = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
  const half = BALLOON.basketM / 2 - BALLOON.wallThicknessM / 2;
  const wh = BALLOON.wallHeightM, wt = BALLOON.wallThicknessM;
  for (const [x, z, w, d] of [[0, -half, BALLOON.basketM, wt], [0, half, BALLOON.basketM, wt], [-half, 0, wt, BALLOON.basketM], [half, 0, wt, BALLOON.basketM]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wicker);
    wall.position.set(x, wh / 2, z);
    wall.frustumCulled = false;
    wall.name = 'player-balloon-basket';
    group.add(wall);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(BALLOON.basketM, BALLOON.floorThicknessM, BALLOON.basketM), wicker);
  floor.position.y = BALLOON.floorThicknessM / 2;
  floor.frustumCulled = false;
  floor.name = 'player-balloon-basket';
  group.add(floor);

  // Four ropes, each from a basket corner at the wall top to the mouth ring.
  const rope = new THREE.MeshStandardMaterial({ color: 0x2b2f36 });
  const corner = BALLOON.basketM / 2 - 0.05, ring = BALLOON.ringRadiusM / Math.SQRT2;
  const up = new THREE.Vector3(0, 1, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = new THREE.Vector3(sx * corner, wh, sz * corner), b = new THREE.Vector3(sx * ring, BALLOON.mouthM, sz * ring);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, a.distanceTo(b), 5), rope);
    r.position.copy(a).add(b).multiplyScalar(0.5);
    r.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    r.frustumCulled = false;
    r.name = 'player-balloon-rope';
    group.add(r);
  }
  const burner = new THREE.Mesh(new THREE.BoxGeometry(...BALLOON.burnerM), rope);
  burner.position.set(0, BALLOON.burnerY, 0);
  burner.frustumCulled = false;
  burner.name = 'player-balloon-burner';
  group.add(burner);

  // The flame: a cone from the burner up into the mouth, base at the burner, scaled in length.
  const flame = new THREE.Mesh(new THREE.ConeGeometry(BALLOON.flameRadiusM, 1, 12).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  flame.name = 'player-balloon-flame';
  flame.position.set(0, BALLOON.burnerY + BALLOON.burnerM[1] / 2, 0);
  flame.visible = false;
  flame.frustumCulled = false;
  group.add(flame);

  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'XYZ'), p = new THREE.Vector3();
  const info = { burnerFlame: false, flameLengthM: 0 };

  /**
   * @param {{ x: number, y: number, z: number, swayRoll: number, swayPitch: number, burner: boolean }} st
   *   x, y, z: the basket floor's underside (canonical)
   * @param {number} time  the mode clock (seconds)
   */
  function update(st, time) {
    p.set(st.x, st.y, st.z);
    e.set(st.swayPitch || 0, 0, st.swayRoll || 0, 'XYZ');
    q.setFromEuler(e);
    composeTrueProportionMatrix(group.matrix, p, q);
    group.matrixWorldNeedsUpdate = true;
    info.burnerFlame = !!st.burner;
    flame.visible = info.burnerFlame;
    if (info.burnerFlame) { info.flameLengthM = balloonFlameLength(time); flame.scale.y = info.flameLengthM; } else info.flameLengthM = 0;
    group.updateWorldMatrix(true, true);
  }

  function setVisible(on) { group.visible = !!on; }

  let triangles = 0;
  group.traverse((o) => { if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });

  return {
    group, envelope, flame, update, setVisible, triangles,
    get visible() { return group.visible; },
    get burnerFlame() { return info.burnerFlame; },
    debug: () => ({ visible: group.visible, burnerFlame: info.burnerFlame, flameLengthM: info.flameLengthM, triangles }),
  };
}
