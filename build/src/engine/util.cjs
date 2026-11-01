'use strict';
// goodseedown 공용 도구 — Electron 없이 시험할 수 있는 순수 함수 위주.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_URL_LEN = 2048;

// http/https 주소만 허용한다(file:, javascript:, 옵션처럼 보이는 문자열 모두 거부). 통과하면 정규화된 주소 문자열을, 아니면 null.
function normalizeUrl(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length > MAX_URL_LEN || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  if (u.username || u.password) return null;
  return u.href;
}

// 글 속에서 http(s) 주소를 모두 찾아 정규화해 돌려준다(클립보드 감지용).
function extractUrls(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const n = normalizeUrl(m[0].replace(/[),.;]+$/, ''));
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// 폴더/파일 이름으로 쓸 수 있게 다듬는다(경로 구분자·예약어·끝의 점/공백 제거).
function sanitizeName(s, max = 80) {
  let t = String(s ?? '').normalize('NFC').replace(/[<>:"\/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').replace(/^\.+/, '');
  if (t.length > max) t = t.slice(0, max).trim().replace(/[. ]+$/g, '');
  if (!t || WIN_RESERVED.test(t)) t = '_' + t;
  return t || '_';
}

const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return fallback; } };
// 임시 파일에 쓴 뒤 이름을 바꿔 저장 도중 전원이 꺼져도 반쪽 파일이 남지 않게 한다.
function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, p);
}

// 프로세스와 그 자식(PyInstaller 단일 exe 는 자식 프로세스를 둔다)을 모두 종료한다.
function killTree(pid) {
  return new Promise(resolve => {
    if (!pid) return resolve(false);
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    try {
      const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k.on('error', () => { try { process.kill(pid); } catch { } fin(false); });
      k.on('close', c => fin(c === 0));
      setTimeout(() => fin(false), 8000).unref?.();
    } catch { try { process.kill(pid); } catch { } fin(false); }
  });
}

const rmQuiet = (...ps) => { for (const p of ps) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { } } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// yt-dlp 오류 문장을 사용자가 이해할 수 있는 한국어로 바꾼다. permanent=true 면 다시 시도해도 소용없는 오류.
function translateError(raw) {
  const t = String(raw || '');
  const rules = [
    [/drm|widevine|this video is drm protected|unplayable formats/i, 'DRM(복제 방지)으로 보호된 콘텐츠라서 내려받을 수 없습니다. goodseedown 은 DRM 보호를 우회하지 않습니다.', true],
    [/private video|video is private/i, '비공개 영상이라 내려받을 수 없습니다.', true],
    [/sign in to confirm your age|age[- ]restricted|confirm your age/i, '연령 제한 영상이라 로그인 없이는 내려받을 수 없습니다.', true],
    [/sign in to confirm you.?re not a bot|confirm you.?re not a bot/i, '사이트가 자동 접근 확인(로봇 확인)을 요구해 내려받지 못했습니다. 잠시 뒤 다시 시도하거나 yt-dlp 엔진을 업데이트해 보세요.', false],
    [/members[- ]only|join this channel|premium|requires payment|purchase/i, '멤버십·유료 영상이라 내려받을 수 없습니다.', true],
    [/not available in your country|geo.?restrict|blocked it in your country|uploader has not made this video available in your country/i, '지역 제한으로 이 지역에서는 볼 수 없는 영상입니다.', true],
    [/video unavailable|(this )?video is (not available|unavailable)|has been removed|no longer available|does not exist|video has been terminated|account associated with this video has been terminated/i, '삭제되었거나 볼 수 없는 영상입니다.', true],
    [/unsupported url/i, '지원하지 않는 주소입니다.', true],
    [/live event will begin|premieres in|this live event|is upcoming/i, '아직 시작하지 않은 라이브·프리미어 영상입니다.', false],
    [/requested format is not available|no video formats found|requested format\(s\) not available/i, '선택한 화질·형식을 이 영상에서 찾지 못했습니다. 다른 화질로 다시 시도해 보세요.', true],
    [/ffmpeg.*(not found|not installed)|ffprobe.*not found/i, 'ffmpeg 를 찾지 못했습니다. 프로그램을 다시 설치해 주세요.', true],
    [/no space left|disk full|not enough space|errno 28/i, '저장 공간이 부족합니다.', true],
    [/permission denied|access is denied|errno 13|winerror 5|winerror 32|액세스가 거부|being used by another process|다른 프로세스가 사용 중/i, '파일을 저장하지 못했습니다. 저장 폴더에 쓸 권한이 없거나, 백신 등 다른 프로그램이 파일을 잡고 있을 수 있어요.', false],
    [/http error 429|too many requests/i, '요청이 너무 많아 사이트가 잠시 차단했습니다. 잠시 뒤 다시 시도하세요.', false],
    [/http error 403|forbidden/i, '사이트가 접근을 거부했습니다(403). yt-dlp 엔진 업데이트가 필요할 수 있습니다.', false],
    [/unable to download|timed out|timeout|connection reset|connection aborted|temporary failure|getaddrinfo|network is unreachable|name or service not known|urlopen error|remote end closed|ssl/i, '네트워크 연결에 문제가 있어 내려받지 못했습니다.', false],
  ];
  for (const [re, msg, permanent] of rules) if (re.test(t)) return { message: msg, permanent };
  const line = t.split(/\r?\n/).reverse().find(l => /^ERROR:/i.test(l.trim())) || t.trim().split(/\r?\n/).pop() || '알 수 없는 오류';
  return { message: '내려받지 못했습니다: ' + line.replace(/^ERROR:\s*/i, '').slice(0, 300), permanent: false };
}

module.exports = { normalizeUrl, extractUrls, sanitizeName, readJson, writeJsonAtomic, killTree, rmQuiet, sleep, uid, translateError, MAX_URL_LEN };
