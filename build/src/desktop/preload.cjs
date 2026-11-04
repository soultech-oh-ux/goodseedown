'use strict';
// 화면(렌더러)에 노출하는 좁은 창구. 화면은 파일 시스템·프로세스에 직접 접근하지 못하고 아래 함수만 쓴다.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke('gsd:' + ch, ...a);
const on = (ch, cb) => { const h = (_e, p) => { try { cb(p); } catch { } }; ipcRenderer.on('gsd:' + ch, h); return () => ipcRenderer.removeListener('gsd:' + ch, h); };

contextBridge.exposeInMainWorld('gsd', {
  appInfo: () => invoke('app-info'),
  getSettings: () => invoke('settings-get'),
  setSettings: patch => invoke('settings-set', patch),
  pickFolder: () => invoke('pick-folder'),
  classify: url => invoke('classify', url),
  analyze: (url, opts) => invoke('analyze', url, opts),
  cancelAnalyze: () => invoke('analyze-cancel'),
  addDownloads: req => invoke('add-downloads', req),
  listJobs: () => invoke('jobs-list'),
  job: (action, id) => invoke('job', action, id),
  jobsAll: action => invoke('jobs-all', action),
  openFolder: id => invoke('open-folder', id),
  openFile: id => invoke('open-file', id),
  openSaveDir: () => invoke('open-save-dir'),
  subs: { list: () => invoke('subs-list'), add: req => invoke('subs-add', req), remove: id => invoke('subs-remove', id), enable: (id, v) => invoke('subs-enable', id, v), check: id => invoke('subs-check', id), download: (id, keys) => invoke('subs-download', id, keys), dismiss: (id, keys) => invoke('subs-dismiss', id, keys) },
  engine: { info: () => invoke('engine-info'), checkAndOffer: () => invoke('engine-check') },
  checkAppUpdate: () => invoke('app-update-check'),
  appUpdateInfo: () => invoke('app-update-info'),
  appUpdateStart: () => invoke('app-update-start'),
  onAppUpdate: cb => on('app-update-available', cb),
  showLicenses: () => invoke('show-licenses'),
  showNotice: () => invoke('show-notice'),
  readClipboard: () => invoke('clipboard-read'),
  openAuthor: () => invoke('open-author'),
  onShowAbout: cb => on('show-about', cb),
  onJobs: cb => on('jobs', cb),
  onJobsRemoved: cb => on('jobs-removed', cb),
  onSubs: cb => on('subs', cb),
  onSettings: cb => on('settings', cb),
  onToast: cb => on('toast', cb),
  onEngineProgress: cb => on('engine-progress', cb),
});
