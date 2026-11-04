'use strict';
// goodseedown 메인 프로세스 — 창·메뉴·IPC·클립보드 감지·앱/엔진 업데이트. 다운로드 로직은 engine\ 에 있다.
const electronMod = (() => { try { return require('electron'); } catch { return null; } })();
const { app, BrowserWindow, dialog, Menu, shell, ipcMain, clipboard } = (electronMod && typeof electronMod === 'object') ? electronMod : {};
const fs = require('node:fs');
const path = require('node:path');

if (app && typeof app.whenReady === 'function') {
  const { createEngine } = require('../engine/index.cjs');
  const { createUpdater } = require('./updater.cjs');
  const { extractUrls } = require('../engine/util.cjs');

  const APP_NAME = 'goodseedown';
  const appDataRoot = process.env.LOCALAPPDATA || app.getPath('appData');
  const base = process.env.GOODSEEDOWN_DATA_ROOT || path.join(appDataRoot, 'goodseedown');
  fs.mkdirSync(base, { recursive: true });
  app.setPath('userData', path.join(base, 'electron'));
  app.setName(APP_NAME);
  if (typeof app.setAppUserModelId === 'function') app.setAppUserModelId('kr.goodseed.down');
  if (process.env.GOODSEEDOWN_DEBUG_PORT && /^\d{1,5}$/.test(process.env.GOODSEEDOWN_DEBUG_PORT)) app.commandLine.appendSwitch('remote-debugging-port', process.env.GOODSEEDOWN_DEBUG_PORT);

  const root = path.resolve(__dirname, '..');
  const toolsDir = process.env.GOODSEEDOWN_TOOLS_DIR || (app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(root, '..', 'bundle', 'resources', 'tools'));
  const uiFile = path.join(root, 'ui', 'index.html');
  const uiUrlPrefix = require('node:url').pathToFileURL(path.join(root, 'ui')).href;

  let mainWindow = null, engine = null, updater = null;
  const lock = app.requestSingleInstanceLock();
  if (!lock) { app.quit(); } else {
    app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

    const send = (ch, payload) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('gsd:' + ch, payload); } catch { } };
    const toast = (text, kind = 'info') => send('toast', { text, kind });
    const win = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined);

    // ---------- 엔진 업데이트(사용자 확인 후) ----------
    let engineBusy = false;
    async function engineCheckAndOffer({ manual }) {
      if (engineBusy) { if (manual) toast('엔진 업데이트를 이미 확인하는 중입니다.'); return { busy: true }; }
      engineBusy = true;
      try {
        let c;
        try { c = await engine.engine.check(); }
        catch (e) { if (manual) await dialog.showMessageBox(win(), { type: 'warning', title: 'yt-dlp 엔진', message: '엔진 업데이트 정보를 가져오지 못했습니다.', detail: `인터넷 연결을 확인한 뒤 다시 시도해주세요.\n(${e.message})`, buttons: ['확인'], noLink: true }); return { error: e.message }; }
        if (!c.updateAvailable) {
          if (manual) await dialog.showMessageBox(win(), { type: 'info', title: 'yt-dlp 엔진', message: '엔진이 최신 버전입니다.', detail: `현재 엔진: ${c.current || '알 수 없음'}\n최신 릴리스: ${c.latest}`, buttons: ['확인'], noLink: true });
          return { updated: false, current: c.current, latest: c.latest };
        }
        if (!c.hasAssets) { if (manual) await dialog.showMessageBox(win(), { type: 'warning', title: 'yt-dlp 엔진', message: `새 엔진 ${c.latest} 의 배포 파일이 아직 준비되지 않았습니다.`, buttons: ['확인'], noLink: true }); return { error: 'assets' }; }
        const size = c.size ? `\n받을 용량: 약 ${(c.size / 1048576).toFixed(1)} MB` : '';
        const r = await dialog.showMessageBox(win(), { type: 'question', title: 'yt-dlp 엔진 업데이트', message: `새 yt-dlp 엔진 ${c.latest} 이(가) 있습니다.`, detail: `현재 엔진: ${c.current || '알 수 없음'}\n새 엔진: ${c.latest}${size}\n\n엔진은 사이트 변경에 대응하는 다운로드 프로그램(yt-dlp)입니다. 업데이트하면 다운로드가 다시 잘 되는 경우가 많습니다. 내려받은 파일은 공식 해시(SHA-256)로 검증한 뒤 설치합니다.`, buttons: ['지금 업데이트', '나중에'], defaultId: 0, cancelId: 1, noLink: true });
        if (r.response !== 0) return { updated: false, declined: true };
        send('engine-progress', { phase: 'start', version: c.latest });
        try {
          const u = await engine.engine.update({ checked: c, onProgress: (got, total) => send('engine-progress', { phase: 'progress', got, total }) });
          send('engine-progress', { phase: 'done', version: u.version });
          toast(`yt-dlp 엔진을 ${u.version} 으로 업데이트했습니다.`, 'ok');
          return u;
        } catch (e) {
          send('engine-progress', { phase: 'error', message: e.message });
          await dialog.showMessageBox(win(), { type: 'error', title: 'yt-dlp 엔진 업데이트', message: '엔진을 업데이트하지 못했습니다.', detail: `${e.message}\n\n현재 엔진을 그대로 사용합니다.`, buttons: ['확인'], noLink: true });
          return { error: e.message };
        }
      } finally { engineBusy = false; }
    }

    // ---------- IPC ----------
    const isTrusted = e => { try { return !!e.senderFrame && e.senderFrame.url.startsWith(uiUrlPrefix); } catch { return false; } };
    const handle = (ch, fn) => ipcMain.handle('gsd:' + ch, async (e, ...args) => { if (!isTrusted(e)) throw new Error('허용되지 않은 호출입니다.'); return fn(...args); });
    const str = (v, max = 4096) => { if (typeof v !== 'string' || v.length > max) throw new Error('잘못된 입력입니다.'); return v; };
    // 저작자 소개 페이지 — 주소는 이 상수 하나뿐이고 화면에서 받은 주소는 쓰지 않는다. 기본 브라우저로 연다(앱 안에서 이동하지 않음).
    const AUTHOR_URL = 'https://ohkyoungkeun-namecard.vercel.app/';
    // 시험 전용: GOODSEEDOWN_TEST_OPEN_LOG 가 있으면 브라우저를 띄우지 않고 호출된 주소만 그 파일에 적는다.
    const openExternal = async url => { if (process.env.GOODSEEDOWN_TEST_OPEN_LOG) { fs.appendFileSync(process.env.GOODSEEDOWN_TEST_OPEN_LOG, 'shell.openExternal ' + url + '\n'); return; } await shell.openExternal(url); };
    const MEDIA_EXT = /\.(mp4|mkv|mp3|m4a|ogg|opus|webm|srt|vtt)$/i;

    function registerIpc() {
      handle('app-info', async () => ({ name: APP_NAME, version: app.getVersion(), dataDir: base, toolsDir, ytdlpVersion: await engine.engine.currentVersion(), engineInfo: engine.engine.info(), packaged: app.isPackaged }));
      handle('settings-get', () => engine.getSettings());
      handle('settings-set', patch => engine.setSettings(patch));
      handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win(), { title: '저장 폴더 선택', defaultPath: engine.getSettings().saveDir, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
      handle('classify', url => engine.classify(str(url, 2100)));
      handle('analyze', async (url, opts) => { try { return { ok: true, result: await engine.analyze(str(url, 2100), { mode: opts && opts.mode === 'video' ? 'video' : opts && opts.mode === 'list' ? 'list' : 'auto', end: opts && opts.end }) }; } catch (e) { const { translateError } = require('../engine/util.cjs'); return { ok: false, code: e.code || '', error: e.code === 'bad-url' || e.code === 'aborted' ? e.message : translateError(e.raw || e.message).message }; } });
      handle('analyze-cancel', () => engine.cancelAnalyze());
      handle('add-downloads', req => { if (!req || !Array.isArray(req.items)) throw new Error('잘못된 입력입니다.'); return engine.addDownloads({ items: req.items.map(i => ({ url: str(i.url, 2100), title: typeof i.title === 'string' ? i.title.slice(0, 500) : undefined, duration: Number.isFinite(i.duration) ? i.duration : undefined, index: Number.isInteger(i.index) ? i.index : undefined })), options: req.options, saveDir: typeof req.saveDir === 'string' ? req.saveDir : undefined, subfolder: typeof req.subfolder === 'string' ? req.subfolder.slice(0, 200) : '', indexPrefix: !!req.indexPrefix, source: req.source }); });
      handle('jobs-list', () => engine.downloads.list());
      handle('job', async (action, id) => {
        id = str(id, 64);
        switch (action) {
          case 'pause': return engine.downloads.pause(id);
          case 'resume': return engine.downloads.resume(id);
          case 'cancel': return engine.downloads.cancel(id);
          case 'retry': return engine.downloads.retry(id);
          case 'remove': return engine.downloads.remove(id);
          default: throw new Error('알 수 없는 동작입니다.');
        }
      });
      handle('jobs-all', async action => {
        switch (action) {
          case 'pause': return engine.downloads.pauseAll();
          case 'resume': return engine.downloads.resumeAll();
          case 'clear': return engine.downloads.clearFinished();
          default: throw new Error('알 수 없는 동작입니다.');
        }
      });
      handle('open-folder', id => { const j = engine.downloads.get(str(id, 64)); if (!j) return false; const f = (j.files || []).find(x => { try { return fs.existsSync(x); } catch { return false; } }); if (f) { shell.showItemInFolder(f); return true; } if (fs.existsSync(j.outDir)) { shell.openPath(j.outDir); return true; } return false; });
      handle('open-file', async id => { const j = engine.downloads.get(str(id, 64)); if (!j || j.status !== 'completed') return false; const f = (j.files || []).find(x => MEDIA_EXT.test(x) && fs.existsSync(x)); if (!f) return false; const err = await shell.openPath(f); return !err; });
      handle('open-save-dir', async () => { const d = engine.getSettings().saveDir; fs.mkdirSync(d, { recursive: true }); return !(await shell.openPath(d)); });
      handle('subs-list', () => engine.subscriptions.list());
      handle('subs-add', async req => { try { const s = await engine.subscriptions.add({ url: str(req && req.url, 2100), options: req && req.options, saveDir: req && typeof req.saveDir === 'string' ? req.saveDir : undefined }); return { ok: true, sub: s }; } catch (e) { const { translateError } = require('../engine/util.cjs'); return { ok: false, error: ['bad-url', 'duplicate', 'not-a-feed'].includes(e.code) ? e.message : translateError(e.raw || e.message).message }; } });
      handle('subs-remove', id => engine.subscriptions.remove(str(id, 64)));
      handle('subs-enable', (id, v) => engine.subscriptions.setEnabled(str(id, 64), !!v));
      handle('subs-check', async id => engine.subscriptions.check(str(id, 64)));
      handle('subs-download', (id, keys) => engine.subscriptions.download(str(id, 64), Array.isArray(keys) ? keys.map(k => str(k, 300)) : undefined));  // 사용자가 [받기]를 눌렀을 때만
      handle('subs-dismiss', (id, keys) => engine.subscriptions.dismiss(str(id, 64), Array.isArray(keys) ? keys.map(k => str(k, 300)) : undefined));
      handle('engine-info', async () => ({ version: await engine.engine.currentVersion(), ...engine.engine.info() }));
      handle('engine-check', () => engineCheckAndOffer({ manual: true }));
      handle('app-update-check', () => updater.check({ manual: true }));
      handle('app-update-info', () => updater.getAvailable());   // 화면 상단 '새 버전' 배너용 — 시작 시 자동 확인 결과(없으면 null)
      handle('app-update-notice', () => updater.takeUpdatedNotice());   // 업데이트 직후 첫 실행의 '업데이트되었습니다' 안내(한 번만)
      handle('app-update-start', () => updater.upgrade());        // 배너의 [업그레이드]를 눌렀을 때만(자동 설치 없음)
      handle('show-licenses', () => showLicenses());
      handle('show-notice', () => showNotice());
      handle('open-author', async () => { try { await openExternal(AUTHOR_URL); return { ok: true, url: AUTHOR_URL }; } catch (e) { return { ok: false, error: e.message }; } });
      handle('clipboard-read', async () => extractUrls(String(await clipboard.readText() || '')));  // Electron 45 의 clipboard.readText 는 Promise 를 돌려준다(이전 버전은 문자열) — 둘 다 받도록 await
    }

    const NOTICE = '저작권이 있는 콘텐츠는 권리자의 허락을 받았거나 개인적으로 이용할 수 있는 범위에서만 내려받으세요.\nDRM(복제 방지)으로 보호된 콘텐츠를 우회하는 기능은 없으며, 앞으로도 넣지 않습니다.\n내려받은 영상을 다시 올리거나 배포하는 것은 각 사이트의 약관과 저작권법에 따라 제한될 수 있습니다. 이용에 대한 책임은 사용자에게 있습니다.';
    function showNotice() { return dialog.showMessageBox(win(), { type: 'info', title: '저작권 안내', message: '저작권 안내', detail: NOTICE, buttons: ['확인'], noLink: true }); }
    function showLicenses() {
      const dir = app.isPackaged ? path.join(process.resourcesPath, 'tools') : toolsDir;
      return dialog.showMessageBox(win(), { type: 'info', title: '오픈소스 라이선스', message: 'goodseedown 이 사용하는 오픈소스', detail: 'yt-dlp — Unlicense (공개 도메인)\nffmpeg — GPLv3 (gyan.dev essentials 빌드)\nHDiffPatch — MIT (차등 업데이트)\nElectron·Chromium — MIT/BSD 등\n\n라이선스 전문과 출처는 아래 폴더의 파일에 들어 있습니다:\n' + dir, buttons: ['폴더 열기', '닫기'], defaultId: 1, cancelId: 1, noLink: true }).then(r => { if (r.response === 0) shell.openPath(dir); });
    }

    function buildMenu() {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: '파일', submenu: [{ label: '저장 폴더 열기', click: () => { const d = engine.getSettings().saveDir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); } }, { type: 'separator' }, { role: 'quit', label: '종료' }] },
        { label: '보기', submenu: [{ role: 'reload', label: '새로고침' }, { role: 'togglefullscreen', label: '전체 화면' }, { role: 'resetzoom', label: '화면 배율 초기화' }, { role: 'zoomin', label: '확대' }, { role: 'zoomout', label: '축소' }] },
        { label: '도구', submenu: [{ label: 'yt-dlp 엔진 업데이트 확인…', click: () => engineCheckAndOffer({ manual: true }) }] },
        { label: '도움말', submenu: [{ label: '업데이트 확인…', click: () => updater.check({ manual: true }) }, { type: 'separator' }, { label: '저작권 안내', click: showNotice }, { label: '오픈소스 라이선스', click: showLicenses }, { type: 'separator' }, { label: 'goodseedown 정보', click: () => send('show-about', null) }] },
      ]));
    }

    // 클립보드는 자동으로 읽지 않는다(오너 지시: 자동 감지·자동 채움·자동 시작 금지). 사용자가 [붙여넣기]를 눌렀을 때만 'clipboard-read' 로 읽는다.

    app.whenReady().then(async () => {
      try {
        // 시험 전용: GOODSEEDOWN_TEST_YTDLP_ARGS(JSON 배열)로 받는 속도 제한·구간 지정만 넘길 수 있다(그 밖의 인자는 무시).
        const testExtraArgs = (() => {
          try {
            const raw = JSON.parse(process.env.GOODSEEDOWN_TEST_YTDLP_ARGS || '[]'); const out = [];
            for (let i = 0; i + 1 < raw.length + 1 && Array.isArray(raw); i += 2) { if ((raw[i] === '--limit-rate' && /^\d+[KM]?$/.test(String(raw[i + 1]))) || (raw[i] === '--download-sections' && /^\*\d+-\d+$/.test(String(raw[i + 1])))) out.push(raw[i], String(raw[i + 1])); }
            return out;
          } catch { return []; }
        })();
        engine = createEngine({ dataDir: base, toolsDir, defaultSaveDir: path.join(app.getPath('videos'), 'goodseedown'), defaultMp3Dir: path.join(app.getPath('music'), 'goodseedown'), testExtraArgs });
        // 변경된 작업을 모아 한꺼번에 화면에 보낸다.
        const dirty = new Map(); let flushTimer = null;
        engine.events.on('job', j => { dirty.set(j.id, j); if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; const arr = [...dirty.values()]; dirty.clear(); send('jobs', arr); }, 200); });
        engine.events.on('removed', id => send('jobs-removed', id));
        engine.events.on('subs', () => send('subs', engine.subscriptions.list()));
        engine.events.on('settings', s => send('settings', s));
        engine.events.on('completed', j => { if (!win() || !win().isFocused()) { try { const { Notification } = electronMod; if (Notification && Notification.isSupported()) new Notification({ title: '다운로드 완료', body: j.title }).show(); } catch { } } });
        engine.subscriptions.on('checked', c => { if (c.newCount > 0) toast(`구독에서 새 영상 ${c.newCount}개를 찾았어요. 자동으로 받지 않습니다 — 구독 탭에서 받을 영상을 직접 눌러 주세요.`, 'ok'); });
        engine.subscriptions.start();
        registerIpc();
        mainWindow = new BrowserWindow({
          width: 1180, height: 820, minWidth: 880, minHeight: 620, show: false, title: 'goodseedown — 동영상 다운로더', backgroundColor: '#101614', autoHideMenuBar: true,
          icon: path.join(__dirname, 'icon.ico'),
          webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
        });
        updater = createUpdater({ app, dialog, BrowserWindow, ipcMain, shell, getMainWindow: () => mainWindow, base, isBusy: () => engine.downloads.isBusy(), pauseAll: () => engine.downloads.pauseAll() });
        buildMenu();
        mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        mainWindow.webContents.on('will-navigate', e => e.preventDefault());
        mainWindow.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
        mainWindow.once('ready-to-show', () => {
          if (process.env.GOODSEEDOWN_SMOKE_TEST) return;
          mainWindow.show();
          updater.onAppReady({ autoCheck: true });
          setTimeout(() => { if (engine.getSettings().engineAutoCheck) engineCheckAndOffer({ manual: false }).catch(() => { }); }, 25000).unref?.();
        });
        await mainWindow.loadFile(uiFile);
        if (process.env.GOODSEEDOWN_SMOKE_TEST) {
          const ytv = await engine.engine.currentVersion();
          const report = { ready: true, title: mainWindow.getTitle(), appName: app.getName(), version: app.getVersion(), packaged: app.isPackaged, toolsDir, ytdlp: fs.existsSync(path.join(toolsDir, 'yt-dlp.exe')), ffmpeg: fs.existsSync(path.join(toolsDir, 'ffmpeg.exe')), hpatchz: fs.existsSync(path.join(toolsDir, 'hpatchz.exe')), ytdlpVersion: ytv, data: base, launcherExe: process.env.GOODSEEDOWN_LAUNCHER_EXE || null };
          fs.writeFileSync(process.env.GOODSEEDOWN_SMOKE_TEST, JSON.stringify(report, null, 2));
          setTimeout(() => app.quit(), 1500);
        }
      } catch (error) {
        if (process.env.GOODSEEDOWN_SMOKE_TEST) fs.writeFileSync(process.env.GOODSEEDOWN_SMOKE_TEST, JSON.stringify({ ready: false, error: error.stack }));
        else dialog.showErrorBox('goodseedown 실행 오류', error.message);
        app.quit();
      }
    });
    app.on('window-all-closed', () => app.quit());
    let quitting = false;
    app.on('before-quit', e => {
      if (quitting || !engine) return;
      e.preventDefault(); quitting = true;
      engine.shutdown().catch(() => { }).finally(() => app.exit(0));
    });
  }
}
