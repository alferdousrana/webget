// Turns a pasted link into downloadable file(s).
//  1. Direct file links  -> probed straight from the browser (CORS permitting).
//  2. Social platforms   -> a cobalt-compatible extractor API you host (GitHub Pages can't run one).
//  3. Web pages/LinkedIn -> fetched through your CORS proxy and scanned for media.

import {
  categoryOf, ensureExt, extOf, nameFromDisposition, nameFromUrl, proxify, sanitizeName,
} from './utils.js';
import { detectPlatform, explainExtractorError } from './platforms.js';

export class ExtractError extends Error {
  constructor(notice) { super(notice.text); this.notice = notice; }
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// ---------- 1. direct file probe ----------
// Requests just the first byte. Tells us type, size, whether resume works, and whether CORS allows it.
export async function probe(url, { proxyUrl = '', useProxy = false } = {}) {
  const target = useProxy ? proxify(proxyUrl, url) : url;
  const to = withTimeout(15000);
  let res;
  try {
    res = await fetch(target, { headers: { Range: 'bytes=0-0' }, signal: to.signal, cache: 'no-store' });
  } catch (err) {
    to.done();
    return { ok: false, reason: err?.name === 'TimeoutError' ? 'timeout' : 'cors', viaProxy: useProxy };
  }
  to.done();
  try { res.body?.cancel(); } catch {}
  if (!res.ok) return { ok: false, reason: 'http', status: res.status, viaProxy: useProxy };

  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  const cr = res.headers.get('content-range');
  let size = null;
  if (res.status === 206 && cr && /\/(\d+)$/.test(cr)) size = Number(cr.match(/\/(\d+)$/)[1]);
  else if (res.status === 200 && res.headers.get('content-length')) size = Number(res.headers.get('content-length'));
  const finalUrl = res.url || url;
  let name = nameFromDisposition(res.headers.get('content-disposition')) || nameFromUrl(useProxy ? url : finalUrl);
  name = ensureExt(name, mime);
  return {
    ok: true, viaProxy: useProxy, mime, size, name,
    resumable: res.status === 206,
    isPage: /text\/html|application\/xhtml/.test(mime),
    category: categoryOf(name, mime),
  };
}

// ---------- 2. extractor API (cobalt v10/v11 protocol) ----------
function apiBase(u) { return u.trim().replace(/\/+$/, '') + '/'; }

export async function extractorInfo(settings) {
  if (!settings.extractorUrl) throw new Error('No extractor URL set');
  const r = await fetch(apiBase(settings.extractorUrl), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.cobalt || j;
}

export async function extract(url, opts, settings) {
  if (!settings.extractorUrl) {
    throw new ExtractError({
      level: 'block',
      text: 'Social media links need an extractor server. GitHub Pages only serves files, so it can\u2019t talk to YouTube or Facebook directly. Add your extractor URL in Settings (setup steps are in the README).',
      action: 'settings',
    });
  }
  if (/api\.cobalt\.tools/.test(settings.extractorUrl)) {
    throw new ExtractError({
      level: 'block',
      text: 'api.cobalt.tools is protected by bot checks and doesn\u2019t accept requests from other websites. Use your own instance or one whose owner gave you an API key.',
      action: 'settings',
    });
  }
  const body = {
    url,
    downloadMode: opts.mode || 'auto',
    videoQuality: String(opts.quality || settings.videoQuality || '1080'),
    audioFormat: opts.audioFormat || settings.audioFormat || 'mp3',
    audioBitrate: String(opts.audioBitrate || settings.audioBitrate || '128'),
    youtubeVideoCodec: settings.youtubeCodec || 'h264',
    filenameStyle: 'pretty',
    alwaysProxy: true, // force tunnel so the file comes back with CORS headers
  };
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (settings.extractorKey) {
    const k = settings.extractorKey.trim();
    headers.Authorization = /^(Api-Key|Bearer)\s/i.test(k) ? k : `Api-Key ${k}`;
  }
  const to = withTimeout(45000);
  let res, json;
  try {
    res = await fetch(apiBase(settings.extractorUrl), { method: 'POST', headers, body: JSON.stringify(body), signal: to.signal });
    json = await res.json();
  } catch (err) {
    throw new ExtractError({
      level: 'block',
      text: err?.name === 'TimeoutError'
        ? 'The extractor server took too long to answer. It may be asleep (free hosting) \u2014 try again in a minute.'
        : 'Couldn\u2019t reach the extractor server. Check the URL in Settings, that the server is running, and that it allows requests from this site (CORS).',
    });
  } finally { to.done(); }

  switch (json?.status) {
    case 'tunnel':
    case 'redirect': {
      const name = sanitizeName(json.filename || nameFromUrl(json.url));
      return { kind: 'single', items: [{ url: json.url, name, category: categoryOf(name), redirect: json.status === 'redirect' }] };
    }
    case 'picker': {
      const items = (json.picker || []).map((p, i) => {
        const ext = p.type === 'photo' ? 'jpg' : p.type === 'gif' ? 'gif' : 'mp4';
        const guess = extOf(nameFromUrl(p.url)) ? nameFromUrl(p.url) : `item-${i + 1}.${ext}`;
        return { url: p.url, thumb: p.thumb, type: p.type, name: sanitizeName(guess), category: categoryOf(guess) };
      });
      if (json.audio) items.push({ url: json.audio, type: 'audio', name: sanitizeName(json.audioFilename || 'audio.mp3'), category: 'music' });
      return { kind: 'picker', items };
    }
    case 'local-processing': {
      // Newer servers may ask the client to merge streams itself. We only accept single-stream jobs.
      const t = json.tunnel || [];
      if (t.length === 1) {
        const name = sanitizeName(json.output?.filename || 'download');
        return { kind: 'single', items: [{ url: t[0], name, category: categoryOf(name, json.output?.type) }] };
      }
      throw new ExtractError({ level: 'block', text: 'The extractor asked this browser to merge video and audio itself. Set localProcessing to "disabled" on your server, or pick a lower quality.' });
    }
    case 'error':
      throw new ExtractError(explainExtractorError(json.error?.code, json.error?.context));
    default:
      throw new ExtractError({ level: 'block', text: `Unexpected answer from the extractor (HTTP ${res?.status}).` });
  }
}

// ---------- 3. page scanner (needs CORS proxy) ----------
function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

export async function scanPage(url, settings) {
  if (!settings.proxyUrl) {
    throw new ExtractError({
      level: 'block',
      text: 'Reading this page needs a CORS proxy, because the site doesn\u2019t let other websites read it. Add one in Settings (a free Cloudflare Worker \u2014 see README).',
      action: 'settings',
    });
  }
  const to = withTimeout(20000);
  let html;
  try {
    const r = await fetch(proxify(settings.proxyUrl, url), { signal: to.signal });
    if (!r.ok) throw new ExtractError({ level: 'block', text: `The site answered with HTTP ${r.status}. It may need a login.` });
    html = await r.text();
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError({ level: 'block', text: 'Couldn\u2019t load the page through the proxy. Check the proxy URL in Settings.' });
  } finally { to.done(); }

  const found = new Map();
  const add = (u, type, label) => {
    if (!u) return;
    try { u = new URL(decodeEntities(u).replace(/\\u0026/g, '&').replace(/\\\//g, '/'), url).href; } catch { return; }
    if (!/^https?:/.test(u) || found.has(u)) return;
    const name = nameFromUrl(u);
    const ext = type === 'video' ? 'mp4' : type === 'image' ? 'jpg' : '';
    const n = extOf(name) ? name : `${sanitizeName(label || 'media')}${ext ? '.' + ext : ''}`;
    found.set(u, { url: u, type, name: n, category: categoryOf(n), thumb: type === 'image' ? u : '' });
  };

  // LinkedIn embeds its video list as JSON in data-sources
  for (const m of html.matchAll(/data-sources="([^"]+)"/g)) {
    try {
      const list = JSON.parse(decodeEntities(m[1]));
      list.sort((a, b) => (b.data?.bitrate || 0) - (a.data?.bitrate || 0));
      list.forEach((s, i) => add(s.src, 'video', `linkedin-video${i ? '-' + (i + 1) : ''}`));
    } catch {}
  }
  const meta = (prop) => [...html.matchAll(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'gi'))]
    .map((m) => (m[0].match(/content=["']([^"']+)["']/i) || [])[1]).filter(Boolean);
  meta('og:video(?::secure_url|:url)?').forEach((u) => add(u, 'video', 'video'));
  meta('twitter:player:stream').forEach((u) => add(u, 'video', 'video'));
  for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) add(m[1], 'video', 'video');
  for (const m of html.matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g)) add(m[1], 'video', 'video');
  for (const m of html.matchAll(/<audio[^>]+src=["']([^"']+)["']/gi)) add(m[1], 'audio', 'audio');
  meta('og:image(?::secure_url|:url)?').forEach((u) => add(u, 'image', 'image'));
  for (const m of html.matchAll(/href=["']([^"']+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|mp3|mp4)(?:\?[^"']*)?)["']/gi)) add(m[1], 'file', '');

  const title = decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  return { kind: 'picker', items: [...found.values()].slice(0, 40), title };
}

// ---------- entry point used by the Add dialog ----------
export async function analyze(url, settings) {
  const platform = detectPlatform(url);
  if (platform) return { type: 'platform', platform };

  let p = await probe(url);
  if (!p.ok && p.reason === 'cors' && settings.proxyUrl) {
    const viaProxy = await probe(url, { proxyUrl: settings.proxyUrl, useProxy: true });
    if (viaProxy.ok) p = viaProxy;
  }
  return { type: 'direct', probe: p };
}
