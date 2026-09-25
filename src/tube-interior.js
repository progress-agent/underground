// tube-interior.js: the inside of a tube bore, for Pedestrian mode underground
// (sprint 25Sep26f, D-039, Lane P; Jordan's note 10).
//
// Jordan: the walker is on the tunnel axis but sees nothing. The bores main.js
// draws are frosted glass seen from OUTSIDE only (FrontSide TubeGeometry with
// outward faces), the line's crown ribbon runs through the crown overhead, and
// the camera's near plane (1.0) cuts the walls of a 3.56 m bore. This module
// is the inside: a dedicated, opaque, inward-facing lining built around the
// walker's own bore for a short window ahead and behind, drawn only while a
// Pedestrian walker is underground. Nothing here changes in any other mode:
// the mesh is invisible and every ribbon is left as it was.
//
// WHAT IT LOOKS LIKE (a readable interior, consistent with the line's colour):
//   * a dark cast-iron lining, faintly tinted with the line's colour, with
//     faint segment rings every 0.508 m (the 20 inch cast-iron rings of the
//     deep-level tubes) and the longitudinal joints of a seven-segment ring;
//   * a darker track bed in the invert with the two running rails at standard
//     gauge, so the floor reads as a railway and gives perspective;
//   * two cable runs along the walls and a warm lamp every 15 m on one wall;
//   * along the crown, a narrow stripe in the line's colour, the same device
//     as the crown ribbon seen from outside (white casing edges for the dark
//     lines, as crown-ribbon.js does), so the walker always knows the line;
//   * a headlamp falloff: the lining is lit near the walker and fades to dark
//     ahead, which is what makes distance readable in a round bore.
//
// HEIGHT CONTRACT (D-039): the bore is a STRUCTURE, so its cross-section is
// true and round at every Master, while its axis follows the stretched depth.
// Positions are authored as axis (canonical VE5 y) plus a REAL-metre offset,
// with the axis height in the `trueAxisY` attribute, and the material carries
// true-proportion.js's 'axis' patch, exactly as the exterior bores do.
//
// DETERMINISM: the geometry is a pure function of the walker's position on the
// tunnel network; the shading is a pure function of position and view.

import * as THREE from 'three';
import { pointAt, advance, headingAt } from './modes/pedestrian-tunnels.js';
import { setAxisAttribute, patchTrueProportionMaterial, boreRadiusM, trueProportionUniform, masterRatio } from './true-proportion.js';
import { CASING_LINES } from './crown-ribbon.js';

export const INTERIOR = Object.freeze({
  aheadM: 260,          // lining built this far ahead of the walker (arc metres)
  behindM: 260,         // and this far behind (they may turn round)
  stepM: 2.5,           // ring spacing of the geometry (the rings drawn are in the shader)
  radialSegments: 32,
  insetM: 0.06,         // just inside the exterior glass so the two never fight
  rebuildM: 80,         // rebuild once the walker is this far from the window centre
  ringPitchM: 0.508,    // cast-iron segment rings, 20 in
  segments: 7,          // segments per ring (six plus a key)
  gaugeM: 1.435,        // standard gauge, rail centres at +/- half
  lampPitchM: 15,
  falloffM: 24,         // headlamp falloff distance
});

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The walker's bore as a polyline: from `pos` ({ path, s, dir, side }) out to
 * `ahead` metres in the travel sense and `behind` metres against it, crossing
 * junctions the way a walker going straight on would (pedestrian-tunnels.js
 * advance, steered by the heading at each step). Points are canonical
 * { x, y, z } with a signed real-metre arc `s` (0 at the walker).
 * Returns { points, endAhead, endBehind } (true where a line ends).
 */
