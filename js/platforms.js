// Recognises social/media sites, and lists what each one restricts.
// Notice levels: 'info' (good to know), 'warn' (may fail / rules apply), 'block' (cannot work as set up).

const COPYRIGHT = {
  level: 'info',
  text: 'Download only content you made or have permission to save. Re-uploading other people\u2019s videos or music can break copyright law.',
};

export const PLATFORMS = [
  {
    id: 'youtube', name: 'YouTube', via: 'extractor',
    match: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/,
    notices: [
      { level: 'warn', text: 'YouTube\u2019s terms only allow offline saving through YouTube itself (e.g. Premium). Use this for your own uploads or Creative Commons videos.' },
      { level: 'warn', text: 'Private, members-only, age-restricted and paid videos can\u2019t be downloaded. Live streams aren\u2019t supported until they end.' },
    ],
  },
  {
    id: 'facebook', name: 'Facebook', via: 'extractor',
    match: /(^|\.)(facebook\.com|fb\.watch|fb\.com|fbcdn\.net)$/,
    notices: [
      { level: 'warn', text: 'Only public videos and reels work. Posts from private profiles, closed groups or friends-only audiences need a login and will fail.' },
    ],
  },
  {
    id: 'linkedin', name: 'LinkedIn', via: 'scrape',
    match: /(^|\.)(linkedin\.com|lnkd\.in)$/,
    notices: [
      { level: 'warn', text: 'LinkedIn shows most posts only to signed-in members. Only posts that open without logging in (public \u201cposts/\u2026\u201d links) can be read.' },
      { level: 'info', text: 'LinkedIn is read through your CORS proxy, which scans the public post page for video and image files.' },
    ],
  },
  {
    id: 'pinterest', name: 'Pinterest', via: 'extractor',
    match: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/,
    notices: [
      { level: 'info', text: 'Pins are usually re-shared from other sites. The original creator keeps the rights to the image or video.' },
    ],
  },
  {
    id: 'instagram', name: 'Instagram', via: 'extractor',
    match: /(^|\.)(instagram\.com|instagr\.am|ddinstagram\.com)$/,
    notices: [
      { level: 'warn', text: 'Only posts and reels from public accounts work. Stories and private accounts need a login.' },
    ],
  },
  {
    id: 'tiktok', name: 'TikTok', via: 'extractor',
    match: /(^|\.)(tiktok\.com|vm\.tiktok\.com)$/,
    notices: [{ level: 'info', text: 'Videos come without the TikTok watermark when the extractor can find the clean file.' }],
  },
  { id: 'twitter', name: 'X / Twitter', via: 'extractor', match: /(^|\.)(twitter\.com|x\.com|vxtwitter\.com|fixvx\.com)$/,
    notices: [{ level: 'warn', text: 'Posts from protected accounts and some sensitive-media posts need a login and will fail.' }] },
  { id: 'vimeo', name: 'Vimeo', via: 'extractor', match: /(^|\.)vimeo\.com$/,
    notices: [{ level: 'warn', text: 'Private and password-protected Vimeo videos can\u2019t be downloaded.' }] },
  { id: 'soundcloud', name: 'SoundCloud', via: 'extractor', match: /(^|\.)(soundcloud\.com|snd\.sc)$/,
    notices: [{ level: 'warn', text: 'Go+ tracks only give a 30-second preview.' }] },
  { id: 'reddit', name: 'Reddit', via: 'extractor', match: /(^|\.)(reddit\.com|redd\.it)$/, notices: [] },
  { id: 'dailymotion', name: 'Dailymotion', via: 'extractor', match: /(^|\.)(dailymotion\.com|dai\.ly)$/, notices: [] },
  { id: 'tumblr', name: 'Tumblr', via: 'extractor', match: /(^|\.)tumblr\.com$/, notices: [] },
  { id: 'twitch', name: 'Twitch clips', via: 'extractor', match: /(^|\.)twitch\.tv$/,
    notices: [{ level: 'info', text: 'Only clips are supported, not full streams or VODs.' }] },
  { id: 'bluesky', name: 'Bluesky', via: 'extractor', match: /(^|\.)bsky\.app$/, notices: [] },
  { id: 'snapchat', name: 'Snapchat', via: 'extractor', match: /(^|\.)snapchat\.com$/, notices: [] },
  { id: 'streamable', name: 'Streamable', via: 'extractor', match: /(^|\.)streamable\.com$/, notices: [] },
  { id: 'bilibili', name: 'Bilibili', via: 'extractor', match: /(^|\.)(bilibili\.com|bilibili\.tv|b23\.tv)$/, notices: [] },
  { id: 'loom', name: 'Loom', via: 'extractor', match: /(^|\.)loom\.com$/, notices: [] },
  { id: 'vk', name: 'VK', via: 'extractor', match: /(^|\.)(vk\.com|vkvideo\.ru)$/, notices: [] },
  { id: 'okru', name: 'OK.ru', via: 'extractor', match: /(^|\.)ok\.ru$/, notices: [] },
  { id: 'rutube', name: 'Rutube', via: 'extractor', match: /(^|\.)rutube\.ru$/, notices: [] },
];

