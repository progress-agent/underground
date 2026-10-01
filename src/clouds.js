// clouds.js: fair-weather cumulus (sprint 25Sep26f, Lane C, D-039; sprint
// 30Sep26w, Lane C, D-041; sprint 01Oct26h, Lane C, D-043).
//
// Jordan's cloud-scope answers (24Sep26h) and his D-041 rulings, as built here:
//   - a permanent fair-weather cumulus sky, now at 1.25 oktas (D-041: "reduce
//     the cloud cover by 50%" from 2.5), structured as presets
//     (clouds-presets.js) so other weathers can be added later;
//   - clouds move with the shared wind (wind.js) as one field (clouds-field.js);
//   - every cloud inside the map is always drawn (D-043): nothing appears or
//     vanishes with distance, quality or height;
//   - above the clouds the layer thins to about a third, as ONE smooth fade of
//     the whole layer with the camera's height (D-043), opacity only;
//   - cloud shadows move across the whole city (clouds-shadow.js);
//   - altitude follows Master like the landscape, while the cloud BODIES keep
//     true proportions like every structure (Lane S rule): a puff is a round
//     view-space sprite of its real size, placed at base x Master + its real
//     height within the cloud;
//   - the Dawn to Dusk slider changes only the light on the clouds: colours
//     come from the sun and sky each frame, positions never read the slider;
//   - clouds fade out towards the M25 edge;
//   - nothing is drawn underground or underwater (sun.js air weight).
//
// DRAWING (scope: sprite clusters, kept by D-041). Each cloud is 3 to 7 large,
// overlapping soft puff sprites; all puffs are one instanced draw. A small
// generated atlas holds four puff outlines with a gentle relief and a bulge.
// The fragment shader lights each CLOUD as one heap (D-041, against the
// "cotton wool" look): a fragment sits on its puff's surface, and its light
// comes from where that point is in the cloud's heap (an ellipsoid over the
// flat base): half the sunlight follows the heap's shape (wrapped on its
// normal, dimmed by the heap lying between it and the sun), half its height
// (brighter up the heap); then sky fill from above, a flat grey base where the
// heap faces down, the scene fog, and brightness held under the bloom threshold.
// Looking towards a low sun, the forward-scattered light is spread over the
// whole body rather than the edges (the dawn and dusk rings). Puffs are sorted
// back to front by cloud about once a second (distance order does not change
// as the camera turns), and within a cloud bottom-up or top-down depending on
// which side the camera is.
//
// EVERY CLOUD ALWAYS DRAWN (D-043, 01Oct26h). Jordan: "the clouds look great,
// but they are appearing and disappearing quite unnaturally". The field always
// covered the whole map; the pops came from managing it: each cloud dropped
// half its puffs, unfaded, as the camera climbed past its top; far clouds kept
// only their largest puffs from 5 km and faded out at 15 to 24 km (7 to 12 km
// on Automatic's thinned-clouds rung); clouds beyond 25.5 km left the instance
// buffer; and Automatic's edge smoothing dropped puffs too. All of that is
// gone. What decides whether a cloud shows is now only: the M25 edge fade (a
// fixed property of where the cloud is), the air weight (nothing underground
// or underwater), one fade of the whole layer with the camera's height, a
// dissolve of a puff the camera is about to enter, and a fade at 42 to 48.5 km
// so the camera's 50 km far plane never cuts a cloud. Each is a smooth
// function of the camera's position.
//
// COST. One draw call of every puff inside the map (about 875 clouds and
// 4,150 of the 9,279 puffs at 1.25 oktas; the count moves slowly as clouds
// drift in and out across the edge, at zero opacity). Per frame: a drift lookup (memoised
// integral), a few uniform writes and the shadow parameters; about once a
// second the clouds are re-sorted far to near and, where the order changed,
// their puffs re-packed. Puffs of clouds faded out at the edge or beyond the
// far fade collapse to nothing in the vertex shader.

import * as THREE from 'three';
import {
  CLOUD_FIELD, buildCloudLayout, cloudDrift, cloudPosition, sampleEdgeFade,
  shadowStrengthFor, updraftAt as fieldUpdraftAt, cloudSunFactor, shadowPlaneY, mulberry32, smoothstep,
} from './clouds-field.js';
import { resolveCloudPreset, DEFAULT_CLOUD_PRESET } from './clouds-presets.js';
import {
  cloudEdgeTexture, setCloudShadowLayout, updateCloudShadow, patchCloudShadowChunks,
} from './clouds-shadow.js';
import { resolveSunDirection } from './environment.js';

const VE = 5;
const DEG = Math.PI / 180;
const FLOATS = 16; // per puff: aPuff(4) aCloud(4) aMisc(4) aShape(4)
// Camera far plane (main.js, display metres): the terrain is clipped there too.
export const CAMERA_FAR_M = 50000;

