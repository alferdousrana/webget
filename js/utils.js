// Small shared helpers.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function formatBytes(n, digits = 1) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : digits)} ${units[i]}`;
}

export const formatSpeed = (bps) => (bps > 0 ? `${formatBytes(bps)}/s` : '0 B/s');

export function formatEta(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatAdded(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return `Today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export const formatFullDate = (ts) =>
  new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- file categories ----------
const EXT = {
  music: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'alac', 'amr'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'wmv', '3gp', 'ts', 'mts', 'mpeg', 'mpg', 'ogv'],
  pdf: ['pdf'],
  gif: ['gif'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff', 'ico', 'jfif'],
  document: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'epub', 'md', 'json', 'xml'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'apk', 'exe', 'msi', 'dmg', 'deb', 'rpm'],
};

export const CATEGORIES = [
  { id: 'all', label: 'All files' },
  { id: 'video', label: 'Video' },
  { id: 'music', label: 'Music' },
  { id: 'image', label: 'Images' },
  { id: 'gif', label: 'GIFs' },
  { id: 'pdf', label: 'PDF' },
  { id: 'document', label: 'Documents' },
  { id: 'archive', label: 'Archives & apps' },
  { id: 'other', label: 'Other' },
];

export function extOf(name = '') {
  const clean = name.split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

export function categoryOf(name = '', mime = '') {
  const ext = extOf(name);
  for (const [cat, list] of Object.entries(EXT)) if (list.includes(ext)) return cat;
  mime = (mime || '').toLowerCase();
  if (mime === 'image/gif') return 'gif';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'music';
  if (mime === 'application/pdf') return 'pdf';
  if (/zip|rar|7z|tar|gzip|x-msdownload|octet-stream.*apk/.test(mime)) return 'archive';
  if (/word|excel|sheet|presentation|powerpoint|text\/|epub/.test(mime)) return 'document';
  return 'other';
}

const MIME_EXT = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/opus': 'opus', 'audio/webm': 'weba', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
  'application/zip': 'zip', 'text/plain': 'txt',
};
export const extFromMime = (mime = '') => MIME_EXT[mime.split(';')[0].trim().toLowerCase()] || '';

export const MIME_FROM_EXT = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

export function sanitizeName(name) {
  return (name || 'download')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'download';
}

export function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return sanitizeName(last || u.hostname);
  } catch { return 'download'; }
}

export function nameFromDisposition(header) {
  if (!header) return '';
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) { try { return sanitizeName(decodeURIComponent(star[1].replace(/"/g, ''))); } catch {} }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? sanitizeName(plain[1]) : '';
}

export function ensureExt(name, mime) {
  if (extOf(name)) return name;
  const e = extFromMime(mime);
  return e ? `${name}.${e}` : name;
}

export function isHttpUrl(s) {
  try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- settings ----------
const SETTINGS_KEY = 'wdm.settings.v1';
export const DEFAULT_SETTINGS = {
  extractorUrl: '',
  extractorKey: '',
  proxyUrl: '',
  videoQuality: '1080',
  audioFormat: 'mp3',
  audioBitrate: '128',
  youtubeCodec: 'h264',
  maxConcurrent: 3,
  autoSave: true,
  theme: 'auto',
  sort: 'newest',
  filter: 'all',
};

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function proxify(proxyBase, url) {
  if (!proxyBase) return url;
  const base = proxyBase.trim();
  if (base.includes('{url}')) return base.replace('{url}', encodeURIComponent(url));
  const enc = encodeURIComponent(url);
  if (/[?&]url=$/.test(base)) return base + enc;
  const join = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : (base.endsWith('/') ? '?' : '/?');
  return `${base}${join}url=${enc}`;
}
