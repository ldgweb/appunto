/** The text layer: a plain textarea with list continuation and Tab indenting.
 *  Every change goes through the browser's editing commands, so Ctrl+Z keeps
 *  working as usual. */

import { enterInList, indentLines, type TextEdit } from '../lib/lists.ts';

export class Editor {
  constructor(
    readonly area: HTMLTextAreaElement,
    onInput: () => void,
  ) {
    area.addEventListener('input', onInput);
    area.addEventListener('keydown', this.onKeyDown);
  }

  get text(): string {
    return this.area.value;
  }

  /** Replaces the whole text. This also resets the textarea's undo history. */
  set text(value: string) {
    this.area.value = value;
  }

  focus(): void {
    this.area.focus({ preventScroll: true });
  }

  /** Types `text` at the caret, as if the user had typed it. */
  insert(text: string): void {
    // Editing commands act on the focused element, so make sure it is this one.
    this.focus();
    apply(this.area, { from: this.area.selectionStart, to: this.area.selectionEnd, insert: text });
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const area = this.area;
    const { selectionStart: start, selectionEnd: end, value } = area;

    if (event.key === 'Enter' && !event.shiftKey && start === end) {
      const edit = enterInList(value, start);
      if (edit) {
        event.preventDefault();
        apply(area, edit);
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (start === end && !event.shiftKey) {
        apply(area, { from: start, to: end, insert: '\t' });
        return;
      }
      const block = indentLines(value, start, end, event.shiftKey);
      if (block) {
        apply(area, block.edit);
        area.setSelectionRange(block.selection[0], block.selection[1]);
      }
    }
  };
}

/** Applies an edit through `insertText`/`delete` so it lands in the undo history. */
function apply(area: HTMLTextAreaElement, edit: TextEdit): void {
  area.setSelectionRange(edit.from, edit.to);
  let done: boolean;
  if (edit.insert) done = document.execCommand('insertText', false, edit.insert);
  else done = edit.from === edit.to || document.execCommand('delete');
  if (!done) {
    area.setRangeText(edit.insert, edit.from, edit.to, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
