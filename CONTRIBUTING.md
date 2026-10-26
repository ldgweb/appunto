# Contributing

Thanks for taking a look. Small fixes are welcome as they are. For anything bigger, please open an issue first, so we can agree on it before you spend time on it.

Appunto should stay small: one board, text with drawing on top, a toolbar that fits in a small window. I'll likely say no to accounts, sync, AI features or more boards. Changes that make the everyday path quicker are the easiest to take.

## Setup

Follow "Building it" in the [README](README.md#building-it). To try a change without touching your own board, point the app at a scratch folder:

```powershell
$env:APPUNTO_DATA_DIR = "$env:TEMP\appunto-dev"; npm run tauri:dev
```

On macOS and Linux: `APPUNTO_DATA_DIR=/tmp/appunto-dev npm run tauri:dev`. Development builds and custom folders never change the login entry of the installed app.

## Where things are

- `src-tauri/src/`: the native side. Window, global shortcut, tray, launch at login, files.
- `src/lib/`: logic with no DOM, covered by the tests in `tests/`.
- `src/ui/` and `src/main.ts`: the page.

## Before a pull request

```bash
npm test
npm run format:check
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --release --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
```

`npm audit` and `npm run audit:rust` check the dependencies, and need internet. On Windows, `npm run test:e2e` drives the built app for about a minute. It presses real keys, so set `E2E_NO_KEYS=1` if you're using the PC meanwhile. It needs PowerShell 7.

New logic comes with a test, and a bug fix with a test that fails without it. Interface text lives in `src/lib/i18n.ts`, in English and Italian. In the description, say what changed and how you tested it, and please don't claim it works on a system you haven't tried. Keep credentials and real notes out of commits and issues.

## Icons

They're generated from `src-tauri/icons/app-icon.svg` with `npx tauri icon src-tauri/icons/app-icon.svg`. Delete the Android, iOS and Store files it also writes. The macOS menu bar uses `tray-template.png`, a 64 px render of `tray-template.svg`.

## Releases

A `v*` tag builds the packages and creates a draft release, which I install by hand before publishing. The tag must match the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`. `npm run check:version -- v0.1.0` checks them.
