// Shared procedural noise functions — used by geology.js and textures.js

export function hash2d(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2d(ix, iz);
  const b = hash2d(ix + 1, iz);
  const c = hash2d(ix, iz + 1);
  const d = hash2d(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbmNoise(x, z, octaves = 3) {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, z * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxAmp;
}
