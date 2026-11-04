import test from 'node:test';
import assert from 'node:assert/strict';
import {clockDate} from '../src/stars.js';

const cases = [
  ['winter midnight', 10, 4, 0, '2026-11-04T00:00:00.000Z'],
  ['winter evening', 10, 4, 23.5, '2026-11-04T23:30:00.000Z'],
  ['summer midnight', 6, 4, 0, '2026-07-03T23:00:00.000Z'],
  ['summer evening', 6, 4, 23.5, '2026-07-04T22:30:00.000Z'],
  ['spring before the change', 2, 29, .5, '2026-03-29T00:30:00.000Z'],
  ['spring missing hour advances', 2, 29, 1.5, '2026-03-29T01:30:00.000Z'],
  ['spring after the change', 2, 29, 2.5, '2026-03-29T01:30:00.000Z'],
  ['spring evening', 2, 29, 23, '2026-03-29T22:00:00.000Z'],
  ['autumn before the change', 9, 25, .5, '2026-10-24T23:30:00.000Z'],
  ['autumn repeated hour uses earlier occurrence', 9, 25, 1.5, '2026-10-25T00:30:00.000Z'],
  ['autumn after the change', 9, 25, 2.5, '2026-10-25T02:30:00.000Z'],
  ['autumn evening', 9, 25, 23, '2026-10-25T23:00:00.000Z'],
];
for (const [name, month, day, hour, expected] of cases) {
  test(`London sky date: ${name}`, ()=>{
    assert.equal(clockDate(hour, new Date(2026, month, day, 12)).toISOString(), expected);
  });
}
