//! The global shortcut that shows and hides the board from any app.

use serde::{Serialize, Serializer};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// Control+Alt+Space on Windows and Linux: rarely taken by other apps and easy
/// to press with one hand. On macOS ⌃⌥Space switches the input source, and the
/// system wins over apps without telling them, so the default there is ⇧⌘Space.
#[cfg(target_os = "macos")]
pub const DEFAULT_SHORTCUT: &str = "Shift+Super+Space";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";

/// Why a shortcut could not be used. Serialized as a code the page translates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyError {
    /// Not a key combination the system understands, or a plain key.
    Invalid,
    /// Another app (or the system) already owns it.
    InUse,
}

impl HotkeyError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::InUse => "in-use",
        }
    }
}

impl Serialize for HotkeyError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.code())
    }
}

#[derive(Debug, Default)]
pub struct HotkeyState {
    /// The shortcut this app owns, if any.
    active: Option<Shortcut>,
    /// Set while the settings panel records a new shortcut.
    paused: bool,
    /// Why the configured shortcut is not active, shown in the settings panel.
    pub error: Option<HotkeyError>,
}

/// Like the settings panel, accepts only combinations with Ctrl, Alt or the
/// system key, or a function key: a plain key, maybe from a hand-edited
/// settings file, would be taken away from every app.
fn parse(accelerator: &str) -> Result<Shortcut, HotkeyError> {
    let accelerator = accelerator.trim();
    if accelerator.is_empty() || accelerator.len() > 64 {
        return Err(HotkeyError::Invalid);
    }
    let shortcut = accelerator
        .parse::<Shortcut>()
        .map_err(|_| HotkeyError::Invalid)?;
    let held = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER | Modifiers::META;
    if shortcut.mods.intersects(held) || is_function_key(shortcut.key) {
        Ok(shortcut)
    } else {
        Err(HotkeyError::Invalid)
    }
}

fn is_function_key(key: Code) -> bool {
    use Code::*;
    matches!(
        key,
        F1 | F2
            | F3
            | F4
            | F5
            | F6
            | F7
            | F8
            | F9
            | F10
            | F11
            | F12
            | F13
            | F14
            | F15
            | F16
            | F17
            | F18
            | F19
            | F20
            | F21
            | F22
            | F23
            | F24
    )
}

/// Makes `accelerator` the active shortcut. On failure the previous shortcut
/// stays active and the error is returned.
pub fn replace(
    app: &AppHandle,
    state: &mut HotkeyState,
    accelerator: &str,
) -> Result<(), HotkeyError> {
    let next = parse(accelerator)?;
    if state.active == Some(next) && !state.paused {
        state.error = None;
        return Ok(());
    }

    let shortcuts = app.global_shortcut();
    let previous = state.active.take();
    if let Some(previous) = previous {
        if !state.paused {
            let _ = shortcuts.unregister(previous);
        }
    }
    state.paused = false;

    match shortcuts.register(next) {
        Ok(()) => {
            state.active = Some(next);
            state.error = None;
            Ok(())
        }
        Err(_) => {
            if let Some(previous) = previous {
                if shortcuts.register(previous).is_ok() {
                    state.active = Some(previous);
                }
            }
            Err(HotkeyError::InUse)
        }
    }
}

/// Registers the saved shortcut at startup, remembering why it failed.
pub fn register_initial(app: &AppHandle, state: &mut HotkeyState, accelerator: &str) {
    if let Err(error) = replace(app, state, accelerator) {
        state.error = Some(error);
    }
}

/// Releases the shortcut while a new one is being recorded, so pressing the
/// current combination does not hide the board.
pub fn pause(app: &AppHandle, state: &mut HotkeyState) {
    if state.paused {
        return;
    }
    if let Some(active) = state.active {
        let _ = app.global_shortcut().unregister(active);
    }
    state.paused = true;
}

pub fn resume(app: &AppHandle, state: &mut HotkeyState) {
    if !state.paused {
        return;
    }
    state.paused = false;
    if let Some(active) = state.active {
        if app.global_shortcut().register(active).is_err() {
            state.active = None;
            state.error = Some(HotkeyError::InUse);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_what_the_settings_panel_records() {
        for accelerator in [
            DEFAULT_SHORTCUT,
            "Ctrl+Shift+KeyN",
            "Alt+Digit1",
            "Super+Shift+Backquote",
            "Ctrl+Alt+F12",
            "F9",
        ] {
            assert!(parse(accelerator).is_ok(), "{accelerator} should parse");
        }
    }

    #[test]
    fn rejects_garbage() {
        for accelerator in ["", "   ", "Ctrl+", "Ctrl+Shift", "Ctrl+Nope", "Ctrl+A+B"] {
            assert_eq!(
                parse(accelerator),
                Err(HotkeyError::Invalid),
                "{accelerator:?}"
            );
        }
        assert_eq!(parse(&"Ctrl+".repeat(20)), Err(HotkeyError::Invalid));
    }

    #[test]
    fn rejects_keys_that_typing_needs() {
        for accelerator in ["Space", "KeyE", "Shift+KeyA", "Shift+Digit1"] {
            assert_eq!(
                parse(accelerator),
                Err(HotkeyError::Invalid),
                "{accelerator:?}"
            );
        }
        assert!(parse("Shift+F5").is_ok());
    }

    /// The page translates these codes (`ShortcutError` in src/native.ts).
    #[test]
    fn errors_reach_the_page_as_codes() {
        let codes = serde_json::to_value([HotkeyError::Invalid, HotkeyError::InUse]).unwrap();
        assert_eq!(codes, serde_json::json!(["invalid", "in-use"]));
    }
}
