// Start page: every project as a card, plus creating a new project or loading an existing folder.
let mode = 'new';
let type = 'app';

async function loadProjects() {
  const list = await api('/api/projects').catch(() => []);
  const box = $('#projects');
  box.innerHTML = '';
  for (const p of list.sort((a, b) => b.active - a.active)) {
    const el = document.createElement('div');
    el.className = 'card project-card';
    el.innerHTML = `
      <div class="row">
        <div class="type-icon">${svg(ICON[p.type] ?? ICON.other, 22)}</div>
        <div class="grow">
          <h3 class="ellipsis">${esc(p.name)}</h3>
          <div class="muted small ellipsis">${esc(TYPES[p.type]?.label ?? p.type)} · ${esc(p.path)}</div>
        </div>
      </div>
      <div class="now">${esc(p.now || p.description || 'No news yet.')}</div>
      <div class="row small">
        ${p.live ? `<span class="chip good"><span class="dot live"></span>${p.live} session${p.live > 1 ? 's' : ''} open</span>` : ''}
        ${p.exists ? '' : '<span class="chip bad">Folder missing</span>'}
        <span class="muted grow" style="text-align:right">Active ${timeAgo(p.active)}</span>
        <button class="btn small ghost danger" data-del title="Delete this project">Delete</button>
      </div>`;
    el.onclick = () => (location.href = `project.html?id=${encodeURIComponent(p.id)}`);
    $('[data-del]', el).onclick = (e) => (e.stopPropagation(), deleteProject(p));
    box.append(el);
  }
  const add = document.createElement('div');
  add.className = 'card new-card';
  add.innerHTML = `<div class="type-icon">${svg(ICON.plus, 22)}</div><div><b>Start something new</b><div class="muted small">Claude talks with you about it, sets it up and builds its workspace.</div></div>`;
  add.onclick = () => openDialog('new');
  box.append(add);
}

function openDialog(m) {
  mode = m;
  $('#dlg-title').textContent = m === 'new' ? 'New project' : 'Load a project';
  $('#parent-field').classList.toggle('hidden', m !== 'new');
  $('#folder-field').classList.toggle('hidden', m === 'new');
  $('#go').textContent = m === 'new' ? 'Create and open' : 'Load and open';
  $('#form-err').textContent = '';
  $('#dlg').classList.remove('hidden');
  $('#form [name=name]').focus();
}

const STARTER_ELEMENTS = [
  { id: 'overview', label: 'Overview', on: true },
  { id: 'board', label: 'Whiteboard', on: true },
  { id: 'preview', label: 'Web Preview', on: true },
  { id: 'files', label: 'File Explorer', on: true },
  { id: 'git', label: 'Git Radar', on: true },
  { id: 'notes', label: 'AI Scratchpad', on: true },
  { id: 'sysmon', label: 'Telemetry', on: true },
  { id: 'env', label: 'Env Matrix', on: false },
  { id: 'agents', label: 'Agent Swarm', on: false },
  { id: 'docs', label: 'Documentation', on: false },
  { id: 'phone', label: 'Phone Device', on: false },
  { id: 'skills', label: 'Skills & Plugins', on: false },
];

function renderStarterElements() {
  const container = $('#starter-elements');
  if (!container) return;
  container.innerHTML = STARTER_ELEMENTS.map((el) => `
    <label class="starter-element-chip ${el.on ? 'on' : ''}">
      <input type="checkbox" value="${esc(el.id)}" ${el.on ? 'checked' : ''} style="display:none" />
      <span class="icon">${svg(ICON[el.id] || ICON.other, 14)}</span>
      <span class="label"><b>${esc(el.label)}</b></span>
    </label>
  `).join('');

  $$('#starter-elements .starter-element-chip').forEach((chip) => {
    const input = chip.querySelector('input');
    chip.onclick = (e) => {
      e.preventDefault();
      input.checked = !input.checked;
      chip.classList.toggle('on', input.checked);
    };
  });
}

$('#new-btn').onclick = () => openDialog('new');
$('#load-btn').onclick = () => openDialog('existing');
$('#cancel').onclick = () => $('#dlg').classList.add('hidden');
$('#dlg').onclick = (e) => e.target === $('#dlg') && $('#dlg').classList.add('hidden');
// The button creates the project itself (its click did not always submit the form); Enter in a field still works.
async function create() {
  if (!$('#form').reportValidity()) return;
  const f = Object.fromEntries(new FormData($('#form')));
  const starterPanels = [...$$('#starter-elements input:checked')].map((i) => i.value);
  $('#go').disabled = true;
  $('#form-err').textContent = 'Initializing workspace…';
  try {
    const r = await api('/api/projects', { method: 'POST', body: { ...f, starterPanels, mode } });
    location.href = `project.html?id=${encodeURIComponent(r.id)}&sid=${r.sid}`;
  } catch (err) {
    $('#form-err').textContent = err.message;
    $('#go').disabled = false;
  }
}
$('#form').onsubmit = (e) => (e.preventDefault(), create());
$('#go').onclick = (e) => (e.preventDefault(), create());

/** Asks how to delete: from Studio only (the folder stays), or also its folder to the Recycle Bin. */
function deleteProject(p) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card" style="max-width:480px">
    <h2>Delete "${esc(p.name)}"?</h2>
    <div class="muted small">Its Claude tabs are closed and it leaves Studio. Its conversations stay in Claude's history.</div>
    <label class="row small" style="align-items:flex-start"><input type="checkbox" data-trash style="margin-top:3px"><span>Also move its folder to the Recycle Bin<br><span class="muted">${esc(p.path)} (you can restore it from the Recycle Bin)</span></span></label>
    <div class="muted small" data-msg></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes>Delete</button></div>
  </div>`;
  document.body.append(m);
  m.onclick = (e) => e.target === m && m.remove();
  $('[data-no]', m).onclick = () => m.remove();
  $('[data-yes]', m).onclick = async (e) => {
    e.target.disabled = true;
    const trash = $('[data-trash]', m).checked;
    $('[data-msg]', m).textContent = trash ? 'Closing its tabs and moving the folder to the Recycle Bin…' : 'Deleting…';
    try {
      await api(`/api/projects/${encodeURIComponent(p.id)}${trash ? '?trash=1' : ''}`, { method: 'DELETE' });
      m.remove();
      toast(trash ? `"${p.name}" deleted; its folder is in the Recycle Bin.` : `"${p.name}" deleted from Studio; its folder was kept.`);
      loadProjects();
    } catch (err) {
      $('[data-msg]', m).textContent = err.message;
      e.target.disabled = false;
    }
  };
}

renderStarterElements();
loadProjects();
renderLimits($('#limits'));
setInterval(() => renderLimits($('#limits')), 60000);
setInterval(loadProjects, 15000);
