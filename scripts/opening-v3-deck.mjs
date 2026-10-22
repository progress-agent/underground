// opening-v3-deck.mjs: generates the cloud deck for opening study variant 3 (sprint 21Oct26w).
// Deterministic: seeded value-noise fBm (seed 20261002), periodic so the tile repeats seamlessly.
// Usage: node scripts/opening-v3-deck.mjs [out.png]   then ffmpeg -> public/opening/deck.webp
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 2048, OCTAVES = 5, BASE_CELLS = 4, SEED = 20261002;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const lattices = [];
for (let o = 0; o < OCTAVES; o++) { const n = BASE_CELLS << o; const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); lattices.push({ n, g }); }
const fade = t => t * t * (3 - 2 * t);
function sample(o, u, v) { // u, v in [0,1) periodic
  const { n, g } = lattices[o];
  const x = u * n, y = v * n; const x0 = Math.floor(x), y0 = Math.floor(y); const fx = fade(x - x0), fy = fade(y - y0);
  const xa = ((x0 % n) + n) % n, xb = (xa + 1) % n, ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;
  const a = g[ya * n + xa], b = g[ya * n + xb], c = g[yb * n + xa], d = g[yb * n + xb];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm(u, v) { let s = 0, amp = 0.5, tot = 0; for (let o = 0; o < OCTAVES; o++) { s += amp * sample(o, u, v); tot += amp; amp *= 0.5; } return s / tot; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const TOP = hex(0xf4f6f8), BOT = hex(0xaeb9c4);
const field = new Float32Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) field[y * SIZE + x] = fbm(x / SIZE, y / SIZE);
// contrast stretch so alpha has real gaps (fBm clusters around 0.5)
let lo = 1, hi = 0; for (const v of field) { if (v < lo) lo = v; if (v > hi) hi = v; }
const OFF = 14; // sun offset in pixels, up and to the left
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const n = (field[y * SIZE + x] - lo) / (hi - lo);
    const sx = (x - OFF + SIZE) % SIZE, sy = (y - OFF + SIZE) % SIZE;
    const ns = (field[sy * SIZE + sx] - lo) / (hi - lo);
    const shade = Math.min(1, Math.max(0, 0.5 + (n - ns) * 9)); // lit where the cloud rises towards the sun
    const a = smooth(0.38, 0.62, n);
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    for (let k = 0; k < 3; k++) raw[i + k] = Math.round(BOT[k] + (TOP[k] - BOT[k]) * shade);
    raw[i + 3] = Math.round(a * 255);
  }
}
const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(process.argv[2] || 'deck.png', png);