// Sites that stream through DRM — nothing in a browser tool can save them.
const DRM = /(^|\.)(netflix\.com|primevideo\.com|disneyplus\.com|hotstar\.com|spotify\.com|open\.spotify\.com|music\.apple\.com|hoichoi\.tv|chorki\.com|bongobd\.com|zee5\.com)$/;

export function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\.|^mobile\./, ''); }
  catch { return null; }
  if (DRM.test(host)) {
    return {
      id: 'drm', name: host, via: 'none',
      notices: [{ level: 'block', text: 'This service protects its streams with DRM encryption. They can\u2019t be downloaded here \u2014 use the service\u2019s own offline/download feature.' }],
    };
  }
  const p = PLATFORMS.find((x) => x.match.test(host));
  return p ? { ...p, notices: [...p.notices, COPYRIGHT] } : null;
}

export const copyrightNotice = COPYRIGHT;

// Extractor (cobalt) error codes -> readable restriction messages.
export function explainExtractorError(code = '', context = {}) {
  const c = code.replace(/^error\.api\./, '');
  const svc = context.service ? ` (${context.service})` : '';
  const table = [
    [/^auth\.(jwt|key)\.missing|^auth\.key\.invalid|^auth\.jwt\.invalid|^auth\./, 'block', 'The extractor server needs an API key. Add it in Settings \u2192 Extractor API key.'],
    [/content\.video\.age|content\.post\.age/, 'block', 'This video is age-restricted. It can only be watched after signing in, so it can\u2019t be downloaded.'],
    [/content\.(video|post)\.private/, 'block', 'This content is private. Only the owner (or allowed people) can view it.'],
    [/content\.video\.region/, 'block', `This video is blocked in the extractor server\u2019s country${svc}.`],
    [/content\.video\.paid/, 'block', 'This is paid or members-only content.'],
    [/content\.video\.live/, 'block', 'Live streams can\u2019t be downloaded. Try again after the stream ends.'],
    [/content\.too_long/, 'block', `This video is longer than the extractor allows${context.limit ? ` (${Math.round(context.limit / 60)} min limit)` : ''}.`],
    [/content\.(video|post)\.unavailable|fetch\.empty|content\.post\.unavailable/, 'block', 'The content is unavailable \u2014 deleted, private, or the link is wrong.'],
    [/rate_exceeded|fetch\.rate/, 'warn', `Too many requests right now${svc}. Wait a minute and try again.`],
    [/youtube\.(login|token_expired|no_session|no_matching_format|decipher|api_error)|youtube\./, 'block', 'YouTube blocked the extractor server (it asks it to sign in). Self-hosted extractors may need YouTube cookies or a session token \u2014 see README.'],
    [/fetch\.critical|fetch\.fail/, 'warn', `The extractor couldn\u2019t fetch this${svc}. The site may be blocking it; try again later.`],
    [/link\.(invalid|unsupported)|service\.unsupported/, 'block', 'This link isn\u2019t supported by the extractor. Check that it points to a single post or video.'],
    [/service\.disabled/, 'block', `This service is turned off on your extractor server${svc}.`],
  ];
  for (const [re, level, text] of table) if (re.test(c)) return { level, text, code };
  return { level: 'block', text: `The extractor refused this link (${code || 'unknown error'}).`, code };
}