export function sampleBoreWindow(net, pos, { aheadM = INTERIOR.aheadM, behindM = INTERIOR.behindM,
  stepM = INTERIOR.stepM } = {}) {
  const path0 = net?.paths?.[pos?.path];
  if (!path0) return { points: [], endAhead: false, endBehind: false };
  const VE = net.VE || 5;
  const side = pos.side || 0;
  const start = pointAt(path0, pos.s, {}, side);
  const walk = (dir, limit) => {
    const out = [];
    const p = { path: pos.path, s: pos.s, dir, side };
    let prev = start, arc = 0, ended = false, guard = 0;
    while (arc < limit - 1e-6 && guard++ < 4000) {
      const want = headingAt(net.paths[p.path], p.s, p.dir);
      const before = `${p.path}:${p.s}`;
      const r = advance(net, p, Math.min(stepM, limit - arc), want);
      const q = pointAt(net.paths[p.path], p.s, {}, p.side || 0);
      const d = Math.hypot(q.x - prev.x, (q.y - prev.y) / VE, q.z - prev.z);
      if (`${p.path}:${p.s}` === before || d < 1e-6) { ended = true; break; }
      arc += d;
      out.push({ x: q.x, y: q.y, z: q.z, s: dir === (pos.dir || 1) ? arc : -arc });
      prev = q;
      if (r.stopped) { ended = true; break; }
    }
    return { out, ended };
  };
  const dir = pos.dir || 1;
  const fwd = walk(dir, aheadM);
  const back = walk(-dir, behindM);
  const points = [...back.out.reverse(), { x: start.x, y: start.y, z: start.z, s: 0 }, ...fwd.out];
  return { points, endAhead: fwd.ended, endBehind: back.ended };
}

/**
 * Inward-facing lining around a canonical polyline. Each ring is built in REAL
 * metres about its axis point (y offsets real, axis in trueAxisY), so the
 * true-proportion 'axis' patch shows it round at every Master. Attributes:
 *   position, normal (inward), trueAxisY, interiorUV = (arc metres, around 0..1
 *   from the invert, or -1 on an end cap).
 * Both ends are closed with dark caps so a window end never shows the city.
 */
