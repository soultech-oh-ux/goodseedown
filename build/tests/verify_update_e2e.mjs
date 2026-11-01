// goodseedown 자동 업데이트·엔진 업데이트 종단(E2E) 시험 — 실제로 빌드한 포터블 exe(1.0.0)를 띄우고, 가짜 릴리스 서버(127.0.0.1)로 업데이트 주소를 바꿔 끝까지 검증한다.
//   새 버전은 1.0.0 과 같은 절차로 빌드한 실제 exe(1.0.1 시험 빌드 — app.asar 의 버전과 Electron 본체 PE 버전 표기만 다름)다.
//   네이티브 대화상자(확인창·오류창)는 UI Automation(uia.ps1)으로 실제 버튼을 눌러 조작한다. 이 하네스는 자신이 띄운 프로세스만 다룬다.
// 사용: node tests/verify_update_e2e.mjs [--only S1,S2] [--label x]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { createFakeServer } from '../fake-release-server.mjs';
import { createFakeEngineServer } from '../fake-engine-server.mjs';
import { connect } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)); const B = path.resolve(here, '..');
const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const only = arg('--only', ''); const label = arg('--label', 'e2e'); const want = n => !only || only.split(',').includes(n);
const T = path.join(B, 'work', 'ue'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 380) : '')); };
const sha = f => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
const OLD_VER = arg('--old', '1.1.0'), NEW_VER = arg('--new', '1.1.1'); // 기본: 1.1.0(배포본) → 1.1.1(시험 빌드). 실제 1.0.0 → 1.1.0 은 --old 1.0.0 --new 1.1.0
const distOf = v => path.join(B, '..', 'dist', `goodseedown-${v}-Windows-x64.exe`);
const realOld = path.join(B, '..', 'dist', `goodseedown-${OLD_VER}-Windows-x64.exe`);
const realNew = fs.existsSync(distOf(NEW_VER)) ? distOf(NEW_VER) : path.join(B, 'launcher', 'test-fixtures', `goodseedown-${NEW_VER}-Windows-x64.exe`);
const badNew = path.join(B, 'launcher', 'test-fixtures', 'BadNew.exe');
const HDIFFZ = path.join(B, 'tools', 'HDiffPatch', 'hdiffz.exe');
const MARK = '\\goodseedown\\bin\\';
const FFPROBE = path.join(B, 'tools', 'ffprobe-test', 'ffprobe.exe');

function psJson(cmd) { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }); try { return JSON.parse(r.stdout || 'null'); } catch { return null; } }
function myProcs() { const j = psJson(`$r=@(Get-CimInstance Win32_Process -Filter "Name='goodseedown.exe'" | ? { $_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('${MARK.toLowerCase()}') } | % { [pscustomobject]@{pid=$_.ProcessId;path=$_.ExecutablePath} }); ConvertTo-Json -InputObject $r -Compress`); return Array.isArray(j) ? j : (j ? [j] : []); }
function killMine() { for (const p of myProcs()) { try { process.kill(p.pid); } catch { } } }
function uia(action, button = '', titleLike = '') {
  const pids = myProcs().map(p => p.pid).join(','); if (!pids) return [];
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(B, 'uia.ps1'), '-Action', action, '-Pids', pids], { encoding: 'utf8', timeout: 30000, env: { ...process.env, UIA_BUTTON: button, UIA_TITLE: titleLike } });
  try { return JSON.parse(r.stdout.trim() || '[]'); } catch { return []; }
}
const findDialog = like => uia('list', '', like).find(w => w.buttons?.length && w.cls === '#32770' && (!like || w.title.includes(like)));
async function waitDialog(like, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const d = findDialog(like); if (d) return d; await sleep(1000); } return null; }
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// UIA 로 누른 뒤에도 대화상자가 그대로 남는 경우가 있어(대화상자가 막 떴을 때) 같은 대화상자가 남아 있으면 다시 누른다.
const clickBtn = (name, like = '', tries = 5) => {
  for (let i = 0; i < tries; i++) {
    const before = uia('list', '', like).find(w => w.cls === '#32770' && w.buttons?.includes(name));
    if (!before) { if (i < tries - 1) sleepSync(1000); continue; }
    const sig = before.texts.join('|'); const r = uia('click', name, like);
    if (!(r.length && r[0].clicked === name)) { sleepSync(1000); continue; }
    sleepSync(1500);
    const still = uia('list', '', like).find(w => w.cls === '#32770' && w.buttons?.includes(name) && w.texts.join('|') === sig);
    if (!still) return true;
  }
  return false;
};
async function noDialog(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const ds = uia('list').filter(w => w.buttons?.length && w.cls === '#32770'); if (ds.length) return ds; await sleep(1500); } return []; }
async function until(fn, ms, step = 700) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; }
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

