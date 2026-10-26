/** The settings sheet that covers the board. Rebuilt from state on every
 *  change: it is small, and this keeps it always in sync with the tray. */

import type { MessageKey, Translate } from '../lib/i18n.ts';
import { THEMES } from '../lib/palette.ts';
import { appShortcut, defaultShortcut, formatShortcut, recordShortcut, type Platform } from '../lib/shortcut.ts';
import type { UiSettings } from '../lib/ui-settings.ts';
import type { NativeState, SettingsPatch } from '../native.ts';
import { h } from './dom.ts';

export interface PanelHost {
  translate: () => Translate;
  platform: () => Platform;
  version: () => string;
  wayland: () => boolean;
  native: () => NativeState;
  ui: () => UiSettings;
  /** Changes the look and feel; the host refreshes the panel. */
  setUi: (patch: Partial<UiSettings>) => void;
  /** Resolves to an error code, or null when the change was applied. */
  updateNative: (patch: SettingsPatch) => Promise<string | null>;
  pauseShortcut: (paused: boolean) => Promise<void>;
  newBoard: () => void;
  openDataDir: () => void;
  openProjectPage: () => void;
  quit: () => void;
  onToggle: (open: boolean) => void;
}

export class SettingsPanel {
  private element: HTMLElement | null = null;
  private recording = false;
  private shortcutNote = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly host: PanelHost,
  ) {}

  get isOpen(): boolean {
    return this.element !== null;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  open(): void {
    if (this.element) return;
    this.shortcutNote = '';
    const panel = this.render();
    this.host.onToggle(true);
    panel.querySelector<HTMLElement>('[data-key="shortcut"]')?.focus({ preventScroll: true });
  }

  /** Returns false when the panel was already closed. */
  close(): boolean {
    if (!this.element) return false;
    this.stopRecording(true);
    this.element.remove();
    this.element = null;
    this.host.onToggle(false);
    return true;
  }

  toggle(): void {
    if (!this.close()) this.open();
  }

  refresh(): void {
    if (this.element) this.render();
  }

  private render(): HTMLElement {
    const focusedKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    const scrollTop = this.element?.scrollTop ?? 0;
    const panel = this.build();
    if (this.element) this.element.replaceWith(panel);
    else this.container.append(panel);
    this.element = panel;
    panel.scrollTop = scrollTop;
    if (focusedKey) panel.querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
    return panel;
  }

  private build(): HTMLElement {
    const t = this.host.translate();
    const state = this.host.native();
    const ui = this.host.ui();
    const platform = this.host.platform();

    const closeButton = h('button', { type: 'button', class: 'btn quiet', 'data-key': 'close' }, t('settings.close'));
    closeButton.addEventListener('click', () => this.close());

    return h(
      'section',
      { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') },
      h('header', { class: 'panel-head' }, h('h1', {}, t('settings.title')), closeButton),
      this.shortcutSection(t, state, platform),
      h('h2', {}, t('settings.section.startup')),
      switchRow(
        'autostart',
        t('settings.autostart'),
        state.autostart,
        (on) => this.host.updateNative({ autostart: on }),
        !state.autostartAvailable,
      ),
      !state.autostartAvailable && h('p', { class: 'note' }, t('settings.autostartUnavailable')),
      switchRow('start-hidden', t('settings.startHidden'), state.settings.startHidden, (on) =>
        this.host.updateNative({ startHidden: on }),
      ),
      h('h2', {}, t('settings.section.board')),
      this.themeRow(t, ui),
      switchRow('esc-hides', t('settings.escHides'), ui.escHides, (on) => this.host.setUi({ escHides: on })),
      switchRow('spellcheck', t('settings.spellcheck'), ui.spellcheck, (on) => this.host.setUi({ spellcheck: on })),
      this.languageRow(t, state),
      this.boardActions(t),
      h('h2', {}, t('settings.section.keys')),
      keyList(t, state, platform, ui.escHides),
      h('h2', {}, t('settings.section.about')),
      this.about(t),
    );
  }

  private shortcutSection(t: Translate, state: NativeState, platform: Platform): DocumentFragment {
    const current = formatShortcut(state.settings.shortcut, platform);
    const keyButton = h(
      'button',
      {
        type: 'button',
        class: `key-btn${this.recording ? ' recording' : ''}`,
        title: t('settings.shortcutChange'),
        'data-key': 'shortcut',
      },
      this.recording ? t('settings.shortcutRecord') : current,
    );
    keyButton.addEventListener('click', () => (this.recording ? this.cancelRecording() : this.startRecording()));

    const note = this.shortcutNote || shortcutErrorNote(t, state.shortcutError);

    const fragment = document.createDocumentFragment();
    fragment.append(
      h('h2', {}, t('settings.section.shortcut')),
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, t('settings.shortcutHelp')), keyButton),
    );
    if (note) fragment.append(h('p', { class: 'note warn', role: 'alert' }, note));
    const fallback = defaultShortcut(platform);
    if (state.settings.shortcut !== fallback) {
      const reset = h(
        'button',
        { type: 'button', class: 'link', 'data-key': 'shortcut-reset' },
        t('settings.shortcutReset', { shortcut: formatShortcut(fallback, platform) }),
      );
      reset.addEventListener('click', () => void this.applyShortcut(fallback));
      fragment.append(reset);
    }
    if (this.host.wayland()) fragment.append(h('p', { class: 'note' }, t('settings.shortcutWayland')));
    return fragment;
  }

  private themeRow(t: Translate, ui: UiSettings): HTMLElement {
    const group = h('div', { class: 'themes', role: 'radiogroup', 'aria-label': t('settings.theme') });
    for (const theme of THEMES) {
      const name = t(`theme.${theme.id}` as MessageKey);
      const button = h('button', {
        type: 'button',
        class: 'theme-swatch',
        role: 'radio',
        'aria-checked': String(ui.theme === theme.id),
        'aria-label': name,
        title: name,
        'data-key': `theme-${theme.id}`,
      });
      button.style.setProperty('--c', theme.background);
      button.addEventListener('click', () => this.host.setUi({ theme: theme.id }));
      group.append(button);
    }
    return h('div', { class: 'row' }, h('span', { class: 'row-label' }, t('settings.theme')), group);
  }

  private languageRow(t: Translate, state: NativeState): HTMLElement {
    const select = h(
      'select',
      { class: 'select', 'data-key': 'language', 'aria-label': t('settings.language') },
      h('option', { value: 'auto' }, t('settings.languageAuto')),
      h('option', { value: 'en' }, 'English'),
      h('option', { value: 'it' }, 'Italiano'),
    );
    select.value = state.settings.language;
    select.addEventListener('change', () => void this.host.updateNative({ language: select.value }));
    return h('label', { class: 'row' }, h('span', { class: 'row-label' }, t('settings.language')), select);
  }

  private boardActions(t: Translate): HTMLElement {
    const fresh = h('button', { type: 'button', class: 'btn', 'data-key': 'new-board' }, t('settings.newBoard'));
    fresh.addEventListener('click', () => this.host.newBoard());
    const folder = h(
      'button',
      { type: 'button', class: 'btn quiet', 'data-key': 'open-folder' },
      t('settings.openFolder'),
    );
    folder.addEventListener('click', () => this.host.openDataDir());
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'actions' }, fresh, folder),
      h('p', { class: 'note' }, t('settings.newBoardHelp')),
    );
  }

  private about(t: Translate): HTMLElement {
    const project = h('button', { type: 'button', class: 'link', 'data-key': 'project' }, t('settings.project'));
    project.addEventListener('click', () => this.host.openProjectPage());
    const quit = h('button', { type: 'button', class: 'btn quiet', 'data-key': 'quit' }, t('settings.quit'));
    quit.addEventListener('click', () => this.host.quit());
    return h(
      'div',
      { class: 'stack' },
      h('p', { class: 'note' }, t('settings.version', { version: this.host.version() }), ' · ', project),
      h('div', { class: 'actions' }, quit),
    );
  }

  private startRecording(): void {
    if (this.recording) return;
    this.recording = true;
    this.shortcutNote = '';
    void this.host.pauseShortcut(true);
    window.addEventListener('keydown', this.onRecordKey, true);
    window.addEventListener('blur', this.onRecordBlur);
    this.render();
  }

  private cancelRecording(): void {
    this.stopRecording(true);
    this.render();
  }

  private stopRecording(resume: boolean): void {
    if (!this.recording) return;
    this.recording = false;
    window.removeEventListener('keydown', this.onRecordKey, true);
    window.removeEventListener('blur', this.onRecordBlur);
    if (resume) void this.host.pauseShortcut(false);
  }

  private readonly onRecordBlur = () => this.cancelRecording();

  private readonly onRecordKey = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const t = this.host.translate();
    const result = recordShortcut(event);
    if (result.kind === 'pending') {
      const button = this.element?.querySelector('[data-key="shortcut"]');
      if (button) {
        button.textContent = result.modifiers
          ? `${formatShortcut(result.modifiers, this.host.platform())}…`
          : t('settings.shortcutRecord');
      }
    } else if (result.kind === 'cancel') {
      this.cancelRecording();
    } else if (result.kind === 'invalid') {
      const system = formatShortcut('Super', this.host.platform());
      this.shortcutNote =
        result.reason === 'needs-modifier'
          ? t('settings.shortcutNeedsModifier', { system })
          : t('settings.shortcutUnsupported');
      this.render();
    } else {
      this.stopRecording(false);
      void this.applyShortcut(result.accelerator);
    }
  };

  private async applyShortcut(accelerator: string): Promise<void> {
    const error = await this.host.updateNative({ shortcut: accelerator });
    // Whatever happened, make sure a shortcut is registered again.
    await this.host.pauseShortcut(false);
    this.shortcutNote = shortcutErrorNote(this.host.translate(), error);
    this.render();
  }
}

