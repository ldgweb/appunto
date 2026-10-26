import './fonts.css';
import './styles.css';

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AutoSave, type SaveStatus } from './lib/autosave.ts';
import { emptyBoard, parseBoard, serializeBoard, type Board } from './lib/board.ts';
import { resolveLang, translator, type Lang, type MessageKey, type Translate } from './lib/i18n.ts';
import { fontStack, themeById } from './lib/palette.ts';
import { appShortcut, formatShortcut, type Platform } from './lib/shortcut.ts';
import { fileStamp, noteStamp } from './lib/stamp.ts';
import { clampFontSize, FONT_SIZE_DEFAULT, FONT_SIZE_STEP, normalizeUi, type UiSettings } from './lib/ui-settings.ts';
import { native, onNative, onNativeState, type Bootstrap, type NativeState, type SettingsPatch } from './native.ts';
import { byId } from './ui/dom.ts';
import { Editor } from './ui/editor.ts';
import { Ink, type InkTool } from './ui/ink.ts';
import { toggleFontMenu, togglePenMenu, type MenuHost } from './ui/menus.ts';
import { closePopover } from './ui/popover.ts';
import { SettingsPanel } from './ui/settings-panel.ts';
import { toast } from './ui/toast.ts';

type Mode = 'text' | 'draw';
/** The board, or the scratch pad: a page that lives only in memory. */
type Page = 'board' | 'scratch';

/** Pause after the last look-and-feel change before it is saved. */
const UI_SAVE_DELAY_MS = 400;
/** How long the first paint waits for the board font. */
const FONT_WAIT_MS = 400;
/** Space kept below the lowest stroke, so it never sits at the very bottom. */
const INK_ROOM_PX = 64;

const els = {
  app: byId('app'),
  board: byId('board'),
  text: byId<HTMLTextAreaElement>('text'),
  scratch: byId<HTMLTextAreaElement>('scratch'),
  ink: byId<HTMLCanvasElement>('ink'),
  live: byId<HTMLCanvasElement>('live'),
  saveDot: byId('save-dot'),
  pen: byId<HTMLButtonElement>('tool-pen'),
  eraser: byId<HTMLButtonElement>('tool-eraser'),
  penStyle: byId<HTMLButtonElement>('tool-pen-style'),
  font: byId<HTMLButtonElement>('tool-font'),
  smaller: byId<HTMLButtonElement>('tool-smaller'),
  size: byId('size'),
  larger: byId<HTMLButtonElement>('tool-larger'),
  scratchTool: byId<HTMLButtonElement>('tool-scratch'),
  pin: byId<HTMLButtonElement>('tool-pin'),
  settings: byId<HTMLButtonElement>('tool-settings'),
  hide: byId<HTMLButtonElement>('tool-hide'),
};

let boot: Bootstrap;
let nativeState: NativeState;
let ui: UiSettings = normalizeUi(null);
let lang: Lang = 'en';
let t: Translate = translator('en');
let platform: Platform = 'windows';
let mode: Mode = 'text';
let page: Page = 'board';
let saveStatus: SaveStatus = 'saved';
let saveErrorShown = false;
/** Why nothing is saved in this session, when that is the case. */
let blockedMessage = '';
let boardLoaded = false;
let appliedBackground = '';
let uiTimer: number | undefined;
let roomFrame = 0;

const editor = new Editor(els.text, () => {
  autosave.touch();
  if (ink.all.length > 0) scheduleInkRoom();
});
const ink = new Ink(els.ink, els.live, els.text, () => {
  autosave.touch();
  scheduleInkRoom();
});
// Never saved: nothing listens to its changes.
const scratch = new Editor(els.scratch, () => {});
const autosave = new AutoSave(() => native.saveBoard(serializeBoard(currentBoard())), showSaveStatus);

