// A project workspace: Claude sessions on the left (several at once, as tabs), project panels on
// the right (overview, agents, files, docs, phone or preview, skills).
const params = new URLSearchParams(location.search);
const PID = params.get('id');
let P = null;
let sessionList = [];
let current = params.get('sid');
const views = new Map(); // sid -> session view state
let panel = null;

marked.setOptions({ gfm: true, breaks: false });
const md = (text) => DOMPurify.sanitize(marked.parse(String(text ?? '')));
function highlight(root) {
  $$('pre code', root).forEach((el) => {
    if (!el.dataset.hl) {
      el.dataset.hl = '1';
      try {
        hljs.highlightElement(el);
      } catch {}
    }
  });
}

// ---------- page ----------
async function init() {
  P = await api(`/api/p/${PID}`).catch(() => null);
  if (!P) return void ($('#p-name').textContent = 'Project not found');
  document.title = `${P.name} · Claude Studio`;
  $('#home').innerHTML = svg(ICON.back, 18);
  $('#p-icon').innerHTML = svg(ICON[P.type] ?? ICON.other, 18);
  $('#p-name').textContent = P.name;
  $('#p-path').textContent = `${TYPES[P.type]?.label ?? P.type} · ${P.path}`;
  if (P.legacyUrl) $('#p-links').innerHTML = `<a class="btn small" href="${esc(P.legacyUrl)}" target="_blank">Old workspace</a>`;
  $('#wide').innerHTML = svg(ICON.expand, 16);
  $('#wide').onclick = () => $('#main').classList.toggle('wide-chat');
  setupDivider();
  // Phone: one screen at a time, switched by the bottom bar (Chat / Project).
  $$('#m-nav [data-m]').forEach((b) => (b.onclick = () => {
    $('#main').dataset.m = b.dataset.m;
    $$('#m-nav [data-m]').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.m === 'chat') setTimeout(() => views.get(current)?.fit?.(), 60);
  }));
  renderAccounts();
  renderLimits($('#limits'));
  setInterval(() => renderLimits($('#limits')), 60000);

  // Wire up modular element actions, tabs scrolling, and modals
  const pTabs = $('#p-tabs');
  $('#p-tabs-prev')?.addEventListener('click', () => {
    pTabs?.scrollBy({ left: -220, behavior: 'smooth' });
  });
  $('#p-tabs-next')?.addEventListener('click', () => {
    pTabs?.scrollBy({ left: 220, behavior: 'smooth' });
  });
  pTabs?.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && !e.shiftKey) {
      e.preventDefault();
      pTabs.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  $('#btn-add-element')?.addEventListener('click', openCatalogModal);
  $('#manage-elements')?.addEventListener('click', openManagerModal);
  $('#layout-toggle')?.addEventListener('click', cycleLayout);
  $('#close-catalog-modal')?.addEventListener('click', () => $('#element-catalog-modal').classList.add('hidden'));
  $('#element-catalog-modal')?.addEventListener('click', (e) => e.target === $('#element-catalog-modal') && $('#element-catalog-modal').classList.add('hidden'));
  $('#close-manager-modal')?.addEventListener('click', () => $('#element-manager-modal').classList.add('hidden'));
  $('#close-manager-modal-btn')?.addEventListener('click', () => $('#element-manager-modal').classList.add('hidden'));
  $('#element-manager-modal')?.addEventListener('click', (e) => e.target === $('#element-manager-modal') && $('#element-manager-modal').classList.add('hidden'));
  $('#btn-open-catalog-from-mgr')?.addEventListener('click', () => {
    $('#element-manager-modal').classList.add('hidden');
    openCatalogModal();
  });
  $$('[data-set-layout]').forEach((b) => {
    b.onclick = () => applyLayout(b.dataset.setLayout);
  });

  applyLayout(currentLayout);
  renderPanelTabs();
  const panels = P.workspace?.panels || ['overview'];
  showPanel(localStorage.getItem(`panel:${PID}`) || panels[0]);
  await refreshSessions();
  if (!sessionList.length) openNewSession();
  setInterval(refreshSessions, 3000);
  setInterval(pollChat, 1500);
}

