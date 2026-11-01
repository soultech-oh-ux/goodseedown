'use strict';
// 설정·다운로드 옵션의 기본값과 검증. 잘못된 값은 거부하지 않고 안전한 값으로 되돌린다(저장 파일이 손상돼도 앱이 켜지게).
const path = require('node:path');

const QUALITIES = ['best', '4320', '2160', '1440', '1080', '720', '480', '360', '240'];
const VIDEO_FORMATS = ['mp4', 'mkv'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'ogg'];
const KINDS = ['video', 'audio', 'subs'];
const SUB_MODES = ['srt', 'embed', 'both'];
const MP3_BITRATES = [128, 192, 256, 320];
const MODES = ['video', 'mp3'];
const LANG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,24}$/;

const pick = (v, list, def) => (list.includes(v) ? v : def);
const clampInt = (v, lo, hi, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const bool = (v, def) => (typeof v === 'boolean' ? v : def);

function normalizeSubs(s) {
  s = s && typeof s === 'object' ? s : {};
  const langs = [];
  for (const l of Array.isArray(s.langs) ? s.langs : []) {
    const t = typeof l === 'string' ? l.trim() : '';
    if (LANG_RE.test(t) && !langs.includes(t) && langs.length < 20) langs.push(t);
  }
  return { enabled: bool(s.enabled, false), langs, auto: bool(s.auto, false), mode: pick(s.mode, SUB_MODES, 'srt') };
}

// 작업 하나의 옵션(종류·화질·형식·자막). 저장 폴더는 호출한 쪽이 따로 채운다.
function normalizeOptions(o, base) {
  o = o && typeof o === 'object' ? o : {};
  const b = { kind: 'video', quality: '1080', videoFormat: 'mp4', audioFormat: 'mp3', mp3Bitrate: 320, id3: true, ...(base || {}) };
  return {
    kind: pick(o.kind ?? b.kind, KINDS, 'video'),
    quality: pick(String(o.quality ?? b.quality), QUALITIES, '1080'),
    videoFormat: pick(o.videoFormat ?? b.videoFormat, VIDEO_FORMATS, 'mp4'),
    audioFormat: pick(o.audioFormat ?? b.audioFormat, AUDIO_FORMATS, 'mp3'),
    mp3Bitrate: pick(Number(o.mp3Bitrate ?? b.mp3Bitrate), MP3_BITRATES, 320),
    id3: bool(o.id3, bool(b.id3, true)),
    subs: normalizeSubs(o.subs ?? b.subs),
  };
}

// MP3 화면 설정: 음질·ID3 태그·저장 폴더. 저장 폴더가 비어 있으면(기본) 음악 폴더 아래 goodseedown 을 쓴다.
function normalizeMp3(m, defaultMp3Dir) {
  m = m && typeof m === 'object' ? m : {};
  return {
    bitrate: pick(Number(m.bitrate), MP3_BITRATES, 320),
    id3: bool(m.id3, true),
    saveDir: typeof m.saveDir === 'string' && path.isAbsolute(m.saveDir) ? path.normalize(m.saveDir) : defaultMp3Dir,
  };
}

function defaultSettings(defaultSaveDir, defaultMp3Dir) {
  return {
    schema: 1,
    saveDir: defaultSaveDir,
    maxConcurrent: 3,
    smartMode: false,
    subscriptionIntervalMin: 60,
    engineAutoCheck: true,
    copyrightAcknowledged: false,
    playlistSubfolder: true,
    playlistNumberPrefix: false,
    lastMode: 'video',
    mp3: normalizeMp3({}, defaultMp3Dir || defaultSaveDir),
    defaults: normalizeOptions({}),
  };
}

function normalizeSettings(s, defaultSaveDir, defaultMp3Dir) {
  const d = defaultSettings(defaultSaveDir, defaultMp3Dir);
  s = s && typeof s === 'object' ? s : {};
  return {
    schema: 1,
    saveDir: typeof s.saveDir === 'string' && path.isAbsolute(s.saveDir) ? path.normalize(s.saveDir) : d.saveDir,
    maxConcurrent: clampInt(s.maxConcurrent, 1, 6, d.maxConcurrent),
    smartMode: bool(s.smartMode, d.smartMode),
    subscriptionIntervalMin: clampInt(s.subscriptionIntervalMin, 15, 1440, d.subscriptionIntervalMin),
    engineAutoCheck: bool(s.engineAutoCheck, d.engineAutoCheck),
    copyrightAcknowledged: bool(s.copyrightAcknowledged, d.copyrightAcknowledged),
    playlistSubfolder: bool(s.playlistSubfolder, d.playlistSubfolder),
    playlistNumberPrefix: bool(s.playlistNumberPrefix, d.playlistNumberPrefix),
    lastMode: pick(s.lastMode, MODES, d.lastMode),
    mp3: normalizeMp3(s.mp3, d.mp3.saveDir),
    defaults: normalizeOptions(s.defaults || {}, d.defaults),
  };
}

module.exports = { MP3_BITRATES, MODES, QUALITIES, VIDEO_FORMATS, AUDIO_FORMATS, KINDS, SUB_MODES, LANG_RE, normalizeOptions, normalizeSubs, defaultSettings, normalizeSettings };
