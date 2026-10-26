/** Recording and displaying the global shortcut. Accelerators use the names
 *  the native side parses: "Ctrl+Alt+Space", "Super+Shift+KeyN", "F9". */

export type Platform = 'windows' | 'macos' | 'linux';

/** Same as the native default (src-tauri/src/hotkey.rs). macOS uses ⌃⌥Space
 *  to switch the input source, so it gets ⇧⌘Space instead. */
export function defaultShortcut(platform: Platform): string {
  return platform === 'macos' ? 'Shift+Super+Space' : 'Ctrl+Alt+Space';
}

export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type RecordResult =
  | { kind: 'pending'; modifiers: string }
  | { kind: 'cancel' }
  | { kind: 'invalid'; reason: 'needs-modifier' | 'unsupported' }
  | { kind: 'ok'; accelerator: string };

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super', 'Hyper']);

/** Keys the native side can register, by `KeyboardEvent.code`, besides
 *  letters, digits, numpad digits and function keys. */
const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'Pause',
  'ScrollLock',
  'PrintScreen',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
]);

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;

/** The accelerator key name for a `KeyboardEvent.code`, or null if the native
 *  side cannot register it. */
export function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? null;
  if (FUNCTION_KEY.test(code) || /^Numpad\d$/.test(code) || NAMED_KEYS.has(code)) return code;
  return null;
}

function heldModifiers(event: KeyLike): string[] {
  const held: string[] = [];
  if (event.ctrlKey) held.push('Ctrl');
  if (event.altKey) held.push('Alt');
  if (event.shiftKey) held.push('Shift');
  if (event.metaKey) held.push('Super');
  return held;
}

/** Turns one keydown into a shortcut. A global shortcut needs Ctrl, Alt or the
 *  system key, unless it is a function key: anything else would swallow normal
 *  typing in every app. */
export function recordShortcut(event: KeyLike): RecordResult {
  const held = heldModifiers(event);
  if (event.code === 'Escape' && held.length === 0) return { kind: 'cancel' };
  if (MODIFIER_KEYS.has(event.key) || /^(Control|Alt|Shift|Meta|OS)(Left|Right)$/.test(event.code)) {
    return { kind: 'pending', modifiers: held.join('+') };
  }
  const key = keyName(event.code);
  if (!key) return { kind: 'invalid', reason: 'unsupported' };
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !FUNCTION_KEY.test(key)) {
    return { kind: 'invalid', reason: 'needs-modifier' };
  }
  return { kind: 'ok', accelerator: [...held, key].join('+') };
}

const MAC_SYMBOLS: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  super: '⌘',
  cmd: '⌘',
  command: '⌘',
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  commandorctrl: '⌘',
  cmdorcontrol: '⌘',
};

const KEY_LABELS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

function keyLabel(token: string): string {
  const named = KEY_LABELS[token];
  if (named) return named;
  const letter = /^Key([A-Z])$/i.exec(token);
  if (letter) return (letter[1] ?? '').toUpperCase();
  const digit = /^Digit(\d)$/i.exec(token);
  if (digit) return digit[1] ?? '';
  const numpad = /^Numpad(\d)$/i.exec(token);
  if (numpad) return `Num ${numpad[1] ?? ''}`;
  return token.length === 1 ? token.toUpperCase() : token;
}

/** Modifier order in macOS menus. */
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

/** How a shortcut reads on this platform: "Ctrl+Alt+Space", "⇧⌘Space". */
export function formatShortcut(accelerator: string, platform: Platform): string {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (platform === 'macos') {
    const symbols = parts.map((part) => MAC_SYMBOLS[part.toLowerCase()]);
    const modifiers = symbols
      .filter((symbol): symbol is string => symbol !== undefined)
      .sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    const keys = parts.filter((_, index) => symbols[index] === undefined).map(keyLabel);
    return [...modifiers, ...keys].join('');
  }
  const system = platform === 'windows' ? 'Win' : 'Super';
  const names: Record<string, string> = {
    ctrl: 'Ctrl',
    control: 'Ctrl',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    super: system,
    cmd: system,
    command: system,
    cmdorctrl: 'Ctrl',
    commandorcontrol: 'Ctrl',
    commandorctrl: 'Ctrl',
    cmdorcontrol: 'Ctrl',
  };
  return parts.map((part) => names[part.toLowerCase()] ?? keyLabel(part)).join('+');
}

/** Label of an in-app shortcut: "Ctrl+D" on Windows and Linux, "⌘D" on macOS.
 *  Symbol keys get a space instead of a plus, so "Ctrl +" never reads "Ctrl++". */
export function appShortcut(key: string, platform: Platform, shift = false): string {
  if (platform === 'macos') return `${shift ? '⇧' : ''}⌘${key}`;
  const modifiers = shift ? 'Ctrl+Shift' : 'Ctrl';
  const joiner = /^[a-z0-9]$/i.test(key) ? '+' : ' ';
  return `${modifiers}${joiner}${key}`;
}
