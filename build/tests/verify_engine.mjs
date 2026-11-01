// goodseedown 엔진 실측 시험 — 실제 yt-dlp·ffmpeg 로 공개 라이선스 영상(Blender Open Movie 등, YouTube 의 Creative Commons 표기 영상)을 내려받아
// ffprobe 로 해상도·길이·코덱·자막 트랙을 확인한다. 사용: node tests/verify_engine.mjs [--only E1,E2] [--label x]
// 시험 대상 영상은 모두 Blender Foundation/Studio 의 공개(CC-BY) 영상이다. 결과는 verification_engine[-label].json 에 남는다.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { createFakeEngineServer } from '../fake-engine-server.mjs';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)); const B = path.resolve(here, '..');
const { createEngine } = require('../src/engine/index.cjs');
const { EngineManager } = require('../src/engine/engine-update.cjs');
const { DownloadManager } = require('../src/engine/manager.cjs');
const { normalizeSettings } = require('../src/engine/settings.cjs');
const U = require('../src/engine/util.cjs');
const Y = require('../src/engine/ytdlp.cjs');
const { SubscriptionManager } = require('../src/engine/subscriptions.cjs');

const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const only = arg('--only', ''); const label = arg('--label', '');
const want = n => !only || only.split(',').includes(n);
const FFPROBE = path.join(B, 'tools', 'ffprobe-test', 'ffprobe.exe');
const TOOLS = path.join(B, 'bundle', 'resources', 'tools');
const WORK = path.join(B, 'work', 've'); fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); };
const until = async (fn, ms = 120000, step = 400) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };

// 공개 라이선스 시험 영상(모두 Blender Foundation / Blender Studio 공식 채널)
const V = {
  caminandes3: 'https://www.youtube.com/watch?v=SkVqJ1SGeL0',   // Caminandes 3: Llamigos — 150초, YouTube 라이선스 표기: Creative Commons Attribution
  spring: 'https://www.youtube.com/watch?v=WhWc3b3KhnY',        // Spring — 464초, 자막(en)
  sintel: 'https://www.youtube.com/watch?v=eRsGyueVLvQ',        // Sintel — 888초, 자막 29개 언어
  bbb4k: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',         // Big Buck Bunny 60fps 4K — 4K 화질 시험(구간만)
  dweebs8k: 'https://www.youtube.com/watch?v=apiu3pTIwuY',      // The Daily Dweebs 8K UHD — 8K 화질 시험(구간만)
  playlist: 'https://www.youtube.com/playlist?list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz', // Blender Open Movies (공식)
};
const PLAYLIST_PICK = [7, 11, 12]; // Coffee Run(185s) · Caminandes 3(151s) · Glass Half(194s)

function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  const j = JSON.parse(r.stdout);
  const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio'), subs = j.streams.filter(s => s.codec_type === 'subtitle');
  return { format: j.format.format_name, duration: Number(j.format.duration), size: Number(j.format.size), width: v && v.width, height: v && v.height, vcodec: v && v.codec_name, acodec: a && a.codec_name, subs: subs.map(s => ({ codec: s.codec_name, lang: s.tags && s.tags.language })), streams: j.streams.length };
}
function newEngine(name, { settings = {}, extra = [], autoRetryDelayMs = 300, lister } = {}) {
  const dir = path.join(WORK, name); fs.mkdirSync(dir, { recursive: true });
  const eng = createEngine({ dataDir: path.join(dir, 'data'), toolsDir: TOOLS, defaultSaveDir: path.join(dir, 'out'), testExtraArgs: extra, autoRetryDelayMs, lister });
  if (Object.keys(settings).length) eng.setSettings(settings);
  return { eng, dir, out: path.join(dir, 'out') };
}
// 끝난 상태: 완료·취소, 또는 '다시 시도해도 소용없는 실패'/'자동 재시도(최대 2회)를 다 쓴 실패'
const isFinal = j => j && (j.status === 'completed' || j.status === 'canceled' || (j.status === 'failed' && (j.errorPermanent || j.autoRetries >= 2)));
const waitJob = (eng, id, ok = null, ms = 300000) => until(() => { const j = eng.downloads.get(id); return j && (ok ? ok.includes(j.status) : isFinal(j)) ? j : null; }, ms, 300);
const files = dir => { const out = []; const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(p); } }; walk(dir); return out; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ===================== U. 순수 함수 단위 시험 =====================
if (want('U')) {
  check('U1 normalizeUrl: http(s) 허용', U.normalizeUrl('https://www.youtube.com/watch?v=abc') === 'https://www.youtube.com/watch?v=abc' && !!U.normalizeUrl('http://example.com/a?b=1'));
  const bad = ['file:///c:/windows/win.ini', 'javascript:alert(1)', '--version', '-o x', 'ftp://a.b/c', 'http://a b.com', '', null, undefined, 'https://user:pw@a.com/x', 'http://nodot', 'x'.repeat(3000), 'https://a.com/' + 'x'.repeat(2100)];
  check('U2 normalizeUrl: 위험·잘못된 입력 전부 거부', bad.every(x => U.normalizeUrl(x) === null), bad.map(x => String(x).slice(0, 20)));
  check('U3 extractUrls: 글 속 링크 추출·중복 제거·끝 문장부호 제거', JSON.stringify(U.extractUrls('보세요 https://youtu.be/abc123. 그리고 (https://www.youtube.com/watch?v=x1), https://youtu.be/abc123')) === JSON.stringify(['https://youtu.be/abc123', 'https://www.youtube.com/watch?v=x1']), U.extractUrls('보세요 https://youtu.be/abc123. 그리고 (https://www.youtube.com/watch?v=x1), https://youtu.be/abc123'));
  check('U4 sanitizeName: 경로 구분자·예약어·끝 점 처리', U.sanitizeName('a/b\\c:d*e?') === 'a_b_c_d_e_' && U.sanitizeName('CON') === '_CON' && U.sanitizeName('..x..') === 'x' && U.sanitizeName('') === '_' && U.sanitizeName('x'.repeat(200)).length <= 80 && !/[\/]/.test(U.sanitizeName(String.raw`..\..\evil/../x`)), [U.sanitizeName('a/b\\c:d*e?'), U.sanitizeName('CON'), U.sanitizeName('..x..')]);
  const tr = U.translateError;
  check('U5 오류 번역: DRM·비공개·삭제·지역제한은 permanent, 네트워크·429·403 은 재시도 가능', tr('ERROR: This video is DRM protected').permanent && tr('ERROR: Private video').permanent && tr('ERROR: Video unavailable').permanent && tr('ERROR: not available in your country').permanent && !tr('ERROR: unable to download: timed out').permanent && !tr('HTTP Error 429').permanent && !tr('HTTP Error 403: Forbidden').permanent, [tr('ERROR: This video is DRM protected').message]);
  check('U6 DRM 오류 문구에 "우회하지 않습니다" 명시', /DRM/.test(tr('ERROR: [youtube] x: This video is DRM protected').message) && /우회하지 않습니다/.test(tr('This video is DRM protected').message));
  const cls = u => Y.classifyUrl(u).kind || Y.classifyUrl(u).site;
  check('U7 주소 분류: 영상·재생목록·채널·영상+목록·다른 사이트', cls('https://www.youtube.com/watch?v=a') === 'video' && cls('https://www.youtube.com/playlist?list=PL1') === 'playlist' && cls('https://www.youtube.com/@Blender') === 'channel' && cls('https://www.youtube.com/watch?v=a&list=PL1') === 'choice' && cls('https://youtu.be/abc') === 'video' && cls('https://vimeo.com/123') === 'other', [cls('https://www.youtube.com/@Blender')]);
  check('U8 채널 첫 화면 주소에 /videos 붙임, 영상 주소에서 list 제거', Y.channelVideosUrl('https://www.youtube.com/@Blender') === 'https://www.youtube.com/@Blender/videos' && Y.videoOnlyUrl('https://www.youtube.com/watch?v=a&list=PL1&index=3') === 'https://www.youtube.com/watch?v=a');
  const S = require('../src/engine/settings.cjs');
  const ns = S.normalizeSettings({ maxConcurrent: 99, saveDir: 'relative\\x', subscriptionIntervalMin: 1, defaults: { kind: 'zzz', quality: '9999', videoFormat: 'avi', subs: { langs: ['ko', '--exec calc', 'en', 'ko', 'a;b', '../x'], mode: 'x' } } }, 'C:\\def');
  check('U9 설정 정규화: 범위 밖·잘못된 값은 안전한 기본값, 자막 언어 코드에서 옵션 주입 차단', ns.maxConcurrent === 6 && ns.saveDir === 'C:\\def' && ns.subscriptionIntervalMin === 15 && ns.defaults.kind === 'video' && ns.defaults.quality === '1080' && ns.defaults.videoFormat === 'mp4' && JSON.stringify(ns.defaults.subs.langs) === '["ko","en"]' && ns.defaults.subs.mode === 'srt', ns.defaults);
  const mk = (o) => Y.buildDownloadArgs({ url: 'https://x.com/a', options: S.normalizeOptions(o), outDir: 'C:\\o', tempDir: 'C:\\o\\t', nameTemplate: 'n.%(ext)s' }, { ffmpegDir: 'C:\\f' });
  const a1 = mk({ kind: 'video', quality: '1080', videoFormat: 'mp4' }), a2 = mk({ kind: 'audio', audioFormat: 'ogg' }), a3 = mk({ kind: 'video', quality: '2160', videoFormat: 'mkv', subs: { enabled: true, langs: ['ko', 'en'], mode: 'both', auto: true } }), a4 = mk({ kind: 'subs', subs: { enabled: true, langs: ['ko'] } });
  const has = (a, ...x) => x.every(v => a.includes(v));
  check('U10 인자 조립: 1080p MP4 는 res:1080·h264 우선·mp4 병합, 주소는 -- 뒤 마지막', has(a1, '-S', 'res:1080,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4') && a1.at(-2) === '--' && a1.at(-1) === 'https://x.com/a', a1.slice(-12));
  check('U11 인자 조립: 음성 OGG 는 -x vorbis', has(a2, '-x', '--audio-format', 'vorbis'));
  check('U12 인자 조립: 4K MKV + 자막(한·영, 자동 포함, 합침+SRT 유지: --write-subs 와 --embed-subs 함께)', has(a3, 'res:2160', '--merge-output-format', 'mkv', '--write-subs', '--sub-langs', 'ko,en', '--write-auto-subs', '--convert-subs', 'srt', '--embed-subs') && !a3.includes('-k'));
  check('U13 인자 조립: 자막만은 --skip-download, 합침 옵션 없음', has(a4, '--skip-download', '--write-subs') && !a4.includes('--embed-subs'));
  check('U14 진행 줄 해석', (() => { const p = Y.parseLine(['GSP', 'downloading', '100', '1000', 'NA', '2048.5', '3', '137', 'avc1.640028'].join(Y.SEP)); return p.type === 'progress' && p.downloaded === 100 && p.total === 1000 && p.estimate === null && p.speed === 2048.5 && p.vcodec === 'avc1.640028'; })());
}

