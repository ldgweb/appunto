//! Launch at login, through tauri-plugin-autostart. On Windows the entry is
//! written here instead, and on Linux its command line is fixed up afterwards:
//! see `set`.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt as _;

/// Name of the login entry. The Windows uninstaller removes the entry with
/// this same name (the product name), so the two must match.
pub const ENTRY_NAME: &str = "Appunto";

/// Passed by the login entry, so the app knows the system started it.
pub const ARG: &str = "--autostart";

pub fn enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Whether this copy may change launch at login. Development builds, custom
/// data folders and copies run from a temporary place never touch it: the
/// entry would start a program that is not the installed app, or that is
/// about to disappear.
pub fn available(custom_data_dir: bool) -> bool {
    !(custom_data_dir || cfg!(debug_assertions) || temporary_location())
}

/// The file the login entry has to start. An AppImage runs from a temporary
/// mount, so for it the AppImage file itself is what counts.
fn program() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
}

/// True when the app runs from a place it won't be started from again: a
/// mounted disk image or a translocated copy on macOS, or a temporary folder,
/// like a ZIP opened in place on Windows.
fn temporary_location() -> bool {
    let Some(program) = program() else {
        return true;
    };
    let canonical =
        |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    is_temporary(
        &canonical(&program),
        &canonical(&std::env::temp_dir()),
        cfg!(target_os = "macos"),
    )
}

fn is_temporary(program: &Path, temp: &Path, macos: bool) -> bool {
    let text = program.to_string_lossy();
    if macos && (text.starts_with("/Volumes/") || text.contains("/AppTranslocation/")) {
        return true;
    }
    program.starts_with(temp)
}

pub fn set(app: &AppHandle, on: bool) -> Result<(), String> {
    if on {
        enable(app)
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn enable(_app: &AppHandle) -> Result<(), String> {
    write_windows_entry().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn enable(app: &AppHandle) -> Result<(), String> {
    app.autolaunch().enable().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    quote_linux_entry(app);
    Ok(())
}

/// Writes the login entry for the current user, with the program path in
/// quotes. The plugin would try the machine-wide key first when the app runs
/// as administrator, and it leaves the path unquoted, which breaks on paths
/// with spaces ("C:\Users\Alex Rossi\…").
#[cfg(windows)]
fn write_windows_entry() -> std::io::Result<()> {
    use windows_registry::{Type, CURRENT_USER};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// What Task Manager stores for an entry that is turned on.
    const TURNED_ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    let exe = std::env::current_exe()?;
    CURRENT_USER
        .create(RUN)?
        .set_string(ENTRY_NAME, windows_command(&exe.display().to_string()))?;
    // Clears an "off" that Task Manager may have stored for the entry.
    if let Ok(key) = CURRENT_USER.options().write().open(APPROVED) {
        key.set_bytes(ENTRY_NAME, Type::Bytes, &TURNED_ON)?;
    }
    Ok(())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn windows_command(exe: &str) -> String {
    format!("\"{exe}\" {ARG}")
}

/// The plugin writes `Exec=<path> --autostart` without quotes, so an AppImage
/// in a folder with spaces would not start at login. Rewrites that line.
#[cfg(target_os = "linux")]
fn quote_linux_entry(app: &AppHandle) {
    use tauri::Manager as _;

    let (Ok(home), Some(program)) = (app.path().home_dir(), program()) else {
        return;
    };
    let file = home
        .join(".config")
        .join("autostart")
        .join(format!("{ENTRY_NAME}.desktop"));
    let Ok(entry) = std::fs::read_to_string(&file) else {
        return;
    };
    let exec = format!("Exec={}", desktop_exec(&program.to_string_lossy()));
    let fixed: Vec<&str> = entry
        .lines()
        .map(|line| {
            if line.starts_with("Exec=") {
                exec.as_str()
            } else {
                line
            }
        })
        .collect();
    let _ = crate::storage::write_atomic(&file, fixed.join("\n").as_bytes());
}

/// The `Exec` value of a desktop entry, quoted as the specification asks:
/// `"`, `` ` `` and `$` escaped, a backslash written four times, `%` doubled.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_exec(program: &str) -> String {
    let mut quoted = String::with_capacity(program.len() + 2);
    for c in program.chars() {
        match c {
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(c);
            }
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    format!("\"{quoted}\" {ARG}")
}

#[cfg(test)]
mod tests {
    use super::{desktop_exec, is_temporary, windows_command};
    use std::path::Path;

    #[test]
    fn disk_images_and_temporary_folders_are_not_installs() {
        let temp = Path::new("/tmp");
        assert!(is_temporary(
            Path::new("/Volumes/Appunto/Appunto.app/Contents/MacOS/appunto"),
            temp,
            true
        ));
        assert!(is_temporary(
            Path::new(
                "/private/var/folders/x/AppTranslocation/1234/d/Appunto.app/Contents/MacOS/appunto"
            ),
            temp,
            true
        ));
        assert!(is_temporary(Path::new("/tmp/zip-123/appunto"), temp, false));
        assert!(!is_temporary(
            Path::new("/Applications/Appunto.app/Contents/MacOS/appunto"),
            temp,
            true
        ));
        assert!(!is_temporary(
            Path::new("/home/alex/Apps/appunto.AppImage"),
            temp,
            false
        ));
        // "/Volumes" only means a disk image on macOS.
        assert!(!is_temporary(
            Path::new("/Volumes/data/appunto"),
            temp,
            false
        ));
    }

    #[test]
    fn windows_entry_quotes_the_path() {
        assert_eq!(
            windows_command(r"C:\Users\Alex Rossi\AppData\Local\Appunto\appunto.exe"),
            r#""C:\Users\Alex Rossi\AppData\Local\Appunto\appunto.exe" --autostart"#
        );
    }

    #[test]
    fn desktop_entry_quotes_and_escapes_the_path() {
        assert_eq!(
            desktop_exec("/home/alex/My Apps/Appunto.AppImage"),
            r#""/home/alex/My Apps/Appunto.AppImage" --autostart"#
        );
        assert_eq!(
            desktop_exec(r"/opt/a$b/100%/c\d"),
            r#""/opt/a\\$b/100%%/c\\\\d" --autostart"#
        );
    }
}
