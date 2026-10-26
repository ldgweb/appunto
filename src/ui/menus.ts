/** The two toolbar menus: font, size and color of the text; color and
 *  thickness of the chalk. */

import type { MessageKey, Translate } from '../lib/i18n.ts';
import { FONTS, fontStack, systemFontId, themeById } from '../lib/palette.ts';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, PEN_SIZES, type UiSettings } from '../lib/ui-settings.ts';
import { h } from './dom.ts';
import { closePopover, isPopoverOpen, openPopover } from './popover.ts';

export interface MenuHost {
  translate: () => Translate;
  ui: () => UiSettings;
  setUi: (patch: Partial<UiSettings>) => void;
  setFontSize: (size: number) => void;
  /** Switches to drawing with the pen, unless already there. */
  drawWithPen: () => void;
  hasDrawing: () => boolean;
  clearDrawing: () => void;
  listFonts: () => Promise<string[]>;
  /** A menu closed: give the focus back where it belongs. */
  onClose: () => void;
}

/** How many installed fonts the search shows at once. */
const MAX_FONT_RESULTS = 80;
const PEN_SIZE_NAMES: MessageKey[] = ['pen.thin', 'pen.medium', 'pen.thick'];

/** Installed fonts, read once from the system on first use. */
let installedFonts: string[] | null = null;

export function toggleFontMenu(anchor: HTMLElement, host: MenuHost): void {
  if (isPopoverOpen(anchor)) {
    closePopover();
    return;
  }
  const t = host.translate();
  const ui = host.ui();
  const content = h('div', { role: 'dialog', 'aria-label': t('tool.font') });

  const option = (id: string, name: string) => {
    const button = h(
      'button',
      { type: 'button', class: 'pop-option', role: 'option', 'aria-selected': String(ui.font === id) },
      name,
    );
    button.style.fontFamily = fontStack(id);
    button.addEventListener('click', () => {
      for (const other of content.querySelectorAll('[role="option"]')) {
        other.setAttribute('aria-selected', String(other === button));
      }
      host.setUi({ font: id });
    });
    return button;
  };

  const builtIn = h('div', { class: 'pop-list', role: 'listbox', 'aria-label': t('font.title') });
  for (const font of FONTS) builtIn.append(option(font.id, font.label));

  const search = h('input', {
    type: 'search',
    class: 'pop-search',
    placeholder: t('font.search'),
    'aria-label': t('font.search'),
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const results = h('div', { class: 'pop-list pop-scroll', role: 'listbox', 'aria-label': t('font.installed') });
  const installedBox = h('div', { hidden: true }, search, results);
  const showResults = () => {
    const query = search.value.trim().toLowerCase();
    const matches = (installedFonts ?? [])
      .filter((family) => family.toLowerCase().includes(query))
      .slice(0, MAX_FONT_RESULTS);
    const empty = h('div', { class: 'pop-note' }, installedFonts ? t('font.none') : t('font.loading'));
    results.replaceChildren(
      ...(matches.length > 0 ? matches.map((family) => option(systemFontId(family), family)) : [empty]),
    );
  };
  const installedToggle = h(
    'button',
    { type: 'button', class: 'pop-link', 'aria-expanded': 'false' },
    t('font.installed'),
  );
  installedToggle.addEventListener('click', async () => {
    const opening = installedBox.hidden;
    installedBox.hidden = !opening;
    installedToggle.setAttribute('aria-expanded', String(opening));
    if (!opening) return;
    search.focus();
    showResults();
    if (!installedFonts) {
      installedFonts = await host.listFonts().catch(() => []);
      showResults();
    }
  });
  search.addEventListener('input', showResults);

  const sizeValue = h('output', { class: 'pop-value' }, String(ui.fontSize));
  const slider = h('input', {
    type: 'range',
    min: FONT_SIZE_MIN,
    max: FONT_SIZE_MAX,
    step: 1,
    value: ui.fontSize,
    'aria-label': t('size.label'),
  });
  slider.addEventListener('input', () => {
    host.setFontSize(Number(slider.value));
    sizeValue.textContent = String(host.ui().fontSize);
  });

  content.append(
    builtIn,
    installedToggle,
    installedBox,
    h('div', { class: 'pop-sep' }),
    h('div', { class: 'pop-row' }, h('span', { class: 'pop-label' }, t('size.label')), slider, sizeValue),
    swatches(t, ui, ui.textColor, (slot) => host.setUi({ textColor: slot })),
  );
  openPopover(anchor, content, host.onClose);
}

export function togglePenMenu(anchor: HTMLElement, host: MenuHost): void {
  if (isPopoverOpen(anchor)) {
    closePopover();
    return;
  }
  const t = host.translate();
  const ui = host.ui();

  const sizes = h('div', { class: 'sizes', role: 'radiogroup', 'aria-label': t('pen.size') });
  PEN_SIZES.forEach((size, index) => {
    const name = t(PEN_SIZE_NAMES[index] ?? 'pen.medium');
    const dot = h('span', { class: 'size-dot' });
    dot.style.setProperty('--d', `${size + 2}px`);
    const button = h(
      'button',
      {
        type: 'button',
        class: 'size-option',
        role: 'radio',
        'aria-checked': String(ui.penSize === size),
        'aria-label': name,
        title: name,
      },
      dot,
    );
    button.addEventListener('click', () => {
      for (const other of sizes.children) other.setAttribute('aria-checked', String(other === button));
      host.setUi({ penSize: size });
      host.drawWithPen();
    });
    sizes.append(button);
  });

  const clear = h('button', { type: 'button', class: 'pop-link' }, t('pen.clear'));
  clear.disabled = !host.hasDrawing();
  clear.addEventListener('click', () => {
    closePopover();
    host.clearDrawing();
  });

  const colors = swatches(t, ui, ui.penColor, (slot) => {
    host.setUi({ penColor: slot });
    host.drawWithPen();
  });
  const content = h(
    'div',
    { role: 'dialog', 'aria-label': t('tool.penStyle') },
    colors,
    sizes,
    h('div', { class: 'pop-sep' }),
    clear,
  );
  openPopover(anchor, content, host.onClose);
}

/** The six colors of the current theme, as a radio group. */
function swatches(t: Translate, ui: UiSettings, selected: number, onPick: (slot: number) => void): HTMLElement {
  const theme = themeById(ui.theme);
  const group = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('color.label') });
  theme.palette.forEach((color, slot) => {
    const name = t(`color.${theme.colorNames[slot] ?? 'white'}` as MessageKey);
    const button = h('button', {
      type: 'button',
      class: 'swatch',
      role: 'radio',
      'aria-checked': String(slot === selected),
      'aria-label': name,
      title: name,
    });
    button.style.setProperty('--c', color);
    button.addEventListener('click', () => {
      for (const other of group.children) other.setAttribute('aria-checked', String(other === button));
      onPick(slot);
    });
    group.append(button);
  });
  return group;
}