function setupDivider() {
  const main = $('#main');
  const divider = $('#divider');
  const saved = localStorage.getItem('studio:left');
  if (saved) main.style.setProperty('--left', saved);
  divider.onpointerdown = (e) => {
    e.preventDefault();
    try {
      divider.setPointerCapture(e.pointerId);
    } catch {}
    document.body.classList.add('resizing');
    const move = (ev) => {
      const pct = Math.min(85, Math.max(20, (ev.clientX / window.innerWidth) * 100));
      main.style.setProperty('--left', `${pct}%`);
      localStorage.setItem('studio:left', `${pct}%`);
    };
    const stop = (ev) => {
      try {
        if (ev && divider.hasPointerCapture(ev.pointerId)) {
          divider.releasePointerCapture(ev.pointerId);
        }
      } catch {}
      document.body.classList.remove('resizing');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', stop);
      divider.removeEventListener('pointercancel', stop);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      views.get(current)?.fit?.();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
}

// ---------- sessions ----------
async function refreshSessions() {
  sessionList = await api(`/api/p/${PID}/sessions`).catch(() => sessionList);
  if (!sessionList.some((s) => s.sid === current)) current = sessionList.find((s) => s.main)?.sid ?? sessionList[0]?.sid ?? null;
  renderSessionTabs();
  for (const s of sessionList) views.get(s.sid)?.setInfo(s);
  if (current) showSession(current);
}

function stateOf(s, busy) {
  if (s.elsewhere) return ['info', 'Open in another window'];
  if (!s.running) return ['', s.attach ? 'Watching' : 'Not running'];
  if (s.ask) return ['warn', 'Needs your answer'];
  return busy ? ['good', 'Working'] : ['', 'Ready'];
}

function renderSessionTabs() {
  const nav = $('#s-tabs');
  nav.innerHTML = sessionList
    .map((s) => {
      const v = views.get(s.sid);
      const [cls] = stateOf(s, v?.busy);
      const dot = cls === 'good' ? 'dot live' : cls === 'warn' ? 'dot warn' : 'dot';
      return `<button class="tab ${s.sid === current ? 'on' : ''}" data-sid="${s.sid}"><span class="${dot}"></span>${esc(s.name)}<span class="x" data-close="${s.sid}" title="Close this tab">${svg(ICON.x, 13)}</span></button>`;
    })
    .join('') +
    `<button class="tab" id="add-session" title="Give another Claude a side task; it already knows this conversation">${svg(ICON.plus, 15)} Side task</button>` +
    `<button class="tab" id="fresh-session-btn" title="A fresh, cheap Claude that continues from the project's handoff">${svg(ICON.chat, 15)} New session</button>`;
  $$('#s-tabs [data-sid]').forEach((b) => (b.onclick = (e) => (e.target.closest('[data-close]') ? closeSession(b.dataset.sid) : showSession(b.dataset.sid))));
  $('#add-session').onclick = openNewSession;
  $('#fresh-session-btn').onclick = openFreshSession;
}

async function closeSession(sid) {
  const s = sessionList.find((x) => x.sid === sid);
  if (s?.running && !confirm(`Close "${s.name}"? Claude stops in this tab (the conversation is kept and can be continued later).`)) return;
  await api(`/api/s/${sid}`, { method: 'DELETE' }).catch((e) => toast(e.message));
  views.get(sid)?.destroy();
  views.delete(sid);
  if (current === sid) current = null;
  refreshSessions();
}

function showSession(sid) {
  current = sid;
  const info = sessionList.find((s) => s.sid === sid);
  if (!info) return;
  if (!views.has(sid)) views.set(sid, makeSessionView(info));
  for (const [k, v] of views) v.el.classList.toggle('hidden', k !== sid);
  $$('#s-tabs [data-sid]').forEach((b) => b.classList.toggle('on', b.dataset.sid === sid));
  views.get(sid).poll(true);
  if (lastAccountTab !== sid) ((lastAccountTab = sid), renderAccounts());
}
let lastAccountTab = null;

function pollChat() {
  views.get(current)?.poll();
}

function makeSessionView(info) {
  const el = document.createElement('div');
  el.className = 'session';
  el.innerHTML = `
    <div class="s-head">
      <span class="chip" data-state></span>
      <span class="muted small" data-hint></span>
      <span class="grow"></span>
      <label class="row small muted">Effort <select class="small" data-effort>${['low', 'medium', 'high', 'xhigh', 'max'].map((e) => `<option>${e}</option>`).join('')}</select></label>
      <label class="row small muted">Model <select class="small" data-model>${modelOptions()}</select></label>
      <button class="btn small" data-run></button>
      <span class="row hidden" data-termsize></span>
      <span class="seg" data-mode title="The same conversation, as a chat or as Claude's own terminal"><button data-m="chat">${svg(ICON.chat, 14)} Chat</button><button data-m="term">${svg(ICON.terminal, 14)} Terminal</button></span>
    </div>
    <div class="log" data-log><div class="empty">Loading the conversation…</div></div>
    <div class="terminal hidden" data-term></div>
    <div class="ask hidden" data-ask></div>
    <div class="composer" data-composer>
      <div class="attachments" data-files></div>
      <textarea rows="2" data-text placeholder="Message Claude. Enter sends, Shift+Enter for a new line. Drop or paste files here."></textarea>
      <div class="row">
        <button class="btn small ghost" data-attach title="Attach files">${svg(ICON.attach, 16)} Attach</button>
        <button class="btn small ghost" data-mic title="Speak your message">${svg(ICON.mic, 16)} Voice</button>
        <select class="small" data-lang title="Language you speak in">${['en-US', 'fr-FR', 'ar-MA', 'es-ES', 'pt-BR', 'de-DE', 'it-IT'].map((l) => `<option>${l}</option>`).join('')}</select>
        <input type="file" multiple class="hidden" data-picker />
        <span class="muted small grow" data-note></span>
        <button class="btn small danger hidden" data-interrupt title="Stop what Claude is doing (Esc)">${svg(ICON.stop, 14)} Stop</button>
        <button class="btn small primary" data-send>${svg(ICON.send, 15)} Send</button>
      </div>
    </div>`;
  $('#s-body').append(el);
  const q = (k) => $(`[data-${k}]`, el);
  const v = { el, info, rev: null, busy: false, mode: 'chat', files: [], term: null, ws: null, fit: null };

  v.setInfo = (s) => {
    v.info = s;
    const [cls, label] = stateOf(s, v.busy);
    q('state').className = `chip ${cls}`;
    q('state').innerHTML = `${cls === 'good' ? '<span class="dot live"></span>' : ''}${label}`;
    q('effort').value = s.effort || 'high';
    if (![...q('model').options].some((o) => o.value === (s.model || ''))) q('model').innerHTML = modelOptions(s.model || '');
    q('model').value = s.model || '';
    q('run').textContent = s.running ? 'Stop Claude' : s.elsewhere ? 'Watch only' : 'Resume';
    q('run').disabled = s.elsewhere;
    q('hint').textContent = s.elsewhere ? 'This conversation runs in another window. You can read it here; to talk, use that window or fork it.' : s.switchNote ?? '';
    q('interrupt').classList.toggle('hidden', !(s.running && v.busy));
    renderAsk(s.ask);
  };

  // Claude's question with options, as a card at the bottom of the chat (in place of the message
  // box). Only in the chat: the terminal shows the question itself. The card is built again only
  // when the question changes, and a question just answered is not shown again while Claude moves on.
  let askSig = '';
  let answered = { sig: '', until: 0 };
  function renderAsk(ask) {
    const box = q('ask');
    const sig = ask?.options?.length ? JSON.stringify([ask.question, ask.options.map((o) => o.label)]) : '';
    const show = sig && v.mode === 'chat' && !(answered.sig === sig && Date.now() < answered.until);
    box.classList.toggle('hidden', !show);
    q('composer').classList.toggle('hidden', v.mode !== 'chat' || !!show);
    if (!show) return void (askSig = '');
    if (sig === askSig) return;
    askSig = sig;
    const free = (o) => /^type something/i.test(o.label);
    box.innerHTML = `
      <div class="ask-head"><span class="chip warn">Claude asks</span><span class="muted small grow">Pick an answer. Claude continues right after.</span></div>
      ${ask.context ? `<pre class="ask-context">${esc(ask.context)}</pre>` : ''}
      <div class="ask-q">${esc(ask.question)}</div>
      <div class="ask-list">
        ${ask.options
          .map((o) =>
            free(o)
              ? `<div class="ask-free"><span class="ask-n">${esc(o.key)}</span><input type="text" data-free="${esc(o.key)}" placeholder="Or type your own answer…"><button class="btn small primary" data-free-send>Send</button></div>`
              : `<button class="ask-opt" data-choose="${esc(o.key)}"><span class="ask-n">${esc(o.key)}</span><span class="ask-l"><b>${esc(o.label)}</b>${o.desc ? `<span class="muted small">${esc(o.desc)}</span>` : ''}</span></button>`,
          )
          .join('')}
      </div>
      <div class="row ask-foot">
        <button class="btn small ghost" data-ask-term>${svg(ICON.terminal, 14)} Answer in the terminal</button>
        <span class="grow"></span>
        <button class="btn small ghost danger" data-ask-esc>Cancel (Esc)</button>
      </div>`;
    const choose = async (k, text, label) => {
      $$('button, input', box).forEach((b) => (b.disabled = true));
      try {
        await api(`/api/s/${v.info.sid}/choose`, { method: 'POST', body: { key: k, text } });
        answered = { sig, until: Date.now() + 5000 };
        toast(`Answered: ${label}`);
      } catch (e) {
        toast(e.message);
      }
      askSig = '';
      renderAsk(v.info.ask);
      setTimeout(() => v.poll(true), 700);
    };
    $$('[data-choose]', box).forEach((b) => (b.onclick = () => choose(b.dataset.choose, '', $('b', b).textContent)));
    const freeInput = $('[data-free]', box);
    if (freeInput) {
      const go = () => freeInput.value.trim() && choose(freeInput.dataset.free, freeInput.value.trim(), freeInput.value.trim());
      $('[data-free-send]', box).onclick = go;
      freeInput.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), go());
    }
    $('[data-ask-term]', box).onclick = () => v.setMode('term');
    $('[data-ask-esc]', box).onclick = () => (key('esc'), (answered = { sig, until: Date.now() + 5000 }), renderAsk(v.info.ask));
  }
  const key = (k, enter = false) => api(`/api/s/${v.info.sid}/key`, { method: 'POST', body: { key: k, enter } }).catch((e) => toast(e.message));

  v.poll = async (force) => {
    if (v.mode !== 'chat' && !force) return;
    const r = await api(`/api/s/${v.info.sid}/chat?rev=${force ? '' : (v.rev ?? '')}`).catch(() => null);
    if (!r) return;
    const wasBusy = v.busy;
    v.busy = r.busy;
    v.setInfo(r.session);
    if (wasBusy !== v.busy) renderSessionTabs();
    if (r.same) return;
    v.rev = r.rev;
    renderLog(r.entries ?? []);
  };

  function renderLog(entries) {
    const log = q('log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (!entries.length) {
      log.innerHTML = `<div class="empty">${v.info.running ? 'Claude is starting. Write your first message below.' : 'No messages yet.'}</div>`;
      return;
    }
    const parts = [];
    let group = [];
    const firstLine = (t) => String(t ?? '').split('\n').find((l) => l.trim()) ?? '';
    const plain = (t) => String(t ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    const preview = (t) => {
      const lines = plain(t).split('\n').filter((l) => l.trim());
      const head = lines.slice(0, 3).join('\n');
      return { head: head.length > 280 ? `${head.slice(0, 280)}…` : head, more: lines.length > 3 || head.length > 280 };
    };
    const stepHtml = (t) => {
      const cmd = t.detail && t.detail !== t.label ? firstLine(t.detail) : '';
      const out = t.result ? preview(t.result) : null;
      const icon = t.state === 'running' ? svg(ICON.spinner, 13) : t.state === 'error' ? svg(ICON.x, 13) : svg(ICON.check, 13);
      return `<div class="step ${t.state}"><span class="i">${icon}</span><div style="min-width:0">
        <div class="row"><span class="step-lbl grow">${esc(t.label)}</span>${t.ts ? `<span class="muted small">${new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
        ${cmd ? `<code class="cmd" title="${esc(t.detail)}">${esc(cmd.length > 140 ? `${cmd.slice(0, 140)}…` : cmd)}</code>` : ''}
        ${out?.head ? `<pre class="out${t.state === 'error' ? ' err' : ''}">${esc(out.head)}</pre>` : ''}
        ${(t.detail && String(t.detail).includes('\n')) || out?.more ? `<details><summary class="muted small">details</summary>${t.detail ? `<pre>${esc(t.detail)}</pre>` : ''}${t.result ? `<pre>${esc(plain(t.result))}</pre>` : ''}</details>` : ''}
      </div></div>`;
    };
    const flush = (last) => {
      if (!group.length) return;
      const running = group.some((t) => t.state === 'running');
      const errors = group.filter((t) => t.state === 'error').length;
      const open = running && last;
      const label = group.at(-1).label;
      parts.push(`<details class="steps" ${open ? 'open' : ''}><summary>${running ? `<span class="dot live"></span>` : svg(ICON.check, 14)}<span>${group.length} action${group.length > 1 ? 's' : ''}</span>${errors ? `<span class="chip bad">${errors} failed</span>` : ''}<span class="ellipsis grow">· ${esc(label)}</span></summary>${group.map(stepHtml).join('')}</details>`);
      group = [];
    };
    entries.forEach((e, i) => {
      if (e.k === 'tool') return group.push(e);
      flush(false);
      if (e.k === 'user') parts.push(`<div class="msg user"><div class="bubble">${esc(e.text)}</div></div>`);
      else if (e.k === 'text' && /^\s*No response requested\.?\s*$/i.test(e.text)) return;
      else if (e.k === 'text') parts.push(`<div class="msg claude"><div class="bubble md">${md(e.text)}</div></div>`);
      else if (e.k === 'note') parts.push(`<div class="msg note">${esc(e.text)}</div>`);
      else if (e.k === 'end' && i === entries.length - 1) parts.push(`<div class="msg end">Completed in ${Math.max(1, Math.round((e.ms ?? 0) / 1000))} s</div>`);
    });
    flush(true);
    if (v.busy && v.info.running && !v.info.ask) {
      parts.push(`<div class="msg claude thinking-bubble"><span class="dot live"></span> Claude is working…</div>`);
    }
    // Sections opened or closed by hand stay that way when the chat updates (it is redrawn).
    const opened = new Map($$('details', log).map((d, i) => [i, d.open]));
    const userSet = v.detailsSet ?? (v.detailsSet = new Set());
    log.innerHTML = parts.join('');
    $$('details', log).forEach((d, i) => {
      if (userSet.has(i) && opened.has(i)) d.open = opened.get(i);
      $('summary', d)?.addEventListener('click', () => userSet.add(i));
    });
    highlight(log);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // Sending, with files.
  const text = q('text');
  const autosize = () => ((text.style.height = 'auto'), (text.style.height = `${Math.min(220, text.scrollHeight)}px`));
  text.oninput = autosize;
  text.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  };
  async function send() {
    const body = text.value.trim();
    if (!body && !v.files.length) return;
    if (v.info.elsewhere) return toast('This conversation runs in another window. Fork it from "New session" to talk here.');
    if (!v.info.running) {
      toast('Starting Claude in this tab…');
      await api(`/api/s/${v.info.sid}/restart`, { method: 'POST', body: {} }).catch((e) => toast(e.message));
      await new Promise((r) => setTimeout(r, 6000));
    }
    const files = v.files.map((f) => f.path);
    const message = files.length ? `${body}\n\nFiles I attached:\n${files.map((f) => `- ${f}`).join('\n')}` : body;
    try {
      await api(`/api/s/${v.info.sid}/input`, { method: 'POST', body: { text: message } });
      confirmSent(message);
      text.value = '';
      autosize();
      v.files = [];
      renderFiles();
      setTimeout(() => v.poll(true), 800);
    } catch (e) {
      toast(e.message);
    }
  }
  q('send').onclick = send;

  // Claude sometimes takes the text without the Enter (a long paste, or still starting up): if the
  // message does not show up in the conversation, press Enter for it, up to twice.
  function confirmSent(message, tries = 0) {
    const start = message.slice(0, 40);
    setTimeout(async () => {
      if (v.info?.ask) return; // Never send automatic Enter if an ask is pending
      const r = await api(`/api/s/${v.info.sid}/chat`).catch(() => null);
      const seen = (r?.entries ?? []).slice(-8).some((e) => e.k === 'user' && e.text.startsWith(start));
      if (seen || r?.busy) return;
      await api(`/api/s/${v.info.sid}/key`, { method: 'POST', body: { key: 'enter' } }).catch(() => {});
      if (tries < 1) confirmSent(message, tries + 1);
    }, 2500);
  }

  // Voice messages: the browser turns speech into text in the box; you read it, then send.
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  q('lang').value = localStorage.getItem('studio:lang') || 'en-US';
  q('lang').onchange = () => localStorage.setItem('studio:lang', q('lang').value);
  let rec = null;
  q('mic').onclick = () => {
    if (!Speech) return toast('This browser cannot turn speech into text. Use Chrome or Edge.');
    if (rec) return rec.stop();
    rec = new Speech();
    rec.lang = q('lang').value;
    rec.continuous = true;
    rec.interimResults = true;
    const before = text.value ? `${text.value.trimEnd()} ` : '';
    rec.onresult = (e) => {
      text.value = before + [...e.results].map((r) => r[0].transcript).join(' ');
      autosize();
    };
    rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Allow the microphone for this page (icon in the address bar).' : `Voice: ${e.error}`);
    rec.onend = () => {
      rec = null;
      q('mic').classList.remove('primary');
      q('mic').innerHTML = `${svg(ICON.mic, 16)} Voice`;
      text.focus();
    };
    rec.start();
    q('mic').classList.add('primary');
    q('mic').innerHTML = `${svg(ICON.stop, 14)} Listening… click to stop`;
  };
  q('interrupt').onclick = () => key('esc');

  async function upload(fileList) {
    for (const f of fileList) {
      q('note').textContent = `Uploading ${f.name}…`;
      try {
        const r = await fetch(`/api/p/${PID}/upload?name=${encodeURIComponent(f.name || 'pasted.png')}`, { method: 'POST', body: f });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'upload failed');
        v.files.push({ ...j, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
      } catch (e) {
        toast(`${f.name}: ${e.message}`);
      }
    }
    q('note').textContent = '';
    renderFiles();
  }
  function renderFiles() {
    q('files').innerHTML = v.files
      .map((f, i) => `<span class="attachment">${f.preview ? `<img src="${f.preview}" alt="">` : svg(ICON.other_file, 16)}<span class="ellipsis">${esc(f.name)}</span><button class="btn ghost small" data-rm="${i}" title="Remove">${svg(ICON.x, 12)}</button></span>`)
      .join('');
    $$('[data-rm]', q('files')).forEach((b) => (b.onclick = () => (v.files.splice(+b.dataset.rm, 1), renderFiles())));
  }
  q('attach').onclick = () => q('picker').click();
  q('picker').onchange = (e) => (upload([...e.target.files]), (e.target.value = ''));
  const comp = q('composer');
  comp.ondragover = (e) => (e.preventDefault(), comp.classList.add('drop'));
  comp.ondragleave = () => comp.classList.remove('drop');
  comp.ondrop = (e) => (e.preventDefault(), comp.classList.remove('drop'), upload([...e.dataTransfer.files]));
  text.onpaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) (e.preventDefault(), upload(files));
  };

  // Effort and model: Claude restarts on the same conversation with the new setting.
  const change = async () => {
    const effort = q('effort').value;
    const model = q('model').value;
    if (!v.info.running) return api(`/api/s/${v.info.sid}/restart`, { method: 'POST', body: { effort, model } }).then(() => api(`/api/s/${v.info.sid}/stop`, { method: 'POST' })).catch(() => {});
    if (v.busy && !confirm('Claude is working. Changing this restarts it and stops the current step. Continue?')) return v.setInfo(v.info);
    try {
      v.setInfo(await api(`/api/s/${v.info.sid}/restart`, { method: 'POST', body: { effort, model } }));
      toast(`Claude continues the same conversation with effort ${effort}${model ? ` and ${model}` : ''}.`);
    } catch (e) {
      toast(e.message);
    }
  };
  q('effort').onchange = change;
  q('model').onchange = change;

  q('run').onclick = async () => {
    try {
      v.setInfo(await api(`/api/s/${v.info.sid}/${v.info.running ? 'stop' : 'restart'}`, { method: 'POST', body: {} }));
    } catch (e) {
      toast(e.message);
    }
  };

  // Raw terminal, for anything the chat view cannot show.
  const paintMode = () => $$('[data-m]', q('mode')).forEach((b) => b.classList.toggle('on', b.dataset.m === v.mode));
  paintMode();
  $$('[data-m]', q('mode')).forEach((b) => (b.onclick = () => v.setMode(b.dataset.m)));
  v.toggleMode = () => {
    v.mode = v.mode === 'chat' ? 'term' : 'chat';
    paintMode();
    q('log').classList.toggle('hidden', v.mode !== 'chat');
    q('term').classList.toggle('hidden', v.mode === 'chat');
    q('termsize').classList.toggle('hidden', v.mode === 'chat');
    askSig = '';
    renderAsk(v.info.ask);
    if (v.mode === 'term') {
      openTerminal();
      requestAnimationFrame(() => {
        setTimeout(() => {
          v.fit?.();
          v.term?.focus();
        }, 60);
      });
    } else {
      v.poll(true);
    }
  };
  v.setMode = (m) => v.mode !== m && v.toggleMode();
  async function openTerminal() {
    if (v.term) {
      setTimeout(() => v.fit?.(), 30);
      return;
    }
    if (v.opening) return;
    v.opening = true;
    const size = +localStorage.getItem('studio:termFont') || (innerWidth < 760 ? 11 : 13);
    // The letters are measured once when the terminal opens: with the web font still loading they
    // were measured on the fallback font, and text overlapped once the real font arrived.
    await Promise.race([document.fonts.load(`${size}px "JetBrains Mono"`).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    const term = new Terminal({ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: size, cursorBlink: true, theme: { background: '#141210' }, scrollback: 5000 });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(q('term'));
    v.term = term;
    v.opening = false;
    // wss on the https address (the phone through the tunnel): browsers block plain ws there.
    // The connection is re-opened by itself when it drops (mobile networks, tunnel hiccups).
    let ws;
    let retry = 0;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/term?sid=${v.info.sid}`);
      v.ws = ws;
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        // The terminal's real size, set by the browser in use: draw at that size so the screen is
        // the same everywhere (a phone and the PC at once used to garble each other).
        if (msg.t === 'size') return void (msg.cols !== term.cols || msg.rows !== term.rows ? term.resize(msg.cols, msg.rows) : null);
        term.write(msg.d);
      };
      ws.onopen = () => {
        retry = 0;
        term.reset();
        setTimeout(() => v.fit?.(), 50);
      };
      ws.onclose = () => {
        if (!v.term) return;
        term.write('\r\n\x1b[2m[connection lost, reconnecting…]\x1b[0m\r\n');
        setTimeout(() => {
          if (!v.term) return;
          term.reset();
          connect();
        }, Math.min(10000, 1000 * 2 ** retry++));
      };
    };
    term.write('\x1b[2mConnecting to the terminal…\x1b[0m\r\n');
    connect();
    // This browser takes the terminal: it is sized to fit here and the others follow.
    let fitting = false;
    v.fit = () => {
      if (v.mode !== 'term' || !q('term')?.offsetParent || fitting) return;
      fitting = true;
      try {
        const d = fit.proposeDimensions();
        if (d && d.cols >= 10 && d.rows >= 5) {
          if (d.cols !== term.cols || d.rows !== term.rows) {
            term.resize(d.cols, d.rows);
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
          }
        }
      } catch {}
      setTimeout(() => { fitting = false; }, 80);
    };
    let lastFit = 0;
    term.onData((d) => {
      // Typing here after another browser had the terminal: take it back first.
      if (Date.now() - lastFit > 3000) ((lastFit = Date.now()), v.fit());
      ws.readyState === 1 && ws.send(JSON.stringify({ t: 'i', d }));
    });
    term.textarea?.addEventListener('focus', () => v.fit());
    addEventListener('focus', () => v.term && q('term')?.offsetParent && v.fit());
    // Refit whenever the session pane changes: window, divider drag, wide chat, tab switch.
    let pending;
    v.observer = new ResizeObserver(() => (clearTimeout(pending), (pending = setTimeout(() => q('term')?.offsetParent && v.fit(), 80))));
    v.observer.observe(el);
    // Text size: the A- / A+ buttons, or Ctrl + mouse wheel over the terminal.
    v.zoom = (d) => {
      term.options.fontSize = Math.max(9, Math.min(24, term.options.fontSize + d));
      localStorage.setItem('studio:termFont', term.options.fontSize);
      v.fit();
    };
    q('term').addEventListener('wheel', (e) => e.ctrlKey && (e.preventDefault(), v.zoom(e.deltaY < 0 ? 1 : -1)), { passive: false });
    setTimeout(v.fit, 30);
  }
  q('termsize').innerHTML = `<button class="btn small ghost" data-zoom="-1" title="Smaller text">A-</button><button class="btn small ghost" data-zoom="1" title="Bigger text">A+</button>`;
  $$('[data-zoom]', q('termsize')).forEach((b) => (b.onclick = () => v.zoom?.(+b.dataset.zoom)));

  v.destroy = () => {
    v.observer?.disconnect();
    v.ws?.close();
    v.term?.dispose();
    el.remove();
  };
  v.setInfo(info);
  return v;
}

