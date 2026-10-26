# Repository guidance

Appunto is a small desktop blackboard for quick notes and sketches (Tauri 2 + Rust + TypeScript, no UI framework) that a global shortcut shows and hides. It has to stay light and instant: no new runtime dependencies or background work without a clear reason.

Read CONTRIBUTING.md for commands and SECURITY.md for what the app may touch. The native side (`src-tauri/src`) owns the window, the global shortcut, the tray, launch at login and every file write. The page (`src/`) owns the board: `src/lib` is pure logic covered by `tests/`, `src/ui` is DOM code, `src/main.ts` wires them.

Run `npm test`, `npm run format:check` (Prettier; `npm run format` fixes it), `npm run build`, `cargo fmt --check`, `cargo clippy --release --locked --all-targets -- -D warnings` and `cargo test --release --locked` (the last three in `src-tauri`). `npm run audit:rust` needs network access. On Windows, `npm run test:e2e` drives the release build end to end; it sends real key presses, so run it only when the user agrees.

Never lose a board: writes stay atomic (temporary file, then rename), a damaged file is set aside and never deleted, and clearing the board archives it first. The scratch pad (`Ctrl+T`) lives only in memory and is never written anywhere. Keep the saved format backward compatible; `parseBoard` must accept every older board. Settings saved by the page live in `ui` and are opaque to Rust.

Interface text is in `src/lib/i18n.ts` in English and Italian, short and concrete, without long dashes. The tray strings are in `src-tauri/src/text.rs`, the macOS menu in `src-tauri/src/macos.rs`. The default shortcut differs on macOS (`⇧⌘Space`); keep `hotkey.rs` and `defaultShortcut()` in `src/lib/shortcut.ts` in step.

The window-state plugin must only be called on the main thread (it holds a lock while querying the window). Launch at login is set up from `autostart.rs` only; never from development builds, custom data folders or temporary locations.

Test with `APPUNTO_DATA_DIR` pointing to a scratch folder so real notes and the system's startup list stay untouched. Only Windows is tested by hand so far; say so instead of claiming macOS or Linux behavior you could not check. Keep credentials, real notes and generated files out of commits.
