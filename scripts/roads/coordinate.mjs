// Ten bits for the across-road coordinate and six for conservative paint.
// Reserve 0..3 so the shader can recognise legacy normalised coordinates and
// the default missing-attribute sentinel. Decode before interpolation.
export function packRoadCoordinate(across,paint=28) {
 const a=Math.round((Math.max(-1,Math.min(1,across))+1)*1019/2),p=Math.floor(paint);
 if(!Number.isFinite(a)||!Number.isFinite(p)||p< -32||p>31)throw Error('Road coordinate overflow');
 return (p+32)*1024+a+4;
}
export const unpackRoadCoordinate=value=>({across:((value-4)%1024)*2/1019-1,paint:Math.floor((value-4)/1024)-32});
