// modes/index.js: conveyance modes, wired together (sprint 23Sep26w, D-037,
// lane A1). main.js calls installModes() once and calls system.update(dt)
// from updateFpsControls; everything else lives in this folder.
//
// FILES (who owns what)
//   registry.js       mode contract + registry (A1)
//   deity.js          Deity, the original navigation (A1)
//   deity-speed.js    Deity keyboard speed regime incl. the water rule (A1)
//   pedestrian.js     Pedestrian (A2; A1 ships a stub)
//   drone.js          Drone (A3; A1 ships a stub)
//   balloon.js        Balloon (A3; A1 ships a stub)
//   collision.js      building / ground / roof / water queries (A1)
//   physics-panel.js  live tunables with persistence (A1)
//   mode-sfx.js       non-spatial procedural SFX on the master bus (A1)
//   pointer-lock.js   pointer-lock and drag look input (A1)
//   hud.js            picker + key hint (A1)
//   ../wind.js        the one shared world wind (A1)
//
// THE ctx EVERY MODE RECEIVES (activate / update / deactivate / onLook)
//
//   THREE, camera, controls, canvas     the scene's own objects
//   keys                                live Set of held keys (lowercase KeyboardEvent.key), shared with Deity
//   fpsControls                         Deity's control state (read it; do not repurpose it)
//   VE                                  vertical exaggeration (5): canonical Y = real metres x VE
//   masterHeight                        vertical-scale controller (display only; see vertical-scale.js)
//   collision                           createCollisionService (collision.js), synced every frame a solid mode runs
//   physics                             createPhysicsPanel: call physics.register(id, label, defs) ONCE in the mode factory
//   sfx                                 createModeSfx (mode-sfx.js)
//   look                                createLookInput; the registry sets its mode from mode.look
//   wind                                { getWindAt, getSurfaceWind } from ../wind.js
//   sliders                             { getMaster(), setMaster(v), getStructure(), setStructure(v) }: moves
//                                       the real HUD sliders so every dependent (landmarks, bridges, prefs) follows
//   getTerrainY(x, z)                   canonical terrain Y or null (carved bed under the river)
//   getStructuralY(x, z)                stable pre-refinement structural surface Y or null
//   isSubmergedAt(x, y, z)              shared inside-water predicate
//   waterSurfaceAt(x, z)                water-top Y where there is water, else null
//   setHint(text | null)                temporary HUD hint line (null restores the mode's own)
//   time                                seconds of mode-driven time (sum of dt), deterministic per frame sequence
//
// A MINIMAL REAL MODE (the shape A2 / A3 fill in; see registry.js for the contract)
//
//   export function createDroneMode(ctx) {
//     const p = ctx.physics.register('drone', 'Drone', [
//       { key: 'speed', label: 'Top speed', unit: 'm/s', min: 5, max: 80, step: 1, default: 35 },
//       { key: 'fov',   label: 'FOV',       unit: '°',   min: 60, max: 130, step: 1, default: 110 },
//     ]);
//     let saved = null;
//     return {
//       id: 'drone', label: 'Drone', key: '3', hint: 'W thrust · mouse steer', look: 'lock', solid: true,
//       activate(ctx) { saved = { fov: ctx.camera.fov }; ctx.camera.fov = p.fov; ctx.camera.updateProjectionMatrix(); },
//       deactivate(ctx) { ctx.camera.fov = saved.fov; ctx.camera.updateProjectionMatrix(); ctx.sfx.silence(); },
//       onLook(dx, dy, ctx) { ... },
//       update(dt, ctx) {
//         // integrate, then ctx.collision.moveAndSlide(...) for the X/Z step
//         ctx.camera.position.set(...); ctx.camera.quaternion.set(...);
//         ctx.sfx.droneWhine(speed);
//         return true;   // owns the camera: Deity keys and OrbitControls stay off
//       },
//     };
//   }
//
// Hand-back is free: when a mode stops owning the camera, tick() re-enables
// OrbitControls and re-seats its target 1000 units ahead of wherever the mode
// left the camera. Membrane resistance (D-036) is a Deity behaviour and is not
// applied to owned modes. Anything a mode changes on shared objects (camera
// fov, sliders) it must restore in deactivate().
//
// HEIGHT CONTRACT: modes work in canonical VE5 space (X/Z metres, Y = metres x
// VE). Master scales the scene through the camera only; a mode that wants the
// world to look real-scale moves the sliders (ctx.sliders), never a layer.

