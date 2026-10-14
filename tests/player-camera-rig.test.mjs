// player-camera-rig.test.mjs: the over-the-shoulder camera in real metres (sprint 14Oct26w, lane P).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig, RIG_TABLE, RIG } from '../src/player/camera-rig.js';
import { wheelZoomFactor } from '../src/player/third-person.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);
const mk = (o = {}) => createCameraRig({ THREE, ratio: 0.2, ...o });
const FEET = { x: 100, y: 40, z: -50 };

/** Display-space camera position: canonical y x ratio. */
const display = (rig, ratio) => { const { position } = rig.pose(new THREE.Vector3(), new THREE.Quaternion()); return new THREE.Vector3(position.x, position.y * ratio, position.z); };

test('default pose: behind the walker, 4.2 m back, shoulder to the right, pitched 0.16 rad down', () => {
  const rig = mk();
  rig.reset({ yaw: 0 });
  rig.follow(FEET, 1 / 60);
  const c = display(rig, 0.2);
  // yaw 0 looks -Z, so the camera is at +Z; pivot at 1.45 m, shoulder 0.45 to the right (+X)
  near(c.x, 100 + 0.45, 0.01);
  near(c.y, 40 * 0.2 + 1.45 + 4.2 * Math.sin(0.16), 0.01);
  near(c.z, -50 + 4.2 * Math.cos(0.16), 0.01);
});

test('real metres at any Master: the display distance and height do not depend on the ratio', () => {
  for (const ratio of [0.2, 0.22, 0.3, 1, 2]) {
    const rig = mk({ ratio });
    rig.reset({ yaw: 0.7 });
    rig.follow(FEET, 1 / 60);
    const c = display(rig, ratio);
    const origin = new THREE.Vector3(FEET.x + Math.cos(0.7) * 0.45, FEET.y * ratio + 1.45, FEET.z - Math.sin(0.7) * 0.45);
    near(c.distanceTo(origin), 4.2, 1e-6, `ratio ${ratio}`);
    near(c.y - origin.y, 4.2 * Math.sin(0.16), 1e-6, `ratio ${ratio}`);
  }
});

test('the camera looks at the origin: canonical pitch is atan(tan(display pitch) / ratio)', () => {
  const ratio = 0.22;
  const rig = mk({ ratio });
  rig.reset({ yaw: 0.3, pitch: -0.5 });
  rig.follow(FEET, 1 / 60);
  const { position, quaternion } = rig.pose(new THREE.Vector3(), new THREE.Quaternion());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const toOrigin = rig.origin.clone().sub(position).normalize();
  near(fwd.distanceTo(toOrigin), 0, 1e-6);
  // the displayed pitch (the y component scaled by the ratio) is the rig's
  const dispPitch = Math.atan2(fwd.y * ratio, Math.hypot(fwd.x, fwd.z));
  near(dispPitch, -0.5, 1e-6);
});

test('orbit: dragging right turns the view right, 0.005 rad a pixel, and pitch clamps to the row', () => {
  const rig = mk();
  rig.reset({ yaw: 0 });
  rig.orbit(100, 0);
  near(rig.yaw, -0.5, 1e-9);
  rig.orbit(0, 600);
  near(rig.pitch, RIG_TABLE.foot.pitchMin, 1e-9);
  rig.orbit(0, -1500);
  near(rig.pitch, RIG_TABLE.foot.pitchMax, 1e-9);
});

test('zoom: the distance stays inside the row', () => {
  const rig = mk();
  rig.reset({});
  rig.zoom(100);
  near(rig.wantedDistance, 12, 1e-9);
  rig.zoom(1e-6);
  near(rig.wantedDistance, 1.8, 1e-9);
  rig.zoom(2);
  near(rig.wantedDistance, 3.6, 1e-9);
});

test('wheel factors: scroll closer for negative deltaY, pinch is stronger, one event never more than doubles', () => {
  assert.ok(wheelZoomFactor({ deltaY: 100 }) > 1);
  assert.ok(wheelZoomFactor({ deltaY: -100 }) < 1);
  assert.ok(wheelZoomFactor({ deltaY: -10, ctrlKey: true }) < wheelZoomFactor({ deltaY: -10 }));
  assert.equal(wheelZoomFactor({ deltaY: 1e6 }), 2);
  assert.equal(wheelZoomFactor({ deltaY: -1e6, ctrlKey: true }), 0.5);
  near(wheelZoomFactor({ deltaY: 5, deltaMode: 1 }), wheelZoomFactor({ deltaY: 80 }), 1e-12);
});

