'use strict';
// 다운로드 작업 관리자 — 대기열·동시 실행 수·일시정지/재개/취소/재시도·진행률·저장(jobs.json)을 맡는다.
// 일시정지 = yt-dlp 프로세스를 끝내고 .part 파일을 남긴다(재개 때 같은 임시 폴더로 다시 실행하면 yt-dlp 가 이어받는다).
// 취소 = 프로세스를 끝내고 그 작업의 임시 폴더를 지운다(이미 완성된 파일은 건드리지 않는다).
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { spawn } = require('node:child_process');
const { normalizeUrl, sanitizeName, readJson, writeJsonAtomic, killTree, rmQuiet, uid, translateError } = require('./util.cjs');
const { normalizeOptions } = require('./settings.cjs');
const Y = require('./ytdlp.cjs');

const ACTIVE = new Set(['downloading', 'processing']);
const LIVE = new Set(['queued', 'downloading', 'processing', 'paused']); // 아직 끝나지 않은 상태
const MAX_ADD = 2000;
const AUTO_RETRY_MAX = 2;
const PROGRESS_EMIT_MS = 250;

class DownloadManager extends EventEmitter {
  // opts: { dataDir, getSettings(), getTools(), testExtraArgs?, autoRetryDelayMs? }
  constructor(opts) {
    super();
    this.dataDir = opts.dataDir;
    this.getSettings = opts.getSettings;
    this.getTools = opts.getTools;
    this.testExtraArgs = opts.testExtraArgs || [];
    this.autoRetryDelayMs = opts.autoRetryDelayMs ?? 5000;
    this.file = path.join(this.dataDir, 'jobs.json');
    this.jobs = new Map();
    this.runtime = new Map(); // id -> {child, intent, streams, lastEmit, errLines, closed:Promise}
    this._saveTimer = null;
    this._closed = false;
    this._load();
  }