// ---------- new session ----------
async function openNewSession() {
  $('#new-session').classList.remove('hidden');
  $('#ns-name').value = '';
  $('#ns-task').value = '';
  // The side task branches from the tab you are on (or the main conversation).
  const from = sessionList.find((s) => s.sid === current) ?? sessionList.find((s) => s.main);
  $('#ns-from').textContent = from ? `Branches from "${from.name}".` : 'No conversation to branch from yet: it starts empty.';
  $('#ns-effort').value = from?.effort || 'high';
  $('#ns-history').innerHTML = '<div class="muted small">Loading earlier conversations…</div>';
  const hist = await api(`/api/p/${PID}/history`).catch(() => []);
  $('#ns-history').innerHTML = hist.length
    ? hist
        .map(
          (h) => `<div class="card row" style="padding:8px 10px;box-shadow:none">
            <div class="grow"><div class="ellipsis">${esc(h.title)}</div><div class="muted small">${timeAgo(h.mtime)} · ${sizeOf(h.size)}${h.busyElsewhere ? ' · running in another window' : ''}</div></div>
            ${h.busyElsewhere ? `<button class="btn small" data-watch="${h.uuid}">Watch</button><button class="btn small" data-fork="${h.uuid}">Fork</button>` : `<button class="btn small" data-resume="${h.uuid}">Continue</button><button class="btn small ghost" data-fork="${h.uuid}">Fork</button>`}
          </div>`,
        )
        .join('')
    : '<div class="muted small">No earlier conversations in this folder.</div>';
  const opts = () => ({ name: $('#ns-name').value.trim(), effort: $('#ns-effort').value, model: $('#ns-model').value });
  const open = async (body) => {
    try {
      const s = await api(`/api/p/${PID}/sessions`, { method: 'POST', body: { ...opts(), ...body } });
      $('#new-session').classList.add('hidden');
      current = s.sid;
      await refreshSessions();
    } catch (e) {
      toast(e.message);
    }
  };
  $('#ns-start').onclick = () => open({});
  $('#ns-branch').onclick = () => {
    const task = $('#ns-task').value.trim();
    const name = opts().name || (task ? task.split(/\s+/).slice(0, 4).join(' ') : 'Side task');
    if (!from) return open({ name, prompt: task || undefined });
    open({ resume: from.uuid, fork: true, name, prompt: task ? `Side task, in this separate tab (the main conversation continues elsewhere, so do not repeat its work): ${task}` : undefined });
  };
  $$('[data-resume]').forEach((b) => (b.onclick = () => open({ resume: b.dataset.resume })));
  $$('[data-fork]').forEach((b) => (b.onclick = () => open({ resume: b.dataset.fork, fork: true, name: opts().name || 'Fork' })));
  $$('[data-watch]').forEach((b) => (b.onclick = () => open({ attach: b.dataset.watch, name: opts().name || 'Main (watching)' })));
}
$('#ns-cancel').onclick = () => $('#new-session').classList.add('hidden');

// ---------- new session (fresh, continues from the handoff) ----------
// A side task carries the whole conversation (costly); a new session starts clean and reads the
// project's handoff (data/<id>/handoff.md in Studio notes, kept up to date by Claude).
async function openFreshSession() {
  $('#fresh-session').classList.remove('hidden');
  $('#fs-name').value = '';
  $('#fs-prompt').value = 'Loading the latest handoff…';
  const r = await fetch(`/api/p/${PID}/raw?root=1&path=handoff.md`).catch(() => null);
  $('#fs-prompt').value = r?.ok ? await r.text() : 'No handoff yet. Write what this session should work on.';
}
$('#fs-cancel').onclick = () => $('#fresh-session').classList.add('hidden');
$('#fs-start').onclick = async () => {
  const prompt = $('#fs-prompt').value.trim();
  try {
    const s = await api(`/api/p/${PID}/sessions`, { method: 'POST', body: { name: $('#fs-name').value.trim() || 'New session', effort: $('#fs-effort').value, model: $('#fs-model').value, prompt: prompt || undefined } });
    $('#fresh-session').classList.add('hidden');
    current = s.sid;
    await refreshSessions();
  } catch (e) {
    toast(e.message);
  }
};

// ---------- modular workspace elements & layout ----------
const PANEL_LABEL = {
  overview: 'Overview',
  board: 'Board',
  preview: 'Preview',
  phone: 'Phone',
  files: 'Files',
  git: 'Git Radar',
  agents: 'Agents',
  docs: 'Docs',
  skills: 'Skills',
  notes: 'Scratchpad',
  sysmon: 'Telemetry',
  env: 'Env Matrix'
};

let panelTimer = null;
let currentLayout = localStorage.getItem(`layout:${PID}`) || 'split';

function applyLayout(mode) {
  currentLayout = mode;
  localStorage.setItem(`layout:${PID}`, mode);
  const main = $('#main');
  if (!main) return;
  main.classList.remove('layout-split', 'layout-flip', 'layout-bottom', 'wide-chat');
  if (mode === 'flip') {
    main.classList.add('layout-flip');
  } else if (mode === 'bottom') {
    main.classList.add('layout-bottom');
  } else if (mode === 'wide') {
    main.classList.add('wide-chat');
  } else {
    main.classList.add('layout-split');
  }
  $$('[data-set-layout]').forEach((b) => b.classList.toggle('active-mode', b.dataset.setLayout === mode));
  const btn = $('#layout-toggle');
  if (btn) {
    btn.textContent = mode === 'flip' ? '◧ Layout: Flip' : mode === 'bottom' ? '⬒ Layout: Bottom' : mode === 'wide' ? '◻ Layout: Wide' : '◫ Layout: Split';
  }
  setTimeout(() => views.get(current)?.fit?.(), 60);
}

function cycleLayout() {
  const layouts = ['split', 'flip', 'bottom', 'wide'];
  const nextIdx = (layouts.indexOf(currentLayout) + 1) % layouts.length;
  applyLayout(layouts[nextIdx]);
}

function renderPanelTabs() {
  const panels = P?.workspace?.panels || ['overview', 'board', 'preview', 'files', 'git', 'notes'];
  const tabs = $('#p-tabs');
  if (!tabs) return;
  tabs.innerHTML = panels.map((k, idx) => {
    const icon = svg(ICON[k] || ICON.other, 13);
    const label = PANEL_LABEL[k] || k;
    const isFirst = idx === 0;
    const isLast = idx === panels.length - 1;
    return `
      <div class="tab panel-tab ${k === panel ? 'on' : ''}" data-k="${k}" draggable="true" title="Drag to reorder or click to open">
        <span class="tab-drag-handle" title="Drag to reposition">⋮⋮</span>
        <span class="tab-icon">${icon}</span>
        <span class="tab-label">${esc(label)}</span>
        <span class="tab-actions">
          ${!isFirst ? `<button class="tab-shift" data-shift-k="${k}" data-dir="-1" title="Move left">◀</button>` : ''}
          ${!isLast ? `<button class="tab-shift" data-shift-k="${k}" data-dir="1" title="Move right">▶</button>` : ''}
          ${panels.length > 1 ? `<button class="tab-close" data-del-k="${k}" title="Remove element from workspace">×</button>` : ''}
        </span>
      </div>`;
  }).join('');

  $$('#p-tabs .panel-tab').forEach((tab) => {
    tab.onclick = (e) => {
      if (e.target.closest('.tab-shift') || e.target.closest('.tab-close')) return;
      showPanel(tab.dataset.k);
    };

    tab.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', tab.dataset.k);
      tab.classList.add('dragging');
    };
    tab.ondragend = () => tab.classList.remove('dragging');
    tab.ondragover = (e) => {
      e.preventDefault();
      tab.classList.add('drag-over');
    };
    tab.ondragleave = () => tab.classList.remove('drag-over');
    tab.ondrop = async (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over');
      const srcKey = e.dataTransfer.getData('text/plain');
      const targetKey = tab.dataset.k;
      if (!srcKey || srcKey === targetKey) return;

      const curPanels = [...(P.workspace?.panels || [])];
      const fromIdx = curPanels.indexOf(srcKey);
      const toIdx = curPanels.indexOf(targetKey);
      if (fromIdx === -1 || toIdx === -1) return;

      curPanels.splice(fromIdx, 1);
      curPanels.splice(toIdx, 0, srcKey);
      await reorderPanels(curPanels);
    };
  });

  $$('#p-tabs [data-shift-k]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const k = btn.dataset.shiftK;
      const dir = +btn.dataset.dir;
      const curPanels = [...(P.workspace?.panels || [])];
      const idx = curPanels.indexOf(k);
      if (idx === -1) return;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= curPanels.length) return;
      const temp = curPanels[idx];
      curPanels[idx] = curPanels[targetIdx];
      curPanels[targetIdx] = temp;
      await reorderPanels(curPanels);
    };
  });

  $$('#p-tabs [data-del-k]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const k = btn.dataset.delK;
      await removePanel(k);
    };
  });
}