/** The message for a shortcut error code from the native side. */
function shortcutErrorNote(t: Translate, error: string | null): string {
  if (error === null) return '';
  return error === 'in-use' ? t('settings.shortcutInUse') : t('settings.shortcutInvalid');
}

function switchRow(
  key: string,
  label: string,
  checked: boolean,
  onToggle: (next: boolean) => unknown,
  disabled = false,
): HTMLElement {
  const button = h(
    'button',
    { type: 'button', class: 'row row-button', role: 'switch', 'aria-checked': String(checked), 'data-key': key },
    h('span', { class: 'row-label' }, label),
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
  );
  button.disabled = disabled;
  button.addEventListener('click', () => void onToggle(!checked));
  return button;
}

function keyList(t: Translate, state: NativeState, platform: Platform, escHides: boolean): HTMLElement {
  const rows: Array<[string, string]> = [
    [formatShortcut(state.settings.shortcut, platform), t('keys.toggle')],
    [appShortcut('D', platform), t('keys.draw')],
    [appShortcut('E', platform), t('keys.eraser')],
    [`${appShortcut('Z', platform)}  ${appShortcut('Z', platform, true)}`, t('keys.undoInk')],
    [`${appShortcut('+', platform)}  ${appShortcut('-', platform)}  ${appShortcut('0', platform)}`, t('keys.size')],
    ['F5', t('keys.stamp')],
    [appShortcut('T', platform), t('keys.scratch')],
  ];
  if (escHides) rows.push(['Esc', t('keys.hide')]);
  const list = h('dl', { class: 'keys' });
  for (const [keys, label] of rows) list.append(h('dt', {}, h('kbd', {}, keys)), h('dd', {}, label));
  return list;
}
