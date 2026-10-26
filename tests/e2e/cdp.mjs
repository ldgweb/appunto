// Minimal Chrome DevTools Protocol client for WebView2 (Node 22 global WebSocket).
export async function waitForTarget(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return { page, elapsed: Date.now() - start };
    } catch {}
    await sleep(100);
  }
  throw new Error('No CDP target');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  // The app may quit before it answers (quit_app): fail the calls still waiting.
  ws.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error('CDP connection closed'));
    pending.clear();
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error('CDP connection closed'));
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Eval failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const key = async (key, code, vk, modifiers = 0, text) => {
    await send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
      text,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    });
  };
  const mouse = (type, x, y, button = 'left', buttons = 1) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      buttons: type === 'mouseReleased' ? 0 : buttons,
      clickCount: 1,
    });
  const drag = async (points, button = 'left') => {
    const buttons = button === 'right' ? 2 : 1;
    const [first, ...rest] = points;
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: first[0],
      y: first[1],
      button: 'none',
      buttons: 0,
    });
    await mouse('mousePressed', first[0], first[1], button, buttons);
    for (const [x, y] of rest) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons });
      await sleep(8);
    }
    const last = points[points.length - 1];
    await mouse('mouseReleased', last[0], last[1], button, buttons);
  };
  const click = async (x, y) => {
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
  };
  return { ws, send, evaluate, key, drag, click, close: () => ws.close() };
}
