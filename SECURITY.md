# Security

## What Appunto does

It runs with your user's permissions and never goes online by itself. The only link is the project page in Settings, which opens in your browser when you click it.

The page inside the window can only call the app's own commands, such as loading and saving the board, changing settings or listing fonts. It has no access to files or the shell, and its content security policy blocks remote content and inline code.

Outside its data folder, Appunto writes in two places:

- The login entry, while Start with the system is on. On Windows that's the `Appunto` value under `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, plus its on/off flag under `...\Explorer\StartupApproved\Run`. On macOS it's `~/Library/LaunchAgents/Appunto.plist`, on Linux `~/.config/autostart/Appunto.desktop`. Development builds and copies with a custom data folder never touch it.
- The web view's cache, where the system keeps it. On Windows that's `%LOCALAPPDATA%\io.github.ldgweb.appunto`.

The scratch pad is never written anywhere.

## Your notes

They're plain JSON files in your user folder. On macOS and Linux only your user can read them. They aren't encrypted, so keep passwords somewhere made for them.

## Dependencies

`npm audit` and `npm run audit:rust` check them. The Rust check looks up every crate in `src-tauri/Cargo.lock` on OSV and fails on vulnerabilities in what ships, unless `scripts/audit-allowlist.json` says why one doesn't apply.

As of October 2026 it lists five informational advisories. They're all Linux only and all inside Tauri's own dependencies, so they can't be updated from here: [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) come with GTK 3, [RUSTSEC-2026-0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html), [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html) and [RUSTSEC-2026-0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html) with zbus 5. They'll go away when Tauri moves to newer versions.

## Reporting a vulnerability

Please use [private vulnerability reporting](https://github.com/ldgweb/appunto/security/advisories/new), not a public issue. If that doesn't work for some reason, open an issue asking for a contact, without the details.
