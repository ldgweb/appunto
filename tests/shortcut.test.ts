import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appShortcut,
  defaultShortcut,
  formatShortcut,
  keyName,
  recordShortcut,
  type KeyLike,
} from '../src/lib/shortcut.ts';

function key(code: string, keyValue: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { code, key: keyValue, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

test('records combinations in the native format', () => {
  assert.deepEqual(recordShortcut(key('Space', ' ', { ctrlKey: true, altKey: true })), {
    kind: 'ok',
    accelerator: 'Ctrl+Alt+Space',
  });
  assert.deepEqual(recordShortcut(key('KeyN', 'N', { metaKey: true, shiftKey: true })), {
    kind: 'ok',
    accelerator: 'Shift+Super+N',
  });
  assert.deepEqual(recordShortcut(key('F9', 'F9')), { kind: 'ok', accelerator: 'F9' });
  assert.deepEqual(recordShortcut(key('Digit1', '!', { altKey: true, shiftKey: true })), {
    kind: 'ok',
    accelerator: 'Alt+Shift+1',
  });
});

test('waits while only modifiers are held', () => {
  assert.deepEqual(recordShortcut(key('ControlLeft', 'Control', { ctrlKey: true })), {
    kind: 'pending',
    modifiers: 'Ctrl',
  });
  assert.deepEqual(recordShortcut(key('AltRight', 'AltGraph', { ctrlKey: true, altKey: true })), {
    kind: 'pending',
    modifiers: 'Ctrl+Alt',
  });
});

test('refuses shortcuts that would block normal typing', () => {
  assert.deepEqual(recordShortcut(key('KeyA', 'a')), { kind: 'invalid', reason: 'needs-modifier' });
  assert.deepEqual(recordShortcut(key('KeyA', 'A', { shiftKey: true })), { kind: 'invalid', reason: 'needs-modifier' });
  assert.deepEqual(recordShortcut(key('IntlBackslash', '<', { ctrlKey: true })), {
    kind: 'invalid',
    reason: 'unsupported',
  });
});

test('Escape alone cancels recording and is never a shortcut', () => {
  assert.deepEqual(recordShortcut(key('Escape', 'Escape')), { kind: 'cancel' });
  // Ctrl+Esc belongs to the system (the Start menu on Windows).
  assert.deepEqual(recordShortcut(key('Escape', 'Escape', { ctrlKey: true })), {
    kind: 'invalid',
    reason: 'unsupported',
  });
});

test('maps key codes the native side understands', () => {
  assert.equal(keyName('KeyZ'), 'Z');
  assert.equal(keyName('Digit0'), '0');
  assert.equal(keyName('F24'), 'F24');
  assert.equal(keyName('F25'), null);
  assert.equal(keyName('Numpad7'), 'Numpad7');
  assert.equal(keyName('Backquote'), 'Backquote');
  assert.equal(keyName('MetaLeft'), null);
});

test('shows shortcuts the way each system writes them', () => {
  assert.equal(formatShortcut('Ctrl+Alt+Space', 'windows'), 'Ctrl+Alt+Space');
  assert.equal(formatShortcut('Ctrl+Alt+Space', 'macos'), '⌃⌥Space');
  assert.equal(formatShortcut('Shift+Super+N', 'windows'), 'Shift+Win+N');
  assert.equal(formatShortcut('Shift+Super+N', 'linux'), 'Shift+Super+N');
  assert.equal(formatShortcut('Shift+Super+N', 'macos'), '⇧⌘N');
  // macOS writes modifiers in a fixed order, whatever order they were stored in.
  assert.equal(formatShortcut('Super+Shift+Ctrl+Alt+K', 'macos'), '⌃⌥⇧⌘K');
  assert.equal(formatShortcut(defaultShortcut('macos'), 'macos'), '⇧⌘Space');
  assert.equal(formatShortcut(defaultShortcut('windows'), 'windows'), 'Ctrl+Alt+Space');
  assert.equal(formatShortcut('CmdOrCtrl+KeyK', 'windows'), 'Ctrl+K');
  assert.equal(formatShortcut('Alt+Backquote', 'linux'), 'Alt+`');
  assert.equal(appShortcut('D', 'windows'), 'Ctrl+D');
  assert.equal(appShortcut('Z', 'linux', true), 'Ctrl+Shift+Z');
  assert.equal(appShortcut('Z', 'macos', true), '⇧⌘Z');
  assert.equal(appShortcut('+', 'windows'), 'Ctrl +');
  assert.equal(appShortcut('-', 'linux'), 'Ctrl -');
  assert.equal(appShortcut('+', 'macos'), '⌘+');
});
