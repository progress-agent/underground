import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import UPNG from 'upng-js';
import { applyTerrainCorrection, sampleTerrainCorrection, validateTerrainCorrection,
  tryCreateTerrainMesh, getTerrainMeshSurfaceY, getTerrainSurfaceY, getTerrainBounds, TERRAIN_ORIGIN_BNG, validateSouthernTerrain } from '../src/terrain.js';
import { installNodeEnv, ROOT } from '../scripts/bake-node-env.mjs';
import { decodeElevationTiff } from '../scripts/prepare-stratford-dtm.mjs';
const southern=JSON.parse(await readFile(`${ROOT}/public/data/terrain/southern-dtm.json`,'utf8'));
const motorway=JSON.parse(await readFile(`${ROOT}/src/m25-motorway-data.json`,'utf8'));

const correction = JSON.parse(await readFile(`${ROOT}/public/data/terrain/stratford-dtm.json`, 'utf8'));
const meta = JSON.parse(await readFile(`${ROOT}/public/data/terrain/london_full_height.json`, 'utf8'));
const pngBytes = await readFile(`${ROOT}/public/data/terrain/london_full_height_u16.png`);
const png = UPNG.decode(pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength));
const raw = new Uint8Array(png.data);
const sourceFloats = Float32Array.from({ length: png.width * png.height }, (_, i) => ((raw[i * 2] << 8) | raw[i * 2 + 1]) / 65535);

