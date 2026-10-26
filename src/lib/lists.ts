/** Small editing helpers for plain-text notes: lists that continue on Enter,
 *  and Tab to indent. They return edits instead of touching the DOM, so the
 *  editor can apply them through the browser's undo history. */

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const ITEM = /^([ \t]*)([-*+•]|\d{1,9}[.)])( \[[ xX]\])?[ \t]+/;

function lineBounds(text: string, position: number): [number, number] {
  const start = text.lastIndexOf('\n', position - 1) + 1;
  const end = text.indexOf('\n', position);
  return [start, end === -1 ? text.length : end];
}

/** What Enter does inside a list item: start the next item, or end the list
 *  when the item is empty. `null` means a plain new line. */
export function enterInList(text: string, caret: number): TextEdit | null {
  const [lineStart, lineEnd] = lineBounds(text, caret);
  const line = text.slice(lineStart, lineEnd);
  const match = ITEM.exec(line);
  if (!match) return null;
  const prefix = match[0];
  if (caret - lineStart < prefix.length) return null;

  if (line.slice(prefix.length).trim() === '') {
    return { from: lineStart, to: lineEnd, insert: '' };
  }
  const indent = match[1] ?? '';
  const marker = match[2] ?? '-';
  const next = /^\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker;
  const box = match[3] ? ' [ ]' : '';
  return { from: caret, to: caret, insert: `\n${indent}${next}${box} ` };
}

export interface BlockEdit {
  edit: TextEdit;
  /** Selection to restore after the edit. */
  selection: [number, number];
}

/** Indents (Tab) or outdents (Shift+Tab) every line touched by the selection. */
export function indentLines(text: string, start: number, end: number, outdent: boolean): BlockEdit | null {
  const blockStart = text.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends right after a line break does not include the next line.
  const lastPosition = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const [, blockEnd] = lineBounds(text, lastPosition);
  const lines = text.slice(blockStart, blockEnd).split('\n');

  let removedBeforeStart = 0;
  const changed = lines.map((line, index) => {
    if (!outdent) return `\t${line}`;
    const removed = line.startsWith('\t') ? 1 : (/^ {1,4}/.exec(line)?.[0].length ?? 0);
    if (index === 0) removedBeforeStart = Math.min(removed, start - blockStart);
    return line.slice(removed);
  });
  const replacement = changed.join('\n');
  const original = text.slice(blockStart, blockEnd);
  if (replacement === original) return null;

  const delta = replacement.length - original.length;
  const collapsed = start === end;
  const selection: [number, number] = collapsed
    ? [start + (outdent ? -removedBeforeStart : 1), start + (outdent ? -removedBeforeStart : 1)]
    : [blockStart, blockEnd + delta];
  return { edit: { from: blockStart, to: blockEnd, insert: replacement }, selection };
}
