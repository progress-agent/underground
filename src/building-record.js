// UGB2: original header/directory, 14-byte records. Y stays in real decimetres.
// Plan area uses half-square-metres below 16,384 m² (the integer-coordinate
// source outlines are exact there), logarithmic above; aspect ratio uses
// 1/2048 octave. This preserves small sheds without wasting dimension entropy.
export const BUILDING_RECORD_BYTES = 14;
export const encodeBuildingArea = a => a < 16384 ? Math.round(a*2) : 32768+Math.round((Math.log2(a)-14)*2048);
export const decodeBuildingArea = n => n < 32768 ? n/2 : 2 ** (14+(n-32768)/2048);
export const encodeBuildingAspect = ratio => Math.round(Math.log2(ratio)*2048)+32768;
// The bake's 1/128-octave ratios repeat city-wide. A 32 KiB CPU table
// avoids a transcendental operation per record; arbitrary test records retain
// the full format precision through the fallback.
const ASPECTS=Float64Array.from({length:4096},(_,i)=>2**((i*16-32768)/2048));
export const decodeBuildingAspect = n => (n&15)?2**((n-32768)/2048):ASPECTS[n>>>4];
export function readBuildingRecord(view, off, tile, version = 2) {
  const area=version===1 ? (view.getUint16(off+6,true)*.1)**2 : decodeBuildingArea(view.getUint16(off+6,true));
  const aspect=version===1 ? 1 : decodeBuildingAspect(view.getUint16(off+10,true));
  return { x: tile.minX + view.getUint16(off, true) * .1, z: tile.minZ + view.getUint16(off + 2, true) * .1,
    h: view.getUint16(off + 4, true) * .1, baseM: view.getInt16(off + 8, true) * .1,
    width:Math.sqrt(area*aspect),depth:Math.sqrt(area/aspect),
    theta: version === 1 ? 0 : view.getUint16(off + 12, true) / 65536 * Math.PI / 2 };
}
