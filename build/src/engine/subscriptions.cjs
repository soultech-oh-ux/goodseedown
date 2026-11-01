'use strict';
// 구독 — 재생목록·채널을 등록해 두면 주기적으로 목록을 확인해 '새로 올라온 영상'을 알려 준다(알림만).
// ★자동 다운로드는 하지 않는다(오너 지시): 새 영상은 sub.pending 에 기록만 하고, 사용자가 [받기]를 눌렀을 때(download())에만 대기열에 넣는다.
// 처음 등록할 때 이미 있는 영상은 '본 영상'으로 기록만 하고 받지 않는다.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { readJson, writeJsonAtomic, uid, sanitizeName, translateError, normalizeUrl } = require('./util.cjs');
const { normalizeOptions } = require('./settings.cjs');

const CHECK_WINDOW = 30;      // 확인할 때 목록에서 가져오는 최신 영상 수
const MAX_PENDING = 100;      // 알림으로 쌓아 두는 새 영상의 상한(폭주 방지)
const MAX_KNOWN = 3000;
const TICK_MS = 30000;

const cleanPending = list => (Array.isArray(list) ? list : []).filter(e => e && typeof e.key === 'string' && normalizeUrl(e.url)).slice(0, MAX_PENDING)
  .map(e => ({ key: e.key, url: normalizeUrl(e.url), title: String(e.title || '').slice(0, 300), duration: Number.isFinite(e.duration) ? e.duration : null }));

class SubscriptionManager extends EventEmitter {
  // opts: { dataDir, lister(url,{end,signal}) -> {title, entries[]}, downloads(DownloadManager), getSettings(), now? }
  constructor(opts) {
    super();
    this.file = path.join(opts.dataDir, 'subscriptions.json');
    this.lister = opts.lister;
    this.downloads = opts.downloads;
    this.getSettings = opts.getSettings;
    this.now = opts.now || (() => Date.now());
    this.subs = new Map();
    this._timer = null; this._busy = false;
    const j = readJson(this.file, null);
    for (const s of (j && Array.isArray(j.subscriptions) ? j.subscriptions : [])) {
      if (!s || typeof s.id !== 'string' || !normalizeUrl(s.url)) continue;
      this.subs.set(s.id, { ...s, known: Array.isArray(s.known) ? s.known.map(String) : [], pending: cleanPending(s.pending), options: normalizeOptions(s.options || {}) });
    }
  }
  _save() { try { writeJsonAtomic(this.file, { schema: 1, subscriptions: [...this.subs.values()] }); } catch (e) { this.emit('log', '구독 저장 실패: ' + e.message); } }
  _view(s) { const { known, pending, ...rest } = s; return { ...rest, knownCount: known.length, pending: pending.map(e => ({ ...e })), pendingCount: pending.length }; }
  list() { return [...this.subs.values()].map(s => this._view(s)); }

  // 등록. 지금 있는 영상은 모두 '본 영상'으로만 기록한다(받지 않음).
  async add({ url, options, saveDir, signal } = {}) {
    const u = normalizeUrl(url);
    if (!u) throw Object.assign(new Error('올바른 http(s) 주소가 아닙니다.'), { code: 'bad-url' });
    if ([...this.subs.values()].some(s => s.url === u)) throw Object.assign(new Error('이미 구독 중인 주소입니다.'), { code: 'duplicate' });
    const feed = await this.lister(u, { end: CHECK_WINDOW, signal });
    if (!feed || !Array.isArray(feed.entries)) throw Object.assign(new Error('재생목록이나 채널 주소를 입력해 주세요(영상 한 개의 주소는 구독할 수 없습니다).'), { code: 'not-a-feed' });
    const entries = feed.entries.filter(e => !e.unavailable);
    const key = e => e.id || e.url;
    const sub = {
      id: uid(), url: u, title: feed.title || u, createdAt: this.now(), lastCheck: this.now(), lastError: null, lastNewCount: 0, pending: [],
      enabled: true, options: normalizeOptions(options || {}, this.getSettings().defaults),
      saveDir: typeof saveDir === 'string' && path.isAbsolute(saveDir) ? path.normalize(saveDir) : this.getSettings().saveDir,
      subfolder: sanitizeName(feed.title || 'subscription'), known: entries.map(key),
    };
    this.subs.set(sub.id, sub); this._save();
    this.emit('change'); return this._view(sub);
  }