  // ---------- 저장/불러오기 ----------
  _load() {
    const j = readJson(this.file, null);
    const list = j && Array.isArray(j.jobs) ? j.jobs : [];
    for (const raw of list) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.url !== 'string' || !normalizeUrl(raw.url)) continue;
      const job = { ...raw };
      if (ACTIVE.has(job.status)) { job.status = 'paused'; job.note = '앱이 종료되어 일시 정지되었습니다. [이어받기]를 누르세요.'; job.progress = { ...(job.progress || {}), speed: null, eta: null }; }
      if (!['queued', 'paused', 'completed', 'failed', 'canceled'].includes(job.status)) job.status = 'failed';
      this.jobs.set(job.id, job);
    }
  }
  _clean(job) { const o = {}; for (const [k, v] of Object.entries(job)) if (!k.startsWith('_')) o[k] = v; return o; }
  _saveNow() {
    clearTimeout(this._saveTimer); this._saveTimer = null;
    try { writeJsonAtomic(this.file, { schema: 1, jobs: [...this.jobs.values()].map(j => this._clean(j)) }); } catch (e) { this.emit('log', 'jobs.json 저장 실패: ' + e.message); }
  }
  _save() { if (this._saveTimer) return; this._saveTimer = setTimeout(() => this._saveNow(), 400); this._saveTimer.unref?.(); }
  _emit(job, force = true) {
    const rt = this.runtime.get(job.id); const now = Date.now();
    if (!force && rt && now - (rt.lastEmit || 0) < PROGRESS_EMIT_MS) return;
    if (rt) rt.lastEmit = now;
    this.emit('job', this._clean(job)); this._save();
  }

  list() { return [...this.jobs.values()].map(j => this._clean(j)); }
  get(id) { const j = this.jobs.get(id); return j ? this._clean(j) : null; }
  activeCount() { let n = 0; for (const j of this.jobs.values()) if (ACTIVE.has(j.status)) n++; return n; }
  isBusy() { return this.activeCount() > 0; }

  // ---------- 추가 ----------
  // items: [{url, title?, duration?, index?}]; common: {options, saveDir?, subfolder?, indexPrefix?, source?}
  addJobs(items, common = {}) {
    if (!Array.isArray(items)) throw new Error('items 가 배열이 아닙니다.');
    if (items.length > MAX_ADD) throw new Error(`한 번에 추가할 수 있는 항목은 ${MAX_ADD}개까지입니다.`);
    const settings = this.getSettings();
    const options = normalizeOptions(common.options || {}, settings.defaults);
    const saveDir = typeof common.saveDir === 'string' && path.isAbsolute(common.saveDir) ? path.normalize(common.saveDir) : settings.saveDir;
    const sub = common.subfolder ? sanitizeName(common.subfolder) : '';
    const outDir = sub ? path.join(saveDir, sub) : saveDir;
    const added = [], skipped = [];
    for (const it of items) {
      const url = normalizeUrl(it && it.url);
      if (!url) { skipped.push({ url: String(it && it.url || ''), reason: '올바른 http(s) 주소가 아닙니다.' }); continue; }
      const optKey = JSON.stringify(options);
      const dup = [...this.jobs.values()].find(j => j.url === url && LIVE.has(j.status) && JSON.stringify(j.options) === optKey);
      if (dup) { skipped.push({ url, reason: '이미 대기열에 있습니다.' }); continue; }
      const id = uid();
      let template = '%(title).150B [%(id)s].%(ext)s';
      if (common.indexPrefix && Number.isInteger(it.index) && it.index > 0) template = String(it.index).padStart(3, '0') + ' - ' + template;
      const job = {
        id, url, title: typeof it.title === 'string' && it.title ? it.title : url, uploader: '', duration: Number.isFinite(it.duration) ? it.duration : null,
        status: 'queued', error: null, errorPermanent: false, note: '', progress: { percent: null, downloaded: 0, total: null, speed: null, eta: null, stage: '' },
        options, outDir, tempDir: path.join(outDir, '.goodseedown-tmp', id), nameTemplate: template,
        source: common.source && typeof common.source === 'object' ? { type: String(common.source.type || ''), id: String(common.source.id || ''), title: String(common.source.title || '') } : { type: 'single', id: '', title: '' },
        files: [], subFiles: [], attempts: 0, autoRetries: 0, resumeCount: 0, lastResumeByte: null, createdAt: Date.now(), startedAt: null, finishedAt: null,
      };
      this.jobs.set(id, job); added.push(this._clean(job)); this._emit(job);
    }
    this._pump();
    return { added, skipped };
  }

  // ---------- 대기열 ----------
  _pump() {
    if (this._closed) return;
    const max = this.getSettings().maxConcurrent;
    let running = this.activeCount();
    for (const job of this.jobs.values()) {
      if (running >= max) break;
      if (job.status === 'queued' && !this.runtime.has(job.id)) { running++; this._start(job); }
    }
  }

  _start(job) {
    const tools = this.getTools();
    job.status = 'downloading'; job.error = null; job.errorPermanent = false; job.note = '';
    job.startedAt = job.startedAt || Date.now(); job.attempts++;
    job.progress = { ...job.progress, speed: null, eta: null, stage: 'video' };
    const rt = { child: null, intent: null, streams: new Map(), lastEmit: 0, errLines: [], tail: [], maxPercent: job.progress.percent || 0 };
    this.runtime.set(job.id, rt);
    this._emit(job);
    const rtime = Y.runtimeSetup();
    let args;
    try {
      fs.mkdirSync(job.outDir, { recursive: true }); fs.mkdirSync(job.tempDir, { recursive: true });
      const freshStart = fs.readdirSync(job.tempDir).length === 0; // 임시 폴더가 비어 있으면 처음부터 받는 것, 뭔가 있으면 이어받기
      args = [...rtime.args, ...Y.buildDownloadArgs(job, { ffmpegDir: tools.ffmpegDir, testExtraArgs: this.testExtraArgs, freshStart })];
    } catch (e) { return this._finishFail(job, rt, e.code === 'EACCES' || e.code === 'EPERM' ? 'permission denied' : e.message); }
    let child;
    try { child = spawn(tools.ytdlp, args, { windowsHide: true, env: rtime.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return this._finishFail(job, rt, 'yt-dlp 를 실행하지 못했습니다: ' + e.message); }
    rt.child = child;
    const handle = line => this._onLine(job, rt, line);
    for (const stream of [child.stdout, child.stderr]) {
      const dec = new StringDecoder('utf8'); let buf = '';
      stream.on('data', c => { buf += dec.write(c); let i; while ((i = buf.search(/\r|\n/)) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) handle(l); } if (buf.length > 20000) buf = buf.slice(-2000); });
      stream.on('end', () => { buf += dec.end(); if (buf) handle(buf); buf = ''; });
    }
    let spawnFailed = false;
    child.on('error', e => { spawnFailed = true; this._finishFail(job, rt, 'yt-dlp 를 실행하지 못했습니다: ' + e.message); });
    rt.closed = new Promise(resolve => {
      child.on('close', code => { if (!spawnFailed) this._onClose(job, rt, code); resolve(); });
    });
  }

  _onLine(job, rt, line) {
    const ev = Y.parseLine(line);
    rt.tail.push(line); if (rt.tail.length > 40) rt.tail.shift();
    if (!ev) return;
    const p = job.progress;
    switch (ev.type) {
      case 'info':
        if (!job.title || job.title === job.url) job.title = ev.title || job.title;
        if (ev.uploader) job.uploader = ev.uploader;
        if (ev.duration && !job.duration) job.duration = ev.duration;
        this._emit(job); break;
      case 'progress': {
        const total = ev.total ?? ev.estimate ?? null;
        const key = ev.formatId || 'x';
        const s = rt.streams.get(key) || { d: 0, t: null };
        s.d = ev.status === 'finished' && total ? total : (ev.downloaded ?? s.d); if (total) s.t = total;
        rt.streams.set(key, s);
        let sumD = 0, sumT = 0, known = false;
        for (const v of rt.streams.values()) if (v.t) { sumD += Math.min(v.d, v.t); sumT += v.t; known = true; }
        let pct = known && sumT > 0 ? Math.min(99.9, (sumD / sumT) * 100) : null;
        if (pct !== null) { pct = Math.max(rt.maxPercent, pct); rt.maxPercent = pct; }
        job.status = 'downloading';
        job.progress = { percent: pct, downloaded: sumD, total: known ? sumT : null, speed: ev.status === 'finished' ? null : ev.speed, eta: ev.status === 'finished' ? null : ev.eta, stage: ev.vcodec && ev.vcodec !== 'none' ? 'video' : 'audio' };
        this._emit(job, ev.status === 'finished'); break;
      }
      case 'post': {
        if (ev.status === 'started') {
          const map = { Merger: 'merge', VideoRemuxer: 'merge', ExtractAudio: 'convert', FFmpegExtractAudio: 'convert', SubtitlesConvertor: 'subs', FFmpegSubtitlesConvertor: 'subs', EmbedSubtitle: 'subs', FFmpegEmbedSubtitle: 'subs', MoveFiles: 'finish', Metadata: 'finish', FFmpegMetadata: 'finish' };
          if (/EmbedSubtitle/.test(ev.name)) rt.embedded = true;
          job.status = 'processing'; job.progress = { ...p, speed: null, eta: null, stage: map[ev.name] || 'finish' };
          this._emit(job);
        } break;
      }
      case 'file': if (ev.path && !job.files.includes(ev.path)) job.files.push(ev.path); break;
      case 'subfile': if (ev.path && !job.subFiles.includes(ev.path)) job.subFiles.push(ev.path); break;
      case 'resume': job.resumeCount = (job.resumeCount || 0) + 1; job.lastResumeByte = ev.byte; this._emit(job); break;
      case 'error': rt.errLines.push(ev.text); break;
    }
  }

  _subtitleFilesFor(job) {
    const found = new Set();
    const bases = new Set();
    for (const f of [...job.files, ...job.subFiles]) bases.add(path.basename(f).replace(/(\.[A-Za-z0-9-]{1,25})?\.(mp4|mkv|mp3|m4a|ogg|opus|webm|srt|vtt|ass|json)$/i, ''));
    try {
      for (const name of fs.readdirSync(job.outDir)) {
        if (!/\.(srt|vtt|ass)$/i.test(name)) continue;
        for (const b of bases) if (b && name.startsWith(b + '.')) found.add(path.join(job.outDir, name));
      }
    } catch { }
    return [...found];
  }

  _finishOk(job, rt) {
    const o = job.options;
    job.files = job.files.filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    const wantSubs = o.subs.enabled && o.subs.langs.length > 0;
    const subs = wantSubs ? this._subtitleFilesFor(job) : [];
    if (o.kind === 'subs') {
      if (!subs.length) return this._finishFail(job, rt, '요청한 언어의 자막이 이 영상에 없습니다.', { permanent: true, raw: false });
      job.files = subs;
    } else {
      if (!job.files.length) return this._finishFail(job, rt, '내려받은 결과 파일을 찾지 못했습니다.', { permanent: false, raw: false });
      if (wantSubs && !subs.length && !rt.embedded) job.note = '요청한 언어의 자막을 찾지 못해 영상만 저장했습니다.';
      else if (wantSubs) job.note = '';
    }
    job.subFiles = subs;
    job.status = 'completed'; job.finishedAt = Date.now(); job.error = null;
    job.progress = { percent: 100, downloaded: job.progress.downloaded, total: job.progress.total, speed: null, eta: null, stage: '' };
    this._cleanupTemp(job); this.runtime.delete(job.id); this._emit(job); this._pump(); this.emit('completed', this._clean(job));
  }

  _finishFail(job, rt, rawMsg, { permanent, raw = true } = {}) {
    const tr = raw ? translateError(rawMsg) : { message: rawMsg, permanent: !!permanent };
    job.status = 'failed'; job.error = tr.message; job.errorPermanent = !!tr.permanent; job.finishedAt = Date.now();
    job.errorRaw = String(rt.errLines.join('\n') || rt.tail.join('\n') || rawMsg).slice(-1500);
    job.progress = { ...job.progress, speed: null, eta: null };
    this.runtime.delete(job.id); this._emit(job);
    if (!tr.permanent && job.autoRetries < AUTO_RETRY_MAX) {
      job.autoRetries++; job.note = `자동 재시도 예정(${job.autoRetries}/${AUTO_RETRY_MAX})`;
      const t = setTimeout(() => { const j = this.jobs.get(job.id); if (j && j.status === 'failed' && !this._closed) { j.status = 'queued'; j.error = null; j.finishedAt = null; this._emit(j); this._pump(); } }, this.autoRetryDelayMs * job.autoRetries);
      t.unref?.();
    }
    this._pump(); this.emit('failed', this._clean(job));
  }

  _onClose(job, rt, code) {
    if (rt.intent === 'pause' || rt.intent === 'shutdown') {
      job.status = 'paused'; job.progress = { ...job.progress, speed: null, eta: null };
      if (rt.intent === 'shutdown') job.note = '앱이 종료되어 일시 정지되었습니다. [이어받기]를 누르세요.';
      this.runtime.delete(job.id); this._emit(job); this._pump(); return;
    }
    if (rt.intent === 'cancel') {
      job.status = 'canceled'; job.finishedAt = Date.now(); job.files = []; job.subFiles = [];
      job.progress = { percent: null, downloaded: 0, total: null, speed: null, eta: null, stage: '' };
      this._cleanupTemp(job); this.runtime.delete(job.id); this._emit(job); this._pump(); return;
    }
    if (code === 0) return this._finishOk(job, rt);
    this._finishFail(job, rt, rt.errLines.join('\n') || rt.tail.slice(-8).join('\n') || `yt-dlp 가 오류로 종료되었습니다(코드 ${code}).`);
  }

  _cleanupTemp(job) {
    rmQuiet(job.tempDir);
    try { const parent = path.dirname(job.tempDir); if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); } catch { }
  }

  // ---------- 제어 ----------
  async _stopRunning(job, intent) {
    const rt = this.runtime.get(job.id);
    if (!rt) return false;
    rt.intent = intent;
    await killTree(rt.child && rt.child.pid);
    if (rt.closed) await Promise.race([rt.closed, new Promise(r => setTimeout(r, 10000))]);
    return true;
  }

  async pause(id) {
    const job = this.jobs.get(id); if (!job) return false;
    if (job.status === 'queued') { job.status = 'paused'; job.note = ''; this._emit(job); return true; }
    if (!ACTIVE.has(job.status)) return false;
    await this._stopRunning(job, 'pause'); return true;
  }
  resume(id) {
    const job = this.jobs.get(id); if (!job || job.status !== 'paused') return false;
    job.status = 'queued'; job.note = ''; this._emit(job); this._pump(); return true;
  }
  async cancel(id) {
    const job = this.jobs.get(id); if (!job) return false;
    if (ACTIVE.has(job.status)) { await this._stopRunning(job, 'cancel'); return true; }
    if (job.status === 'queued' || job.status === 'paused' || job.status === 'failed') {
      job.status = 'canceled'; job.finishedAt = Date.now(); job.error = null; job.note = '';
      job.progress = { percent: null, downloaded: 0, total: null, speed: null, eta: null, stage: '' };
      this._cleanupTemp(job); this._emit(job); this._pump(); return true;
    }
    return false;
  }
  retry(id) {
    const job = this.jobs.get(id); if (!job || !['failed', 'canceled'].includes(job.status)) return false;
    job.status = 'queued'; job.error = null; job.errorPermanent = false; job.note = ''; job.finishedAt = null; job.autoRetries = 0; job.files = []; job.subFiles = [];
    if (job.progress) job.progress = { ...job.progress, speed: null, eta: null };
    this._emit(job); this._pump(); return true;
  }
  async remove(id) {
    const job = this.jobs.get(id); if (!job) return false;
    if (ACTIVE.has(job.status)) await this._stopRunning(job, 'cancel');
    if (job.status !== 'completed') this._cleanupTemp(job);
    this.jobs.delete(id); this.runtime.delete(id); this.emit('removed', id); this._save(); this._pump(); return true;
  }
  async pauseAll() { const ids = [...this.jobs.values()].filter(j => LIVE.has(j.status) && j.status !== 'paused').map(j => j.id); for (const id of ids) await this.pause(id); return ids.length; }
  resumeAll() { let n = 0; for (const j of [...this.jobs.values()]) if (j.status === 'paused' && this.resume(j.id)) n++; return n; }
  async clearFinished() {
    const ids = [...this.jobs.values()].filter(j => j.status === 'completed' || j.status === 'canceled').map(j => j.id);
    for (const id of ids) { this.jobs.delete(id); this.emit('removed', id); }
    this._save(); return ids.length;
  }
  setMaxConcurrent() { this._pump(); }

  // 앱 종료: 실행 중인 작업을 모두 멈추고(일시정지로 저장) 즉시 저장한다. 다음 실행 때 이어받을 수 있다.
  async shutdown() {
    this._closed = true;
    const running = [...this.jobs.values()].filter(j => ACTIVE.has(j.status));
    await Promise.all(running.map(j => this._stopRunning(j, 'shutdown')));
    for (const j of this.jobs.values()) if (ACTIVE.has(j.status)) { j.status = 'paused'; j.note = '앱이 종료되어 일시 정지되었습니다. [이어받기]를 누르세요.'; }
    this._saveNow();
  }
}

module.exports = { DownloadManager, ACTIVE, LIVE };
