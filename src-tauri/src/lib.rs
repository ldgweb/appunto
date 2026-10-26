//! Appunto: a tiny blackboard for quick notes and sketches, one shortcut away.
//!
//! The native side owns what the operating system is involved in: the window,
//! the global shortcut, the tray icon, launch at login and the files on disk.
//! The page owns the board itself: text, drawing, fonts and colors.

mod autostart;
mod commands;
mod fonts;
mod hotkey;
#[cfg(target_os = "macos")]
mod macos;
mod settings;
mod storage;
mod text;
mod tray;
mod window;

use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

use crate::settings::Settings;
use crate::text::Lang;

pub(crate) const MAIN_WINDOW: &str = "main";

/// Moves the board, the archive, the settings and the window position to
/// another folder, for tests and portable setups. The webview keeps its own
/// cache in the usual place. In this mode launch at login can't be changed.
const DATA_DIR_ENV: &str = "APPUNTO_DATA_DIR";

/// Starts the app without showing the board.
const HIDDEN_ARG: &str = "--hidden";
/// Shows or hides the board of the running app (for a system shortcut).
const TOGGLE_ARG: &str = "--toggle";

/// How this process was started.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Launch {
    /// Do not show the window on startup.
    hidden: bool,
    /// Started by the system at login.
    autostart: bool,
}

impl Launch {
    fn from_args<A: AsRef<OsStr>>(args: impl IntoIterator<Item = A>) -> Self {
        let mut launch = Self::default();
        for arg in args {
            let arg = arg.as_ref();
            if arg == HIDDEN_ARG {
                launch.hidden = true;
            } else if arg == autostart::ARG {
                launch.autostart = true;
            }
        }
        launch
    }
}

/// Where the app keeps its files.
#[derive(Debug)]
pub(crate) struct Paths {
    pub data: PathBuf,
    config: PathBuf,
    /// True when `APPUNTO_DATA_DIR` chose the folder.
    custom: bool,
}

impl Paths {
    fn resolve(app: &AppHandle, custom: Option<PathBuf>) -> tauri::Result<Self> {
        Ok(match custom {
            Some(dir) => Self {
                data: dir.clone(),
                config: dir,
                custom: true,
            },
            None => Self {
                data: app.path().app_data_dir()?,
                config: app.path().app_config_dir()?,
                custom: false,
            },
        })
    }

    pub fn board(&self) -> PathBuf {
        self.data.join("board.json")
    }

    pub fn archive(&self) -> PathBuf {
        self.data.join("archive")
    }

    pub fn settings(&self) -> PathBuf {
        self.config.join("settings.json")
    }
}

pub(crate) struct AppState {
    pub paths: Paths,
    launch: Launch,
    pub first_run: bool,
    pub settings: Mutex<Settings>,
    pub hotkey: Mutex<hotkey::HotkeyState>,
    /// See `autostart::available`.
    pub autostart_available: bool,
    /// Set once the page has rendered, or when the fallback timer fires.
    pub ready: AtomicBool,
    /// One board write (save or archive) at a time.
    pub disk: Arc<Mutex<()>>,
    /// Set when the saved board could not be read at startup: saving over it
    /// is refused until the next start.
    pub board_locked: AtomicBool,
    pub tray: Mutex<Option<tray::Tray>>,
    pub window_saver: window::StateSaver,
}

impl AppState {
    pub fn starts_hidden(&self) -> bool {
        self.launch.hidden || (self.launch.autostart && lock(&self.settings).start_hidden)
    }
}

