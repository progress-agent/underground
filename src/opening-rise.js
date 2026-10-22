// opening-rise.js (s21:V1): the city rises out of the ground. One shared uniform object is chained onto the shared
// building material (surface-geometry.js) and its shadow depth twin (sun.js). A translation of every instance down by the
// same absolute depth (never a scale: D-039), no per-instance colour (D-015). Default front 1e9: nothing changes after the opening.
export const riseUniforms = {
  uRiseFront: { value: 1e9 },
  uRiseBand: { value: 1 },
  uRiseDepth: { value: 0 },
};

export function patchRise(shader) {
  shader.uniforms.uRiseFront = riseUniforms.uRiseFront;
  shader.uniforms.uRiseBand = riseUniforms.uRiseBand;
  shader.uniforms.uRiseDepth = riseUniforms.uRiseDepth;
  const anchor = 'transformed.y *= uHeightScale;';
  if (!shader.vertexShader.includes(anchor)) { console.warn('[opening-rise] height-scale anchor not found; the rise is off'); return; }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uRiseFront;\nuniform float uRiseBand;\nuniform float uRiseDepth;')
    .replace(anchor, anchor
      + '\n#ifdef USE_INSTANCING\n\tfloat riseS = smoothstep( 0.0, 1.0, uRiseFront / uRiseBand );'
      + '\n\ttransformed.y -= ( 1.0 - riseS ) * uRiseDepth / max( instanceMatrix[1][1], 0.001 );\n#endif');
}
