//! Files on disk. Every write lands in a temporary file first and then replaces
//! the target, so a crash or a power cut never leaves a half-written board.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Upper bound for one board. Real boards are a few hundred kilobytes.
pub const MAX_BOARD_BYTES: usize = 32 * 1024 * 1024;

/// How long `load_board` keeps trying a file another program holds open.
const READ_ATTEMPTS: u32 = 10;
const READ_PAUSE: Duration = Duration::from_millis(200);

/// What `load_board` found.
#[derive(Debug, PartialEq, Eq)]
pub enum Loaded {
    Board(String),
    /// No board yet (or only damaged ones, now set aside).
    Missing,
    /// The board is there but could not be read, typically because another
    /// program holds it. Nothing may be saved over it in this session.
    Unreadable(String),
}

enum ReadError {
    /// The content is not a board: cut short, not UTF-8 or not JSON.
    Damaged,
    /// The file could not be read at all.
    Io(io::Error),
}

/// Writes `bytes` to `path` without ever exposing a partial file. When the
/// target can't be replaced the old file stays as it was and the error comes
/// back to the caller.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        create_private_dir(dir)?;
    }
    let tmp = with_suffix(path, "tmp");
    let result = write_new(&tmp, bytes).and_then(|()| replace(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Creates `dir` and its parents. On Unix new folders are private to the
/// user, like the files written by `write_atomic`.
pub fn create_private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // A leftover from a crash would keep its old permissions.
    let _ = fs::remove_file(path);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// On Windows an antivirus scan or a sync client can hold the target for a
/// moment, so the replace is retried.
fn replace(from: &Path, to: &Path) -> io::Result<()> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(25 * attempt));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::other("could not replace file")))
}

/// Reads the board. A damaged board is set aside (never deleted) and the
/// backup is used instead; a board that can't be read right now is retried
/// for a couple of seconds and then reported, so nothing overwrites it.
pub fn load_board(path: &Path) -> Loaded {
    let mut attempt = 1;
    loop {
        match read_json(path) {
            Ok(Some(text)) => return Loaded::Board(text),
            Ok(None) => break,
            Err(ReadError::Damaged) => {
                if !set_aside(path) {
                    return Loaded::Unreadable("the damaged board could not be set aside".into());
                }
                break;
            }
            Err(ReadError::Io(error)) => {
                if attempt >= READ_ATTEMPTS {
                    return Loaded::Unreadable(error.to_string());
                }
                attempt += 1;
                thread::sleep(READ_PAUSE);
            }
        }
    }
    match read_json(&backup_path(path)) {
        Ok(Some(text)) => Loaded::Board(text),
        Ok(None) | Err(ReadError::Damaged) => Loaded::Missing,
        // The backup may be the only copy left: keep it from being replaced.
        Err(ReadError::Io(error)) => Loaded::Unreadable(error.to_string()),
    }
}

/// Copies the board to `board.json.bak` once per launch, so a bad session can
/// be undone by hand.
pub fn backup_board(path: &Path) {
    if let Ok(Some(text)) = read_json(path) {
        let _ = write_atomic(&backup_path(path), text.as_bytes());
    }
}

/// Saves a copy of a board before it is cleared. Never overwrites an archive.
pub fn archive(dir: &Path, stamp: &str, data: &str) -> io::Result<PathBuf> {
    let stamp: String = stamp
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    let stamp = if stamp.is_empty() {
        "board".to_string()
    } else {
        stamp
    };
    for n in 1..1000 {
        let name = if n == 1 {
            format!("board-{stamp}.json")
        } else {
            format!("board-{stamp}-{n}.json")
        };
        let path = dir.join(name);
        if !path.exists() {
            write_atomic(&path, data.as_bytes())?;
            return Ok(path);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "too many archives with the same name",
    ))
}

fn backup_path(path: &Path) -> PathBuf {
    with_suffix(path, "bak")
}

/// `Ok(None)` when the file does not exist.
fn read_json(path: &Path) -> Result<Option<String>, ReadError> {
    match fs::read_to_string(path) {
        Ok(text) if serde_json::from_str::<serde::de::IgnoredAny>(&text).is_ok() => Ok(Some(text)),
        Ok(_) => Err(ReadError::Damaged),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        // Not UTF-8: the bytes are there, the content is not a board.
        Err(error) if error.kind() == io::ErrorKind::InvalidData => Err(ReadError::Damaged),
        Err(error) => Err(ReadError::Io(error)),
    }
}

