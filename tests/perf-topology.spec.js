// perf-topology.spec.js — locks the two 05Sep26s performance decisions in place.
//
// Both are cheap to undo by accident, and both fail silently when undone: the
// picture still renders, it just costs roughly a third more fill rate. Hence a
// spec rather than a comment.
//
//   1. A1 post-chain topology. EffectComposer builds renderTarget2 as
//      `renderTarget.clone()`, so a target created with samples:4 hands its
//      MSAA to the post ping-pong buffer, which has no use for it. main.js
//      replaces rt2 with a plain target AND flips the buffer roles, because
//      RenderPass has needsSwap:false and draws into readBuffer — so readBuffer
//      must be the 4x target or the scene loses all edge AA. The role flip is
//      the load-bearing half; asserting sample counts alone would pass on a
//      version that silently renders the scene un-antialiased.
//
//   2. D-021 tube glass. `transmission > 0` makes three.js run a second full
//      scene render into its own MSAA HalfFloat target with a mip chain. The
//      estate now uses transmission nowhere; infra-transparency.spec.js guards
//      the Tideway/Lee/crossrail side of that, this guards the tube lines.

import { test, expect } from '@playwright/test';

// The composer exists long before the network does, and lines stream in
// progressively, so a bare `__ug.scene` wait finds an empty scene and any
// count threshold trips partway through the load. Wait for the tube-wall count
// to STOP GROWING instead — a settled scene, not a lucky sample.
async function gotoLoaded(page) {
  await page.goto('/?fast=1');
  await page.waitForFunction(() => {
    const ug = window.__ug;
    if (!ug || !ug.scene || !ug.composer) return false;
    let walls = 0;
    ug.scene.traverse((o) => {
      if (o.isMesh && o.userData?.type === 'tube-line' && o.geometry?.type === 'TubeGeometry') walls++;
    });
    const prev = window.__wallCountPrev;
    window.__wallCountPrev = walls;
    return walls > 40 && walls === prev;
  }, null, { timeout: 120000, polling: 500 });
}

test('A1: scene renders into the 4x target, post chain into a plain one', async ({ page }) => {
  await gotoLoaded(page);
  const t = await page.evaluate(() => {
    const c = window.__ug.composer;
    return {
      rt1Samples: c.renderTarget1.samples,
      rt2Samples: c.renderTarget2.samples,
      // RenderPass draws into readBuffer — this is where the scene lands.
      sceneTargetIsMsaa: c.readBuffer === c.renderTarget1,
      writeIsPlain: c.writeBuffer === c.renderTarget2,
      sameSize: c.renderTarget1.width === c.renderTarget2.width
             && c.renderTarget1.height === c.renderTarget2.height,
    };
  });
  expect(t.rt1Samples, 'scene target must keep 4x MSAA (D-022: not a perf lever)').toBe(4);
  expect(t.rt2Samples, 'post ping-pong target must be single-sampled (A1)').toBe(0);
  expect(t.sceneTargetIsMsaa, 'readBuffer must be the MSAA target or edge AA is lost').toBe(true);
  expect(t.writeIsPlain, 'writeBuffer must be the plain target').toBe(true);
  expect(t.sameSize, 'both composer targets must stay the same size').toBe(true);
});

test('D-021: no tube line uses transmission', async ({ page }) => {
  await gotoLoaded(page);
  const report = await page.evaluate(() => {
    const out = [];
    window.__ug.scene.traverse((o) => {
      if (!o.isMesh || o.userData?.type !== 'tube-line') return;
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      out.push({
        line: o.userData.lineId || o.parent?.name || 'tube',
        // `tube-line` is a HOVER tag, not a material tag: the D-018 crown
        // ribbons carry it too so they are pickable from above, and they are
        // opaque merged BufferGeometry, not frosted TubeGeometry walls.
        kind: o.geometry?.type === 'TubeGeometry' ? 'wall' : 'ribbon',
        transmission: m.transmission ?? 0,
        opacity: m.opacity,
        transparent: m.transparent,
      });
    });
    return out;
  });

  const walls = report.filter(r => r.kind === 'wall');
  const ribbons = report.filter(r => r.kind === 'ribbon');
  expect(walls.length, 'expected frosted tube walls in the scene').toBeGreaterThan(20);
  expect(ribbons.length, 'expected crown ribbons in the scene').toBeGreaterThan(0);

  // The D-021 estate rule: transmission is used nowhere, walls and ribbons alike.
  for (const r of report) {
    expect(r.transmission, `${r.line} ${r.kind} must not use transmission (D-021)`).toBe(0);
  }

  // D-021.3: the shafts were compensated 0.27 -> 0.33 when their transmission
  // went; the tube walls deliberately were NOT, because the uncompensated A/B
  // is the one Jordan assessed. A silent bump here would be a new look.
  for (const r of walls) {
    expect(r.opacity, `${r.line} wall opacity must stay uncompensated at 0.42 (D-021.3)`).toBeCloseTo(0.42, 3);
  }

  // crown-ribbon.js:18 — transparent:false is load-bearing. A ribbon in the
  // transparent queue re-opens the glow-through-terrain class of bug.
  for (const r of ribbons) {
    expect(r.transparent, `${r.line} ribbon must stay opaque (crown-ribbon.js:18)`).toBe(false);
  }
});