  remove(id) { const ok = this.subs.delete(id); if (ok) { this._save(); this.emit('change'); } return ok; }
  setEnabled(id, enabled) { const s = this.subs.get(id); if (!s) return false; s.enabled = !!enabled; this._save(); this.emit('change'); return true; }

  // 사용자가 [받기]를 눌렀을 때만 호출된다. keys 를 주면 그 영상만, 생략하면 알림에 쌓인 영상 전부(오래된 것부터).
  download(id, keys) {
    const sub = this.subs.get(id); if (!sub) throw new Error('구독을 찾을 수 없습니다.');
    const want = Array.isArray(keys) ? new Set(keys.map(String)) : null;
    const take = sub.pending.filter(e => !want || want.has(e.key));
    if (!take.length) return { added: [], skipped: [] };
    const res = this._enqueue(sub, take.slice().reverse());
    const taken = new Set(take.map(e => e.key)); sub.pending = sub.pending.filter(e => !taken.has(e.key));
    this._save(); this.emit('change'); return res;
  }
  // 알림에서 지운다(받지 않음).
  dismiss(id, keys) {
    const sub = this.subs.get(id); if (!sub) return false;
    const want = Array.isArray(keys) ? new Set(keys.map(String)) : null;
    sub.pending = sub.pending.filter(e => want && !want.has(e.key));
    this._save(); this.emit('change'); return true;
  }

  _enqueue(sub, entries) {
    return this.downloads.addJobs(entries.map(e => ({ url: e.url, title: e.title, duration: e.duration })), {
      options: sub.options, saveDir: sub.saveDir, subfolder: sub.subfolder, source: { type: 'subscription', id: sub.id, title: sub.title },
    });
  }

  // 한 구독을 확인한다. 새 영상은 알림 목록(pending)에 기록만 하고 대기열에는 넣지 않는다. 결과 {newCount, queued(항상 0), error}.
  async check(id, { signal } = {}) {
    const sub = this.subs.get(id); if (!sub) throw new Error('구독을 찾을 수 없습니다.');
    const key = e => e.id || e.url;
    try {
      const feed = await this.lister(sub.url, { end: CHECK_WINDOW, signal });
      const entries = (feed.entries || []).filter(e => !e.unavailable);
      const known = new Set(sub.known);
      let fresh = entries.filter(e => !known.has(key(e)));
      const overflow = Math.max(0, sub.pending.length + fresh.length - MAX_PENDING);
      sub.lastCheck = this.now(); sub.lastError = null; sub.lastNewCount = fresh.length;
      const queued = 0; // 자동 다운로드 없음
      sub.pending = [...fresh.map(e => ({ key: String(key(e)), url: e.url, title: String(e.title || ''), duration: Number.isFinite(e.duration) ? e.duration : null })), ...sub.pending].slice(0, MAX_PENDING);
      for (const e of fresh) known.add(key(e));
      sub.known = [...known].slice(-MAX_KNOWN);
      if (feed.title) sub.title = feed.title;
      this._save(); this.emit('change');
      this.emit('checked', { id, newCount: fresh.length, queued, overflow });
      return { newCount: fresh.length, queued, overflow, error: null };
    } catch (e) {
      sub.lastCheck = this.now(); sub.lastError = translateError(e.raw || e.message).message; this._save(); this.emit('change');
      return { newCount: 0, queued: 0, error: sub.lastError };
    }
  }

  async checkAll() { const out = {}; for (const s of [...this.subs.values()]) if (s.enabled) out[s.id] = await this.check(s.id); return out; }

  // 주기 확인 시작/중지. 주기는 설정의 subscriptionIntervalMin.
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), TICK_MS); this._timer.unref?.();
    setTimeout(() => this._tick(), 15000).unref?.();
  }
  stop() { clearInterval(this._timer); this._timer = null; }
  async _tick() {
    if (this._busy) return; this._busy = true;
    try {
      const every = this.getSettings().subscriptionIntervalMin * 60000;
      for (const s of [...this.subs.values()]) if (s.enabled && this.now() - (s.lastCheck || 0) >= every) await this.check(s.id);
    } finally { this._busy = false; }
  }
}

module.exports = { SubscriptionManager, CHECK_WINDOW, MAX_PENDING };
