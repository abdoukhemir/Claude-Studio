// Reads a Claude conversation file (the .jsonl transcript Claude Code writes as it works) and turns
// it into a simple chat: your messages, Claude's replies, and the steps (tools) in between.
// One Transcript per file; files can be hundreds of MB, so only the end is read, then new bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const START_BYTES = 24 * 1024 * 1024;
const KEEP = 500;

export const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude/projects');
/** Claude Code's folder name for a project path: E:\ClaudeCode\LangAno -> E--ClaudeCode-LangAno. */
export const slugOf = (dir) => path.resolve(dir).replace(/[:\\/ .]/g, '-');

const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const base = (p) => String(p ?? '').split(/[\\/]/).pop();
const clean = (s) =>
  String(s ?? '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim();

/** A plain-words label for each step. */
function describe(name, input) {
  const i = input ?? {};
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { label: i.description || short(String(i.command ?? ''), 80), detail: i.command };
    case 'Read':
      return { label: `Read ${base(i.file_path)}`, detail: i.file_path };
    case 'Write':
      return { label: `Wrote ${base(i.file_path)}`, detail: i.file_path };
    case 'Edit':
      return { label: `Edited ${base(i.file_path)}`, detail: i.file_path };
    case 'Grep':
      return { label: `Searched for "${short(String(i.pattern ?? ''), 50)}"`, detail: i.path };
    case 'Glob':
      return { label: `Looked for files ${i.pattern ?? ''}`, detail: i.path };
    case 'Agent':
      return { label: `Helper: ${i.description ?? 'task'}`, detail: i.prompt && short(i.prompt, 600) };
    case 'WebSearch':
      return { label: `Searched the web: ${i.query ?? ''}` };
    case 'WebFetch':
      return { label: `Opened ${i.url ?? 'a page'}` };
    case 'Skill':
      return { label: `Used skill ${i.skill ?? ''}` };
    case 'ToolSearch':
      return { label: 'Loaded tools' };
    case 'SendMessage':
      return { label: `Message to a helper`, detail: short(JSON.stringify(i), 400) };
    default:
      return { label: name.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '').replace(/_/g, ' '), detail: short(JSON.stringify(i), 400) };
  }
}

const resultText = (c) =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).join('\n') : '';

export class Transcript {
  /** sidechain: true for a helper's own file (all its lines are marked as side work). */
  constructor(file, { sidechain = false } = {}) {
    this.file = file;
    this.sidechain = sidechain;
    this.offset = 0;
    this.carry = Buffer.alloc(0);
    this.skipPartial = false;
    this.entries = [];
    this.tools = new Map();
    this.rev = 0;
    this.busy = false;
    this.changedAt = 0;
    this.first = null; // the first user message: a helper's task
    this.started = false;
  }

  add(e) {
    this.entries.push(e);
    if (this.entries.length > KEEP) this.entries = this.entries.slice(-KEEP);
  }

