'use strict';
// yt-dlp 호출 — 인자 조립, 정보 조회(영상·재생목록·채널), 진행률 줄 해석. 셸을 거치지 않고(spawn, shell:false) 주소는 항상 '--' 뒤에 둔다.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeUrl, killTree } = require('./util.cjs');

const SEP = '\u001f';
const MAX_JSON_BYTES = 128 * 1024 * 1024;

// ---------- 도구 위치 ----------
// toolsDir: yt-dlp.exe·ffmpeg.exe 가 있는 폴더(설치본: resources\tools). engineYtdlp: 엔진 업데이트가 받은 yt-dlp(있으면 우선).
function locateTools({ toolsDir, engineYtdlp } = {}) {
  const ytdlp = engineYtdlp && fs.existsSync(engineYtdlp) ? engineYtdlp : path.join(toolsDir, 'yt-dlp.exe');
  return { ytdlp, ffmpegDir: toolsDir, ffmpeg: path.join(toolsDir, 'ffmpeg.exe') };
}

// YouTube 는 최근 자바스크립트 실행 환경(node 등)이 있어야 모든 화질이 보인다. Electron 실행 파일을 node 처럼 쓴다(ELECTRON_RUN_AS_NODE).
function runtimeSetup() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  delete env.NODE_OPTIONS;
  const args = [];
  if (process.execPath && /(node|electron|goodseedown)(\.exe)?$/i.test(process.execPath)) {
    args.push('--js-runtimes', 'node:' + process.execPath);
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  }
  return { env, args };
}

// ---------- 주소 분류 ----------
const isYouTubeHost = h => /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/i.test(h);
const CHANNEL_ROOT = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/;
const CHANNEL_TAB = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(videos|shorts|streams|playlists|featured)\/?$/;
function classifyUrl(url) {
  const u = new URL(url);
  if (!isYouTubeHost(u.hostname)) return { site: 'other' };
  const hasV = u.searchParams.has('v') || u.hostname.toLowerCase().endsWith('youtu.be');
  const hasList = u.searchParams.has('list');
  if (u.pathname.startsWith('/playlist')) return { site: 'youtube', kind: 'playlist' };
  if (hasV && hasList) return { site: 'youtube', kind: 'choice' };
  if (hasV || /^\/(shorts|live|embed)\//.test(u.pathname)) return { site: 'youtube', kind: 'video' };
  if (CHANNEL_ROOT.test(u.pathname) || CHANNEL_TAB.test(u.pathname)) return { site: 'youtube', kind: 'channel' };
  return { site: 'youtube', kind: 'unknown' };
}
// 채널 첫 화면 주소에는 '동영상' 탭을 붙여 영상 목록을 받는다.
function channelVideosUrl(url) {
  const u = new URL(url);
  if (CHANNEL_ROOT.test(u.pathname)) u.pathname = u.pathname.replace(/\/$/, '') + '/videos';
  return u.href;
}
function videoOnlyUrl(url) { const u = new URL(url); u.searchParams.delete('list'); u.searchParams.delete('index'); u.searchParams.delete('start_radio'); return u.href; }
function listOnlyUrl(url) { const u = new URL(url); return `https://www.youtube.com/playlist?list=${encodeURIComponent(u.searchParams.get('list'))}`; }

// ---------- 정보 조회 ----------
function runJson(tools, args, { signal, timeoutMs = 120000 } = {}) {
  const rt = runtimeSetup();
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ytdlp, ['--ignore-config', '--no-warnings', '--no-colors', ...rt.args, ...args], { windowsHide: true, env: rt.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; let outN = 0, err = '', settled = false;
    const kill = () => { killTree(child.pid); };
    const fin = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(v); };
    const timer = setTimeout(() => { kill(); fin(reject, Object.assign(new Error('정보를 가져오는 시간이 초과되었습니다.'), { code: 'timeout' })); }, timeoutMs);
    const onAbort = () => { kill(); fin(reject, Object.assign(new Error('취소되었습니다.'), { code: 'aborted' })); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout.on('data', c => { outN += c.length; if (outN > MAX_JSON_BYTES) { kill(); fin(reject, Object.assign(new Error('응답이 너무 큽니다.'), { code: 'too-large' })); } else out.push(c); });
    child.stderr.on('data', c => { err = (err + c.toString('utf8')).slice(-6000); });
    child.on('error', e => fin(reject, Object.assign(new Error('yt-dlp 를 실행하지 못했습니다: ' + e.message), { code: 'spawn' })));
    child.on('close', code => {
      if (code !== 0) return fin(reject, Object.assign(new Error(err.trim().split(/\r?\n/).slice(-3).join('\n') || `yt-dlp 오류(종료 코드 ${code})`), { code: 'ytdlp', raw: err }));
      try { fin(resolve, JSON.parse(Buffer.concat(out).toString('utf8'))); } catch { fin(reject, Object.assign(new Error('조회 결과를 해석하지 못했습니다.'), { code: 'bad-json' })); }
    });
  });
}