/// Locks a mutex, recovering the data if a panic poisoned it.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn run() {
    let launch = Launch::from_args(std::env::args_os().skip(1));
    let custom_dir = std::env::var_os(DATA_DIR_ENV)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let dir = PathBuf::from(value);
            std::path::absolute(&dir).unwrap_or(dir)
        });

    let mut window_state =
        tauri_plugin_window_state::Builder::new().with_state_flags(window::state_flags());
    if let Some(dir) = &custom_dir {
        // An absolute file name replaces the plugin's default folder.
        window_state = window_state.with_filename(dir.join("window-state.json").to_string_lossy());
    }

    let builder = tauri::Builder::default()
        // First, so that launching the app again only wakes the running board.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let has = |flag: &str| args.iter().skip(1).any(|arg| arg == flag);
            if has(TOGGLE_ARG) {
                window::toggle(app);
            } else if !has(HIDDEN_ARG) && !has(autostart::ARG) {
                window::show(app);
            }
        }))
        .plugin(window_state.build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(autostart::ENTRY_NAME)
                .arg(autostart::ARG)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        window::toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(macos::menu)
        .on_menu_event(macos::on_menu_event);

    let app = builder
        .setup(move |app| setup(app, launch, custom_dir))
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::app_ready,
            commands::save_board,
            commands::archive_board,
            commands::update_settings,
            commands::pause_shortcut,
            commands::list_fonts,
            commands::hide_window,
            commands::open_data_dir,
            commands::open_project_page,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("Appunto could not start");

    app.run(|app, event| {
        // Clicking the Dock icon brings the board back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            window::show(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

fn setup(
    app: &mut tauri::App,
    launch: Launch,
    custom_dir: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let paths = Paths::resolve(&handle, custom_dir)?;
    storage::create_private_dir(&paths.data)?;
    storage::create_private_dir(&paths.config)?;

    let (mut settings, first_run) = settings::load(&paths.settings());
    if first_run {
        let _ = settings::save(&paths.settings(), &settings);
    }
    let autostart_available = autostart::available(paths.custom);
    if autostart_available {
        set_up_launch_at_login(&handle, &paths, &mut settings);
    }
    storage::backup_board(&paths.board());

    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.set_always_on_top(settings.always_on_top);
    }

    let lang = Lang::resolve(&settings.language, &text::system_locale());
    let on_top = settings.always_on_top;
    let shortcut = settings.shortcut.clone();

    app.manage(AppState {
        paths,
        launch,
        first_run,
        settings: Mutex::new(settings),
        hotkey: Mutex::new(hotkey::HotkeyState::default()),
        autostart_available,
        ready: AtomicBool::new(false),
        disk: Arc::new(Mutex::new(())),
        board_locked: AtomicBool::new(false),
        tray: Mutex::new(None),
        window_saver: window::StateSaver::spawn(handle.clone()),
    });
    let state = app.state::<AppState>();

    hotkey::register_initial(&handle, &mut lock(&state.hotkey), &shortcut);

    let launch_at_login = autostart::enabled(&handle);
    *lock(&state.tray) = build_tray(&handle, lang, on_top, launch_at_login, autostart_available);

    // If the page never reports that it is ready, show the window anyway
    // rather than leaving the app running with nothing on screen.
    let fallback = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let state = fallback.state::<AppState>();
        commands::reveal_once(&fallback, &state);
    });

    Ok(())
}

/// Launch at login is on by default, because the board is only useful if it is
/// already running when you need it. Once applied it is the user's choice, and
/// while it is on it is registered again at every start, so it follows the app
/// if it moved. Only called when `autostart::available`.
fn set_up_launch_at_login(app: &AppHandle, paths: &Paths, settings: &mut Settings) {
    if autostart::enabled(app) {
        let _ = autostart::set(app, true);
    } else if !settings.autostart_default_applied && autostart::set(app, true).is_ok() {
        settings.autostart_default_applied = true;
        let _ = settings::save(&paths.settings(), settings);
    }
}

/// The tray is optional. Some Linux desktops have no AppIndicator library, and
/// the tray code panics without it; the board still works through the
/// shortcut and by launching the app again.
fn build_tray(
    app: &AppHandle,
    lang: Lang,
    on_top: bool,
    launch_at_login: bool,
    autostart_available: bool,
) -> Option<tray::Tray> {
    let build = || tray::Tray::build(app, lang, on_top, launch_at_login, autostart_available);
    #[cfg(target_os = "linux")]
    {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(build))
            .ok()
            .and_then(Result::ok)
    }
    #[cfg(not(target_os = "linux"))]
    {
        build().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_flags() {
        let launch = Launch::from_args(["--autostart", "--other"]);
        assert!(launch.autostart && !launch.hidden);
        let launch = Launch::from_args(["--hidden"]);
        assert!(launch.hidden && !launch.autostart);
    }
}
