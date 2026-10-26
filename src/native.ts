/** Typed bridge to the native side (src-tauri/src/commands.rs). */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Platform } from './lib/shortcut.ts';

export interface NativeSettings {
  shortcut: string;
  alwaysOnTop: boolean;
  startHidden: boolean;
  language: 'auto' | 'en' | 'it';
  ui: unknown;
}

export type ShortcutError = 'invalid' | 'in-use';

export interface NativeState {
  settings: NativeSettings;
  autostart: boolean;
  /** False for copies that must not change launch at login: development
   *  builds, custom data folders, temporary locations. */
  autostartAvailable: boolean;
  shortcutError: ShortcutError | null;
}

export interface Bootstrap {
  native: NativeState;
  board: string | null;
  /** The saved board exists but could not be read; nothing may be saved over it. */
  boardError: string | null;
  firstRun: boolean;
  systemLocale: string;
  platform: Platform;
  version: string;
  wayland: boolean;
}

export interface SettingsPatch {
  shortcut?: string;
  alwaysOnTop?: boolean;
  startHidden?: boolean;
  language?: string;
  ui?: unknown;
  autostart?: boolean;
}

export const native = {
  bootstrap: () => invoke<Bootstrap>('bootstrap'),
  ready: () => invoke<void>('app_ready'),
  saveBoard: (data: string) => invoke<void>('save_board', { data }),
  archiveBoard: (data: string, stamp: string) => invoke<void>('archive_board', { data, stamp }),
  updateSettings: (patch: SettingsPatch) => invoke<NativeState>('update_settings', { patch }),
  pauseShortcut: (paused: boolean) => invoke<NativeState>('pause_shortcut', { paused }),
  listFonts: () => invoke<string[]>('list_fonts'),
  hide: () => invoke<void>('hide_window'),
  openDataDir: () => invoke<void>('open_data_dir'),
  openProjectPage: () => invoke<void>('open_project_page'),
  quit: () => invoke<void>('quit_app'),
};

/** `shown` and `hiding` follow the window; `quit` asks the page to save and quit. */
export function onNative(event: 'shown' | 'hiding' | 'quit', handler: () => void): Promise<UnlistenFn> {
  return listen(`board://${event}`, () => handler());
}

/** Settings changed outside the page, from the tray menu. */
export function onNativeState(handler: (state: NativeState) => void): Promise<UnlistenFn> {
  return listen<NativeState>('board://native', (event) => handler(event.payload));
}
