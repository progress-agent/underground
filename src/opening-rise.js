// opening-rise.js: the film's building rise (sprint 21Oct26w, lane V variant 4). One shared uniform set, chained onto the
// building material and its shadow-pass twin. At the default (front 1e9) every building is fully risen and nothing changes.
// The rise is a TRANSLATION of the unit box (base-pivoted, so it sinks by its own height): true proportions (D-039) hold.
export const riseUniforms = {
  uRiseFront: { value: 1e9 },
  uRiseBand: { value: 1500 },
  uRiseMinX: { value: 0 },
};

const SNIPPET = `
#ifdef USE_INSTANCING
	float riseD = instanceMatrix[3].x - uRiseMinX;
	float riseK = clamp( ( uRiseFront - riseD ) / uRiseBand, 0.0, 1.0 );
	transformed.y -= ( 1.0 - riseK ) * 1.05;
#endif`;

/** Chain the rise onto a material whose vertex shader already carries `transformed.y *= uHeightScale;`. */
export function chainRise(material, key) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (previous) previous.call(this, shader, renderer);
    shader.uniforms.uRiseFront = riseUniforms.uRiseFront;
    shader.uniforms.uRiseBand = riseUniforms.uRiseBand;
    shader.uniforms.uRiseMinX = riseUniforms.uRiseMinX;
    const anchor = 'transformed.y *= uHeightScale;';
    if (!shader.vertexShader.includes(anchor)) { console.warn('[rise] anchor not found'); return; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uRiseFront;\nuniform float uRiseBand;\nuniform float uRiseMinX;')
      .replace(anchor, anchor + SNIPPET);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