async function reorderPanels(newOrder) {
  try {
    P.workspace.panels = newOrder;
    renderPanelTabs();
    await api(`/api/p/${PID}/panels/reorder`, { method: 'POST', body: { order: newOrder } });
    toast('Element tabs reordered.');
  } catch (err) {
    toast(err.message);
  }
}

async function addPanel(key) {
  try {
    const res = await api(`/api/p/${PID}/panels/add`, { method: 'POST', body: { panel: key } });
    P.workspace.panels = res.panels;
    renderPanelTabs();
    showPanel(key);
    toast(`Added "${PANEL_LABEL[key] || key}" to workspace.`);
    updateCatalogModal();
    updateManagerModal();
  } catch (err) {
    toast(err.message);
  }
}

async function removePanel(key) {
  if ((P.workspace?.panels?.length || 0) <= 1) {
    return toast('You must keep at least one element in the workspace.');
  }
  try {
    const res = await api(`/api/p/${PID}/panels/remove`, { method: 'POST', body: { panel: key } });
    P.workspace.panels = res.panels;
    if (panel === key) {
      showPanel(res.panels[0]);
    }
    renderPanelTabs();
    toast(`Removed "${PANEL_LABEL[key] || key}" from workspace.`);
    updateCatalogModal();
    updateManagerModal();
  } catch (err) {
    toast(err.message);
  }
}

async function openCatalogModal() {
  const modal = $('#element-catalog-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  updateCatalogModal();
}

async function updateCatalogModal() {
  const container = $('#element-catalog-list');
  if (!container) return;
  container.innerHTML = '<div class="muted small" style="grid-column:1/-1;padding:20px;text-align:center">Loading elements catalog…</div>';
  try {
    const { catalog = [] } = await api(`/api/p/${PID}/panels/catalog`);
    const activePanels = new Set(P.workspace?.panels || []);
    container.innerHTML = catalog.map((item) => {
      const isActive = activePanels.has(item.id);
      const icon = svg(ICON[item.id] || ICON.other, 22);
      return `
        <div class="card catalog-item ${isActive ? 'is-active' : ''}" style="padding:14px;display:flex;flex-direction:column;gap:8px">
          <div class="row">
            <div class="type-icon" style="width:34px;height:34px">${icon}</div>
            <div class="grow">
              <div style="font-weight:600;font-size:14px">${esc(item.label)}</div>
              <div class="small muted">${esc(item.category || 'Workspace Tool')}</div>
            </div>
            ${isActive ? '<span class="chip good" style="font-size:11px">Active</span>' : ''}
          </div>
          <div class="muted small grow" style="line-height:1.4">${esc(item.desc)}</div>
          <div class="row" style="margin-top:6px;justify-content:flex-end">
            ${isActive
              ? `<button class="btn small ghost danger" data-catalog-remove="${esc(item.id)}">Remove</button>`
              : `<button class="btn small primary" data-catalog-add="${esc(item.id)}">+ Add to Screen</button>`
            }
          </div>
        </div>`;
    }).join('');

    $$('[data-catalog-add]', container).forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        await addPanel(btn.dataset.catalogAdd);
      };
    });
    $$('[data-catalog-remove]', container).forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        await removePanel(btn.dataset.catalogRemove);
      };
    });
  } catch (err) {
    container.innerHTML = `<div class="chip bad">${esc(err.message)}</div>`;
  }
}