const entryUrl = e => {
  if (typeof e.url === 'string' && /^https?:\/\//i.test(e.url)) return e.url;
  if (e.id && /^youtube/i.test(e.ie_key || '')) return `https://www.youtube.com/watch?v=${e.id}`;
  return null;
};

function summarizeVideo(d) {
  const formats = Array.isArray(d.formats) ? d.formats : [];
  const heights = [...new Set(formats.filter(f => f && f.vcodec && f.vcodec !== 'none' && Number.isFinite(f.height)).map(f => f.height))].sort((a, b) => b - a);
  const subs = Object.entries(d.subtitles || {}).filter(([k]) => k !== 'live_chat').map(([code, v]) => ({ code, name: (Array.isArray(v) && v[0] && v[0].name) || code }));
  const autoSubs = Object.keys(d.automatic_captions || {});
  return {
    type: 'video', id: String(d.id || ''), url: d.webpage_url || d.original_url || '', title: String(d.title || ''), duration: Number.isFinite(d.duration) ? d.duration : null,
    uploader: String(d.uploader || d.channel || ''), thumbnail: typeof d.thumbnail === 'string' ? d.thumbnail : '', license: d.license || null,
    heights, subs, autoSubs, isLive: !!d.is_live,
  };
}
function summarizePlaylist(d, requestedUrl) {
  const raw = Array.isArray(d.entries) ? d.entries : [];
  const entries = [];
  raw.forEach((e, i) => {
    if (!e) return;
    const url = entryUrl(e);
    const title = String(e.title || '');
    const unavailable = !url || /^\[(private|deleted) video\]$/i.test(title);
    entries.push({ index: i + 1, id: String(e.id || ''), title: title || String(e.id || ''), url: url || '', duration: Number.isFinite(e.duration) ? e.duration : null, unavailable });
  });
  return { type: 'playlist', id: String(d.id || ''), url: d.webpage_url || requestedUrl, title: String(d.title || ''), uploader: String(d.uploader || d.channel || ''), count: Number.isFinite(d.playlist_count) ? d.playlist_count : entries.length, entries };
}

// 주소를 분석한다. mode: 'auto'(기본) | 'video'(재생목록 무시) | 'list'(재생목록 전체). end: 목록에서 가져올 최대 개수.
async function analyze(tools, rawUrl, { mode = 'auto', end = 0, signal } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw Object.assign(new Error('올바른 http(s) 주소가 아닙니다.'), { code: 'bad-url' });
  const cls = classifyUrl(url);
  let target = url; const args = ['-J', '--flat-playlist'];
  if (cls.kind === 'choice') {
    if (mode === 'auto') return { type: 'choice', videoUrl: videoOnlyUrl(url), listUrl: listOnlyUrl(url) };
    target = mode === 'list' ? listOnlyUrl(url) : videoOnlyUrl(url);
  } else if (cls.kind === 'channel') target = channelVideosUrl(url);
  if (cls.kind === 'video' || (cls.kind === 'choice' && mode === 'video') || mode === 'video') args.push('--no-playlist');
  if (end > 0) args.push('--playlist-end', String(end));
  const d = await runJson(tools, [...args, '--', target], { signal });
  if (d && (d._type === 'playlist' || Array.isArray(d.entries))) {
    const p = summarizePlaylist(d, target);
    p.channel = cls.kind === 'channel';
    return p;
  }
  const v = summarizeVideo(d); if (!v.url) v.url = target;
  return v;
}

// ---------- 다운로드 인자 ----------
// job: {url, options:{kind,quality,videoFormat,audioFormat,subs}, outDir, tempDir, nameTemplate}
function buildDownloadArgs(job, { ffmpegDir, testExtraArgs = [], freshStart = true } = {}) {
  const o = job.options;
  const a = ['--newline', '--no-quiet', '--progress', '--encoding', 'utf-8', '--ignore-config', '--no-colors', '--no-playlist', '--ffmpeg-location', ffmpegDir,
    '-P', 'home:' + job.outDir, '-P', 'temp:' + job.tempDir, '-o', job.nameTemplate || '%(title).150B [%(id)s].%(ext)s',
    '--windows-filenames', '--trim-filenames', '200', '--no-mtime', '--retries', '5', '--fragment-retries', '5', '--file-access-retries', '10', '--concurrent-fragments', '4',
    '--progress-template', ['download:GSP', '%(progress.status)s', '%(progress.downloaded_bytes)s', '%(progress.total_bytes)s', '%(progress.total_bytes_estimate)s', '%(progress.speed)s', '%(progress.eta)s', '%(info.format_id)s', '%(info.vcodec)s'].join(SEP),
    '--progress-template', ['postprocess:GSPP', '%(progress.status)s', '%(progress.postprocessor)s'].join(SEP),
    '--print', ['before_dl:GSINFO', '%(id)s', '%(duration)s', '%(uploader)s', '%(title)s'].join(SEP),
    '--print', 'after_move:GSFILE' + SEP + '%(filepath)s', '--no-simulate'];
  const subs = o.subs || {};
  const wantSubs = subs.enabled && Array.isArray(subs.langs) && subs.langs.length > 0;
  if (o.kind === 'subs') {
    a.push('--skip-download');
  } else if (o.kind === 'audio') {
    // MP3 는 고른 비트레이트(CBR)로 변환한다. ID3 태그(제목·아티스트 등)는 --embed-metadata, 앨범아트는 썸네일을 jpg 로 바꿔 넣는다(MP3 만).
    const mp3 = o.audioFormat === 'mp3', id3 = o.id3 !== false;
    a.push('-f', o.audioFormat === 'm4a' ? 'ba[ext=m4a]/ba/b' : 'ba/b', '-x', '--audio-format', o.audioFormat === 'ogg' ? 'vorbis' : o.audioFormat, '--audio-quality', mp3 ? (Number(o.mp3Bitrate) || 320) + 'K' : '0');
    if (id3) { a.push('--embed-metadata'); if (mp3) a.push('--embed-thumbnail', '--convert-thumbnails', 'jpg'); }
    // 같은 영상을 다른 음질로 다시 받으면 새 음질로 덮어쓴다(안 그러면 yt-dlp 가 "이미 받음"으로 건너뛰어 예전 파일이 그대로 남는다).
    // 단, 이어받기일 때는 쓰지 않는다 — --force-overwrites 는 받던 .part 도 버려서 처음부터 다시 받게 된다.
    if (mp3 && freshStart) a.push('--force-overwrites');
  } else {
    const sort = [];
    if (o.quality !== 'best') sort.push('res:' + Number(o.quality));
    if (o.videoFormat === 'mp4') sort.push('vcodec:h264', 'acodec:aac');
    if (sort.length) a.push('-S', sort.join(','));
    a.push('-f', 'bv*+ba/b', '--merge-output-format', o.videoFormat, '--remux-video', o.videoFormat, '--embed-metadata');
  }
  if (wantSubs) {
    // 합침만(embed): --write-subs 를 주지 않아야 yt-dlp 가 합친 뒤 자막 파일을 지운다(주면 .srt 가 남는다). 둘 다(both): 합치고 .srt 도 남긴다.
    const embedOnly = o.kind === 'video' && subs.mode === 'embed', both = o.kind === 'video' && subs.mode === 'both';
    if (!embedOnly) a.push('--write-subs');
    a.push('--sub-langs', subs.langs.join(','), '--sub-format', 'srt/vtt/best');
    if (subs.auto) a.push('--write-auto-subs');
    a.push('--convert-subs', 'srt');
    if (embedOnly || both) a.push('--embed-subs');
  }
  for (const x of testExtraArgs) a.push(x);
  a.push('--', job.url);
  return a;
}

// stdout/stderr 한 줄을 해석한다.
function parseLine(line) {
  if (line.startsWith('GSP' + SEP)) {
    const f = line.split(SEP); const num = v => { const n = Number(v); return v && v !== 'NA' && v !== 'None' && Number.isFinite(n) ? n : null; };
    return { type: 'progress', status: f[1], downloaded: num(f[2]), total: num(f[3]), estimate: num(f[4]), speed: num(f[5]), eta: num(f[6]), formatId: f[7] || '', vcodec: f[8] || '' };
  }
  if (line.startsWith('GSPP' + SEP)) { const f = line.split(SEP); return { type: 'post', status: f[1], name: f[2] || '' }; }
  if (line.startsWith('GSFILE' + SEP)) return { type: 'file', path: line.slice(('GSFILE' + SEP).length) };
  if (line.startsWith('GSINFO' + SEP)) { const f = line.split(SEP); return { type: 'info', id: f[1], duration: Number(f[2]) || null, uploader: f[3] && f[3] !== 'NA' ? f[3] : '', title: f.slice(4).join(SEP) }; }
  const m = /^\[download\] Resuming download at byte (\d+)/.exec(line); if (m) return { type: 'resume', byte: Number(m[1]) };
  const s = /Writing video subtitles to:\s*(.+)$/.exec(line); if (s) return { type: 'subfile', path: s[1].trim() };
  if (/^ERROR:/i.test(line)) return { type: 'error', text: line };
  return null;
}

module.exports = { SEP, locateTools, runtimeSetup, classifyUrl, channelVideosUrl, videoOnlyUrl, listOnlyUrl, runJson, analyze, summarizeVideo, summarizePlaylist, buildDownloadArgs, parseLine };
