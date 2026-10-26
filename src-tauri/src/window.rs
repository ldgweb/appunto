//! Showing, hiding and remembering the board window.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::{AppState, MAIN_WINDOW};

/// What is remembered between launches. Visibility is decided at startup.
pub fn state_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}

/// Brings the board to the front, ready for typing.
pub fn show(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("board://shown", ());
}

/// Hides the board. The page saves on `board://hiding`.
pub fn hide(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = app.emit("board://hiding", ());
    let _ = window.hide();
    // Gives the focus back to the app that was in front before the board.
    #[cfg(target_os = "macos")]
    let _ = app.hide();
}

/// The global shortcut: hide the board when it is in front, otherwise bring
/// it to the front (also when it is open but behind other windows).
///
/// Linux can't tell reliably whether the board has the focus at that moment:
/// on X11 the key grab of the shortcut itself takes the focus away, and on
/// Wayland the compositor may never hand it over. There, a visible board
/// counts as in front.
pub fn toggle(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let in_front = cfg!(target_os = "linux") || window.is_focused().unwrap_or(false);
    if visible && !minimized && in_front {
        hide(app);
    } else {
        show(app);
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    match event {
        // Closing only hides the board: the shortcut and the tray keep working.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide(window.app_handle());
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Some(state) = window.try_state::<AppState>() {
                state.window_saver.poke();
            }
        }
        _ => {}
    }
}

/// Saves the window position and size shortly after the user stops moving or
/// resizing it. The window-state plugin alone saves only on a clean exit, which
/// a shutdown or a forced logout may never give it.
pub struct StateSaver(Sender<()>);

impl StateSaver {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<()>();
        let _ = std::thread::Builder::new()
            .name("window-state".into())
            .spawn(move || {
                while rx.recv().is_ok() {
                    loop {
                        match rx.recv_timeout(Duration::from_millis(800)) {
                            Ok(()) => continue,
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    // On the main thread: the plugin keeps its own lock while it
                    // asks the window for size and position. From this thread
                    // each answer would wait for the main thread, which may be
                    // waiting for that lock to record a move: a deadlock.
                    let main = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let _ = main.save_window_state(state_flags());
                    });
                }
            });
        Self(tx)
    }

    pub fn poke(&self) {
        let _ = self.0.send(());
    }
}