/// Keeps a damaged file next to the original for recovery by hand, as
/// `<name>.damaged-<seconds>.json`. Moves it when possible, otherwise leaves
/// a copy behind. Returns false when neither worked.
pub fn set_aside(path: &Path) -> bool {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "board".to_string());
    let target = path.with_file_name(format!("{stem}.damaged-{seconds}.json"));
    fs::rename(path, &target).is_ok() || fs::copy(path, &target).is_ok()
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".");
    name.push(suffix);
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch folder that is removed when the test ends.
    struct TempDir(PathBuf);

    impl std::ops::Deref for TempDir {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(name: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!("appunto-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    #[test]
    fn write_atomic_creates_and_replaces() {
        let dir = temp_dir("write");
        let path = dir.join("nested").join("board.json");
        write_atomic(&path, b"{\"text\":\"one\"}").unwrap();
        write_atomic(&path, b"{\"text\":\"two\"}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"text\":\"two\"}");
        assert!(!with_suffix(&path, "tmp").exists());
    }

    #[test]
    fn missing_board_loads_as_missing() {
        let dir = temp_dir("missing");
        assert_eq!(load_board(&dir.join("board.json")), Loaded::Missing);
    }

    #[test]
    fn damaged_board_falls_back_to_backup_and_is_kept() {
        let dir = temp_dir("damaged");
        let path = dir.join("board.json");
        fs::write(backup_path(&path), "{\"text\":\"from backup\"}").unwrap();
        fs::write(&path, "{\"text\":\"half writ").unwrap();

        assert_eq!(
            load_board(&path),
            Loaded::Board("{\"text\":\"from backup\"}".into())
        );
        assert!(!path.exists());
        let kept: Vec<_> = fs::read_dir(&*dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("board.damaged-"))
            .collect();
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn bytes_that_are_not_text_count_as_damaged() {
        let dir = temp_dir("binary");
        let path = dir.join("board.json");
        fs::write(&path, [0xff, 0xfe, 0x00, 0x7b]).unwrap();
        assert_eq!(load_board(&path), Loaded::Missing);
        assert!(!path.exists());
    }

    /// Another program holding the board open must never lead to replacing it
    /// with the backup.
    #[cfg(windows)]
    #[test]
    fn a_board_held_by_another_program_is_reported_and_left_alone() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = temp_dir("locked");
        let path = dir.join("board.json");
        fs::write(&path, "{\"text\":\"newest\"}").unwrap();
        fs::write(backup_path(&path), "{\"text\":\"older\"}").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();

        assert!(matches!(load_board(&path), Loaded::Unreadable(_)));
        drop(lock);
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"text\":\"newest\"}");
    }

    #[test]
    fn a_failed_replace_leaves_the_old_file_and_no_temporary() {
        let dir = temp_dir("replace");
        // A folder where the file should go can't be replaced by a file.
        let path = dir.join("board.json");
        fs::create_dir_all(path.join("blocker")).unwrap();
        assert!(write_atomic(&path, b"{}").is_err());
        assert!(path.is_dir());
        assert!(!with_suffix(&path, "tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn notes_are_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("private");
        let path = dir.join("notes").join("board.json");
        write_atomic(&path, b"{}").unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }

    #[test]
    fn backup_copies_only_valid_boards() {
        let dir = temp_dir("backup");
        let path = dir.join("board.json");
        fs::write(&path, "{\"text\":\"good\"}").unwrap();
        backup_board(&path);
        fs::write(&path, "not json").unwrap();
        backup_board(&path);
        assert_eq!(
            fs::read_to_string(backup_path(&path)).unwrap(),
            "{\"text\":\"good\"}"
        );
    }

    #[test]
    fn archive_never_overwrites_and_sanitizes_the_stamp() {
        let dir = temp_dir("archive");
        let first = archive(&dir, "2026-10-23_14-05-09", "{}").unwrap();
        let second = archive(&dir, "2026-10-23_14-05-09", "{}").unwrap();
        let odd = archive(&dir, "../../evil", "{}").unwrap();
        assert_eq!(first.file_name().unwrap(), "board-2026-10-23_14-05-09.json");
        assert_eq!(
            second.file_name().unwrap(),
            "board-2026-10-23_14-05-09-2.json"
        );
        assert_eq!(odd.parent().unwrap(), &*dir);
        assert_eq!(odd.file_name().unwrap(), "board-board.json");
    }
}
