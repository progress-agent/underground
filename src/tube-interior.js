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
//
// THE OPEN AIR (sprint 01Oct26h, D-042 item 1, Lane P): where the walker is
// shown on the drawn track in the open, the lining is not drawn, but the same
// map devices are hidden (hideDevicesOnly): a station marker is a 12 m ball
// sized for the view from the sky, and at platform level the walker stood
// between two of them at Golders Green. Labels are left to main.js.
//
// PLATFORMS AND PORTALS (sprint 30Sep26w, D-041, Lane P): every platform the
// window reaches is drawn as the lit, true-size platform tunnel of
// platform-tunnel.js (its walls, platform edge and roundel boards), and the
// lining is cut away along it so the bore visibly opens into the station.
//
// THE TUNNEL MOUTH (fix round 1): a window that ends at a portal
// (pedestrian-tunnels.js markOpenSections) ends in a DAYLIGHT cap instead of
// a dark one: the opening drawn in the sky colour of the time set on the Sun
// slider (sun.js; the slider never reaches night) above the horizon, a darker
// ground below it with the running rails carried out to the horizon, and the
// daylight washing the last few metres of lining. The camera stays
// isolated to INTERIOR_LAYER right up to the mouth, as everywhere else in the
// bore (the sprint 25Sep26f contract: nothing but the walker's own lining is
// drawn inside it). The first build left the camera unisolated within a
// window of a mouth so the world would show through it, and it did not: the
// model has no cutting at a portal (the track simply reaches the ground), so
// the opening showed building walls and the strata, and buildings over a
// shallow tunnel cut into its crown. All of it is on INTERIOR_LAYER only.

import * as THREE from 'three';
import { pointAt, advance, headingAt } from './modes/pedestrian-tunnels.js';
// ── s30:P ──
import { PLATFORM, slicePolyline, buildPlatformGeometry, buildRoundelGeometry, createPlatformMaterial,
  createRoundelMaterial, roundelTexture } from './platform-tunnel.js';
import { cleanStationName } from './modes/tube-routes.js';
// ── /s30:P ──
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
  // s30:P the platforms the window reaches ({ stop, s: signed arc, path, side }) and portal ends.
  const stops = [];
  for (const { s: ss, stop } of path0.stops || []) if (Math.abs(ss - pos.s) < 1e-6) stops.push({ stop, s: 0, path: pos.path, side });
  const walk = (dir, limit) => {
    const out = [];
    const p = { path: pos.path, s: pos.s, dir, side };
    const sign = dir === (pos.dir || 1) ? 1 : -1;
    let prev = start, arc = 0, ended = false, portal = false, guard = 0;
    while (arc < limit - 1e-6 && guard++ < 4000) {
      const want = headingAt(net.paths[p.path], p.s, p.dir);
      const before = `${p.path}:${p.s}`;
      const r = advance(net, p, Math.min(stepM, limit - arc), want);
      for (const c of r.crossed || []) stops.push({ stop: c.stop, s: sign * (arc + c.at), path: c.stop.path, side: p.side || 0 });
      if (r.portal) portal = true;
      const q = pointAt(net.paths[p.path], p.s, {}, p.side || 0);
      const d = Math.hypot(q.x - prev.x, (q.y - prev.y) / VE, q.z - prev.z);
      if (`${p.path}:${p.s}` === before || d < 1e-6) { ended = true; break; }
      arc += d;
      out.push({ x: q.x, y: q.y, z: q.z, s: sign * arc });
      prev = q;
      if (r.stopped) { ended = true; break; }
    }
    return { out, ended, portal };
  };
  const dir = pos.dir || 1;
  const fwd = walk(dir, aheadM);
  const back = walk(-dir, behindM);
  const points = [...back.out.reverse(), { x: start.x, y: start.y, z: start.z, s: 0 }, ...fwd.out];
  return { points, endAhead: fwd.ended, endBehind: back.ended, portalAhead: fwd.portal, portalBehind: back.portal, stops };
}

