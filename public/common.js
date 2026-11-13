// Small helpers shared by the start page and the project workspace.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(url, opts = {}) {
  const init = { ...opts };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer)) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  }
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status}`);
  return data;
}

function timeAgo(ms) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const sizeOf = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

let toastTimer;
function toast(text) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/** Line icons (24x24, stroke). */
const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  app: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  game: '<path d="M6 8h12a4 4 0 0 1 3.9 4.9l-1 4.3A2.5 2.5 0 0 1 16.5 18l-2-2h-5l-2 2a2.5 2.5 0 0 1-4.4-.8l-1-4.3A4 4 0 0 1 6 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
  website: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 3.9 5.8 3.9 9.5s-1.3 6.9-3.9 9.5c-2.6-2.6-3.9-5.8-3.9-9.5S9.4 5.1 12 2.5z"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6 12.6 21 3 11.4 11.4 3l1.3 1.3a4 4 0 0 0 2 2z"/>',
  other: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H17l3 3v12.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2.5h6.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 9"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2.5"/><path d="m16 10 5-3v10l-5-3"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  data: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  attach: '<path d="m20 11.5-8.4 8.4a5 5 0 0 1-7.1-7.1l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8-8"/>',
  send: '<path d="M4 12 20 4l-4 16-4-7z"/><path d="m12 13 8-9"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 9 3 3-3 3M12 15h5"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.3A2.5 2.5 0 0 1 4 13.5z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  other_file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  git: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12M18 9a9 9 0 0 0-9 9"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  notes: '<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  sysmon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  env: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/>',
  preview: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  agents: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/><path d="M9 15h6"/>',
  skills: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
};
const TYPES = {
  app: { label: 'Mobile app', about: 'Android or iPhone app' },
  game: { label: 'Game', about: 'Web, mobile or desktop game' },
  website: { label: 'Website', about: 'Site or web app' },
  tool: { label: 'Tool', about: 'Script, bot or utility' },
  other: { label: 'Other', about: 'Anything else' },
};

/**
 * Plan limits (session and week) from Claude Code's /usage, read by the helper on port 4548 for each
 * account. The workspace shows the account of the open tab (window.limitsAccount); the start page
 * shows the account new tabs use. Numbers older than 15 minutes are marked as old.
 */
async function renderLimits(el, refresh = false) {
  try {
    const acct = window.limitsAccount ? `account=${encodeURIComponent(window.limitsAccount)}` : '';
    const q = [acct, refresh ? 'refresh=1' : ''].filter(Boolean).join('&');
    const r = await fetch(`/api/usage${q ? `?${q}` : ''}`).then((x) => x.json());
    if (!r.limits?.length) return void (el.innerHTML = `<span class="chip">${esc(r.note || 'Reading limits…')}</span>`);
    const old = Date.now() - r.at > 15 * 60000;
    el.innerHTML =
      r.limits
        .map((l) => {
          const cls = old ? '' : l.pct >= 85 ? 'bad' : l.pct >= 60 ? 'warn' : 'good';
          const name = l.label.replace('Current session', 'Session').replace(/Current week \(all models\)/, 'Week').replace('Current week', 'Week');
          return `<span class="chip ${cls}" title="${esc(r.label ?? '')}: ${esc(l.label)} ${l.pct}% used. Resets ${esc(l.resets)}. Updated ${timeAgo(r.at)}. Click to refresh.">${esc(name)} ${l.pct}% <span class="muted">· ${esc(l.resets.replace(/\s*\(.*\)$/, ''))}</span></span>`;
        })
        .join(' ') + `<span class="muted small" title="${esc(r.note || '')}">${old ? `old (${timeAgo(r.at)})` : timeAgo(r.at)}</span>`;
  } catch {
    el.innerHTML = '<span class="chip" title="The helper on port 4548 is not running">Limits unavailable</span>';
  }
  el.onclick = () => (renderLimits(el, true), toast('Reading this account\'s limits again (about 20 seconds)…'), setTimeout(() => renderLimits(el), 22000));
  el.style.cursor = 'pointer';
}

// Every model Claude Code's /model menu offers (plus the 1M-context versions of the newest ones).
// "limit": Fable has its own, smaller limit and can switch to usage credits; "$": draws from usage
// credits (paid on top of the plan).
const MODEL_LIST = [
  ['', 'Default (Opus 5.5)'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-fable-5-1', 'Fable 5.1', 'limit'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-haiku-4-5', 'Haiku 4.5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-opus-5', 'Opus 5'],
  ['claude-fable-5', 'Fable 5', 'limit'],
  ['claude-opus-4-8', 'Opus 4.8'],
  ['claude-opus-4-7', 'Opus 4.7'],
  ['claude-opus-4-6', 'Opus 4.6'],
  ['claude-sonnet-4-6', 'Sonnet 4.6'],
  ['claude-opus-5-5[1m]', 'Opus 5.5 · 1M context', '$'],
  ['claude-sonnet-5-5[1m]', 'Sonnet 5.5 · 1M context', '$'],
];
const MODEL_ALIASES = { opus: 'Opus (latest)', sonnet: 'Sonnet (latest)', haiku: 'Haiku (latest)', fable: 'Fable (latest)' };
const MODEL_SIGN = { limit: ' · ! own limit', $: ' · $ paid credits' };
const MODEL_TIP = { limit: 'Has its own, smaller limit; when it is used up Claude Code asks to go on with paid usage credits', $: 'Draws from paid usage credits, on top of the plan' };
/** <option>s for a model menu; a value not in the list (an older tab's choice) is kept as its own option. */
function modelOptions(selected = '') {
  const list = MODEL_LIST.some(([v]) => v === selected) ? MODEL_LIST : [...MODEL_LIST, [selected, MODEL_ALIASES[selected] ?? selected, selected.startsWith('fable') ? 'limit' : selected.includes('[1m]') ? '$' : '']];
  return list.map(([v, label, sign]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''} ${sign ? `title="${esc(MODEL_TIP[sign])}"` : ''}>${esc(label)}${sign ? MODEL_SIGN[sign] : ''}</option>`).join('');
}
// The static model menus on the start page and in the session dialogs.
for (const sel of $$('select[name=model], #ns-model, #fs-model')) sel.innerHTML = modelOptions(sel.value);
