// Re-pivot on rotate-engage must have ZERO visible camera motion.
//
// The old handler translated BOTH controls.target and camera.position by
// (hit.point - controls.target) on left-button 'start'. Because the tick loop
// habitually re-syncs controls.target to a fixed 1000 scene units ahead of the
// camera, that delta was nearly the full camera-to-ground distance — a single
// click at altitude teleported the camera ~25,000 scene units. The fix moves
// ONLY controls.target, placed on the CURRENT view ray at the clicked point's
// depth (clamped to [minDistance, maxDistance]), so update()'s lookAt(target)
// is a no-op: no translation, no rotation.
//
// Run notes (project rules):
// - BEFORE any run: `lsof -nP -iTCP:5173 -sTCP:LISTEN` and kill any non-underground
//   vite squatter (a drum-project server has silently eaten suites twice).
// - Serial only: `npx playwright test repivot-no-jump --workers=1`.
import { test, expect } from '@playwright/test';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Angle between two quaternions (arrays [x,y,z,w]): 2*acos(|dot|).
const quatAngle = (a, b) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
};

async function boot(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(() => window.__ug?.camera && window.__ug?.controls);
  await page.waitForFunction(() => window.__ug.buildingInstanceCount > 10000, null, { timeout: 90000 });
  // CRITICAL: the centre-screen #loadingBar label eats pointer events until it
  // gets .done (pointer-events: none) — proven during diagnosis. Without this
  // wait, clicks near screen centre never reach the canvas.
  await page.waitForFunction(() => document.getElementById('loadingBar')?.classList.contains('done'));
}

// Set an exact camera pose and re-sync controls.target to the habitual
// 1000-units-ahead position (the state the FPS hand-back / intro finalize
// leave behind — the precondition of the original bug).
async function pose(page, position, look) {
  await page.evaluate(([p, l]) => {
    const { camera, controls } = window.__ug;
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(l[0], l[1], l[2]);
    camera.updateMatrixWorld(true);
    const fwd = camera.up.clone(); // any Vector3 instance to write into
    camera.getWorldDirection(fwd);
    controls.target.copy(camera.position).addScaledVector(fwd, 1000);
    controls.update();
  }, [position, look]);
  await page.waitForTimeout(300); // settle damped update()s
}

const snap = (page) => page.evaluate(() => {
  const { camera, controls } = window.__ug;
  return {
    pos: camera.position.toArray(),
    quat: camera.quaternion.toArray(),
    target: controls.target.toArray(),
    azimuth: controls.getAzimuthalAngle(),
    polar: controls.getPolarAngle(),
    maxDistance: controls.maxDistance,
  };
});

async function assertCanvasAt(page, x, y) {
  const tag = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.tagName ?? 'NONE',
    [x, y],
  );
  // Fail loudly if an overlay (loading label, HUD, station chip) would eat the
  // click — a swallowed pointerdown makes every no-jump assertion pass vacuously.
  expect(tag).toBe('CANVAS');
}

test.describe('rotate-engage re-pivot has zero camera motion', () => {
  test('no camera jump on engage at altitude', async ({ page }) => {
    await boot(page);
    await pose(page, [0, 20000, 12000], [0, 0, -2000]);
    await assertCanvasAt(page, 640, 250);

    const before = await snap(page);
    await page.mouse.move(640, 250);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(200); // several damped controls.update() frames
    const after = await snap(page);
    await page.mouse.up();

    expect(dist(after.pos, before.pos)).toBeLessThan(1);
    expect(quatAngle(after.quat, before.quat)).toBeLessThan(0.005);
    // The re-pivot must actually ENGAGE (target adopts the clicked depth) —
    // guards against a "fix" that just deletes the handler.
    expect(dist(after.target, before.target)).toBeGreaterThan(5000);
  });

  test('no camera jump at street level', async ({ page }) => {
    await boot(page);
    await pose(page, [500, 120, 500], [500, 80, -1500]);
    await assertCanvasAt(page, 800, 500);

    const before = await snap(page);
    await page.mouse.move(800, 500);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const after = await snap(page);
    await page.mouse.up();

    // Target-move assertion deliberately omitted: at street level the raycast
    // may hit geometry near the existing target. Only no-jump is asserted.
    expect(dist(after.pos, before.pos)).toBeLessThan(1);
    expect(quatAngle(after.quat, before.quat)).toBeLessThan(0.005);
  });

  test('drag still orbits after engage', async ({ page }) => {
    await boot(page);
    await pose(page, [0, 20000, 12000], [0, 0, -2000]);
    await assertCanvasAt(page, 640, 250);

    const before = await snap(page);
    await page.mouse.move(640, 250);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(790, 310, { steps: 10 });
    await page.waitForTimeout(300); // let damping apply the rotation
    const after = await snap(page);
    await page.mouse.up();

    const angleMoved =
      Math.abs(after.azimuth - before.azimuth) + Math.abs(after.polar - before.polar);
    expect(angleMoved).toBeGreaterThan(0.02);
    expect(after.pos.every(Number.isFinite)).toBe(true);
  });

  test('clamp respected on extreme depth', async ({ page }) => {
    await boot(page);
    // On-axis terrain depth from this pose is ~53,000 units > maxDistance=40000.
    await pose(page, [0, 30000, 24000], [0, 0, -20000]);
    await assertCanvasAt(page, 640, 360);

    const before = await snap(page);
    await page.mouse.move(640, 360);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const after = await snap(page);
    await page.mouse.up();

    expect(dist(after.pos, before.pos)).toBeLessThan(1);
    const radius = dist(after.target, after.pos);
    expect(radius).toBeLessThanOrEqual(after.maxDistance + 1);
    // Engaged (not bailed): target actually moved out towards the clamp.
    expect(dist(after.target, before.target)).toBeGreaterThan(5000);
  });
});
