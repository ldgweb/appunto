// End-to-end check of the real app on Windows: typing, lists, drawing, fonts,
// settings, the global shortcut, a second launch, quit and restart.
//
// The page is driven through WebView2's DevTools protocol; the shortcut, Esc
// and two letters go through the real keyboard input of Windows, so leave
// the keyboard alone for the minute it runs. Letters are only sent while the
// board is the window in front. Everything happens in a scratch data folder:
// real notes and the startup list stay untouched.
//
// Usage: npm run test:e2e [-- <appunto.exe> [<scratch-data-dir>]]
// Default: the release build in src-tauri/target/release.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as absolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep, waitForTarget } from './cdp.mjs';
import { freshScratchDir } from './scratch.mjs';

if (process.platform !== 'win32') {
  console.error('The end-to-end run drives WebView2 and Windows input: Windows only.');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
// E2E_NO_KEYS=1 skips the shortcut and Esc checks, for a machine in use.
const noKeys = process.env.E2E_NO_KEYS === '1';
const exe = process.argv[2] ?? join(here, '..', '..', 'src-tauri', 'target', 'release', 'appunto.exe');
const dataDir = process.argv[3] ?? join(tmpdir(), 'appunto-e2e');
const port = 9333;
const shots = join(dataDir, '..', 'appunto-e2e-shots');
if (!existsSync(exe)) {
  console.error(`${exe} not found. Build it first: npm run tauri:build`);
  process.exit(2);
}
mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
}

function win(action, pid, text) {
  const args = ['-NoProfile', '-File', join(here, 'win.ps1'), '-Action', action, '-ProcessId', String(pid)];
  if (text) args.push('-Text', text);
  return execFileSync('pwsh', args, { encoding: 'utf8' }).trim();
}
const windowState = (pid) => JSON.parse(win('state', pid));
const readJson = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'));

async function waitFor(fn, timeoutMs = 3000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await sleep(stepMs);
  }
  return null;
}

