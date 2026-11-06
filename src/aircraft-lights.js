import * as THREE from 'three';

// D-060: authored fittings on the existing illustrative aircraft, in real metres.
// Nose is -z, port is -x. Only the glow has a pixel floor, never the airframe.
export function aircraftLightLayout(length, { variant = null, glider = false } = {}) {
  const s = length / 60, prop = variant === 'turboprop', big = variant === 'superjumbo';
  const tip = glider ? 67 : prop ? 29.9 : big ? 32.9 : length <= 15 ? 31 : 28;
  const wy = glider ? 4.3 : prop ? 8.6 : big ? 4.05 : 4.55;
  const wz = glider ? 0 : prop ? -2 : big ? 12.3 : length <= 15 ? 0 : 10.5;
  const cy = glider ? 3.2 : prop ? 5.4 : big ? 5.9 : 6;
  const ry = glider ? 2.2 : prop ? 3.1 : big ? 3.47 : 3.4;
  const rx = glider ? 1.9 : prop ? 3.1 : big ? 2.95 : 3.2;
  // The high wing crosses the turboprop's crown at z=0. Fit the upper
  // beacon aft of it, on the ellipsoid, rather than burying it in the wing.
  const beaconZ = prop ? 8 : 0;
  const light = (kind, x, y, z, color, diameter, floor, gain = 1, side = 0) =>
    ({ kind, p: [x * s, y * s, z * s], color, diameter, floor, gain, side });
  const red = [1, .012, .003], green = [.005, 1, .08], white = [1, 1, 1];
  const out = [light('nav', -tip, wy, wz, red, .22, 3.5, 3),
    light('nav', tip, wy, wz, green, .22, 3.5, 3),
    light('nav', 0, cy, 30.12, white, .22, 3, 2.5),
    light('strobe', -tip, wy + .2, wz + .3, white, .3, 5, 7),
    light('strobe', tip, wy + .2, wz + .3, white, .3, 5, 7),
    light('beacon', 0, cy + ry * Math.sqrt(1 - (beaconZ / 30) ** 2) + .2, beaconZ, red, .25, 4, 5),
    light('beacon', 0, cy - ry - .2, 0, red, .25, 4, 5),
    light('landing', -rx, wy, -8, white, .45, 6, 10),
    light('landing', rx, wy, -8, white, .45, 6, 10)];
  // Window centres sit just outside the ellipsoid, so the hull occludes the
  // opposite row. The second deck belongs only to the A380-class recipe.
  for (const h of big ? [-.5, 1.5] : [.7]) {
    const step = Math.max(1.35, 1.3 / s);
    for (let z = -21; z <= 19; z += step) {
      const x = rx * Math.sqrt(Math.max(0, 1 - (z / 30) ** 2 - (h / ry) ** 2)) + .08;
      for (const side of [-1, 1]) out.push(light('window', side * x, cy + h, z, [1, .74, .42], .35, .6, 1.3, side));
    }
  }
  return out;
}

export function aircraftPhase(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
export function flashLevel(kind, seconds, phase) {
  const p = ((seconds * (kind === 'strobe' ? 1.2 : .9) + phase) % 1 + 1) % 1;
  return kind === 'strobe' ? +(p < .065) : +(p < .18);
}

// One point batch per fleet. Ordinary vertex colours, never instanceColor.
// Real lamp positions are transformed on the CPU with the airframe's matrix.
// A short bounded glow remains readable without bloom (including on phones).
export function createAircraftLightBatch(capacity, name) {
  const geometry = new THREE.BufferGeometry();
  const sizes = { position: 3, lampColor: 3, lamp: 4, timing: 2, direction: 3 };
  for (const [key, size] of Object.entries(sizes)) geometry.setAttribute(key,
    new THREE.BufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const uniforms = { amount: { value: 0 }, seconds: { value: 0 }, pixels: { value: 900 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      uniform float amount, seconds, pixels;
      attribute vec3 lampColor, direction;
      attribute vec4 lamp;
      attribute vec2 timing;
      varying vec3 tint;
      varying float intensity;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = max(lamp.y, lamp.x * pixels * projectionMatrix[1][1] / max(1.0, -mv.z));
        gl_PointSize = min(48.0, size);
        float pulse = 1.0;
        if (timing.x > 0.0) pulse = 1.0 - step(timing.y, fract(seconds * timing.x + lamp.w));
        vec3 dir = mat3(modelViewMatrix) * direction;
        float facing = length(direction) > 0.1 ? smoothstep(-0.15, 0.3, dot(normalize(dir), normalize(-mv.xyz))) : 1.0;
        intensity = amount * lamp.z * pulse * facing;
        tint = lampColor;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 tint;
      varying float intensity;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r >= 1.0 || intensity <= 0.0) discard;
        float glow = exp(-r * r * 7.0) * (1.0 - smoothstep(0.7, 1.0, r));
        gl_FragColor = vec4(tint * intensity, glow);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name; points.visible = false; points.frustumCulled = false;
  points.raycast = () => {}; // glow is not a new hover target
  let count = 0;
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  function add(light, matrix, phase, dim = false) {
    if (count >= capacity) throw new Error('Aircraft light batch capacity exceeded');
    p.fromArray(light.p).applyMatrix4(matrix);
    d.set(light.side || 0, 0, light.kind === 'landing' ? -1 : 0).transformDirection(matrix);
    if (!light.side && light.kind !== 'landing') d.set(0, 0, 0);
    const a = geometry.attributes, i = count++;
    a.position.setXYZ(i, p.x, p.y, p.z); a.lampColor.setXYZ(i, ...light.color);
    a.lamp.setXYZW(i, light.diameter, light.floor * (dim ? .65 : 1), light.gain * (dim ? .12 : 1), phase);
    a.timing.setXY(i, light.kind === 'strobe' ? 1.2 : light.kind === 'beacon' ? .9 : 0, light.kind === 'strobe' ? .065 : .18);
    a.direction.setXYZ(i, d.x, d.y, d.z);
  }
  function finish(amount, camera, seconds = performance.now() / 1000) {
    uniforms.amount.value = amount; uniforms.seconds.value = seconds;
    const height = typeof window === 'undefined' ? 900 : window.innerHeight;
    // onBeforeRender supplies the physical viewport, so DPR and Automatic's
    // resolution scale affect this glow just like the rest of the image.
    uniforms.pixels.value = height;
    points.visible = amount > 0 && count > 0; geometry.setDrawRange(0, count);
    for (const a of Object.values(geometry.attributes)) { a.clearUpdateRanges(); a.addUpdateRange(0, count * a.itemSize); a.needsUpdate = true; }
  }
  const viewport = new THREE.Vector4();
  points.onBeforeRender = renderer => { renderer.getCurrentViewport(viewport); uniforms.pixels.value = viewport.w; };
  return { points, add, reset() { count = 0; }, finish, get count() { return count; },
    setAmount(amount) { if (!amount && !uniforms.amount.value) return; uniforms.amount.value = amount; points.visible = amount > 0 && count > 0; uniforms.seconds.value = performance.now() / 1000; },
    prepare(renderer, camera, scene, renderTarget) {
      const proxy = new THREE.Points(geometry, material), group = new THREE.Group(); group.add(proxy);
      const old = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(renderTarget);
        return renderer.compileAsync(group, camera, scene).finally(() => group.clear());
      } finally { renderer.setRenderTarget(old); }
    },
    dispose() { geometry.dispose(); material.dispose(); points.removeFromParent(); } };
}