const panel = new SettingsPanel(els.board, {
  translate: () => t,
  platform: () => platform,
  version: () => boot.version,
  wayland: () => boot.wayland,
  native: () => nativeState,
  ui: () => ui,
  setUi,
  updateNative,
  pauseShortcut: async (paused) => {
    try {
      nativeState = await native.pauseShortcut(paused);
    } catch {
      // The panel keeps showing the last known state.
    }
  },
  newBoard: () => void newBoard(),
  openDataDir: () => void native.openDataDir().catch(() => {}),
  openProjectPage: () => void native.openProjectPage().catch(() => {}),
  quit: () => void quit(),
  onToggle: (open) => {
    els.settings.setAttribute('aria-pressed', String(open));
    if (!open && mode === 'text') activeEditor().focus();
  },
});

const menus: MenuHost = {
  translate: () => t,
  ui: () => ui,
  setUi,
  setFontSize,
  drawWithPen: () => {
    if (mode !== 'draw' || ink.tool !== 'pen') setMode('draw', 'pen');
  },
  hasDrawing: () => ink.all.length > 0,
  clearDrawing,
  listFonts: () => native.listFonts(),
  onClose: () => {
    if (mode === 'text' && !panel.isOpen && document.activeElement === document.body) activeEditor().focus();
  },
};

function currentBoard(): Board {
  return { text: editor.text, strokes: [...ink.all] };
}

/** The text on screen: the board's, or the scratch pad's. */
function activeEditor(): Editor {
  return page === 'scratch' ? scratch : editor;
}

// ---------------------------------------------------------------------------
// Look and feel

function setUi(patch: Partial<UiSettings>): void {
  ui = { ...ui, ...patch };
  applyUi();
  window.clearTimeout(uiTimer);
  uiTimer = window.setTimeout(() => void saveUi(), UI_SAVE_DELAY_MS);
  panel.refresh();
}

async function saveUi(): Promise<void> {
  window.clearTimeout(uiTimer);
  uiTimer = undefined;
  try {
    // The page owns `ui`, so the reply is not applied back: a slow answer
    // must not undo a newer change.
    await native.updateSettings({ ui });
  } catch {
    // Still in memory; saved again with the next change.
  }
}

function applyUi(): void {
  const theme = themeById(ui.theme);
  const root = document.documentElement;
  root.dataset.theme = theme.dark ? 'dark' : 'light';
  root.style.setProperty('--board', theme.background);
  root.style.setProperty('--chalk', theme.palette[ui.textColor] ?? theme.palette[0]);
  root.style.setProperty('--pen', theme.palette[ui.penColor] ?? theme.palette[0]);
  root.style.setProperty('--font', fontStack(ui.font));
  root.style.setProperty('--size', `${ui.fontSize}px`);
  els.text.spellcheck = ui.spellcheck;
  els.scratch.spellcheck = ui.spellcheck;
  els.size.textContent = String(ui.fontSize);
  labelHide();
  ink.setPalette(theme.palette);
  ink.color = ui.penColor;
  ink.size = ui.penSize;
  if (theme.background !== appliedBackground) {
    appliedBackground = theme.background;
    // Matches the window to the board, so resizing never flashes another color.
    void getCurrentWebviewWindow()
      .setBackgroundColor(theme.background)
      .catch(() => {});
  }
  scheduleInkRoom();
}

function setFontSize(size: number): void {
  const next = clampFontSize(size);
  if (next !== ui.fontSize) setUi({ fontSize: next });
}