// ===================== E1~E6. 단일 영상 — 화질·형식 =====================
if (want('E1')) {
  const { eng, out } = newEngine('e1');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '1080', videoFormat: 'mp4' } });
  const j = await waitJob(eng, r.added[0].id); const f = j && j.files[0]; const p = f && probe(f);
  check('E1 단일 영상 1080p MP4: 완료', j && j.status === 'completed', j && { status: j.status, error: j.error });
  check('E1 ffprobe: 높이 1080·폭 1920·H.264·AAC·mp4 컨테이너·길이 150초±2', p && p.height === 1080 && p.width === 1920 && p.vcodec === 'h264' && p.acodec === 'aac' && /mp4/.test(p.format) && Math.abs(p.duration - 150) < 2, p);
  check('E1 제목·진행률 기록(영상 제목이 작업에 채워짐)', j && /Caminandes 3/.test(j.title) && j.progress.percent === 100, j && j.title);
  check('E1 임시 폴더 정리(.goodseedown-tmp 비어 있거나 없음)', !fs.existsSync(path.join(out, '.goodseedown-tmp')), files(out).map(x => path.relative(out, x)));
  await eng.shutdown();
}
if (want('E2')) {
  const { eng } = newEngine('e2');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'audio', audioFormat: 'mp3' } });
  const j = await waitJob(eng, r.added[0].id); const p = j && j.files[0] && probe(j.files[0]);
  check('E2 MP3 추출: 완료·.mp3', j && j.status === 'completed' && /\.mp3$/i.test(j.files[0]), j && { s: j.status, f: j.files, e: j.error });
  check('E2 ffprobe: mp3 코덱·영상 스트림 없음(1.1.0 부터 ID3 기본 켬이라 앨범아트 그림 1장(mjpeg)만 허용)·길이 150초±2', p && p.acodec === 'mp3' && (!p.vcodec || (p.vcodec === 'mjpeg' && p.streams === 2)) && Math.abs(p.duration - 150) < 2, p);
  await eng.shutdown();
}
if (want('E3')) {
  const { eng } = newEngine('e3');
  const a = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'audio', audioFormat: 'm4a' } }).added[0];
  const o = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'audio', audioFormat: 'ogg' } }).added[0];
  const ja = await waitJob(eng, a.id), jo = await waitJob(eng, o.id);
  const pa = ja && ja.files[0] && probe(ja.files[0]), po = jo && jo.files[0] && probe(jo.files[0]);
  check('E3 M4A 추출: aac·영상 없음', pa && ja.status === 'completed' && /\.m4a$/i.test(ja.files[0]) && pa.acodec === 'aac' && !pa.vcodec && Math.abs(pa.duration - 150) < 2, { f: ja && ja.files, pa, e: ja && ja.error });
  check('E3 OGG 추출: vorbis·.ogg', po && jo.status === 'completed' && /\.ogg$/i.test(jo.files[0]) && po.acodec === 'vorbis' && !po.vcodec && Math.abs(po.duration - 150) < 2, { f: jo && jo.files, po, e: jo && jo.error });
  await eng.shutdown();
}
if (want('E4')) {
  const { eng } = newEngine('e4');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '720', videoFormat: 'mkv' } });
  const j = await waitJob(eng, r.added[0].id); const p = j && j.files[0] && probe(j.files[0]);
  check('E4 720p MKV: matroska·높이 720·.mkv', p && j.status === 'completed' && /\.mkv$/i.test(j.files[0]) && /matroska/.test(p.format) && p.height === 720 && Math.abs(p.duration - 150) < 2, { p, e: j && j.error });
  await eng.shutdown();
}
// 4K·8K: 영상 전체를 받지 않고 앞 8초 구간만 받아 화질(해상도)만 확인한다(--download-sections 는 시험 전용 추가 인자).
if (want('E5')) {
  const { eng } = newEngine('e5', { extra: ['--download-sections', '*0-8'] });
  const r = eng.addDownloads({ items: [{ url: V.bbb4k }], options: { kind: 'video', quality: '2160', videoFormat: 'mp4' } });
  const j = await waitJob(eng, r.added[0].id, undefined, 400000); const p = j && j.files[0] && probe(j.files[0]);
  check('E5 4K(2160p) MP4 — 앞 8초 구간', p && j.status === 'completed' && p.height === 2160 && p.width === 3840 && p.duration > 6 && p.duration < 12, { p, e: j && j.error });
  await eng.shutdown();
}
if (want('E6')) {
  const { eng } = newEngine('e6', { extra: ['--download-sections', '*0-6'] });
  const r = eng.addDownloads({ items: [{ url: V.dweebs8k }], options: { kind: 'video', quality: 'best', videoFormat: 'mkv' } });
  const j = await waitJob(eng, r.added[0].id, undefined, 500000); const p = j && j.files[0] && probe(j.files[0]);
  check('E6 8K 영상 "최대 화질" — 앞 6초 구간(높이 4320 이상)', p && j.status === 'completed' && p.height >= 4320, { p, e: j && j.error });
  await eng.shutdown();
}