export const CLOUD_CONFIG = {
  resortSeconds: 1,
  resortJumpM: 1500,        // a camera jump this large re-sorts at once
  // The one distance fade (D-043): 3D display metres from the camera to a
  // cloud's centre. It only keeps the far plane from cutting a cloud: it ends
  // 1.5 km short of the plane, more than any puff's centre reaches from its
  // cloud's centre (half a 2 km cloud and its height), so no puff is clipped.
  // Beyond about 32 km at street level, and 60 km aloft, the fog has already
  // taken a cloud to the horizon's colour.
  farFadeM: [42000, 48500],
  maxLum: 0.8,              // under the bloom threshold (0.88)
  renderOrder: 50,
  // The look (D-041), as the shader's uLook: relief (how much of the atlas's
  // surface texture bends the heap's normal), light depth (metres of heap, as
  // a fraction of the cloud's height, that dim the sun to 1/e), the multiple-
  // scattering floor (the share of sunlight left deep in the heap) and the
  // weight of the flat grey base.
  look: [0.3, 0.45, 0.3, 0.85],
  // "Thin to a third above them" (D-039, Jordan's cloud-scope answer 2), as
  // D-043 rules it: ONE fade of the whole layer by the camera's height against
  // the layer's mean top (display metres: mean base x Master plus mean height),
  // eased (a smoothstep) over a kilometre of climb, starting at the mean top.
  // Opacity only: no puff is removed, and every cloud keeps the same share. It
  // replaces D-039's per-cloud thinning, in which each cloud dropped half its
  // puffs, unfaded, as the camera passed its own top. `alpha` is the layer's
  // opacity at the end of the climb, calibrated by measurement (scripts/
  // measure-cloud-thinning.mjs) so that the layer's visible effect from above
  // is about a third of its effect unthinned. Seen from above, a cloud stacks
  // about five puffs deep, so the effect is far from linear in the opacity:
  // 0.25 left 0.65 of it, 0.1 left 0.41, 0.07 leaves 0.32 to 0.33 at the
  // overview, above-the-layer and straight-down poses (01Oct26h, Mac Studio).
  // In absolute terms the thinned layer then changes the picture as much as
  // 387dff0's did (mean luminance change 9.7, 9.5, 4.7 against 8.7, 8.9, 5.3):
  // the same look from above, with no puff removed. For the same reason the
  // opacity is eased geometrically (alpha ^ t, t the smoothstep of the climb),
  // not linearly: a linear blend would leave the layer looking whole for most
  // of the kilometre and then drop it in the last few hundred metres; the
  // geometric one takes the visible effect down about evenly.
  above: { fromM: 0, spanM: 1000, alpha: 0.07 },
};

// ── Puff atlas ──────────────────────────────────────────────────────────────

/**
 * Four puff shapes in a 2x2 RGBA atlas. Seeded value noise, so the atlas is
 * identical on every visit.
 *   A  density: a lumpy outline whose soft edge wanders with the relief;
 *   B  bulge: how far the puff's surface stands towards the viewer at this
 *      texel (a sphere's sqrt(1 - d^2)), which places the fragment on the heap;
 *   RG a gentle surface relief in the sprite's plane (-1..1, centred on 0.5).
 * Sprint 30Sep26w (D-041): the atlas no longer carries a hemisphere normal per
 * puff. That normal, with the relief at 2.6x, lit every puff as its own ball
 * (a dark core inside a bright ring): Jordan's "balls of cotton wool" from
 * below, and the rings at dawn and dusk. The shader now lights the cloud as
 * one heap and takes only a little texture from here.
 */
