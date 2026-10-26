import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxesTouch, pointsBox, segmentDistanceSq, strokeHit } from '../src/lib/geometry.ts';

test('distance to a segment clamps to its ends', () => {
  assert.equal(segmentDistanceSq(5, 3, 0, 0, 10, 0), 9);
  assert.equal(segmentDistanceSq(-4, 3, 0, 0, 10, 0), 25);
  assert.equal(segmentDistanceSq(13, 4, 0, 0, 10, 0), 25);
  assert.equal(segmentDistanceSq(2, 2, 1, 1, 1, 1), 2);
});

test('the eraser hits a stroke when its ring touches the line width', () => {
  const line = [0, 0, 0.5, 100, 0, 0.5];
  assert.equal(strokeHit(line, 2, 50, 11, 10), true);
  assert.equal(strokeHit(line, 2, 50, 13, 10), false);
  assert.equal(strokeHit(line, 2, 115, 0, 10), false);
});

test('a single tap is a dot', () => {
  assert.equal(strokeHit([10, 10, 0.5], 3, 18, 10, 6), true);
  assert.equal(strokeHit([10, 10, 0.5], 3, 30, 10, 6), false);
  assert.equal(strokeHit([], 3, 0, 0, 6), false);
});

test('boxes include the padding and detect overlap', () => {
  const box = pointsBox([10, 20, 0.5, 30, 5, 0.5], 2);
  assert.deepEqual(box, { minX: 8, minY: 3, maxX: 32, maxY: 22 });
  assert.equal(boxesTouch(box, { minX: 32, minY: 22, maxX: 40, maxY: 40 }), true);
  assert.equal(boxesTouch(box, { minX: 33, minY: 0, maxX: 40, maxY: 40 }), false);
  assert.deepEqual(pointsBox([], 2), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
});
