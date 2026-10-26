import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enterInList, indentLines } from '../src/lib/lists.ts';

/** Applies an edit, for readable expectations. */
function enter(text: string, caret = text.length): string | null {
  const edit = enterInList(text, caret);
  if (!edit) return null;
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

test('Enter continues bullet, numbered and checkbox lists', () => {
  assert.equal(enter('- milk'), '- milk\n- ');
  assert.equal(enter('  * eggs'), '  * eggs\n  * ');
  assert.equal(enter('• bread'), '• bread\n• ');
  assert.equal(enter('9. call Alex'), '9. call Alex\n10. ');
  assert.equal(enter('3) pay invoice'), '3) pay invoice\n4) ');
  assert.equal(enter('- [x] done'), '- [x] done\n- [ ] ');
});

test('Enter on an empty item ends the list', () => {
  assert.equal(enter('- milk\n- '), '- milk\n');
  assert.equal(enter('1. a\n2.   '), '1. a\n');
});

test('Enter is a plain new line outside lists or inside the marker', () => {
  assert.equal(enter('just a note'), null);
  assert.equal(enter('-no space'), null);
  assert.equal(enter('2026 was a year'), null);
  assert.equal(enterInList('- milk', 1), null);
});

test('Enter in the middle of an item splits it', () => {
  assert.equal(enter('- milk and eggs', 7), '- milk \n- and eggs');
});

test('Tab indents every selected line, Shift+Tab outdents', () => {
  const text = 'one\ntwo\nthree';
  const indented = indentLines(text, 1, 6, false);
  assert.deepEqual(indented?.edit, { from: 0, to: 7, insert: '\tone\n\ttwo' });
  assert.deepEqual(indented?.selection, [0, 9]);

  const outdented = indentLines('\tone\n    two\nthree', 0, 12, true);
  assert.deepEqual(outdented?.edit, { from: 0, to: 12, insert: 'one\ntwo' });
});

test('Shift+Tab moves the caret with the text and ignores flush lines', () => {
  const block = indentLines('\t\tdeep', 3, 3, true);
  assert.deepEqual(block?.edit, { from: 0, to: 6, insert: '\tdeep' });
  assert.deepEqual(block?.selection, [2, 2]);
  assert.equal(indentLines('flush', 2, 2, true), null);
});

test('a selection ending at a line start does not touch the next line', () => {
  const block = indentLines('a\nb\nc', 0, 2, false);
  assert.deepEqual(block?.edit, { from: 0, to: 1, insert: '\ta' });
});