// ===================== E7. 재생목록 일괄 =====================
if (want('E7')) {
  const { eng, out } = newEngine('e7');
  const a = await eng.analyze(V.playlist, { mode: 'auto', end: 500 });
  check('E7 재생목록 분석(실제 yt-dlp): 제목·18개 항목', a.type === 'playlist' && a.title === 'Blender Open Movies' && a.entries.length >= 18, { title: a.title, n: a.entries.length, count: a.count });
  const pick = a.entries.filter(e => PLAYLIST_PICK.includes(e.index));
  const res = eng.addDownloads({ items: pick.map(e => ({ url: e.url, title: e.title, duration: e.duration, index: e.index })), options: { kind: 'video', quality: '720', videoFormat: 'mp4' }, subfolder: a.title, indexPrefix: true, source: { type: 'playlist', id: a.id, title: a.title } });
  check('E7 3개 선택 추가', res.added.length === 3, res.added.map(x => x.title));
  const done = await Promise.all(res.added.map(x => waitJob(eng, x.id, undefined, 400000)));
  const sub = path.join(out, 'Blender Open Movies');
  check('E7 3개 모두 완료·하위 폴더(재생목록 이름)에 저장', done.every(j => j && j.status === 'completed') && fs.existsSync(sub) && fs.readdirSync(sub).filter(f => /\.mp4$/.test(f)).length === 3, done.map(j => j && [j.status, j.error]));
  check('E7 파일 이름 앞에 번호(007 - …, 011 - …, 012 - …)', ['007 - ', '011 - ', '012 - '].every(pf => fs.readdirSync(sub).some(f => f.startsWith(pf))), fs.readdirSync(sub));
  const probes = done.map(j => probe(j.files[0]));
  const expect = { 7: 185, 11: 151, 12: 194 };
  check('E7 ffprobe: 3개 모두 720p급(1280x720 또는 와이드 영상의 1280폭)·길이가 목록 정보와 일치(±3초)', probes.every((p, i) => (p.height === 720 || p.width === 1280) && Math.abs(p.duration - pick[i].duration) < 3), probes.map((p, i) => [p.height, Math.round(p.duration), pick[i].duration]));
  await eng.shutdown();
}

// ===================== E8~E9. 자막 =====================
let sintelLangs = null;
if (want('E8')) {
  const { eng, out } = newEngine('e8');
  const info = await eng.analyze(V.sintel, { mode: 'video' });
  sintelLangs = info.subs.map(s => s.code);
  check('E8 자막 목록 조회: Sintel 수동 자막 20개 이상·en 포함', info.type === 'video' && info.subs.length >= 20 && info.subs.some(s => s.code === 'en'), { n: info.subs.length, sample: info.subs.slice(0, 6) });
  const langs = ['en', info.subs.find(s => /^fr/.test(s.code)).code, info.subs.find(s => /^de/.test(s.code)).code];
  const r = eng.addDownloads({ items: [{ url: V.sintel }], options: { kind: 'subs', subs: { enabled: true, langs, mode: 'srt', auto: false } } });
  const j = await waitJob(eng, r.added[0].id);
  const srts = j && j.files || [];
  const parse = f => { const t = fs.readFileSync(f, 'utf8'); const blocks = t.trim().split(/\r?\n\r?\n/); return { n: blocks.length, okTs: /^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}/.test(blocks[0]), bytes: t.length }; };
  check('E8 자막만 받기(SRT): 3개 언어 파일 생성', j && j.status === 'completed' && srts.length === 3 && srts.every(f => /\.srt$/i.test(f)), { s: j && j.status, e: j && j.error, files: srts.map(f => path.basename(f)) });
  check('E8 SRT 형식 확인(번호·시간표 -->·자막 20개 이상·세 언어의 자막 개수가 같음)', srts.length > 0 && srts.every(f => { const p = parse(f); return p.okTs && p.n >= 20; }) && new Set(srts.map(f => parse(f).n)).size === 1, srts.map(f => parse(f)));
  check('E8 영상 파일은 받지 않음(자막만)', !files(out).some(f => /\.(mp4|mkv|webm|m4a)$/i.test(f)), files(out).map(f => path.basename(f)));
  // 요청한 언어가 영상에 없으면 실패가 아니라 명확한 메시지로 실패(자막만 모드)
  const r2 = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'subs', subs: { enabled: true, langs: ['xx-nonexistent'], mode: 'srt', auto: false } } });
  const j2 = await waitJob(eng, r2.added[0].id);
  check('E8 없는 언어만 요청 → 실패하고 이유를 알려 줌', j2 && j2.status === 'failed' && /자막이 이 영상에 없습니다/.test(j2.error), j2 && j2.error);
  await eng.shutdown();
}
if (want('E9')) {
  // 영상에 합치기(소프트 자막): 앞 60초 구간만 받아 시간을 줄이고, ffprobe 로 자막 트랙을 확인한다.
  const a = newEngine('e9a', { extra: ['--download-sections', '*0-60'] });
  const r1 = a.eng.addDownloads({ items: [{ url: V.spring }], options: { kind: 'video', quality: '360', videoFormat: 'mp4', subs: { enabled: true, langs: ['en'], mode: 'embed' } } });
  const j1 = await waitJob(a.eng, r1.added[0].id, undefined, 400000); const p1 = j1 && j1.files[0] && probe(j1.files[0]);
  check('E9 MP4 에 자막 합침(embed): 자막 트랙 1개(mov_text·언어 eng)', p1 && j1.status === 'completed' && p1.subs.length === 1 && p1.subs[0].codec === 'mov_text' && p1.subs[0].lang === 'eng', { p1, e: j1 && j1.error });
  check('E9 합침 모드에서는 별도 SRT 파일이 남지 않음', !files(a.out).some(f => /\.srt$/i.test(f)), files(a.out).map(f => path.basename(f)));
  await a.eng.shutdown();
  const b = newEngine('e9b', { extra: ['--download-sections', '*0-60'] });
  const r2 = b.eng.addDownloads({ items: [{ url: V.spring }], options: { kind: 'video', quality: '360', videoFormat: 'mkv', subs: { enabled: true, langs: ['en'], mode: 'both' } } });
  const j2 = await waitJob(b.eng, r2.added[0].id, undefined, 400000); const p2 = j2 && j2.files[0] && probe(j2.files[0]);
  check('E9 MKV 합침+SRT 유지(both): 자막 트랙(subrip·eng)과 .srt 파일 둘 다 존재', p2 && j2.status === 'completed' && p2.subs.length === 1 && p2.subs[0].codec === 'subrip' && p2.subs[0].lang === 'eng' && files(b.out).some(f => /\.en\.srt$/i.test(f)), { p2, files: files(b.out).map(f => path.basename(f)), e: j2 && j2.error });
  const c = newEngine('e9c', { extra: ['--download-sections', '*0-30'] });
  const r3 = c.eng.addDownloads({ items: [{ url: V.spring }], options: { kind: 'video', quality: '360', videoFormat: 'mp4', subs: { enabled: true, langs: ['en'], mode: 'srt' } } });
  const j3 = await waitJob(c.eng, r3.added[0].id, undefined, 400000); const p3 = j3 && j3.files[0] && probe(j3.files[0]);
  check('E9 SRT 별도 저장(srt 모드): 영상에는 자막 트랙 없음, .srt 파일 있음', p3 && j3.status === 'completed' && p3.subs.length === 0 && files(c.out).some(f => /\.en\.srt$/i.test(f)) && j3.subFiles.length === 1, { p3, files: files(c.out).map(f => path.basename(f)), sub: j3 && j3.subFiles });
  const d = newEngine('e9d', { extra: ['--download-sections', '*0-20'] });
  const r4 = d.eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '360', videoFormat: 'mp4', subs: { enabled: true, langs: ['xx-nonexistent'], mode: 'srt' } } });
  const j4 = await waitJob(d.eng, r4.added[0].id, undefined, 400000);
  check('E9 요청한 자막이 없으면 영상은 저장하고 안내 문구를 남김', j4 && j4.status === 'completed' && /자막을 찾지 못해/.test(j4.note), j4 && { s: j4.status, note: j4.note });
  for (const x of [b, c, d]) await x.eng.shutdown();
}

