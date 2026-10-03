// WebGet CORS proxy — paste this into a Cloudflare Worker (free plan is enough).
//
// Why: many sites don't let other websites download their files from the browser (CORS).
// This worker fetches the file for your WebGet page and adds the headers browsers need.
// It also passes "Range" through, so pause/resume keeps working.
//
// IMPORTANT: put your GitHub Pages address below so strangers can't use your proxy.

const ALLOWED_ORIGINS = [
  'https://YOUR-GITHUB-USERNAME.github.io',
  // 'http://localhost:8080',   // uncomment while testing locally
];

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'last-modified', 'etag'];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

function originOf(request) {
  const o = request.headers.get('Origin');
  if (o) return o;
  const r = request.headers.get('Referer'); // <img> thumbnails send Referer instead of Origin
  try { return r ? new URL(r).origin : ''; } catch { return ''; }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition, Content-Type, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i.test(host);
}

export default {
  async fetch(request) {
    const origin = originOf(request);
    const allowed = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
    const cors = corsHeaders(allowed ? origin : '');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed) return new Response('This proxy only works for its own WebGet page.', { status: 403, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Add ?url=https://…', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) {
      return new Response('That address is not allowed.', { status: 400, headers: cors });
    }

    const headers = new Headers({
      'User-Agent': BROWSER_UA,
      Accept: request.headers.get('Accept') || '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${url.origin}/`,
    });
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);

    let upstream;
    try {
      upstream = await fetch(url.toString(), { method: request.method, headers, redirect: 'follow' });
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502, headers: cors });
    }

    const out = new Headers(cors);
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
