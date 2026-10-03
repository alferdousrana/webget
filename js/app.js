import { Engine } from './engine.js';
import * as store from './store.js';
import { analyze, extract, scanPage, probe, extractorInfo, ExtractError } from './extractor.js';
import { copyrightNotice } from './platforms.js';
import { AUDIO_FORMATS, toAudio, loadFFmpeg, isLoaded, audioName, MAX_INPUT } from './converter.js';
import {
  CATEGORIES, escapeHtml as esc, formatBytes, formatSpeed, formatEta, formatAdded, formatFullDate,
  isHttpUrl, loadSettings, saveSettings, saveBlob, extOf, proxify, categoryOf,
} from './utils.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const settings = loadSettings();
const engine = new Engine(settings);
const ui = { selected: new Set(), focused: null, tab: 'general', search: '', rows: new Map() };

// ---------- icons ----------
const ICON = {
  video: '<path d="M4 6.5h11v11H4zM15 10l5-3v10l-5-3"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 5-5 4 4 2-2 3 3"/>',
  gif: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M10 10.5H8.5a1.5 1.5 0 0 0 0 3H10v-1.2M13 10v4M15.5 14v-4h2.5M15.5 12h2"/>',
  pdf: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 13h5M9.5 16h3.5"/>',
  document: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15h5M9.5 18h3"/>',
  archive: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M12 5v3m0 2v2m0 2v2M4 9h16"/>',
  other: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/>',
};
const UI_ICON = {
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  save: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  audio: ICON.music,
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  shield: '<path d="M12 3.5 5 6.5v5c0 4.3 3 7.8 7 9 4-1.2 7-4.7 7-9v-5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17h.01"/>',
  block: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  video: ICON.video,
  mute: '<path d="M4 6.5h11v11H4zM15 10l5-3v10l-5-3"/><path d="m3 3 18 18"/>',
};
const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ftypeBadge = (t, cls = 'ftype') => `<span class="${cls} ft-${t.category}">${svg(ICON[t.category] || ICON.other)}</span>`;

// ---------- toasts ----------
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 8000 : 4500);
}

