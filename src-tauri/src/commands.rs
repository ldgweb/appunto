//! Commands the board page calls with `invoke`, and the actions the tray menu
//! shares with them.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::hotkey::{self, HotkeyError};
use crate::settings::{self, Settings, SettingsPatch, LANGUAGES};
use crate::storage::Loaded;
use crate::text::{self, Lang};
use crate::{autostart, fonts, lock, storage, window, AppState, MAIN_WINDOW};

const PROJECT_URL: &str = "https://github.com/ldgweb/appunto";

const PLATFORM: &str = if cfg!(target_os = "windows") {
    "windows"
} else if cfg!(target_os = "macos") {
    "macos"
} else {
    "linux"
};

/// The settings as the system sees them right now.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeState {
    settings: Settings,
    autostart: bool,
    /// False when this copy must not change launch at login (see
    /// `autostart::available`).
    autostart_available: bool,
    shortcut_error: Option<HotkeyError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    native: NativeState,
    /// The saved board as JSON text, if there is one.
    board: Option<String>,
    /// Set when the saved board exists but can't be read: the page must not
    /// save over it.
    board_error: Option<String>,
    first_run: bool,
    system_locale: String,
    platform: &'static str,
    version: String,
    /// Global shortcuts do not work in Wayland sessions; the page explains the
    /// workaround.
    wayland: bool,
}

fn native_state(app: &AppHandle) -> NativeState {
    let state = app.state::<AppState>();
    let settings = lock(&state.settings).clone();
    let shortcut_error = lock(&state.hotkey).error;
    NativeState {
        settings,
        autostart: autostart::enabled(app),
        autostart_available: state.autostart_available,
        shortcut_error,
    }
}

fn is_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|v| v.eq_ignore_ascii_case("wayland"))
                .unwrap_or(false))
}

/// Everything the page needs to start. Off the main thread: reading a board
/// that another program holds can take a couple of seconds.
#[tauri::command]
pub async fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let path = state.paths.board();
    let loaded = tauri::async_runtime::spawn_blocking(move || storage::load_board(&path))
        .await
        .map_err(|e| e.to_string())?;
    let (board, board_error) = match loaded {
        Loaded::Board(text) => (Some(text), None),
        Loaded::Missing => (None, None),
        Loaded::Unreadable(error) => {
            // Until the next start, nothing may replace the board on disk.
            state.board_locked.store(true, Ordering::SeqCst);
            (None, Some(error))
        }
    };
    Ok(Bootstrap {
        native: native_state(&app),
        board,
        board_error,
        first_run: state.first_run,
        system_locale: text::system_locale(),
        platform: PLATFORM,
        version: app.package_info().version.to_string(),
        wayland: is_wayland(),
    })
}

/// The page has rendered: show the window, unless the board starts hidden.
#[tauri::command]
pub fn app_ready(app: AppHandle, state: State<'_, AppState>) {
    reveal_once(&app, &state);
}

pub fn reveal_once(app: &AppHandle, state: &AppState) {
    if state.ready.swap(true, Ordering::SeqCst) {
        return;
    }
    if !state.starts_hidden() {
        window::show(app);
    }
}

/// Refuses a write when the board on disk could not be read at startup, or
/// when the data is far larger than any real board.
fn check_writable(state: &AppState, data: &str) -> Result<(), String> {
    if state.board_locked.load(Ordering::SeqCst) {
        return Err("board-unreadable".into());
    }
    if data.len() > storage::MAX_BOARD_BYTES {
        return Err("too-large".into());
    }
    Ok(())
}

/// Saves the board. The page sends one save at a time.
#[tauri::command]
pub async fn save_board(state: State<'_, AppState>, data: String) -> Result<(), String> {
    check_writable(&state, &data)?;
    let path = state.paths.board();
    let disk = state.disk.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock(&disk);
        storage::write_atomic(&path, data.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Keeps a copy of the board in `archive/` before the page replaces it.
#[tauri::command]
pub async fn archive_board(
    state: State<'_, AppState>,
    data: String,
    stamp: String,
) -> Result<(), String> {
    check_writable(&state, &data)?;
    let dir = state.paths.archive();
    let disk = state.disk.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock(&disk);
        storage::archive(&dir, &stamp, &data).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(app: AppHandle, patch: SettingsPatch) -> Result<NativeState, String> {
    apply_patch(&app, patch, false)
}

/// Applies a settings change, saves it and updates the window, the shortcut
/// and the tray. With `notify`, the page hears about it too: used for changes
/// it did not make itself, from the tray menu.
///
/// The page and the tray send one change at a time, so a change that fails
/// leaves everything as it was.
pub fn apply_patch(
    app: &AppHandle,
    patch: SettingsPatch,
    notify: bool,
) -> Result<NativeState, String> {
    let state = app.state::<AppState>();
    let mut current = lock(&state.settings);
    let mut next = current.clone();

    if let Some(language) = patch.language {
        if !LANGUAGES.contains(&language.as_str()) {
            return Err("invalid-language".into());
        }
        next.language = language;
    }
    if let Some(ui) = patch.ui {
        if !settings::valid_ui(&ui) {
            return Err("invalid-ui".into());
        }
        next.ui = ui;
    }
    if let Some(start_hidden) = patch.start_hidden {
        next.start_hidden = start_hidden;
    }
    if let Some(shortcut) = patch.shortcut {
        hotkey::replace(app, &mut lock(&state.hotkey), &shortcut)
            .map_err(|error| error.code().to_string())?;
        next.shortcut = shortcut.trim().to_string();
    }
    if let Some(on_top) = patch.always_on_top {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.set_always_on_top(on_top);
        }
        next.always_on_top = on_top;
    }
    if let Some(enabled) = patch.autostart {
        if !state.autostart_available {
            return Err("autostart-unavailable".into());
        }
        autostart::set(app, enabled)?;
        next.autostart_default_applied = true;
    }

    let language_changed = next.language != current.language;
    if next != *current {
        // The change is live either way. If the file can't be written now,
        // the next change saves it.
        let _ = settings::save(&state.paths.settings(), &next);
        *current = next;
    }
    let lang = Lang::resolve(&current.language, &text::system_locale());
    drop(current);

    let native = native_state(app);
    if let Some(tray) = lock(&state.tray).as_ref() {
        tray.sync(native.settings.always_on_top, native.autostart);
        if language_changed {
            tray.relabel(lang);
        }
    }
    if notify {
        let _ = app.emit("board://native", &native);
    }
    Ok(native)
}

/// Releases the global shortcut while the settings panel records a new one.
#[tauri::command]
pub fn pause_shortcut(app: AppHandle, state: State<'_, AppState>, paused: bool) -> NativeState {
    {
        let mut hotkey_state = lock(&state.hotkey);
        if paused {
            hotkey::pause(&app, &mut hotkey_state);
        } else {
            hotkey::resume(&app, &mut hotkey_state);
        }
    }
    native_state(&app)
}

#[tauri::command]
pub async fn list_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(fonts::system_families)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    window::hide(&app);
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    open_data_folder(&app)
}

pub fn open_data_folder(app: &AppHandle) -> Result<(), String> {
    let dir = app.state::<AppState>().paths.data.clone();
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_project_page(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(PROJECT_URL, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Quit from the tray: the page saves and calls `quit_app`. If it does not
/// answer in time, quit anyway.
pub fn request_quit(app: &AppHandle) {
    let _ = app.emit("board://quit", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        app.exit(0);
    });
}