async function launch(args = []) {
  const env = {
    ...process.env,
    APPUNTO_DATA_DIR: dataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  };
  const started = Date.now();
  const child = spawn(exe, args, { env, stdio: 'ignore' });
  const { page } = await waitForTarget(port);
  const cdp = await connect(page.webSocketDebuggerUrl);
  const readyAt = await waitFor(
    async () => ((await cdp.evaluate(`document.documentElement.dataset.ready === 'true'`)) ? Date.now() - started : 0),
    10000,
    10,
  );
  return { child, cdp, readyAt };
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(shots, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

function processTree(rootPid) {
  const json = execFileSync(
    'pwsh',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const all = JSON.parse(json);
  const tree = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    for (const p of all) {
      if (p.ProcessId === pid) tree.push(p);
      if (p.ParentProcessId === pid) queue.push(p.ProcessId);
    }
  }
  return [...new Map(tree.map((p) => [p.ProcessId, p])).values()];
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------------------

freshScratchDir(dataDir);

let { child, cdp, readyAt } = await launch();
console.log(`cold start: page ready after ${readyAt} ms`);
const pid = child.pid;
const text = (expr) => cdp.evaluate(`(() => { const t = document.getElementById('text'); return ${expr}; })()`);

// First run
const lang = await cdp.evaluate('document.documentElement.lang');
const welcome = await text('t.value');
check('first run shows the guide', /^(Questo è|This is) Appunto/.test(welcome), `lang=${lang}`);
check('guide shows the real shortcut', welcome.includes('Ctrl+Alt+Space'));
// Generous: right after a cold start WebView2 may still be busy.
const savedWelcome = await waitFor(
  () => existsSync(join(dataDir, 'board.json')) && readJson('board.json').text === welcome,
  8000,
);
check('guide is saved on first run', Boolean(savedWelcome));
const settings = readJson('settings.json');
check('settings file has defaults', settings.shortcut === 'Ctrl+Alt+Space' && settings.alwaysOnTop === false);
// An installed copy may have its own entry; this build must not point it here.
const loginEntry = execFileSync(
  'pwsh',
  [
    '-NoProfile',
    '-Command',
    "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue).Appunto",
  ],
  { encoding: 'utf8' },
).trim();
check(
  'custom data folder does not register autostart',
  !loginEntry.toLowerCase().includes(absolute(exe).toLowerCase()),
  loginEntry,
);
await screenshot(cdp, '01-first-run');

// Typing and autosave
await text('(t.focus(), t.select(), true)');
await cdp.send('Input.insertText', { text: 'Richiamare Alex per l’offerta Acme' });
const typed = await waitFor(() => readJson('board.json').text === 'Richiamare Alex per l’offerta Acme', 3000);
check('typed text is saved within a second', Boolean(typed));

// Lists continue on Enter, and stop on an empty item
await cdp.send('Input.insertText', { text: '\n- latte' });
await cdp.key('Enter', 'Enter', 13, 0, '\r');
check('Enter continues a list', (await text('t.value')).endsWith('- latte\n- '));
await cdp.send('Input.insertText', { text: 'uova' });
await cdp.key('Enter', 'Enter', 13, 0, '\r');
await cdp.key('Enter', 'Enter', 13, 0, '\r');
check('Enter on an empty item ends the list', (await text('t.value')).endsWith('- uova\n'));

// Native undo still works after a list edit
await cdp.key('z', 'KeyZ', 90, 2);
check('Ctrl+Z undoes the last list edit', (await text('t.value')).endsWith('- uova\n- '));
await cdp.key('Enter', 'Enter', 13, 0, '\r');

// F5 writes the date
await cdp.key('F5', 'F5', 116);
const stamped = await text('t.value');
check(
  'F5 writes date and time',
  /\d{1,2}[/.]\d{1,2}[/.]\d{2,4}.*\d{1,2}[:.]\d{2}/.test(stamped.slice(-30)),
  stamped.slice(-20),
);

// Drawing
await cdp.key('d', 'KeyD', 68, 2);
check('Ctrl+D enters drawing mode', await cdp.evaluate(`document.getElementById('app').classList.contains('drawing')`));
const stroke = Array.from({ length: 24 }, (_, i) => [120 + i * 8, 330 + Math.sin(i / 3) * 14]);
await cdp.drag(stroke);
const drawn = await waitFor(() => readJson('board.json').strokes.length === 1, 3000);
check('a stroke is drawn and saved', Boolean(drawn));
await screenshot(cdp, '02-drawing');

await cdp.drag(
  [
    [200, 300],
    [200, 360],
  ],
  'right',
);
const erased = await waitFor(() => readJson('board.json').strokes.length === 0, 3000);
check('right drag erases the stroke', Boolean(erased));
await cdp.key('z', 'KeyZ', 90, 2);
const undone = await waitFor(() => readJson('board.json').strokes.length === 1, 3000);
check('Ctrl+Z brings the stroke back', Boolean(undone));

await cdp.key('e', 'KeyE', 69, 2);
check('Ctrl+E selects the eraser', await cdp.evaluate(`document.getElementById('app').classList.contains('erasing')`));
await cdp.drag([
  [180, 300],
  [180, 370],
]);
check('eraser removes the stroke', Boolean(await waitFor(() => readJson('board.json').strokes.length === 0, 3000)));
await cdp.key('z', 'KeyZ', 90, 2);
await cdp.key('e', 'KeyE', 69, 2);
check(
  'Ctrl+E again goes back to writing',
  !(await cdp.evaluate(`document.getElementById('app').classList.contains('drawing')`)),
);

await cdp.key('d', 'KeyD', 68, 2);
await cdp.key('x', 'KeyX', 88, 0, 'x');
const afterTyping = await text('t.value');
check(
  'typing while drawing goes back to the text',
  afterTyping.endsWith('x') && !(await cdp.evaluate(`document.getElementById('app').classList.contains('drawing')`)),
);
await cdp.key('Backspace', 'Backspace', 8);

// Text size
await cdp.key('+', 'Equal', 187, 2);
const size = await cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--size').trim()`);
check('Ctrl + makes the text larger', size === '24px', size);
check('text size is saved', Boolean(await waitFor(() => readJson('settings.json').ui.fontSize === 24, 3000)));
await cdp.key('0', 'Digit0', 48, 2);

// Font menu
const fontButton = await cdp.evaluate(
  `(() => { const r = document.getElementById('tool-font').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
);
await cdp.click(fontButton[0], fontButton[1]);
check('Aa opens the font menu', await cdp.evaluate(`!!document.querySelector('.popover [role=listbox]')`));
await screenshot(cdp, '03-font-menu');
const caveat = await cdp.evaluate(
  `(() => { const b = [...document.querySelectorAll('.popover [role=option]')].find(o => o.textContent === 'Caveat'); const r = b.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`,
);
await cdp.click(caveat[0], caveat[1]);
const font = await cdp.evaluate(`getComputedStyle(document.getElementById('text')).fontFamily`);
check('picking Caveat changes the font', font.includes('Caveat'), font);
const installed = await cdp.evaluate(
  `(() => { const b = [...document.querySelectorAll('.popover .pop-link')][0]; b.click(); return true; })()`,
);
const families = await waitFor(
  () => cdp.evaluate(`document.querySelectorAll('.popover .pop-scroll [role=option]').length`),
  8000,
);
check('installed fonts are listed', installed && families > 5, `${families} shown`);
await cdp.key('Escape', 'Escape', 27);
check('Esc closes the menu', !(await cdp.evaluate(`!!document.querySelector('.popover')`)));
await sleep(500);
check('font choice is saved', readJson('settings.json').ui.font === 'script');

// Chalk menu: picking a color starts drawing with it
await cdp.evaluate(`document.getElementById('tool-pen-style').click()`);
check('the chalk menu opens', await cdp.evaluate(`document.querySelectorAll('.popover .swatch').length === 6`));
await cdp.evaluate(`document.querySelectorAll('.popover .swatch')[3].click()`);
check(
  'picking a chalk color switches to drawing',
  await cdp.evaluate(`document.getElementById('app').classList.contains('drawing')`),
);
await cdp.key('Escape', 'Escape', 27);
check('chalk color is saved', Boolean(await waitFor(() => readJson('settings.json').ui.penColor === 3, 3000)));
await cdp.key('d', 'KeyD', 68, 2);

// Settings panel
await cdp.key(',', 'Comma', 188, 2);
check('Ctrl+, opens settings', await cdp.evaluate(`!!document.querySelector('.panel')`));
const keyLabel = await cdp.evaluate(`document.querySelector('[data-key=shortcut]').textContent`);
check('settings show the shortcut', keyLabel === 'Ctrl+Alt+Space', keyLabel);
check(
  'a scratch copy cannot change launch at login',
  await cdp.evaluate(`document.querySelector('[data-key=autostart]').disabled`),
);
await screenshot(cdp, '04-settings');
await cdp.evaluate(`document.querySelector('[data-key=theme-white]').click()`);
check(
  'white theme switches the chrome to light',
  (await cdp.evaluate('document.documentElement.dataset.theme')) === 'light',
);
await screenshot(cdp, '05-white');
await cdp.evaluate(`document.querySelector('[data-key=theme-black]').click()`);

// New board keeps an archive and can be undone
const beforeNew = await text('t.value');
await cdp.evaluate(`document.querySelector('[data-key=new-board]').click()`);
const archived = await waitFor(
  () => existsSync(join(dataDir, 'archive')) && readdirSync(join(dataDir, 'archive')).length === 1,
  3000,
);
check('New board archives the old one', Boolean(archived));
check('New board clears the board', Boolean(await waitFor(async () => (await text('t.value')) === '', 3000)));
await waitFor(() => cdp.evaluate(`!!document.querySelector('.toast:not([hidden]) button')`), 3000);
await cdp.evaluate(`document.querySelector('.toast button').click()`);
check('Undo brings the board back', (await text('t.value')) === beforeNew);

// Undo after writing on the new board: what was written goes to the archive.
await cdp.key(',', 'Comma', 188, 2);
await cdp.evaluate(`document.querySelector('[data-key=new-board]').click()`);
await waitFor(async () => (await text('t.value')) === '', 3000);
await text('(t.focus(), true)');
await cdp.send('Input.insertText', { text: 'written on the new board' });
await waitFor(() => cdp.evaluate(`!!document.querySelector('.toast:not([hidden]) button')`), 3000);
await cdp.evaluate(`document.querySelector('.toast button').click()`);
check(
  'Undo after writing brings the board back',
  Boolean(await waitFor(async () => (await text('t.value')) === beforeNew, 3000)),
);
const archivedText = await waitFor(() => {
  const files = readdirSync(join(dataDir, 'archive'));
  return files.length === 3 && files.some((f) => readJson(join('archive', f)).text === 'written on the new board');
}, 3000);
check('what was written is in the archive', Boolean(archivedText));
await cdp.key('0', 'Digit0', 48, 2);

// Scratch pad: kept in memory, never written to disk
await cdp.key('t', 'KeyT', 84, 2);
check(
  'Ctrl+T opens the scratch pad, ready for typing',
  await cdp.evaluate(
    `document.getElementById('app').classList.contains('on-scratch') && document.activeElement.id === 'scratch'`,
  ),
);
await cdp.send('Input.insertText', { text: 'parked for a moment' });
await cdp.key('s', 'KeyS', 83, 2);
await sleep(1500);
const onDisk = ['board.json', 'settings.json', ...readdirSync(join(dataDir, 'archive')).map((f) => join('archive', f))]
  .map((f) => JSON.stringify(readJson(f)))
  .join('\n');
check('the scratch pad is never saved', !onDisk.includes('parked for a moment'));
await cdp.key('t', 'KeyT', 84, 2);
check('Ctrl+T goes back to the board as it was', (await text('t.value')) === beforeNew);
await cdp.key('t', 'KeyT', 84, 2);
check(
  'the scratch pad keeps its text while the app runs',
  (await cdp.evaluate(`document.getElementById('scratch').value`)) === 'parked for a moment',
);
await cdp.key('t', 'KeyT', 84, 2);

// Global shortcut, through real key presses at the OS level. Only when the
// app owns the shortcut: otherwise the keys would reach another window.
await sleep(300);
const boot = await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('bootstrap')`);
check('the global shortcut is registered', boot.native.shortcutError === null, String(boot.native.shortcutError));
if (boot.native.shortcutError !== null) {
  console.log('Stopping before the OS-level tests.');
  await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('quit_app')`).catch(() => {});
  process.exit(1);
}
check('window is visible after start', windowState(pid).visible);
if (noKeys) {
  console.log('  E2E_NO_KEYS=1: skipping the checks that press keys through Windows.');
  await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('hide_window')`);
  await sleep(400);
  check('the board hides', !windowState(pid).visible);
} else {
  await keyboardChecks();
}

async function keyboardChecks() {
  let s = windowState(pid);
  if (!s.foreground) {
    // Started from a background process, Windows may leave it behind: the
    // shortcut must bring a visible board to the front rather than hide it.
    win('hotkey', pid);
    await sleep(500);
    s = windowState(pid);
    check('shortcut brings a board behind other windows to the front', s.visible && s.foreground, JSON.stringify(s));
  }
  win('hotkey', pid);
  await sleep(500);
  s = windowState(pid);
  check('shortcut hides the board when it is in front', !s.visible, JSON.stringify(s));
  win('hotkey', pid);
  await sleep(500);
  s = windowState(pid);
  check('shortcut shows the hidden board in front', s.visible && s.foreground, JSON.stringify(s));
  const beforeKeys = await text('t.value');
  console.log('  typing through the OS:', win('type', pid, 'ok'));
  await sleep(300);
  const afterKeys = await text('t.value');
  check(
    'keys go straight into the board after the shortcut',
    afterKeys.length === beforeKeys.length + 2 && afterKeys.toLowerCase().includes('ok'),
    JSON.stringify(afterKeys.slice(-12)),
  );
  console.log('  Esc through the OS:', win('escape', pid));
  await sleep(400);
  check('Esc hides the board', !windowState(pid).visible);
}

// A second launch with --toggle wakes the running board
const second = spawn(exe, ['--toggle'], { env: { ...process.env, APPUNTO_DATA_DIR: dataDir }, stdio: 'ignore' });
const secondExit = await new Promise((resolve) => second.on('exit', resolve));
await sleep(500);
check('second launch exits and shows the running board', windowState(pid).visible, `exit code ${secondExit}`);

// Resource use
await sleep(2000);
const tree = processTree(pid);
const ws = tree.reduce((n, p) => n + Number(p.WorkingSetSize), 0);
const priv = tree.reduce((n, p) => n + Number(p.PrivatePageCount), 0);
console.log(`processes: ${tree.map((p) => p.Name).join(', ')}`);
console.log(`memory: working set ${mb(ws)}, private ${mb(priv)}`);

// Quit cleanly, then start again
const rectBefore = windowState(pid).rect;
const finalText = await text('t.value');
await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('quit_app')`).catch(() => {});
const exited = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 5000);
  child.on('exit', () => {
    clearTimeout(timer);
    resolve(true);
  });
});
check('quit closes the app', exited);
check('window position is saved', existsSync(join(dataDir, 'window-state.json')));

({ child, cdp, readyAt } = await launch());
console.log(`warm start: page ready after ${readyAt} ms`);
check('notes survive a restart', (await text('t.value')) === finalText);
await sleep(600);
check(
  'window comes back in the same place',
  windowState(child.pid).rect === rectBefore,
  `${rectBefore} -> ${windowState(child.pid).rect}`,
);
await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('quit_app')`).catch(() => {});
await sleep(1000);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