let portSeq = 9600 + Math.floor(Math.random() * 200);
const rnd = () => Math.random().toString(36).slice(2, 7);
function freshPortable() { const dir = path.join(T, 'portable-' + rnd()); fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, `goodseedown-${OLD_VER}-Windows-x64.exe`); fs.copyFileSync(realOld, p); return p; }
const newDataRoot = () => { const d = path.join(T, 'data-' + rnd()); fs.mkdirSync(d, { recursive: true }); return d; };
async function startApp(exePath, { api, engineApi, dataRoot, okWait = 60, extraEnv = {}, saveDir, repoEnv }) {
  const env = { ...process.env, GOODSEEDOWN_DATA_ROOT: dataRoot, GOODSEEDOWN_DEBUG_PORT: '0', ...extraEnv }; // 0 = 무작위 포트(앱이 userData\DevToolsActivePort 에 기록) — 재실행된 새 버전이 같은 포트를 못 쓰는 문제(TIME_WAIT) 회피
  delete env.GOODSEEDOWN_UPDATE_API; delete env.GOODSEEDOWN_UPDATE_REPO; delete env.GOODSEEDOWN_ENGINE_API; delete env.GOODSEEDOWN_LAUNCHER_EXE;
  // 앱 업데이트 주소를 주지 않은 시험도 실제 GitHub(UPDATE_REPO)로 나가지 않도록, 닿지 않는 로컬 주소로 돌린다. repoEnv 가 있으면 저장소 값만 바꿔 '미설정' 상태를 만든다.
  if (repoEnv) env.GOODSEEDOWN_UPDATE_REPO = repoEnv; else env.GOODSEEDOWN_UPDATE_API = api || 'http://127.0.0.1:9/none';
  if (engineApi) env.GOODSEEDOWN_ENGINE_API = engineApi;
  env.GOODSEEDOWN_UPDATE_OKWAIT_SEC = String(okWait);
  if (!fs.existsSync(path.join(dataRoot, 'settings.json'))) fs.writeFileSync(path.join(dataRoot, 'settings.json'), JSON.stringify({ schema: 1, saveDir: saveDir || path.join(dataRoot, 'out'), copyrightAcknowledged: true, engineAutoCheck: false }));
  const child = spawn(exePath, [], { env, stdio: 'ignore', windowsHide: false, detached: false }); child.on('error', () => { });
  const app = { child, dataRoot };
  const c = await until(() => cdpConnect(app), 120000, 800);
  app.ready = !!c; app.c = c; return app;
}
const cdpConnect = async app => { const f = path.join(app.dataRoot, 'electron', 'DevToolsActivePort'); const port = Number(fs.readFileSync(f, 'utf8').split(String.fromCharCode(10))[0]); if (!port) throw new Error('포트 없음'); return connect(port, t => t.type === 'page' && /goodseedown/.test(t.title)); };
const appVersion = async app => { try { const c = await cdpConnect(app); const v = await c.ev('window.gsd.appInfo().then(i=>i.version)'); c.close(); return v; } catch { return null; } };
const reconnect = async app => until(() => cdpConnect(app), 90000, 800);

