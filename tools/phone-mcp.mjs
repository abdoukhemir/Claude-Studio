// Claude's phone tools (an MCP server over stdio). Studio starts every tab with it, so Claude can
// see and use the emulator or phone the user watches in the Phone panel.
import * as P from './phone-lib.mjs';

const INSTRUCTIONS = `Phone tools: an Android emulator (or the user's phone) that the user watches live in Studio's Phone panel.
- screen: a screenshot. All x/y coordinates in these tools are pixels of that screenshot.
- ui: the texts and buttons on screen with their centre x/y (faster to aim with than guessing).
- tap (x/y, or text: taps the element showing that text), long_press, swipe (or direction), type, key (back, home, enter...).
- Actions return a fresh screenshot after a short pause, so you rarely need to call screen again.
- logs: app logs (React Native JS logs and crashes by default). open: an app package or a link. shell: any adb shell command.
- emulator_start / emulator_stop: the emulator runs without its own window; the user sees it in the Phone panel. Stop it when you are done if the PC is short of memory.`;

const xy = { x: { type: 'number' }, y: { type: 'number' } };
const after = { screen: { type: 'boolean', description: 'Return a screenshot afterwards (default true)' }, wait: { type: 'number', description: 'Milliseconds to wait before that screenshot (default 700)' } };
const TOOLS = [
  { name: 'devices', description: 'Connected phones/emulators, the one in use, and the emulators that can be started.', inputSchema: { type: 'object', properties: {} } },
  { name: 'use_device', description: 'Choose which connected device the tools and the Phone panel use (serial from devices).', inputSchema: { type: 'object', properties: { serial: { type: 'string' } }, required: ['serial'] } },
  { name: 'emulator_start', description: 'Start the Android emulator (about 1 minute) and wait until it is ready.', inputSchema: { type: 'object', properties: { avd: { type: 'string', description: 'Emulator name (optional)' } } } },
  { name: 'emulator_stop', description: 'Shut the emulator down.', inputSchema: { type: 'object', properties: {} } },
  { name: 'screen', description: 'Screenshot of the device. Coordinates in all tools are pixels of this image.', inputSchema: { type: 'object', properties: {} } },
  { name: 'ui', description: 'Texts, labels and buttons on the screen with their centre x/y in screenshot pixels.', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Only elements whose text/label contains this' } } } },
  { name: 'tap', description: 'Tap at x/y (screenshot pixels), or on the element showing `text`.', inputSchema: { type: 'object', properties: { ...xy, text: { type: 'string' }, ...after } } },
  { name: 'long_press', description: 'Press and hold at x/y, or on the element showing `text`.', inputSchema: { type: 'object', properties: { ...xy, text: { type: 'string' }, ms: { type: 'number' }, ...after } } },
  { name: 'swipe', description: 'Swipe from x1/y1 to x2/y2, or give direction up/down/left/right ("up" scrolls the content down).', inputSchema: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, ms: { type: 'number' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, ...after } } },
  { name: 'type', description: 'Type text into the focused field (tap the field first). ASCII only; \\n presses Enter.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, ...after }, required: ['text'] } },
  { name: 'key', description: `Press a key: ${Object.keys(P.KEYS).join(', ')}, or an Android key code number.`, inputSchema: { type: 'object', properties: { key: { type: 'string' }, ...after }, required: ['key'] } },
  { name: 'open', description: 'Open an app by package name (e.g. com.potalang.app) or a link (https://..., myapp://...).', inputSchema: { type: 'object', properties: { target: { type: 'string' }, ...after }, required: ['target'] } },
  { name: 'logs', description: 'Recent device logs. Default: React Native JS logs and crashes. filter uses logcat syntax (e.g. "*:E").', inputSchema: { type: 'object', properties: { filter: { type: 'string' }, lines: { type: 'number' }, clear: { type: 'boolean' } } } },
  { name: 'shell', description: 'Run an adb shell command on the device and return its output.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (t) => ({ type: 'text', text: t });
async function shot(note) {
  const s = await P.screen();
  return [text(`${note ? `${note}\n` : ''}Screen of ${s.serial}: ${s.width}x${s.height} (coordinates are in these pixels).`), { type: 'image', data: s.png.toString('base64'), mimeType: 'image/png' }];
}
async function then(a, note) {
  if (a.screen === false) return [text(note)];
  await sleep(Math.max(0, Math.min(10000, a.wait ?? 700)));
  return shot(note);
}
async function target(a) {
  if (a.text) {
    const el = await P.find(a.text);
    if (!el) throw new Error(`Nothing on the screen shows "${a.text}". Call ui to see the texts, or tap by x/y.`);
    return el;
  }
  if (typeof a.x !== 'number' || typeof a.y !== 'number') throw new Error('Give x and y, or text.');
  return { x: a.x, y: a.y };
}

async function call(name, a = {}) {
  switch (name) {
    case 'devices': {
      const list = await P.devices();
      const cur = await P.current(list);
      return [text(JSON.stringify({ inUse: cur?.serial ?? null, devices: list, emulators: await P.avds(), emulatorStarting: P.emulatorStarting() }, null, 1))];
    }
    case 'use_device':
      P.choose(a.serial);
      return [text(`Using ${a.serial}.`)];
    case 'emulator_start': {
      const r = await P.emulatorStart(a.avd);
      P.choose(r.serial);
      return shot(r.already ? `The emulator was already running (${r.serial}).` : `The emulator is ready (${r.serial}).`);
    }
    case 'emulator_stop':
      return [text((await P.emulatorStop()) ? 'The emulator is shutting down.' : 'No emulator was running.')];
    case 'screen':
      return shot();
    case 'ui': {
      const f = (a.filter ?? '').toLowerCase();
      const items = (await P.ui()).filter((x) => !f || `${x.text} ${x.desc}`.toLowerCase().includes(f));
      const lines = items.map((x) => `(${x.x},${x.y}) ${x.clickable ? '[button] ' : ''}${x.text || x.desc}${x.text && x.desc && x.desc !== x.text ? ` | ${x.desc}` : ''}${x.id ? `  #${x.id}` : ''}`);
      return [text(lines.join('\n') || 'No texts or buttons found (the screen may be a game canvas or still loading): use screen.')];
    }
    case 'tap': {
      const t = await target(a);
      await P.tap(t.x, t.y);
      return then(a, `Tapped (${t.x},${t.y})${a.text ? ` on "${t.text || t.desc}"` : ''}.`);
    }
    case 'long_press': {
      const t = await target(a);
      await P.longPress(t.x, t.y, undefined, a.ms ?? 800);
      return then(a, `Held (${t.x},${t.y}).`);
    }
    case 'swipe':
      if (a.direction) await P.swipeDir(a.direction);
      else await P.swipe(a.x1, a.y1, a.x2, a.y2, a.ms ?? 300);
      return then(a, 'Swiped.');
    case 'type':
      await P.type(a.text);
      return then(a, 'Typed.');
    case 'key':
      await P.key(a.key);
      return then(a, `Pressed ${a.key}.`);
    case 'open':
      await P.open(a.target);
      return then({ wait: 1500, ...a }, `Opened ${a.target}.`);
    case 'logs':
      return [text(await P.logs(a))];
    case 'shell':
      return [text((await P.shell(a.command)) || '(no output)')];
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------- MCP over stdio: one JSON-RPC message per line ----------
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'phone', version: '1.0.0' }, instructions: INSTRUCTIONS } });
    if (method === 'ping') return send({ id, result: {} });
    if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      try {
        return send({ id, result: { content: await call(params.name, params.arguments ?? {}) } });
      } catch (err) {
        return send({ id, result: { content: [text(String(err.message ?? err))], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    send({ id, error: { code: -32603, message: String(err.message ?? err) } });
  }
}
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let i;
  while ((i = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, i).trim();
    pending = pending.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {}
  }
});
process.stdin.on('end', () => process.exit(0));
