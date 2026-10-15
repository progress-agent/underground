// vehicles/index.js: the three bodies the player rides or watches from outside, assembled (sprint 14Oct26w, lane D,
// D-053 items 2 and 3): the skateboard, the Drone and the Balloon. One object holds the models (all under lane P's
// top-level `player` group, whose own `visible` this code never writes), the board's on-demand load, and the screen
// rectangle the station-name hook reads.
//
//   board     the Kenney skateboard; fetched on the FIRST B, so a cold load fetches no extra model
//   drone     built in code on first use
//   balloon   built in code on first use
//
// TEST SURFACE (dev handle window.__ug.vehicles): debug(), screenRect, board, drone, balloon (null until used).
import { createBoardModel } from './board-model.js';
import { createDroneModel } from './drone-model.js';
import { createBalloonModel } from './balloon-model.js';
import { displayedNdc } from '../player/label-cover.js';

export const RECT_PAD_PX = 6;
// Points of the drone and the balloon, in real metres from the model's origin (x, y, z), whose projection makes the
// rectangle the names hide behind. The drone's origin is its centre; the balloon's the basket floor's underside.
const DRONE_POINTS = (() => {
  const pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-0.04, 0.08]) pts.push([sx * 0.27, y, sz * 0.27]);
  return pts;
})();
const BALLOON_POINTS = (() => {
  const pts = [[0, 19.9, 0], [0, 3.4, 0], [0, 0, 0]];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    pts.push([8 * Math.cos(a), 12.3, 8 * Math.sin(a)]);
    pts.push([6.2 * Math.cos(a), 17.3, 6.2 * Math.sin(a)]);
    pts.push([4.2 * Math.cos(a), 6.5, 4.2 * Math.sin(a)]);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * 0.75, 1.1, sz * 0.75]);
  return pts;
})();

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {object} o.parent    the top-level `player` group
 * @param {(url: string) => Promise<object>} o.loadGLTF   resolves a glTF ({ scene, animations })
 * @param {() => number} [o.ratio]  Master / 5, live
 * @param {(x: number, y: number) => ({ x: number, y: number })} [o.distortNdc]  lens.js distortNdc
 */
export function createVehicles({ THREE, parent, loadGLTF, ratio = () => 1, distortNdc = (x, y) => ({ x, y }), boardUrl = '/models/player/skateboard.glb' }) {
  let board = null, drone = null, balloon = null;
  let boardStatus = 'idle', boardPromise = null;
  let rect = null;
  const tmp = new THREE.Vector3();

  function loadBoard() {
    if (boardPromise) return boardPromise;
    boardStatus = 'loading';
    boardPromise = (async () => {
      try {
        const gltf = await loadGLTF(boardUrl);
        board = createBoardModel({ THREE, gltf });
        parent.add(board.group);
        boardStatus = 'ready';
        return board;
      } catch (err) {
        boardStatus = 'failed';
        console.warn('[vehicles] the skateboard did not load', err);
        return null;
      }
    })();
    return boardPromise;
  }

  function getDrone() {
    if (!drone) { drone = createDroneModel({ THREE }); parent.add(drone.group); }
    return drone;
  }
  function getBalloon() {
    if (!balloon) { balloon = createBalloonModel({ THREE }); parent.add(balloon.group); }
    return balloon;
  }

  /**
   * The rectangle (CSS px as the lens pass draws it) of the drone or the balloon, padded, or null. `origin` is the model
   * origin in canonical space, `yaw` its heading (the balloon has none). Call after the camera is placed.
   */
  function updateScreenRect(camera, kind, origin, yaw = 0, w = globalThis.innerWidth || 1440, h = globalThis.innerHeight || 900) {
    const pts = kind === 'drone' ? DRONE_POINTS : kind === 'balloon' ? BALLOON_POINTS : null;
    if (!pts || !origin) { rect = null; return null; }
    const rat = Math.max(1e-3, ratio());
    camera.updateMatrixWorld(true);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (const p of pts) {
      // a real-metre offset: x, z rotate with the heading, y is DISPLAY metres, so canonical y = y / ratio
      tmp.set(origin.x + p[0] * cy + p[2] * sy, origin.y + p[1] / rat, origin.z - p[0] * sy + p[2] * cy);
      tmp.project(camera);
      if (!(tmp.z < 1)) continue;
      const d = displayedNdc({ x: tmp.x, y: tmp.y }, distortNdc);
      const px = (d.x * 0.5 + 0.5) * w, py = (1 - (d.y * 0.5 + 0.5)) * h;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      n++;
    }
    if (!n) { rect = null; return null; }
    x0 -= RECT_PAD_PX; y0 -= RECT_PAD_PX; x1 += RECT_PAD_PX; y1 += RECT_PAD_PX;
    if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) { rect = null; return null; }
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return rect;
  }
  function clearScreenRect() { rect = null; }

  return {
    loadBoard, getDrone, getBalloon, updateScreenRect, clearScreenRect,
    get board() { return board; },
    get drone() { return drone; },
    get balloon() { return balloon; },
    get boardLoaded() { return boardStatus === 'ready'; },
    get boardStatus() { return boardStatus; },
    get screenRect() { return rect; },
    debug() {
      return {
        board: { visible: !!board && board.visible && parentVisible(board.group), loaded: boardStatus === 'ready', status: boardStatus, triangles: board?.triangles ?? 0 },
        drone: { visible: !!drone && drone.visible && parentVisible(drone.group), built: !!drone, triangles: drone?.triangles ?? 0, ...(drone ? { bladeAngles: drone.debug().bladeAngles } : {}) },
        balloon: { visible: !!balloon && balloon.visible && parentVisible(balloon.group), built: !!balloon, triangles: balloon?.triangles ?? 0, burnerFlame: !!balloon?.burnerFlame },
        screenRect: rect ? { ...rect } : null,
      };
    },
  };
}

function parentVisible(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}