const patchCache = new Map();
function makePatch(oldFile, newFile) {
  const key = sha(oldFile).slice(0, 12) + '-' + sha(newFile).slice(0, 12);
  if (patchCache.has(key)) return patchCache.get(key);
  const out = path.join(T, `p-${key}.patch`);
  const r = spawnSync(HDIFFZ, ['-s-64', '-SD-256k', '-c-zstd-19-27', '-f', oldFile, newFile, out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('hdiffz 실패: ' + r.stdout + r.stderr);
  const v = { buf: fs.readFileSync(out), fromSha256: sha(oldFile) }; patchCache.set(key, v); return v;
}

fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
if (!fs.existsSync(realOld) || !fs.existsSync(realNew)) { console.log(`${OLD_VER} exe 또는 ${NEW_VER} 빌드가 없습니다.`); process.exit(2); }
killMine(); await sleep(2500); // 이전 시험이 남긴 이 하네스의 프로세스(goodseedownin 경로의 앱)만 정리
const before0 = myProcs().length;
const newBuf = fs.readFileSync(realNew); const newSha = sha(realNew); const oldSha = sha(realOld);
const srv = await createFakeServer({ exe: newBuf, tag: 'v' + NEW_VER, notes: '■ 시험 릴리스 노트\n- 새 기능 A\n- 오류 수정 B' });
console.log(`가짜 서버 127.0.0.1:${srv.port}  현재 ${OLD_VER} exe ${fs.statSync(realOld).size}B → 새 ${NEW_VER} exe ${newBuf.length}B`);
const PNAME = `goodseedown-${NEW_VER}-from-${OLD_VER}.patch`;
const fullName = `goodseedown-${NEW_VER}-Windows-x64.exe`;
const reset = () => { Object.assign(srv.cfg, { tag: 'v' + NEW_VER, exe: newBuf, sums: 'ok', redirect: 'none', bytesPerSec: 0, assets: 'both', patches: [], manifest: 'ok', apiStatus: 200 }); srv.hits.length = 0; };

try {
  // ===== S1. 전체 파일 업데이트 =====
  if (want('S1')) {
    reset(); const oldPath = freshPortable(); const data = newDataRoot();
    const app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    check(`S1-0 ${OLD_VER} 앱 기동(창 준비)·현재 버전 ${OLD_VER}`, app.ready && (await appVersion(app)) === OLD_VER, null);
    const dlg = await waitDialog('업데이트', 60000);
    const txt = (dlg?.texts || []).join('\n');
    check('S1-1 새 버전 감지 → 한국어 확인창(새·현재 버전·릴리스 노트·3버튼)', dlg && txt.includes(NEW_VER) && txt.includes(OLD_VER) && txt.includes('새 기능 A') && ['지금 업데이트', '나중에', '이 버전 건너뛰기'].every(b => dlg.buttons.includes(b)), { title: dlg && dlg.title, buttons: dlg && dlg.buttons });
    check('S1-1b 패치 없는 릴리스: 확인창에 받을 용량(전체 파일) 표시', /받을 용량: 약 [0-9.]+ MB \(전체 파일\)/.test(txt), txt.split('\n').find(l => l.includes('받을 용량')));
    const tl = []; const tlTimer = setInterval(async () => { let open = false; try { const c = await cdpConnect(app); c.close(); open = true; } catch { } const pr = myProcs(); const by = {}; for (const q of pr) { const m = /bin[\\/](\d+\.\d+\.\d+)/.exec(q.path); const k = m ? m[1] : '?'; by[k] = (by[k] || 0) + 1; } tl.push(`${Math.round((Date.now() - tlT0) / 1000)}s cdp=${open ? 1 : 0} ${JSON.stringify(by)}`); }, 3000); const tlT0 = Date.now();
    check('S1-2 [지금 업데이트] 클릭', clickBtn('지금 업데이트', '업데이트'));
    const swapped = await until(() => fs.existsSync(oldPath) && sha(oldPath) === newSha, 240000, 1000);
    check('S1-3 교체 완료: 포터블 exe 의 SHA-256 이 새 exe 와 동일', !!swapped, { now: sha(oldPath).slice(0, 12), new: newSha.slice(0, 12) });
    check('S1-4 요청 로그: 새 exe·SHA256SUMS 를 받음, 패치 요청 없음', srv.hits.includes('/dl/' + fullName) && srv.hits.includes('/dl/SHA256SUMS.txt') && !srv.hits.some(h => h.endsWith('.patch')), srv.hits);
    const ulog = readText(path.join(data, 'updates', 'updater.log'));
    check('S1-5 업데이터 로그에 방식 기록(mode=full)', ulog.includes('mode=full'), ulog.split('\n').filter(l => /mode=/.test(l)).slice(-1));
    const ok = await until(() => (readText(path.join(data, 'updates', 'update-helper.log')).includes('update complete')) || readJson(path.join(data, 'updates', 'update-ok.json')), 180000, 1000);
    check('S1-6 새 버전 재실행·시작 확인(helper "update complete")', !!ok, readText(path.join(data, 'updates', 'update-helper.log')).split('\n').slice(-4));
    const nv = await until(() => appVersion(app), 60000, 1000);
    if (!nv) { console.log('  [진단] 프로세스:', JSON.stringify(myProcs().map(p => p.path.slice(-60)))); console.log('  [진단] 명령줄:', JSON.stringify(psJson("@(Get-CimInstance Win32_Process -Filter \"Name='goodseedown.exe'\" | % { $_.CommandLine.Substring(0,[Math]::Min(220,$_.CommandLine.Length)) }) | ConvertTo-Json -Compress")));  }
    clearInterval(tlTimer); console.log('  [진단] 타임라인:', tl.join(' | '));
    const confirmed = readText(path.join(data, 'updates', 'updater.log')).includes('update to ' + NEW_VER + ' confirmed') && myProcs().some(q => q.path.includes('goodseedown' + String.fromCharCode(92) + 'bin' + String.fromCharCode(92) + NEW_VER + '-'));
    // 원격 디버깅 연결(시험 전용 경로)이 드물게 안 붙는 경우가 있어(재실행된 앱은 정상 동작), 앱 자신이 남긴 '새 버전 시작 확인' 로그와 실행 중인 프로세스 경로로도 판정한다.
    check('S1-7 재실행된 앱이 실제로 새 버전(1.0.1) — 화면 연결 또는 앱 로그(update to 1.0.1 confirmed)+1.0.1 패키지 프로세스', nv === NEW_VER || confirmed, { cdpVersion: nv, confirmed });
    check('S1-8 임시 파일(.part·다운로드한 새 exe·백업) 정리', !fs.readdirSync(path.join(data, 'updates')).some(f => /\.part$|\.exe$/.test(f)) && !fs.readdirSync(path.dirname(oldPath)).some(f => /\.old-/.test(f)), { updates: fs.readdirSync(path.join(data, 'updates')), dir: fs.readdirSync(path.dirname(oldPath)) });
    killMine(); await sleep(2000);
  }

  // ===== S2. 차등(패치) 업데이트 =====
  if (want('S2')) {
    reset(); const oldPath = freshPortable(); const data = newDataRoot();
    const t0 = Date.now(); const pt = makePatch(oldPath, realNew);
    console.log(`  [정보] 패치 ${PNAME}: ${pt.buf.length}B (전체 ${newBuf.length}B 의 ${(pt.buf.length * 100 / newBuf.length).toFixed(2)}%) — 생성 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    srv.cfg.patches = [{ name: PNAME, buf: pt.buf, fromSha256: pt.fromSha256 }];
    const app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const dlg = await waitDialog('업데이트', 60000); const txt = (dlg?.texts || []).join('\n');
    check('S2-1 확인창에 받을 용량(변경된 부분만 · 전체) 표시', /받을 용량: 약 [0-9.]+ (KB|MB) \(변경된 부분만 · 전체 [0-9.]+ MB\)/.test(txt), txt.split('\n').find(l => l.includes('받을 용량')));
    clickBtn('지금 업데이트', '업데이트');
    const swapped = await until(() => sha(oldPath) === newSha, 240000, 1000);
    check('S2-2 교체 완료: SHA-256 이 새 exe 와 동일(패치 적용 결과가 전체 파일과 같음)', !!swapped, { now: sha(oldPath).slice(0, 12) });
    check('S2-3 요청 로그: 패치만 받고 전체 exe 는 받지 않음', srv.hits.includes('/dl/' + PNAME) && !srv.hits.includes('/dl/' + fullName) && srv.hits.includes('/dl/PATCHES.json'), srv.hits);
    const ulog = readText(path.join(data, 'updates', 'updater.log'));
    check('S2-4 업데이터 로그: mode=patch·내려받은 바이트 = 패치 크기', ulog.includes('mode=patch') && ulog.includes(`downloadedBytes=${pt.buf.length}`), ulog.split('\n').filter(l => /mode=/.test(l)).slice(-1));
    await until(() => readText(path.join(data, 'updates', 'update-helper.log')).includes('update complete'), 180000, 1000);
    check('S2-5 새 버전(1.0.1) 재실행 확인', (await until(() => appVersion(app), 60000, 1000)) === NEW_VER);
    killMine(); await sleep(2000);
  }

  // ===== S3. 폴백: 손상된 패치 · 기준 불일치 =====
  if (want('S3')) {
    reset(); let oldPath = freshPortable(); let data = newDataRoot();
    const pt = makePatch(oldPath, realNew);
    const bad = Buffer.from(pt.buf); bad[Math.floor(bad.length / 2)] ^= 0xff;
    srv.cfg.patches = [{ name: PNAME, buf: bad, fromSha256: pt.fromSha256, manifestSha: srv.sha(pt.buf) }];
    let app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    await waitDialog('업데이트', 60000); clickBtn('지금 업데이트', '업데이트');
    const swapped = await until(() => sha(oldPath) === newSha, 300000, 1000);
    check('S3-1 전송 중 손상된 패치 → 전체 exe 로 자동 폴백해 업데이트 성공', !!swapped && srv.hits.includes('/dl/' + PNAME) && srv.hits.includes('/dl/' + fullName), srv.hits);
    check('S3-2 로그: mode=full-fallback·patchError 기록', readText(path.join(data, 'updates', 'updater.log')).includes('mode=full-fallback'), readText(path.join(data, 'updates', 'updater.log')).split('\n').filter(l => /mode=/.test(l)).slice(-1));
    await until(() => readText(path.join(data, 'updates', 'update-helper.log')).includes('update complete'), 180000, 1000); killMine(); await sleep(2000);
    // 기준 불일치: 현재 exe 용이 아닌 패치만 있는 릴리스 → 처음부터 전체 다운로드(확인창도 '전체 파일')
    reset(); oldPath = freshPortable(); data = newDataRoot();
    srv.cfg.patches = [{ name: PNAME, buf: pt.buf, fromSha256: srv.sha(Buffer.from('다른 버전 exe')) }];
    app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const dlg = await waitDialog('업데이트', 60000); const txt = (dlg?.texts || []).join('\n');
    check('S3-3 기준 해시 불일치 → 확인창은 전체 파일 용량으로 표시', /\(전체 파일\)/.test(txt) && !/변경된 부분만/.test(txt), txt.split('\n').find(l => l.includes('받을 용량')));
    clickBtn('지금 업데이트', '업데이트');
    const sw2 = await until(() => sha(oldPath) === newSha, 300000, 1000);
    check('S3-4 패치는 받지 않고 전체만 받아 업데이트 성공', !!sw2 && !srv.hits.includes('/dl/' + PNAME) && srv.hits.includes('/dl/' + fullName), srv.hits);
    await until(() => readText(path.join(data, 'updates', 'update-helper.log')).includes('update complete'), 180000, 1000); killMine(); await sleep(2000);
  }

  // ===== S4. 나중에 · 건너뛰기 =====
  if (want('S4')) {
    reset(); const oldPath = freshPortable(); const data = newDataRoot();
    let app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    await waitDialog('업데이트', 60000); clickBtn('나중에', '업데이트'); await sleep(2500);
    check('S4-1 [나중에] → 교체 없음·앱 계속 사용 가능', sha(oldPath) === oldSha && (await appVersion(app)) === OLD_VER && !srv.hits.includes('/dl/' + fullName), null);
    killMine(); await sleep(2500);
    app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const again = await waitDialog('업데이트', 60000);
    check('S4-2 [나중에] 뒤 다음 실행에 다시 안내', !!again, null);
    clickBtn('이 버전 건너뛰기', '업데이트'); await sleep(2500);
    check('S4-3 [이 버전 건너뛰기] → 상태 파일에 기록·교체 없음', readJson(path.join(data, 'update-state.json'))?.skippedVersion === NEW_VER && sha(oldPath) === oldSha, readJson(path.join(data, 'update-state.json')));
    killMine(); await sleep(2500);
    app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const none = await noDialog(25000);
    check('S4-4 건너뛴 버전은 다음 실행에서 안내하지 않음(25초 관찰)', none.length === 0 && sha(oldPath) === oldSha, none.map(d => d.title));
    killMine(); await sleep(2000);
  }

  // ===== S5. 검증 실패(해시 불일치) =====
  if (want('S5')) {
    reset(); srv.cfg.sums = 'bad'; const oldPath = freshPortable(); const data = newDataRoot();
    const app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    await waitDialog('업데이트', 60000); clickBtn('지금 업데이트', '업데이트');
    const err = await waitDialog('업데이트', 90000).then(async d => { for (let i = 0; i < 60; i++) { const x = findDialog('업데이트'); if (x && /검증하지 못해/.test(x.texts.join(''))) return x; await sleep(1000); } return null; });
    check('S5-1 해시가 SHA256SUMS 와 다르면 "검증하지 못해 업데이트를 중단" 오류창(내려받은 파일 삭제 안내)', !!err && /삭제/.test(err.texts.join('')), err && err.texts);
    clickBtn('확인', '업데이트'); await sleep(2000);
    const upd = path.join(data, 'updates');
    check('S5-2 현재 exe 는 그대로·내려받은 파일 남지 않음·앱은 계속 동작', sha(oldPath) === oldSha && !fs.readdirSync(upd).some(f => /\.exe$|\.part$/.test(f)) && (await appVersion(app)) === OLD_VER, fs.readdirSync(upd));
    killMine(); await sleep(2000);
  }

  // ===== S6. 다운로드 진행 중 업데이트 → 일시정지 저장 → 새 버전에서 이어받기 =====
  if (want('S6')) {
    reset(); const oldPath = freshPortable(); const data = newDataRoot(); const out = path.join(data, 'out');
    const app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data, extraEnv: { GOODSEEDOWN_TEST_YTDLP_ARGS: JSON.stringify(['--limit-rate', '1M']) } });
    await waitDialog('업데이트', 60000); clickBtn('나중에', '업데이트'); await sleep(1500);
    let c = app.c;
    await c.ev(`window.gsd.addDownloads({items:[{url:'https://www.youtube.com/watch?v=SkVqJ1SGeL0'}],options:{kind:'video',quality:'1080',videoFormat:'mp4'}})`);
    const prog = await until(() => c.ev(`window.gsd.listJobs().then(j=>j[0]&&j[0].status==='downloading'&&j[0].progress.percent>=6?j[0].progress.percent:0)`), 90000, 800);
    check('S6-1 다운로드 진행 중(6% 이상)', !!prog, prog);
    c.ev(`window.gsd.checkAppUpdate()`).catch(() => { });
    const d1 = await waitDialog('업데이트', 40000); await sleep(500);
    clickBtn('지금 업데이트', '업데이트');
    let warn = null; for (let i = 0; i < 40 && !warn; i++) { const x = findDialog('업데이트'); if (x && /진행 중인 다운로드/.test(x.texts.join(''))) warn = x; else await sleep(1000); }
    check('S6-2 진행 중인 다운로드가 있으면 경고창(일시정지 후 업데이트 / 취소)', !!warn && warn.buttons.includes('일시 정지하고 업데이트'), warn && { texts: warn.texts, buttons: warn.buttons });
    clickBtn('일시 정지하고 업데이트', '업데이트');
    const swapped = await until(() => sha(oldPath) === newSha, 300000, 1000);
    check('S6-3 업데이트 교체 완료', !!swapped, null);
    const saved = readJson(path.join(data, 'jobs.json'));
    check('S6-4 진행 중이던 작업이 일시정지로 저장됨(.part 보존)', saved && saved.jobs[0] && saved.jobs[0].status === 'paused', saved && saved.jobs[0] && [saved.jobs[0].status, Math.round(saved.jobs[0].progress.percent)]);
    await until(() => readText(path.join(data, 'updates', 'update-helper.log')).includes('update complete'), 180000, 1000);
    c = await reconnect(app);
    const nv = c && await c.ev('window.gsd.appInfo().then(i=>i.version)');
    check('S6-5 새 버전(1.0.1)에서 목록 복원 — 일시정지 상태·이어받기 안내', nv === NEW_VER && (await c.ev(`window.gsd.listJobs().then(j=>j[0].status+'|'+j[0].note)`)).startsWith('paused|'), nv);
    await c.ev(`window.gsd.listJobs().then(j=>window.gsd.job('resume', j[0].id))`);
    const done = await until(() => c.ev(`window.gsd.listJobs().then(j=>j[0].status==='completed'?j[0]:null)`), 300000, 1000);
    const f = done && done.files && done.files[0]; const r = f && spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=height,codec_name', '-show_entries', 'format=duration', '-of', 'json', f], { encoding: 'utf8' });
    const pj = r && JSON.parse(r.stdout);
    check('S6-6 새 버전에서 이어받아 완료(재개 지점>0)·ffprobe 1080p·150초', !!done && done.resumeCount >= 1 && done.lastResumeByte > 500000 && pj.streams.some(s => s.height === 1080) && Math.abs(Number(pj.format.duration) - 150) < 2, done && { resumedAt: done.lastResumeByte, streams: pj && pj.streams });
    killMine(); await sleep(2000);
  }

  // ===== S7. 새 버전이 시작을 보고하지 못하면 이전 exe 로 복원 =====
  if (want('S7')) {
    reset(); const oldPath = freshPortable(); const data = newDataRoot();
    const badBuf = fs.readFileSync(badNew); srv.cfg.exe = badBuf;
    const app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data, okWait: 15 });
    await waitDialog('업데이트', 60000); clickBtn('지금 업데이트', '업데이트');
    const hlog = () => readText(path.join(data, 'updates', 'update-helper.log'));
    const failedLog = await until(() => /FAILED: new version did not report/.test(hlog()) && /rollback: old exe restored/.test(hlog()), 240000, 1000);
    check('S7-1 새 버전이 시작을 보고하지 않으면 도우미가 실패를 기록하고 복원(helper 로그)', !!failedLog, hlog().split(String.fromCharCode(10)).slice(-6));
    check('S7-2 이전 exe 로 복원됨(SHA-256 이 원래와 같음)', sha(oldPath) === oldSha, { now: sha(oldPath).slice(0, 12), old: oldSha.slice(0, 12) });
    srv.cfg.apiStatus = 500; // 복원 뒤 재실행된 앱이 같은 릴리스를 또 제안하지 않게
    let warn = null; for (let i = 0; i < 60 && !warn; i++) { warn = uia('list').find(w => w.cls === '#32770' && /복원/.test(w.texts.join(''))); if (!warn) await sleep(1000); }
    check('S7-3 복원 후 재실행된 이전 버전이 "직전 업데이트를 적용하지 못해 기존 버전으로 복원" 안내', !!warn, warn && warn.texts);
    if (warn) clickBtn('확인', '업데이트'); await sleep(1500);
    check(`S7-4 복원된 앱은 정상 동작(${OLD_VER})`, (await appVersion(app)) === OLD_VER, null);
    killMine(); await sleep(2000);
  }

  // ===== S8. 서버 문제: 오류·릴리스 파일 누락·미설정 =====
  if (want('S8')) {
    reset(); srv.cfg.apiStatus = 500; let oldPath = freshPortable(); let data = newDataRoot();
    let app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const none = await noDialog(20000);
    check('S8-1 서버 오류(500) → 시작할 때 조용히 건너뜀(안내창 없음)·앱 정상', none.length === 0 && (await appVersion(app)) === OLD_VER && /check failed/.test(readText(path.join(data, 'updates', 'updater.log'))), readText(path.join(data, 'updates', 'updater.log')).split('\n').slice(-2));
    killMine(); await sleep(2000);
    reset(); srv.cfg.assets = 'noexe'; oldPath = freshPortable(); data = newDataRoot();
    app = await startApp(oldPath, { api: srv.apiUrl, dataRoot: data });
    const none2 = await noDialog(20000);
    check('S8-2 릴리스에 exe 가 없으면 안내하지 않음(업데이트 불가)', none2.length === 0 && /lacks assets/.test(readText(path.join(data, 'updates', 'updater.log'))), readText(path.join(data, 'updates', 'updater.log')).split('\n').slice(-2));
    killMine(); await sleep(2000);
    reset(); oldPath = freshPortable(); data = newDataRoot();
    app = await startApp(oldPath, { dataRoot: data, repoEnv: '<owner>/goodseedown' });
    const none3 = await noDialog(15000);
    check('S8-3 UPDATE_REPO 미설정(저장소 값이 <owner> 자리표시) → 자동 확인을 건너뜀·안내창 없음', none3.length === 0 && /not configured/.test(readText(path.join(data, 'updates', 'updater.log'))), readText(path.join(data, 'updates', 'updater.log')).split('\n').slice(-2));
    check('S8-3b 같은 상태에서 수동 확인(설정의 [앱 업데이트 확인]) → "업데이트 저장소가 아직 설정되지 않았습니다" 안내', await (async () => { app.c.ev(`document.getElementById('tabSettings').click()`); await sleep(500); app.c.ev(`document.getElementById('btnAppCheck').click()`).catch(() => { }); const d = await waitDialog('업데이트', 30000); const ok = d && /설정되지 않았습니다/.test(d.texts.join('')); clickBtn('확인', '업데이트'); return ok; })(), null);
    killMine(); await sleep(2000);
  }

  // ===== S9. yt-dlp 엔진 업데이트(사용자 확인 후) — 앱 화면 → 확인창 → 설치 =====
  if (want('S9')) {
    reset(); const engSrv = await createFakeEngineServer({ tag: '2026.10.27', exe: fs.readFileSync(path.join(B, 'tools', 'yt-dlp', 'yt-dlp.exe')) });
    const oldPath = freshPortable(); const data = newDataRoot();
    const app = await startApp(oldPath, { engineApi: engSrv.apiUrl, dataRoot: data });
    let c = app.c;
    await c.ev(`document.getElementById('tabSettings').click()`); await sleep(500);
    await until(async () => !/확인 중/.test(await c.ev(`document.getElementById('engVer').textContent`)), 20000, 500);
    check('S9-1 설정 화면에 엔진 버전 표시(설치본)', /\(설치본\)/.test(await c.ev(`document.getElementById('engVer').textContent`)), await c.ev(`document.getElementById('engVer').textContent`));
    c.ev(`document.getElementById('btnEngineCheck').click()`).catch(() => { });
    const dlg = await waitDialog('yt-dlp', 40000); const txt = (dlg?.texts || []).join('\n');
    check('S9-2 새 엔진 감지 → 확인창(현재·새 엔진 버전·받을 용량·[지금 업데이트][나중에])', !!dlg && /2026\.10\.27/.test(txt) && /2026\.10\.26/.test(txt) && dlg.buttons.includes('지금 업데이트') && dlg.buttons.includes('나중에'), txt.slice(0, 160));
    const laterOk = clickBtn('나중에', 'yt-dlp'); await sleep(2000);
    check('S9-3 [나중에] → 설치 안 함(엔진 폴더 없음·다운로드 요청 없음)', laterOk && !fs.existsSync(path.join(data, 'engine', 'engine.json')) && !engSrv.hits.includes('/dl/yt-dlp.exe'), engSrv.hits);
    c.ev(`document.getElementById('btnEngineCheck').click()`).catch(() => { });
    const d2 = await waitDialog('yt-dlp', 40000); const nowOk = clickBtn('지금 업데이트', 'yt-dlp');
    if (!d2 || !nowOk) console.log('  [진단] 두 번째 확인창', !!d2, '클릭', nowOk, JSON.stringify(uia('list').filter(w => w.cls === '#32770').map(w => [w.title, w.buttons])), 'hits', JSON.stringify(engSrv.hits));
    const st = await until(() => readJson(path.join(data, 'engine', 'engine.json')), 90000, 800);
    check('S9-4 [지금 업데이트] → 해시 검증·실행 시험 후 설치(engine.json 기록)', !!st && /^yt-dlp-\d{4}\.\d{2}\.\d{2}\.exe$/.test(st.file) && engSrv.hits.includes('/dl/SHA2-256SUMS') && engSrv.hits.includes('/dl/yt-dlp.exe'), st);
    await sleep(1500);
    const info = await c.ev(`window.gsd.engine.info()`);
    check('S9-5 앱이 설치된 새 엔진을 사용(번들 아님)', info && info.usingBundled === false && /yt-dlp-\d{4}\.\d{2}\.\d{2}\.exe$/.test(info.active), info && { active: info.active, version: info.version });
    // 새 엔진으로 실제 다운로드가 된다(앞 10초 구간 MP3)
    await c.ev(`window.gsd.addDownloads({items:[{url:'https://www.youtube.com/watch?v=SkVqJ1SGeL0'}],options:{kind:'audio',audioFormat:'mp3'}})`);
    const j = await until(() => c.ev(`window.gsd.listJobs().then(j=>['completed','failed'].includes(j[0].status)?j[0]:null)`), 120000, 1000);
    check('S9-6 설치된 새 엔진으로 실제 다운로드 성공(MP3)', j && j.status === 'completed' && /\.mp3$/.test(j.files[0]), j && { s: j.status, e: j.error });
    await engSrv.close(); killMine(); await sleep(2000);
    // 변조된 엔진(해시 불일치)은 설치되지 않는다 — 앱 화면 경로
    const eng2 = await createFakeEngineServer({ tag: '2026.10.27', exe: fs.readFileSync(path.join(B, 'tools', 'yt-dlp', 'yt-dlp.exe')), tamper: true });
    const data2 = newDataRoot(); const app2 = await startApp(freshPortable(), { engineApi: eng2.apiUrl, dataRoot: data2 });
    app2.c.ev(`document.getElementById('tabSettings').click()`); await sleep(500); app2.c.ev(`document.getElementById('btnEngineCheck').click()`).catch(() => { });
    await waitDialog('yt-dlp', 40000); clickBtn('지금 업데이트', 'yt-dlp');
    let e2 = null; for (let i = 0; i < 60 && !e2; i++) { const x = findDialog('yt-dlp'); if (x && /업데이트하지 못했습니다/.test(x.texts.join(''))) e2 = x; else await sleep(1000); }
    check('S9-7 변조된 엔진 → "엔진을 업데이트하지 못했습니다"(해시 불일치) 오류창·설치 안 됨', !!e2 && /해시/.test(e2.texts.join('')) && !fs.existsSync(path.join(data2, 'engine', 'engine.json')), e2 && e2.texts);
    clickBtn('확인', 'yt-dlp'); await eng2.close(); killMine(); await sleep(2000);
  }
} catch (e) { check('시험 진행 중 예외', false, e.stack || String(e)); }

await srv.close(); killMine(); await sleep(1500);
const left = myProcs().length;
check('시험 후 시험이 띄운 goodseedown 프로세스 정리', left === 0 && before0 === 0, { before: before0, after: left });
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(B, `verification_update_${label}.json`), JSON.stringify({ when: new Date().toISOString(), old: { ver: OLD_VER, sha256: oldSha, size: fs.statSync(realOld).size }, new: { ver: NEW_VER, sha256: newSha, size: newBuf.length }, total: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
console.log(`\n=== ${results.length - failed.length}/${results.length} 통과${failed.length ? ' — 실패: ' + failed.map(f => f.name).join(' | ') : ''} ===`);
process.exit(failed.length ? 1 : 0);