function applyLanguage(): void {
  lang = resolveLang(nativeState.settings.language, boot.systemLocale);
  t = translator(lang);
  document.documentElement.lang = lang;
  label(els.pen, t('tool.pen', { key: appShortcut('D', platform) }));
  label(els.eraser, t('tool.eraser', { key: appShortcut('E', platform) }));
  label(els.penStyle, t('tool.penStyle'));
  label(els.font, t('tool.font'));
  label(els.smaller, t('tool.smaller', { key: appShortcut('-', platform) }));
  label(els.larger, t('tool.larger', { key: appShortcut('+', platform) }));
  els.size.title = t('tool.size');
  label(els.scratchTool, t('tool.scratch', { key: appShortcut('T', platform) }));
  label(els.pin, t('tool.pin'));
  label(els.settings, t('tool.settings', { key: appShortcut(',', platform) }));
  labelHide();
  els.text.placeholder = t('board.placeholder', { draw: appShortcut('D', platform) });
  els.text.setAttribute('aria-label', t('board.label'));
  els.scratch.placeholder = t('scratch.placeholder', { key: appShortcut('T', platform) });
  els.scratch.setAttribute('aria-label', t('save.scratch'));
  showSaveStatus(saveStatus);
  panel.refresh();
}

function label(element: HTMLElement, text: string): void {
  element.title = text;
  element.setAttribute('aria-label', text);
}

/** The hide button mentions Esc only while Esc hides the board. */
function labelHide(): void {
  label(els.hide, ui.escHides ? `${t('tool.hide')} (Esc)` : t('tool.hide'));
}

// ---------------------------------------------------------------------------
// Native settings

/** Resolves to an error code, or null when the change was applied. */
async function updateNative(patch: SettingsPatch): Promise<string | null> {
  try {
    applyNativeState(await native.updateSettings(patch));
    return null;
  } catch (error) {
    applyNativeState(nativeState);
    return typeof error === 'string' ? error : String(error);
  }
}

function applyNativeState(next: NativeState): void {
  const languageChanged = next.settings.language !== nativeState.settings.language;
  nativeState = next;
  els.pin.setAttribute('aria-pressed', String(next.settings.alwaysOnTop));
  if (languageChanged) applyLanguage();
  panel.refresh();
}

// ---------------------------------------------------------------------------
// Saving

function showSaveStatus(status: SaveStatus): void {
  saveStatus = status;
  // On the scratch pad the dot says that nothing there is saved.
  els.saveDot.dataset.state = page === 'scratch' ? 'scratch' : status;
  label(els.saveDot, t(page === 'scratch' ? 'save.scratch' : (`save.${status}` as MessageKey)));
  if (status === 'failed' && !saveErrorShown) {
    saveErrorShown = true;
    toast(t('toast.saveFailed'));
  } else if (status === 'saved') {
    saveErrorShown = false;
  }
}

async function saveEverything(): Promise<void> {
  await Promise.allSettled([autosave.flush(), uiTimer === undefined ? Promise.resolve() : saveUi()]);
}

/** Stops saving for this session and says why. */
function blockSaving(message: string): void {
  blockedMessage = message;
  autosave.block();
  toast(message, undefined, 30000);
}

/** Ctrl+S: there is no save button, but the habit deserves an answer. */
async function saveNow(): Promise<void> {
  if (page === 'scratch') {
    toast(t('toast.scratchNotSaved', { key: appShortcut('T', platform) }));
    return;
  }
  await autosave.flush();
  if (saveStatus === 'saved') toast(t('toast.saved'), undefined, 1500);
  else if (saveStatus === 'failed') toast(t('toast.saveFailed'));
  else if (saveStatus === 'blocked') toast(blockedMessage, undefined, 30000);
}

// ---------------------------------------------------------------------------
// Writing and drawing

function setMode(next: Mode, tool: InkTool = ink.tool): void {
  mode = next;
  ink.setTool(tool);
  const drawing = next === 'draw';
  els.app.classList.toggle('drawing', drawing);
  els.app.classList.toggle('erasing', drawing && tool === 'eraser');
  els.pen.setAttribute('aria-pressed', String(drawing && tool === 'pen'));
  els.eraser.setAttribute('aria-pressed', String(drawing && tool === 'eraser'));
  if (drawing) {
    // Keys typed while drawing switch back to text (see onKeyDown).
    if (document.activeElement === els.text) els.text.blur();
  } else {
    editor.focus();
  }
}