// ===================== E10~E14. 제어: 일시정지·재개·취소·재시도·동시 수 =====================
if (want('E10')) {
  const { eng, out } = newEngine('e10', { extra: ['--limit-rate', '2M'] });
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '1080', videoFormat: 'mp4' } });
  const id = r.added[0].id;
  await until(() => { const j = eng.downloads.get(id); return j.progress.percent > 15 ? j : null; }, 60000, 200);
  const before = eng.downloads.get(id).progress;
  await eng.downloads.pause(id);
  const jp = eng.downloads.get(id); const part = files(path.join(out, '.goodseedown-tmp')).filter(f => /\.part$/.test(f));
  check('E10 일시정지: 상태 paused·.part 파일 보존·진행 중이던 바이트 기록', jp.status === 'paused' && part.length >= 1 && part[0] && fs.statSync(part[0]).size > 1000000, { status: jp.status, percent: Math.round(before.percent), partBytes: part[0] && fs.statSync(part[0]).size });
  const stillAlive = (() => { const r2 = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | ? { $_.Name -like 'yt-dlp*' -and $_.CommandLine -like '*${id}*' }).Count`], { encoding: 'utf8' }); return Number(r2.stdout.trim()); })();
  check('E10 일시정지 후 yt-dlp 프로세스가 남아 있지 않음', stillAlive === 0, stillAlive);
  const s1 = fs.statSync(part[0]).size; await sleep(2500); const s2 = fs.statSync(part[0]).size;
  check('E10 일시정지 중에는 진행이 멈춤(2.5초 뒤에도 같은 바이트)', s1 === s2 && eng.downloads.get(id).status === 'paused', { s1, s2 });
  const sizeBefore = s2;
  eng.downloads.resume(id);
  const j = await waitJob(eng, id, undefined, 300000);
  check('E10 이어받기: 처음부터가 아니라 중단한 지점부터 이어서 받음(yt-dlp "Resuming download at byte")', j && j.status === 'completed' && j.resumeCount >= 1 && j.lastResumeByte >= sizeBefore - 1 && j.lastResumeByte > 1000000, { resumeCount: j && j.resumeCount, resumedAt: j && j.lastResumeByte, partBeforeResume: sizeBefore });
  const p = j && j.files[0] && probe(j.files[0]);
  check('E10 이어받은 파일이 온전함(ffprobe 1080p·150초)', p && p.height === 1080 && Math.abs(p.duration - 150) < 2, p);
  await eng.shutdown();
}
if (want('E11')) {
  const { eng, out } = newEngine('e11', { extra: ['--limit-rate', '2M'] });
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '1080', videoFormat: 'mp4' } });
  const id = r.added[0].id;
  await until(() => { const j = eng.downloads.get(id); return j.progress.percent > 15 ? j : null; }, 60000, 200);
  await eng.downloads.cancel(id);
  const j = eng.downloads.get(id);
  check('E11 취소: 상태 canceled·임시 파일 삭제·결과 파일 없음', j.status === 'canceled' && files(out).length === 0, { status: j.status, left: files(out) });
  eng.downloads.testExtraArgs = [];
  check('E11 취소된 작업 다시 시작(retry)', eng.downloads.retry(id) === true);
  const j2 = await waitJob(eng, id, undefined, 300000);
  check('E11 다시 시작해 처음부터 완료', j2 && j2.status === 'completed' && j2.files.length === 1 && j2.resumeCount === 0, j2 && { s: j2.status, f: j2.files.length });
  await eng.shutdown();
}
if (want('E12')) {
  const { eng } = newEngine('e12');
  const r = eng.addDownloads({ items: [{ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }], options: { kind: 'video', quality: '720' } });
  const j = await waitJob(eng, r.added[0].id, ['failed', 'completed']);
  check('E12 없는 영상 → 실패·한국어 이유·재시도 불가(permanent) 판정·자동 재시도 안 함', j && j.status === 'failed' && j.errorPermanent === true && /영상|삭제|볼 수 없/.test(j.error) && j.attempts === 1, j && { e: j.error, a: j.attempts, raw: (j.errorRaw || '').slice(-120) });
  const r2 = eng.addDownloads({ items: [{ url: 'https://example.com/' }], options: { kind: 'video', quality: '720' } });
  const j2 = await waitJob(eng, r2.added[0].id, ['failed', 'completed']);
  check('E12 지원하지 않는 주소 → 실패·"지원하지 않는 주소"', j2 && j2.status === 'failed' && /지원하지 않는 주소/.test(j2.error), j2 && j2.error);
  check('E12 수동 재시도(retry) 호출 가능', eng.downloads.retry(j.id) === true);
  const j3 = await waitJob(eng, j.id, ['failed', 'completed']);
  check('E12 재시도해도 같은 이유로 다시 실패(무한 반복 없음)', j3.status === 'failed' && j3.attempts === 2, { a: j3.attempts });
  await eng.shutdown();
}
if (want('E13')) {
  // 일시적 오류(네트워크 불통: 잘못된 프록시)는 자동 재시도(최대 2회) 후 실패로 남고, 원인을 없앤 뒤 [다시 시도]하면 성공한다.
  const { eng } = newEngine('e13', { extra: ['--proxy', 'http://127.0.0.1:9', '--socket-timeout', '3', '--extractor-retries', '0'] });
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'audio', audioFormat: 'mp3' } });
  const id = r.added[0].id;
  await until(() => { const x = eng.downloads.get(id); return x.status === 'failed' && x.autoRetries >= 2 && x.attempts >= 3; }, 120000, 500);
  await sleep(1500);
  const jf = eng.downloads.get(id);
  check('E13 네트워크 오류: 한국어 안내·재시도 가능(permanent 아님)·자동 재시도 2회 후 실패', jf.status === 'failed' && jf.errorPermanent === false && /네트워크|연결|내려받지 못했습니다/.test(jf.error) && jf.autoRetries === 2 && jf.attempts === 3, { s: jf.status, e: jf.error, auto: jf.autoRetries, attempts: jf.attempts });
  eng.downloads.testExtraArgs = [];
  eng.downloads.retry(id);
  const j2 = await waitJob(eng, id, undefined, 200000);
  check('E13 원인 해소 후 [다시 시도] → 성공(MP3)', j2 && j2.status === 'completed' && /\.mp3$/i.test(j2.files[0]), j2 && { s: j2.status, e: j2.error });
  await eng.shutdown();
}
if (want('E14')) {
  // 동시 다운로드 수 제한: 4개를 넣고 동시 실행 수 최대 2 를 넘지 않는지 샘플링
  const { eng } = newEngine('e14', { settings: { maxConcurrent: 2 }, extra: ['--limit-rate', '300K', '--download-sections', '*0-20'] });
  const urls = [V.caminandes3, V.spring, V.sintel, V.bbb4k];
  const r = eng.addDownloads({ items: urls.map(url => ({ url })), options: { kind: 'audio', audioFormat: 'mp3' } });
  let max = 0; const t = setInterval(() => { max = Math.max(max, eng.downloads.activeCount()); }, 150);
  await until(() => eng.downloads.activeCount() >= 2, 40000, 100);
  const duplicate = eng.addDownloads({ items: [{ url: urls[0] }], options: { kind: 'audio', audioFormat: 'mp3' } });
  check('E14 같은 주소를 같은 종류로 중복 추가하면 건너뜀', duplicate.added.length === 0 && duplicate.skipped.length === 1, duplicate.skipped);
  check('E14 동시 실행 2개까지 올라감', eng.downloads.activeCount() === 2 || max === 2, max);
  const all = await Promise.all(r.added.map(x => waitJob(eng, x.id, undefined, 600000)));
  clearInterval(t);
  check('E14 동시 실행 수가 설정(2)을 넘은 적 없음', max <= 2 && max >= 2, { max });
  check('E14 4개 모두 완료', all.every(j => j && j.status === 'completed'), all.map(j => j && [j.status, j.error]));
  eng.setSettings({ maxConcurrent: 99 }); check('E14 동시 수 설정 상한 6 으로 보정', eng.getSettings().maxConcurrent === 6);
  await eng.shutdown();
}
if (want('E15')) {
  // 앱 종료·재시작 복구: 받는 도중 종료 → 일시정지로 저장 → 새 관리자(=앱 재시작)가 목록을 읽고 이어받기
  const a = newEngine('e15', { extra: ['--limit-rate', '2M'] });
  const r = a.eng.addDownloads({ items: [{ url: V.caminandes3 }], options: { kind: 'video', quality: '1080', videoFormat: 'mp4' } });
  const id = r.added[0].id;
  await until(() => a.eng.downloads.get(id).progress.percent > 12, 60000, 200);
  await a.eng.shutdown();
  const saved = JSON.parse(fs.readFileSync(path.join(a.dir, 'data', 'jobs.json'), 'utf8')).jobs[0];
  check('E15 종료 시 진행 중 작업이 일시정지로 저장됨', saved.status === 'paused' && /이어받기/.test(saved.note), { status: saved.status, note: saved.note });
  const b = createEngine({ dataDir: path.join(a.dir, 'data'), toolsDir: TOOLS, defaultSaveDir: a.out, testExtraArgs: [] });
  const jb = b.downloads.get(id);
  check('E15 재시작 후 목록 복원(일시정지·제목 유지)', jb && jb.status === 'paused' && /Caminandes/.test(jb.title), jb && [jb.status, jb.title]);
  b.downloads.resume(id);
  const j = await waitJob(b, id, undefined, 300000);
  check('E15 재시작 후 이어받기 완료(재개 지점 > 0)', j && j.status === 'completed' && j.resumeCount >= 1 && j.lastResumeByte > 500000, j && { s: j.status, at: j.lastResumeByte });
  await b.shutdown();
  // 손상된 jobs.json 이어도 시작은 된다
  fs.writeFileSync(path.join(a.dir, 'data', 'jobs.json'), '{ 깨진 json');
  fs.writeFileSync(path.join(a.dir, 'data', 'settings.json'), '[1,2,3]');
  const c = createEngine({ dataDir: path.join(a.dir, 'data'), toolsDir: TOOLS, defaultSaveDir: a.out });
  check('E15 손상된 jobs.json·settings.json 이어도 앱 시작(빈 목록·기본 설정)', c.downloads.list().length === 0 && c.getSettings().maxConcurrent === 3, c.getSettings().maxConcurrent);
  await c.shutdown();
}

// ===================== E16. 구독 =====================
if (want('E16')) {
  // (a) 모의 피드: 실제 영상 주소를 가진 가짜 목록. 새 영상 감지·중복 방지·최대치·주기 확인·끄기
  const feed = { title: '모의 채널', entries: [] };
  const mk = (id, url) => ({ id, title: '영상 ' + id, url, duration: 150, unavailable: false });
  feed.entries = [mk('c', V.caminandes3), mk('b', V.spring), mk('a', V.sintel)]; // 최신순
  let listCalls = 0;
  const { eng, out } = newEngine('e16', { settings: { subscriptionIntervalMin: 15 }, lister: async (url, { end }) => { listCalls++; if (feed.fail) throw Object.assign(new Error('x'), { raw: 'ERROR: unable to download webpage: timed out' }); return { title: feed.title, entries: feed.entries.slice(0, end) }; } });
  let addCalls = 0; { const orig = eng.downloads.addJobs.bind(eng.downloads); eng.downloads.addJobs = (...a) => { addCalls++; return orig(...a); }; } // 다운로드 요청(대기열 추가) 횟수를 센다
  const sub = await eng.subscriptions.add({ url: 'https://www.youtube.com/@mockchannel', options: { kind: 'audio', audioFormat: 'mp3' }, backfill: 5 /* 1.1.0 부터 무시됨 — 지금 있는 영상을 받지 않는다 */ });
  check('E16 구독 추가(처음에는 이미 있는 영상 3개를 "본 영상"으로만 기록, 받지 않음 — backfill 을 줘도 무시)', sub.knownCount === 3 && eng.downloads.list().length === 0 && addCalls === 0, { known: sub.knownCount, jobs: eng.downloads.list().length, addCalls });
  const r0 = await eng.subscriptions.check(sub.id);
  check('E16 변화 없으면 새 영상 0개·작업 없음', r0.newCount === 0 && eng.downloads.list().length === 0, r0);
  eng.downloads.testExtraArgs = ['--download-sections', '*0-15'];
  feed.entries.unshift(mk('d', V.caminandes3.replace('SkVqJ1SGeL0', 'JOhiWY7XmoY') /* 사용할 수 없는 영상: 오류 처리도 같이 확인 */));
  feed.entries[0].url = V.spring + '&x=1';
  const r1 = await eng.subscriptions.check(sub.id);
  const jobs1 = eng.downloads.list();
  const pv1 = eng.subscriptions.list()[0];
  check('E16 ★새 영상 1개 감지 → 다운로드 요청 0건·작업 0개(알림 목록에만 기록)', r1.newCount === 1 && r1.queued === 0 && jobs1.length === 0 && addCalls === 0 && pv1.pendingCount === 1 && pv1.pending[0].url === feed.entries[0].url, { r1, addCalls, jobs: jobs1.length, pending: pv1.pending });
  await sleep(2500);
  check('E16 ★감지 후 몇 초가 지나도 yt-dlp 가 실행되지 않음(작업·대기열 0)', eng.downloads.list().length === 0 && addCalls === 0 && !eng.downloads.isBusy(), { jobs: eng.downloads.list().length });
  const dl1 = eng.subscriptions.download(sub.id);
  const jobs1b = eng.downloads.list();
  check('E16 사용자가 [받기]를 누르면(download 호출) 그때만 구독 옵션(MP3)으로 작업 생성·출처 표시·알림 목록 비워짐', dl1.added.length === 1 && addCalls === 1 && jobs1b.length === 1 && jobs1b[0].options.kind === 'audio' && jobs1b[0].source.type === 'subscription' && jobs1b[0].source.id === sub.id && eng.subscriptions.list()[0].pendingCount === 0, { source: jobs1b[0] && jobs1b[0].source });
  const r2 = await eng.subscriptions.check(sub.id);
  check('E16 같은 영상은 다시 감지하지 않음(중복 방지)', r2.newCount === 0 && eng.downloads.list().length === 1 && addCalls === 1, r2);
  const j1 = await waitJob(eng, jobs1b[0].id, undefined, 300000);
  check('E16 감지된 새 영상이 실제로 내려받아짐(ffprobe: mp3)', j1 && j1.status === 'completed' && probe(j1.files[0]).acodec === 'mp3' && j1.files[0].includes('모의 채널'), j1 && { s: j1.status, f: j1.files, e: j1.error });
  feed.entries.unshift(mk('e', V.caminandes3), mk('f', V.sintel + '&y=1'));
  const r3 = await eng.subscriptions.check(sub.id);
  check('E16 한꺼번에 2개가 올라오면 2개 모두 감지하되 다운로드 요청은 늘지 않음(addJobs 호출 1회 그대로)', r3.newCount === 2 && r3.queued === 0 && addCalls === 1 && eng.downloads.list().length === 1 && eng.subscriptions.list()[0].pendingCount === 2, { r3, addCalls });
  await eng.downloads.pauseAll();
  for (const j of eng.downloads.list()) await eng.downloads.cancel(j.id);
  feed.fail = true;
  const r4 = await eng.subscriptions.check(sub.id);
  const sv = eng.subscriptions.list()[0];
  check('E16 피드 조회 실패 → 오류 기록(한국어)·작업 없음·구독 유지', !!r4.error && /네트워크/.test(sv.lastError) && eng.subscriptions.list().length === 1, r4);
  feed.fail = false;
  // 주기 확인: 마지막 확인이 15분 전이면 _tick 이 확인, 끄면 건너뜀
  const before = listCalls; sv.lastCheck; const subObj = eng.subscriptions.subs.get(sub.id);
  subObj.lastCheck = Date.now() - 16 * 60000; await eng.subscriptions._tick();
  check('E16 주기(15분) 지나면 자동 확인', listCalls === before + 1, { before, after: listCalls });
  eng.subscriptions.setEnabled(sub.id, false); subObj.lastCheck = Date.now() - 99 * 60000; await eng.subscriptions._tick();
  check('E16 자동 받기를 끄면 확인하지 않음', listCalls === before + 1, listCalls);
  // 저장·복원
  const eng2 = createEngine({ dataDir: path.join(WORK, 'e16', 'data'), toolsDir: TOOLS, defaultSaveDir: out, lister: async () => ({ title: 'x', entries: [] }) });
  check('E16 구독 목록·알림 목록(새 영상 2개)이 파일에 저장돼 재시작 후에도 유지', eng2.subscriptions.list().length === 1 && eng2.subscriptions.list()[0].knownCount >= 6 && eng2.subscriptions.list()[0].pendingCount === 2, eng2.subscriptions.list()[0]);
  const pk = eng.subscriptions.list()[0].pending[0].key;
  eng.subscriptions.dismiss(sub.id, [pk]);
  check('E16 [알림 지우기]: 하나를 지우면 1개 남고 다운로드 요청은 여전히 늘지 않음', eng.subscriptions.list()[0].pendingCount === 1 && addCalls === 1, eng.subscriptions.list()[0].pendingCount);
  eng.subscriptions.dismiss(sub.id);
  check('E16 알림 전체 지우기 → 0개(받지 않음)', eng.subscriptions.list()[0].pendingCount === 0 && addCalls === 1 && eng.downloads.list().length === 1);
  check('E16 구독 해제', eng.subscriptions.remove(sub.id) && eng.subscriptions.list().length === 0);
  const bad = await eng.subscriptions.add({ url: 'file:///c:/x' }).catch(e => e.code);
  check('E16 잘못된 주소는 구독 거부', bad === 'bad-url', bad);
  const single = await eng.subscriptions.add({ url: 'https://www.youtube.com/@x' }).then(() => 'ok', e => e.code);
  await eng.shutdown(); await eng2.shutdown();
}
if (want('E17')) {
  // (b) 실제 목록 경로: 실제 yt-dlp 로 공식 재생목록(18개)을 구독 → 본 영상 기록에서 1개를 뺀 뒤(=그 영상이 새로 올라온 상황) 확인하면 그 영상만 감지
  const { eng } = newEngine('e17');
  const sub = await eng.subscriptions.add({ url: V.playlist, options: { kind: 'audio', audioFormat: 'mp3' } });
  check('E17 실제 재생목록 구독: 제목·본 영상 18개', sub.title === 'Blender Open Movies' && sub.knownCount >= 18 && eng.downloads.list().length === 0, { t: sub.title, k: sub.knownCount });
  const so = eng.subscriptions.subs.get(sub.id); const removed = so.known.pop();
  const r = await eng.subscriptions.check(sub.id);
  const jobs = eng.downloads.list();
  const pend = eng.subscriptions.list()[0].pending;
  check('E17 ★"새로 올라온" 영상 1개만 감지(실제 yt-dlp 조회)하고 다운로드 요청은 0건(작업 0개)', r.newCount === 1 && jobs.length === 0 && pend.length === 1 && pend[0].url.includes(removed), { removed, newCount: r.newCount, jobs: jobs.length, url: pend[0] && pend[0].url });
  const ch = await eng.subscriptions.add({ url: 'https://www.youtube.com/@BlenderStudio', options: { kind: 'audio', audioFormat: 'mp3' } });
  check('E17 채널 주소 구독(실제 채널 최신 영상 목록)', ch.knownCount >= 10 && /Blender Studio/.test(ch.title), { t: ch.title, k: ch.knownCount });
  await eng.shutdown();
}

// ===================== E18. 스마트 모드 =====================
if (want('E18')) {
  const { eng, out } = newEngine('e18', { settings: { smartMode: true, defaults: { kind: 'audio', audioFormat: 'm4a', quality: '720' } } });
  const t0 = Date.now();
  const r = await eng.smartAdd(V.caminandes3);
  const dt = Date.now() - t0;
  check('E18 스마트 모드: 영상 링크 한 번에 저장된 기본값(M4A 음성)으로 대기열 추가 — 옵션 선택 없이', r.kind === 'video' && r.added.length === 1 && r.added[0].options.kind === 'audio' && r.added[0].options.audioFormat === 'm4a', { r: r.kind, opts: r.added[0] && r.added[0].options, ms: dt });
  check('E18 영상 링크는 분석 없이 즉시(1초 미만) 추가', dt < 1000, dt);
  const j = await waitJob(eng, r.added[0].id); const p = j && j.files[0] && probe(j.files[0]);
  check('E18 기본값대로 결과 생성(ffprobe: aac·영상 없음)', p && j.status === 'completed' && /\.m4a$/i.test(j.files[0]) && p.acodec === 'aac' && !p.vcodec, { p, e: j && j.error });
  eng.setSettings({ defaults: { kind: 'audio', audioFormat: 'mp3' }, playlistNumberPrefix: true });
  eng.downloads.testExtraArgs = ['--download-sections', '*0-10'];
  const pl = await eng.smartAdd(V.playlist, { cap: 2 });
  check('E18 스마트 모드: 재생목록 링크 → 목록을 읽어 상한(2개)만큼 한 번에 추가·하위 폴더·번호', pl.kind === 'playlist' && pl.count === 2 && pl.added.every(x => x.outDir.endsWith('Blender Open Movies') && x.options.audioFormat === 'mp3' && x.source.type === 'playlist'), { kind: pl.kind, count: pl.count, dirs: pl.added.map(x => x.outDir) });
  const done = await Promise.all(pl.added.map(x => waitJob(eng, x.id, undefined, 300000)));
  check('E18 재생목록 항목 완료·번호 접두', done.every(x => x && x.status === 'completed') && fs.readdirSync(path.join(out, 'Blender Open Movies')).some(f => f.startsWith('001 - ')) && fs.readdirSync(path.join(out, 'Blender Open Movies')).some(f => f.startsWith('002 - ')), fs.readdirSync(path.join(out, 'Blender Open Movies')));
  const ch = await eng.smartAdd(V.caminandes3 + '&list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz');
  check('E18 영상+재생목록 주소는 그 영상 한 개만(재생목록 폭주 방지)', ch.kind === 'video' && ch.count === 1 && !ch.added[0].url.includes('list='), ch.added[0] && ch.added[0].url);
  await eng.downloads.cancel(ch.added[0].id);
  const bad = await eng.smartAdd('--exec calc').then(() => 'accepted', e => e.code);
  check('E18 잘못된 입력은 거부', bad === 'bad-url', bad);
  await eng.shutdown();
}

// ===================== E19. yt-dlp 엔진 업데이트(가짜 서버 + 실제 구버전/최신 엔진) =====================
if (want('E19')) {
  const oldExe = path.join(B, 'tools', 'test-engine-old', 'yt-dlp.exe'); // 실제 2026.08.19 릴리스
  const newExe = path.join(TOOLS, 'yt-dlp.exe');                          // 실제 2026.10.26 릴리스
  const mkEm = name => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return { d, em: new EngineManager({ dataDir: d, bundledPath: oldExe, env: { ...process.env } }) }; };
  const srv = await createFakeEngineServer({ tag: '2026.10.26', exe: fs.readFileSync(newExe) });
  const withApi = (em) => { em.env = { ...process.env, GOODSEEDOWN_ENGINE_API: srv.apiUrl }; return em; };
  let { d, em } = mkEm('e19a'); withApi(em);
  const c = await em.check();
  check('E19 확인: 설치된 엔진 2026.08.19 < 최신 2026.10.26 → 업데이트 가능', c.current === '2026.08.19' && c.latest === '2026.10.26' && c.updateAvailable && c.hasAssets, { cur: c.current, latest: c.latest });
  check('E19 업데이트 전에는 번들 엔진 사용', em.activePath() === oldExe);
  const prog = []; const u = await em.update({ checked: c, onProgress: (g, t) => prog.push([g, t]) });
  const act = em.activePath();
  check('E19 업데이트 성공: 사용자 폴더에 yt-dlp-2026.10.26.exe 설치·번들은 그대로', u.updated && u.version === '2026.10.26' && act !== oldExe && act.endsWith('yt-dlp-2026.10.26.exe') && sha(act) === sha(newExe) && sha(oldExe) === '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a', { act: path.basename(act), prog: prog.length });
  check('E19 업데이트 뒤 현재 버전 2026.10.26·재확인하면 최신', (await em.currentVersion()) === '2026.10.26' && !(await em.check()).updateAvailable);
  check('E19 임시 파일(.part)이 남지 않음', !fs.readdirSync(path.join(d, 'engine')).some(f => /part/.test(f)), fs.readdirSync(path.join(d, 'engine')));
  // 새 엔진으로 실제 조회가 된다
  const tools = Y.locateTools({ toolsDir: TOOLS, engineYtdlp: act });
  const info = await Y.analyze(tools, V.caminandes3);
  check('E19 설치된 새 엔진으로 실제 영상 조회 성공', info.type === 'video' && info.heights[0] === 1080, info.title);
  em.reset(); check('E19 엔진 되돌리기(reset) → 번들 엔진 사용', em.activePath() === oldExe);
  // 부정 시험
  const neg = async (name, cfg, wantCode) => { const x = mkEm(name); withApi(x.em); Object.assign(srv.cfg, { sums: 'ok', tamper: false, redirect: 'none', assets: 'both', apiStatus: 200, tag: '2026.10.26', exe: fs.readFileSync(newExe) }, cfg); let code = null; try { await x.em.update(); } catch (e) { code = e.code || e.message; } const left = fs.existsSync(path.join(x.d, 'engine')) ? fs.readdirSync(path.join(x.d, 'engine')) : []; return { code, active: x.em.activePath() === oldExe, left }; };
  let n = await neg('e19b', { tamper: true });
  check('E19 변조된 파일(해시 불일치) → 설치 거부·기존 엔진 유지·임시 파일 삭제', n.code === 'hash-mismatch' && n.active && n.left.length === 0, n);
  n = await neg('e19c', { sums: 'bad' });
  check('E19 해시 목록이 틀림 → 거부', n.code === 'hash-mismatch' && n.active, n);
  n = await neg('e19d', { sums: 'noentry' });
  check('E19 해시 목록에 yt-dlp.exe 항목 없음 → 거부', n.code === 'no-hash' && n.active, n);
  n = await neg('e19e', { sums: 'missing' });
  check('E19 해시 목록 파일 자체가 없음 → 업데이트 불가', n.code === 'assets' && n.active, n);
  n = await neg('e19f', { redirect: 'evil' });
  check('E19 허용되지 않은 호스트로 리다이렉트 → 차단', n.code === 'blocked-host' && n.active, n);
  n = await neg('e19g', { exe: Buffer.from('이건 exe 가 아님'), tag: '2026.10.26' });
  check('E19 exe 가 아닌 파일(해시는 맞음) → 거부', n.code === 'not-exe' && n.active, n);
  n = await neg('e19h', { exe: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(3000, 1)]) });
  check('E19 실행되지 않는 MZ 파일(해시는 맞음) → 거부("실행되지 않아")', n.code === 'not-runnable' && n.active && n.left.length === 0, n);
  const e500 = mkEm('e19i'); withApi(e500.em); srv.cfg.apiStatus = 500; let c500 = null; try { await e500.em.check(); } catch (e) { c500 = e.code; } srv.cfg.apiStatus = 200;
  check('E19 서버 오류(500) → 확인 실패로 처리', c500 === 'http', c500);
  const same = mkEm('e19j'); same.em.bundled = newExe; withApi(same.em); const cs = await same.em.check();
  check('E19 이미 최신이면 updateAvailable=false', cs.updateAvailable === false && cs.current === '2026.10.26', cs.current);
  await srv.close();
  // 실제 GitHub 읽기 전용 조회(현재 최신과 번들 비교)
  const real = new EngineManager({ dataDir: path.join(WORK, 'e19real'), bundledPath: newExe, env: { ...process.env } });
  const rc = await real.check().catch(e => ({ error: e.message }));
  check('E19 실제 GitHub 조회(읽기 전용): 번들 엔진이 최신 릴리스와 같음/이하', rc && !rc.error && /^\d{4}\.\d{2}\.\d{2}/.test(rc.latest), rc && { cur: rc.current, latest: rc.latest, avail: rc.updateAvailable, error: rc.error });
}

// ===================== M. MP3 전용 화면(1.1.0) — 옵션·설정 검증, 실측(비트레이트·ID3·앨범아트), 재생목록, 제어 =====================
function mp3probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  const j = JSON.parse(r.stdout); const a = j.streams.find(s => s.codec_type === 'audio'); const pics = j.streams.filter(s => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic === 1);
  const tags = Object.fromEntries(Object.entries(j.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { format: j.format.format_name, acodec: a && a.codec_name, bitrate: a && Number(a.bit_rate), duration: Number(j.format.duration), size: Number(j.format.size), title: tags.title, artist: tags.artist, pics: pics.map(p => ({ codec: p.codec_name, w: p.width, h: p.height })), streams: j.streams.length };
}
const mp3Opts = (br, id3 = true) => ({ kind: 'audio', audioFormat: 'mp3', mp3Bitrate: br, id3, subs: { enabled: false, langs: [], auto: false, mode: 'srt' } });

if (want('M0')) {
  const S = require('../src/engine/settings.cjs');
  const n = S.normalizeOptions({ kind: 'audio', audioFormat: 'mp3' });
  check('M0 옵션 기본값: MP3 음질 320·ID3 켬', n.mp3Bitrate === 320 && n.id3 === true, n);
  check('M0 허용된 음질(128/192/256/320)만 통과', [128, 192, 256, 320].every(b => S.normalizeOptions({ mp3Bitrate: b }).mp3Bitrate === b) && S.normalizeOptions({ mp3Bitrate: '192' }).mp3Bitrate === 192);
  check('M0 잘못된 음질(999·0·-1·글자·null·객체) → 320 으로 되돌림', [999, 0, -1, 'abc', null, {}, 64, 321].every(b => S.normalizeOptions({ mp3Bitrate: b }).mp3Bitrate === 320), [999, 0, 'abc'].map(b => S.normalizeOptions({ mp3Bitrate: b }).mp3Bitrate));
  check('M0 id3 가 불리언이 아니면 기본(켬), false 는 유지', S.normalizeOptions({ id3: 'no' }).id3 === true && S.normalizeOptions({ id3: false }).id3 === false);
  const st = S.normalizeSettings({}, 'C:\\v', 'C:\\m');
  check('M0 설정 기본값: 마지막 화면 video·MP3 음질 320·ID3 켬·MP3 저장 폴더 기본값', st.lastMode === 'video' && st.mp3.bitrate === 320 && st.mp3.id3 === true && st.mp3.saveDir === 'C:\\m', st.mp3);
  const old = S.normalizeSettings({ schema: 1, saveDir: 'C:\\old', maxConcurrent: 2, defaults: { kind: 'video', quality: '720' } }, 'C:\\v', 'C:\\m');
  check('M0 1.0.0 의 옛 설정 파일(mp3·lastMode 없음)을 그대로 읽어 새 항목은 기본값', old.saveDir === 'C:\\old' && old.maxConcurrent === 2 && old.defaults.quality === '720' && old.lastMode === 'video' && old.mp3.bitrate === 320 && old.mp3.saveDir === 'C:\\m', { lastMode: old.lastMode, mp3: old.mp3 });
  const bad = S.normalizeSettings({ lastMode: 'x', mp3: { bitrate: 7, id3: 3, saveDir: 'rel\\dir' } }, 'C:\\v', 'C:\\m');
  check('M0 손상된 저장값(화면 x·음질 7·상대 경로) → 안전한 기본값', bad.lastMode === 'video' && bad.mp3.bitrate === 320 && bad.mp3.id3 === true && bad.mp3.saveDir === 'C:\\m', bad.mp3);
  const mk = o => Y.buildDownloadArgs({ url: 'https://x.com/a', options: S.normalizeOptions(o), outDir: 'C:\\o', tempDir: 'C:\\o\\t', nameTemplate: 'n.%(ext)s' }, { ffmpegDir: 'C:\\f' });
  const i = (a, k) => a.indexOf(k);
  const a320 = mk(mp3Opts(320)), a128 = mk(mp3Opts(128)), aOff = mk(mp3Opts(192, false)), aM4a = mk({ kind: 'audio', audioFormat: 'm4a' });
  check('M0 인자: 320 → --audio-quality 320K·메타데이터·썸네일 jpg 변환·앨범아트 넣기', a320[i(a320, '--audio-quality') + 1] === '320K' && a320.includes('--embed-metadata') && a320.includes('--embed-thumbnail') && a320[i(a320, '--convert-thumbnails') + 1] === 'jpg' && a320.at(-2) === '--', a320.slice(-14));
  check('M0 인자: 128 → 128K', a128[i(a128, '--audio-quality') + 1] === '128K');
  check('M0 인자: ID3 끔 → 메타데이터·썸네일 인자 없음(음질은 192K)', !aOff.includes('--embed-metadata') && !aOff.includes('--embed-thumbnail') && aOff[i(aOff, '--audio-quality') + 1] === '192K', aOff.filter(x => x.startsWith('--embed')));
  check('M0 인자: M4A 는 기존 그대로(품질 0·메타데이터 O·썸네일 없음)', aM4a[i(aM4a, '--audio-quality') + 1] === '0' && aM4a.includes('--embed-metadata') && !aM4a.includes('--embed-thumbnail'));
}

if (want('M1')) {
  const { eng, out } = newEngine('m1');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(320), saveDir: out });
  const j = await waitJob(eng, r.added[0].id, undefined, 300000);
  const p = j && j.files[0] && mp3probe(j.files[0]);
  check('M1 320kbps MP3 완료·.mp3 파일', j && j.status === 'completed' && /\.mp3$/i.test(j.files[0]), j && { s: j.status, f: j.files, e: j.error });
  check('M1 ffprobe: mp3 코덱·비트레이트 정확히 320000·길이 150초±2', p && p.acodec === 'mp3' && p.bitrate === 320000 && Math.abs(p.duration - 150) < 2, p && { acodec: p.acodec, bitrate: p.bitrate, dur: p.duration });
  check('M1 ID3: 제목 "Caminandes 3: Llamigos"·아티스트(채널) "Blender"', p && p.title === 'Caminandes 3: Llamigos' && p.artist === 'Blender', p && { title: p.title, artist: p.artist });
  check('M1 앨범아트: 그림 스트림(mjpeg·1280x720) 1개가 파일에 들어 있음', p && p.pics.length === 1 && p.pics[0].codec === 'mjpeg' && p.pics[0].w === 1280, p && p.pics);
  check('M1 임시 폴더·썸네일 잔여 파일 없음(저장 폴더에 mp3 하나만)', files(out).length === 1, files(out));
  await eng.shutdown();
}
if (want('M2')) {
  const { eng, out } = newEngine('m2');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(128), saveDir: out });
  const j = await waitJob(eng, r.added[0].id, undefined, 300000);
  const p = j && j.files[0] && mp3probe(j.files[0]);
  check('M2 128kbps MP3: 비트레이트 정확히 128000·길이 150초±2·제목·앨범아트', j && j.status === 'completed' && p && p.acodec === 'mp3' && p.bitrate === 128000 && Math.abs(p.duration - 150) < 2 && p.title === 'Caminandes 3: Llamigos' && p.pics.length === 1, p && { bitrate: p.bitrate, dur: p.duration, title: p.title, pics: p.pics.length, size: p.size });
  await eng.shutdown();
}
if (want('M3')) {
  const { eng, out } = newEngine('m3');
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(192, false), saveDir: out });
  const j = await waitJob(eng, r.added[0].id, undefined, 300000);
  const p = j && j.files[0] && mp3probe(j.files[0]);
  check('M3 ID3 끔: 192kbps·제목/아티스트 태그 없음·앨범아트 없음', j && j.status === 'completed' && p && p.bitrate === 192000 && !p.title && !p.artist && p.pics.length === 0, p && { bitrate: p.bitrate, title: p.title, artist: p.artist, pics: p.pics.length });
  await eng.shutdown();
}
if (want('M4')) {
  const { eng, out } = newEngine('m4');
  const a = await eng.analyze(V.playlist, { mode: 'auto', end: 500 });
  const pick = a.entries.filter(e => PLAYLIST_PICK.includes(e.index));
  const res = eng.addDownloads({ items: pick.map(e => ({ url: e.url, title: e.title, duration: e.duration, index: e.index })), options: mp3Opts(320), saveDir: out, subfolder: a.title, indexPrefix: true, source: { type: 'playlist', id: a.id, title: a.title } });
  check('M4 재생목록 3개 MP3 일괄 추가', res.added.length === 3 && res.added.every(x => x.options.mp3Bitrate === 320), res.added.map(x => x.title));
  const done = await Promise.all(res.added.map(x => waitJob(eng, x.id, undefined, 400000)));
  const sub = path.join(out, 'Blender Open Movies');
  const mp3s = fs.existsSync(sub) ? fs.readdirSync(sub).filter(f => /\.mp3$/.test(f)) : [];
  check('M4 3개 모두 완료·재생목록 이름의 하위 폴더에 .mp3 3개', done.every(j => j && j.status === 'completed') && mp3s.length === 3 && files(out).length === 3, done.map(j => j && [j.status, j.error]));
  check('M4 파일 이름 앞에 번호(007 - …, 011 - …, 012 - …)', ['007 - ', '011 - ', '012 - '].every(pf => mp3s.some(f => f.startsWith(pf))), mp3s);
  const probes = done.map(j => mp3probe(j.files[0]));
  check('M4 ffprobe: 3개 모두 mp3·320000·길이가 목록 정보와 일치(±3초)·제목 태그·앨범아트', probes.every((p, i) => p.acodec === 'mp3' && p.bitrate === 320000 && Math.abs(p.duration - pick[i].duration) < 3 && !!p.title && p.pics.length === 1), probes.map((p, i) => [p.bitrate, Math.round(p.duration), pick[i].duration, p.title, p.pics.length]));
  await eng.shutdown();
}
if (want('M5')) {
  const { eng, out } = newEngine('m5', { extra: ['--limit-rate', '100K'] });
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(320), saveDir: out });
  const id = r.added[0].id;
  await until(() => { const j = eng.downloads.get(id); return j.progress.percent > 15 ? j : null; }, 90000, 200);
  await eng.downloads.pause(id);
  const jp = eng.downloads.get(id); const part = files(path.join(out, '.goodseedown-tmp')).filter(f => /\.part$/.test(f));
  check('M5 MP3 일시정지: paused·.part 보존', jp.status === 'paused' && part.length >= 1 && fs.statSync(part[0]).size > 100000, { s: jp.status, part: part[0] && fs.statSync(part[0]).size });
  const sizeBefore = fs.statSync(part[0]).size;
  eng.downloads.resume(id);
  const j = await waitJob(eng, id, undefined, 400000);
  const p = j && j.files[0] && mp3probe(j.files[0]);
  check('M5 MP3 이어받기: 중단 지점부터 이어서 받고(Resuming) 완료·320000·150초', j && j.status === 'completed' && j.resumeCount >= 1 && j.lastResumeByte >= sizeBefore - 1 && p && p.bitrate === 320000 && Math.abs(p.duration - 150) < 2, { resume: j && j.resumeCount, at: j && j.lastResumeByte, before: sizeBefore, p: p && [p.bitrate, p.duration] });
  await eng.shutdown();
}
if (want('M6')) {
  const { eng, out } = newEngine('m6', { extra: ['--limit-rate', '100K'] });
  const r = eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(320), saveDir: out });
  const id = r.added[0].id;
  await until(() => { const j = eng.downloads.get(id); return j.progress.percent > 15 ? j : null; }, 90000, 200);
  await eng.downloads.cancel(id);
  const j = eng.downloads.get(id);
  check('M6 MP3 취소: canceled·임시 파일 삭제·결과 파일 없음', j.status === 'canceled' && files(out).length === 0, { s: j.status, left: files(out) });
  await eng.shutdown();
}
if (want('M7')) {
  // 설정 저장·재기동 후 복원(엔진 수준): 마지막 화면·음질·ID3·MP3 저장 폴더
  const dir = path.join(WORK, 'm7'); fs.mkdirSync(dir, { recursive: true });
  const mk = () => createEngine({ dataDir: path.join(dir, 'data'), toolsDir: TOOLS, defaultSaveDir: path.join(dir, 'v'), defaultMp3Dir: path.join(dir, 'music') });
  let e1 = mk(); const first = e1.getSettings();
  check('M7 처음 실행: video 화면·320·MP3 저장 폴더 = 음악 폴더 기본값', first.lastMode === 'video' && first.mp3.bitrate === 320 && first.mp3.saveDir === path.join(dir, 'music'), first.mp3);
  e1.setSettings({ lastMode: 'mp3', mp3: { bitrate: 192 } }); e1.setSettings({ mp3: { id3: false } });
  const s1 = e1.getSettings(); await e1.shutdown();
  check('M7 부분 갱신: 음질만/ID3만 바꿔도 나머지(저장 폴더)는 유지', s1.lastMode === 'mp3' && s1.mp3.bitrate === 192 && s1.mp3.id3 === false && s1.mp3.saveDir === path.join(dir, 'music'), s1.mp3);
  const e2 = mk(); const s2 = e2.getSettings(); await e2.shutdown();
  check('M7 엔진 재생성(앱 재기동과 같음): 마지막 화면 mp3·음질 192·ID3 끔 복원', s2.lastMode === 'mp3' && s2.mp3.bitrate === 192 && s2.mp3.id3 === false, { lastMode: s2.lastMode, mp3: s2.mp3 });
  e2.setSettings({ mp3: { bitrate: 999, saveDir: 'relative\\x' } });
  const s3 = e2.getSettings();
  check('M7 잘못된 값으로 갱신 시도 → 거부하고 안전한 값(320·기본 폴더)', s3.mp3.bitrate === 320 && s3.mp3.saveDir === path.join(dir, 'music'), s3.mp3);
}

if (want('M8')) {
  // 같은 영상을 다른 음질로 다시 받기: 새 음질로 덮어쓴다(예전 파일이 그대로 남지 않는다)
  const { eng, out } = newEngine('m8');
  const j1 = await waitJob(eng, eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(320), saveDir: out }).added[0].id, undefined, 300000);
  const p1 = j1 && j1.files[0] && mp3probe(j1.files[0]);
  const j2 = await waitJob(eng, eng.addDownloads({ items: [{ url: V.caminandes3 }], options: mp3Opts(128), saveDir: out }).added[0].id, undefined, 300000);
  const p2 = j2 && j2.files[0] && mp3probe(j2.files[0]);
  check('M8 같은 영상을 320 → 128 로 다시 받으면 파일이 128kbps 로 바뀜(한 파일만 존재)', p1 && p1.bitrate === 320000 && p2 && p2.bitrate === 128000 && j1.files[0] === j2.files[0] && files(out).length === 1 && p2.size < p1.size && p2.pics.length === 1, { b1: p1 && p1.bitrate, b2: p2 && p2.bitrate, n: files(out).length });
  await eng.shutdown();
}

const failed = results.filter(r => !r.ok);
const report = { when: new Date().toISOString(), node: process.version, ytdlp: spawnSync(path.join(TOOLS, 'yt-dlp.exe'), ['--version'], { encoding: 'utf8' }).stdout.trim(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
fs.writeFileSync(path.join(B, `verification_engine${label ? '-' + label : ''}.json`), JSON.stringify(report, null, 1));
console.log(`\n=== ${report.passed}/${report.total} 통과${failed.length ? ' — 실패: ' + failed.map(f => f.name).join(' | ') : ''} ===`);
process.exit(failed.length ? 1 : 0);