// ---------- theme ----------
function applyTheme() {
  const t = settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- status helpers ----------
function pct(t) { return t.size ? Math.min(100, (t.received / t.size) * 100) : null; }

function statusView(t) {
  const p = pct(t);
  const pTxt = p != null ? `${Math.floor(p)}%` : formatBytes(t.received);
  switch (t.status) {
    case 'queued': return { label: 'Queued', cls: 'st-queued', width: p ?? 0 };
    case 'connecting': return { label: 'Connecting\u2026', cls: 'st-connecting st-indet', width: 0 };
    case 'downloading': {
      const eta = t.size && t.speed ? formatEta((t.size - t.received) / t.speed) : '';
      return { label: pTxt, small: eta ? `${eta} left` : '', cls: `st-downloading${p == null ? ' st-indet' : ''}`, width: p ?? 0 };
    }
    case 'paused':
      if (t.pauseReason === 'retry') return { label: 'Reconnecting\u2026', small: pTxt, cls: 'st-paused', width: p ?? 0 };
      return { label: 'Paused', small: pTxt, cls: 'st-paused', width: p ?? 0 };
    case 'waiting': return { label: 'Waiting for network', small: pTxt, cls: 'st-waiting', width: p ?? 0 };
    case 'blocked': return { label: 'Blocked by site', cls: 'st-blocked', width: 100 };
    case 'error': return { label: 'Failed', small: t.received ? pTxt : '', cls: 'st-error', width: p ?? 100 };
    case 'converting': return { label: 'Converting', small: `${Math.floor((t.convertProgress || 0) * 100)}%`, cls: 'st-converting', width: (t.convertProgress || 0) * 100 };
    case 'completed': return { label: 'Completed', cls: 'st-completed', width: 100 };
    default: return { label: t.status, cls: '', width: 0 };
  }
}

function sizeText(t) {
  if (t.status === 'completed') return formatBytes(t.size);
  if (t.size) return formatBytes(t.size);
  return t.received ? formatBytes(t.received) : '\u2014';
}

// ---------- list ----------
const STATUS_ORDER = { downloading: 0, connecting: 1, converting: 2, queued: 3, waiting: 4, paused: 5, error: 6, blocked: 7, completed: 8 };
function visibleTasks() {
  const q = ui.search.trim().toLowerCase();
  let list = engine.list().filter((t) =>
    (settings.filter === 'all' || t.category === settings.filter) &&
    (!q || t.name.toLowerCase().includes(q) || (t.sourceUrl || '').toLowerCase().includes(q)));
  const cmp = {
    newest: (a, b) => b.addedAt - a.addedAt,
    oldest: (a, b) => a.addedAt - b.addedAt,
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => (b.size || b.received || 0) - (a.size || a.received || 0),
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.addedAt - a.addedAt,
  }[settings.sort] || ((a, b) => b.addedAt - a.addedAt);
  return list.sort(cmp);
}

function buildRow(t) {
  const tr = document.createElement('tr');
  tr.dataset.id = t.id;
  tr.innerHTML = `
    <td class="c-check"><label class="check"><input type="checkbox" aria-label="Select"><span></span></label></td>
    <td class="c-name"><div class="name-cell"><span class="ft-slot"></span><span class="nm"></span><span class="src"></span></div></td>
    <td class="c-size"></td>
    <td class="c-status"><div class="status"><div class="lbl"><span></span><small></small></div><div class="rail"><i></i></div></div></td>
    <td class="c-menu"><button class="icon-btn small row-btn" aria-label="Actions" aria-haspopup="menu"><svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/></svg></button></td>
    <td class="c-speed"></td>
    <td class="c-added"></td>`;
  return tr;
}

function updateRow(tr, t) {
  const r = (tr._r ||= {
    chk: $('input', tr), ft: $('.ft-slot', tr), nm: $('.nm', tr), src: $('.src', tr), size: $('.c-size', tr),
    status: $('.status', tr), lbl: $('.lbl span', tr), small: $('.lbl small', tr), bar: $('.rail i', tr),
    speed: $('.c-speed', tr), added: $('.c-added', tr),
  });
  if (tr._cat !== t.category) { r.ft.innerHTML = ftypeBadge(t); tr._cat = t.category; }
  if (r.nm.textContent !== t.name) { r.nm.textContent = t.name; r.nm.title = t.name; }
  r.src.textContent = t.platform || '';
  r.size.textContent = sizeText(t);
  const s = statusView(t);
  r.status.className = `status ${s.cls}`;
  r.lbl.textContent = s.label;
  r.small.textContent = s.small || '';
  r.bar.style.width = `${s.width}%`;
  r.status.title = t.error || t.notice || '';
  r.speed.textContent = t.status === 'downloading' ? formatSpeed(t.speed) : '0 B/s';
  r.speed.className = `c-speed speed${t.status === 'downloading' && t.speed > 0 ? ' on' : ''}`;
  r.added.textContent = formatAdded(t.addedAt);
  r.chk.checked = ui.selected.has(t.id);
  tr.classList.toggle('sel', ui.focused === t.id);
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}

function renderNow() {
  const body = $('#rows');
  const list = visibleTasks();
  const ids = new Set(list.map((t) => t.id));
  for (const [id, tr] of ui.rows) if (!ids.has(id)) { tr.remove(); ui.rows.delete(id); }
  let prev = null;
  for (const t of list) {
    let tr = ui.rows.get(t.id);
    if (!tr) { tr = buildRow(t); ui.rows.set(t.id, tr); }
    updateRow(tr, t);
    const want = prev ? prev.nextSibling : body.firstChild;
    if (tr !== want) body.insertBefore(tr, want);
    prev = tr;
  }
  const total = engine.list().length;
  $('#emptyState').hidden = total !== 0;
  $('#noMatch').hidden = !(total > 0 && list.length === 0);
  $('.dl-table').hidden = total === 0;

  // select-all state
  for (const id of [...ui.selected]) if (!engine.get(id)) ui.selected.delete(id);
  const sa = $('#selectAll');
  sa.checked = list.length > 0 && list.every((t) => ui.selected.has(t.id));
  sa.indeterminate = !sa.checked && list.some((t) => ui.selected.has(t.id));

  renderStatusbar();
  if (ui.focused) renderDetails();
}

function renderStatusbar() {
  const list = engine.list();
  const active = list.filter((t) => ['downloading', 'connecting', 'queued', 'converting'].includes(t.status)).length;
  const waiting = list.filter((t) => t.status === 'waiting').length;
  const speed = engine.totalSpeed();
  $('#sbSpeed').textContent = formatSpeed(speed);
  $('#sbActive').textContent = waiting ? `${active} active, ${waiting} waiting` : `${active} active`;
  const cur = list.find((t) => t.status === 'downloading');
  $('#sbCurrent').textContent = cur ? cur.name : '';

  // tab title shows overall progress
  const running = list.filter((t) => ['downloading', 'connecting'].includes(t.status) && t.size);
  if (running.length) {
    const rec = running.reduce((a, t) => a + t.received, 0), tot = running.reduce((a, t) => a + t.size, 0);
    document.title = `(${Math.floor((rec / tot) * 100)}%) WebGet`;
  } else document.title = waiting ? 'Offline \u2014 WebGet' : 'WebGet \u2014 download manager';
}

async function renderStorage() {
  const e = await store.storageEstimate();
  if (e) $('#sbStorage').textContent = `${formatBytes(e.usage || 0)} stored in browser`;
}

// ---------- network ----------
function renderNetwork() {
  const on = engine.online;
  const pill = $('#netPill');
  pill.classList.toggle('off', !on);
  $('span', pill).textContent = on ? 'Online' : 'Offline';
  $('#offlineBanner').hidden = on;
  const n = engine.list().filter((t) => t.status === 'waiting').length;
  $('#offlineText').textContent = n
    ? `${n} download${n > 1 ? 's are' : ' is'} paused and will continue on ${n > 1 ? 'their' : 'its'} own when the connection comes back.`
    : 'New downloads will start when the connection comes back.';
}

engine.addEventListener('change', render);
engine.addEventListener('removed', () => { render(); renderStorage(); });
engine.addEventListener('network', (e) => {
  renderNetwork();
  const resumed = engine.list().filter((t) => ['queued', 'connecting', 'downloading'].includes(t.status)).length;
  if (e.detail) toast(resumed ? `Back online. Resuming ${resumed} download${resumed > 1 ? 's' : ''}.` : 'Back online.');
  else toast('Connection lost. Downloads paused.');
});
engine.addEventListener('completed', async (e) => {
  const t = e.detail;
  renderStorage();
  if (t.postConvert) {
    const { format, bitrate } = t.postConvert;
    t.postConvert = null;
    convertTask(t, format, bitrate);
    return;
  }
  if (settings.autoSave && !t.autoSaved && !t.fromId) {
    t.autoSaved = true;
    saveTask(t);
  } else {
    toast(`Finished: ${t.name}`, { label: 'Save', run: () => saveTask(t) });
  }
});

// ---------- actions ----------
async function saveTask(t) {
  try {
    const blob = await engine.file(t.id);
    if (!blob || !blob.size) return toast('The file data is missing from this browser. Restart the download.');
    saveBlob(blob, t.name);
  } catch (err) { toast(`Couldn\u2019t save: ${err.message}`); }
}

async function openTask(t) {
  const w = window.open('', '_blank');
  const blob = await engine.file(t.id);
  const url = URL.createObjectURL(blob);
  if (w) w.location.href = url; else window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

async function convertTask(t, format = 'mp3', bitrate = '192') {
  if (t.size > MAX_INPUT) return toast('This file is over 1.8 GB, too large for the in-browser converter.');
  const prevStatus = t.status;
  engine.setStatus(t.id, 'converting', { convertProgress: 0, notice: isLoaded() ? '' : 'Loading the converter (first time only, about 31 MB)\u2026' });
  try {
    await loadFFmpeg((p) => engine.setStatus(t.id, 'converting', { convertProgress: p * 0.2 }), settings.ffmpegCoreBase);
    engine.setStatus(t.id, 'converting', { notice: '' });
    const blob = await engine.file(t.id);
    const out = await toAudio(blob, t.name, format, bitrate, (p) => engine.setStatus(t.id, 'converting', { convertProgress: 0.2 + p * 0.8 }));
    engine.setStatus(t.id, prevStatus, { convertProgress: 0 });
    const nt = await engine.addFile({ name: audioName(t.name, format), blob: out, sourceUrl: t.sourceUrl, fromId: t.id, platform: t.platform });
    toast(`Converted: ${nt.name}`, { label: 'Save', run: () => saveTask(nt) });
    if (settings.autoSave) { nt.autoSaved = true; saveTask(nt); }
    renderStorage();
    return nt;
  } catch (err) {
    engine.setStatus(t.id, prevStatus, { convertProgress: 0, notice: '' });
    toast(err.message);
  }
}

function confirmDelete(ids) {
  const n = ids.length;
  const active = ids.some((id) => engine.get(id)?.status !== 'completed');
  const msg = n === 1
    ? `Delete \u201c${engine.get(ids[0])?.name}\u201d?${active ? ' The partial download will be lost.' : ''} Files you already saved to your computer stay there.`
    : `Delete ${n} downloads? Files you already saved to your computer stay there.`;
  if (!confirm(msg)) return;
  ids.forEach((id) => { engine.remove(id); ui.selected.delete(id); if (ui.focused === id) closeDetails(); });
}

function menuItems(t) {
  const items = [];
  const canPause = ['downloading', 'connecting', 'queued', 'waiting'].includes(t.status) || (t.status === 'paused' && t.pauseReason === 'retry');
  const canResume = ['paused', 'error'].includes(t.status) && !(t.status === 'paused' && t.pauseReason === 'retry');
  if (canPause) items.push(['pause', 'Pause', () => engine.pause(t.id)]);
  if (canResume) items.push(['play', t.status === 'error' ? 'Try again' : 'Resume', () => engine.resume(t.id)]);
  if (t.status === 'blocked') {
    if (settings.proxyUrl && !t.useProxy) items.push(['shield', 'Retry through proxy', () => engine.retryWithProxy(t.id)]);
    items.push(['open', 'Open link in browser', () => window.open(t.url, '_blank', 'noopener')]);
  }
  if (t.status === 'completed') {
    items.push(['save', 'Save file', () => saveTask(t)]);
    if (['video', 'image', 'gif', 'pdf', 'music'].includes(t.category)) items.push(['open', 'Open in new tab', () => openTask(t)]);
    if (t.category === 'video' || t.category === 'music') items.push(['audio', 'Convert to audio\u2026', () => openConvert(t.id)]);
  }
  items.push('-');
  if (t.url) items.push(['copy', 'Copy file link', () => copy(t.url)]);
  if (t.sourceUrl && t.sourceUrl !== t.url) items.push(['web', 'Open source page', () => window.open(t.sourceUrl, '_blank', 'noopener')]);
  if (t.url && t.status !== 'converting') items.push(['restart', 'Restart download', () => engine.restart(t.id)]);
  items.push('-');
  items.push(['trash', 'Delete', () => confirmDelete([t.id]), 'danger']);
  return items;
}

function showMenu(anchor, items) {
  const m = $('#rowMenu');
  m.innerHTML = '';
  items.forEach((it, i) => {
    if (it === '-') { if (i && items[i - 1] !== '-' && i < items.length - 1) m.appendChild(document.createElement('hr')); return; }
    const [icon, label, run, cls] = it;
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    if (cls) b.className = cls;
    b.innerHTML = `${svg(UI_ICON[icon] || '')}<span>${esc(label)}</span>`;
    b.onclick = () => { hideMenu(); run(); };
    m.appendChild(b);
  });
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  left = Math.max(8, left);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  Object.assign(m.style, { left: `${left}px`, top: `${top}px` });
  $('button', m)?.focus();
}
function hideMenu() { $('#rowMenu').hidden = true; }
document.addEventListener('click', (e) => { if (!e.target.closest('#rowMenu') && !e.target.closest('.row-btn') && !e.target.closest('#bulkBtn')) hideMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
window.addEventListener('resize', hideMenu);
$('#listWrap').addEventListener('scroll', hideMenu);

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied.'); }
  catch { prompt('Copy this link:', text); }
}

// ---------- list events ----------
$('#rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const t = engine.get(tr.dataset.id);
  if (!t) return;
  if (e.target.closest('.check')) {
    if (e.target.matches('input')) {
      e.target.checked ? ui.selected.add(t.id) : ui.selected.delete(t.id);
      render();
    }
    return;
  }
  if (e.target.closest('.row-btn')) { showMenu(e.target.closest('.row-btn'), menuItems(t)); return; }
  openDetails(t.id);
});
$('#rows').addEventListener('dblclick', (e) => {
  const tr = e.target.closest('tr');
  const t = tr && engine.get(tr.dataset.id);
  if (!t || e.target.closest('.check, .row-btn')) return;
  if (t.status === 'completed') saveTask(t);
  else if (['paused', 'error'].includes(t.status)) engine.resume(t.id);
  else if (['downloading', 'connecting', 'queued'].includes(t.status)) engine.pause(t.id);
});
$('#rows').addEventListener('contextmenu', (e) => {
  const tr = e.target.closest('tr');
  const t = tr && engine.get(tr.dataset.id);
  if (!t) return;
  e.preventDefault();
  const fake = { getBoundingClientRect: () => ({ right: e.clientX + 220, bottom: e.clientY, top: e.clientY }) };
  showMenu(fake, menuItems(t));
});

$('#selectAll').addEventListener('change', (e) => {
  const list = visibleTasks();
  if (e.target.checked) list.forEach((t) => ui.selected.add(t.id)); else ui.selected.clear();
  render();
});
$('#bulkBtn').addEventListener('click', (e) => {
  const ids = ui.selected.size ? [...ui.selected] : [];
  const items = [];
  if (!ids.length) items.push(['info', 'Select downloads first', () => {}]);
  else {
    items.push(['pause', `Pause ${ids.length} selected`, () => ids.forEach((id) => engine.pause(id))]);
    items.push(['play', `Resume ${ids.length} selected`, () => ids.forEach((id) => engine.resume(id))]);
    items.push(['save', 'Save finished files', () => ids.map((id) => engine.get(id)).filter((t) => t?.status === 'completed').forEach((t, i) => setTimeout(() => saveTask(t), i * 400))]);
    items.push('-');
    items.push(['trash', `Delete ${ids.length} selected`, () => confirmDelete(ids), 'danger']);
  }
  items.push('-');
  items.push(['pause', 'Pause all', () => engine.list().forEach((t) => engine.pause(t.id))]);
  items.push(['play', 'Resume all', () => engine.list().forEach((t) => (t.status === 'paused' || t.status === 'error') && engine.resume(t.id))]);
  showMenu(e.currentTarget, items);
});

// toolbar
const filterSel = $('#filterSel');
filterSel.innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
filterSel.value = settings.filter;
$('#sortSel').value = settings.sort;
filterSel.addEventListener('change', () => { settings.filter = filterSel.value; saveSettings(settings); render(); });
$('#sortSel').addEventListener('change', (e) => { settings.sort = e.target.value; saveSettings(settings); render(); });
$('#searchInput').addEventListener('input', (e) => { ui.search = e.target.value; render(); });

// ---------- details pane ----------
function openDetails(id) { ui.focused = id; $('#details').hidden = false; render(); }
function closeDetails() { ui.focused = null; $('#details').hidden = true; render(); }
$('#closeDetails').addEventListener('click', closeDetails);
$$('.details-tabs .tab').forEach((b) => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  $$('.details-tabs .tab').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
  ui._detailsKey = null;
  renderDetails();
}));

