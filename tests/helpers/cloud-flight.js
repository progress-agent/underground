// cloud-flight.js: fly the camera through the cloud layer one fixed frame at a
// time and read back, every frame, what the GPU gives every drawn puff (sprint
// 01Oct26h, Lane C, D-043). Used by tests/clouds-no-pop.spec.js.
//
// The app keeps rendering on its own clock; the camera is moved just before
// each of its frames (the requestAnimationFrame hook installed by
// installTickHooks), by one step of DT seconds at Deity speed: the same speed
// regime as the keyboard (src/modes/deity-speed.js, main.js updateFpsControls),
// so the path does not depend on how fast this machine renders. Just after the
// frame, the cloud system's probe (clouds.js) reads back each drawn puff's
// opacity as the vertex shader computed it: red, everything that is per cloud
// (the fade above the layer, the M25 edge, the far plane), green the puff's own
// dissolve as the camera nears it. The air weight (no clouds underground or
// underwater) is the uniform uOpacity, read alongside.

/** Install before page.goto: lets a test run code just before and after each app frame. */
export async function installTickHooks(page) {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(ts => {
      if (cb.name === 'tick') window.__preTick?.();
      cb(ts);
      if (cb.name === 'tick') window.__postTick?.();
    });
  });
}

/**
 * In the page: fly one leg and return what changed from frame to frame.
 * leg: { name, kind: 'climb' | 'level' | 'drift', DT,
 *   climb: from the opening's landing pose straight up (E) to `toAltM` on the altimeter;
 *   level: from `start` [x, z] along `dir` [dx, dz] for `distM`, either at a fixed
 *          canonical height `altM` real metres above the start's ground, or following
 *          the ground at `aboveGroundM`; `sprint` holds Shift;
 *   drift: a still camera at `start` [x, y, z] looking at `look`, the world clock
 *          advancing `worldStepS` a frame for `frames` frames }
 */
