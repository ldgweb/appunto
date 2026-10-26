/** Small menus anchored to a toolbar button. One at a time. */

/** Minimum distance from the window edges, in CSS pixels. */
const MARGIN = 8;

interface OpenPopover {
  anchor: HTMLElement;
  close: () => void;
}

let current: OpenPopover | null = null;

export function isPopoverOpen(anchor: HTMLElement): boolean {
  return current?.anchor === anchor;
}

/** Opens `content` under `anchor`. A click outside or leaving the window
 *  closes it; Esc is handled by the caller through `closePopover`. */
export function openPopover(anchor: HTMLElement, content: HTMLElement, onClose?: () => void): void {
  closePopover();
  content.classList.add('popover');
  document.body.append(content);
  place(content, anchor);
  anchor.setAttribute('aria-expanded', 'true');

  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!content.contains(target) && !anchor.contains(target)) close();
  };
  const close = () => {
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    content.remove();
    anchor.setAttribute('aria-expanded', 'false');
    current = null;
    onClose?.();
  };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  current = { anchor, close };

  const first =
    content.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]') ??
    content.querySelector<HTMLElement>('button, input');
  first?.focus({ preventScroll: true });
}

/** Returns false when no popover was open. */
export function closePopover(): boolean {
  if (!current) return false;
  current.close();
  return true;
}

/** Keeps the popover inside the window, under its button when there is room. */
function place(element: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(box.left, window.innerWidth - element.offsetWidth - MARGIN));
  let top = box.bottom + 6;
  if (top + element.offsetHeight > window.innerHeight - MARGIN) {
    top = Math.max(MARGIN, window.innerHeight - element.offsetHeight - MARGIN);
  }
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
