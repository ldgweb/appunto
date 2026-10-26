// Builds the README screenshot: a sample board (invented names), a few
// strokes drawn through the real drawing layer, captured through DevTools.
// Windows only, like run.mjs. Usage:
//   node tests/e2e/screenshot.mjs [<appunto.exe> [<scratch-data-dir> [<output.png>]]]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep, waitForTarget } from './cdp.mjs';
import { freshScratchDir } from './scratch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = process.argv[2] ?? join(root, 'src-tauri', 'target', 'release', 'appunto.exe');
const dataDir = freshScratchDir(process.argv[3] ?? join(tmpdir(), 'appunto-screenshot'));
const output = process.argv[4] ?? join(root, '.github', 'assets', 'board.png');

const text = [
  'Call Alex back about the Acme offer',
  'Invoice to Alba Hotels by Friday',
  '',
  '- [ ] update the price list',
  '- [ ] book the meeting room',
  '- [x] slides for Sam',
  '',
  'Sam’s desk phone: 7731',
].join('\n');
writeFileSync(join(dataDir, 'board.json'), JSON.stringify({ format: 1, text, strokes: [] }));
writeFileSync(
  join(dataDir, 'settings.json'),
  JSON.stringify({
    shortcut: 'Ctrl+Alt+Space',
    alwaysOnTop: false,
    startHidden: false,
    language: 'en',
    ui: { font: 'hand', fontSize: 23, theme: 'black', textColor: 0, penColor: 1, penSize: 5 },
  }),
);
const state = {
  width: 500,
  height: 440,
  x: 700,
  y: 260,
  prev_x: 700,
  prev_y: 260,
  maximized: false,
  visible: true,
  decorated: false,
  fullscreen: false,
};
writeFileSync(join(dataDir, 'window-state.json'), JSON.stringify({ main: state }));

const env = {
  ...process.env,
  APPUNTO_DATA_DIR: dataDir,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9333',
};
const child = spawn(exe, [], { env, stdio: 'ignore' });
const { page } = await waitForTarget(9333);
const cdp = await connect(page.webSocketDebuggerUrl);
for (let i = 0; i < 400; i++) {
  const ready = await cdp.evaluate(`document.documentElement?.dataset.ready === 'true'`).catch(() => false);
  if (ready) break;
  await sleep(25);
}
await sleep(500);

// Where a word sits inside the textarea, measured on a mirror with the same styles.
const wordBox = (word) =>
  cdp.evaluate(`(() => {
    const t = document.getElementById('text');
    const s = getComputedStyle(t);
    const m = document.createElement('div');
    for (const p of ['font-family','font-size','line-height','padding-top','padding-left','padding-right','white-space','overflow-wrap','letter-spacing','tab-size']) m.style.setProperty(p, s.getPropertyValue(p));
    const r = t.getBoundingClientRect();
    Object.assign(m.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: t.clientWidth + 'px', visibility: 'hidden', boxSizing: 'border-box' });
    const i = t.value.indexOf(${JSON.stringify(word)});
    m.append(t.value.slice(0, i));
    const span = document.createElement('span');
    span.textContent = ${JSON.stringify(word)};
    m.append(span, t.value.slice(i + ${word.length}));
    document.body.append(m);
    const b = span.getBoundingClientRect();
    m.remove();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  })()`);

await cdp.key('d', 'KeyD', 68, 2);

// A wobbly underline under "Friday", in yellow chalk.
const friday = await wordBox('Friday');
const underline = Array.from({ length: 18 }, (_, i) => [
  friday.x - 4 + (i * (friday.w + 10)) / 17,
  friday.y + friday.h - 1 + Math.sin(i * 0.9) * 1.6,
]);
await cdp.drag(underline);

// A loose ring around the phone number.
const code = await wordBox('7731');
const cx = code.x + code.w / 2;
const cy = code.y + code.h / 2 + 1;
const ring = Array.from({ length: 34 }, (_, i) => {
  const a = -0.4 + (i / 33) * Math.PI * 2.15;
  return [cx + Math.cos(a) * (code.w / 2 + 14), cy + Math.sin(a) * (code.h / 2 + 4)];
});
await cdp.drag(ring);

// A small arrow from the right margin to "Call Alex", in pink.
await cdp.evaluate(`(() => { document.querySelectorAll('#tool-pen-style')[0].click(); })()`);
await sleep(200);
await cdp.evaluate(`document.querySelectorAll('.popover .swatch')[2].click()`);
await cdp.key('Escape', 'Escape', 27);
const call = await wordBox('Acme offer');
const startX = call.x + call.w + 70;
const startY = call.y + call.h + 34;
const endX = call.x + call.w + 10;
const endY = call.y + call.h / 2 + 2;
const shaft = Array.from({ length: 16 }, (_, i) => {
  const t = i / 15;
  return [
    startX + (endX - startX) * t + Math.sin(t * Math.PI) * 6,
    startY + (endY - startY) * t - Math.sin(t * Math.PI) * 10,
  ];
});
await cdp.drag(shaft);
await cdp.drag([
  [endX + 13, endY - 7],
  [endX + 6, endY - 2],
  [endX, endY],
  [endX + 4, endY + 6],
  [endX + 9, endY + 13],
]);

// Back to writing, caret at the end, toolbar at rest.
await cdp.key('d', 'KeyD', 68, 2);
await cdp.evaluate(`(() => { const t = document.getElementById('text'); t.blur(); return true; })()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 430, button: 'none', buttons: 0 });
await sleep(700);
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(output, Buffer.from(data, 'base64'));
console.log('saved', output);
await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('quit_app')`).catch(() => {});
await new Promise((r) => child.on('exit', r));
