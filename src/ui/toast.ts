/** One short message at the bottom of the board, with an optional action. */

import { byId, h } from './dom.ts';

export interface ToastAction {
  label: string;
  run: () => void;
}

let timer: number | undefined;

export function toast(message: string, action?: ToastAction, duration = 4500): void {
  const box = byId('toast');
  box.replaceChildren(h('span', {}, message));
  if (action) {
    const button = h('button', { type: 'button' }, action.label);
    // Like the toolbar: a click must not take the caret away from the text.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      hideToast();
      action.run();
    });
    box.append(button);
  }
  box.hidden = false;
  window.clearTimeout(timer);
  timer = window.setTimeout(hideToast, duration);
}

function hideToast(): void {
  window.clearTimeout(timer);
  byId('toast').hidden = true;
}
