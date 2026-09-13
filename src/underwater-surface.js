import * as THREE from 'three';

// One low-resolution surface-only draw, then UV displacement in the existing
// lens pass. No reflection camera, second city render or full-screen pass.
export function createUnderwaterSurface({ camera, lensPass, sceneTarget }) {
  const maskScene = new THREE.Scene();
  const maskTarget = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true });
  maskTarget.depthTexture = new THREE.DepthTexture(512, 512, THREE.UnsignedIntType);
  maskTarget.texture.minFilter = maskTarget.texture.magFilter = THREE.LinearFilter;
  const maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide,
    toneMapped: false, fog: false });
  let maskMesh = null, elapsed = 0;
  const uniforms = {
    uUnderwaterAmount: { value: 0 }, uUnderwaterTime: { value: 0 },
    uWaterSurfaceMask: { value: maskTarget.texture },
    uWaterSurfaceDepth: { value: maskTarget.depthTexture },
    uWaterSceneDepth: { value: sceneTarget.depthTexture },
    uWaterWarpAspect: { value: 1 },
  };
  Object.assign(lensPass.uniforms, uniforms);
  lensPass.material.fragmentShader = lensPass.material.fragmentShader.replace('varying vec2 vUv;', `
uniform float uUnderwaterAmount;
uniform float uUnderwaterTime;
uniform sampler2D uWaterSurfaceMask;
uniform sampler2D uWaterSurfaceDepth;
uniform sampler2D uWaterSceneDepth;
uniform float uWaterWarpAspect;
varying vec2 vUv;
float waterSurfaceVisible(vec2 uv) {
  float coverage=texture2D(uWaterSurfaceMask,uv).r;
  float surfaceDepth=texture2D(uWaterSurfaceDepth,uv).x;
  float sceneDepth=texture2D(uWaterSceneDepth,uv).x;
  return smoothstep(0.7,0.99,coverage)*step(surfaceDepth-0.000002,sceneDepth);
}
vec2 waterOffset(vec2 uv) {
  if (uUnderwaterAmount<0.001) return vec2(0.0);
  float visible=waterSurfaceVisible(uv);
  vec2 wave=vec2(sin(uv.y*52.0+uUnderwaterTime*0.8)+sin(uv.x*33.0-uUnderwaterTime*0.55)*0.45,
    cos(uv.x*45.0+uUnderwaterTime*0.7)+sin(uv.y*29.0+uUnderwaterTime*0.4)*0.4);
  vec2 offset=wave*vec2(0.003/uWaterWarpAspect,0.003)*uUnderwaterAmount*visible;
  // Do not pull a wall/bed pixel across the surface silhouette.
  return offset*waterSurfaceVisible(clamp(uv+offset,0.0,1.0));
}`).replace('// Sample each channel (clamp to avoid wrapping artefacts)', `
      vec2 waterWarp=waterOffset(uvG);
      uvR+=waterWarp; uvG+=waterWarp; uvB+=waterWarp;
      // Sample each channel (clamp to avoid wrapping artefacts)`);
  lensPass.material.needsUpdate = true;
  const size = new THREE.Vector2(), oldClear = new THREE.Color();
  return {
    setGeometry(geometry) {
      if (maskMesh) maskScene.remove(maskMesh);
      maskMesh = geometry ? new THREE.Mesh(geometry, maskMaterial) : null;
      if (maskMesh) { maskMesh.name = 'thamesSurfaceDistortionMask'; maskScene.add(maskMesh); }
    },
    update(renderer, dt, amount) {
      elapsed += dt;
      uniforms.uUnderwaterAmount.value = maskMesh ? amount : 0;
      uniforms.uUnderwaterTime.value = elapsed;
      if (!maskMesh || amount <= 0) return;
      renderer.getDrawingBufferSize(size);
      const scale = Math.min(0.5, 768 / Math.max(size.x, size.y));
      const width = Math.max(1, Math.round(size.x * scale)), height = Math.max(1, Math.round(size.y * scale));
      if (maskTarget.width !== width || maskTarget.height !== height) maskTarget.setSize(width, height);
      uniforms.uWaterWarpAspect.value = size.x / size.y;
      const oldTarget = renderer.getRenderTarget(), oldAlpha = renderer.getClearAlpha();
      renderer.getClearColor(oldClear);
      renderer.setRenderTarget(maskTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(maskScene, camera);
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(oldClear, oldAlpha);
    },
    get uniforms() { return uniforms; },
    get maskTarget() { return maskTarget; },
    dispose() { maskTarget.dispose(); maskMaterial.dispose(); },
  };
}
