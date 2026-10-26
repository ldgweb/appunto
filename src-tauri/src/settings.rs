//! Settings shared by both sides. Rust owns the fields the operating system is
//! involved in; `ui` belongs to the board page and is stored as it arrives.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::hotkey::DEFAULT_SHORTCUT;
use crate::storage;

pub const LANGUAGES: [&str; 3] = ["auto", "en", "it"];
const MAX_UI_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Accelerator that shows and hides the board from any app.
    pub shortcut: String,
    pub always_on_top: bool,
    /// Stay in the tray when started at login.
    pub start_hidden: bool,
    /// "auto" follows the system language.
    pub language: String,
    /// Launch at login was turned on once by the app, or set by the user.
    /// From then on only the user changes it.
    pub autostart_default_applied: bool,
    /// Look and feel, owned by the board page.
    pub ui: Value,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: DEFAULT_SHORTCUT.to_string(),
            always_on_top: false,
            start_hidden: false,
            language: "auto".to_string(),
            autostart_default_applied: false,
            ui: Value::Object(Map::new()),
        }
    }
}

impl Settings {
    /// The defaults for an app that has run before. Launch at login was the
    /// user's choice by then, so it is not turned on again.
    fn after_a_reset() -> Self {
        Self {
            autostart_default_applied: true,
            ..Self::default()
        }
    }

    /// Repairs values that a hand-edited or older file may contain.
    fn sanitized(mut self) -> Self {
        if !LANGUAGES.contains(&self.language.as_str()) {
            self.language = "auto".to_string();
        }
        if self.shortcut.trim().is_empty() {
            self.shortcut = DEFAULT_SHORTCUT.to_string();
        }
        if !self.ui.is_object() {
            self.ui = Value::Object(Map::new());
        }
        self
    }
}

/// A partial update sent by the board page or the tray menu.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub shortcut: Option<String>,
    pub always_on_top: Option<bool>,
    pub start_hidden: Option<bool>,
    pub language: Option<String>,
    pub ui: Option<Value>,
    /// Launch at login. Lives in the system, not in the settings file.
    pub autostart: Option<bool>,
}

pub fn valid_ui(value: &Value) -> bool {
    value.is_object()
        && serde_json::to_vec(value)
            .map(|bytes| bytes.len() <= MAX_UI_BYTES)
            .unwrap_or(false)
}

/// Loads the settings and tells whether this is the first run (no file yet).
/// A file that cannot be parsed is set aside and replaced by the defaults.
pub fn load(path: &Path) -> (Settings, bool) {
    let damaged = || {
        storage::set_aside(path);
        (Settings::after_a_reset(), false)
    };
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Settings>(&text) {
            Ok(settings) => (settings.sanitized(), false),
            Err(_) => damaged(),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => (Settings::default(), true),
        // Not UTF-8: the bytes are there, the content is not settings.
        Err(error) if error.kind() == io::ErrorKind::InvalidData => damaged(),
        Err(_) => (Settings::after_a_reset(), false),
    }
}

pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    storage::write_atomic(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A settings file in a scratch folder that is removed when the test ends.
    struct TempFile(PathBuf);

    impl std::ops::Deref for TempFile {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl AsRef<Path> for TempFile {
        fn as_ref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            if let Some(dir) = self.0.parent() {
                let _ = fs::remove_dir_all(dir);
            }
        }
    }

    fn temp_file(name: &str) -> TempFile {
        let dir =
            std::env::temp_dir().join(format!("appunto-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempFile(dir.join("settings.json"))
    }

    #[test]
    fn first_run_has_defaults() {
        let path = temp_file("first");
        let (settings, first_run) = load(&path);
        assert!(first_run);
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn round_trip_keeps_every_field() {
        let path = temp_file("round-trip");
        let settings = Settings {
            shortcut: "Ctrl+Shift+F9".into(),
            always_on_top: true,
            start_hidden: true,
            language: "it".into(),
            autostart_default_applied: true,
            ui: serde_json::json!({ "fontSize": 30, "theme": "green" }),
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), (settings, false));
    }

    #[test]
    fn missing_and_invalid_fields_are_repaired() {
        let path = temp_file("repair");
        fs::write(
            &path,
            r#"{ "language": "klingon", "shortcut": " ", "ui": [1, 2] }"#,
        )
        .unwrap();
        let (settings, first_run) = load(&path);
        assert!(!first_run);
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn unreadable_file_is_kept_aside() {
        let path = temp_file("damaged");
        fs::write(&path, "{ not json").unwrap();
        let (settings, first_run) = load(&path);
        assert!(!first_run);
        assert_eq!(settings.shortcut, DEFAULT_SHORTCUT);
        // Launch at login stays as the user left it.
        assert!(settings.autostart_default_applied);
        let kept = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("settings.damaged-")
            })
            .count();
        assert_eq!(kept, 1);
    }

    #[test]
    fn ui_must_be_a_small_object() {
        assert!(valid_ui(&serde_json::json!({ "fontSize": 22 })));
        assert!(!valid_ui(&serde_json::json!("text")));
        let huge = "x".repeat(MAX_UI_BYTES + 1);
        assert!(!valid_ui(&serde_json::json!({ "note": huge })));
    }
}