function renderDetails() {
  const t = engine.get(ui.focused);
  if (!t) return closeDetails();
  const body = $('#detailsBody');
  // Rebuild structure only when the task, tab, or status changes; otherwise patch numbers.
  const key = `${t.id}|${ui.tab}|${t.status}|${t.name}|${t.error}|${t.notice}|${t.useProxy}`;
  if (ui._detailsKey !== key) {
    ui._detailsKey = key;
    body.innerHTML = ui.tab === 'general' ? generalHtml(t) : progressHtml(t);
    bindDetailActions(t);
    if (ui.tab === 'general' && t.status === 'completed' && (t.category === 'image' || t.category === 'gif')) attachPreview(t);
  }
  if (ui.tab === 'progress') {
    const p = pct(t);
    const set = (sel, v) => { const el = $(sel, body); if (el) el.textContent = v; };
    const bar = $('.prog-big .rail i', body);
    if (bar) bar.style.width = `${t.status === 'completed' ? 100 : p ?? 0}%`;
    set('[data-v=pct]', p != null ? `${p.toFixed(1)}%` : '\u2014');
    set('[data-v=rec]', formatBytes(t.received));
    set('[data-v=tot]', t.size ? formatBytes(t.size) : 'Unknown');
    set('[data-v=spd]', t.status === 'downloading' ? formatSpeed(t.speed) : '\u2014');
    set('[data-v=eta]', t.status === 'downloading' && t.size && t.speed ? formatEta((t.size - t.received) / t.speed) : '\u2014');
  } else {
    const d = $('[data-v=downloaded]', body);
    if (d) d.textContent = t.status === 'completed' ? formatBytes(t.size) : `${formatBytes(t.received)}${t.size ? ` of ${formatBytes(t.size)}` : ''}`;
  }
}

