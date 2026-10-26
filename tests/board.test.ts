import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBoard, roundPoints, serializeBoard, type Board } from '../src/lib/board.ts';

test('a saved board survives a round trip', () => {
  const board: Board = {
    text: 'Call Alex back\n- [ ] send the offer',
    strokes: [
      { color: 2, size: 5, points: [10, 20, 0.5, 30.04, 40.06, 0.5], pressure: false },
      { color: 0, size: 3, points: [1, 2, 0.333], pressure: true },
    ],
  };
  const restored = parseBoard(serializeBoard(board));
  assert.deepEqual(restored, {
    text: board.text,
    strokes: [
      { color: 2, size: 5, points: [10, 20, 0.5, 30, 40.1, 0.5], pressure: false },
      { color: 0, size: 3, points: [1, 2, 0.33], pressure: true },
    ],
  });
});

test('nothing usable gives null, a damaged stroke is dropped', () => {
  assert.equal(parseBoard(null), null);
  assert.equal(parseBoard(''), null);
  assert.equal(parseBoard('{ not json'), null);
  for (const notABoard of ['[1, 2]', 'null', '"text"', '42']) assert.equal(parseBoard(notABoard), null, notABoard);

  const board = parseBoard(
    JSON.stringify({
      text: 42,
      strokes: [
        { c: 1, s: 4, p: [1, 2, 0.5] },
        { c: 1, s: 4, p: [1, 'two', 0.5] },
        { c: 1, s: 4, p: [1, 2] },
        'nonsense',
      ],
    }),
  );
  assert.deepEqual(board, { text: '', strokes: [{ color: 1, size: 4, points: [1, 2, 0.5], pressure: false }] });
});

test('a board from a newer version is left alone', () => {
  assert.equal(parseBoard(JSON.stringify({ format: 2, text: 'x', strokes: [] })), null);
  assert.deepEqual(parseBoard(JSON.stringify({ format: 1, text: 'x', strokes: [] })), { text: 'x', strokes: [] });
});

test('values out of range are pulled back in', () => {
  const board = parseBoard(JSON.stringify({ text: 'x', strokes: [{ c: 99, s: 900, p: [1, 2, 0.5, 3, 4] }] }));
  assert.deepEqual(board?.strokes, [{ color: 5, size: 48, points: [1, 2, 0.5], pressure: false }]);
  const negative = parseBoard(JSON.stringify({ strokes: [{ c: -3, s: 0, p: [0, 0, 1] }] }));
  assert.deepEqual(negative?.strokes, [{ color: 0, size: 1, points: [0, 0, 1], pressure: false }]);
});

test('points are rounded per coordinate kind', () => {
  assert.deepEqual(roundPoints([1.234, 5.678, 0.4567, -0.05, 9.99, 1]), [1.2, 5.7, 0.46, -0, 10, 1]);
});