import { createModeRegistry } from './registry.js';
import { createDeityMode } from './deity.js';
import { createPedestrianMode } from './pedestrian.js';
import { createDroneMode } from './drone.js';
import { createBalloonMode } from './balloon.js';
import { createCollisionService } from './collision.js';
import { createPhysicsPanel } from './physics-panel.js';
import { createModeSfx } from './mode-sfx.js';
import { createLookInput } from './pointer-lock.js';
import { createModeHud } from './hud.js';
import { getWindAt, getSurfaceWind } from '../wind.js';

function isFormInput(target) {
  return target?.matches?.('input, select, textarea') || target?.isContentEditable;
}

function sliderAccess(document, id) {
  const el = () => document?.getElementById?.(id);
  return {
    get: () => { const e = el(); return e ? Number(e.value) : null; },
    set: (v) => {
      const e = el();
      if (!e || !Number.isFinite(v)) return null;
      e.value = String(v);
      // The HUD's own listeners apply the value and all of its side effects.
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return Number(e.value);
    },
  };
}

/**
 * @param {object} o
 * @returns {{ registry, collision, physics, sfx, look, hud, ctx, update(dt): boolean,
 *   activate(id): boolean, readonly activeId: string }}
 */
export function installModes({
  THREE, camera, controls, canvas, fpsControls, VE, masterHeight,
  getTerrainY, getStructuralY = () => null, isSubmergedAt, waterSurfaceAt,
  getBuildingMeshes, getHeightScale, getMasterBus,
  document = globalThis.document,
}) {
  const physics = createPhysicsPanel({ document });
  const sfx = createModeSfx({ getMasterBus });
  const collision = createCollisionService({
    getBuildingMeshes, getHeightScale,
    getGroundY: (x, z) => getTerrainY(x, z),
    getWaterSurfaceY: (x, z) => waterSurfaceAt(x, z),
    isSubmerged: (x, y, z) => isSubmergedAt(x, y, z),
  });
  const master = sliderAccess(document, 'masterHeight');
  const structure = sliderAccess(document, 'buildingHeight');

  let hud = null;
  const ctx = {
    THREE, camera, controls, canvas, keys: fpsControls.keys, fpsControls, VE, masterHeight,
    collision, physics, sfx, look: null, wind: Object.freeze({ getWindAt, getSurfaceWind }),
    sliders: Object.freeze({
      getMaster: master.get, setMaster: master.set,
      getStructure: structure.get, setStructure: structure.set,
    }),
    getTerrainY, getStructuralY, isSubmergedAt, waterSurfaceAt,
    setHint: (text) => hud?.setHint(text),
    time: 0,
  };

  const look = createLookInput({ element: canvas, document, onLook: (dx, dy) => registry.look(dx, dy) });
  ctx.look = look;

  const registry = createModeRegistry({
    ctx,
    onLookMode: (m) => look.setMode(m),
    onSilence: () => sfx.silence(),
  });
  registry.register(createDeityMode({ fpsControls, physics }));
  for (const factory of [createPedestrianMode, createDroneMode, createBalloonMode]) {
    try { registry.register(factory(ctx)); } catch (err) { console.warn('[modes] failed to register a mode', err); }
  }
  registry.activate('deity');
  hud = createModeHud({ document, registry, physics, look });

  // Digits 1-4 switch mode (previously unbound). Modified digits (Cmd+1 tab
  // switching and so on) and typing into a form are left alone.
  globalThis.addEventListener?.('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isFormInput(e.target)) return;
    const id = registry.byKey(e.key);
    if (id) registry.activate(id);
  });

  function update(dt) {
    const mode = registry.active;
    if (mode?.solid && !mode.stub) collision.sync();
    return registry.update(dt);
  }

  return {
    registry, collision, physics, sfx, look, ctx,
    get hud() { return hud; },
    update,
    activate: (id) => registry.activate(id),
    get activeId() { return registry.activeId; },
  };
}