// ── s30:P ──
/**
 * The platform zones along a bore window: each platform the window reaches,
 * as [a0, a1] in the window's signed arc, PLATFORM.lengthM long and centred on
 * the stop (a terminus platform runs back from the line's end). A zone the
 * window only partly reaches is left out until the walker is nearer, so a
 * platform is never drawn cut short. `sigma`: which hand the platform is on.
 */
export function platformZones(net, win, { lengthM = PLATFORM.lengthM } = {}) {
  const pts = win?.points || [];
  if (pts.length < 2) return [];
  const lo = pts[0].s, hi = pts[pts.length - 1].s;
  const zones = [];
  const seen = new Set();
  for (const w of win.stops || []) {
    const key = `${w.stop.lineId}:${w.stop.name}:${Math.round(w.s)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let a0 = w.s - lengthM / 2, a1 = w.s + lengthM / 2;
    if (a1 > hi && win.endAhead && !win.portalAhead) { a1 = hi; a0 = hi - lengthM; }
    if (a0 < lo && win.endBehind && !win.portalBehind) { a0 = lo; a1 = lo + lengthM; }
    if (a0 < lo - 1e-6 || a1 > hi + 1e-6) continue;
    // The platform is on the side of the bore toward the line's centreline
    // (where the cross passage from the shaft arrives).
    const path = net.paths[w.path];
    let sigma = 1;
    if (path && w.side) {
      const c = pointAt(path, w.stop.s, {}, 0), b = pointAt(path, w.stop.s, {}, w.side);
      // The window's own frame at the stop: side = UP x t.
      let i = 0;
      while (i < pts.length - 2 && pts[i + 1].s < w.s) i++;
      const tx = pts[i + 1].x - pts[i].x, tz = pts[i + 1].z - pts[i].z;
      const sx = tz, sz = -tx;   // UP x t = (t.z, 0, -t.x)
      const d = (c.x - b.x) * sx + (c.z - b.z) * sz;
      if (Math.abs(d) > 1e-6) sigma = Math.sign(d);
    }
    zones.push({ stop: w.stop, name: cleanStationName(w.stop.name), lineId: w.stop.lineId, s: w.s, a0, a1, sigma });
  }
  return zones.sort((a, b) => a.a0 - b.a0);
}
// ── /s30:P ──

/**
 * Inward-facing lining around a canonical polyline. Each ring is built in REAL
 * metres about its axis point (y offsets real, axis in trueAxisY), so the
 * true-proportion 'axis' patch shows it round at every Master. Attributes:
 *   position, normal (inward), trueAxisY, interiorUV = (arc metres, around 0..1
 *   from the invert, or -1 on an end cap).
 * Both ends are closed with dark caps so a window end never shows the city.
 * s30:P `caps` may be { start, end }, each true (dark cap), false (open) or
 * 'mouth': a daylight cap at a tunnel mouth, whose interiorUV.y runs from -2
 * at the invert to -3 at the crown (-2.5 at the axis), linear in height, and
 * whose interiorUV.x is the offset across the bore over the radius (0 on the
 * axis), so the shader can grade the opening from ground to sky and run the
 * rails out to the horizon.
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
    // (s30:P `caps` may be { start, end }: each end dark, open, or a daylight 'mouth'.)
    const kindOf = (i) => (caps === true ? true : (i === 0 ? caps.start : caps.end) ?? true);
    const ends = [[0, 1], [n - 1, -1]].filter(([i]) => kindOf(i) !== false);
    for (const [i, facing] of ends) {
      const P = points[i], f = frames[i];
      const mouth = kindOf(i) === 'mouth';
      // Dark cap: -1 everywhere. Mouth: -2 (invert) .. -3 (crown), -2.5 at the axis.
      // (A mouth's u is the point's offset across the bore over the radius, 0 on the axis.)
      const th = (j) => -Math.PI / 2 + (2 * Math.PI * j) / R;
      const capU = (j) => (mouth ? Math.cos(th(j)) : P.s);
      const capV = (j) => (mouth ? -2.5 - 0.5 * Math.sin(th(j)) : -1);
      const centre = pos.length / 3;
      pos.push(P.x, P.y, P.z); nrm.push(f.t.x * facing, f.t.y * facing, f.t.z * facing); axis.push(P.y); uv.push(mouth ? 0 : P.s, mouth ? -2.5 : -1);
      const base = pos.length / 3;
      for (let j = 0; j <= R; j++) {
        const k = i * ring + j;
        pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        nrm.push(f.t.x * facing, f.t.y * facing, f.t.z * facing); axis.push(P.y); uv.push(capU(j), capV(j));
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

// ── s30:P ── the tunnel mouth (fix round 1)
/** The window arc used when a window has no mouth (far beyond any lining). */
export const NO_MOUTH = 1e6;
/** sun.js's legacy sky colour (0x5a7a8f) in linear space, until main.js hands over the Sun slider's. */
const DAYLIGHT_DEFAULT = new THREE.Color(0x5a7a8f);
export const MOUTH = Object.freeze({
  skyWhite: 0.5,        // sky colour taken this far to white: the eye is adapted to the bore's dark
  skyGain: 1.3,         // about 0.75 to 0.85 linear over the slider: bright, under the bloom threshold (0.88)
  ground: new THREE.Color(0.52, 0.55, 0.42), // ballast and verges in daylight
  groundMix: 0.75,
  groundGain: 0.5,      // well below the sky, so the horizon reads across the opening
  washGain: 0.12,       // daylight on the lining at the mouth itself
  washM: 5,             // and its fall-off into the bore (metres of arc); nothing at the walker 20 m in
});
// ── /s30:P ──

/** The interior material: unlit lining with procedural rings, stripe and headlamp. */
export function createInteriorMaterial() {
  const uniforms = {
    uLineColour: { value: new THREE.Color(1, 1, 1) },
    uLining: { value: PALETTE.lining.clone() },
    uCasing: { value: 0 },
    uRadius: { value: 1.78 },
    uFalloff: { value: INTERIOR.falloffM },
    // ── s30:P ── platform zones: the lining is cut away along them
    uCut: { value: [new THREE.Vector2(1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 0)] },
    // Tunnel mouths (fix round 1): the daylight (linear sky colour) and the
    // window arcs of a mouth at its start and end (NO_MOUTH when there is none).
    uDaylight: { value: DAYLIGHT_DEFAULT.clone() },
    uMouth: { value: new THREE.Vector2(NO_MOUTH, NO_MOUTH) },
    // ── /s30:P ──
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
uniform vec2 uCut[ 4 ];
uniform vec3 uDaylight;
uniform vec2 uMouth;
varying vec2 vIntUV;
varying float vIntDist;
float tiBand( float d, float halfWidth, float aa ) { return 1.0 - smoothstep( halfWidth, halfWidth + aa, d ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float along = vIntUV.x;
  // s30:P the bore opens into the platform tunnel here (caps are never cut).
  if ( vIntUV.y > -0.5 ) {
    for ( int k = 0; k < 4; k++ ) { if ( along > uCut[ k ].x && along < uCut[ k ].y ) discard; }
  }
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
  // s30:P a tunnel mouth. Seen from a dark bore the opening is over-exposed:
  // the sky colour taken most of the way to white, the ground well below it.
  vec3 mouthSky = mix( uDaylight, vec3( 1.0 ), ${MOUTH.skyWhite.toFixed(3)} ) * ${MOUTH.skyGain.toFixed(3)};
  vec3 mouthGround = mix( uDaylight, ${v3(MOUTH.ground)}, ${MOUTH.groundMix.toFixed(3)} ) * ${MOUTH.groundGain.toFixed(3)};
  // Daylight falling in lights the last metres of lining, the invert (and its rails) most.
  float toMouth = min( abs( along - uMouth.x ), abs( along - uMouth.y ) );
  col += mouthSky * ${MOUTH.washGain.toFixed(3)} * exp( -toMouth / ${MOUTH.washM.toFixed(2)} ) * ( 0.75 - 0.25 * h );
  // The mouth itself: ground in daylight below the axis, sky above it. (Worked
  // out for every fragment, like the lining above, so fwidth is never taken in
  // a branch; only a mouth fragment uses it.)
  float up01 = clamp( -2.0 - vIntUV.y, 0.0, 1.0 );     // 0 at the invert, 1 at the crown
  vec3 mouthCol = mix( mouthGround, mouthSky, smoothstep( 0.42, 0.56, up01 ) );
  // The running rails carry on out into the daylight. The eye is on the bore
  // axis, so a straight, level track beyond the mouth is seen as two lines
  // from the rails at the rim to the centre (the horizon's vanishing point):
  // across / below stays the rail's own ratio all the way in.
  float below = 1.0 - 2.0 * up01;                        // 1 at the invert, 0 on the axis
  float gh = ${(INTERIOR.gaugeM / 2).toFixed(4)};
  float rimDown = sqrt( max( uRadius * uRadius - gh * gh, 1e-4 ) );
  float ratio = abs( vIntUV.x ) / max( below, 1e-3 );    // across / below (both over the radius)
  float railOut = tiBand( abs( ratio - gh / rimDown ), 0.035 / rimDown, fwidth( ratio ) * 1.5 )
    * smoothstep( 0.03, 0.15, below );
  mouthCol = mix( mouthCol, mouthSky * 0.95, railOut );
  if ( vIntUV.y < -1.5 ) {
    col = mouthCol;
  } else if ( vIntUV.y < -0.5 ) col = vec3( 0.004 );
  diffuseColor.rgb = clamp( col, 0.0, 1.0 );
}`);
  };
  mat.customProgramCacheKey = () => 'tube-interior-v4'; // s30:P cut zones and daylight mouths
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
  // ── s30:P ── the platform tunnels in the window (drawn only while the lining is)
  const platformGroup = new THREE.Group();
  platformGroup.name = 'tube-interior-platforms';
  platformGroup.visible = false;
  platformGroup.matrixAutoUpdate = false;
  scene?.add(platformGroup);
  const platformMaterial = createPlatformMaterial();
  const roundelMaterials = new Map();   // station name -> material
  let zones = [];
  let daylight = null;                  // () => THREE.Color, the mouth's daylight (setDaylight)
  function clearPlatforms() {
    for (const m of [...platformGroup.children]) { platformGroup.remove(m); m.geometry.dispose(); }
  }
  function roundelMaterial(name) {
    let m = roundelMaterials.get(name);
    if (!m) {
      m = createRoundelMaterial(roundelTexture(name));
      roundelMaterials.set(name, m);
      if (roundelMaterials.size > 24) {
        const [k, old] = roundelMaterials.entries().next().value;
        if (old !== m) { old.dispose(); roundelMaterials.delete(k); }
      }
    }
    return m;
  }
  // Like the lining: on the default layer too (the camera is not isolated in the
  // cross passage) and on INTERIOR_LAYER; hidden outside the bore.
  function layerOnly(o) {
    o.layers.enable(INTERIOR_LAYER);
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
    o.matrixAutoUpdate = false;
    return o;
  }
  function buildPlatforms(net, w, lineId, radius) {
    clearPlatforms();
    zones = platformZones(net, w);
    const u = material.userData.interiorUniforms;
    for (let k = 0; k < 4; k++) {
      const z = zones[k];
      // Cut a hair inside the zone: the end walls close the gap at the eye.
      u.uCut.value[k].set(z ? z.a0 + 0.02 : 1, z ? z.a1 - 0.02 : 0);
    }
    platformMaterial.userData.platformUniforms.uLineColour.value.set(lineColour(lineId) ?? 0xffffff);
    for (const z of zones.slice(0, 4)) {
      const slice = slicePolyline(w.points, z.a0, z.a1);
      if (slice.length < 2) continue;
      const opts = { sigma: z.sigma, liningRadius: radius, VE: net.VE || 5 };
      const tunnel = layerOnly(new THREE.Mesh(buildPlatformGeometry(slice, opts), platformMaterial));
      tunnel.name = `platform-tunnel:${z.name}`;
      tunnel.userData.platform = { name: z.name, lineId: z.lineId, a0: z.a0, a1: z.a1, sigma: z.sigma };
      const boards = layerOnly(new THREE.Mesh(buildRoundelGeometry(slice, opts), roundelMaterial(z.name)));
      boards.name = `platform-roundels:${z.name}`;
      platformGroup.add(tunnel, boards);
    }
  }
  // ── /s30:P ──

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
    // s30:P a portal end is closed by a daylight cap: the mouth of the tunnel.
    const geometry = buildInteriorGeometry(w.points, { radius, VE: net.VE || 5,
      caps: { start: w.portalBehind ? 'mouth' : true, end: w.portalAhead ? 'mouth' : true } });
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    const u = material.userData.interiorUniforms;
    const pts = w.points;
    u.uMouth.value.set(w.portalBehind && pts.length ? pts[0].s : NO_MOUTH,
      w.portalAhead && pts.length ? pts[pts.length - 1].s : NO_MOUTH);
    const c = new THREE.Color(lineColour(lineId) ?? 0xffffff);
    u.uLineColour.value.copy(c);
    u.uLining.value.copy(PALETTE.lining).lerp(c, 0.04);
    u.uCasing.value = CASING_LINES.has(lineId) ? 1 : 0;
    u.uRadius.value = radius;
    // ── s30:P ──
    buildPlatforms(net, w, lineId, radius);
    // ── /s30:P ──
    built = { net, path: pos.path, side: pos.side || 0, s: pos.s, dir: pos.dir || 1, lineId, radius, points: w.points,
      endAhead: w.endAhead, endBehind: w.endBehind, portalAhead: !!w.portalAhead, portalBehind: !!w.portalBehind };
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
      platformGroup.visible = true; // s30:P
      hideMapDevices();
      // s30:P the mouth's daylight follows the Sun slider.
      if (daylight) {
        const c = daylight();
        if (c) material.userData.interiorUniforms.uDaylight.value.copy(c);
      }
      // Isolated right up to a tunnel mouth too (fix round 1): the mouth is
      // the lining's own daylight cap, never a view onto the model outside.
      if (isolate) isolateView(); else restoreView();
      return true;
    },
    // ── s30:P ──
    /** Where the mouth's daylight comes from: () => THREE.Color (linear), e.g. the Sun slider's sky colour. */
    setDaylight(fn) { daylight = typeof fn === 'function' ? fn : null; },
    // ── /s30:P ──
    hide() {
      mesh.visible = false;
      platformGroup.visible = false; // s30:P
      restoreMapDevices();
      restoreView();
    },
    // ── s01:P ──
    /** The walker in the open: no lining and the camera unisolated, but the map devices hidden as in the bore. */
    hideDevicesOnly() {
      mesh.visible = false;
      platformGroup.visible = false;
      restoreView();
      hideMapDevices();
    },
    // ── /s01:P ──
    get visible() { return mesh.visible; },
    /** The line whose bore is shown, or null when hidden. */
    get lineId() { return mesh.visible ? built?.lineId ?? null : null; },
    debug() {
      return {
        visible: mesh.visible, builds, lineId: built?.lineId ?? null, radius: built?.radius ?? null,
        path: built?.path ?? null, side: built?.side ?? null, points: built?.points.length ?? 0,
        hiddenDevices: hidden.size, isolated: !!isolated, endAhead: built?.endAhead ?? null, endBehind: built?.endBehind ?? null,
        // ── s30:P ──
        portalAhead: built?.portalAhead ?? null, portalBehind: built?.portalBehind ?? null,
        mouth: (() => { const m = material.userData.interiorUniforms.uMouth.value;
          return { start: m.x < NO_MOUTH ? m.x : null, end: m.y < NO_MOUTH ? m.y : null }; })(),
        daylight: material.userData.interiorUniforms.uDaylight.value.toArray(),
        platforms: zones.map(z => ({ name: z.name, lineId: z.lineId, s: z.s, a0: z.a0, a1: z.a1, sigma: z.sigma })),
        platformMeshes: platformGroup.children.length, platformsVisible: platformGroup.visible,
        // ── /s30:P ──
      };
    },
    // ── s30:P ──
    /** The walker's bore window as built: canonical points with signed arc s (0 at the build point). */
    get windowPoints() { return built?.points ?? null; },
    /** Arc of the build point relative to the walker now (the window is rebuilt every INTERIOR.rebuildM). */
    walkerArc(pos) {
      if (!built || !pos || pos.path !== built.path) return null;
      return (pos.s - built.s) * (built.dir || 1);
    },
    platformGroup,
    // ── /s30:P ──
    /**
     * Cast `count` rays from the camera in DISPLAY space (what is drawn:
     * true-proportion unscale applied, then the camera's Master transform),
     * evenly round the bore axis, plus `oblique` more tilted 45 degrees
     * ahead and behind. Returns each hit distance in display metres (null if
     * a ray escapes). Test surface: proves the walker is enclosed.
     */
    probe(camera, { count = 24, oblique = true, platforms = true } = {}) {
      if (!built || !mesh.visible) return null;
      const ratio = masterRatio();                  // display y = canonical y x ratio
      const trueY = trueProportionUniform.value;    // the 'axis' patch's section factor
      const displayed = (src, side) => {
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
        return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side }));
      };
      // s30:P the lining is not drawn along a platform zone (its shader cuts it
      // away), so a ray there must meet the platform tunnel instead.
      const cutAt = (arc) => zones.some(z => arc > z.a0 + 0.02 && arc < z.a1 - 0.02);
      const probeMesh = displayed(mesh.geometry, THREE.FrontSide);
      const tunnels = platforms ? platformGroup.children.filter(m => m.name.startsWith('platform-tunnel:')).map(m => displayed(m.geometry, THREE.DoubleSide)) : [];
      const g = probeMesh.geometry;
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
      const uv = mesh.geometry.attributes.interiorUV;
      for (const { kind, th, d } of dirs) {
        rc.set(origin, d.normalize());
        // The first lining hit that is actually drawn (not in a cut zone; caps always are).
        const lining = rc.intersectObject(probeMesh, false).find(h => {
          const a = uv.getX(h.face.a), cap = uv.getY(h.face.a) < -0.5;
          return cap || !cutAt(a);
        });
        const plat = tunnels.length ? rc.intersectObjects(tunnels, false)[0] : null;
        const h = [lining, plat].filter(Boolean).sort((x, y) => x.distance - y.distance)[0];
        hits.push({ kind, th, distance: h ? h.distance : null, surface: h ? (h === plat ? 'platform' : 'lining') : null });
      }
      g.dispose(); probeMesh.material.dispose();
      for (const t of tunnels) { t.geometry.dispose(); t.material.dispose(); }
      // Where the camera is along the window (nearest window point in plan).
      let arc = 0, bd = Infinity;
      for (const q of built.points) { const d = Math.hypot(q.x - camera.position.x, q.z - camera.position.z); if (d < bd) { bd = d; arc = q.s; } }
      return { hits, radius: built.radius, platformZone: cutAt(arc) };
    },
    dispose() {
      this.hide();
      scene?.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      // ── s30:P ──
      clearPlatforms(); scene?.remove(platformGroup); platformMaterial.dispose();
      for (const m of roundelMaterials.values()) m.dispose();
      roundelMaterials.clear();
      // ── /s30:P ──
    },
  };
}