export async function flyLeg(leg) {
  const u = window.__ug, c = window.__ugClouds, renderer = u.composer.renderer;
  const { deityRegimeSpeed } = await import('/src/modes/deity-speed.js');
  const VE = u.VERTICAL_EXAGGERATION, ratio = u.masterHeight.ratio;
  const V = u.camera.position.constructor;
  const surf = (x, z) => u.getTerrainMeshSurfaceY({ x, z });
  const speedAt = (p) => deityRegimeSpeed({ moveSpeed: u.fpsControls.moveSpeed, y: p.y, surfaceY: surf(p.x, p.z),
    submerged: false, waterSurfaceY: null, VE }) * (leg.sprint ? u.fpsControls.sprintMultiplier : 1);

  // The path, as a function of the step index.
  const pos = new V(), look = new V();
  let done;
  if (leg.kind === 'climb') {
    const ip = u.intro.getParams();
    pos.set(ip.endX, ip.endY, ip.endZ);
    look.set(ip.lookX - ip.endX, ip.lookY - ip.endY, ip.lookZ - ip.endZ);
    done = () => (pos.y - surf(pos.x, pos.z)) / VE >= leg.toAltM;
  } else if (leg.kind === 'level') {
    const [x0, z0] = leg.start, l = Math.hypot(...leg.dir), dx = leg.dir[0] / l, dz = leg.dir[1] / l;
    const y0 = leg.altM !== undefined ? surf(x0, z0) + leg.altM * VE : surf(x0, z0) + leg.aboveGroundM * VE;
    pos.set(x0, y0, z0);
    look.set(dx * 1000, 0, dz * 1000);
    leg._dir = [dx, dz]; leg._from = [x0, z0];
    done = () => Math.hypot(pos.x - x0, pos.z - z0) >= leg.distM;
  } else {
    pos.set(...leg.start); look.set(leg.look[0] - leg.start[0], leg.look[1] - leg.start[1], leg.look[2] - leg.start[2]);
    done = () => stats.frames >= leg.frames;
  }
  const advance = () => {
    if (leg.kind === 'climb') pos.y += speedAt(pos) * leg.DT;
    else if (leg.kind === 'level') {
      const s = speedAt(pos) * leg.DT;
      pos.x += leg._dir[0] * s; pos.z += leg._dir[1] * s;
      if (leg.aboveGroundM !== undefined) pos.y = surf(pos.x, pos.z) + leg.aboveGroundM * VE;
    } else c.setTimeOverride(leg.time0 + (stats.frames + 1) * leg.worldStepS);
  };

  const stats = {
    name: leg.name, frames: 0, startAltM: null, endAltM: null, travelledM: 0,
    instances: new Set(), visibleClouds: new Set(), missing: 0, keyChanges: 0,
    maxCloudStep: 0, worstCloud: null, maxNearExcess: -Infinity, worstNear: null, maxEffStep: 0,
    bigSteps: 0, // (puff, frame) pairs whose cloud opacity changed by more than leg.stepBound (0.03)
    joined: 0, left: 0, maxJoinOpacity: 0, layer: [Infinity, -Infinity], airWeightSteps: [],
    rewrites: 0,
  };
  // Stable puff identities: a puff is its cloud's (x, z) plus its offset.
  const keyToId = new Map();
  let idOf = null, prevR = null, prevG = null, prevPresent = null, lastRewrites = -1, prevOpacity = null;
  const prevCam = new V();
  const keysNow = () => {
    const g = c.mesh.geometry, a = g.getAttribute('aCloud'), p = g.getAttribute('aPuff'), n = g.instanceCount;
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${a.getX(i)},${a.getY(i)},${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
      let id = keyToId.get(k);
      if (id === undefined) { id = keyToId.size; keyToId.set(k, id); }
      ids[i] = id;
    }
    return ids;
  };
  const radius = i => c.mesh.geometry.getAttribute('aPuff').getW(i);

  return await new Promise((resolve, reject) => {
    const guard = setTimeout(() => { window.__preTick = window.__postTick = null; reject(new Error(`${leg.name}: timed out at frame ${stats.frames}`)); }, leg.timeoutMs ?? 240000);
    let started = false;
    window.__preTick = () => {
      if (started) advance();
      started = true;
      u.camera.position.copy(pos);
      u.controls.target.copy(pos).add(look);
    };
    window.__postTick = () => {
      try {
        const cam = u.camera.position;
        const alt = (cam.y - surf(cam.x, cam.z)) / VE;
        if (stats.startAltM === null) stats.startAltM = alt;
        stats.endAltM = alt;
        const pr = c.probe(renderer, u.camera);
        stats.missing += pr.missing;
        stats.instances.add(pr.count);
        stats.visibleClouds.add(c.status.visibleClouds);
        stats.layer[0] = Math.min(stats.layer[0], pr.layer); stats.layer[1] = Math.max(stats.layer[1], pr.layer);
        const rewrites = c.status.rewrites ?? 0;
        if (rewrites !== lastRewrites || !idOf || idOf.length !== pr.count) {
          if (lastRewrites >= 0) stats.rewrites++;
          idOf = keysNow(); lastRewrites = rewrites;
        }
        const nIds = keyToId.size;
        const R = new Float32Array(nIds).fill(NaN), G = new Float32Array(nIds).fill(NaN), present = new Uint8Array(nIds);
        const at = new Int32Array(nIds).fill(-1);
        for (let i = 0; i < pr.count; i++) { const id = idOf[i]; R[id] = pr.perCloud[i]; G[id] = pr.near[i]; present[id] = 1; at[id] = i; }
        // The air weight: may only be between 0 and 1 within its 12-unit ramp above the ground.
        if (prevOpacity !== null && pr.opacity !== prevOpacity) {
          stats.airWeightSteps.push({ frame: stats.frames, from: +prevOpacity.toFixed(3), to: +pr.opacity.toFixed(3), heightAboveGround: +(cam.y - surf(cam.x, cam.z)).toFixed(1) });
        }
        if (prevR) {
          // Camera step in display metres (the view space the shader measures in).
          const dCam = Math.hypot(cam.x - prevCam.x, (cam.y - prevCam.y) * ratio, cam.z - prevCam.z);
          stats.travelledM += dCam;
          for (let id = 0; id < nIds; id++) {
            const was = id < prevPresent.length && prevPresent[id], is = present[id];
            // Opacity is compared only while the clouds are shown in both frames
            // (underground the air weight hides them, and the system leaves the
            // uniforms as they were).
            if (was && is && pr.opacity > 0 && prevOpacity > 0) {
              const dR = Math.abs(R[id] - prevR[id]);
              if (dR > (leg.stepBound ?? 0.03)) stats.bigSteps++;
              if (dR > stats.maxCloudStep) { stats.maxCloudStep = dR; stats.worstCloud = { frame: stats.frames, from: prevR[id], to: R[id], alt: +alt.toFixed(1) }; }
              const i = at[id];
              const allowed = 1.5 * dCam / (1.6 * radius(i));
              const excess = Math.abs(G[id] - prevG[id]) - allowed;
              if (excess > stats.maxNearExcess) { stats.maxNearExcess = excess; stats.worstNear = { frame: stats.frames, from: prevG[id], to: G[id], allowed: +allowed.toFixed(4), r: radius(i) }; }
              const eff = Math.abs(pr.opacity * R[id] * G[id] - prevOpacity * prevR[id] * prevG[id]);
              if (pr.opacity === prevOpacity) stats.maxEffStep = Math.max(stats.maxEffStep, eff);
            } else if (was && is) {
              // hidden in one of the two frames: nothing to compare
            } else if (is && !was) { stats.joined++; stats.maxJoinOpacity = Math.max(stats.maxJoinOpacity, R[id]); }
            else if (was && !is) { stats.left++; stats.maxJoinOpacity = Math.max(stats.maxJoinOpacity, prevR[id]); }
          }
        }
        prevR = R; prevG = G; prevPresent = present; prevOpacity = pr.opacity; prevCam.copy(cam);
        stats.frames++;
        if (done()) {
          clearTimeout(guard);
          window.__preTick = window.__postTick = null;
          resolve({ ...stats, instances: [...stats.instances], visibleClouds: [...stats.visibleClouds], puffsSeen: keyToId.size,
            startAltM: +stats.startAltM.toFixed(1), endAltM: +stats.endAltM.toFixed(1), travelledM: Math.round(stats.travelledM) });
        }
      } catch (e) { clearTimeout(guard); window.__preTick = window.__postTick = null; reject(e); }
    };
  });
}