test('line of sight pulls the camera in at once and releases it smoothly', () => {
  let t = 0.5;
  const rig = mk({ lineOfSight: () => (t < 1 ? { clear: false, t } : { clear: true, t: 1 }) });
  rig.reset({});
  rig.follow(FEET, 1 / 60);
  near(rig.distance, Math.max(RIG.losMinDistance, 0.5 * 4.2 - RIG.losPad), 1e-9);
  assert.equal(rig.pulled, true);
  t = 1;
  rig.follow(FEET, 1 / 60);
  assert.ok(rig.distance > 1.8 && rig.distance < 4.2, 'eases out, not a jump');
  for (let i = 0; i < 300; i++) rig.follow(FEET, 1 / 60);
  near(rig.distance, 4.2, 0.01);
});

test('the camera never sits below the ground, or the water top unless the walker is under it', () => {
  const rig = mk({ groundY: () => 100, waterY: () => 120 });
  rig.reset({ pitch: -1.2 });
  rig.follow({ x: 0, y: 50, z: 0 }, 1 / 60);
  assert.ok(rig.pose(new THREE.Vector3()).position.y >= 120 + 0.3 / 0.2 - 1e-9);
  rig.follow({ x: 0, y: 50, z: 0 }, 1 / 60, { underwater: true });
  assert.ok(rig.pose(new THREE.Vector3()).position.y >= 100 + 0.3 / 0.2 - 1e-9);
});

test('the pivot catches the body smoothly and snaps on a jump of more than 5 m', () => {
  const rig = mk();
  rig.reset({});
  rig.follow({ x: 0, y: 0, z: 0 }, 1 / 60);
  rig.follow({ x: 3, y: 0, z: 0 }, 1 / 60);
  const o1 = rig.origin.x;
  assert.ok(o1 > 0.45 && o1 < 3.45, `smoothed ${o1}`);
  rig.follow({ x: 80, y: 0, z: 0 }, 1 / 60);
  near(rig.origin.x, 80 + 0.45, 1e-9, 'snapped');
});

test('the swim row has its own pivot and distance', () => {
  const rig = mk();
  rig.reset({});
  rig.setBody('swim');
  assert.throws(() => rig.setBody('nope'), RangeError);
  rig.follow(FEET, 0, { snap: true });
  near(rig.wantedDistance, 4.6, 1e-9);
});

test('the pivot never trails a fast body by more than the lag limits (a jetpack climb keeps the head in frame)', () => {
  const ratio = 0.2;
  const rig = mk({ ratio });
  rig.reset({});
  let y = 0;
  rig.follow({ x: 0, y, z: 0 }, 1 / 60);
  for (let i = 0; i < 120; i++) {              // climbing 18 m/s: 90 canonical units a second
    y += 90 / 60;
    rig.follow({ x: 0, y, z: 0 }, 1 / 60);
  }
  const lagM = (y - (rig.origin.y - 1.45 / ratio)) * ratio;
  assert.ok(lagM <= RIG.maxLagY + 1e-6, `vertical lag ${lagM} m`);
  assert.ok(lagM > 0.2, 'still a smooth follow, not a rigid one');
  let x = 0;
  const rig2 = mk({ ratio });
  rig2.reset({});
  rig2.follow({ x, y: 0, z: 0 }, 1 / 60);
  for (let i = 0; i < 120; i++) { x += 15 / 60; rig2.follow({ x, y: 0, z: 0 }, 1 / 60); }
  const lagX = x - (rig2.origin.x - 0.45);
  assert.ok(lagX <= RIG.maxLagXZ + 1e-6, `horizontal lag ${lagX} m`);
});

test('a pulled-in camera asks for a lower near plane, so the figure is not cut; an unpulled one asks for nothing', () => {
  const rig = mk();
  rig.reset({});
  rig.follow(FEET, 0, { snap: true });
  assert.equal(rig.suggestedNear, null);
  const close = mk({ lineOfSight: () => ({ clear: false, t: 0.4 }) });
  close.reset({});
  close.follow(FEET, 0, { snap: true });
  const n = close.suggestedNear;
  assert.ok(n !== null && n >= 0.12 && n < 1, `near ${n}`);
  assert.ok(n <= 0.4 * close.distance + 1e-9);
});
