// Download engine.
// Each download streams with fetch() + Range requests. Bytes are flushed to IndexedDB every ~4 MB,
// so pausing (by you, by a lost connection, or by closing the tab) keeps what was already received.
//
// Status values:
//   queued | connecting | downloading | paused | waiting (no network) | blocked (CORS) |
//   error | completed | converting

import * as store from './store.js';
import { categoryOf, ensureExt, nameFromDisposition, proxify, sanitizeName, sleep, uid } from './utils.js';

const FLUSH_BYTES = 2 * 1024 * 1024;
const STALL_MS = 25_000;      // no bytes for this long -> treat as a network drop
const MAX_RETRIES = 6;
const ACTIVE = new Set(['connecting', 'downloading']);

class HttpError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }

export class Engine extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.tasks = new Map();
    this.ctrl = new Map();          // id -> AbortController for running downloads
    this.busy = new Map();          // id -> promise that settles when the previous run fully stopped
    this.online = navigator.onLine;
    this._persistTimer = null;
    this._checking = false;

    for (const t of store.loadTasks()) {
      // Anything that was mid-download when the page closed comes back paused.
      if (t.status === 'converting') t.status = 'completed';
      if (ACTIVE.has(t.status) || t.status === 'queued') {
        t.status = 'paused'; t.pauseReason = 'reload';
      }
      if (t.status === 'waiting') t.pauseReason = 'network';
      t.speed = 0;
      this.tasks.set(t.id, t);
    }

    // IndexedDB is the source of truth for how many bytes we really have
    // (bytes still in memory when the tab closed are lost).
    this.ready = Promise.all(this.list().filter((t) => t.status !== 'completed' && t.url).map(async (t) => {
      try {
        const { count, bytes } = await store.storedBytes(t.id);
        t.received = bytes; t.chunkCount = count;
      } catch { t.received = 0; t.chunkCount = 0; }
      this._changed(t, false);
    })).then(() => this._persist());

    window.addEventListener('offline', () => this._goOffline());
    window.addEventListener('online', () => this._checkNetwork());
    setInterval(() => this._tick(), 1000);
    setInterval(() => { if (!this.online || this._hasWaiting()) this._checkNetwork(); }, 5000);
  }

  // ---------- public API ----------
  list() { return [...this.tasks.values()]; }
  get(id) { return this.tasks.get(id); }

  add({ url, name, mime = '', size = null, sourceUrl = '', platform = '', useProxy = false, postConvert = null, resumable = null, nameLocked = false }) {
    const n = sanitizeName(name);
    const t = {
      id: uid(), url, sourceUrl: sourceUrl || url, name: n, nameLocked, mime, size, platform, useProxy, postConvert,
      category: categoryOf(n, mime), received: 0, chunkCount: 0, resumable,
      status: 'queued', pauseReason: '', error: '', notice: '', retries: 0,
      addedAt: Date.now(), completedAt: null, speed: 0, autoSaved: false,
    };
    this.tasks.set(t.id, t);
    this._changed(t);
    this._schedule();
    return t;
  }

  async addFile({ name, blob, sourceUrl = '', fromId = '', platform = '' }) {
    const t = {
      id: uid(), url: '', sourceUrl, fromId, platform, name: sanitizeName(name), mime: blob.type, size: blob.size,
      category: categoryOf(name, blob.type), received: blob.size, chunkCount: 1, resumable: true,
      status: 'completed', pauseReason: '', error: '', notice: '', retries: 0,
      addedAt: Date.now(), completedAt: Date.now(), speed: 0, autoSaved: false,
    };
    await store.putChunk(t.id, 0, blob);
    this.tasks.set(t.id, t);
    this._changed(t);
    return t;
  }

  pause(id, reason = 'user') {
    const t = this.tasks.get(id);
    if (!t) return;
    if (ACTIVE.has(t.status) || t.status === 'queued' || t.status === 'waiting' || t.status === 'error' || t.status === 'blocked') {
      t.status = reason === 'network' ? 'waiting' : 'paused';
      t.pauseReason = reason;
      t.speed = 0;
      this.ctrl.get(id)?.abort();
      this._changed(t);
      this._schedule();
    }
  }

  resume(id) {
    const t = this.tasks.get(id);
    if (!t || t.status === 'completed' || ACTIVE.has(t.status) || t.status === 'converting') return;
    t.status = 'queued'; t.pauseReason = ''; t.error = ''; t.retries = 0;
    this._changed(t);
    this._schedule();
  }

  async restart(id) {
    const t = this.tasks.get(id);
    if (!t || !t.url) return;
    this.ctrl.get(id)?.abort();
    await store.deleteChunks(id);
    Object.assign(t, { received: 0, chunkCount: 0, status: 'queued', error: '', notice: '', pauseReason: '', retries: 0, completedAt: null, autoSaved: false });
    this._changed(t);
    this._schedule();
  }

  retryWithProxy(id) {
    const t = this.tasks.get(id);
    if (!t || !this.settings.proxyUrl) return;
    t.useProxy = true;
    this.restart(id);
  }

  async remove(id) {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = 'removed';
    this.ctrl.get(id)?.abort();
    this.tasks.delete(id);
    await store.deleteChunks(id).catch(() => {});
    this.dispatchEvent(new CustomEvent('removed', { detail: t }));
    this._persist();
    this._schedule();
  }

  setStatus(id, status, extra = {}) {
    const t = this.tasks.get(id);
    if (!t) return;
    Object.assign(t, { status }, extra);
    this._changed(t);
  }

  file(id) { const t = this.tasks.get(id); return t ? store.getFile(t) : null; }

  totalSpeed() { let s = 0; for (const t of this.tasks.values()) if (t.status === 'downloading') s += t.speed || 0; return s; }

  // ---------- scheduling ----------
  _running() { let n = 0; for (const t of this.tasks.values()) if (ACTIVE.has(t.status)) n++; return n; }
  _hasWaiting() { for (const t of this.tasks.values()) if (t.status === 'waiting') return true; return false; }

  _schedule() {
    if (!this.online) {
      for (const t of this.tasks.values()) if (t.status === 'queued') { t.status = 'waiting'; t.pauseReason = 'network'; this._changed(t); }
      return;
    }
    const max = Math.max(1, Number(this.settings.maxConcurrent) || 3);
    const queued = this.list().filter((t) => t.status === 'queued').sort((a, b) => a.addedAt - b.addedAt);
    let free = max - this._running();
    for (const t of queued) { if (free-- <= 0) break; this._run(t); }
  }

  async _run(t) {
    const ctrl = new AbortController();
    this.ctrl.set(t.id, ctrl);
    t.status = 'connecting';
    const prev = this.busy.get(t.id);
    let release;
    this.busy.set(t.id, new Promise((r) => (release = r)));
    await this.ready;
    await prev; // never let two runs write the same file at once
    if (ctrl.signal.aborted || t.status !== 'connecting') { this.ctrl.delete(t.id); release(); return; }
    t.status = 'connecting'; t.error = ''; t.speed = 0;
    t._lastByteAt = Date.now(); t._window = [];
    this._changed(t);

    let pending = [], pendingBytes = 0;
    const flush = async () => {
      if (!pendingBytes) return;
      const blob = new Blob(pending);
      pending = []; pendingBytes = 0;
      await store.putChunk(t.id, t.chunkCount, blob);
      t.chunkCount++;
    };

    try {
      const url = t.useProxy ? proxify(this.settings.proxyUrl, t.url) : t.url;
      const res = await fetch(url, { headers: { Range: `bytes=${t.received}-` }, signal: ctrl.signal, cache: 'no-store' });

      if (res.status === 416 && t.size && t.received >= t.size) return this._finish(t);
      if (!res.ok) throw new HttpError(res.status);

      if (res.status === 206) {
        t.resumable = true;
        const cr = res.headers.get('content-range');
        const total = cr && /\/(\d+)$/.test(cr) ? Number(cr.match(/\/(\d+)$/)[1]) : null;
        const len = Number(res.headers.get('content-length')) || 0;
        t.size = total || (len ? t.received + len : t.size);
      } else {
        // Server sent the whole file: start over from byte 0.
        if (t.received > 0) {
          await store.deleteChunks(t.id);
          t.received = 0; t.chunkCount = 0;
          t.notice = 'This server doesn\u2019t support resuming, so the download restarted from the beginning.';
        }
        t.resumable = false;
        const len = Number(res.headers.get('content-length')) || Number(res.headers.get('estimated-content-length')) || 0;
        t.size = len || null;
      }
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (mime && mime !== 'application/octet-stream') t.mime = mime;
      const dispName = nameFromDisposition(res.headers.get('content-disposition'));
      if (dispName && t.received === 0 && !t.nameLocked) t.name = dispName;
      t.name = ensureExt(t.name, t.mime);
      t.category = categoryOf(t.name, t.mime);

      t.status = 'downloading';
      this._changed(t);

      const reader = res.body.getReader();
      // Stall watchdog: some network drops never raise an error, the stream just stops.
      const watchdog = setInterval(() => {
        if (Date.now() - t._lastByteAt > STALL_MS) ctrl.abort(new DOMException('stalled', 'StallError'));
      }, 2000);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending.push(value);
          pendingBytes += value.byteLength;
          t.received += value.byteLength;
          t._bytesThisSecond = (t._bytesThisSecond || 0) + value.byteLength;
          t._lastByteAt = Date.now();
          if (pendingBytes >= FLUSH_BYTES) await flush();
        }
      } finally { clearInterval(watchdog); }

      await flush();
      if (t.size && t.received < t.size) throw new TypeError('connection closed early');
      await this._finish(t);
    } catch (err) {
      try { await flush(); } catch {}
      if (t.status === 'removed') return;
      await this._handleError(t, err, ctrl);
    } finally {
      if (this.ctrl.get(t.id) === ctrl) this.ctrl.delete(t.id);
      release();
      t.speed = 0;
      this._changed(t);
      this._schedule();
    }
  }

  async _finish(t) {
    t.status = 'completed';
    t.size = t.received;
    t.completedAt = Date.now();
    t.speed = 0;
    this._changed(t);
    this.dispatchEvent(new CustomEvent('completed', { detail: t }));
  }

  async _handleError(t, err, ctrl) {
    const stalled = ctrl.signal.reason?.name === 'StallError';
    // Aborted on purpose (pause / offline / remove): status was already set by the caller.
    if (ctrl.signal.aborted && !stalled) return;

    if (err instanceof HttpError) {
      const s = err.status;
      if (s === 429 || s === 503 || s === 502 || s === 504) return this._retryLater(t, `Server busy (HTTP ${s}). Retrying\u2026`);
      t.status = 'error';
      t.error = s === 403 || s === 401
        ? `Access denied (HTTP ${s}). The link may have expired, or the site requires you to be signed in.`
        : s === 404 || s === 410 ? `File not found (HTTP ${s}). The link may have expired.` : `The server answered HTTP ${s}.`;
      return;
    }

    const online = await this._checkNetwork();
    if (!online) {
      t.status = 'waiting'; t.pauseReason = 'network'; t.error = '';
      return;
    }
    if (t.received === 0 && !stalled && err instanceof TypeError) {
      // Online but the request failed instantly: almost always CORS (the site blocks other websites).
      if (this.settings.proxyUrl && !t.useProxy) { t.useProxy = true; t.status = 'queued'; return; }
      t.status = 'blocked';
      t.error = this.settings.proxyUrl
        ? 'The site refused the download even through your proxy. Open it in the browser instead.'
        : 'This site doesn\u2019t let other websites download its files (CORS). Open it in the browser, or add a CORS proxy in Settings.';
      return;
    }
    return this._retryLater(t, stalled ? 'Connection stalled. Reconnecting\u2026' : 'Connection dropped. Reconnecting\u2026');
  }

  async _retryLater(t, msg) {
    t.retries = (t.retries || 0) + 1;
    if (t.retries > MAX_RETRIES) { t.status = 'error'; t.error = `${msg.split('.')[0]}. Gave up after ${MAX_RETRIES} tries \u2014 press Resume to try again.`; return; }
    t.status = 'paused'; t.pauseReason = 'retry'; t.notice = msg;
    this._changed(t);
    const wait = Math.min(30_000, 1000 * 2 ** t.retries);
    sleep(wait).then(() => {
      if (t.status === 'paused' && t.pauseReason === 'retry') { t.status = 'queued'; t.notice = ''; this._changed(t); this._schedule(); }
    });
  }

  // ---------- network watching ----------
  _goOffline() {
    if (!this.online) return;
    this.online = false;
    for (const t of this.tasks.values()) {
      if (ACTIVE.has(t.status) || t.status === 'queued') this.pause(t.id, 'network');
    }
    this.dispatchEvent(new CustomEvent('network', { detail: false }));
  }

  _goOnline() {
    if (this.online) return;
    this.online = true;
    for (const t of this.tasks.values()) {
      if (t.status === 'waiting') { t.status = 'queued'; t.pauseReason = ''; t.retries = 0; this._changed(t); }
    }
    this.dispatchEvent(new CustomEvent('network', { detail: true }));
    this._schedule();
  }

  async _checkNetwork() {
    if (!navigator.onLine) { this._goOffline(); return false; }
    if (this._checking) return this._checking;
    this._checking = (async () => {
      const ok = await pingInternet();
      ok ? this._goOnline() : this._goOffline();
      this._checking = false;
      return ok;
    })();
    return this._checking;
  }

  // ---------- speed + persistence ----------
  _tick() {
    let any = false;
    for (const t of this.tasks.values()) {
      if (t.status !== 'downloading') continue;
      const b = t._bytesThisSecond || 0; t._bytesThisSecond = 0;
      t._window = [...(t._window || []), b].slice(-5);
      t.speed = t._window.reduce((a, x) => a + x, 0) / t._window.length;
      any = true;
      this._changed(t, false);
    }
    if (any) this._persist();
  }

  _changed(t, persist = true) {
    if (t.status === 'removed' || !this.tasks.has(t.id)) return;
    this.dispatchEvent(new CustomEvent('change', { detail: t }));
    if (persist) this._persist();
  }

  _persist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      const clean = this.list().map(({ _window, _bytesThisSecond, _lastByteAt, speed, ...rest }) => rest);
      store.saveTasks(clean);
    }, 400);
  }
}

// Real connectivity check (navigator.onLine only knows if a network adapter is up).
export async function pingInternet() {
  const tryFetch = async (url, opts) => {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 5000);
    try { await fetch(url, { ...opts, signal: c.signal, cache: 'no-store' }); return true; }
    catch { return false; }
    finally { clearTimeout(timer); }
  };
  if (await tryFetch('https://www.gstatic.com/generate_204', { mode: 'no-cors' })) return true;
  if (await tryFetch('https://cloudflare.com/cdn-cgi/trace', { mode: 'no-cors' })) return true;
  return tryFetch(`${location.pathname}?ping=${Date.now()}`, { method: 'HEAD' });
}
