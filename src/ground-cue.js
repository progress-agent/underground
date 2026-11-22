// D-061: real-metre colour detail on R's existing road ribbons. Dimensions and
// informed estimates are documented in docs/ground-cue.md. No textures or geometry.
export const GROUND_CUE_DEFAULT = 0.5;

export function groundCueStrength(value) {
  if (value === null || value === undefined || value === '') return GROUND_CUE_DEFAULT;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : GROUND_CUE_DEFAULT;
}

// Height is displayed metres above the local surface, after Master's landscape
// scale. Fade early enough to leave the fixed Bank aerial pose untouched too.
export function groundCueWeight(strength, height, hidden = false) {
  if (hidden || !Number.isFinite(height) || height < 0 || height >= 40) return 0;
  const t = Math.max(0, Math.min(1, (height - 12) / 28));
  return strength * (1 - t * t * (3 - 2 * t));
}

const COMMON = /* glsl */`
uniform float uGroundCue;
varying vec2 vGroundLocal;
// Filter a finite strip to a pixel wide, preserving its energy. At grazing
// angles it fades before it becomes a long crawling line.
float gcStrip(float p, float width, float footprint) {
  float fw = max(footprint, .00001);
  float drawn = max(width, fw);
  return (1.0 - smoothstep(drawn * .5 - fw * .5, drawn * .5 + fw * .5, abs(p)))
    * width / drawn * (1.0 - smoothstep(.08, .3, fw));
}
// Periodic line minus its analytic mean. As the cell approaches two pixels,
// resolve exactly to zero detail, rather than a dark distant grid.
float gcJoint(float p, float pitch, float width) {
  float fw = max(fwidth(p), .00001);
  float drawn = max(width, fw);
  float d = abs(fract(p / pitch + .5) - .5) * pitch;
  float line = (1.0 - smoothstep(drawn * .5 - fw * .5, drawn * .5 + fw * .5, d)) * width / drawn;
  return (line - width / pitch) * (1.0 - smoothstep(.15, .35, fw / pitch));
}
`;

const COLOUR = /* glsl */`
if (uGroundCue > 0.0) {
  // Reconstruct the road tangent from R's interpolated signed across-road
  // metres and world X/Z. No new per-vertex attribute, mesh or buffer. The
  // Jacobian removes view perspective; the result lives in horizontal metres.
  vec2 gcDx = dFdx(vGroundLocal), gcDy = dFdy(vGroundLocal);
  float gcAx = dFdx(vRoad.x), gcAy = dFdy(vRoad.x);
  float gcDet = gcDx.x * gcDy.y - gcDx.y * gcDy.x;
  vec2 gcN = vec2(gcDy.y * gcAx - gcDx.y * gcAy, gcDx.x * gcAy - gcDy.x * gcAx);
  gcN *= sign(gcDet);
  // This vector scales with pixel area. Only guard true zero; a larger floor
  // changes its length at fine Retina footprints and stretches the slab pitch.
  gcN /= max(length(gcN), 1e-20);
  // Bound the phase projection in fixed WORLD panels of ten flag pitches.
  // Projecting kilometre-scale coordinates amplifies tiny derivative errors;
  // rounding the direction merely turns that into sudden phase jumps. A
  // bounded, world-anchored phase stays stable when the derivative origin
  // moves. Joints resolve to their mean at panel seams through gcJoint's AA.
  vec2 gcPanel = mod(vRoadWorld + 3.0, 6.0) - 3.0;
  float gcAlong = dot(gcPanel, vec2(-gcN.y, gcN.x));
  float gcSide = step(0.0, vRoad.x);
  float gcWidth = mix(vRoad.z, vRoad.w, gcSide);
  float gcIn = mix(-vRoad.y + vRoad.z - vRoad.x, vRoad.x - vRoad.y + vRoad.w, gcSide);
  float gcFw = max(fwidth(vRoad.x), .00001);
  float gcPave = smoothstep(-gcFw * .5, gcFw * .5, gcIn) * step(.01, gcWidth);
  float gcKerb = gcStrip(gcIn - .0625, .125, gcFw) * step(.01, gcWidth);
  float gcShadow = gcStrip(gcIn + .0225, .045, gcFw) * step(.01, gcWidth);
  float gcJoints = gcJoint(gcIn - .125, .6, .005) + gcJoint(gcAlong, .6, .005);
  // 40mm material mottle: smoothly interpolated noise, faded before a cell
  // reaches four pixels. 40mm describes a cluster, not an aggregate diameter.
  float gcGrainFw = max(length(gcDx), length(gcDy)) / .04;
  float gcGrain = (roadNoise(vRoadWorld / .04) - .5)
    * (1.0 - smoothstep(.12, .25, gcGrainFw));
  // A modest near-field pavement tone carries the slab joints; it too melts
  // into R's exact asphalt when its across-road band is no longer resolved.
  float gcBandFade = 1.0 - smoothstep(.08, .3, max(length(gcDx), length(gcDy)));
  float gcValue = .24 * gcPave * gcBandFade + .42 * gcKerb - .45 * gcShadow
    - 1.0 * gcJoints * gcPave + .18 * gcGrain;
  // At night retain the cue only in the existing amber pools, rather than
  // making the moonlit asphalt between them into a competing pattern. This
  // remains albedo; R's incident-light term below lights the whole result.
  float gcLamp = 1.0;
  if (uNightAmt > .001) {
    vec2 gcWp = vec2(vRoadWorld.x + 32471.0, 26096.0 - vRoadWorld.y);
    gcLamp = mix(1.0, smoothstep(.45, .85, roadNoise(gcWp / 34.0)), uNightAmt);
  }
  diffuseColor.rgb *= max(.15, 1.0 + uGroundCue * gcLamp * gcValue);
}
`;

export function installGroundCue(material, uniform, origin) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.uGroundCue = uniform;
    shader.uniforms.uGroundOrigin = origin;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform vec2 uGroundOrigin;
varying vec2 vGroundLocal;`)
      .replace('vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xz;', `vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xz;
vGroundLocal = vRoadWorld - uGroundOrigin;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('// Ground cue colour hook.', COLOUR);
  };
  material.customProgramCacheKey = function() { return key.call(this) + '|ground-cue-v1'; };
}
