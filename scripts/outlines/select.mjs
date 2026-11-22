// O2 covers every corrected surface carriageway class. Projected crossings
// at a different vertical layer are not ground-level building intrusions.
export function surfaceCorridorKind(road) {
  if (road.tunnel || road.bridge || road.layer !== 0) return null;
  return road.cls <= 5 ? 'roads' : road.cls === 6 ? 'service' : 'other';
}
