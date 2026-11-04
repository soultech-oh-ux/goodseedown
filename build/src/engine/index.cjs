'use strict';
// goodseedown 엔진 묶음 — 설정·다운로드 관리자·구독·엔진 업데이트를 하나로 묶는다. Electron 에 의존하지 않으므로 node 로 그대로 시험할 수 있다.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { readJson, writeJsonAtomic, normalizeUrl, extractUrls, sanitizeName } = require('./util.cjs');
const { normalizeSettings, normalizeOptions } = require('./settings.cjs');
const { DownloadManager } = require('./manager.cjs');
const { SubscriptionManager } = require('./subscriptions.cjs');
const { EngineManager } = require('./engine-update.cjs');
const Y = require('./ytdlp.cjs');

// opts: { dataDir, toolsDir, defaultSaveDir, env?, testExtraArgs?, lister?, autoRetryDelayMs? }
function createEngine(opts) {
  const events = new EventEmitter();
  const settingsFile = path.join(opts.dataDir, 'settings.json');
  fs.mkdirSync(opts.dataDir, { recursive: true });
  let settings = normalizeSettings(readJson(settingsFile, null), opts.defaultSaveDir, opts.defaultMp3Dir);
  const saveSettings = () => { try { writeJsonAtomic(settingsFile, settings); } catch (e) { events.emit('log', '설정 저장 실패: ' + e.message); } };
  if (!fs.existsSync(settingsFile)) saveSettings();

  const engine = new EngineManager({ dataDir: opts.dataDir, bundledPath: path.join(opts.toolsDir, 'yt-dlp.exe'), env: opts.env });
  const getTools = () => Y.locateTools({ toolsDir: opts.toolsDir, engineYtdlp: engine.activePath() });
  const downloads = new DownloadManager({ dataDir: opts.dataDir, getSettings: () => settings, getTools, testExtraArgs: opts.testExtraArgs, autoRetryDelayMs: opts.autoRetryDelayMs });
  // 구독용 목록 조회. 채널은 최신순이라 앞쪽 end 개만 보면 되지만, 재생목록은 새 영상이 끝에 붙는 것이 보통이라 전체를 읽는다(상한 2000개 — flat 조회라 빠르다).
  const lister = opts.lister || (async (url, { end, signal } = {}) => {
    const cls = Y.classifyUrl(url);
    const r = await Y.analyze(getTools(), url, { mode: cls.kind === 'choice' ? 'list' : 'auto', end: cls.kind === 'channel' ? end : Math.max(end || 0, 2000), signal });
    return r.type === 'playlist' ? r : null;
  });
  const subscriptions = new SubscriptionManager({ dataDir: opts.dataDir, lister, downloads, getSettings: () => settings });

  const pending = new Map(); // 분석 취소용
  let analyzeSeq = 0;

  const api = {
    events, downloads, subscriptions, engine,
    getTools,
    getSettings: () => JSON.parse(JSON.stringify(settings)),
    setSettings(patch) {
      const merged = { ...settings, ...(patch && typeof patch === 'object' ? patch : {}) };
      if (patch && patch.mp3) merged.mp3 = { ...settings.mp3, ...patch.mp3 };
      if (patch && patch.defaults) merged.defaults = { ...settings.defaults, ...patch.defaults, subs: { ...settings.defaults.subs, ...(patch.defaults.subs || {}) } };
      settings = normalizeSettings(merged, opts.defaultSaveDir, opts.defaultMp3Dir); saveSettings(); downloads.setMaxConcurrent(); events.emit('settings', api.getSettings());
      return api.getSettings();
    },
    classify(url) { const u = normalizeUrl(url); if (!u) return null; return Y.classifyUrl(u); },
    extractUrls,
    async analyze(url, { mode = 'auto', end = 0 } = {}) {
      const id = ++analyzeSeq; const ac = new AbortController(); pending.set(id, ac);
      try { return await Y.analyze(getTools(), url, { mode, end: Math.max(0, Math.min(5000, Math.trunc(Number(end)) || 0)), signal: ac.signal }); }
      finally { pending.delete(id); }
    },
    cancelAnalyze() { for (const ac of pending.values()) ac.abort(); },
    // items: [{url,title?,duration?,index?}] — 옵션이 없으면 설정의 기본값을 쓴다.
    addDownloads({ items, options, saveDir, subfolder, indexPrefix, source } = {}) {
      return downloads.addJobs(items, { options: normalizeOptions(options || {}, settings.defaults), saveDir, subfolder: subfolder ? sanitizeName(subfolder) : '', indexPrefix: !!indexPrefix, source });
    },
    async shutdown() { subscriptions.stop(); await downloads.shutdown(); },
  };
  downloads.on('job', j => events.emit('job', j));
  downloads.on('removed', id => events.emit('removed', id));
  downloads.on('completed', j => events.emit('completed', j));
  downloads.on('failed', j => events.emit('failed', j));
  subscriptions.on('change', () => events.emit('subs'));
  subscriptions.on('checked', c => events.emit('subs-checked', c));
  return api;
}

module.exports = { createEngine };