/** Pressing the active tool again goes back to writing. */
function toggleTool(tool: InkTool): void {
  if (page === 'scratch') return;
  if (mode === 'draw' && ink.tool === tool) setMode('text');
  else setMode('draw', tool);
}

/** Switches between the board and the scratch pad. The scratch pad keeps
 *  its text while the app runs and never writes it anywhere. */
function setPage(next: Page): void {
  if (next === page) return;
  closePopover();
  if (mode === 'draw') setMode('text');
  page = next;
  const onScratch = next === 'scratch';
  els.app.classList.toggle('on-scratch', onScratch);
  els.scratchTool.setAttribute('aria-pressed', String(onScratch));
  for (const tool of [els.pen, els.eraser, els.penStyle]) tool.disabled = onScratch;
  showSaveStatus(saveStatus);
  activeEditor().focus();
}

function scheduleInkRoom(): void {
  if (roomFrame) return;
  roomFrame = requestAnimationFrame(() => {
    roomFrame = 0;
    updateInkRoom();
  });
}

/** Keeps room below the text for strokes drawn past its end, so they stay
 *  reachable by scrolling. Measures the text with the textarea collapsed. */
function updateInkRoom(): void {
  const area = els.text;
  const bottom = ink.bottom;
  if (bottom <= 0) {
    area.style.paddingBottom = '';
    return;
  }
  const scrollTop = area.scrollTop;
  area.style.paddingBottom = '';
  area.style.height = '0px';
  const textHeight = area.scrollHeight;
  area.style.height = '';
  const basePadding = Number.parseFloat(getComputedStyle(area).paddingBottom) || 0;
  const needed = bottom + INK_ROOM_PX - (textHeight - basePadding);
  if (needed > basePadding) area.style.paddingBottom = `${Math.ceil(needed)}px`;
  area.scrollTop = scrollTop;
}

// ---------------------------------------------------------------------------
// Actions

function hideBoard(): void {
  closePopover();
  panel.close();
  void saveEverything();
  void native.hide();
}

async function quit(): Promise<void> {
  await saveEverything();
  await native.quit();
}

function insertStamp(): void {
  closePopover();
  if (mode !== 'text') setMode('text');
  activeEditor().insert(noteStamp(new Date(), lang === 'it' ? 'it-IT' : undefined));
}

function clearDrawing(): void {
  const restore = ink.clear();
  if (restore) toast(t('toast.drawingCleared'), { label: t('toast.undo'), run: restore });
}

function isEmpty(board: Board): boolean {
  return !board.text.trim() && board.strokes.length === 0;
}

function showBoard(board: Board): void {
  editor.text = board.text;
  ink.load(board.strokes);
  scheduleInkRoom();
}

/** Puts `next` on the board. The current board goes to the archive first,
 *  unless it is empty; returns false when it could not be archived. */
async function replaceBoard(next: Board): Promise<boolean> {
  const current = currentBoard();
  if (!isEmpty(current)) {
    try {
      await autosave.flush();
      await native.archiveBoard(serializeBoard(current), fileStamp(new Date()));
    } catch {
      toast(t('toast.archiveFailed'));
      return false;
    }
  }
  showBoard(next);
  autosave.touch();
  return true;
}

/** Clears the board, keeping it in the archive. The toast can bring it back,
 *  and anything written in the meantime is archived too. */
async function newBoard(): Promise<void> {
  panel.close();
  const before = currentBoard();
  if (isEmpty(before) || !(await replaceBoard(emptyBoard()))) return;
  setMode('text');
  toast(t('toast.boardCleared'), { label: t('toast.undo'), run: () => void replaceBoard(before) });
}

// ---------------------------------------------------------------------------
// Keys and events

