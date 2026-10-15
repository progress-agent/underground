// flames.js: the jetpack's flames (sprint 14Oct26w, lane P, D-053 item 4). Jordan: "flames from both hands
// and both feet ... show only while the jetpack fires, grow with thrust, and cut out underwater; plain jumps
// have none".
//
// The pure half (flameLength, flameRadius, flameVisible, flameDirection) is a deterministic function of the
// thrust level and the mode clock, pinned by node tests: no random draw anywhere (a flicker is two sines of
// the clock, a phase apart per flame). The THREE half draws four additive cones on the figure's hand and foot
// bones. Colour is in the vertex colours of one shared geometry; never per-instance colour (D-015: the M5
// driver renders it black), and the material is the plain MeshBasicMaterial.

export const FLAME_ORDER = Object.freeze(['hand_l', 'hand_r', 'foot_l', 'foot_r']);
export const FLAME = Object.freeze({
  minLevel: 0.02,
  baseLengthM: 0.55,
  baseRadiusM: 0.075,
  maxTiltRad: 25 * Math.PI / 180,
  tiltPerMps: 0.04,
});

/** Flame length in metres at thrust level L (0 to 1), mode clock t (s), flame index i. */
export function flameLength(L, t, i) {
  if (!(L > FLAME.minLevel)) return 0;
  const flick = 1 + 0.16 * Math.sin(2 * Math.PI * 9.3 * t + 1.7 * i) + 0.07 * Math.sin(2 * Math.PI * 23.1 * t + 3.4 * i);
  return FLAME.baseLengthM * (0.35 + 0.65 * Math.min(1, L)) * flick;
}

export function flameRadius(L) {
  return FLAME.baseRadiusM * (0.7 + 0.3 * Math.min(1, Math.max(0, L)));
}

/** Flames show while the jetpack fires: not on a plain jump (level 0), not underwater, not swimming. */
export function flameVisible({ level, submerged = false, state = 'air' }) {
  return level > FLAME.minLevel && !submerged && state !== 'swim';
}

/**
 * Unit flame direction in display space: down, leaning back against the horizontal velocity (vx, vz in m/s)
 * by min(25 degrees, 0.04 rad per m/s). Written into out = [x, y, z].
 */
export function flameDirection(vx, vz, out = [0, 0, 0]) {
  const sp = Math.hypot(vx, vz);
  const tilt = Math.min(FLAME.maxTiltRad, FLAME.tiltPerMps * sp);
  const s = sp > 1e-6 ? Math.sin(tilt) / sp : 0;
  out[0] = -vx * s; out[1] = -Math.cos(tilt); out[2] = -vz * s;
  return out;
}

// ── THREE half ───────────────────────────────────────────────────────────────

function coneGeometry(THREE, radius, length, base, tip) {
  const g = new THREE.ConeGeometry(1, 1, 10, 1, true);
  g.rotateX(Math.PI);          // apex to -Y
  g.translate(0, -0.5, 0);     // base ring at y = 0, apex at y = -1
  g.scale(radius, length, radius);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(base), b = new THREE.Color(tip);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, -pos.getY(i) / length));
    col[i * 3] = a.r + (b.r - a.r) * k; col[i * 3 + 1] = a.g + (b.g - a.g) * k; col[i * 3 + 2] = a.b + (b.b - a.b) * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {Function} o.mergeGeometries  BufferGeometryUtils.mergeGeometries
 * @param {Function} o.composeMatrix    true-proportion composeTrueProportionMatrix
 * @param {object} o.parent             the top-level `player` group
 * @param {(x:number,y:number,z:number)=>boolean} [o.isSubmergedAt]
 */
export function createFlames({ THREE, mergeGeometries, composeMatrix, parent, isSubmergedAt = () => false }) {
  const geometry = mergeGeometries([
    coneGeometry(THREE, 1, 1, 0xffb347, 0x000000),
    coneGeometry(THREE, 0.45, 0.55, 0xfff6d0, 0xff8a30),
  ]);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, fog: false,
  });
  const group = new THREE.Group();
  group.name = 'player-flames';
  group.visible = false;
  const meshes = FLAME_ORDER.map((name, i) => {
    const m = new THREE.Mesh(geometry, material);
    m.name = `player-flame-${name}`;
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.renderOrder = 10;
    m.visible = false;
    m.userData.index = i;
    group.add(m);
    return m;
  });
  parent.add(group);

  const base = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  const dir = [0, 0, 0], dv = new THREE.Vector3();
  const info = { visible: false, count: 0, lengthM: [0, 0, 0, 0], base: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], dir: [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]] };

  /**
   * @param {object} st  { clock, level, state, vx, vz }  (display m/s horizontal velocity)
   * @param {object} figure  createFigure result (boneWorldPosition)
   * @param {boolean} on  the figure is shown at all
   */
  function update(st, figure, on) {
    const level = st.level ?? 0;
    let count = 0;
    const gate = on && flameVisible({ level, submerged: false, state: st.state });
    flameDirection(st.vx ?? 0, st.vz ?? 0, dir);
    dv.set(dir[0], dir[1], dir[2]);
    q.setFromUnitVectors(down, dv);
    for (let i = 0; i < 4; i++) {
      const m = meshes[i];
      let show = false, len = 0;
      if (gate && figure.boneWorldPosition(FLAME_ORDER[i], base)) {
        show = !isSubmergedAt(base.x, base.y, base.z);
        if (show) {
          len = flameLength(level, st.clock ?? 0, i);
          s.set(flameRadius(level), len, flameRadius(level));
          composeMatrix(m.matrix, base, q, s);
          m.matrixWorldNeedsUpdate = true;
          count++;
          info.base[i][0] = base.x; info.base[i][1] = base.y; info.base[i][2] = base.z;
          info.dir[i][0] = dir[0]; info.dir[i][1] = dir[1]; info.dir[i][2] = dir[2];
        }
      }
      m.visible = show;
      info.lengthM[i] = show ? len : 0;
    }
    group.visible = count > 0;
    info.visible = count > 0;
    info.count = count;
    return info;
  }

  return {
    group, meshes, geometry, material, update,
    debug: () => ({
      visible: info.visible, count: info.count, lengthM: info.lengthM.slice(),
      base: info.base.map((b) => b.slice()), dir: info.dir.map((d) => d.slice()),
    }),
  };
}