export function buildInteriorGeometry(points, { radius, radialSegments = INTERIOR.radialSegments, VE = 5,
  caps = true } = {}) {
  const n = points.length;
  if (n < 2) return new THREE.BufferGeometry();
  const R = radialSegments, ring = R + 1;
  const pos = [], nrm = [], axis = [], uv = [], idx = [];
  const t = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), prevSide = new THREE.Vector3(1, 0, 0);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    t.set(b.x - a.x, (b.y - a.y) / VE, b.z - a.z);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    t.normalize();
    side.crossVectors(UP, t);
    if (side.lengthSq() < 1e-10) side.copy(prevSide);
    side.normalize(); prevSide.copy(side);
    up.crossVectors(t, side).normalize();
    frames.push({ t: t.clone(), side: side.clone(), up: up.clone() });
    const P = points[i];
    for (let j = 0; j <= R; j++) {
      const th = -Math.PI / 2 + (2 * Math.PI * j) / R;   // j = 0 is the invert (floor)
      const c = Math.cos(th), s = Math.sin(th);
      const ox = radius * (c * side.x + s * up.x), oy = radius * (c * side.y + s * up.y), oz = radius * (c * side.z + s * up.z);
      pos.push(P.x + ox, P.y + oy, P.z + oz);
      nrm.push(-ox / radius, -oy / radius, -oz / radius);
      axis.push(P.y);
      uv.push(P.s, j / R);
    }
  }
  // (i, j) -> (i+1, j) -> (i, j+1): cross(forward, +around) points inward.
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * ring + j, b = (i + 1) * ring + j, c = i * ring + j + 1, d = (i + 1) * ring + j + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (caps) {
    // End caps face back into the bore: a fan about the axis point.
    for (const [i, facing] of [[0, 1], [n - 1, -1]]) {
      const P = points[i], f = frames[i];
      const centre = pos.length / 3;
      pos.push(P.x, P.y, P.z); nrm.push(f.t.x * facing, f.t.y * facing, f.t.z * facing); axis.push(P.y); uv.push(P.s, -1);
      const base = pos.length / 3;
      for (let j = 0; j <= R; j++) {
        const k = i * ring + j;
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nrm.push(f.t.x * facing, f.t.y * facing, f.t.z * facing); axis.push(P.y); uv.push(P.s, -1);
      }
      for (let j = 0; j < R; j++) {
        // Start cap is seen looking backwards (-t); end cap looking forwards (+t).
        if (facing > 0) idx.push(centre, base + j, base + j + 1);
        else idx.push(centre, base + j + 1, base + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('interiorUV', new THREE.Float32BufferAttribute(uv, 2));
  setAxisAttribute(g, axis);
  g.setIndex(idx);
  return g;
}

// Linear-space palette (the renderer tone-maps; keep everything under the bloom threshold).
const PALETTE = {
  lining: new THREE.Color(0.062, 0.06, 0.058),  // grimy cast iron
  bed: new THREE.Color(0.035, 0.032, 0.03),     // track bed in the invert
  rail: new THREE.Color(0.42, 0.42, 0.44),       // polished running rail heads
  cable: new THREE.Color(0.02, 0.02, 0.02),
  lamp: new THREE.Color(0.95, 0.72, 0.42),
  casing: new THREE.Color(0.85, 0.85, 0.85),
};

/** The interior material: unlit lining with procedural rings, stripe and headlamp. */
export function createInteriorMaterial() {
  const uniforms = {
    uLineColour: { value: new THREE.Color(1, 1, 1) },
    uLining: { value: PALETTE.lining.clone() },
    uCasing: { value: 0 },
    uRadius: { value: 1.78 },
    uFalloff: { value: INTERIOR.falloffM },
  };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide, fog: false, toneMapped: true });
  mat.name = 'tube-interior';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 interiorUV;\nvarying vec2 vIntUV;\nvarying float vIntDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvIntUV = interiorUV;\nvIntDist = length( mvPosition.xyz );');
    const P = PALETTE;
    const v3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uLineColour;
uniform vec3 uLining;
uniform float uCasing;
uniform float uRadius;
uniform float uFalloff;
varying vec2 vIntUV;
varying float vIntDist;
float tiBand( float d, float halfWidth, float aa ) { return 1.0 - smoothstep( halfWidth, halfWidth + aa, d ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float along = vIntUV.x;
  float ang = vIntUV.y * 6.2831853;                 // 0 at the invert, PI at the crown
  float fromInvert = min( ang, 6.2831853 - ang );   // 0 floor .. PI crown, both walls
  float arcM = fromInvert * uRadius;                // metres round the wall from the invert
  float crownM = ( 3.14159265 - fromInvert ) * uRadius;
  float aaAlong = fwidth( along ) + 1e-4;
  float aaArc = fwidth( arcM ) + 1e-4;
  // Faint segment rings; fade out where they would alias into moire.
  float ph = fract( along / ${INTERIOR.ringPitchM.toFixed(3)} );
  float rd = min( ph, 1.0 - ph ) * ${INTERIOR.ringPitchM.toFixed(3)};
  float ringFade = clamp( 1.0 - aaAlong * 5.0 / ${INTERIOR.ringPitchM.toFixed(3)}, 0.0, 1.0 );
  float ring = tiBand( rd, 0.011, aaAlong * 1.5 ) * ringFade;
  // Longitudinal joints of a ${INTERIOR.segments}-segment ring.
  float sp = fract( vIntUV.y * ${INTERIOR.segments.toFixed(1)} );
  float sd = min( sp, 1.0 - sp ) * 6.2831853 * uRadius / ${INTERIOR.segments.toFixed(1)};
  float joint = tiBand( sd, 0.008, aaArc * 1.5 ) * clamp( 1.0 - aaArc * 8.0, 0.0, 1.0 );
  float h = -cos( ang );                             // -1 floor .. +1 crown
  vec3 col = uLining * ( 0.82 + 0.22 * h );
  col *= 1.0 - 0.2 * ring - 0.1 * joint;
  // Track bed in the invert, with the running rails.
  float bed = 1.0 - smoothstep( 0.62, 0.72, fromInvert );
  col = mix( col, ${v3(P.bed)}, bed );
  float railArc = asin( clamp( ${(INTERIOR.gaugeM / 2).toFixed(4)} / uRadius, 0.0, 1.0 ) ) * uRadius;
  float rail = tiBand( abs( arcM - railArc ), 0.035, aaArc * 1.5 );
  col = mix( col, ${v3(P.rail)}, rail );
  // Cable runs low on both walls.
  float cableArc = 1.25 * uRadius;
  float cable = max( tiBand( abs( arcM - cableArc ), 0.03, aaArc ), tiBand( abs( arcM - cableArc - 0.12 ), 0.025, aaArc ) );
  col = mix( col, ${v3(P.cable)}, cable * 0.6 );
  // Line colour: a thin band along both walls and the crown stripe.
  float bandArc = 1.62 * uRadius;
  float band = tiBand( abs( arcM - bandArc ), 0.035, aaArc );
  col = mix( col, uLineColour * 0.7, band );
  float stripeHalf = 0.16;
  float stripe = tiBand( crownM, stripeHalf, aaArc );
  float casing = uCasing * tiBand( abs( crownM - stripeHalf - 0.045 ), 0.045, aaArc ) * ( 1.0 - stripe );
  col = mix( col, uLineColour, stripe );
  col = mix( col, ${v3(P.casing)}, casing * 0.8 );
  // Headlamp: lit near the walker, dark ahead.
  // (Clamped: a far, sub-pixel triangle can extrapolate vIntDist below zero
  // under MSAA, and exp() of that reached 16376 in the half-float target at
  // Baker Street, a white square blooming at the vanishing point.)
  float lit = mix( 0.03, 1.0, exp( -max( vIntDist, 0.0 ) / uFalloff ) );
  col *= lit;
  // Wall lamps every ${INTERIOR.lampPitchM} m, upper wall on one side; they glow at any distance.
  float lp = fract( along / ${INTERIOR.lampPitchM.toFixed(1)} );
  float ld = min( lp, 1.0 - lp ) * ${INTERIOR.lampPitchM.toFixed(1)};
  float lampAng = abs( ang - 2.05 ) * uRadius;
  float lamp = tiBand( ld, 0.14, aaAlong ) * tiBand( lampAng, 0.07, aaArc );
  col = mix( col, ${v3(P.lamp)}, lamp );
  // Warm pool of lamp light on the wall around each lamp.
  col += ${v3(P.lamp)} * 0.035 * exp( -ld * 0.6 ) * exp( -abs( ang - 2.05 ) * uRadius * 0.8 );
  if ( vIntUV.y < -0.5 ) col = vec3( 0.004 );
  diffuseColor.rgb = clamp( col, 0.0, 1.0 );
}`);
  };
  mat.customProgramCacheKey = () => 'tube-interior-v2';
  mat.userData.interiorUniforms = uniforms;
  return patchTrueProportionMaterial(mat, { mode: 'axis' });
}

/**
 * The camera layer the lining draws on. While the walker is inside, the camera
 * sees ONLY this layer: the capped lining encloses the camera, so nothing
 * outside it could show anyway, and anything that crosses the bore (another
 * line's frosted exterior tube at an interchange, a train, a sewer, a shaft)
 * would otherwise hang inside it and break the interior's colour identity.
 * Nothing else in the app uses camera layers.
 */
export const INTERIOR_LAYER = 7;

/**
 * The interior controller main.js hands to Pedestrian mode.
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(lineId: string) => number} o.lineColour   hex colour of a line
 * @param {THREE.Camera | (() => THREE.Camera)} [o.camera]  the view camera; while the lining
 *   is shown it sees only INTERIOR_LAYER, and its layers are restored exactly on hide
 * @param {() => Iterable<THREE.Object3D>} o.mapDevices  what to hide while inside: every crown
 *   ribbon, station marker and station shaft (devices drawn over the network
 *   from outside, which cross a bore and would otherwise hang inside it)
 */
export function createTubeInterior({ scene, camera = null, lineColour = () => 0xffffff, mapDevices = () => [] } = {}) {
  const material = createInteriorMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'tube-interior';
  // s25:integrate: no userData.type. That key marks hoverable infrastructure
  // (main.js pickables, infra-hover-smoke.spec), and this mesh is neither: it
  // is hidden outside Pedestrian and has no geometry until the walker enters.
  mesh.visible = false;
  mesh.frustumCulled = false;      // the shader moves the section; the walker is always inside it
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.layers.enable(INTERIOR_LAYER);
  scene?.add(mesh);
  const cameraOf = () => (typeof camera === 'function' ? camera() : camera);
  let isolated = null;             // { cam, mask } while the camera sees only the lining

  const hidden = new Map();        // map device -> its visibility before we hid it
  let built = null;                // { net, path, side, s, lineId, radius, points }
  let builds = 0;

  function hideMapDevices() {
    // Every crown ribbon, station marker and station shaft, not just this
    // line's: sub-surface lines share centrelines (Circle, District,
    // Hammersmith & City, Metropolitan), so other lines' ribbons can run
    // through this very bore; a station's marker sphere (6 m) fills the
    // platform tunnel; and a station's frosted shaft (9 m radius about the
    // line's centreline, the bores 6 m either side) cuts across both bores as
    // a milky wall. Outside the bore the opaque lining already hides them, so
    // nothing else is lost.
    // Re-applied every frame because a terrain re-snap rebuilds ribbons.
    for (const m of mapDevices()) {
      if (!m) continue;
      if (!hidden.has(m)) hidden.set(m, m.visible);
      m.visible = false;
    }
  }
  function restoreMapDevices() {
    for (const [m, was] of hidden) m.visible = was;
    hidden.clear();
  }
  // Foreign geometry in the bore: the camera draws the lining alone.
  function isolateView() {
    const cam = cameraOf();
    if (!cam) return;
    if (isolated && isolated.cam !== cam) restoreView();
    if (!isolated) isolated = { cam, mask: cam.layers.mask };
    cam.layers.set(INTERIOR_LAYER);
  }
  function restoreView() {
    if (!isolated) return;
    isolated.cam.layers.mask = isolated.mask;
    isolated = null;
  }

  function rebuild(net, pos, lineId) {
    const radius = Math.max(0.5, boreRadiusM(lineId) - INTERIOR.insetM);
    const w = sampleBoreWindow(net, pos);
    const geometry = buildInteriorGeometry(w.points, { radius, VE: net.VE || 5 });
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    const u = material.userData.interiorUniforms;
    const c = new THREE.Color(lineColour(lineId) ?? 0xffffff);
    u.uLineColour.value.copy(c);
    u.uLining.value.copy(PALETTE.lining).lerp(c, 0.04);
    u.uCasing.value = CASING_LINES.has(lineId) ? 1 : 0;
    u.uRadius.value = radius;
    built = { net, path: pos.path, side: pos.side || 0, s: pos.s, lineId, radius, points: w.points,
      endAhead: w.endAhead, endBehind: w.endBehind };
    builds++;
  }

  return {
    mesh,
    /**
     * Show the lining around the walker. `pos` is the walker's tunnel state
     * ({ path, s, dir, side }) on `net`; rebuilt when they leave the window.
     * `isolate` (default true): the camera is inside the lining, so it draws
     * the lining alone. Pass false while the camera may still be outside it
     * (the cross passage between the shaft foot and the bore).
     */
    show(net, pos, { isolate = true } = {}) {
      if (!net || !pos || !net.paths?.[pos.path]) { this.hide(); return false; }
      const lineId = net.paths[pos.path].lineId;
      const stale = !built || built.net !== net || built.path !== pos.path || built.side !== (pos.side || 0)
        || Math.abs(pos.s - built.s) > INTERIOR.rebuildM;
      if (stale) rebuild(net, pos, lineId);
      mesh.visible = true;
      hideMapDevices();
      if (isolate) isolateView(); else restoreView();
      return true;
    },
    hide() {
      mesh.visible = false;
      restoreMapDevices();
      restoreView();
    },
    get visible() { return mesh.visible; },
    /** The line whose bore is shown, or null when hidden. */
    get lineId() { return mesh.visible ? built?.lineId ?? null : null; },
    debug() {
      return {
        visible: mesh.visible, builds, lineId: built?.lineId ?? null, radius: built?.radius ?? null,
        path: built?.path ?? null, side: built?.side ?? null, points: built?.points.length ?? 0,
        hiddenDevices: hidden.size, isolated: !!isolated, endAhead: built?.endAhead ?? null, endBehind: built?.endBehind ?? null,
      };
    },
    /**
     * Cast `count` rays from the camera in DISPLAY space (what is drawn:
     * true-proportion unscale applied, then the camera's Master transform),
     * evenly round the bore axis, plus `oblique` more tilted 45 degrees
     * ahead and behind. Returns each hit distance in display metres (null if
     * a ray escapes). Test surface: proves the walker is enclosed.
     */
    probe(camera, { count = 24, oblique = true } = {}) {
      if (!built || !mesh.visible) return null;
      const ratio = masterRatio();                  // display y = canonical y x ratio
      const trueY = trueProportionUniform.value;    // the 'axis' patch's section factor
      const src = mesh.geometry;
      const p = src.attributes.position, ax = src.attributes.trueAxisY;
      const disp = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const a = ax.getX(i);
        disp[i * 3] = p.getX(i);
        disp[i * 3 + 1] = (a + (p.getY(i) - a) * trueY) * ratio;
        disp[i * 3 + 2] = p.getZ(i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(disp, 3));
      g.setIndex(src.index);
      const probeMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
      const origin = new THREE.Vector3(camera.position.x, camera.position.y * ratio, camera.position.z);
      // Local display-space frame of the bore at the walker.
      const pts = built.points, i0 = pts.findIndex(q => q.s === 0);
      const a = pts[Math.max(0, i0 - 1)], b = pts[Math.min(pts.length - 1, i0 + 1)];
      const t = new THREE.Vector3(b.x - a.x, (b.y - a.y) * ratio, b.z - a.z).normalize();
      const side = new THREE.Vector3().crossVectors(UP, t).normalize();
      const up = new THREE.Vector3().crossVectors(t, side).normalize();
      const rc = new THREE.Raycaster();
      rc.near = 0; rc.far = 1e4;
      const hits = [];
      const dirs = [];
      for (let k = 0; k < count; k++) {
        const th = (2 * Math.PI * k) / count;
        const d = side.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th));
        dirs.push({ kind: 'radial', th, d });
        if (oblique) {
          dirs.push({ kind: 'ahead', th, d: d.clone().add(t).normalize() });
          dirs.push({ kind: 'behind', th, d: d.clone().sub(t).normalize() });
        }
      }
      for (const { kind, th, d } of dirs) {
        rc.set(origin, d.normalize());
        const h = rc.intersectObject(probeMesh, false)[0];
        hits.push({ kind, th, distance: h ? h.distance : null });
      }
      g.dispose(); probeMesh.material.dispose();
      return { hits, radius: built.radius };
    },
    dispose() {
      this.hide();
      scene?.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