function onKeyDown(event: KeyboardEvent): void {
  if (panel.isRecording || event.defaultPrevented) return;
  const mod = platform === 'macos' ? event.metaKey : event.ctrlKey;
  const key = event.key;

  if (key === 'Escape') {
    if (closePopover() || panel.close() || ink.busy) {
      event.preventDefault();
    } else if (ui.escHides) {
      event.preventDefault();
      hideBoard();
    }
    return;
  }
  if (key === 'F5') {
    event.preventDefault();
    if (!panel.isOpen) insertStamp();
    return;
  }

  if (mod && !event.altKey) {
    const action = shortcutAction(key, event.shiftKey);
    if (action) {
      event.preventDefault();
      action();
    }
    return;
  }

  // Typing while drawing goes back to the text, and the key lands there.
  const typing = key.length === 1 || key === 'Enter';
  const focusFree = document.activeElement === document.body || document.activeElement === null;
  if (mode === 'draw' && typing && focusFree && !event.altKey && !event.isComposing) setMode('text');
}

/** What Ctrl (⌘ on macOS) with `key` does, if anything. */
function shortcutAction(key: string, shift: boolean): (() => void) | null {
  const lower = key.toLowerCase();
  // Keys that act on the board wait while Settings covers it.
  const onBoard = (action: () => void) => () => {
    if (!panel.isOpen) action();
  };
  if (lower === 'd') return onBoard(() => toggleTool('pen'));
  if (lower === 'e') return onBoard(() => toggleTool('eraser'));
  if (lower === 't') return onBoard(() => setPage(page === 'board' ? 'scratch' : 'board'));
  if (key === '+' || key === '=') return () => setFontSize(ui.fontSize + FONT_SIZE_STEP);
  if (key === '-' || key === '_') return () => setFontSize(ui.fontSize - FONT_SIZE_STEP);
  if (key === '0') return () => setFontSize(FONT_SIZE_DEFAULT);
  if (key === ',') {
    return () => {
      closePopover();
      panel.toggle();
    };
  }
  if (lower === 's') return () => void saveNow();
  if (lower === 'w' && platform === 'macos') return hideBoard;
  if (mode === 'draw' && lower === 'z') return onBoard(() => (shift ? ink.redo() : ink.undo()));
  if (mode === 'draw' && lower === 'y') return onBoard(() => ink.redo());
  // Browser features that make no sense on a board: reload, print, find.
  if (['r', 'p', 'f', 'g', 'j', 'u'].includes(lower)) return () => {};
  return null;
}

function wireToolbar(): void {
  // Toolbar clicks must not take the caret away from the text.
  for (const button of document.querySelectorAll<HTMLButtonElement>('.bar button')) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
  }
  els.pen.addEventListener('click', () => toggleTool('pen'));
  els.eraser.addEventListener('click', () => toggleTool('eraser'));
  els.penStyle.addEventListener('click', () => togglePenMenu(els.penStyle, menus));
  els.font.addEventListener('click', () => toggleFontMenu(els.font, menus));
  els.scratchTool.addEventListener('click', () => {
    panel.close();
    setPage(page === 'board' ? 'scratch' : 'board');
  });
  els.smaller.addEventListener('click', () => setFontSize(ui.fontSize - FONT_SIZE_STEP));
  els.larger.addEventListener('click', () => setFontSize(ui.fontSize + FONT_SIZE_STEP));
  els.pin.addEventListener('click', () => void updateNative({ alwaysOnTop: !nativeState.settings.alwaysOnTop }));
  els.settings.addEventListener('click', () => {
    closePopover();
    panel.toggle();
  });
  els.hide.addEventListener('click', hideBoard);
}