function detailNotice(t) {
  const out = [];
  if (t.error) out.push(noticeHtml({ level: t.status === 'blocked' ? 'block' : 'warn', text: t.error }));
  if (t.notice) out.push(noticeHtml({ level: 'info', text: t.notice }));
  if (t.status === 'waiting') out.push(noticeHtml({ level: 'warn', text: 'No internet connection. This download continues by itself when you\u2019re back online.' }));
  if (t.status === 'paused' && t.pauseReason === 'reload') out.push(noticeHtml({ level: 'info', text: t.resumable === false ? 'Paused when the page was closed. This server can\u2019t resume, so it will start again from the beginning.' : 'Paused when the page was closed. Resume to continue from where it stopped.' }));
  return out.length ? `<div class="notices d-notice">${out.join('')}</div>` : '';
}

function generalHtml(t) {
  const actions = [];
  const btn = (act, label, icon, cls = '') => `<button class="btn small ${cls}" data-act="${act}">${svg(UI_ICON[icon])}${esc(label)}</button>`;
  if (['downloading', 'connecting', 'queued', 'waiting'].includes(t.status)) actions.push(btn('pause', 'Pause', 'pause'));
  if (['paused', 'error'].includes(t.status)) actions.push(btn('resume', t.status === 'error' ? 'Try again' : 'Resume', 'play', 'primary'));
  if (t.status === 'blocked') {
    if (settings.proxyUrl && !t.useProxy) actions.push(btn('proxy', 'Retry through proxy', 'shield', 'primary'));
    actions.push(btn('openlink', 'Open link in browser', 'open'));
  }
  if (t.status === 'completed') {
    actions.push(btn('save', 'Save file', 'save', 'primary'));
    if (['video', 'image', 'gif', 'pdf', 'music'].includes(t.category)) actions.push(btn('open', 'Open', 'open'));
    if (t.category === 'video' || t.category === 'music') actions.push(btn('convert', 'Convert to audio', 'audio'));
  }
  actions.push(btn('delete', 'Delete', 'trash', 'ghost'));
  return `
    <div class="big-icon ft-${t.category}">${svg(ICON[t.category] || ICON.other)}</div>
    <div class="d-main">
      <h3 class="d-title">${esc(t.name)}</h3>
      <div class="d-meta">
        <span>Downloaded: <b data-v="downloaded"></b></span>
        <span>Added: <b>${esc(formatFullDate(t.addedAt))}</b></span>
        ${t.platform ? `<span>From: <b>${esc(t.platform)}</b></span>` : ''}
        ${t.useProxy ? '<span>Via: <b>CORS proxy</b></span>' : ''}
      </div>
      ${t.sourceUrl && t.sourceUrl !== t.url ? `<p class="d-line">Web page: <a href="${esc(t.sourceUrl)}" target="_blank" rel="noopener">${esc(t.sourceUrl)}</a></p>` : ''}
      ${t.url ? `<p class="d-line">File: <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.url.length > 160 ? t.url.slice(0, 160) + '\u2026' : t.url)}</a></p>` : '<p class="d-line">Made in this browser from another download.</p>'}
      ${detailNotice(t)}
      <div class="d-actions">${actions.join('')}</div>
    </div>`;
}

