// UGR4 keeps the original three-byte attribute. Pavement widths need at most
// 50 decimetres, leaving bit 6 in each side byte for the half-width's two
// fractional bits. Bit 7 remains rail-side / junction-marking suppression.
export function roadMetadata(half,left,right,side=0) {
  const h=Math.min(1023,Math.round(half*16));
  return [h>>2,Math.round(left*10)+(side>0?128:0)+(h&1?64:0),Math.round(right*10)+(h&2?64:0)];
}
export function roadDimensions(data) {
  return {half:(data[0]*4+(data[1]>>6&1)+2*(data[2]>>6&1))/16,left:(data[1]&63)/10,right:(data[2]&63)/10};
}
