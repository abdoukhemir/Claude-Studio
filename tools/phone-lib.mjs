// The phone or emulator, through adb: shared by Studio's Phone panel and Claude's phone tools
// (phone-mcp.mjs), so both always use the same device.
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'AppData/Local/Android/Sdk');
export const ADB = path.join(SDK, 'platform-tools/adb.exe');
const EMULATOR = path.join(SDK, 'emulator/emulator.exe');
const CHOICE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'data', 'phone.json');

const run = (exe, args, { buffer = false, timeout = 30000 } = {}) =>
  new Promise((resolve, reject) =>
    execFile(exe, args, { encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 128 * 1024 * 1024, timeout, windowsHide: true }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim())) : resolve(out),
    ),
  );
const adb = (serial, args, opts) => run(ADB, ['-s', serial, ...args], opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Emulators that can be started (Android Studio's virtual devices). */
export async function avds() {
  try {
    return (await run(EMULATOR, ['-list-avds'], { timeout: 15000 })).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(INFO|WARNING|ERROR)/.test(l));
  } catch {
    return [];
  }
}

/** Connected phones and emulators; an emulator that is still starting has booted: false. */
export async function devices() {
  const out = await run(ADB, ['devices', '-l'], { timeout: 10000 }).catch(() => '');
  const list = out
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => /\s(device|offline)\s/.test(l))
    .map((l) => {
      const serial = l.split(/\s+/)[0];
      const emulator = serial.startsWith('emulator-');
      const model = emulator ? 'Emulator' : (/model:(\S+)/.exec(l)?.[1]?.replace(/_/g, ' ') ?? serial);
      return { serial, model, emulator, booted: /\sdevice\s/.test(l) };
    });
  for (const d of list.filter((x) => x.emulator && x.booted)) {
    d.booted = (await adb(d.serial, ['shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 }).catch(() => '')).trim() === '1';
  }
  return list;
}

const readChoice = () => {
  try {
    return JSON.parse(fs.readFileSync(CHOICE, 'utf8')).serial ?? null;
  } catch {
    return null;
  }
};
/** The device the panel shows and Claude uses (the one picked in the panel, else the emulator). */
export function choose(serial) {
  fs.mkdirSync(path.dirname(CHOICE), { recursive: true });
  fs.writeFileSync(CHOICE, JSON.stringify({ serial }));
}
export async function current(list) {
  list ??= await devices();
  const ready = list.filter((d) => d.booted);
  const picked = readChoice();
  return ready.find((d) => d.serial === picked) ?? ready.find((d) => d.emulator) ?? ready[0] ?? null;
}
async function need(serial) {
  if (serial) return serial;
  const d = await current();
  if (!d) throw new Error('No phone or emulator is running. Start the emulator first (emulator_start), or connect the phone in the Phone panel.');
  return d.serial;
}

// Screenshots are made smaller (a 2400 px tall screen becomes 1200 px): faster to send and easy to
// read. Every coordinate in this module is in screenshot pixels and is scaled back for taps.
const scales = new Map();
async function scaleOf(serial) {
  if (!scales.has(serial)) {
    const out = await adb(serial, ['shell', 'wm', 'size'], { timeout: 8000 }).catch(() => '');
    const m = [...out.matchAll(/size: (\d+)x(\d+)/g)].pop(); // the override size when there is one
    scales.set(serial, m ? Math.max(1, Math.ceil(Math.max(+m[1], +m[2]) / 1300)) : 2);
  }
  return scales.get(serial);
}

function png(width, height, rgb) {
  // Rows with the "up" filter: much smaller files for app screens (flat colours).
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = y ? 2 : 0;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = y ? (rgb[y * stride + i] - rgb[(y - 1) * stride + i]) & 255 : rgb[i];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The screen as a PNG, made smaller; returns { png, width, height, scale, serial }. */
export async function screen(serial) {
  serial = await need(serial);
  const raw = await adb(serial, ['exec-out', 'screencap'], { buffer: true, timeout: 20000 });
  const w = raw.readUInt32LE(0);
  const h = raw.readUInt32LE(4);
  const head = raw.length - w * h * 4;
  if (!w || !h || head < 12 || head > 32) throw new Error('The screen could not be read (is the device locked or still starting?).');
  const s = Math.max(1, Math.ceil(Math.max(w, h) / 1300));
  scales.set(serial, s);
  const W = Math.floor(w / s);
  const H = Math.floor(h / s);
  const rgb = Buffer.alloc(W * H * 3);
  const n = s * s;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < s; dy++) {
        let p = head + ((y * s + dy) * w + x * s) * 4;
        for (let dx = 0; dx < s; dx++, p += 4) (r += raw[p]), (g += raw[p + 1]), (b += raw[p + 2]);
      }
      const o = (y * W + x) * 3;
      rgb[o] = r / n;
      rgb[o + 1] = g / n;
      rgb[o + 2] = b / n;
    }
  }
  return { png: png(W, H, rgb), width: W, height: H, scale: s, serial };
}

/** What is on the screen: texts, labels and buttons with their centre (screenshot pixels). */
export async function ui(serial) {
  serial = await need(serial);
  const s = await scaleOf(serial);
  const dump = await adb(serial, ['shell', 'uiautomator', 'dump', '/sdcard/studio-ui.xml'], { timeout: 20000 }).catch((e) => e.message);
  if (!/dumped/i.test(dump)) throw new Error(`The screen's element list is not available right now (${dump.trim().slice(0, 120)}). Use the screenshot instead.`);
  const xml = await adb(serial, ['exec-out', 'cat', '/sdcard/studio-ui.xml'], { timeout: 10000 });
  const attr = (node, k) => new RegExp(`\\s${k}="([^"]*)"`).exec(node)?.[1] ?? '';
  const unxml = (t) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&');
  const items = [];
  for (const node of xml.match(/<node [^>]*>/g) ?? []) {
    const text = unxml(attr(node, 'text')).trim();
    const desc = unxml(attr(node, 'content-desc')).trim();
    const clickable = attr(node, 'clickable') === 'true';
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(node, 'bounds'));
    if (!b || (!text && !desc && !clickable)) continue;
    const [x1, y1, x2, y2] = b.slice(1).map((v) => Math.round(+v / s));
    if (x2 <= x1 || y2 <= y1) continue;
    items.push({ text, desc, id: attr(node, 'resource-id').replace(/^.*:id\//, ''), clickable, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), box: [x1, y1, x2, y2] });
  }
  return items;
}

/** Finds an element by its text or label (exact first, then contains, case-insensitive). */
export async function find(text, serial) {
  const items = await ui(serial);
  const t = text.toLowerCase();
  const all = (x) => [x.text, x.desc].map((v) => v.toLowerCase());
  return items.find((x) => all(x).includes(t)) ?? items.find((x) => all(x).some((v) => v.includes(t))) ?? null;
}

export async function tap(x, y, serial) {
  serial = await need(serial);
  const s = await scaleOf(serial);
  await adb(serial, ['shell', 'input', 'tap', String(Math.round(x * s)), String(Math.round(y * s))]);
}
export async function longPress(x, y, serial, ms = 800) {
  serial = await need(serial);
  const s = await scaleOf(serial);
  const X = String(Math.round(x * s));
  const Y = String(Math.round(y * s));
  await adb(serial, ['shell', 'input', 'swipe', X, Y, X, Y, String(ms)]);
}
export async function swipe(x1, y1, x2, y2, ms = 300, serial) {
  serial = await need(serial);
  const s = await scaleOf(serial);
  await adb(serial, ['shell', 'input', 'swipe', ...[x1, y1, x2, y2].map((v) => String(Math.round(v * s))), String(Math.round(ms))]);
}
/** Swipes across the screen: "up" scrolls the page down (finger moves up). */
export async function swipeDir(dir, serial) {
  serial = await need(serial);
  const s = await scaleOf(serial);
  const out = await adb(serial, ['shell', 'wm', 'size'], { timeout: 8000 }).catch(() => '');
  const m = [...out.matchAll(/size: (\d+)x(\d+)/g)].pop() ?? [0, 1080, 2400];
  const W = +m[1] / s;
  const H = +m[2] / s;
  const p = { up: [W / 2, H * 0.75, W / 2, H * 0.3], down: [W / 2, H * 0.3, W / 2, H * 0.75], left: [W * 0.85, H / 2, W * 0.15, H / 2], right: [W * 0.15, H / 2, W * 0.85, H / 2] }[dir];
  if (!p) throw new Error('direction must be up, down, left or right');
  await swipe(...p, 350, serial);
}

export const KEYS = { back: 4, home: 3, recents: 187, enter: 66, delete: 67, backspace: 67, tab: 61, menu: 82, power: 26, escape: 111, search: 84, volume_up: 24, volume_down: 25, up: 19, down: 20, left: 21, right: 22 };
export async function key(name, serial) {
  serial = await need(serial);
  const code = KEYS[String(name).toLowerCase()] ?? (/^\d+$/.test(String(name)) ? String(name) : null);
  if (code == null) throw new Error(`Unknown key "${name}". Use one of: ${Object.keys(KEYS).join(', ')}, or a key code number.`);
  await adb(serial, ['shell', 'input', 'keyevent', String(code)]);
}
/** Types into the focused field (plain ASCII: adb cannot type other letters). */
export async function type(text, serial) {
  serial = await need(serial);
  const parts = String(text).split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) await adb(serial, ['shell', `input text '${parts[i].replace(/ /g, '%s').replace(/'/g, `'\\''`)}'`]);
    if (i < parts.length - 1) await key('enter', serial);
  }
}

export async function logs({ filter = 'ReactNativeJS:V AndroidRuntime:E *:S', lines = 80, clear = false } = {}, serial) {
  serial = await need(serial);
  if (clear) return (await adb(serial, ['logcat', '-c']), 'Logs cleared.');
  const out = await adb(serial, ['logcat', '-d', '-v', 'time', ...String(filter).split(/\s+/).filter(Boolean)], { timeout: 20000 });
  return out.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(1000, lines))).join('\n') || '(no log lines)';
}
export async function shell(command, serial) {
  serial = await need(serial);
  return adb(serial, ['shell', command], { timeout: 60000 });
}
/** Opens an app by its package name, or a link (https://, myapp://...). */
export async function open(target, serial) {
  serial = await need(serial);
  if (/^[a-z][\w+.-]*:/i.test(target)) return adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${target.replace(/'/g, `'\\''`)}'`]);
  return adb(serial, ['shell', 'monkey', '-p', target, '-c', 'android.intent.category.LAUNCHER', '1']);
}

let starting = null;
export const emulatorStarting = () => !!starting;
/** Starts the emulator without a window (it shows in the Phone panel) and waits until it is ready. */
export async function emulatorStart(avd) {
  const running = (await devices()).find((d) => d.emulator);
  if (running?.booted) return { serial: running.serial, already: true };
  if (!starting) {
    starting = (async () => {
      if (!running) {
        const name = avd || (await avds())[0];
        if (!name) throw new Error('No emulator is set up. Create one in Android Studio (Device Manager) first.');
        const child = spawn(EMULATOR, ['-avd', name, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save', '-memory', '2048'], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
      }
      const until = Date.now() + 180000;
      while (Date.now() < until) {
        await sleep(3000);
        const e = (await devices()).find((d) => d.emulator);
        if (e?.booted) {
          // This AVD had animations switched off, which makes the app look broken.
          for (const k of ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale']) await adb(e.serial, ['shell', 'settings', 'put', 'global', k, '1']).catch(() => {});
          await adb(e.serial, ['shell', 'svc', 'power', 'stayon', 'true']).catch(() => {});
          return { serial: e.serial };
        }
      }
      throw new Error('The emulator did not finish starting within 3 minutes.');
    })().finally(() => (starting = null));
  }
  return starting;
}
export async function emulatorStop() {
  const list = (await devices()).filter((d) => d.emulator);
  for (const e of list) await adb(e.serial, ['emu', 'kill']).catch(() => {});
  return list.length;
}