function wireBoard(): void {
  els.text.addEventListener('scroll', () => ink.scrolled(), { passive: true });

  new ResizeObserver(() => {
    ink.resize(els.board.clientWidth, els.board.clientHeight);
    scheduleInkRoom();
  }).observe(els.board);
  watchPixelRatio();

  // Ctrl+wheel (or a pinch on a touchpad) changes the text size.
  els.board.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setFontSize(ui.fontSize + (event.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
  // While drawing, the wheel still scrolls the text underneath.
  els.live.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      els.text.scrollTop += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    },
    { passive: false },
  );

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', () => void saveEverything());

  // The native context menu only where it helps: cut, copy, paste, spelling.
  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) event.preventDefault();
  });
  // Text can be dropped into the text. Anything else (a file, or a link
  // dropped on the toolbar or the drawing) would make the page navigate away.
  const blockDrop = (event: DragEvent) => {
    const onText = event.target === els.text || event.target === els.scratch;
    if (onText && !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  window.addEventListener('dragover', blockDrop);
  window.addEventListener('drop', blockDrop);
}

/** Redraws the strokes sharply when the window moves to a screen with another scale. */
function watchPixelRatio(): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener(
    'change',
    () => {
      ink.resize(els.board.clientWidth, els.board.clientHeight);
      watchPixelRatio();
    },
    { once: true },
  );
}

async function wireNative(): Promise<void> {
  await Promise.all([
    onNative('shown', () => {
      if (mode === 'text' && !panel.isOpen) activeEditor().focus();
    }),
    onNative('hiding', () => {
      // Next time the board shows up ready for typing.
      closePopover();
      panel.close();
      void saveEverything();
    }),
    onNative('quit', () => void quit()),
    onNativeState(applyNativeState),
  ]);
}

// ---------------------------------------------------------------------------
// Startup

function welcomeBoard(): Board {
  const text = t('welcome', {
    toggle: formatShortcut(nativeState.settings.shortcut, platform),
    draw: appShortcut('D', platform),
    erase: appShortcut('E', platform),
    larger: appShortcut('+', platform),
    smaller: appShortcut('-', platform),
    scratch: appShortcut('T', platform),
  });
  return { text, strokes: [] };
}

/** Waits briefly for the board font, so the first paint uses it. */
async function fontsReady(): Promise<void> {
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, FONT_WAIT_MS));
  const load = document.fonts.load(`${ui.fontSize}px ${fontStack(ui.font)}`).then(() => undefined);
  await Promise.race([load.catch(() => undefined), timeout]);
}

async function start(): Promise<void> {
  boot = await native.bootstrap();
  platform = boot.platform;
  nativeState = boot.native;
  ui = normalizeUi(nativeState.settings.ui);

  applyUi();
  applyLanguage();
  applyNativeState(nativeState);
  wireToolbar();
  wireBoard();
  await wireNative();

  const saved = parseBoard(boot.board);
  // A board on disk that can't be read, or isn't a board this version knows,
  // stays as it is: nothing is saved over it.
  const problem = boot.boardError ?? (boot.board !== null && !saved ? 'unknown format' : null);
  const board = saved ?? (boot.firstRun && !problem ? welcomeBoard() : emptyBoard());
  showBoard(board);
  boardLoaded = true;
  if (problem) {
    blockSaving(t('toast.boardUnreadable', { error: problem }));
  } else {
    autosave.start();
    if (!saved && board.text) autosave.touch();
  }

  ink.resize(els.board.clientWidth, els.board.clientHeight);
  await fontsReady();
  updateInkRoom();
  editor.focus();
  document.documentElement.dataset.ready = 'true';
  await native.ready();

  if (nativeState.shortcutError) {
    const shortcut = formatShortcut(nativeState.settings.shortcut, platform);
    const message =
      nativeState.shortcutError === 'in-use' ? t('toast.shortcutInUse', { shortcut }) : t('toast.shortcutInvalid');
    toast(message, undefined, 8000);
  }
}

start().catch((error: unknown) => {
  console.error('Appunto failed to start', error);
  // What is on screen may not be the saved board: never save it over that.
  if (!boardLoaded) blockSaving(t('toast.startFailed'));
  // Show the window anyway, so the problem is visible.
  void native.ready().catch(() => {});
});