function progressHtml(t) {
  const s = statusView(t);
  return `
    <div class="prog-big">
      <div class="status ${s.cls}"><div class="lbl"><span>${esc(s.label)}</span></div></div>
      <div class="rail ${s.cls}"><i></i></div>
      <div class="prog-grid">
        <div><span>Progress</span><b data-v="pct"></b></div>
        <div><span>Received</span><b data-v="rec"></b></div>
        <div><span>Total size</span><b data-v="tot"></b></div>
        <div><span>Speed</span><b data-v="spd"></b></div>
        <div><span>Time left</span><b data-v="eta"></b></div>
        <div><span>Can resume</span><b>${t.resumable === true ? 'Yes' : t.resumable === false ? 'No \u2014 restarts' : 'Unknown yet'}</b></div>
      </div>
      ${detailNotice(t)}
    </div>`;
}

function bindDetailActions(t) {
  $$('#detailsBody [data-act]').forEach((b) => b.addEventListener('click', () => {
    ({
      pause: () => engine.pause(t.id),
      resume: () => engine.resume(t.id),
      proxy: () => engine.retryWithProxy(t.id),
      openlink: () => window.open(t.url, '_blank', 'noopener'),
      save: () => saveTask(t),
      open: () => openTask(t),
      convert: () => openConvert(t.id),
      delete: () => confirmDelete([t.id]),
    })[b.dataset.act]?.();
  }));
}

async function attachPreview(t) {
  const blob = await engine.file(t.id);
  if (ui.focused !== t.id || !blob.size) return;
  const img = document.createElement('img');
  img.className = 'preview';
  img.alt = '';
  img.src = URL.createObjectURL(blob);
  img.onload = () => setTimeout(() => URL.revokeObjectURL(img.src), 1000);
  $('#detailsBody').appendChild(img);
}

// ---------- add dialog ----------
const addDlg = $('#addDialog');
const urlInput = $('#urlInput');
const analysisEl = $('#analysis');
const goBtn = $('#addGo');
let current = null;      // the analysis result the Download button acts on
let analyzeSeq = 0;

function noticeHtml(n) {
  const icon = n.level === 'block' ? UI_ICON.block : n.level === 'warn' ? UI_ICON.warn : UI_ICON.info;
  const act = n.action === 'settings' ? '<button type="button" class="btn small" data-open-settings>Open settings</button>' : '';
  return `<div class="notice ${n.level}">${svg(icon)}<div><p>${esc(n.text)}</p>${act}</div></div>`;
}
const noticesHtml = (list) => (list.length ? `<div class="notices">${list.map(noticeHtml).join('')}</div>` : '');

function openAdd(prefill = '') {
  hideMenu();
  if (!addDlg.open) addDlg.showModal();
  urlInput.value = prefill;
  analysisEl.innerHTML = '';
  current = null; goBtn.disabled = true; goBtn.textContent = 'Download';
  if (prefill) runAnalyze(); else urlInput.focus();
}
$('#addBtn').addEventListener('click', () => openAdd());
$('#emptyAdd').addEventListener('click', () => openAdd());
$('#addCancel').addEventListener('click', () => addDlg.close());
$('#pasteBtn').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) { urlInput.value = text; runAnalyze(); }
  } catch { urlInput.focus(); toast('Press Ctrl+V to paste the link.'); }
});
let typingTimer;
urlInput.addEventListener('input', () => { clearTimeout(typingTimer); typingTimer = setTimeout(runAnalyze, 450); });
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!goBtn.disabled) goBtn.click(); else runAnalyze(); } });
analysisEl.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) { addDlg.close(); openSettings(); } });

function loadingHtml(text) { return `<div class="loading-line"><span class="spinner"></span>${esc(text)}</div>`; }

async function runAnalyze() {
  const url = urlInput.value.trim();
  const seq = ++analyzeSeq;
  current = null; goBtn.disabled = true; goBtn.textContent = 'Download';
  if (!url) { analysisEl.innerHTML = ''; return; }
  if (!isHttpUrl(url)) {
    analysisEl.innerHTML = noticeHtml({ level: 'warn', text: 'That doesn\u2019t look like a web link. It should start with https://' });
    return;
  }
  analysisEl.innerHTML = loadingHtml('Checking the link\u2026');
  let res;
  try { res = await analyze(url, settings); }
  catch (err) { if (seq === analyzeSeq) analysisEl.innerHTML = noticeHtml({ level: 'block', text: err.message }); return; }
  if (seq !== analyzeSeq) return;

  if (res.type === 'platform') return showPlatform(url, res.platform);
  const p = res.probe;
  if (p.ok && p.isPage) return showPage(url, p);
  if (p.ok) return showDirect(url, p);
  return showProbeFailure(url, p);
}