  take(line) {
    if (line.startsWith('{"type":"api-request') || line.startsWith('{"type":"file-history')) return;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.isSidechain && !this.sidechain) return;
    const ts = o.timestamp;
    // Claude Code's own "You've hit your session/weekly limit" (marked as an API error; Claude's
    // replies that merely quote the sentence are not), for automatic account switching.
    if (o.isApiErrorMessage && o.error === 'rate_limit') this.limitHitAt = Date.parse(ts) || Date.now();
    // An account that cannot work at all (logged out, blocked, no access, billing): the tab moves away.
    else if (o.isApiErrorMessage && /auth|oauth|billing|permission|forbidden|not_allowed|disabled|invalid_api_key/i.test(o.error ?? '')) {
      this.accountErrorAt = Date.parse(ts) || Date.now();
      this.accountError = o.error;
    }
    if (o.type === 'system' && o.subtype === 'turn_duration') {
      this.busy = false;
      this.add({ k: 'end', ts, ms: o.durationMs });
      return;
    }
    if (o.type === 'attachment' && o.attachment?.type === 'queued_command') {
      const text = clean(o.attachment.prompt);
      if (text && !text.startsWith('<')) this.add({ k: 'user', text, ts });
      return;
    }
    const c = o.message?.content;
    if (o.type === 'user') {
      if (o.isCompactSummary) return this.add({ k: 'note', text: 'Earlier part of the conversation was summarized', ts });
      if (typeof c === 'string') {
        if (o.isMeta) return;
        const text = clean(c);
        if (!text || /^<(command-|local-command|task-notification|bash-)/.test(text)) return;
        if (text.startsWith('[Request interrupted')) return this.add({ k: 'note', text: 'Stopped by you', ts });
        this.busy = true;
        this.first ??= text;
        return this.add({ k: 'user', text, ts });
      }
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'tool_result') {
            const t = this.tools.get(b.tool_use_id);
            if (t) {
              t.state = b.is_error ? 'error' : 'done';
              t.result = short(resultText(b.content).trim(), 1500);
            }
          } else if (b.type === 'text' && !o.isMeta) {
            const text = clean(b.text);
            if (text && !text.startsWith('<') && !text.startsWith('[Request interrupted')) {
              this.busy = true;
              this.first ??= text;
              this.add({ k: 'user', text, ts });
            }
          }
        }
      }
      return;
    }
    if (o.type === 'assistant' && Array.isArray(c)) {
      this.busy = true;
      for (const b of c) {
        if (b.type === 'text' && b.text.trim()) this.add({ k: 'text', text: b.text, ts });
        else if (b.type === 'tool_use') {
          let input = b.input;
          if (typeof input === 'string') {
            try {
              input = JSON.parse(input);
            } catch {
              input = {};
            }
          }
          const t = { k: 'tool', id: b.id, name: b.name, ...describe(b.name, input), state: 'running', ts };
          this.tools.set(b.id, t);
          if (this.tools.size > KEEP * 2) this.tools = new Map([...this.tools].slice(-KEEP));
          this.add(t);
        }
      }
    }
  }

  update() {
    if (!fs.existsSync(this.file)) return;
    const size = fs.statSync(this.file).size;
    if (!this.started) {
      this.started = true;
      this.offset = Math.max(0, size - START_BYTES);
      this.skipPartial = this.offset > 0;
    }
    if (size < this.offset) {
      Object.assign(this, new Transcript(this.file, { sidechain: this.sidechain }));
      return this.update();
    }
    if (size === this.offset) return;
    const fd = fs.openSync(this.file, 'r');
    const buf = Buffer.alloc(size - this.offset);
    fs.readSync(fd, buf, 0, buf.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;
    let data = Buffer.concat([this.carry, buf]);
    const last = data.lastIndexOf(0x0a);
    if (last < 0) {
      this.carry = data;
      return;
    }
    this.carry = data.subarray(last + 1);
    data = data.subarray(0, last);
    const lines = data.toString('utf8').split('\n');
    if (this.skipPartial) {
      lines.shift();
      this.skipPartial = false;
    }
    for (const l of lines) if (l) this.take(l);
    this.rev++;
    this.changedAt = Date.now();
  }

  state(sinceRev) {
    try {
      this.update();
    } catch {}
    const modified = fs.existsSync(this.file) ? fs.statSync(this.file).mtimeMs : 0;
    if (+sinceRev === this.rev) return { rev: this.rev, same: true, busy: this.busy, modified };
    return { rev: this.rev, busy: this.busy, modified, entries: this.entries.slice(-300) };
  }
}

/** The title Claude Code gave a conversation (its summary line), else its first message. */
export function sessionTitle(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(fs.statSync(file).size, 256 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    let first = null;
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.includes('"type":"summary"')) {
        try {
          return JSON.parse(line).summary;
        } catch {}
      }
      if (!first && line.includes('"type":"user"')) {
        try {
          const o = JSON.parse(line);
          const c = o.message?.content;
          const text = clean(typeof c === 'string' ? c : Array.isArray(c) ? c.find((b) => b.type === 'text')?.text : '');
          if (text && !text.startsWith('<')) first = short(text.replace(/\s+/g, ' '), 90);
        } catch {}
      }
    }
    return first;
  } catch {
    return null;
  }
}
