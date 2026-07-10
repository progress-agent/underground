// Shared angle-stable material factory for underground infrastructure
// (Crossrail, Tideway, Lee Tunnel, Bazalgette sewers, Tideway/Lee shafts)
// plus the "infra haze" distance treatment that replaced Crossrail's
// view-distance ALPHA fade (10Jul26f transparency-consistency pass).
//
// WHY (diagnosed 10Jul26f, Working/polish-10Jul26f/diag-transparency/):
// the old per-module materials were transparent MeshPhysicalMaterial with
// side:DoubleSide and depthWrite:true. Per pixel, whether 1 or 2 wall layers
// composite depends on triangle rasterisation order vs camera angle — axial
// views stack many curved wall sections to near-1.0 effective alpha while a
// broadside view shows 1-2 layers of 0.4-0.55. Same feature, same distance:
// opaque from one angle, ghost from another.
//
// The fix: FrontSide + depthWrite:true guarantees exactly ONE wall layer
// composites at every angle, including axial. A fixed opacity + emissive lift
// (the documented CLAUDE.md pattern for transparent-at-depth readability)
// gives a contrast floor against both the dark terrain underside and the
// bright chalk floor. No transmission anywhere in this factory — transmission
// is fresnel view-angle dependent (angle-INconsistent by construction) and
// its pass samples only the opaque scene.
//
// BEHAVIOUR CHANGE (flagged): FrontSide means tunnel walls are invisible from
// INSIDE during fly-through. Tube lines (frostedTubeMaterial) already behave
// this way; crossrail/tideway/sewers now match.
import * as THREE from 'three';

// ── Angle-stable tunnel material ────────────────────────────────────────────
// One wall layer at every angle: FrontSide + depthWrite:true. Emissive = base
// colour so the feature reads at depth without depending on scene lighting.
// Keep fog:true — scene fog (and the haze below) is the distance treatment.
export function createTunnelMaterial({
  color,
  opacity,
  emissive = color,
  emissiveIntensity = 0.22,
  roughness = 0.4,
  metalness = 0.2,
} = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    side: THREE.FrontSide,
    depthWrite: true,
    fog: true,
  });
}

// ── Glow shell material ─────────────────────────────────────────────────────
// depthWrite:false is load-bearing: a glow shell ENCLOSES the tunnel it
// decorates; if it wrote depth it would depth-cull the tunnel behind it
// (same-tier renderOrder, distance sort puts the shell nearer).
export function createGlowMaterial({ color, opacity = 0.15 } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.FrontSide,
    depthWrite: false,
    fog: true,
  });
}

// ── Infra haze (yellow-band replacement, D4.3 successor) ────────────────────
// The old Crossrail view-distance ALPHA fade killed the saturated yellow band
// on the clay horizon but made the whole line invisible past ~3200m from any
// angle. The haze keeps the band dead a different way: mix gl_FragColor.RGB
// toward the scene fog colour over a Euclidean view-distance band — ALPHA IS
// NEVER TOUCHED, so the feature converges to the fog/background colour
// (no saturated band can survive) but its footprint never disappears.
//
// Strength is a single module-level uniform driven by updateEnvironment
// (environment.js): undergroundness * insideness * (1-chalkBlend) *
// (1-chalkClarity). It is therefore ZERO inside the chalk — the atmosphere
// pass's "perfect clarity at any distance" holds with no extra wiring — and
// trivially forceable to 0 by any future look-up mode via the same owner.
//
// Euclidean distance, NOT view-space -z: an E-W tube at constant north
// distance has near-constant -z across the whole width, so a -z fade treats
// the full band uniformly (the band survives). Euclidean distance makes the
// far left/right of the band recede, collapsing it.
//
// Material.clone() does NOT copy onBeforeCompile — call injectInfraHaze again
// on every clone. This module registers every injected shader's uniforms so
// the strength update reaches all of them.
const _hazeUniformSets = [];
let _hazeStrength = 0;

export function setInfraHazeStrength(strength) {
  const s = Math.max(0, Math.min(1, strength));
  if (s === _hazeStrength) return;
  _hazeStrength = s;
  for (const uniforms of _hazeUniformSets) {
    uniforms.uHazeStrength.value = s;
  }
}

export function getInfraHazeStrength() {
  return _hazeStrength;
}

export function injectInfraHaze(material, { near = 1500, far = 6000 } = {}) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prior) prior(shader, renderer);
    // Guard: the mix reads the fogColor uniform, which only exists under
    // USE_FOG (material.fog && scene.fog). A material without the chunk gets
    // a silent no-op INJECTION — loudly skip instead so it can't rot quietly.
    if (!shader.fragmentShader.includes('#include <fog_fragment>')) {
      console.warn('injectInfraHaze: no <fog_fragment> chunk — haze skipped', material);
      return;
    }
    shader.uniforms.uHazeNear = { value: near };
    shader.uniforms.uHazeFar = { value: far };
    shader.uniforms.uHazeStrength = { value: _hazeStrength };
    _hazeUniformSets.push(shader.uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `varying float vInfraHazeDist;
void main() {`
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vInfraHazeDist = length( ( modelViewMatrix * vec4( transformed, 1.0 ) ).xyz );`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `uniform float uHazeNear;
uniform float uHazeFar;
uniform float uHazeStrength;
varying float vInfraHazeDist;
void main() {`
    ).replace(
      // After the stock fog mix (r161 chunk name). RGB only — alpha untouched.
      '#include <fog_fragment>',
      `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor,
    smoothstep( uHazeNear, uHazeFar, vInfraHazeDist ) * uHazeStrength );
#endif`
    );
  };
  material.needsUpdate = true;
  return material;
}
