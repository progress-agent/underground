import { cleanRing, hull, minRect, signedArea } from './geom.mjs';
// All current source records have outlines. A degenerate outline is a data
// error, rather than a silent fallback to a square claiming to meet B1.
export function buildingShape(b) {
  const ring = cleanRing(b.footprint || []), area = Math.abs(signedArea(ring));
  const rect = minRect(hull(ring));
  if (!rect || !(area > 0) || !(rect.area > 0)) throw new Error(`invalid footprint at ${b.cx},${b.cz}`);
  const scale = Math.sqrt(area / rect.area);
  return { ...rect, w: rect.w * scale, h: rect.h * scale, area, ring };
}
