// Which building path a visit uses (sprint 02Oct26f, Lane F; D-048 item 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildingsPath, BUILDINGS_PATH_REV } from '../src/buildings-path.js';

test('a clean profile and no parameter: baked, and the marker is written', () => {
  const prefs = {};
  const r = resolveBuildingsPath(null, prefs);
  assert.equal(r.path, 'baked'); assert.equal(r.migrated, true);
  assert.equal(prefs.buildingsPathRev, BUILDINGS_PATH_REV);
});

test('a live saved before this release is dropped once, other prefs kept', () => {
  const prefs = { buildingsPath: 'live', masterHeight: 1.1 };
  const r = resolveBuildingsPath(null, prefs);
  assert.equal(r.path, 'baked'); assert.equal(r.migrated, true);
  assert.equal('buildingsPath' in prefs, false);
  assert.equal(prefs.masterHeight, 1.1);
  assert.equal(prefs.buildingsPathRev, BUILDINGS_PATH_REV);
  // The reload (the caller saved the prefs): still baked, nothing to migrate.
  const again = resolveBuildingsPath(null, prefs);
  assert.equal(again.path, 'baked'); assert.equal(again.migrated, false);
});

test('a live chosen after the release (marker present) persists', () => {
  const prefs = { buildingsPath: 'live', buildingsPathRev: BUILDINGS_PATH_REV };
  const r = resolveBuildingsPath(null, prefs);
  assert.equal(r.path, 'live'); assert.equal(r.migrated, false);
  assert.equal(prefs.buildingsPath, 'live');
});

test('a baked saved at any time stays baked', () => {
  assert.equal(resolveBuildingsPath(null, { buildingsPath: 'baked' }).path, 'baked');
  assert.equal(resolveBuildingsPath(null, { buildingsPath: 'baked', buildingsPathRev: BUILDINGS_PATH_REV }).path, 'baked');
});

test('the URL wins for the visit and is never saved', () => {
  const prefs = { buildingsPathRev: BUILDINGS_PATH_REV };
  assert.equal(resolveBuildingsPath('live', prefs).path, 'live');
  assert.equal('buildingsPath' in prefs, false);
  const old = { buildingsPath: 'live' };
  assert.equal(resolveBuildingsPath('baked', old).path, 'baked');
  assert.equal(resolveBuildingsPath('live', {}).path, 'live');
});

test('an unknown URL value is ignored', () => {
  assert.equal(resolveBuildingsPath('both', {}).path, 'baked');
  assert.equal(resolveBuildingsPath('', { buildingsPath: 'live', buildingsPathRev: BUILDINGS_PATH_REV }).path, 'live');
});

test('missing prefs object is tolerated', () => {
  assert.equal(resolveBuildingsPath(null, undefined).path, 'baked');
});