function openManagerModal() {
  const modal = $('#element-manager-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  updateManagerModal();
}

function updateManagerModal() {
  const container = $('#element-manager-list');
  if (!container) return;
  const panels = P.workspace?.panels || [];
  $$('[data-set-layout]').forEach((b) => b.classList.toggle('active-mode', b.dataset.setLayout === currentLayout));
  container.innerHTML = panels.map((k, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === panels.length - 1;
    const icon = svg(ICON[k] || ICON.other, 18);
    const label = PANEL_LABEL[k] || k;
    return `
      <div class="card row" style="padding:10px 14px;box-shadow:none;align-items:center;background:var(--surface)">
        <div class="type-icon" style="width:28px;height:28px">${icon}</div>
        <div class="grow">
          <b>${esc(label)}</b> <code class="small muted" style="font-size:11px">#${esc(k)}</code>
        </div>
        <div class="row" style="gap:4px">
          <button class="btn small ghost" data-mgr-shift="${k}" data-dir="-1" ${isFirst ? 'disabled' : ''} title="Move Earlier">▲</button>
          <button class="btn small ghost" data-mgr-shift="${k}" data-dir="1" ${isLast ? 'disabled' : ''} title="Move Later">▼</button>
          <button class="btn small ghost danger" data-mgr-del="${k}" ${panels.length <= 1 ? 'disabled' : ''} title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');

  $$('[data-mgr-shift]', container).forEach((btn) => {
    btn.onclick = async () => {
      const k = btn.dataset.mgrShift;
      const dir = +btn.dataset.dir;
      const curPanels = [...(P.workspace?.panels || [])];
      const idx = curPanels.indexOf(k);
      if (idx === -1) return;
      const targetIdx = idx + dir;
      if (targetIdx < 0 || targetIdx >= curPanels.length) return;
      const temp = curPanels[idx];
      curPanels[idx] = curPanels[targetIdx];
      curPanels[targetIdx] = temp;
      await reorderPanels(curPanels);
      updateManagerModal();
    };
  });

  $$('[data-mgr-del]', container).forEach((btn) => {
    btn.onclick = async () => {
      await removePanel(btn.dataset.mgrDel);
      updateManagerModal();
    };
  });
}

function showPanel(k) {
  if (!PANELS[k]) k = 'overview';
  panel = k;
  localStorage.setItem(`panel:${PID}`, k);
  $$('#p-tabs .panel-tab').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  clearInterval(panelTimer);
  const box = $('#p-body');
  box.innerHTML = '<div class="empty">Loading…</div>';
  PANELS[k](box);
}

const PANELS = {
  async overview(box) {
    const draw = async () => {
      const st = await api(`/api/p/${PID}/status`).catch(() => ({}));
      if (panel !== 'overview') return;
      const hasAbout = !!P.description;
      const hasNext = !!(st.next?.length);
      const hasDone = !!(st.done?.length);
      box.innerHTML = `
        <div class="overview-grid">
          <div class="card now-box overview-banner">
            <div class="row" style="margin-bottom:4px">
              <span class="chip good"><span class="dot live"></span>Live Project Status</span>
              <span class="muted small">${st.updated ? `Updated ${timeAgo(Date.parse(st.updated))}` : 'Active'}</span>
              <span class="grow"></span>
              <span class="chip info">${(st.done?.length || 0)} milestones completed</span>
            </div>
            <div class="now-text">${esc(st.now || 'Claude is actively working on this project.')}</div>
          </div>
          ${hasAbout ? `
            <div class="card overview-card overview-about">
              <h2>About & Architecture</h2>
              <div class="md">${md(P.description)}</div>
            </div>` : ''}
          ${hasNext ? `
            <div class="card overview-card overview-next">
              <div class="row" style="margin-bottom:8px">
                <h2 style="margin:0" class="grow">Next Tasks</h2>
                <span class="chip warn">${st.next.length} planned</span>
              </div>
              <ul class="list next">${st.next.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            </div>` : ''}
          ${hasDone ? `
            <div class="card overview-card overview-done">
              <div class="row" style="margin-bottom:8px">
                <h2 style="margin:0" class="grow">Completed Milestones</h2>
                <span class="chip good">${st.done.length} done</span>
              </div>
              <ul class="list done">${st.done.slice(0, 40).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            </div>` : ''}
        </div>`;
    };
    await draw();
    panelTimer = setInterval(draw, 10000);
  },

  async agents(box) {
    // Finished helpers and cards can be cleared from view (remembered in this browser); running,
    // waiting and paused ones always stay.
    const KEY = `cleared:${PID}`;
    const cleared = () => new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
    const clear = (ids) => localStorage.setItem(KEY, JSON.stringify([...new Set([...cleared(), ...ids])]));
    const isDone = (c) => ['done', 'finished', 'stopped', 'failed'].includes(String(c.status ?? '').toLowerCase());
    let showCleared = false;
    const draw = async () => {
      const { cards = [], helpers = [] } = await api(`/api/p/${PID}/agents`).catch(() => ({}));
      if (panel !== 'agents') return;
      const gone = cleared();
      // A helper that has not written for 10 minutes has finished (or stopped).
      const finishedHelper = (h) => !h.working && Date.now() - h.mtime > 10 * 60000;
      const visHelpers = helpers.filter((h) => showCleared || !gone.has(`h:${h.agentId}`));
      const visCards = cards.filter((c) => showCleared || !gone.has(`c:${c.key}`));
      const hiddenCount = helpers.length - visHelpers.length + cards.length - visCards.length;
      const finishedIds = [...helpers.filter(finishedHelper).map((h) => `h:${h.agentId}`), ...cards.filter(isDone).map((c) => `c:${c.key}`)].filter((id) => !gone.has(id));
      const working = helpers.filter((h) => h.working).length;
      const x = (id) => `<button class="btn ghost small" data-clear="${esc(id)}" title="Remove from this list">${svg(ICON.x, 13)}</button>`;
      box.innerHTML = `
        <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
          <span class="grow muted small">${working ? `<span class="chip good"><span class="dot live"></span>${working} helper${working > 1 ? 's' : ''} working</span>` : 'No helper is working right now.'}</span>
          ${finishedIds.length ? `<button class="btn small" data-clearall>Clear ${finishedIds.length} finished</button>` : ''}
          ${hiddenCount ? `<button class="btn small ghost" data-toggle>${showCleared ? 'Hide cleared' : `Show cleared (${hiddenCount})`}</button>` : ''}
        </div>
        <div class="section"><h2>Workers</h2>
        ${visCards.map((c) => `<div class="card agent"><div class="row"><span class="chip ${isDone(c) ? 'good' : c.status === 'running' ? 'info' : c.status === 'paused' ? 'warn' : ''}">${esc(c.status ?? '')}</span><h3 class="grow">${esc(c.name ?? c.key)}</h3>${isDone(c) ? x(`c:${c.key}`) : ''}</div>
          <div class="muted small">${esc(c.task ?? '')}</div>
          ${c.progress?.[1] ? `<div class="progress"><div style="width:${Math.min(100, (100 * c.progress[0]) / c.progress[1]).toFixed(1)}%"></div></div><div class="muted small">${c.progress[0]} of ${c.progress[1]}</div>` : ''}
          ${c.now ? `<div>${esc(c.now)}</div>` : ''}
          ${c.results?.length ? `<ul class="results">${c.results.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          ${c.agentId ? `<div class="row"><button class="btn small" data-feed="${esc(c.agentId)}">Watch what it is doing</button></div>` : ''}
        </div>`).join('') || '<div class="muted small">No workers.</div>'}
        </div>
        <div class="section"><h2>Helpers</h2>
        ${visHelpers.length ? visHelpers.map((h) => `<div class="card agent"><div class="row"><span class="${h.working ? 'dot live' : 'dot'}"></span><b class="grow ellipsis">${esc(cards.find((c) => c.key === h.card)?.name ?? h.task.split('\n')[0].slice(0, 80))}</b><span class="muted small">${h.working ? 'working' : `finished ${timeAgo(h.mtime)}`}</span>${finishedHelper(h) ? x(`h:${h.agentId}`) : ''}</div><div class="muted small" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(h.task)}</div><div class="row"><button class="btn small" data-feed="${h.agentId}">${h.working ? 'Watch what it is doing' : 'See what it did'}</button></div></div>`).join('') : '<div class="muted small">No helpers to show.</div>'}
        </div>`;
      $$('[data-feed]', box).forEach((b) => (b.onclick = () => openAgent(b.dataset.feed, b.closest('.agent').querySelector('b,h3')?.textContent)));
      $$('[data-clear]', box).forEach((b) => (b.onclick = () => (clear([b.dataset.clear]), draw())));
      const all = $('[data-clearall]', box);
      if (all) all.onclick = () => (clear(finishedIds), toast(`Cleared ${finishedIds.length} finished agent${finishedIds.length > 1 ? 's' : ''}.`), draw());
      const tog = $('[data-toggle]', box);
      if (tog) tog.onclick = () => ((showCleared = !showCleared), draw());
    };
    await draw();
    panelTimer = setInterval(draw, 8000);
  },

  async files(box) {
    const roots = await api(`/api/p/${PID}/roots`).catch(() => []);
    const st = { root: 0, dir: '', kind: '', q: '' };
    box.innerHTML = `
      <div class="files-bar">
        <select data-root>${roots.map((r) => `<option value="${r.i}">${esc(r.label)}</option>`).join('')}</select>
        <input type="search" placeholder="Find a file by name" data-q class="grow" />
      </div>
      <div class="files-bar"><div class="filters" data-filters>${[['', 'Folders'], ['image', 'Images'], ['audio', 'Audio'], ['video', 'Video'], ['doc', 'Docs'], ['data', 'Data'], ['code', 'Code']]
        .map(([k, l]) => `<button data-kind="${k}" class="${k === '' ? 'on' : ''}">${l}</button>`)
        .join('')}</div></div>
      <div class="crumbs" data-crumbs style="margin-bottom:10px"></div>
      <div data-items></div>`;
    const q = (k) => $(`[data-${k}]`, box);
    const draw = async () => {
      const search = st.q || st.kind;
      q('crumbs').classList.toggle('hidden', !!search);
      const parts = st.dir ? st.dir.split('/') : [];
      q('crumbs').innerHTML = [`<button data-go="">${esc(roots[st.root]?.label ?? 'Project')}</button>`, ...parts.map((p, i) => `<span class="muted">/</span><button data-go="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`)].join('');
      $$('[data-go]', box).forEach((b) => (b.onclick = () => ((st.dir = b.dataset.go), draw())));
      q('items').innerHTML = '<div class="muted small">Loading…</div>';
      const items = search
        ? (await api(`/api/p/${PID}/find?root=${st.root}&q=${encodeURIComponent(st.q)}&kind=${st.kind}`).catch(() => [])).map((f) => ({ ...f, path: f.rel }))
        : (await api(`/api/p/${PID}/ls?root=${st.root}&dir=${encodeURIComponent(st.dir)}`).catch(() => [])).map((f) => ({ ...f, path: st.dir ? `${st.dir}/${f.name}` : f.name }));
      if (!items.length) return void (q('items').innerHTML = '<div class="empty">Nothing here.</div>');
      q('items').innerHTML = `<div class="grid">${items
        .map((f) => {
          const raw = `/api/p/${PID}/raw?root=${st.root}&path=${encodeURIComponent(f.path)}`;
          const thumb = f.kind === 'image' ? `<img loading="lazy" src="${raw}" alt="">` : svg(ICON[f.kind] ?? ICON.other_file, 30);
          return `<div class="tile" data-path="${esc(f.path)}" data-kind="${f.kind}" title="${esc(f.path)}"><div class="thumb">${thumb}</div><div class="name">${esc(f.name)}<small>${f.dir ? 'folder' : `${sizeOf(f.size)} · ${timeAgo(f.mtime)}`}</small></div></div>`;
        })
        .join('')}</div>`;
      $$('.tile', box).forEach((t) => (t.onclick = () => (t.dataset.kind === 'folder' ? ((st.dir = t.dataset.path), (st.q = ''), (q('q').value = ''), draw()) : openFile(st.root, t.dataset.path))));
    };
    q('root').onchange = (e) => ((st.root = +e.target.value), (st.dir = ''), draw());
    let t;
    q('q').oninput = (e) => (clearTimeout(t), (t = setTimeout(() => ((st.q = e.target.value.trim()), draw()), 300)));
    $$('[data-kind]', q('filters')).forEach((b) => (b.onclick = () => ((st.kind = b.dataset.kind), $$('[data-kind]', q('filters')).forEach((x) => x.classList.toggle('on', x === b)), draw())));
    draw();
  },

  async board(box) {
    // The whiteboard runs in its own page (it is a big drawing app); Claude reads and draws on it
    // through files in the board folder.
    const st = await api(`/api/p/${PID}/board/state`).catch(() => ({}));
    box.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;gap:8px">
      <div class="row" style="flex-wrap:wrap">
        <span class="muted small grow">Draw, write and drop images here. Claude can see the board and draw on it too.</span>
        <button class="btn small" data-tell title="Tells the Claude in the open tab where the board is and how to use it">Tell Claude about the board</button>
        <a class="btn small ghost" href="board.html?id=${encodeURIComponent(PID)}" target="_blank" rel="noopener">Open in a new window</a>
      </div>
      <iframe src="board.html?id=${encodeURIComponent(PID)}" style="flex:1;min-height:420px;width:100%;border:1px solid var(--line, #ddd);border-radius:10px;background:#fff" title="Board"></iframe>
    </div>`;
    $('[data-tell]', box).onclick = async () => {
      const s = sessionList.find((x) => x.sid === current);
      if (!s) return toast('Open a Claude tab first.');
      const dir = String(st.dir ?? '').replace(/\\/g, '/');
      const text = `The project has a shared whiteboard in the Board panel of Claude Studio, in ${dir}. Read ${dir}/README.md to learn how to see it (board.png, images/) and how to draw on it (add.json). Use it when planning or explaining things with me. For now just say in one line that you can use it.`;
      try {
        await api(`/api/s/${s.sid}/input`, { method: 'POST', body: { text } });
        toast(`Told "${s.name}" about the board.`);
      } catch (err) {
        toast(err.message);
      }
    };
  },
  async docs(box) {
    const docs = await api(`/api/p/${PID}/docs`).catch(() => []);
    if (!docs.length) return void (box.innerHTML = '<div class="empty">No Markdown documents in this project yet.</div>');
    box.innerHTML = `<div class="docs"><div class="doc-list">${docs.map((d, i) => `<button data-i="${i}">${esc(d.name.replace(/\.mdx?$/i, ''))}<small>${esc(d.rel.split('/').slice(0, -1).join('/') || 'top folder')} · ${timeAgo(d.mtime)}</small></button>`).join('')}</div><div data-doc></div></div>`;
    const show = async (i) => {
      $$('.doc-list button', box).forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
      const d = docs[i];
      const text = await fetch(`/api/p/${PID}/raw?root=${d.root}&path=${encodeURIComponent(d.rel)}`).then((r) => r.text());
      const html = md(text);
      const target = $('[data-doc]', box);
      target.innerHTML = `<div class="card toc" data-toc></div><div class="md">${html}</div>`;
      const heads = $$('.md h1, .md h2, .md h3', target);
      heads.forEach((h, n) => (h.id = `h-${n}`));
      $('[data-toc]', target).innerHTML = heads.length > 2 ? heads.map((h, n) => `<a href="#h-${n}" style="padding-left:${(+h.tagName[1] - 1) * 12}px">${esc(h.textContent)}</a>`).join('') : '';
      if (heads.length <= 2) $('[data-toc]', target).remove();
      highlight(target);
    };
    $$('.doc-list button', box).forEach((b) => (b.onclick = () => show(+b.dataset.i)));
    show(0);
  },

  async phone(box) {
    box.innerHTML = `
      <div class="section card" style="padding:14px">
        <div class="row" style="flex-wrap:wrap">
          <h2 class="grow" style="margin:0">Phone screen</h2>
          <span class="chip" data-state>Checking…</span>
          <select data-device class="hidden"></select>
          <button class="btn small primary hidden" data-emu-start>Start emulator</button>
          <button class="btn small ghost hidden" data-emu-stop>Stop emulator</button>
        </div>
        <div class="muted small" style="margin-top:6px">Claude sees and uses this screen with its phone tools. Click to tap, drag to swipe, hold the click for a long press.</div>
        <div style="margin-top:10px">
          <img class="phone-shot hidden" data-img alt="Phone screen" draggable="false" style="cursor:pointer;touch-action:none;user-select:none">
          <div class="muted small" data-empty style="text-align:center;padding:40px 0">No phone or emulator is running.</div>
        </div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap;justify-content:center">
          <button class="btn small" data-key="back">Back</button>
          <button class="btn small" data-key="home">Home</button>
          <button class="btn small" data-key="recents">Apps</button>
          <input type="text" data-text placeholder="Type into the phone" style="width:200px">
          <button class="btn small" data-type>Send</button>
        </div>
      </div>
      <div class="section card" style="padding:14px"><h2>Run the app</h2>
        <div class="row" style="flex-wrap:wrap">
          <span class="chip" data-metro>Metro: checking…</span>
          <button class="btn small" data-metro-start>Start Metro</button>
          <button class="btn small ghost" data-metro-stop>Stop Metro</button>
        </div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn primary small" data-open-app>Open the app</button>
          <button class="btn small" data-restart-app>${svg(ICON.refresh, 14)} Restart the app</button>
        </div>
        <div class="muted small" style="margin-top:8px">Metro sends the app's latest code to the device shown above. Start it once, then open the app; after a change, restart the app to load it.</div>
      </div>
      <details class="section"><summary class="muted" style="cursor:pointer">Your own phone (Wi-Fi) and the smooth view</summary>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn small" data-mirror>Smooth view (60 fps window)</button>
          <button class="btn small ghost" data-stop>Close smooth view</button>
        </div>
        <div class="muted small" style="margin-top:10px">On the phone: Developer options, Wireless debugging. Use "Pair with code" the first time.</div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap"><input type="text" placeholder="192.168.0.20:37099" data-addr><input type="text" placeholder="Pairing code (first time)" data-code style="width:180px"><button class="btn small" data-connect>Connect</button></div>
      </details>`;
    const q = (k) => $(`[data-${k}]`, box);
    const alive = () => panel === 'phone' && box.isConnected;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let st = { devices: [] };

    // Device state: which device is shown, and whether the emulator runs or is starting.
    const state = async () => {
      st = await api('/api/phone/state').catch(() => st);
      if (!alive()) return;
      const emu = st.devices.find((d) => d.emulator);
      const cur = st.devices.find((d) => d.serial === st.current);
      const chip = q('state');
      if (st.starting || (emu && !emu.booted)) (chip.className = 'chip warn'), (chip.textContent = 'Emulator starting (about a minute)…');
      else if (cur) (chip.className = 'chip good'), (chip.innerHTML = `<span class="dot live"></span>${esc(cur.model)}`);
      else (chip.className = 'chip'), (chip.textContent = 'Nothing running');
      q('emu-start').classList.toggle('hidden', !!emu || !!st.starting);
      q('emu-start').disabled = !st.avds?.length;
      q('emu-stop').classList.toggle('hidden', !emu);
      const ready = st.devices.filter((d) => d.booted);
      const sel = q('device');
      sel.classList.toggle('hidden', ready.length < 2);
      if (ready.length > 1 && document.activeElement !== sel) sel.innerHTML = ready.map((d) => `<option value="${esc(d.serial)}" ${d.serial === st.current ? 'selected' : ''}>${esc(d.model)} (${esc(d.serial)})</option>`).join('');
    };
    q('device').onchange = async (e) => (await api('/api/phone/use', { method: 'POST', body: { serial: e.target.value } }).catch((err) => toast(err.message)), state());
    q('emu-start').onclick = async () => {
      st.starting = true;
      q('emu-start').classList.add('hidden');
      toast('Starting the emulator. It shows here in about a minute.');
      await api('/api/phone/emulator', { method: 'POST', body: { action: 'start' } }).catch((err) => toast(err.message));
      state();
    };
    q('emu-stop').onclick = async () => {
      if (!confirm('Shut the emulator down?')) return;
      await api('/api/phone/emulator', { method: 'POST', body: { action: 'stop' } }).catch((err) => toast(err.message));
      setTimeout(state, 2000);
    };
    state();
    (async () => {
      while (alive()) (await sleep(4000), alive() && (await state()));
    })();

    // The live screen: the next picture is asked for as soon as the last one arrived.
    const img = q('img');
    let url = null;
    (async () => {
      while (alive()) {
        if (document.hidden) {
          await sleep(1000);
          continue;
        }
        try {
          const r = await fetch(`/api/phone/screen?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) throw new Error();
          const next = URL.createObjectURL(await r.blob());
          await new Promise((ok) => ((img.onload = ok), (img.onerror = ok), (img.src = next)));
          if (url) URL.revokeObjectURL(url);
          url = next;
          img.classList.remove('hidden');
          q('empty').classList.add('hidden');
          await sleep(250);
        } catch {
          img.classList.add('hidden');
          q('empty').classList.remove('hidden');
          await sleep(3000);
        }
      }
      if (url) URL.revokeObjectURL(url);
    })();

    // Click = tap, drag = swipe, held click = long press (in the picture's own pixels).
    const input = (body) => api('/api/phone/input', { method: 'POST', body }).catch((err) => toast(err.message));
    const at = (e) => {
      const r = img.getBoundingClientRect();
      return { x: Math.round(((e.clientX - r.left) / r.width) * img.naturalWidth), y: Math.round(((e.clientY - r.top) / r.height) * img.naturalHeight) };
    };
    let down = null;
    img.onpointerdown = (e) => {
      e.preventDefault();
      img.setPointerCapture(e.pointerId);
      down = { ...at(e), t: Date.now() };
    };
    img.onpointerup = (e) => {
      if (!down) return;
      const up = at(e);
      const ms = Date.now() - down.t;
      if (Math.hypot(up.x - down.x, up.y - down.y) > 8) input({ action: 'swipe', x: down.x, y: down.y, x2: up.x, y2: up.y, ms: Math.max(120, Math.min(ms, 2000)) });
      else input({ action: ms > 600 ? 'hold' : 'tap', x: down.x, y: down.y });
      down = null;
    };
    img.oncontextmenu = (e) => e.preventDefault();
    $$('[data-key]', box).forEach((b) => (b.onclick = () => input({ action: 'key', key: b.dataset.key })));
    const send = () => {
      const t = q('text').value;
      if (!t) return;
      input({ action: 'type', text: t });
      q('text').value = '';
    };
    q('type').onclick = send;
    q('text').onkeydown = (e) => e.key === 'Enter' && send();

    q('mirror').onclick = () => api('/api/phone/mirror', { method: 'POST', body: {} }).then(() => toast('The phone opens in its own window.')).catch((e) => toast(e.message));
    q('stop').onclick = () => api('/api/phone/stop', { method: 'POST', body: {} }).catch((e) => toast(e.message));
    q('connect').onclick = () =>
      api('/api/phone/connect', { method: 'POST', body: { address: q('addr').value.trim(), code: q('code').value.trim() } })
        .then((r) => (toast(r.out || r.err || 'Done'), state()))
        .catch((e) => toast(e.message));

    // Metro and the app: the helper on port 4548 runs them (it keeps working when Studio restarts).
    const HELPER = '/api/helper'; // through Studio, so it also works from the phone
    const helper = (p, body) => api(`${HELPER}${p}`, body ? { method: 'POST', body } : {});
    const metroState = async () => {
      const m = await helper('/metro').catch(() => null);
      if (!alive()) return;
      const chip = q('metro');
      chip.className = `chip ${m?.running ? 'good' : ''}`;
      chip.innerHTML = m ? (m.running ? '<span class="dot live"></span>Metro is running' : 'Metro is stopped') : 'Helper not running';
      q('metro-start').disabled = !m || m.running;
      q('metro-stop').disabled = !m?.running;
    };
    metroState();
    const metroTimer = setInterval(() => (alive() ? metroState() : clearInterval(metroTimer)), 4000);
    q('metro-start').onclick = async () => {
      toast('Starting Metro in its own window (about 20 seconds)…');
      await helper('/metro/start', {}).catch((e) => toast(e.message));
      setTimeout(metroState, 3000);
    };
    q('metro-stop').onclick = async () => (await helper('/metro/stop', {}).catch((e) => toast(e.message)), metroState());
    const openApp = async () => {
      try {
        const r = await helper('/phone/app', { serial: st.current });
        toast(r.ok ? `Opening the app on ${r.device}. The first load can take a minute.` : r.err);
      } catch (e) {
        toast(e.message);
      }
    };
    q('open-app').onclick = openApp;
    q('restart-app').onclick = openApp;
  },

  async preview(box) {
    const url = P?.workspace?.previewUrl ?? '';
    let currentWidth = '100%';
    box.innerHTML = `
      <div class="files-bar" style="gap:6px">
        <input type="url" class="grow" data-url value="${esc(url)}" placeholder="http://localhost:5173" style="font-family:var(--mono);font-size:12.5px" />
        <button class="btn small primary" data-go>Load</button>
        <button class="btn small ghost" data-reload title="Reload iframe">${svg(ICON.refresh, 14)}</button>
        <div class="seg" style="margin-left:4px">
          <button data-w="100%" class="on" title="Desktop 100%">Desktop</button>
          <button data-w="1024px" title="Laptop 1024px">1024px</button>
          <button data-w="768px" title="Tablet 768px">768px</button>
          <button data-w="375px" title="Mobile 375px">375px</button>
        </div>
        <a class="btn small ghost" data-open target="_blank" title="Open in new window">${svg(ICON.expand, 14)}</a>
      </div>
      ${url ? '' : '<div class="muted small" style="margin-bottom:8px">Claude sets the preview address when your app or dev server runs, or enter one above.</div>'}
      <div class="preview-stage">
        <iframe data-frame style="width:100%;height:100%;border:none;border-radius:6px;background:#fff;transition:width 0.2s ease-in-out" ${url ? `src="${esc(url)}"` : ''}></iframe>
      </div>`;
    const q = (k) => $(`[data-${k}]`, box);
    const go = () => {
      const u = q('url').value.trim();
      q('frame').src = u;
      q('open').href = u;
    };
    q('go').onclick = go;
    q('reload').onclick = () => {
      const src = q('frame').src;
      if (src) q('frame').src = src;
    };
    if (url) q('open').href = url;
    $$('.seg button[data-w]', box).forEach((btn) => {
      btn.onclick = () => {
        $$('.seg button[data-w]', box).forEach((b) => b.classList.toggle('on', b === btn));
        currentWidth = btn.dataset.w;
        q('frame').style.width = currentWidth;
      };
    });
  },

  async git(box) {
    const draw = async () => {
      const data = await api(`/api/p/${PID}/git`).catch((e) => ({ error: e.message }));
      if (panel !== 'git') return;
      if (data.error) {
        box.innerHTML = `<div class="empty">${esc(data.error)}</div>`;
        return;
      }
      const isGit = data.isRepo || data.isGit;
      if (!isGit) {
        box.innerHTML = `
          <div class="empty">
            <div style="margin-bottom:8px">${svg(ICON.git, 36)}</div>
            <h3>No Git Repository Detected</h3>
            <div class="muted small">This project folder is not currently a git repository. Ask Claude in chat to initialize git with <code>git init</code>.</div>
          </div>`;
        return;
      }
      const branch = data.branch || 'HEAD';
      const changes = data.changes || data.changed || [];
      const commits = data.commits || [];
      const isClean = data.clean !== undefined ? data.clean : changes.length === 0;

      box.innerHTML = `
        <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
          <span class="chip ${isClean ? 'good' : 'warn'}">
            <span class="${isClean ? 'dot live' : 'dot warn'}"></span>
            Branch: <b>${esc(branch)}</b> · ${isClean ? 'Working tree clean' : `${changes.length} changed file${changes.length > 1 ? 's' : ''}`}
          </span>
          <span class="grow"></span>
          <button class="btn small ghost" data-git-refresh>${svg(ICON.refresh, 13)} Refresh</button>
        </div>
        <div class="git-grid">
          <div class="card" style="padding:16px">
            <h2 style="margin:0 0 10px">Changed Files (${changes.length})</h2>
            ${changes.length ? `
              <div style="display:grid;gap:4px;max-height:480px;overflow-y:auto">
                ${changes.map((c) => {
                  const code = c.code || c.status || 'M';
                  const filePath = c.path || c.file || '';
                  const badgeClass = code.includes('M') ? 'warn' : code.includes('A') || code.includes('?') ? 'good' : 'bad';
                  return `
                    <div class="row" style="padding:7px 10px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px">
                      <span class="chip ${badgeClass}" style="padding:1px 6px;font-size:10.5px">${esc(code)}</span>
                      <span class="grow ellipsis" title="${esc(filePath)}">${esc(filePath)}</span>
                    </div>`;
                }).join('')}
              </div>` : '<div class="muted small">Everything committed. No staged or unstaged changes.</div>'
            }
          </div>
          <div class="card" style="padding:16px">
            <h2 style="margin:0 0 10px">Recent Commits (${commits.length})</h2>
            ${commits.length ? `
              <div style="display:grid;gap:6px;max-height:480px;overflow-y:auto">
                ${commits.map((cm) => {
                  const subject = cm.subject || cm.message || '';
                  const relTime = cm.rel || cm.date || '';
                  return `
                    <div class="row" style="padding:9px 12px;border-bottom:1px solid var(--line);align-items:flex-start">
                      <code style="color:var(--accent-cyan);font-weight:600;font-size:11.5px">${esc(cm.hash)}</code>
                      <div class="grow" style="min-width:0">
                        <div style="font-weight:500;font-size:13px">${esc(subject)}</div>
                        <div class="muted small">${esc(cm.author)} · ${esc(relTime)}</div>
                      </div>
                    </div>`;
                }).join('')}
              </div>` : '<div class="muted small">No commits recorded yet.</div>'
            }
          </div>
        </div>`;
      $('[data-git-refresh]', box).onclick = draw;
    };
    await draw();
    panelTimer = setInterval(draw, 8000);
  },

  async notes(box) {
    const data = await api(`/api/p/${PID}/notes`).catch(() => ({ content: '' }));
    let text = data.content ?? '';
    let previewMode = false;
    let saveTimeout = null;
    let saveState = 'saved';

    const render = () => {
      if (panel !== 'notes') return;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      box.innerHTML = `
        <div class="notes-container">
          <div class="row" style="flex-wrap:wrap;gap:8px">
            <span class="small muted grow">Shared AI scratchpad stored at <code>data/${esc(PID)}/notes.md</code></span>
            <span class="small chip ${saveState === 'saving' ? 'warn' : 'good'}" data-notes-status>
              ${saveState === 'saving' ? 'Saving…' : '✓ Saved'}
            </span>
            <span class="small muted">${words} words · ${chars} chars</span>
            <button class="btn small ghost" data-copy-notes title="Copy scratchpad content">Copy</button>
            <button class="btn small ghost" data-toggle-view>${previewMode ? 'Edit Raw' : 'Preview MD'}</button>
            <button class="btn small primary" data-save-notes>Save</button>
          </div>
          <div style="flex:1;min-height:0;display:flex;flex-direction:column">
            ${previewMode
              ? `<div class="card md" style="flex:1;overflow-y:auto;padding:18px 22px;background:var(--surface)">${text.trim() ? md(text) : '<span class="muted small">Scratchpad is empty.</span>'}</div>`
              : `<textarea class="card notes-editor" style="padding:14px;resize:none;font-family:var(--mono);font-size:13px;line-height:1.6;background:var(--code-bg);border:1px solid var(--line)" placeholder="Type scratchpad notes, tasks, or system design docs here. Claude and you share this file.">${esc(text)}</textarea>`
            }
          </div>
        </div>`;

      const editor = $('textarea.notes-editor', box);
      if (editor) {
        editor.oninput = (e) => {
          text = e.target.value;
          saveState = 'saving';
          const stEl = $('[data-notes-status]', box);
          if (stEl) {
            stEl.className = 'small chip warn';
            stEl.textContent = 'Saving…';
          }
          clearTimeout(saveTimeout);
          saveTimeout = setTimeout(doSave, 800);
        };
      }

      $('[data-copy-notes]', box).onclick = () => {
        navigator.clipboard?.writeText(text);
        toast('Scratchpad copied to clipboard.');
      };

      $('[data-toggle-view]', box).onclick = () => {
        previewMode = !previewMode;
        render();
      };
      $('[data-save-notes]', box).onclick = () => doSave();
    };

    const doSave = async () => {
      clearTimeout(saveTimeout);
      saveState = 'saving';
      try {
        await api(`/api/p/${PID}/notes`, { method: 'POST', body: { content: text } });
        saveState = 'saved';
        const stEl = $('[data-notes-status]', box);
        if (stEl) {
          stEl.className = 'small chip good';
          stEl.textContent = '✓ Saved';
        }
      } catch (err) {
        toast(`Failed to save notes: ${err.message}`);
      }
    };

    render();
  },

  async sysmon(box) {
    const draw = async () => {
      const data = await api(`/api/p/${PID}/sysmon`).catch((e) => ({ error: e.message }));
      if (panel !== 'sysmon') return;
      if (data.error) {
        box.innerHTML = `<div class="empty">${esc(data.error)}</div>`;
        return;
      }
      const mem = data.memory || {};
      const heapUsedMB = mem.heapUsedMB ?? (mem.heapUsed ? (mem.heapUsed / 1024 / 1024).toFixed(1) : (mem.heap ?? 0));
      const heapTotalMB = mem.heapTotalMB ?? (mem.heapTotal ? (mem.heapTotal / 1024 / 1024).toFixed(1) : (mem.totalHeap ?? 1));
      const rssMB = mem.rssMB ?? (mem.rssBytes ? (mem.rssBytes / 1024 / 1024).toFixed(1) : (mem.rss ?? 0));
      const heapPct = Math.min(100, Math.round(((+heapUsedMB) / (+heapTotalMB || 1)) * 100)) || 0;
      const uptimeSec = data.uptime ?? 0;
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const activeSessions = data.activeSessionsCount ?? data.activeTabs ?? 0;

      box.innerHTML = `
        <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
          <span class="chip good"><span class="dot live"></span>AI Workstation Telemetry · Online</span>
          <span class="grow"></span>
          <span class="small muted">Node ${esc(data.nodeVersion)} · ${esc(data.platform)} (${esc(data.arch)})</span>
          <button class="btn small ghost" data-tele-refresh>${svg(ICON.refresh, 13)}</button>
        </div>
        <div class="sysmon-grid">
          <div class="card" style="padding:16px;background:var(--surface)">
            <div class="small muted" style="text-transform:uppercase;letter-spacing:0.05em">Process Uptime</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:var(--accent)">${hours}h ${mins}m</div>
            <div class="small muted" style="margin-top:2px">Studio Server Core</div>
          </div>
          <div class="card" style="padding:16px;background:var(--surface)">
            <div class="small muted" style="text-transform:uppercase;letter-spacing:0.05em">Memory Allocation</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:var(--good)">${heapUsedMB} MB <span class="small muted" style="font-weight:400">/ ${heapTotalMB} MB</span></div>
            <div class="progress" style="margin-top:8px"><div style="width:${heapPct}%;background:var(--good)"></div></div>
          </div>
          <div class="card" style="padding:16px;background:var(--surface)">
            <div class="small muted" style="text-transform:uppercase;letter-spacing:0.05em">Active Sessions</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:var(--info)">${activeSessions} <span class="small muted" style="font-weight:400">in project</span></div>
            <div class="small muted" style="margin-top:2px">${data.cpus ?? 0} CPU cores available</div>
          </div>
        </div>
        <div class="section">
          <h2>Resource Matrix</h2>
          <div class="card" style="padding:16px;display:grid;gap:10px">
            <div class="row"><span class="small muted grow">Physical Memory (RSS)</span><code style="font-weight:600">${rssMB} MB</code></div>
            <div class="row"><span class="small muted grow">V8 Heap Allocation</span><code style="font-weight:600">${heapUsedMB} MB (${heapPct}%)</code></div>
            <div class="row"><span class="small muted grow">CPU Hardware Cores</span><code style="font-weight:600">${esc(data.cpus)} threads</code></div>
            <div class="row"><span class="small muted grow">Host Process PID</span><code>${esc(data.pid)}</code></div>
          </div>
        </div>`;
      $('[data-tele-refresh]', box).onclick = draw;
    };
    await draw();
    panelTimer = setInterval(draw, 5000);
  },

  async env(box) {
    const draw = async () => {
      const data = await api(`/api/p/${PID}/env`).catch((e) => ({ error: e.message }));
      if (panel !== 'env') return;
      if (data.error) {
        box.innerHTML = `<div class="empty">${esc(data.error)}</div>`;
        return;
      }
      const vars = data.variables || data.vars || [];
      box.innerHTML = `
        <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
          <div class="grow">
            <h2 style="margin:0">Environment Configuration Matrix</h2>
            <div class="small muted">Read & modify variables in <code>.env</code>. Secrets are protected.</div>
          </div>
          <button class="btn small" data-add-env-var>+ Add Variable</button>
          <button class="btn small primary" data-save-env>Save Changes</button>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <table class="env-table" style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead>
              <tr style="background:var(--surface-2);border-bottom:1px solid var(--line);text-align:left">
                <th style="padding:10px 14px;width:35%">Key</th>
                <th style="padding:10px 14px">Value</th>
                <th style="padding:10px 14px;width:80px;text-align:right">Action</th>
              </tr>
            </thead>
            <tbody id="env-tbody">
              ${vars.map((v, i) => {
                const key = v.key || '';
                const val = v.value ?? v.val ?? '';
                const isSecret = v.isSecret !== undefined ? v.isSecret : /KEY|SECRET|TOKEN|PASS|AUTH|PWD|API/i.test(key);
                return `
                  <tr style="border-bottom:1px solid var(--line)">
                    <td style="padding:8px 12px">
                      <input type="text" class="env-key" value="${esc(key)}" style="width:100%;font-family:var(--mono);font-weight:600" />
                    </td>
                    <td style="padding:8px 12px">
                      <div class="row">
                        <input type="${isSecret ? 'password' : 'text'}" class="env-val grow" value="${esc(val)}" style="font-family:var(--mono)" />
                        ${isSecret ? `<button class="btn small ghost" data-toggle-secret="${i}" title="Reveal/Hide Secret">👁</button>` : ''}
                      </div>
                    </td>
                    <td style="padding:8px 12px;text-align:right">
                      <button class="btn small ghost danger" data-del-env="${i}">✕</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
          ${!vars.length ? '<div class="empty">No .env file or variables found in this project. Click "+ Add Variable" to create one.</div>' : ''}
        </div>`;

      $$('[data-toggle-secret]', box).forEach((btn) => {
        btn.onclick = () => {
          const row = btn.closest('tr');
          const input = row.querySelector('.env-val');
          if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🔒';
          } else {
            input.type = 'password';
            btn.textContent = '👁';
          }
        };
      });

      $$('[data-del-env]', box).forEach((btn) => {
        btn.onclick = () => {
          btn.closest('tr').remove();
        };
      });

      $('[data-add-env-var]', box).onclick = () => {
        const tbody = $('#env-tbody');
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--line)';
        tr.innerHTML = `
          <td style="padding:8px 12px"><input type="text" class="env-key" placeholder="KEY_NAME" style="width:100%;font-family:var(--mono);font-weight:600" /></td>
          <td style="padding:8px 12px"><input type="text" class="env-val grow" placeholder="Value" style="width:100%;font-family:var(--mono)" /></td>
          <td style="padding:8px 12px;text-align:right"><button class="btn small ghost danger" onclick="this.closest('tr').remove()">✕</button></td>`;
        tbody.append(tr);
        tr.querySelector('.env-key').focus();
      };

      $('[data-save-env]', box).onclick = async (e) => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        const rows = $$('#env-tbody tr');
        const updated = [];
        rows.forEach((r) => {
          const k = r.querySelector('.env-key')?.value.trim();
          const v = r.querySelector('.env-val')?.value ?? '';
          if (k) updated.push({ key: k, value: v });
        });
        try {
          await api(`/api/p/${PID}/env`, { method: 'POST', body: { variables: updated } });
          toast('.env updated successfully.');
          await draw();
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          btn.textContent = 'Save Changes';
        }
      };
    };
    await draw();
  },

  async skills(box) {
    // Grouped by where each skill comes from. Anthropic's core skills (Word, PDF, PowerPoint, Excel)
    // are never switched off by "Turn all off", and switching one off asks first.
    const GROUPS = [
      ['skill', 'Skills on this PC', 'Installed here (like find-skills or impeccable).'],
      ['plugin', 'Plugins', 'Installed Claude Code plugins.'],
      ['Anthropic core', 'From claude.ai: Anthropic core', "Anthropic's own skills for Word, PDF, PowerPoint and Excel files. Keep these on."],
      ['Anthropic extra', 'From claude.ai: Anthropic extras', 'Made by Anthropic. Keep the browser, computer-use, docs and Google ones; the art and theme ones are optional.'],
      ['Added by the account', 'From claude.ai: added by the account', 'Plugins and skills added on claude.ai by the account owner. Safe to turn off.'],
    ];
    const groupOf = (i) => (i.kind === 'claude.ai' ? i.origin ?? 'Added by the account' : i.kind);
    const set = async (body) => draw(await api('/api/skills/set', { method: 'POST', body }).catch((e) => ({ error: e.message })));
    const draw = async (data) => {
      const { items = [], error } = data ?? (await api('/api/skills').catch((e) => ({ error: e.message })));
      if (error) return void (box.innerHTML = `<div class="empty">${esc(error)}</div>`);
      const on = items.filter((i) => i.on).length;
      const notCore = items.filter((i) => groupOf(i) !== 'Anthropic core').map((i) => i.id);
      box.innerHTML = `<div class="row" style="margin-bottom:12px;flex-wrap:wrap"><div class="grow muted small">${on} of ${items.length} on. Changes apply the next time a Claude session starts.</div><button class="btn small" data-allids="0">Turn all off (keeps Anthropic core)</button><button class="btn small" data-allids="1">Turn all on</button></div>
        ${GROUPS.map(([key, title, about]) => {
          const list = items.filter((i) => groupOf(i) === key);
          if (!list.length) return '';
          const onHere = list.filter((i) => i.on).length;
          return `<div class="section"><div class="row" style="flex-wrap:wrap"><h2 class="grow" style="margin:0">${esc(title)} <span class="muted small">${onHere} of ${list.length} on</span></h2>
            <button class="btn small ghost" data-group="${esc(key)}" data-on="0">All off</button><button class="btn small ghost" data-group="${esc(key)}" data-on="1">All on</button></div>
            <div class="muted small" style="margin:4px 0 8px">${esc(about)}</div>
            ${list.map((i) => `<div class="card agent"><div class="row"><b class="grow">${esc(i.name)}</b><label class="row small"><input type="checkbox" data-id="${esc(i.id)}" data-core="${groupOf(i) === 'Anthropic core' ? 1 : 0}" ${i.on ? 'checked' : ''}> on</label></div><div class="muted small">${esc(i.about ?? '')}</div></div>`).join('')}
          </div>`;
        }).join('')}`;
      $$('[data-allids]', box).forEach((b) => (b.onclick = () => set({ on: b.dataset.allids === '1', ids: b.dataset.allids === '1' ? items.map((i) => i.id) : notCore })));
      $$('[data-group]', box).forEach((b) => (b.onclick = () => {
        if (b.dataset.group === 'Anthropic core' && b.dataset.on === '0' && !confirm("These are Anthropic's core skills for Word, PDF, PowerPoint and Excel. Turn them all off anyway?")) return;
        set({ on: b.dataset.on === '1', ids: items.filter((i) => groupOf(i) === b.dataset.group).map((i) => i.id) });
      }));
      $$('[data-id]', box).forEach((c) => (c.onchange = () => {
        if (!c.checked && c.dataset.core === '1' && !confirm("This is one of Anthropic's core skills (Word, PDF, PowerPoint or Excel files). Turn it off anyway?")) return void (c.checked = true);
        set({ on: c.checked, id: c.dataset.id });
      }));
    };
    draw();
  },
};

// ---------- file viewer and agent feed (side drawer) ----------
function drawer(title, body, foot = '') {
  $('.drawer')?.remove();
  const d = document.createElement('div');
  d.className = 'drawer';
  d.innerHTML = `<div class="drawer-head"><b class="grow ellipsis">${esc(title)}</b><button class="btn ghost small" data-x>${svg(ICON.x, 16)}</button></div><div class="panel" data-body>${body}</div>${foot}`;
  document.body.append(d);
  $('[data-x]', d).onclick = () => (d.remove(), clearInterval(d.timer));
  addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') (d.remove(), clearInterval(d.timer), removeEventListener('keydown', esc));
  });
  return d;
}

function jsonTree(v, key) {
  const k = key !== undefined ? `<span class="k">${esc(key)}</span>: ` : '';
  if (v && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    return `<details ${key === undefined ? 'open' : ''}><summary>${k}${Array.isArray(v) ? `[${entries.length}]` : `{${entries.length}}`}</summary>${entries.slice(0, 500).map(([kk, vv]) => jsonTree(vv, kk)).join('')}</details>`;
  }
  const cls = typeof v === 'string' ? 's' : 'n';
  return `<div style="margin-left:14px">${k}<span class="${cls}">${esc(JSON.stringify(v))}</span></div>`;
}

async function openFile(root, rel) {
  const raw = `/api/p/${PID}/raw?root=${root}&path=${encodeURIComponent(rel)}`;
  const name = rel.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();
  const kind = Object.entries({ image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'], audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'], video: ['mp4', 'webm', 'mov'], pdf: ['pdf'] }).find(([, l]) => l.includes(ext))?.[0];
  const d = drawer(rel, '<div class="muted">Opening…</div>', `<div class="drawer-head"><span class="muted small grow ellipsis">${esc(rel)}</span><a class="btn small" href="${raw}" target="_blank">Open the raw file</a></div>`);
  const body = $('[data-body]', d);
  if (kind === 'image') return void (body.innerHTML = `<div class="viewer"><img class="big" src="${raw}" alt=""></div>`);
  if (kind === 'audio') return void (body.innerHTML = `<div class="viewer"><audio controls autoplay src="${raw}"></audio></div>`);
  if (kind === 'video') return void (body.innerHTML = `<div class="viewer"><video controls src="${raw}"></video></div>`);
  if (kind === 'pdf') return void (body.innerHTML = `<div class="viewer"><iframe src="${raw}"></iframe></div>`);
  const r = await fetch(raw);
  if (+r.headers.get('content-length') > 3 * 1048576) return void (body.innerHTML = '<div class="muted">This file is large; use "Open the raw file".</div>');
  const text = await r.text();
  if (/^mdx?$/.test(ext)) body.innerHTML = `<div class="md">${md(text)}</div>`;
  else if (ext === 'json') {
    try {
      body.innerHTML = `<div class="json">${jsonTree(JSON.parse(text))}</div>`;
    } catch {
      body.innerHTML = `<div class="viewer"><pre><code>${esc(text)}</code></pre></div>`;
    }
  } else if (ext === 'csv' || ext === 'tsv') {
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 500).map((l) => l.split(ext === 'csv' ? ',' : '\t'));
    body.innerHTML = `<table class="data-table">${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table>`;
  } else if (ext === 'html') body.innerHTML = `<div class="viewer"><iframe sandbox src="${raw}"></iframe><details><summary>Source</summary><pre><code class="language-html">${esc(text)}</code></pre></details></div>`;
  else body.innerHTML = `<div class="viewer"><pre><code>${esc(text)}</code></pre></div>`;
  highlight(body);
}

function openAgent(agentId, title) {
  const d = drawer(title || `Helper ${agentId}`, '<div class="muted">Loading…</div>', `<div class="composer"><textarea rows="2" data-msg placeholder="Message this helper (passed on by the Claude session that started it)"></textarea><div class="row"><span class="grow"></span><button class="btn small primary" data-send>${svg(ICON.send, 14)} Send</button></div></div>`);
  const body = $('[data-body]', d);
  let rev = '';
  const draw = async () => {
    const r = await api(`/api/p/${PID}/agent/${agentId}?rev=${rev}`).catch(() => null);
    if (!r || r.same) return;
    rev = r.rev;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML = `<div class="log" style="padding:0">${(r.entries ?? [])
      .map((e) =>
        e.k === 'user' ? `<div class="msg user">${esc(e.text.slice(0, 2000))}</div>` : e.k === 'text' ? `<div class="msg claude md">${md(e.text)}</div>` : e.k === 'tool' ? `<div class="step ${e.state}"><span class="i">${e.state === 'running' ? svg(ICON.spinner, 13) : svg(ICON.check, 13)}</span><div>${esc(e.label)}</div></div>` : '',
      )
      .join('')}</div>`;
    highlight(body);
    if (atBottom) body.scrollTop = body.scrollHeight;
  };
  draw();
  d.timer = setInterval(draw, 2500);
  $('[data-send]', d).onclick = async () => {
    const text = $('[data-msg]', d).value.trim();
    if (!text) return;
    try {
      const r = await api(`/api/p/${PID}/agent/${agentId}/message`, { method: 'POST', body: { text } });
      $('[data-msg]', d).value = '';
      toast(`Sent through ${r.via}.`);
    } catch (e) {
      toast(e.message);
    }
  };
}

init();


// ---------- Claude accounts ----------
// Two Claude accounts, each with its own saved login: switching moves the open tab to the other
// account and it continues the same conversation (the history is shared).
async function renderAccounts() {
  const box = $('#account');
  const { current, list = [] } = await api('/api/accounts').catch(() => ({}));
  if (!list.length) return;
  const tab = sessionList.find((x) => x.sid === current_tab());
  const active = tab?.account ?? current;
  // The limits in the top bar follow the account of the open tab.
  if (window.limitsAccount !== active) ((window.limitsAccount = active), renderLimits($('#limits')));
  const status = (a) => (a.hold ? ' · on hold' : a.loggedIn ? (a.email ? ` · ${a.email}` : '') : ' · needs login');
  box.innerHTML = `<select class="small" title="Claude account. Switching moves this tab to the other account; the conversation continues.">${list
    .map((a) => `<option value="${esc(a.id)}" ${a.id === active ? 'selected' : ''}>${esc(a.label)}${esc(status(a))}</option>`)
    .join('')}<option value="__manage">Manage accounts…</option></select>`;
  $('select', box).onchange = async (e) => {
    const id = e.target.value;
    if (id === '__manage') return (renderAccounts(), manageAccounts());
    const acct = list.find((a) => a.id === id);
    await api('/api/accounts/current', { method: 'POST', body: { id } }).catch((err) => toast(err.message));
    if (!acct.loggedIn) return (renderAccounts(), loginTab(acct));
    const s = sessionList.find((x) => x.sid === current_tab());
    if (s && s.account !== id && !s.elsewhere && confirm(`Move "${s.name}" to ${acct.label} (${acct.email}) now? It continues the same conversation.`)) {
      try {
        await api(`/api/s/${s.sid}/restart`, { method: 'POST', body: { account: id } });
        toast(`"${s.name}" now runs on ${acct.label}.`);
        await refreshSessions();
      } catch (err) {
        toast(err.message);
      }
    } else toast(`New tabs now use ${acct.label}.`);
    renderAccounts();
  };
}

/** Waits until Studio reports a login or a permanent key for this account, then says so. */
function watchLogin(acct, started, returnSid) {
  const timer = setInterval(async () => {
    if (Date.now() - started > 20 * 60000) return clearInterval(timer);
    const l = await api('/api/accounts/last-login').catch(() => ({}));
    if (!(l.at > started) || l.account !== acct.id) return;
    clearInterval(timer);
    if (l.sameAs) alert(`${l.label} signed in as ${l.email}, but ${l.sameAs} is already that account. Nothing was changed.`);
    else if (l.permanent) toast(l.email ? `${l.label} now has a permanent login (${l.email}).` : `The key for ${l.label} was saved, but it did not work. Try again.`);
    else toast(`${l.label} is logged in as ${l.email}.`);
    if (returnSid && l.moved) current = returnSid;
    await refreshSessions();
    renderAccounts();
    if ($('#accounts-dlg')) manageAccounts();
  }, 4000);
}

/** Opens a tab where the account logs in; the sign-in page opens in the normal browser. */
async function loginTab(acct) {
  if (!confirm(`Log in ${acct.label}?\n\nYour browser opens the Claude sign-in page. If it shows the right account, press Authorize.`)) return;
  const returnSid = current;
  const started = Date.now();
  try {
    const s = await api(`/api/accounts/${encodeURIComponent(acct.id)}/login`, { method: 'POST', body: { project: PID, returnSid } });
    current = s.sid;
    await refreshSessions();
    views.get(s.sid)?.setMode?.('term');
    toast('The Claude page opens in your browser in a few seconds.');
  } catch (err) {
    return toast(err.message);
  }
  watchLogin(acct, started, returnSid);
}

/** Makes a 1-year key for the account (claude setup-token); Studio saves it and uses it from then on. */
async function permanentLogin(acct) {
  if (!confirm(`Make the login of ${acct.label} permanent?\n\nYour browser opens a Claude page: check it shows this account and press Authorize. Claude Code then makes a key that lasts one year, and Studio saves it. Logging out on other devices does not end it; only revoking it on claude.ai does.`)) return;
  const started = Date.now();
  try {
    const s = await api(`/api/accounts/${encodeURIComponent(acct.id)}/permanent`, { method: 'POST', body: { project: PID } });
    current = s.sid;
    await refreshSessions();
    views.get(s.sid)?.setMode?.('term');
    toast('The Claude page opens in your browser in a few seconds. After you approve, Studio saves the key by itself.');
  } catch (err) {
    return toast(err.message);
  }
  watchLogin(acct, started, null);
}

/** The Accounts window: each account, whether it really works, and what can be done with it. */
async function manageAccounts() {
  let m = $('#accounts-dlg');
  if (!m) {
    m = document.createElement('div');
    m.id = 'accounts-dlg';
    m.className = 'modal';
    document.body.append(m);
    m.onclick = (e) => e.target === m && m.remove();
  }
  const draw = async () => {
    const acc = await api('/api/accounts').catch(() => ({}));
    const { list = [] } = acc;
    const switches = await api('/api/accounts/switches').catch(() => []);
    m.innerHTML = `<div class="card">
      <h2>Claude accounts</h2>
      <div class="muted small">Studio checks with Anthropic whether each account really works. Only working accounts are used.</div>
      <div style="display:grid;gap:8px">${list
        .map((a) => {
          const status = a.loggedIn ? (a.hold ? 'Working · paused' : 'Working') : 'Not logged in';
          const limits = a.loggedIn && (a.limits ?? []).length ? `<div class="small muted">${a.limits.map((l) => `${esc(l.label.replace(/^Current /, '').replace(/ \(.*\)$/, ''))} <b style="${l.pct >= (acc.threshold ?? 90) ? 'color:var(--bad)' : ''}">${l.pct}%</b>, resets ${esc(String(l.resets ?? '?').replace(/\s*\(.*\)$/, ''))}`).join(' · ')}</div>` : '';
          return `<div class="card row" style="padding:10px 12px;box-shadow:none;flex-wrap:wrap">
            <span class="${a.loggedIn && !a.hold ? 'dot live' : 'dot warn'}"></span>
            <div class="grow"><b>${esc(a.label)}</b> <span class="chip ${a.loggedIn ? (a.hold ? 'warn' : 'good') : 'bad'}">${status}</span>${a.permanent ? ' <span class="chip good" title="Uses a 1-year key: logging out elsewhere does not end it">Permanent</span>' : ''}
              <div class="small">${esc(a.email ?? 'no account yet')}</div>${limits}</div>
            ${a.loggedIn ? '' : `<button class="btn small primary" data-login="${esc(a.id)}">Log in</button>`}
            ${a.permanent ? '' : `<button class="btn small" data-permanent="${esc(a.id)}" title="Make a 1-year key, so this account stays logged in">Make login permanent</button>`}
            ${a.loggedIn ? `<button class="btn small ghost" data-hold="${esc(a.id)}" data-on="${a.hold ? '' : '1'}">${a.hold ? 'Resume' : 'Pause'}</button>` : ''}
            ${list.length > 1 ? `<button class="btn small ghost danger" data-remove="${esc(a.id)}">Remove</button>` : ''}
          </div>`;
        })
        .join('')}</div>
      <div class="row" style="flex-wrap:wrap"><input type="text" class="grow" data-new placeholder="Name for a new account"><button class="btn primary" data-add>Add account</button></div>
      <div class="card" style="padding:10px 12px;box-shadow:none;display:grid;gap:6px">
        <div class="row" style="flex-wrap:wrap"><b class="grow">Switch accounts automatically</b><span class="row" style="gap:0"><button class="btn small ${acc.autoSwitch !== false ? 'primary' : 'ghost'}" data-auto="on">On</button><button class="btn small ${acc.autoSwitch === false ? 'primary' : 'ghost'}" data-auto="off">Off</button></span></div>
        <div class="row small muted" style="flex-wrap:wrap">When an account reaches <input type="number" min="50" max="99" data-threshold value="${acc.threshold ?? 90}" style="width:64px;padding:3px 6px">% of its limit, its tabs move to the working account with the most room left.</div>
        ${switches.length ? `<details><summary class="muted small" style="cursor:pointer">Recent changes (${switches.length})</summary><div class="small" style="display:grid;gap:3px;margin-top:6px">${switches.map((l) => `<div>${esc(l.replace(/^(\S+)T(\d\d:\d\d)\S*/, (_, d, t) => `${d} ${t}`))}</div>`).join('')}</div></details>` : ''}
      </div>
      <div class="row" style="justify-content:space-between"><button class="btn small" data-check>Check all accounts now</button><button class="btn ghost" data-close>Close</button></div>
    </div>`;
    $('[data-close]', m).onclick = () => m.remove();
    const save = (body) => api('/api/accounts/settings', { method: 'POST', body }).then((r) => (toast(r.autoSwitch ? `Automatic switching on, at ${r.threshold}%.` : 'Automatic switching off.'), draw())).catch((err) => (toast(err.message), draw()));
    $$('[data-auto]', m).forEach((b) => (b.onclick = () => save({ autoSwitch: b.dataset.auto === 'on' })));
    $('[data-threshold]', m).onchange = (e) => save({ threshold: +e.target.value });
    $('[data-check]', m).onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Checking…';
      await api('/api/accounts/check', { method: 'POST', body: {} }).catch((err) => toast(err.message));
      draw();
    };
    $('[data-add]', m).onclick = async () => {
      try {
        const a = await api('/api/accounts', { method: 'POST', body: { label: $('[data-new]', m).value.trim() } });
        toast(`${a.label} added. Press Log in or Make login permanent.`);
        await draw();
        renderAccounts();
      } catch (err) {
        toast(err.message);
      }
    };
    $$('[data-login]', m).forEach((b) => (b.onclick = () => (m.remove(), loginTab(list.find((a) => a.id === b.dataset.login)))));
    $$('[data-permanent]', m).forEach((b) => (b.onclick = () => (m.remove(), permanentLogin(list.find((a) => a.id === b.dataset.permanent)))));
    $$('[data-hold]', m).forEach((b) => (b.onclick = async () => {
      await api(`/api/accounts/${b.dataset.hold}/hold`, { method: 'POST', body: { hold: !!b.dataset.on } }).catch((err) => toast(err.message));
      draw();
      renderAccounts();
    }));
    $$('[data-remove]', m).forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this account from Studio? Its saved login stays on this PC.')) return;
      await api(`/api/accounts/${b.dataset.remove}`, { method: 'DELETE' }).catch((err) => toast(err.message));
      draw();
      renderAccounts();
    }));
  };
  draw();
}
const current_tab = () => current;
