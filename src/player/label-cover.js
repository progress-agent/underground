// label-cover.js: hide HTML station names where the figure covers them (sprint 14Oct26w, lane P, D-053 item 3).
//
// Station names are a DOM layer over the canvas (AGENTS.md: they draw over everything, a visible player
// included), so a name sitting behind the figure would be drawn across its chest. Lane B gives stations.js a
// hook, `addSurfaceLabelOccluder(fn)`, where `fn(labelRect, camera)` returns true to hide a label; this module
// is the function the integrator registers there. Pure: no THREE, no DOM, so node tests pin it.
//
// The rectangle is in CSS pixels as the viewer sees it, not as the camera projects it: the lens pass
// displaces the picture (barrel distortion at 22 mm) while the HTML labels are placed by the plain projection,
// so the figure's projected points are first mapped to where the lens draws them (displayedNdc).

/** A label is hidden when its centre is inside the figure's rectangle or this share of its area is. */
export const COVER_OVERLAP = 0.25;

/**
 * Where the lens pass DRAWS the picture of a source NDC point: the inverse of lens.js distortNdc, found by
 * Newton's method on a finite-difference Jacobian (distortNdc maps a screen position to the source position
 * the pass samples; we need the screen position whose source is `src`). Identity for an identity lens.
 * @param {{x:number,y:number}} src  NDC as projected by the camera
 * @param {(x:number,y:number)=>{x:number,y:number}} distortNdc
 */
export function displayedNdc(src, distortNdc, iterations = 4) {
  let x = src.x, y = src.y;
  const h = 1e-4;
  for (let i = 0; i < iterations; i++) {
    const f = distortNdc(x, y);
    const rx = f.x - src.x, ry = f.y - src.y;
    if (Math.abs(rx) < 1e-9 && Math.abs(ry) < 1e-9) break;
    const fx = distortNdc(x + h, y), fy = distortNdc(x, y + h);
    const a = (fx.x - f.x) / h, c = (fx.y - f.y) / h;   // d(f)/dx
    const b = (fy.x - f.x) / h, d = (fy.y - f.y) / h;   // d(f)/dy
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) break;
    x -= (d * rx - b * ry) / det;
    y -= (-c * rx + a * ry) / det;
  }
  return { x, y };
}

/** Area of the intersection of two { x, y, w, h } rectangles. */
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * @param {{ getFigureScreenRect: () => ({x,y,w,h}|null) }} o
 * @returns {(labelRect: {x,y,w,h}, camera?: object) => boolean} true hides the label
 */
export function createFigureLabelCover({ getFigureScreenRect }) {
  return function figureLabelOccluder(labelRect) {
    const f = getFigureScreenRect?.();
    if (!f || !labelRect) return false;
    const cx = labelRect.x + labelRect.w / 2, cy = labelRect.y + labelRect.h / 2;
    if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) return true;
    const area = labelRect.w * labelRect.h;
    if (!(area > 0)) return false;
    return overlapArea(f, labelRect) / area >= COVER_OVERLAP;
  };
}