export const PUFF_RELIEF = 0.9;  // relief gradient gain (2.6 until D-041)
export function buildPuffAtlas(size = 128) {
  const N = size * 2;
  const data = new Uint8Array(N * N * 4);
  const rand = mulberry32(7702);
  const G = 16, lattice = new Float32Array(G * G * 4);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const noise = (v, x, y) => {
    const fx = ((x % G) + G) % G, fy = ((y % G) + G) % G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const L = (i, j) => lattice[(((j % G) * G) + (i % G)) * 4 + v];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
    const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (v, x, y) => 0.55 * noise(v, x, y) + 0.3 * noise(v, x * 2.1, y * 2.1) + 0.15 * noise(v, x * 4.3, y * 4.3);
  const h = new Float32Array(size * size);
  const ANG = 256, rim = new Float32Array(ANG);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * size, oy = Math.floor(v / 2) * size;
    // Lumpy outline: the radius wobbles with angle (tabulated once per shape).
    for (let a = 0; a < ANG; a++) {
      const ang = a / ANG * Math.PI * 2;
      rim[a] = 0.8 + 0.16 * (fbm(v, Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 + 3) - 0.5) * 2
        + 0.06 * (noise(v, Math.cos(ang) * 7 + 9, Math.sin(ang) * 7 + 9) - 0.5) * 2;
    }
    // Surface relief, sampled once per texel.
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const px = (i + 0.5) / size * 2 - 1, py = (j + 0.5) / size * 2 - 1;
        h[j * size + i] = fbm(v, px * 5, py * 5);
      }
    }
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const px = (i + 0.5) / size * 2 - 1, py = (j + 0.5) / size * 2 - 1;
        const a = Math.floor(((Math.atan2(py, px) / (Math.PI * 2)) + 1) % 1 * ANG) % ANG;
        const rr = rim[a];
        const d = Math.hypot(px, py) / rr;
        const hh = h[j * size + i];
        // The edge wanders with the relief, so an outline is ragged, not a circle.
        const alpha = (1 - smooth(0.55, 1.0, d + 0.22 * (hh - 0.5))) * (0.9 + 0.1 * hh);
        const gx = h[j * size + Math.min(size - 1, i + 1)] - h[j * size + Math.max(0, i - 1)];
        const gy = h[Math.min(size - 1, j + 1) * size + i] - h[Math.max(0, j - 1) * size + i];
        const rx = Math.max(-1, Math.min(1, -gx * size * 0.05 * PUFF_RELIEF));
        const ry = Math.max(-1, Math.min(1, -gy * size * 0.05 * PUFF_RELIEF));
        const bulge = Math.sqrt(Math.max(0, 1 - Math.min(1, d * d)));
        const k = ((oy + j) * N + ox + i) * 4;
        data[k] = Math.round((rx * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round((ry * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round(bulge * 255);
        data[k + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      }
    }
  }
  return { data, size: N };
}
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// ── What decides a cloud's opacity (pure; the shader computes the same) ───

/** The layer's mean top in display metres: mean base x Master plus mean height (true size). */
export function layerMeanTopM(layout, ratio, ve = VE) {
  return layout.meanBaseM * ratio * ve + 2 * layout.meanHalfHeightM;
}

/**
 * The whole layer's opacity for a camera at display height `cameraY` (metres):
 * 1 up to the layer's mean top, easing to `above.alpha` a kilometre higher (D-043).
 * Eased in the climb (smoothstep) and geometrically in the opacity (see `above`).
 */
export function layerOpacity(cameraY, meanTopM, above = CLOUD_CONFIG.above) {
  const t = smoothstep(meanTopM + above.fromM, meanTopM + above.fromM + above.spanM, cameraY);
  return Math.pow(above.alpha, t);
}

/** The far-plane fade for a cloud whose centre is `d` display metres away (3D). */
export function farFade(d, [a, b] = CLOUD_CONFIG.farFadeM) {
  return 1 - smoothstep(a, b, d);
}

/** A puff's dissolve as the camera nears it: `d` display metres from its centre, radius `r`. */
export function nearDissolve(d, r) {
  return smoothstep(r * 0.6, r * 2.2, d);
}

// ── Shaders ────────────────────────────────────────────────────────────────

// Heap geometry (D-041). Each cloud is lit as one body: an ellipsoid over its
// flat base, centred HEAP_CENTRE of the height up, reaching its half-width,
// half-depth and top (a little beyond, HEAP_PAD). Every fragment is placed on
// its puff's surface (the sprite plane plus the atlas bulge towards the
// viewer), and its light depends on where that point sits in the HEAP, not in
// the puff: the heap's normal there, and how much heap lies between it and the
// sun. Neighbouring puffs therefore get the same light where they meet, which
// is what stops them reading as separate balls.
export const HEAP = Object.freeze({ centre: 0.3, pad: 1.06 });

const VERTEX = /* glsl */`
attribute vec4 aPuff;   // dx, dy (above base), dz, radius: real metres
attribute vec4 aCloud;  // cloud centre x, z at t=0 (scene), base altitude, height: real metres
attribute vec4 aMisc;   // variant, rotation, 0, 0
attribute vec4 aShape;  // half-width, half-depth (real metres), heading (radians), 0
uniform vec4 uField;    // originX, originZ, size, VE
uniform vec4 uEdgeXf;   // originX, originZ, size, 0
uniform sampler2D uEdge;
uniform vec2 uDrift;
uniform float uRatio;   // Master / VE: display y = canonical y x ratio
uniform float uLayer;   // the whole layer's opacity for the camera's height (layerOpacity)
uniform vec2 uFar;      // display distance over which a cloud fades before the far plane
uniform float uOpacity; // air weight x enabled
uniform vec3 uSunDir;   // canonical, towards the sun
uniform vec2 uHeap;     // HEAP.centre, HEAP.pad
varying vec2 vUv;       // sprite coordinates, -1..1 across the puff
varying vec2 vTile;     // atlas tile of this puff's shape
varying float vAlpha;
varying float vRel;     // display metres above the cloud base (sprite plane)
varying float vHeight;
varying vec3 vQ;        // this corner in heap units (the heap is the unit sphere)
varying vec3 vBulge;    // the puff's radius towards the viewer, in heap units
varying vec3 vInvR;     // 1 / heap radii (per metre), heap frame
varying vec3 vL;        // towards the sun, heap frame, unit
varying vec3 vEx;       // the sprite's axes in the heap frame, for the relief
varying vec3 vEy;
varying float vTowards; // cosine between the view ray and the sun
#ifdef UG_PROBE
varying vec4 vProbe;    // the probe's readout (see probe() below)
#endif
#include <fog_pars_vertex>
// A view-space vector as a display-space world vector (metres; the body keeps
// true size, so this is also real metres within a cloud).
vec3 toDisplay( vec3 v ) {
  vec3 w = transpose( mat3( viewMatrix ) ) * v;
  w.y /= uRatio;
  return w;
}
void main() {
  vec2 c = uField.xy + mod( aCloud.xy + uDrift - uField.xy, uField.z );
  float edge = texture2D( uEdge, ( c - uEdgeXf.xy ) / uEdgeXf.z ).r;
  float master = uRatio * uField.w;
  // The far plane (D-043): 3D display distance to the cloud's centre, so all
  // of a cloud's puffs fade together.
  float dist = length( ( modelViewMatrix * vec4( c.x, ( aCloud.z * master + 0.5 * aCloud.w ) / uRatio, c.y, 1.0 ) ).xyz );
  float far = 1.0 - smoothstep( uFar.x, uFar.y, dist );
  // Canonical centre: base follows Master, the body keeps true size.
  vec3 centre = vec3( c.x + aPuff.x, ( aCloud.z * master + aPuff.y ) / uRatio, c.y + aPuff.z );
  vec4 mvC = modelViewMatrix * vec4( centre, 1.0 );
  float r = aPuff.w;
  // Dissolve a puff the camera is inside or about to enter.
  float near = smoothstep( r * 0.6, r * 2.2, length( mvC.xyz ) );
  bool shown = edge > 0.0 && far > 0.0;
#ifdef UG_PROBE
  // One point per puff, at pixel (instance % W, instance / W): red the cloud's
  // opacity from everything that is per cloud (layer, edge, far plane; not the
  // air weight, read from uOpacity), green the puff's own dissolve, blue 1.
  vProbe = vec4( shown ? uLayer * edge * far : 0.0, near, 1.0, 1.0 );
  gl_Position = vec4( ( vec2( float( gl_InstanceID % UG_PROBE_W ), float( gl_InstanceID / UG_PROBE_W ) ) + 0.5 )
    / vec2( float( UG_PROBE_W ), float( UG_PROBE_H ) ) * 2.0 - 1.0, 0.0, 1.0 );
  gl_PointSize = 1.0;
  return;
#endif
  if ( uOpacity <= 0.0 || !shown ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); // collapsed: no fragments
    return;
  }
  float cr = cos( aMisc.y ), sr = sin( aMisc.y );
  vec2 corner = position.xy;
  vec2 rc = vec2( corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr ) * r;
  vec4 mv = mvC + vec4( rc, 0.0, 0.0 );
  vec3 off = toDisplay( vec3( rc, 0.0 ) );
  // Display height of this corner above the cloud base.
  vRel = aPuff.y + off.y;
  vHeight = aCloud.w;
  // The heap: frame along the cloud's heading, centred over its base.
  float ch = cos( aShape.z ), sh = sin( aShape.z );
  mat3 toHeap = mat3( ch, 0.0, -sh,  0.0, 1.0, 0.0,  sh, 0.0, ch ); // columns: world x, y, z -> heap
  float yc = uHeap.x * aCloud.w;
  vInvR = 1.0 / ( vec3( aShape.x, aCloud.w - yc, aShape.y ) * uHeap.y );
  vec3 rel = toHeap * ( aPuff.xyz + off ) - vec3( 0.0, yc, 0.0 );
  vQ = rel * vInvR;
  vec3 toCam = toHeap * toDisplay( vec3( 0.0, 0.0, 1.0 ) );
  vBulge = toCam * r * vInvR;
  vec3 sunD = normalize( vec3( uSunDir.x, uSunDir.y * uRatio, uSunDir.z ) );
  vL = toHeap * sunD;
  vEx = toHeap * toDisplay( vec3( cr, sr, 0.0 ) );
  vEy = toHeap * toDisplay( vec3( -sr, cr, 0.0 ) );
  vTowards = dot( normalize( -mv.xyz ), -normalize( mat3( viewMatrix ) * uSunDir ) );
  vAlpha = uOpacity * uLayer * edge * far * near;
  float variant = aMisc.x;
  vUv = corner;
  vTile = vec2( mod( variant, 2.0 ), floor( variant / 2.0 ) ) * 0.5;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */`
uniform sampler2D uPuff;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBase;
uniform float uMaxLum;
uniform vec4 uLook;     // relief, light depth (x height), multiple-scatter floor, base weight
uniform float uHeapCentre;
varying vec2 vUv;
varying vec2 vTile;
varying float vAlpha;
varying float vRel;
varying float vHeight;
varying vec3 vQ;
varying vec3 vBulge;
varying vec3 vInvR;
varying vec3 vL;
varying vec3 vEx;
varying vec3 vEy;
varying float vTowards;
#include <fog_pars_fragment>
void main() {
  // The octagon reaches just past the unit circle; stay inside this tile.
  vec4 s = texture2D( uPuff, ( clamp( vUv, -0.995, 0.995 ) * 0.5 + 0.5 ) * 0.5 + vTile );
  // Flat base: fade out what hangs below the cloud base.
  float a = s.a * vAlpha * smoothstep( -30.0, 40.0, vRel );
  if ( a < 0.004 ) discard;
  // This fragment on its puff's surface, in heap units.
  // (Without the bulge, the flat sprites would cut straight-edged shapes into
  // the base where they cross; the bulge rounds each into the heap.)
  vec3 q = vQ + vBulge * s.b;
  vec3 nh = normalize( q * vInvR );                       // the heap's normal here
  vec3 n = normalize( nh + uLook.x * ( ( s.r * 2.0 - 1.0 ) * vEx + ( s.g * 2.0 - 1.0 ) * vEy ) );
  // Sunlight reaching this point through the heap: the path inside the heap
  // towards the sun (0 on the sunlit side, most of the cloud from underneath).
  vec3 ln = vL * vInvR;
  float A2 = dot( ln, ln ), B = dot( q, ln ), C = dot( q, q ) - 1.0;
  float disc = B * B - A2 * C;
  float path = 0.0;
  if ( disc > 0.0 ) {
    float sq = sqrt( disc );
    path = max( 0.0, ( -B + sq ) / A2 - max( 0.0, ( -B - sq ) / A2 ) );
  }
  float trans = exp( -path / ( uLook.y * max( vHeight, 1.0 ) ) );
  // Half the sunlight follows the heap's shape towards the sun; half its height
  // (brighter up the heap, darker towards the base), as the whole cloud.
  float wrap = clamp( ( dot( n, vL ) + 0.5 ) / 1.5, 0.0, 1.0 ) * mix( uLook.z, 1.0, trans );
  float hq = clamp( ( q.y / vInvR.y + uHeapCentre * vHeight ) / max( vHeight, 1.0 ), 0.0, 1.0 );
  float heap = mix( 0.22, 1.0, smoothstep( 0.0, 0.9, hq ) );
  // Looking towards the sun, the heap's far side faces the viewer and its
  // silhouette would catch the light and ring the cloud: towards the sun the
  // shape term gives way to the height term, and the forward-scattered glow
  // is spread over the whole body, so no edge is brighter than the cloud.
  float back = smoothstep( 0.3, 0.95, vTowards );
  float direct = mix( wrap, heap, 0.5 + 0.35 * back );
  float glow = pow( max( vTowards, 0.0 ), 6.0 ) * 0.25;
  vec3 fill = mix( uAmbBase, uAmbTop, clamp( 0.5 + 0.5 * n.y, 0.0, 1.0 ) );
  vec3 col = uSunCol * ( direct + glow ) + fill;
  // The flat base: where the heap faces down, one even grey per cloud.
  float under = smoothstep( 0.25, 0.7, -nh.y ) * uLook.w;
  col = mix( col, uAmbBase * 1.2 + uSunCol * ( 0.1 + glow ), under );
  // Hold the brightest tops under the bloom threshold, keeping their hue.
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( l > uMaxLum * 0.8 ) col *= ( uMaxLum * 0.8 + ( uMaxLum * 0.2 ) * ( 1.0 - exp( -( l - uMaxLum * 0.8 ) / ( uMaxLum * 0.2 ) ) ) ) / l;
  gl_FragColor = vec4( col, a );
  #include <fog_fragment>
}`;

// ── System ─────────────────────────────────────────────────────────────────

function readCloudsParam() {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('clouds');
    return v === null ? null : !(v === '0' || v === 'off' || v === 'false');
  } catch { return null; }
}

/**
 * Add the cloud layer. `sunSystem` is sun.js's system (air weight, sun state),
 * `skySystem` sky.js's (the sunlight and fill colours the sky itself uses).
 */
export function createCloudSystem({ scene, sunSystem = null, skySystem = null, preset = DEFAULT_CLOUD_PRESET, enabled = null } = {}) {
  const P = resolveCloudPreset(preset);
  const layout = buildCloudLayout(P);
  const shadowsOk = patchCloudShadowChunks();
  setCloudShadowLayout(layout, CLOUD_FIELD);
  let on = enabled ?? readCloudsParam() ?? true;
  let shadowsOn = true;
  let aboveFadeOn = true;

  // Static per-cloud puff data, packed once.
  const packed = layout.clouds.map(c => {
    const a = new Float32Array(c.puffs.length * FLOATS);
    c.puffs.forEach((p, i) => {
      a.set([p.dx, p.dy, p.dz, p.r, c.cx, c.cz, c.base, c.height, p.variant, p.rot, 0, 0,
        c.width / 2, c.depth / 2, c.heading, 0], i * FLOATS);
    });
    // The same puffs top-down, for a camera below the cloud.
    const rev = new Float32Array(a.length);
    for (let i = 0, n = c.puffs.length; i < n; i++) rev.set(a.subarray((n - 1 - i) * FLOATS, (n - i) * FLOATS), i * FLOATS);
    return { up: a, down: rev };
  });

  // An octagon around the round puff: 17% less fill than a square quad.
  const quad = new THREE.CircleGeometry(1 / Math.cos(Math.PI / 8), 8);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const buffer = new Float32Array(layout.puffCount * FLOATS);
  const inter = new THREE.InstancedInterleavedBuffer(buffer, FLOATS, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPuff', new THREE.InterleavedBufferAttribute(inter, 4, 0));
  geometry.setAttribute('aCloud', new THREE.InterleavedBufferAttribute(inter, 4, 4));
  geometry.setAttribute('aMisc', new THREE.InterleavedBufferAttribute(inter, 4, 8));
  geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(inter, 4, 12));
  geometry.instanceCount = 0;

  const atlas = buildPuffAtlas();
  const puffTex = new THREE.DataTexture(atlas.data, atlas.size, atlas.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  puffTex.magFilter = THREE.LinearFilter;
  puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  puffTex.generateMipmaps = true;
  puffTex.colorSpace = THREE.NoColorSpace;
  puffTex.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uField: { value: new THREE.Vector4(CLOUD_FIELD.originX, CLOUD_FIELD.originZ, CLOUD_FIELD.size, VE) },
    uEdgeXf: { value: new THREE.Vector4(CLOUD_FIELD.originX, CLOUD_FIELD.originZ, CLOUD_FIELD.size, 0) },
    uEdge: { value: null },
    uPuff: { value: null },
    uDrift: { value: new THREE.Vector2() },
    uRatio: { value: 1.1 / VE },
    uLayer: { value: 1 },
    uFar: { value: new THREE.Vector2(...CLOUD_CONFIG.farFadeM) },
    uOpacity: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmbTop: { value: new THREE.Color(0.3, 0.35, 0.42) },
    uAmbBase: { value: new THREE.Color(0.2, 0.22, 0.26) },
    uMaxLum: { value: CLOUD_CONFIG.maxLum },
    uHeap: { value: new THREE.Vector2(HEAP.centre, HEAP.pad) },
    uHeapCentre: { value: HEAP.centre },
    uLook: { value: new THREE.Vector4(...CLOUD_CONFIG.look) },
  }]);
  uniforms.uEdge.value = cloudEdgeTexture;
  uniforms.uPuff.value = puffTex;
  const material = new THREE.ShaderMaterial({
    name: 'clouds', uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true, fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = CLOUD_CONFIG.renderOrder;
  mesh.visible = false;
  mesh.userData.noShadow = true;
  if (scene) scene.add(mesh);

  const drift = { x: 0, z: 0 };
  const pos = { x: 0, z: 0 };
  const sunDir = new THREE.Vector3(0, 1, 0);
  const lastSortCam = new THREE.Vector3(Infinity, 0, 0);
  let lastSortTime = -Infinity, time = 0, timeOverride = null;
  // Sort scratch, allocated once. Every cloud inside the map is drawn (D-043),
  // so a re-sort orders all of them (about 875): kept cheap, since it runs at
  // least once a second (measured 01Oct26h; scripts/measure-cloud-sort.mjs):
  //   - which clouds are inside the map depends only on the wind's drift, so
  //     the list is kept until the field has drifted MEMBERS_DRIFT_M (a cloud
  //     drifting in across the edge then joins at an edge fade under 0.002);
  //   - the order is a native sort of packed numbers (distance squared, whole
  //     square metres, times IDX, plus the cloud's id), not a comparator sort;
  //   - only the stretch of the buffer whose order changed is re-packed and
  //     uploaded (outside it the same clouds sit at the same puff offsets).
  const nClouds = layout.clouds.length;
  const MEMBERS_DRIFT_M = 25;
  const IDX = 2 ** Math.ceil(Math.log2(nClouds + 1));
  const members = new Int32Array(nClouds);
  let nMembers = 0, membersChanged = true;
  const membersAt = { x: NaN, z: NaN };
  const sortKeys = new Float64Array(nClouds);
  const below = new Uint8Array(nClouds);
  let order = new Int32Array(0);       // cloud ids, far first
  let written = new Int32Array(0);     // id * 2 + below, as last written
  let offsetAt = new Int32Array(1);    // first puff of each position, as last written
  const status = {
    enabled: on, visible: false, opacity: 0, time: 0, drift, clouds: layout.clouds.length,
    visibleClouds: 0, instances: 0, sorts: 0, shadowStrength: 0, shadowsPatched: shadowsOk,
    preset: P.id, ratio: 1.1 / VE, layer: 1, meanTopM: 0, planeY: 0,
  };

  /** The clouds inside the map: every cloud whose M25 edge fade is above 0 (D-043). */
  function refreshMembers() {
    if (Math.hypot(drift.x - membersAt.x, drift.z - membersAt.z) < MEMBERS_DRIFT_M) return;
    membersAt.x = drift.x; membersAt.z = drift.z;
    let n = 0, changed = false;
    for (let i = 0; i < nClouds; i++) {
      cloudPosition(layout.clouds[i], drift, pos);
      // Only the edge fade, a property of where the cloud is, leaves one out,
      // and only where it is exactly 0, so a cloud drifting in across the edge
      // joins at zero opacity. Never the camera's distance.
      if (!(sampleEdgeFade(layout, pos.x, pos.z) > 0)) continue;
      if (n >= nMembers || members[n] !== i) changed = true;
      members[n++] = i;
    }
    if (n !== nMembers) changed = true;
    nMembers = n;
    membersChanged = membersChanged || changed;
  }

  function resort(camera, ratio) {
    const master = ratio * VE, cx = camera.position.x, cz = camera.position.z;
    const camDispY = camera.position.y * ratio;
    refreshMembers();
    const keys = sortKeys.subarray(0, nMembers);
    for (let k = 0; k < nMembers; k++) {
      const i = members[k], c = layout.clouds[i];
      cloudPosition(c, drift, pos);
      const dx = pos.x - cx, dz = pos.z - cz;
      const dy = c.base * master + c.height / 2 - camDispY; // display metres
      keys[k] = Math.floor(dx * dx + dz * dz + dy * dy) * IDX + i;
      below[i] = dy > 0 ? 1 : 0;
    }
    keys.sort(); // nearest first
    if (order.length !== nMembers) order = new Int32Array(nMembers);
    for (let k = 0; k < nMembers; k++) order[k] = keys[nMembers - 1 - k] % IDX; // far first
    lastSortCam.copy(camera.position);
    lastSortTime = time;
    status.sorts++;
    // The stretch [first, last] of positions whose cloud (or its up/down order) changed.
    let first = 0, last = nMembers - 1;
    if (!membersChanged && written.length === nMembers) {
      first = -1;
      for (let k = 0; k < nMembers; k++) {
        if (written[k] !== order[k] * 2 + below[order[k]]) { if (first < 0) first = k; last = k; }
      }
      if (first < 0) return;
    } else {
      if (written.length !== nMembers) written = new Int32Array(nMembers);
      if (offsetAt.length !== nMembers + 1) offsetAt = new Int32Array(nMembers + 1);
    }
    membersChanged = false;
    let n = offsetAt[first];
    for (let k = first; k <= last; k++) {
      const i = order[k];
      written[k] = i * 2 + below[i];
      offsetAt[k] = n;
      const src = below[i] ? packed[i].down : packed[i].up;
      buffer.set(src, n * FLOATS);
      n += src.length / FLOATS;
    }
    if (last === nMembers - 1) offsetAt[nMembers] = n;
    const total = offsetAt[nMembers];
    geometry.instanceCount = total;
    inter.clearUpdateRanges?.();
    inter.addUpdateRange(offsetAt[first] * FLOATS, (n - offsetAt[first]) * FLOATS);
    inter.needsUpdate = true;
    status.visibleClouds = nMembers;
    status.instances = total;
    status.rewrites = (status.rewrites || 0) + 1;
    status.rewrittenPuffs = n - offsetAt[first];
  }

  const _c = new THREE.Color();
  function light(state) {
    const sky = skySystem?.params;
    if (sky && sky.weight > 0) {
      uniforms.uSunCol.value.copy(sky.illum).multiplyScalar(0.85);
      _c.copy(sky.ambient);
      uniforms.uAmbTop.value.copy(_c).multiplyScalar(0.55).add(state ? _c.copy(state.hemiSky).multiplyScalar(0.06) : _c.setRGB(0, 0, 0));
      uniforms.uAmbBase.value.copy(sky.ambient).multiplyScalar(0.32);
    } else if (state) {
      uniforms.uSunCol.value.copy(state.sunColor).multiplyScalar(0.6 * state.sunFactor);
      uniforms.uAmbTop.value.copy(state.skyColor).multiplyScalar(0.5);
      uniforms.uAmbBase.value.copy(state.skyColor).multiplyScalar(0.3);
    }
  }

  /**
   * Per frame, after the sun, sky and environment updates. `time` is the
   * shared world clock (the mode registry's, which the wind consumers read).
   * Automatic's quality level is not read (D-043: no rung changes the clouds);
   * main.js still passes it, harmlessly.
   */
  function update({ camera, time: t = 0, airWeight = null } = {}) {
    time = timeOverride ?? (Number.isFinite(t) ? t : 0);
    status.time = time;
    cloudDrift(time, P, drift);
    const w = airWeight ?? sunSystem?.status?.airWeight ?? 0;
    const opacity = on ? Math.min(1, Math.max(0, w)) : 0;
    status.opacity = opacity;
    const ratio = camera?.userData?.masterHeightController?.ratio ?? 1;
    status.ratio = ratio;

    resolveSunDirection(sunDir);
    const elevationDeg = Math.asin(Math.min(1, Math.max(-1, sunDir.y))) / DEG;
    const strength = shadowsOk ? shadowStrengthFor(P, { airWeight: w, elevationDeg, enabled: on && shadowsOn }) : 0;
    status.shadowStrength = strength;
    const planeY = shadowPlaneY(layout, ratio, VE);
    status.planeY = planeY;
    if (camera) camera.updateMatrixWorld();
    updateCloudShadow({ drift, sunDir, strength, planeY, skyShare: P.shadowSkyShare ?? 0, camera });

    // The whole layer's fade above the clouds: a smooth function of the camera's
    // height, so it needs no easing in time and is right on the first frame.
    status.meanTopM = layerMeanTopM(layout, ratio);
    status.layer = uniforms.uLayer.value = camera && aboveFadeOn
      ? layerOpacity(camera.position.y * ratio, status.meanTopM) : 1;

    mesh.visible = opacity > 0;
    status.visible = mesh.visible;
    if (!mesh.visible || !camera) return;
    uniforms.uOpacity.value = opacity;
    uniforms.uDrift.value.set(drift.x, drift.z);
    uniforms.uRatio.value = ratio;
    uniforms.uSunDir.value.copy(sunDir);
    light(sunSystem?.state ?? null);
    if (time - lastSortTime >= CLOUD_CONFIG.resortSeconds || time < lastSortTime
      || camera.position.distanceToSquared(lastSortCam) > CLOUD_CONFIG.resortJumpM ** 2) {
      resort(camera, ratio);
    }
  }

  function setEnabled(v) { on = !!v; status.enabled = on; return on; }
  /** Cloud shadows on the city (on by default; off for comparisons). */
  function setShadowsEnabled(v) { shadowsOn = !!v; return shadowsOn; }
  /** Measurement only: switch the fade above the layer off and on. */
  function setThinning(v) { aboveFadeOn = !!v; }

  // ── Probe (tests and measurement; never drawn in the scene) ──
  // The same vertex program with UG_PROBE defined: each puff instance becomes
  // one point whose colour is what the shader decided for it (see VERTEX), read
  // back from a float target. So a test reads the opacity the GPU actually
  // gives every drawn puff, not a copy of the arithmetic.
  let probeKit = null;
  function probe(renderer, camera) {
    const W = 128, H = Math.ceil(layout.puffCount / W);
    if (!probeKit) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      for (const k of ['aPuff', 'aCloud', 'aMisc', 'aShape']) g.setAttribute(k, geometry.getAttribute(k));
      const m = new THREE.ShaderMaterial({
        name: 'clouds-probe', uniforms, vertexShader: VERTEX, defines: { UG_PROBE: '', UG_PROBE_W: W, UG_PROBE_H: H },
        fragmentShader: 'varying vec4 vProbe;\nvoid main() { gl_FragColor = vProbe; }',
        blending: THREE.NoBlending, depthTest: false, depthWrite: false, fog: false, transparent: false,
      });
      const points = new THREE.Points(g, m);
      points.frustumCulled = false;
      const s = new THREE.Scene();
      s.add(points);
      const target = new THREE.WebGLRenderTarget(W, H, {
        type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
      });
      probeKit = { g, scene: s, target, buf: new Float32Array(W * H * 4) };
    }
    const { g, scene: s, target, buf } = probeKit;
    const n = geometry.instanceCount;
    g.instanceCount = n;
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    renderer.render(s, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    const perCloud = new Float32Array(n), near = new Float32Array(n);
    let missing = 0;
    for (let i = 0; i < n; i++) {
      perCloud[i] = buf[4 * i]; near[i] = buf[4 * i + 1];
      if (buf[4 * i + 2] !== 1) missing++;
    }
    // The air weight as drawn: 0 while the mesh is hidden (update() leaves the
    // uniform alone then).
    return { count: n, perCloud, near, missing, opacity: mesh.visible ? uniforms.uOpacity.value : 0, layer: uniforms.uLayer.value };
  }

  const api = {
    mesh, material, layout, preset: P, status, config: CLOUD_CONFIG,
    update, setEnabled, setShadowsEnabled, setThinning, probe,
    get enabled() { return on; },
    /** Force a time (tests, captures); null returns to the world clock. */
    setTimeOverride(t) { timeOverride = Number.isFinite(t) ? t : null; lastSortTime = -Infinity; },
    /** Each cloud's (x, z) at time t: pure, as the field model computes it. */
    positionsAt(t) {
      const d = cloudDrift(t, P), p = { x: 0, z: 0 };
      return layout.clouds.map(c => { cloudPosition(c, d, p); return [p.x, p.z]; });
    },
    /** Direct-sun factor at a canonical point with the current shadow state (CPU mirror). */
    sunFactorAt(x, y, z) {
      return cloudSunFactor(layout, x, y, z, { drift, sunDir, strength: status.shadowStrength, planeY: status.planeY });
    },
    edgeFadeAt: (x, z) => sampleEdgeFade(layout, x, z),
    /** Balloon lift: thermal updraft (real m/s) at (x, z) and a real altitude above ground. */
    updraftAt(x, z, altM, t = time) {
      if (!on) return 0;
      return fieldUpdraftAt(layout, x, z, altM, cloudDrift(t, P));
    },
  };
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__ugClouds = api;
  return api;
}
