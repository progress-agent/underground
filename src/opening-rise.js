// opening-rise.js (s21:V2): the city's rise for the opening study. One shared uniform set, patched into the building
// material and its shadow depth twin. A translation, never a scale (D-039); no per-instance colour (D-015).
// Default front 1e9: every building is fully risen and nothing changes outside the opening.
import * as THREE from 'three';

export const riseUniforms = {
  uRiseFront: { value: 1e9 },            // metres in plan from the origin
  uRiseBand: { value: 400 },             // metres in plan over which a building rises
  uRiseDepth: { value: 0 },              // canonical y units a fully sunk building sits below its place
  uRiseOrigin: { value: new THREE.Vector2(0, 0) },
};

const PARS = 'uniform float uRiseFront;\nuniform float uRiseBand;\nuniform float uRiseDepth;\nuniform vec2 uRiseOrigin;';
const BODY = `
#ifdef USE_INSTANCING
	{
		float riseD = distance( instanceMatrix[3].xz, uRiseOrigin );
		float riseS = smoothstep( 0.0, 1.0, ( uRiseFront - riseD ) / uRiseBand );
		transformed.y -= ( 1.0 - riseS ) * uRiseDepth / instanceMatrix[1][1];
	}
#endif`;

/** Chain the rise onto a shader that already carries the height-scale patch (uHeightScale line). */
export function applyRise(shader) {
  Object.assign(shader.uniforms, riseUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('uniform float uHeightScale;', `uniform float uHeightScale;\n${PARS}`)
    .replace('transformed.y *= uHeightScale;', `transformed.y *= uHeightScale;${BODY}`);
}
