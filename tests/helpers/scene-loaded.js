// scene-loaded.js — shared precondition for specs that pose the camera and
// then give the live tick a short budget to reach a regime.
//
// Sprint 24Sep26h (lane H). The app is interactive (window.__ug, readout,
// chalkClarity all present) well before its heavy load work has run. After
// that, the main thread blocks twice: the terrain build (tryCreateTerrainMesh,
// about 2.7s at 1x CPU) and, straight after, the M25 / geology / motorway
// callbacks, which build the chalk floor. While either block runs no frame
// ticks, so a pose set before them does not reach the regime the test asserts
// until they end. Under load (a long full run, other lanes on the machine,
// CPU throttling) the blocks stretch past the specs' 3s and 5s budgets.
//
// Evidence (lane H): readout:48 got CLAY 2934ms into its 3000ms budget at 1x
// and 11.6s late at 4x. A verifier probe on chalk-clarity:91 found the camera
// posed with getTerrainMeshSurfaceY({x:0,z:0}) === null and no chalkFloor in
// the scene at 1.0-1.5s after load (2 of 2 runs); chalk-clarity:91 then timed
// out on `chalkClarity > 0.95` in 2 of 3 lane runs at load average ~25.
//
// Once both the terrain and the chalk floor exist, both blocks are behind us.
// Fix round 1 (lane H) measured chalk-clarity's label test with the old and
// the new precondition side by side, under 16-20 CPU hogs (load average
// 16-35): old failed 2 of 16 (one at the `chalkClarity > 0.95` wait, one at
// the `chalkClarity === 0` wait), new failed 0 of 16. At 6x CPU throttling
// the new precondition still settles the pose in about 1.9s, inside the 5s
// budget; frames themselves slow under throttling, which no precondition
// removes. This changes only the precondition ("scene built, app ticking"),
// never an assertion or its budget.
export async function waitForSceneLoaded(page, timeout = 60000) {
  await page.waitForFunction(
    () => !!(window.__ug
      && typeof window.__ug.getTerrainMeshSurfaceY === 'function'
      && window.__ug.getTerrainMeshSurfaceY({ x: 0, z: 0 }) !== null
      && window.__ug.scene
      && window.__ug.scene.getObjectByName('chalkFloor')),
    null, { timeout }
  );
}
