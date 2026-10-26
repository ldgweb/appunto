// Copies the packages built by `tauri build` into release-files/, with plain
// file names (no spaces), and adds a portable ZIP on Windows.
// Usage: node scripts/collect-release.mjs windows|macos|linux
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const platform = process.argv[2];
if (!['windows', 'macos', 'linux'].includes(platform)) {
  console.error('Usage: node scripts/collect-release.mjs windows|macos|linux');
  process.exit(2);
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
// It ends up in file names and in a PowerShell command.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`Unexpected version in package.json: ${version}`);
  process.exit(1);
}
const out = 'release-files';
const release = platform === 'macos' ? 'src-tauri/target/universal-apple-darwin/release' : 'src-tauri/target/release';
const bundle = join(release, 'bundle');
const plain = (name) => name.replaceAll('Appunto', 'appunto').replaceAll(' ', '-');

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const collected = [];

function take(folder, extension) {
  const dir = join(bundle, folder);
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(extension)) continue;
    cpSync(join(dir, file), join(out, plain(file)));
    collected.push(plain(file));
  }
}

if (platform === 'windows') {
  take('nsis', '.exe');
  // Portable build: the executable alone runs anywhere WebView2 is installed,
  // which is every Windows 10 and 11 machine with updates.
  const staging = 'release-portable';
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  for (const file of [join(release, 'appunto.exe'), 'LICENSE.md', 'THIRD-PARTY-NOTICES.md', 'README.md']) {
    cpSync(file, join(staging, basename(file)));
  }
  const zip = `appunto_${version}_windows-x64-portable.zip`;
  const compress = `Compress-Archive -Path '${staging}/*' -DestinationPath '${join(out, zip)}' -Force`;
  execFileSync('pwsh', ['-NoProfile', '-Command', compress], { stdio: 'inherit' });
  rmSync(staging, { recursive: true, force: true });
  collected.push(zip);
} else if (platform === 'macos') {
  take('dmg', '.dmg');
} else {
  take('deb', '.deb');
  take('rpm', '.rpm');
  take('appimage', '.AppImage');
}

if (collected.length === 0) {
  console.error(`No packages found under ${bundle}`);
  process.exit(1);
}
console.log(collected.join('\n'));