function showPlatform(url, platform) {
  if (platform.via === 'none') {
    analysisEl.innerHTML = `<div class="source-line"><span class="chip">${esc(platform.name)}</span></div>${noticesHtml(platform.notices)}`;
    return;
  }
  const isScrape = platform.via === 'scrape';
  const needs = isScrape ? (!settings.proxyUrl && { level: 'block', text: `${platform.name} needs the CORS proxy. Add it in Settings (free Cloudflare Worker, see README).`, action: 'settings' })
    : (!settings.extractorUrl && { level: 'block', text: `${platform.name} links need an extractor server, because GitHub Pages can\u2019t talk to ${platform.name} by itself. Add your extractor URL in Settings (see README).`, action: 'settings' });

  const q = settings.videoQuality;
  const qOpts = ['max', '2160', '1440', '1080', '720', '480', '360', '240'].map((v) => `<option value="${v}"${v === q ? ' selected' : ''}>${v === 'max' ? 'Best available' : v + 'p'}</option>`).join('');
  const aOpts = [['mp3', 'MP3'], ['best', 'Original'], ['ogg', 'OGG'], ['opus', 'Opus'], ['wav', 'WAV']].map(([v, l]) => `<option value="${v}"${v === settings.audioFormat ? ' selected' : ''}>${l}</option>`).join('');
  const bOpts = ['320', '256', '128', '96'].map((v) => `<option value="${v}"${v === settings.audioBitrate ? ' selected' : ''}>${v} kbps</option>`).join('');

  analysisEl.innerHTML = `
    <div class="source-line"><span class="chip accent">${esc(platform.name)}</span><span class="muted">${isScrape ? 'Public post scan' : 'Social media link'}</span></div>
    ${noticesHtml([...(needs ? [needs] : []), ...platform.notices])}
    ${isScrape ? '' : `
    <div class="seg" role="radiogroup" aria-label="What to download">
      <label><input type="radio" name="mode" value="auto" checked><span>${svg(UI_ICON.video)}Video</span></label>
      <label><input type="radio" name="mode" value="audio"><span>${svg(UI_ICON.audio)}Audio only</span></label>
      <label><input type="radio" name="mode" value="mute"><span>${svg(UI_ICON.mute)}No sound</span></label>
    </div>
    <div class="field-row">
      <label class="field" data-for="video"><span class="field-label">Video quality</span><select id="optQuality">${qOpts}</select></label>
      <label class="field" data-for="audio" hidden><span class="field-label">Audio format</span><select id="optAudio">${aOpts}</select></label>
      <label class="field" data-for="audio" hidden><span class="field-label">Bitrate</span><select id="optBitrate">${bOpts}</select></label>
    </div>`}`;

  $$('input[name=mode]', analysisEl).forEach((r) => r.addEventListener('change', () => {
    const mode = $('input[name=mode]:checked', analysisEl).value;
    $$('[data-for=video]', analysisEl).forEach((el) => (el.hidden = mode === 'audio'));
    $$('[data-for=audio]', analysisEl).forEach((el) => (el.hidden = mode !== 'audio'));
  }));

  current = { kind: isScrape ? 'scrape' : 'platform', url, platform };
  goBtn.disabled = !!needs;
  goBtn.textContent = isScrape ? 'Find media' : 'Download';
}