test('verified Stratford bare earth replaces the roof sample without fabricated elevations', () => {
  expect(validateTerrainCorrection(correction)).toBe(correction);
  expect(correction.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  const row = 407, col = 965, e = 490000 + col / 1399 * 70000, n = 205000 - row / 999 * 50000;
  const dsm = sourceFloats[row * png.width + col] * meta.elev_max_m;
  const dtm = sampleTerrainCorrection(correction, e, n);
  expect(dsm).toBeCloseTo(43.43375, 3);
  expect(dtm.weight).toBe(1);
  expect(dtm.elevation).toBeGreaterThan(12); expect(dtm.elevation).toBeLessThan(16);
  const hm = { floats: sourceFloats.slice(), width: png.width, height: png.height };
  expect(applyTerrainCorrection(hm, meta, correction)).toBeGreaterThan(1000);
  expect(hm.floats[row * png.width + col] * meta.elev_max_m).toBeCloseTo(dtm.elevation, 4);
});

test('patch exterior is unchanged and its boundary joins continuously to the original datum', () => {
  const hm = { floats: sourceFloats.slice(), width: png.width, height: png.height };
  applyTerrainCorrection(hm, meta, correction);
  for (let row = 0; row < png.height; row++) for (let col = 0; col < png.width; col++) {
    const e = 490000 + col / 1399 * 70000, n = 205000 - row / 999 * 50000;
    if (e >= 537000 && e <= 539000 && n >= 183000 && n <= 185000) continue;
    if (hm.floats[row * png.width + col] !== sourceFloats[row * png.width + col]) throw new Error(`Changed unverified exterior pixel ${row},${col}`);
  }
  expect(sampleTerrainCorrection(correction, 536999, 184000)).toBeNull();
  expect(sampleTerrainCorrection(correction, 537000, 184000).weight).toBe(0);
  expect(sampleTerrainCorrection(correction, 537000.001, 184000).weight).toBeLessThan(1e-8);
  expect(sampleTerrainCorrection(correction, 537150, 184000).weight).toBe(1);
  expect(() => validateTerrainCorrection({ ...correction, units: 'intensity' })).toThrow();
  expect(() => validateTerrainCorrection({ ...correction, elevations: [-3.4028235e38] })).toThrow();
  expect(() => decodeElevationTiff(Buffer.from('<html>Not found</html>'))).toThrow();
});

test('physical queries and building-bake sampler intersect the actual corrected terrain triangles', async () => {
  installNodeEnv();
  const thamesData = JSON.parse(await readFile(`${ROOT}/public/data/thames.json`, 'utf8'));
  const terrain = await tryCreateTerrainMesh({ thamesData }); expect(terrain).toBeTruthy();
  expect(terrain.meta.terrainCorrection.correctedSamples).toBeGreaterThan(1000);
  terrain.mesh.updateMatrixWorld(true);
  const samples = [[8250, -4200], [8284.5, -4229.6], [8380, -4100], [8150, -4000], [-1000, -1000], [-4000, -5000]];
  for (const [x, z] of samples) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 5000, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(terrain.mesh)[0]; expect(hit).toBeTruthy();
    expect(getTerrainMeshSurfaceY({ x, z })).toBeCloseTo(hit.point.y, 5);
    expect(getTerrainSurfaceY({ x, z, heightSampler: terrain.heightSampler })).toBeCloseTo(hit.point.y, 5);
  }
  expect(getTerrainMeshSurfaceY({ x: 8284.5, z: -4229.6 }) / 5).toBeLessThan(17);
  const bounds=getTerrainBounds();expect(bounds.bounds_m).toEqual([490000,151093.75,560000,205000]);
  expect(bounds.columns).toBe(513);expect(bounds.rows).toBe(553);
  expect(bounds.originBNG[0]).toBeCloseTo(530028.7469586737,6);expect(bounds.originBNG[1]).toBeCloseTo(180380.09351556934,6);
  for(const road of motorway.roads)for(let i=0;i<road.points.length;i++){
    const [x,z]=road.points[i];for(const [dx,dz]of [[0,0],[40,0],[-40,0],[0,40],[0,-40]])expect(Number.isFinite(getTerrainMeshSurfaceY({x:x+dx,z:z+dz}))).toBe(true);
  }
  // Raycast the old boundary and southern road extent independently of queries.
  for(const n of [156000,155000.001,155000,154999.999,152432.2035]){
    const x=533000-TERRAIN_ORIGIN_BNG[0],z=TERRAIN_ORIGIN_BNG[1]-n;
    const ray=new THREE.Raycaster(new THREE.Vector3(x,5000,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(terrain.mesh)[0];expect(hit).toBeTruthy();expect(getTerrainMeshSurfaceY({x,z})).toBeCloseTo(hit.point.y,5);
  }
  const seamX=533000-TERRAIN_ORIGIN_BNG[0],seamZ=TERRAIN_ORIGIN_BNG[1]-155000;
  expect(Math.abs(getTerrainMeshSurfaceY({x:seamX,z:seamZ-.001})-getTerrainMeshSurfaceY({x:seamX,z:seamZ+.001}))).toBeLessThan(.02);
  expect(getTerrainMeshSurfaceY({x:seamX,z:bounds.maxZ+1})).toBeNull();expect(terrain.heightSampler(.5,1.01)).toBeNull();
  // Original northern source-grid node values survive, with real BNG alignment.
  const positions=terrain.mesh.geometry.attributes.position;
  for(const [row,col]of [[10,10],[120,200],[180,450],[400,300]]){
    const py=Math.round(row/512*(png.height-1)),px=Math.round(col/512*(png.width-1));
    expect(positions.getY(row*513+col)/5).toBeCloseTo(sourceFloats[py*png.width+px]*meta.elev_max_m,4);
  }
  terrain.mesh.geometry.dispose(); terrain.topMat.dispose(); terrain.undersideMat.dispose();
});

test('southern extension is complete physical DTM and samples pixel centres without nodata substitution',()=>{
 expect(validateSouthernTerrain(southern)).toBe(southern);expect(southern.sourceSha256).toBe('7235139f1d276cea7bf61a6ce7ecf957a3668ca71d368a4ab6b6088276f2b8ae');
 for(const [row,col] of [[0,0],[0,1399],[99,0],[99,1399],[50,800]]){const sample=sampleTerrainCorrection(southern,490000+(col+.5)*50,156000-(row+.5)*50);expect(sample.elevation).toBe(southern.elevations[row*1400+col]);}
 expect(()=>validateSouthernTerrain({...southern,elevations:[NaN]})).toThrow();expect(sampleTerrainCorrection(southern,533000,150999)).toBeNull();
});
