// Video -> audio conversion, entirely in the browser with ffmpeg.wasm.
// Uses the single-threaded core, which doesn't need special server headers,
// so it works on GitHub Pages. The ~31 MB engine is fetched from a CDN on first use
// and then cached by the browser.

import { extOf } from './utils.js';

const CORE_VERSION = '0.12.10';
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

export const AUDIO_FORMATS = {
  mp3: { label: 'MP3', mime: 'audio/mpeg', args: (br) => ['-c:a', 'libmp3lame', '-b:a', `${br}k`] },
  m4a: { label: 'M4A (AAC)', mime: 'audio/mp4', args: (br) => ['-c:a', 'aac', '-b:a', `${br}k`], tryCopy: true },
  ogg: { label: 'OGG (Vorbis)', mime: 'audio/ogg', args: (br) => ['-c:a', 'libvorbis', '-b:a', `${br}k`] },
  opus: { label: 'Opus', mime: 'audio/ogg', args: (br) => ['-c:a', 'libopus', '-b:a', `${br}k`] },
  wav: { label: 'WAV (lossless)', mime: 'audio/wav', args: () => ['-c:a', 'pcm_s16le'] },
};

export const MAX_INPUT = 1.8 * 1024 ** 3; // wasm memory limit is ~2 GB

let ffmpeg = null;
let loading = null;

// Fetch a file into a same-origin blob: URL (lets the worker load CDN code), with progress.
async function toBlobURL(url, type, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!onProgress || !res.body) return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress(total ? received / total : 0, received);
  }
  return URL.createObjectURL(new Blob(parts, { type }));
}

export function isLoaded() { return !!ffmpeg; }

export function loadFFmpeg(onProgress = () => {}, customBase = '') {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (loading) return loading;
  loading = (async () => {
    const W = window.FFmpegWASM;
    if (!W) throw new Error('The converter scripts didn\u2019t load. Check that the vendor/ folder was uploaded.');
    const bases = customBase ? [customBase.replace(/\/+$/, ''), ...CORE_BASES] : CORE_BASES;
    let lastErr;
    for (const base of bases) {
      try {
        const f = new W.FFmpeg();
        const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', onProgress);
        await f.load({ coreURL, wasmURL });
        ffmpeg = f;
        return f;
      } catch (e) { lastErr = e; }
    }
    throw new Error(`Couldn\u2019t download the converter engine (${lastErr?.message || lastErr}). Check your internet connection.`);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export async function toAudio(blob, inputName, format = 'mp3', bitrate = '192', onProgress = () => {}) {
  const fmt = AUDIO_FORMATS[format];
  if (!fmt) throw new Error(`Unknown format ${format}`);
  if (blob.size > MAX_INPUT) throw new Error('This file is larger than 1.8 GB, which is more than the in-browser converter can hold in memory.');
  const f = await loadFFmpeg();

  const inExt = extOf(inputName) || 'mp4';
  const inFile = `in.${inExt}`, outFile = `out.${format}`;
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 30) logs.shift(); };
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) onProgress(progress); };
  f.on('log', onLog);
  f.on('progress', onProg);
  try {
    await f.writeFile(inFile, new Uint8Array(await blob.arrayBuffer()));
    let code = 1;
    if (fmt.tryCopy) code = await f.exec(['-i', inFile, '-vn', '-map', '0:a:0', '-c:a', 'copy', '-y', outFile]);
    if (code !== 0) code = await f.exec(['-i', inFile, '-vn', '-map', '0:a:0', ...fmt.args(bitrate), '-y', outFile]);
    if (code !== 0) {
      const noAudio = logs.some((l) => /matches no streams|does not contain any stream|Output file .* does not contain/i.test(l));
      throw new Error(noAudio ? 'This file has no audio track.' : `Conversion failed: ${logs.slice(-3).join(' ').slice(0, 200)}`);
    }
    const data = await f.readFile(outFile);
    return new Blob([data.buffer], { type: fmt.mime });
  } finally {
    f.off('log', onLog);
    f.off('progress', onProg);
    try { await f.deleteFile(inFile); } catch {}
    try { await f.deleteFile(outFile); } catch {}
  }
}

export function audioName(inputName, format) {
  return inputName.replace(/\.[a-z0-9]{1,5}$/i, '') + `.${format}`;
}