function showDirect(url, p) {
  const isVideo = p.category === 'video';
  analysisEl.innerHTML = `
    <div class="source-line"><span class="chip">Direct file</span>${p.viaProxy ? '<span class="chip">Through proxy</span>' : ''}</div>
    <div class="file-card">
      <span class="ftype ft-${p.category}">${svg(ICON[p.category] || ICON.other)}</span>
      <div class="fc-main">
        <input type="text" id="nameInput" value="${esc(p.name)}" aria-label="File name">
        <div class="fc-meta"><span>${p.size ? formatBytes(p.size) : 'Size unknown'}</span><span>${esc(p.mime || 'unknown type')}</span><span>${p.resumable ? 'Pause and resume supported' : 'No resume \u2014 pausing restarts it'}</span></div>
      </div>
    </div>
    ${isVideo ? `
    <label class="inline-check"><input type="checkbox" id="alsoAudio"> Convert to audio when finished</label>
    <div class="field-row" id="alsoAudioOpts" hidden>
      <label class="field"><span class="field-label">Format</span><select id="aaFormat">${Object.entries(AUDIO_FORMATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Quality</span><select id="aaBitrate"><option value="320">320 kbps</option><option value="192" selected>192 kbps</option><option value="128">128 kbps</option></select></label>
    </div>` : ''}
    ${p.resumable ? '' : noticesHtml([{ level: 'info', text: 'This server doesn\u2019t support resuming. If the connection drops, this file starts again from the beginning.' }])}
    ${noticesHtml([copyrightNotice])}`;
  $('#alsoAudio', analysisEl)?.addEventListener('change', (e) => ($('#alsoAudioOpts').hidden = !e.target.checked));
  current = { kind: 'direct', url, probe: p };
  goBtn.disabled = false;
}

function showPage(url, p) {
  analysisEl.innerHTML = `
    <div class="source-line"><span class="chip">Web page</span>${p.viaProxy ? '<span class="chip">Through proxy</span>' : ''}</div>
    ${noticesHtml([{ level: 'info', text: 'This link opens a web page, not a file. WebGet can scan the page for videos, images and documents.' },
      ...(!settings.proxyUrl ? [{ level: 'block', text: 'Scanning pages needs the CORS proxy. Add it in Settings.', action: 'settings' }] : [])])}`;
  current = { kind: 'scrape', url };
  goBtn.disabled = !settings.proxyUrl;
  goBtn.textContent = 'Find media';
}

function showProbeFailure(url, p) {
  const list = [];
  let canTry = false;
  if (p.reason === 'cors') {
    list.push({ level: 'block', text: 'This site doesn\u2019t allow other websites to download its files (CORS restriction).' });
    if (!settings.proxyUrl) list.push({ level: 'info', text: 'Add a CORS proxy in Settings to download it here, or open the link and let your browser download it.', action: 'settings' });
    else list.push({ level: 'warn', text: 'Your proxy couldn\u2019t reach it either. Open the link in the browser instead.' });
  } else if (p.reason === 'http') {
    const s = p.status;
    list.push({ level: 'block', text: s === 403 || s === 401 ? `Access denied (HTTP ${s}). The site requires a login, or the link expired.` : s === 404 ? 'File not found (HTTP 404). Check the link.' : `The server answered HTTP ${s}.` });
    canTry = s >= 500;
  } else {
    list.push({ level: 'warn', text: 'The server didn\u2019t answer in time. You can still add it; it will retry automatically.' });
    canTry = true;
  }
  analysisEl.innerHTML = `${noticesHtml(list)}
    <div class="d-actions"><a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">${svg(UI_ICON.open)}Open link in browser</a></div>`;
  if (canTry) { current = { kind: 'direct', url, probe: { name: url.split('/').pop() || 'download', category: categoryOf(url) } }; goBtn.disabled = false; }
}

function showPicker(items, { url, platform, title, viaProxyItems }) {
  if (!items.length) {
    analysisEl.innerHTML = noticesHtml([{ level: 'block', text: 'No downloadable media was found. The post may be private, need a login, or load its media with scripts that can\u2019t be read here.' }]);
    goBtn.disabled = true;
    return;
  }
  analysisEl.innerHTML = `
    <div class="source-line"><span class="chip accent">${esc(platform?.name || 'Page')}</span><span class="muted">${items.length} item${items.length > 1 ? 's' : ''} found${title ? ` in \u201c${esc(title.slice(0, 60))}\u201d` : ''}</span></div>
    <div class="picker">${items.map((it, i) => {
      const thumb = it.thumb ? `<img src="${esc(viaProxyItems ? proxify(settings.proxyUrl, it.thumb) : it.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : svg(ICON[it.category] || ICON.other);
      return `<label class="pick-item"><input type="checkbox" data-i="${i}" ${i === 0 || items.length <= 4 ? 'checked' : ''}><div class="thumb">${thumb}</div><div class="cap" title="${esc(it.name)}">${esc(it.name)}</div></label>`;
    }).join('')}</div>`;
  current = { kind: 'picked', url, platform, items, viaProxyItems };
  goBtn.disabled = false;
  goBtn.textContent = 'Download selected';
}

goBtn.addEventListener('click', async () => {
  if (!current) return;
  const c = current;

  if (c.kind === 'direct') {
    const p = c.probe;
    const name = $('#nameInput', analysisEl)?.value.trim() || p.name;
    const also = $('#alsoAudio', analysisEl)?.checked;
    engine.add({
      url: c.url, name, nameLocked: name !== p.name, mime: p.mime, size: p.size, resumable: p.resumable, useProxy: !!p.viaProxy,
      postConvert: also ? { format: $('#aaFormat').value, bitrate: $('#aaBitrate').value } : null,
    });
    return finishAdd(1);
  }

  if (c.kind === 'platform') {
    const mode = $('input[name=mode]:checked', analysisEl)?.value || 'auto';
    goBtn.disabled = true;
    analysisEl.insertAdjacentHTML('beforeend', `<div id="extracting">${loadingHtml(`Asking the extractor for the ${mode === 'audio' ? 'audio' : 'video'}\u2026`)}</div>`);
    try {
      const r = await extract(c.url, {
        mode, quality: $('#optQuality')?.value, audioFormat: $('#optAudio')?.value, audioBitrate: $('#optBitrate')?.value,
      }, settings);
      if (r.kind === 'single') {
        const it = r.items[0];
        engine.add({ url: it.url, name: it.name, sourceUrl: c.url, platform: c.platform.name, nameLocked: true });
        return finishAdd(1);
      }
      return showPicker(r.items, { url: c.url, platform: c.platform });
    } catch (err) {
      $('#extracting')?.remove();
      const n = err instanceof ExtractError ? err.notice : { level: 'block', text: err.message };
      analysisEl.insertAdjacentHTML('beforeend', noticeHtml(n));
      goBtn.disabled = false;
    }
    return;
  }

  if (c.kind === 'scrape') {
    goBtn.disabled = true;
    analysisEl.insertAdjacentHTML('beforeend', `<div id="extracting">${loadingHtml('Reading the page\u2026')}</div>`);
    try {
      const r = await scanPage(c.url, settings);
      return showPicker(r.items, { url: c.url, platform: c.platform, title: r.title, viaProxyItems: true });
    } catch (err) {
      $('#extracting')?.remove();
      analysisEl.insertAdjacentHTML('beforeend', noticeHtml(err instanceof ExtractError ? err.notice : { level: 'block', text: err.message }));
      goBtn.disabled = false;
    }
    return;
  }

  if (c.kind === 'picked') {
    const chosen = $$('.picker input:checked', analysisEl).map((i) => c.items[Number(i.dataset.i)]);
    if (!chosen.length) return toast('Select at least one item.');
    chosen.forEach((it) => engine.add({
      url: it.url, name: it.name, sourceUrl: c.url, platform: c.platform?.name || '', useProxy: !!c.viaProxyItems, nameLocked: false,
    }));
    return finishAdd(chosen.length);
  }
});

function finishAdd(n) {
  addDlg.close();
  toast(n > 1 ? `Added ${n} downloads.` : 'Download added.');
  store.requestPersistence();
}

// paste anywhere / drop / ?url=
document.addEventListener('paste', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const text = (e.clipboardData?.getData('text') || '').trim();
  if (isHttpUrl(text)) { e.preventDefault(); openAdd(text); }
});
const wrap = $('#listWrap');
wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dragging'); });
wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('dragging'); });
wrap.addEventListener('drop', (e) => {
  e.preventDefault(); wrap.classList.remove('dragging');
  const file = e.dataTransfer.files?.[0];
  if (file) { openConvert(null, file); return; }
  const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text') || '').split('\n')[0].trim();
  if (isHttpUrl(text)) openAdd(text);
});

// ---------- convert dialog ----------
const convDlg = $('#convertDialog');
let convFile = null;
$('#convFormat').innerHTML = Object.entries(AUDIO_FORMATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

function openConvert(taskId = null, file = null) {
  hideMenu();
  convFile = file;
  const vids = engine.list().filter((t) => t.status === 'completed' && (t.category === 'video' || t.category === 'music'))
    .sort((a, b) => b.addedAt - a.addedAt);
  const src = $('#convSource');
  const opts = [];
  if (file) opts.push(`<label class="conv-opt"><input type="radio" name="convSrc" value="__file" checked><span>${esc(file.name)}</span><small>${formatBytes(file.size)}</small></label>`);
  vids.forEach((t, i) => opts.push(`<label class="conv-opt"><input type="radio" name="convSrc" value="${t.id}" ${(!file && (t.id === taskId || (!taskId && i === 0))) ? 'checked' : ''}><span>${esc(t.name)}</span><small>${formatBytes(t.size)}</small></label>`));
  src.innerHTML = opts.length ? opts.join('') : '<p class="hint">No finished videos yet. Choose a file from this device instead.</p>';
  $('#convStatus').innerHTML = '';
  $('#convGo').disabled = !opts.length;
  if (!convDlg.open) convDlg.showModal();
}
$('#convertBtn').addEventListener('click', () => openConvert());
$('#convFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openConvert(null, f); e.target.value = ''; });
$('#convSource').addEventListener('change', () => ($('#convGo').disabled = false));

$('#convGo').addEventListener('click', async () => {
  const sel = $('input[name=convSrc]:checked', convDlg)?.value;
  if (!sel) return;
  const format = $('#convFormat').value, bitrate = $('#convBitrate').value;
  const status = $('#convStatus');
  const bar = () => `<div class="rail"><i style="width:0%"></i></div>`;
  $('#convGo').disabled = true;

  if (sel !== '__file') {
    const t = engine.get(sel);
    convDlg.close();
    toast(`Converting ${t.name}\u2026 Progress shows in the list.`);
    convertTask(t, format, bitrate);
    return;
  }
  // local file
  const file = convFile;
  try {
    if (file.size > MAX_INPUT) throw new Error('This file is over 1.8 GB, too large for the in-browser converter.');
    status.innerHTML = `<p class="hint" id="convMsg">${isLoaded() ? 'Starting\u2026' : 'Loading the converter (first time only, about 31 MB)\u2026'}</p>${bar()}`;
    const setBar = (p) => { const i = $('.rail i', status); if (i) i.style.width = `${Math.round(p * 100)}%`; };
    await loadFFmpeg((p) => setBar(p * 0.2), settings.ffmpegCoreBase);
    $('#convMsg').textContent = 'Converting\u2026 keep this tab open.';
    const out = await toAudio(file, file.name, format, bitrate, (p) => setBar(0.2 + p * 0.8));
    const nt = await engine.addFile({ name: audioName(file.name, format), blob: out, sourceUrl: '' });
    if (settings.autoSave) { nt.autoSaved = true; saveTask(nt); }
    status.innerHTML = noticeHtml({ level: 'info', text: `Done: ${nt.name} (${formatBytes(out.size)}). It\u2019s in your list${settings.autoSave ? ' and was saved to your Downloads folder' : ''}.` });
    renderStorage();
  } catch (err) {
    status.innerHTML = noticeHtml({ level: 'block', text: err.message });
  } finally { $('#convGo').disabled = false; }
});

// ---------- settings ----------
const setDlg = $('#settingsDialog');
const setForm = $('#settingsForm');
function openSettings() {
  for (const el of setForm.elements) {
    if (!el.name || !(el.name in settings)) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else el.value = settings[el.name];
  }
  $('#testExtractorOut').textContent = ''; $('#testProxyOut').textContent = '';
  const base = location.href.split(/[?#]/)[0];
  $('#bookmarklet').href = `javascript:void(window.open('${base}?url='+encodeURIComponent(location.href)))`;
  store.storageEstimate().then((e) => {
    if (e) $('#storageInfo').textContent = `Finished and partial downloads use ${formatBytes(e.usage || 0)} in this browser (space available: ${formatBytes(e.quota || 0)}). They stay until you delete them.`;
  });
  setDlg.showModal();
}
function readSettingsForm() {
  const s = {};
  for (const el of setForm.elements) {
    if (!el.name || !(el.name in settings)) continue;
    s[el.name] = el.type === 'checkbox' ? el.checked : el.name === 'maxConcurrent' ? Number(el.value) : el.value.trim();
  }
  return s;
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#saveSettings').addEventListener('click', () => {
  Object.assign(settings, readSettingsForm());
  saveSettings(settings);
  applyTheme();
  engine._schedule();
  setDlg.close();
  toast('Settings saved.');
  render();
});
$('#bookmarklet').addEventListener('click', (e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar.'); });
$('#testExtractor').addEventListener('click', async () => {
  const out = $('#testExtractorOut');
  const s = { ...settings, ...readSettingsForm() };
  out.className = 'test-out'; out.textContent = 'Testing\u2026';
  try {
    const info = await extractorInfo(s);
    out.className = 'test-out ok';
    out.textContent = `Connected${info.version ? ` (version ${info.version})` : ''}. ${info.services?.length ? `${info.services.length} services.` : ''}`;
  } catch (err) {
    out.className = 'test-out bad';
    out.textContent = `Not reachable: ${err.message}. Check the URL and that it allows CORS.`;
  }
});
$('#testProxy').addEventListener('click', async () => {
  const out = $('#testProxyOut');
  const s = { ...settings, ...readSettingsForm() };
  out.className = 'test-out'; out.textContent = 'Testing\u2026';
  if (!s.proxyUrl) { out.className = 'test-out bad'; out.textContent = 'Enter a proxy URL first.'; return; }
  const r = await probe('https://example.com/', { proxyUrl: s.proxyUrl, useProxy: true });
  out.className = `test-out ${r.ok ? 'ok' : 'bad'}`;
  out.textContent = r.ok ? 'Proxy works.' : `Proxy failed (${r.reason}${r.status ? ' ' + r.status : ''}).`;
});
$('#clearAll').addEventListener('click', async () => {
  if (!confirm('Delete every download stored in this browser? Files already saved to your computer are not affected.')) return;
  for (const t of engine.list()) await engine.remove(t.id);
  await store.clearAllChunks();
  renderStorage();
  setDlg.close();
  toast('All downloads deleted.');
});

// ---------- startup ----------
applyTheme();
renderNetwork();
render();
renderStorage();
setInterval(() => { if (engine.list().some((t) => t.status === 'completed')) render(); }, 60_000);
setInterval(() => { if (engine.list().some((t) => t.status === 'downloading')) renderStorage(); }, 5000); // keeps "Today/Yesterday" fresh

window.addEventListener('beforeunload', (e) => {
  if (engine.list().some((t) => ['downloading', 'connecting', 'converting'].includes(t.status))) {
    e.preventDefault(); e.returnValue = '';
  }
});

const qs = new URLSearchParams(location.search);
if (qs.get('url') && isHttpUrl(qs.get('url'))) {
  const u = qs.get('url');
  history.replaceState(null, '', location.pathname);
  openAdd(u);
}

// expose for debugging in the console
window.webget = { engine, settings };
