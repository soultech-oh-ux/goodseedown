// goodseedown 화면(UI) 종단 시험 — 실제 앱(Electron)을 띄우고 원격 디버깅(CDP)으로 실제 클릭·입력을 하며 결과 파일을 ffprobe 로 확인한다.
//   --mode exe : 빌드한 포터블 exe(dist\goodseedown-1.2.1-Windows-x64.exe) / --mode dev : electron-base + src (빠른 반복)
// 앱 데이터 폴더는 격리(GOODSEEDOWN_DATA_ROOT)하고 저장 폴더도 work\vu 안으로 돌린다. 시험 영상은 모두 공개(CC-BY) Blender 영상이다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const B = path.resolve(here, '..');
const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const mode = arg('--mode', 'exe'); const label = arg('--label', mode); const only = arg('--only', '');
const want = n => !only || only.split(',').includes(n);
const FFPROBE = path.join(B, 'tools', 'ffprobe-test', 'ffprobe.exe');
const PORT = 9411;
const W = path.join(B, 'work', 'vu'); fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
const OUT = path.join(W, 'out'); const DATA = path.join(W, 'data');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const limit = (name, detail) => { results.push({ name, ok: true, limited: true, detail }); console.log('LIMIT ' + name + '  ' + JSON.stringify(detail)); }; const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 360) : '')); };
const until = async (fn, ms = 60000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; };
const exe = path.join(B, '..', 'dist', 'goodseedown-1.2.1-Windows-x64.exe');
const marker = mode === 'exe' ? '\\goodseedown\\bin\\' : path.join(B, 'electron-base').toLowerCase();
function mine() { const m = marker.replace(/'/g, "''").toLowerCase(); const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='goodseedown.exe' OR Name='electron.exe'" | ? { $_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('${m}') } | % { $_.ProcessId }) -join ','`], { encoding: 'utf8' }); return r.stdout.trim().split(',').filter(Boolean).map(Number); }
const killMine = () => { for (const p of mine()) { try { process.kill(p); } catch { } } };
const ytdlpProcs = () => { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='yt-dlp.exe'" | ? { $_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('\\goodseedown\\bin\\') }).Count`], { encoding: 'utf8' }); return Number(r.stdout.trim()) || 0; };
function probe(file) { const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }); if (r.status !== 0) return { error: r.stderr }; const j = JSON.parse(r.stdout); const v = j.streams.find(s => s.codec_type === 'video'), a = j.streams.find(s => s.codec_type === 'audio'); return { format: j.format.format_name, duration: Number(j.format.duration), width: v && v.width, height: v && v.height, vcodec: v && v.codec_name, acodec: a && a.codec_name, subs: j.streams.filter(s => s.codec_type === 'subtitle').length }; }
const filesIn = dir => { const o = []; const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : o.push(p); } }; walk(dir); return o; };

const V = { caminandes3: 'https://www.youtube.com/watch?v=SkVqJ1SGeL0', sintel: 'https://www.youtube.com/watch?v=eRsGyueVLvQ', spring: 'https://www.youtube.com/watch?v=WhWc3b3KhnY', playlist: 'https://www.youtube.com/playlist?list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz' };

// ---- 앱 기동 ----
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ schema: 1, saveDir: OUT, maxConcurrent: 3, copyrightAcknowledged: false, clipboardWatch: true, mp3: { saveDir: path.join(W, 'mp3') } }));
const env = { ...process.env, GOODSEEDOWN_UPDATE_API: 'http://127.0.0.1:9/none' /* 시험이 실제 GitHub 로 나가지 않게 */, GOODSEEDOWN_DATA_ROOT: DATA, GOODSEEDOWN_DEBUG_PORT: String(PORT), GOODSEEDOWN_TEST_YTDLP_ARGS: JSON.stringify(['--limit-rate', '3M']) };
if (mode === 'dev') env.GOODSEEDOWN_TOOLS_DIR = path.join(B, 'bundle', 'resources', 'tools');
const before = mine();
let child = mode === 'exe' ? spawn(exe, [], { env, stdio: 'ignore' }) : spawn(path.join(B, 'electron-base', 'electron.exe'), [path.join(B, 'src')], { env, stdio: 'ignore' });
let cdp = await until(async () => { try { return await connect(PORT, t => t.type === 'page' && /goodseedown/.test(t.title)); } catch { return null; } }, 120000, 800);
if (!cdp) { console.log('앱을 띄우지 못했습니다'); killMine(); process.exit(2); }
let ev = cdp.ev;
const $ = sel => `document.querySelector(${JSON.stringify(sel)})`;
const click = sel => ev(`(()=>{const e=${$(sel)}; if(!e) throw new Error('없음: ${sel}'); e.click(); return true})()`);
const setVal = (sel, v) => ev(`(()=>{const e=${$(sel)}; e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
const exists = sel => ev(`!!${$(sel)}`);
const text = sel => ev(`(${$(sel)}||{}).innerText||''`);
const waitSel = (sel, ms = 90000) => until(() => exists(sel), ms, 200);
const clickBtnText = t => ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&x.offsetParent!==null); if(!b) throw new Error('버튼 없음: ${t}'); b.click(); return true})()`);
const cards = () => ev(`[...document.querySelectorAll('.job')].map(j=>({id:j.dataset.id,status:j.dataset.status,title:j.querySelector('.title').textContent,chip:j.querySelector('.chip').textContent,p1:j.querySelector('.p1').textContent,p2:j.querySelector('.p2').textContent,msg:j.querySelector('.msg').textContent,acts:[...j.querySelectorAll('.acts button')].map(b=>b.dataset.act)}))`);
const cardBy = async (pred) => (await cards()).find(pred);
const waitCard = (pred, ms = 240000) => until(async () => (await cards()).find(pred), ms, 400);
const actClick = (id, act) => ev(`(()=>{const b=document.querySelector('.job[data-id="${id}"] [data-act="${act}"]'); if(!b) throw new Error('작업 버튼 없음 ${act}'); b.click(); return true})()`);
const toasts = () => ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent)`);
const submitUrl = async u => { await setVal('#url', u); await click('#btnGo'); };

// 앱을 정상 종료(창 닫기와 같은 경로: Browser.close → before-quit → 작업 일시정지 저장)한 뒤 같은 데이터 폴더로 다시 띄운다. 재기동 기억 시험용.
async function restartApp(extraEnv = {}) {
  try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { }
  try { cdp.close(); } catch { }
  await until(() => mine().length === 0, 60000, 500); killMine(); await sleep(1500);
  const env2 = { ...env, ...extraEnv };
  child = mode === 'exe' ? spawn(exe, [], { env: env2, stdio: 'ignore' }) : spawn(path.join(B, 'electron-base', 'electron.exe'), [path.join(B, 'src')], { env: env2, stdio: 'ignore' });
  cdp = await until(async () => { try { return await connect(PORT, t => t.type === 'page' && /goodseedown/.test(t.title)); } catch { return null; } }, 120000, 800);
  if (!cdp) throw new Error('앱을 다시 띄우지 못했습니다');
  ev = cdp.ev;
  await until(() => ev(`!!document.getElementById('mp3Card')&&document.readyState==='complete'`), 30000, 300); await sleep(1200);
}

try {
  // ===== UI1: 첫 실행 저작권 안내 =====
  if (want('UI1')) {
    check('UI1 창 제목 "goodseedown — 동영상 다운로더"', cdp.title === 'goodseedown — 동영상 다운로더', cdp.title);
    check('UI1 첫 실행에 저작권 안내 창 표시(권리자 허락·개인 이용 범위·DRM 우회 없음)', await waitSel('#dlgFirstRun', 15000) && /권리자의 허락/.test(await text('#dlgFirstRun')) && /개인적으로 이용/.test(await text('#dlgFirstRun')) && /DRM/.test(await text('#dlgFirstRun')), (await text('#dlgFirstRun')).slice(0, 80));
    check('UI1 화면 아래에 저작권 안내가 항상 표시됨', /저작권이 있는 콘텐츠는 권리자의 허락/.test(await text('.notice')) && /DRM/.test(await text('.notice')));
    await click('#btnAck'); await sleep(600);
    const st = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
    check('UI1 확인하면 창이 닫히고 설정에 저장됨(다음 실행부터 안 뜸)', !(await exists('#dlgFirstRun')) && st.copyrightAcknowledged === true, st.copyrightAcknowledged);
  } else { await ev("document.getElementById('btnAck')&&document.getElementById('btnAck').click()"); }

  // ===== UI2: 단일 영상 — 링크를 붙여넣고 [다운로드] 한 번(분석·옵션 창 없음) =====
  if (want('UI2')) {
    const labels = await ev(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>b.textContent.trim())`);
    check('UI2 메인 화면: [분석] 버튼·스마트 모드 스위치 없음, [다운로드]·[구독하기]·형식·화질 선택이 있음', !labels.includes('분석') && !(await exists('#smartToggle')) && !(await exists('.smart')) && (await text('#btnGo')) === '다운로드' && (await text('#btnSubscribe')) === '구독하기' && (await exists('#dlKind')) && (await exists('#dlQuality')), labels);
    check('UI2 형식 선택지 = 영상 MP4 / MP3 음악, 영상 화질 = 최고·1080p·720p·480p', JSON.stringify(await ev(`[...document.querySelectorAll('#dlKind option')].map(o=>o.textContent)`)) === JSON.stringify(['영상 MP4', 'MP3 음악']) && JSON.stringify(await ev(`[...document.querySelectorAll('#dlQuality option')].map(o=>o.textContent)`)) === JSON.stringify(['최고', '1080p', '720p', '480p']));
    const wid = await ev(`(()=>{const i=document.getElementById('url');const c=document.createElement('canvas').getContext('2d');const cs=getComputedStyle(i);c.font=cs.fontSize+' '+cs.fontFamily;return {w:i.clientWidth,need:c.measureText(i.placeholder).width+parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight)+4,over:document.documentElement.scrollWidth-window.innerWidth,iw:window.innerWidth}})()`);
    check('UI2 기본 창 너비에서 링크 입력칸이 안내 문구(placeholder)를 자르지 않을 만큼 넓음(300px 이상)·가로 넘침 없음', wid.w >= 300 && wid.need <= wid.w && wid.over <= 0, wid);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(500);
    const narrow = await ev(`(()=>{const i=document.getElementById('url');const r=[...document.querySelectorAll('.top button, .top select, .top input')].map(e=>e.getBoundingClientRect());return {w:i.clientWidth,over:document.documentElement.scrollWidth-window.innerWidth,clipped:r.filter(b=>b.width>0&&(b.right>window.innerWidth+1||b.left<-1)).length}})()`);
    check('UI2 최소 창 너비(880px)에서도 입력칸 300px 이상·버튼이 잘리거나 가로 넘침 없음(줄바꿈)', narrow.w >= 300 && narrow.over <= 0 && narrow.clipped === 0, narrow);
    await cdp.send('Emulation.clearDeviceMetricsOverride'); await sleep(300);
    await setVal('#dlKind', 'mp3'); await sleep(500);
    check('UI2 형식을 MP3 로 바꾸면 화질 칸이 음질(320/256/192/128kbps)로 바뀌고 설정 기본값에 저장', JSON.stringify(await ev(`[...document.querySelectorAll('#dlQuality option')].map(o=>o.textContent)`)) === JSON.stringify(['320kbps', '256kbps', '192kbps', '128kbps']) && (await text('#dlQualityLbl')) === '음질' && JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults.audioFormat === 'mp3', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults);
    await setVal('#dlQuality', '192'); await sleep(400);
    check('UI2 음질 192 선택이 설정 기본값(mp3Bitrate)에 저장됨', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults.mp3Bitrate === 192);
    await setVal('#dlKind', 'video'); await sleep(400); await setVal('#dlQuality', '1080'); await sleep(500);
    const st0 = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults;
    check('UI2 형식 영상·화질 1080 선택이 설정 기본값에 저장됨(kind video·quality 1080·mp4)', st0.kind === 'video' && st0.quality === '1080' && st0.videoFormat === 'mp4', st0);
    // 입력 오류(고장 입력): 대기열에 아무것도 들어가지 않는다
    await setVal('#url', ''); await click('#btnGo');
    check('UI2 빈 칸에서 [다운로드] → "링크를 입력해 주세요." 안내·작업 0개', await until(async () => (await toasts()).some(t => /링크를 입력해 주세요/.test(t)), 5000, 200) && (await cards()).length === 0);
    await setVal('#url', 'file:///c:/windows/win.ini javascript:alert(1)'); await click('#btnGo');
    check('UI2 http(s) 가 아닌 입력 → "올바른 http(s) 링크가 아닙니다." 안내·작업 0개', await until(async () => (await toasts()).some(t => /올바른 http\(s\) 링크가 아닙니다/.test(t)), 5000, 200) && (await cards()).length === 0);
    // 정상: 붙여넣고 [다운로드] 한 번 → 옵션 창 없이 곧바로 대기열
    await setVal('#url', V.caminandes3);
    const t0 = Date.now(); await click('#btnGo');
    const c0 = await waitCard(x => true, 20000); const dt = Date.now() - t0;
    check('UI2 [다운로드] 한 번 → 분석·옵션 창 없이 바로 대기열(3초 이내)·입력칸 비워짐', !!c0 && !(await exists('.dlg')) && dt < 3000 && (await ev(`document.getElementById('url').value`)) === '', { ms: dt });
    const c = await waitCard(x => x.status === 'completed' && /Caminandes/.test(x.title), 240000);
    check('UI2 진행 후 카드가 "완료"', !!c && c.chip === '완료', c && { chip: c.chip, p1: c.p1 });
    const mp4 = filesIn(OUT).find(f => /\.mp4$/.test(f)); const p = mp4 && probe(mp4);
    check('UI2 결과 파일 ffprobe: 1080p H.264 MP4·150초', p && p.height === 1080 && p.vcodec === 'h264' && Math.abs(p.duration - 150) < 2, p);
    check('UI2 완료 카드에 열기·폴더에서 보기·삭제 버튼', JSON.stringify(c.acts) === JSON.stringify(['open', 'folder', 'remove']), c.acts);
  }

  // ===== UI3: 일시정지·이어받기·취소·다시 시작 (Enter 키로 제출, MKV 는 설정 기본값) =====
  if (want('UI3')) {
    await click('#btnClear');
    await ev(`window.gsd.setSettings({defaults:{videoFormat:'mkv'}})`); await sleep(500);
    await setVal('#url', V.caminandes3); await ev(`document.getElementById('url').focus()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    const run = await waitCard(x => x.status === 'downloading' && /\d+%/.test(x.p1) && parseInt(x.p1) >= 8 && x.acts.includes('pause'), 90000);
    check('UI3 입력칸에서 Enter 만 눌러도 바로 받기 시작(옵션 창 없음)·퍼센트·속도·남은 시간 + [일시정지][취소]', !!run && !(await exists('.dlg')) && /\d+%/.test(run.p1) && /\/s/.test(run.p2) && /남은 시간/.test(run.p2) && run.acts.join() === 'pause,cancel', run && { p1: run.p1, p2: run.p2 });
    await actClick(run.id, 'pause');
    const paused = await waitCard(x => x.id === run.id && x.status === 'paused', 30000);
    check('UI3 [일시정지] → "일시정지" 상태·[이어받기][취소] 버튼', !!paused && paused.chip === '일시정지' && paused.acts.join() === 'resume,cancel', paused && paused.acts);
    const pct1 = parseInt(paused.p1); await sleep(2500); const again = await cardBy(x => x.id === run.id);
    check('UI3 일시정지 중에는 진행률이 변하지 않음', parseInt(again.p1) === pct1 && again.status === 'paused', [pct1, again.p1]);
    await actClick(run.id, 'resume');
    const resumed = await waitCard(x => x.id === run.id && x.status === 'downloading' && parseInt(x.p1) >= pct1, 60000);
    check('UI3 [이어받기] → 다시 "받는 중", 진행률이 멈췄던 지점부터 계속(되돌아가지 않음)', !!resumed, resumed && [pct1, resumed.p1]);
    await actClick(run.id, 'pause'); await waitCard(x => x.id === run.id && x.status === 'paused', 30000);
    await actClick(run.id, 'cancel'); await waitSel('.dlg button.primary', 5000);
    check('UI3 [취소] 누르면 확인창("받던 내용(임시 파일)을 지우고 취소할까요?")', /임시 파일\)을 지우고/.test(await text('#modalRoot')), (await text('#modalRoot')).slice(0, 60));
    await clickBtnText('취소하기');
    const canc = await waitCard(x => x.id === run.id && x.status === 'canceled', 30000);
    const tmp = filesIn(OUT).filter(f => f.includes('.goodseedown-tmp'));
    check('UI3 취소됨 상태·임시 파일 삭제·[다시 시작][삭제] 버튼', !!canc && tmp.length === 0 && canc.acts.join() === 'retry,remove', { acts: canc && canc.acts, tmp: tmp.length });
    await actClick(run.id, 'retry');
    const done = await waitCard(x => x.id === run.id && x.status === 'completed', 240000);
    const mkv = filesIn(OUT).find(f => /\.mkv$/.test(f)); const p = mkv && probe(mkv);
    check('UI3 [다시 시작] → 완료·ffprobe 1080p MKV(설정 기본값의 MKV 형식 적용)', !!done && p && /matroska/.test(p.format) && p.height === 1080, p);
    await ev(`window.gsd.setSettings({defaults:{videoFormat:'mp4'}})`); await sleep(400);
  }

  // ===== UI4: 재생목록 링크 → 전체가 하위 폴더로 (분석·선택 창 없음) =====
  if (want('UI4')) {
    await click('#btnClear');
    await setVal('#dlKind', 'mp3'); await sleep(400); await setVal('#dlQuality', '128'); await sleep(500);
    await setVal('#url', V.playlist); await click('#btnGo');
    const all = await until(async () => { const cs = await cards(); return cs.length >= 18 ? cs : null; }, 120000, 600);
    check('UI4 재생목록 링크 + [다운로드] → 옵션·선택 창 없이 18개 전체가 대기열에 들어감', !!all && all.length === 18 && !(await exists('.dlg')), all && all.length);
    check('UI4 카드에 "재생목록: Blender Open Movies"·선택한 형식(MP3 128kbps) 표시', await ev(`[...document.querySelectorAll('.job .meta')].every(m=>m.textContent.includes('재생목록: Blender Open Movies')&&m.textContent.includes('MP3 128kbps'))`));
    const jobs = await ev(`window.gsd.listJobs()`);
    check('UI4 저장 위치가 재생목록 이름의 하위 폴더(설정 [재생목록 정리] 기본값 켜짐)', jobs.length === 18 && jobs.every(j => /[\\/]Blender Open Movies$/.test(j.outDir)), jobs[0] && { dir: jobs[0].outDir });
    await ev(`window.gsd.jobsAll('pause')`); await sleep(1500);
    for (const j of await ev(`window.gsd.listJobs()`)) { if (j.status !== 'canceled' && j.status !== 'completed') { await ev(`window.gsd.job('cancel', ${JSON.stringify(j.id)})`); } }
    await sleep(2500); await click('#btnClear'); await sleep(600);
    check('UI4 정리: 시험으로 넣은 18개를 모두 취소·삭제(yt-dlp 남지 않음)', (await cards()).length === 0 && ytdlpProcs() === 0, { n: (await cards()).length, procs: ytdlpProcs() });
    await setVal('#dlKind', 'video'); await sleep(400); await setVal('#dlQuality', '1080'); await sleep(400);
  }

  // ===== UI5: 자막 — 세부 옵션은 설정 화면 기본값이 적용된다 =====
  if (want('UI5')) {
    await click('#btnClear');
    // (a) 자막만: 설정 기본값 kind=subs + en
    await ev(`window.gsd.setSettings({defaults:{kind:'subs',subs:{enabled:true,langs:['en','ko'],auto:false,mode:'srt'}}})`); await sleep(500);
    check('UI5 설정 기본값이 "자막만"이면 형식 칸에 "설정값: …"이 따로 표시되고 화질 칸은 숨음', /설정값: 자막만/.test(await ev(`document.getElementById('dlKind').selectedOptions[0].textContent`)) && (await ev(`document.getElementById('dlQualityWrap').hidden`)) === true, await ev(`document.getElementById('dlKind').selectedOptions[0].textContent`));
    await setVal('#url', V.sintel); await click('#btnGo');
    const c = await waitCard(x => /Sintel/.test(x.title) && ['completed', 'failed'].includes(x.status), 180000);
    const srts = filesIn(OUT).filter(f => /Sintel.*\.srt$/.test(f));
    check('UI5 자막만 받기(설정 기본값) → SRT 생성(영어는 존재, 영상에 없는 한국어는 건너뜀)', !!c && c.status === 'completed' && srts.some(f => /\.en\.srt$/.test(f)), { status: c && c.status, msg: c && c.msg, files: srts.map(f => path.basename(f)) });
    const t = srts[0] && fs.readFileSync(srts[0], 'utf8');
    check('UI5 SRT 내용 형식(번호·시간표)', t && /^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> /.test(t), t && t.slice(0, 60));
    // (b) 영상에 합치기: 설정 기본값 video 360 + en 합치기
    await click('#btnClear');
    await ev(`window.gsd.setSettings({defaults:{kind:'video',quality:'360',videoFormat:'mp4',subs:{enabled:true,langs:['en'],auto:false,mode:'embed'}}})`); await sleep(500);
    await setVal('#url', V.spring); await click('#btnGo');
    const c2 = await waitCard(x => /Spring/.test(x.title) && ['completed', 'failed'].includes(x.status), 400000);
    const mp4 = filesIn(OUT).find(f => /Spring.*\.mp4$/.test(f)); const p = mp4 && probe(mp4);
    check('UI5 영상에 합치기(설정 기본값) → MP4 안에 자막 트랙 1개(ffprobe)·"자막을 찾지 못했다"는 잘못된 안내 없음', !!c2 && c2.status === 'completed' && p && p.subs === 1 && p.height >= 358 && !/찾지 못/.test(c2.msg), { status: c2 && c2.status, msg: c2 && c2.msg, p });
    await ev(`window.gsd.setSettings({defaults:{kind:'video',quality:'1080',videoFormat:'mp4',subs:{enabled:false,langs:[],auto:false,mode:'srt'}}})`); await sleep(500);
  }

  // ===== UI6: 옛 설정(smartMode 포함) 안전 로드 · 영상+재생목록 주소의 선택 =====
  if (want('UI6')) {
    await click('#btnClear');
    // 1.1.x 설정 파일(smartMode:true·옛 필드)을 만들어 앱을 다시 띄운다
    const sp = path.join(DATA, 'settings.json'); const cur = JSON.parse(fs.readFileSync(sp, 'utf8'));
    try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { }
    await until(() => mine().length === 0, 60000, 500); killMine(); await sleep(1500);
    fs.writeFileSync(sp, JSON.stringify({ ...cur, smartMode: true, defaults: { kind: 'video', quality: '720', videoFormat: 'mp4', audioFormat: 'mp3', mp3Bitrate: 320, id3: true, subs: { enabled: false, langs: [], auto: false, mode: 'srt' } }, unknownFutureField: 1 }));
    child = mode === 'exe' ? spawn(exe, [], { env, stdio: 'ignore' }) : spawn(path.join(B, 'electron-base', 'electron.exe'), [path.join(B, 'src')], { env, stdio: 'ignore' });
    cdp = await until(async () => { try { return await connect(PORT, t => t.type === 'page' && /goodseedown/.test(t.title)); } catch { return null; } }, 120000, 800);
    ev = cdp.ev; await until(() => ev(`document.readyState==='complete'&&!!document.getElementById('dlKind')`), 30000, 300); await sleep(1500);
    const mainOk = await ev(`(()=>{const q=document.getElementById('dlQuality');return {kind:document.getElementById('dlKind').value,q:q.value,go:document.getElementById('btnGo').textContent,smart:!!document.getElementById('smartToggle')}})()`);
    check('UI6 smartMode:true 가 들어 있는 1.1.x 설정 파일로 시작해도 앱이 정상 기동·저장된 기본값(영상 720p)이 형식·화질 칸에 반영, 스마트 모드는 없음', mainOk.kind === 'video' && mainOk.q === '720' && mainOk.go === '다운로드' && !mainOk.smart, mainOk);
    await setVal('#dlQuality', '480'); await sleep(600);
    const after = JSON.parse(fs.readFileSync(sp, 'utf8'));
    check('UI6 설정을 한 번 저장하면 옛 smartMode 필드는 파일에서 사라지고 나머지 설정은 유지(saveDir 등)', after.smartMode === undefined && after.defaults.quality === '480' && after.saveDir === cur.saveDir, { smart: after.smartMode, q: after.defaults.quality });
    await setVal('#dlQuality', '1080'); await sleep(500);
    // 영상+재생목록 주소: 선택창 → 이 영상만(대기열 1개)
    await setVal('#url', V.caminandes3 + '&list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz'); await click('#btnGo');
    const dlg = await waitSel('#dlgChoice', 15000);
    check('UI6 영상+재생목록 주소: "이 영상만 / 재생목록 전체" 선택창이 뜸', !!dlg && (await exists('#btnChoiceVideo')) && (await exists('#btnChoiceList')));
    await click('#btnChoiceVideo');
    const one = await waitCard(x => true, 20000); await sleep(1500);
    check('UI6 "이 영상만" → 영상 1개만 대기열(재생목록 전체가 들어가지 않음)', !!one && (await cards()).length === 1, (await cards()).length);
    await actClick(one.id, 'pause'); await waitCard(x => x.id === one.id && x.status === 'paused', 30000);
    await actClick(one.id, 'cancel'); await waitSel('.dlg button.primary', 5000); await clickBtnText('취소하기');
    await waitCard(x => x.id === one.id && x.status === 'canceled', 30000); await actClick(one.id, 'remove'); await sleep(800);
  }

  // ===== UI13: 새 버전 배너 (가짜 릴리스 서버 — 실제 GitHub 로 나가지 않음) =====
  if (want('UI13')) {
    const { createFakeServer } = await import('../fake-release-server.mjs');
    const srv = await createFakeServer({ exe: Buffer.from('MZ' + 'x'.repeat(8192)), tag: 'v1.2.2', notes: '시험 노트: 새 기능 A' });
    const banner = () => ev(`(()=>{const b=document.getElementById('updBanner');return {shown:!!b&&!b.hidden&&b.offsetParent!==null,text:(document.getElementById('updText')||{}).innerText||'',how:(document.getElementById('updHow')||{}).innerText||'',size:(document.getElementById('updSize')||{}).innerText||'',guide:(document.getElementById('btnUpdGuide')||{}).textContent||'',btn:(document.getElementById('btnUpgrade')||{}).textContent||'',later:(document.getElementById('btnUpdLater')||{}).textContent||''}})()`);
    const nativeDlg = () => spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process | ? { $_.MainWindowTitle -like '*업데이트*' }).Count`], { encoding: 'utf8' }).stdout.trim();
    const relaunch = async api => { try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { } try { cdp.close(); } catch { } await until(() => mine().length === 0, 60000, 500); killMine(); await sleep(1500);
      const e2 = { ...env, GOODSEEDOWN_UPDATE_API: api, GOODSEEDOWN_ENGINE_API: 'http://127.0.0.1:9/none' }; child = mode === 'exe' ? spawn(exe, [], { env: e2, stdio: 'ignore' }) : spawn(path.join(B, 'electron-base', 'electron.exe'), [path.join(B, 'src')], { env: e2, stdio: 'ignore' });
      cdp = await until(async () => { try { return await connect(PORT, t => t.type === 'page' && /goodseedown/.test(t.title)); } catch { return null; } }, 120000, 800); ev = cdp.ev; await until(() => ev(`document.readyState==='complete'&&!!document.getElementById('updBanner')`), 30000, 300); };
    // (1) 새 버전 있음
    await relaunch(srv.apiUrl);
    const shown = await until(async () => { const b = await banner(); return b.shown ? b : null; }, 40000, 500);
    check('UI13-1 새 버전(1.2.2) 있음 → 맨 위 배너 "📢 새 버전(1.2.2)이 나왔습니다. 업데이트해 주세요."·방법 한 줄·[업그레이드][업데이트 방법][나중에]', !!shown && shown.text === '📢 새 버전(1.2.2)이 나왔습니다. 업데이트해 주세요.' && /^방법: \[업그레이드\] 클릭 → (바뀐 부분만 받아|새 버전을 받아) 자동 교체 → 프로그램이 다시 켜지면 완료$/.test(shown.how) && /현재 1\.2\.1 → 1\.2\.2/.test(shown.size) && shown.btn === '업그레이드' && shown.guide === '업데이트 방법' && shown.later === '나중에', shown);
    check('UI13-2 배너가 다운로드 화면의 제일 위(헤더보다 위)에 있음', await ev(`(()=>{const b=document.getElementById('updBanner').getBoundingClientRect(), h=document.querySelector('header.top').getBoundingClientRect(); return b.top<h.top && b.top<=1})()`));
    await sleep(2500);
    check('UI13-3 ★배너만 뜨고 확인창(네이티브 대화상자)은 따로 뜨지 않음 · 클릭 전에는 새 exe·패치 다운로드 요청 0건(자동 설치 없음)', nativeDlg() === '0' && !srv.hits.some(h => /^\/dl\/goodseedown-/.test(h) || /\.patch$/.test(h)) && !srv.hits.includes('/dl/SHA256SUMS.txt'), { dlg: nativeDlg(), hits: srv.hits });
    await click('#btnUpdGuide'); const gd = await waitSel('#dlgUpdate', 5000); const gt = gd ? await text('#dlgUpdate') : '';
    check('UI13-3b [업데이트 방법] → 단계별 안내 창(1.[업그레이드] 2.받기·교체·다운로드 일시정지 후 이어받기 3.자동 재시작·버전 확인 4.https://goodseedown.vercel.app/ 새로 받기·설정·구독 유지) + 릴리스 노트 요약 + [지금 업그레이드]', !!gd && /\[업그레이드\] 버튼을 누릅니다/.test(gt) && /일시정지한 뒤 업데이트하고/.test(gt) && /\[이어받기\]/.test(gt) && /저절로 다시 켜집니다/.test(gt) && /버전/.test(gt) && /https:\/\/goodseedown\.vercel\.app\//.test(gt) && /설정·구독은 그대로/.test(gt) && /새 기능 A/.test(gt) && (await exists('#btnUpdGuideGo')) && (await text('#btnUpdGuideGo')) === '지금 업그레이드', gt.replace(/\n/g, ' ').slice(0, 200));
    check('UI13-3c 방법 창을 열어도 설치·다운로드 요청 0건(보기만)', !srv.hits.some(h => /^\/dl\//.test(h)), srv.hits);
    await click('#btnUpdGuideClose'); await sleep(300);
    check('UI13-3d [닫기] → 창이 닫히고 배너는 그대로', !(await exists('#dlgUpdate')) && (await banner()).shown);
    await click('#btnUpdLater'); await sleep(400);
    check('UI13-4 [나중에] → 배너가 사라지고(이번 실행 동안 숨김) 다운로드 요청 없음', !(await banner()).shown && !srv.hits.some(h => /^\/dl\//.test(h)), srv.hits);
    // 재알림: [나중에] 로 숨긴 뒤에도 다운로드 탭으로 돌아오거나 [다운로드]를 누르면 작은 알림(한 실행에 최대 3번·60초 간격)
    const nags = () => ev(`document.querySelectorAll('#updNag').length`);
    check('UI13-4a [나중에] 직후에는 재알림 없음(과하지 않게)', (await nags()) === 0);
    await click('#tabSettings'); await sleep(300); await click('#tabDownloads'); await sleep(400);
    check('UI13-4b 다운로드 탭으로 돌아오면 작은 알림 "새 버전(1.2.2)이 있습니다 — 업데이트 방법 보기"', (await nags()) === 1 && /새 버전\(1\.2\.2\)이 있습니다/.test(await text('#updNag')) && (await text('#btnNagGuide')) === '업데이트 방법 보기', await text('#updNag'));
    await click('#tabSettings'); await sleep(200); await click('#tabDownloads'); await sleep(300); await setVal('#url', ''); await click('#btnGo'); await sleep(400);
    check('UI13-4c 바로 이어서 다시 해도 알림이 겹치지 않음(60초 간격 제한)', (await nags()) === 1, await nags());
    await click('#btnNagGuide'); const g2 = await waitSel('#dlgUpdate', 5000);
    check('UI13-4d 알림의 [업데이트 방법 보기] → 방법 창이 열림', !!g2 && (await nags()) === 0);
    await click('#btnUpdGuideClose'); await sleep(300);
    // 시간 경과를 흉내 내어(Date.now 앞당김) 상한(최대 3번)을 확인한다
    let shownN = 1; for (let k = 1; k <= 5; k++) { await ev(`(()=>{window.__dn=window.__dn||Date.now; Date.now=()=>window.__dn()+${k * 61000}; return true})()`); await click('#tabSettings'); await sleep(150); await click('#tabDownloads'); await sleep(250); if ((await nags()) >= 1) shownN++; await ev(`document.querySelectorAll('#updNag').forEach(n=>n.remove())`); }
    check('UI13-4e 한 실행에 재알림은 최대 3번(그 뒤로는 더 뜨지 않음)', shownN === 3, shownN);
    await ev(`(()=>{Date.now=window.__dn; return true})()`);
    check('UI13-4f 재알림이 뜨는 동안에도 설치·다운로드 요청 0건(자동 설치 없음)', !srv.hits.some(h => /^\/dl\//.test(h)), srv.hits);
    // (2) 다음 실행에는 다시 보임
    await relaunch(srv.apiUrl);
    const again = await until(async () => { const b = await banner(); return b.shown ? b : null; }, 40000, 500);
    check('UI13-5 [나중에] 뒤 다음 실행에는 배너가 다시 보임', !!again, again);
    // (3) 최신(같은 버전)·확인 실패 → 배너 없음
    srv.cfg.tag = 'v1.2.1'; await relaunch(srv.apiUrl); await sleep(12000);
    check('UI13-6 최신 버전이면 배너 없음(조용히)', !(await banner()).shown && nativeDlg() === '0', await banner());
    srv.cfg.tag = 'v1.2.2'; srv.cfg.apiStatus = 500; await relaunch(srv.apiUrl); await sleep(12000);
    check('UI13-7 서버 오류(500)면 배너 없음·오류창 없음', !(await banner()).shown && nativeDlg() === '0' && (await ev(`!!document.getElementById('dlKind')`)));
    await relaunch('http://127.0.0.1:9/none'); await sleep(12000);
    check('UI13-8 서버에 닿지 않아도(오프라인) 배너 없음·오류창 없음·앱 정상', !(await banner()).shown && nativeDlg() === '0' && (await ev(`!!document.getElementById('dlKind')`)));
    srv.cfg.apiStatus = 200; srv.cfg.assets = 'noexe'; await relaunch(srv.apiUrl); await sleep(12000);
    check('UI13-9 릴리스에 exe 가 없으면(업데이트 불가) 배너 없음', !(await banner()).shown, srv.hits.slice(-3));
    // 업데이트 직후 첫 실행 안내: 업데이터가 남기는 표시 파일(updated-notice.json)을 만들어 두고 다시 띄운다
    const nf = path.join(DATA, 'updates', 'updated-notice.json'); fs.mkdirSync(path.dirname(nf), { recursive: true });
    fs.writeFileSync(nf, JSON.stringify({ from: '1.2.0', to: '1.2.1' }));
    await relaunch('http://127.0.0.1:9/none');
    const ud = await waitSel('#dlgUpdated', 20000); const ut = ud ? await text('#dlgUpdated') : '';
    check('UI13-10 ★업데이트 직후 첫 실행: "1.2.1로 업데이트되었습니다"+이전→현재 버전+바뀐 점 안내', !!ud && /1\.2\.1로 업데이트되었습니다/.test(ut) && /1\.2\.0 → 1\.2\.1/.test(ut) && /바뀐 점/.test(ut) && /업데이트 방법/.test(ut) && !fs.existsSync(nf), ut.replace(/\n/g, ' ').slice(0, 160));
    await click('#btnUpdatedOk'); await relaunch('http://127.0.0.1:9/none'); await sleep(2500);
    check('UI13-11 안내는 1회만 — 다음 실행에는 다시 뜨지 않음', !(await exists('#dlgUpdated')));
    // 현재 버전과 다른 표시 파일(옛 찌꺼기)은 무시하고 지운다
    fs.writeFileSync(nf, JSON.stringify({ from: '1.0.0', to: '9.9.9' })); await relaunch('http://127.0.0.1:9/none'); await sleep(2500);
    check('UI13-12 현재 버전과 맞지 않는 표시 파일은 무시(안내 없음)·파일 정리', !(await exists('#dlgUpdated')) && !fs.existsSync(nf));
    await srv.close();
  }

  // ===== UI7: 구독 =====
  if (want('UI7')) {
    await click('#btnClear');
    await setVal('#url', V.caminandes3); await click('#btnSubscribe');
    check('UI7 영상 한 개 링크는 구독할 수 없다는 안내·구독 0개(고장 입력)', await until(async () => (await toasts()).some(t => /영상 한 개의 링크는 구독할 수 없습니다/.test(t)), 15000, 300) && (await ev(`document.querySelectorAll('.sub').length`)) === 0, await toasts());
    await setVal('#url', V.playlist); await click('#btnSubscribe');
    await until(() => ev(`document.querySelectorAll('.sub').length`), 30000, 300);
    check('UI7 분석 없이 [구독하기] 한 번 → 구독 탭에 재생목록 구독 등록(본 영상 18개)·입력칸 비워짐', (await ev(`document.querySelectorAll('.sub').length`)) === 1 && /Blender Open Movies/.test(await text('.sub')) && /본 영상 18개/.test(await text('.sub')) && (await ev(`document.getElementById('url').value`)) === '', (await text('.sub')).replace(/\n/g, ' ').slice(0, 140));
    check('UI7 처음 구독할 때 이미 있는 영상은 받지 않음(대기열 비어 있음)', (await cards()).length === 0, (await cards()).length);
    await ev(`document.querySelector('#tabSubs')&&true`);
    await click('[data-act="sub-check"]');
    check('UI7 [지금 확인] → "새 영상이 없습니다" 안내', await until(async () => (await toasts()).some(t => /새 영상이 없습니다/.test(t)), 60000, 400), await toasts());
    // ★새 영상이 올라온 상황을 만든다: 앱을 정상 종료 → 구독 파일에서 '본 영상' 1개를 빼고 → 다시 실행 → [지금 확인]
    await restartApp({});
    const sf = path.join(DATA, 'subscriptions.json'); const sj = JSON.parse(fs.readFileSync(sf, 'utf8')); const gone = sj.subscriptions[0].known.pop(); fs.writeFileSync(sf, JSON.stringify(sj));
    await restartApp({});
    check('UI7 재기동 후 구독이 유지되고 작업 목록은 비어 있음', (await ev(`document.querySelectorAll('.sub').length`)) === 1 && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === 0, null);
    await click('[data-act="sub-check"]');
    const pendShown = await until(() => exists('.sub .pending'), 60000, 400);
    const toastNow = await toasts();
    await sleep(4000);
    check('UI7 ★새 영상 감지 → 구독 카드에 "새 영상 1개 — 자동으로 받지 않습니다" 알림과 [받기] 버튼만 표시, 다운로드 요청 0건(작업 0개·yt-dlp 실행 0)', !!pendShown && /새 영상 1개/.test(await text('.sub .pending')) && /자동으로 받지 않습니다/.test(await text('.sub .pending')) && (await exists('[data-act="sub-get-one"]')) && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === 0 && ytdlpProcs() === 0 && (await cards()).length === 0, { text: (await text('.sub .pending')).replace(/\n/g, ' ').slice(0, 120), jobs: await ev(`window.gsd.listJobs().then(a=>a.length)`), procs: ytdlpProcs() });
    check('UI7 감지 알림 토스트에 "자동으로 받지 않습니다" 안내', toastNow.some(t => /자동으로 받지 않/.test(t)), toastNow);
    await click('[data-act="sub-get-one"]');
    const got = await waitCard(x => true, 20000);
    check('UI7 사용자가 [받기]를 누른 영상만 대기열에 들어감(구독 출처 표시)·알림 목록 비워짐', !!got && (await cards()).length === 1 && /구독: Blender Open Movies/.test(await ev(`document.querySelector('.job .meta').textContent`)) && !(await exists('.sub .pending')), got && got.title);
    await actClick(got.id, 'pause'); await waitCard(x => x.id === got.id && x.status === 'paused', 30000);
    await actClick(got.id, 'cancel'); await waitSel('.dlg button.primary', 5000); await clickBtnText('취소하기');
    check('UI7 정리: 시험으로 받기 시작한 구독 영상을 취소하고 목록에서 지움(yt-dlp 남지 않음)', !!(await waitCard(x => x.id === got.id && x.status === 'canceled', 30000)), null);
    await actClick(got.id, 'remove'); await sleep(1200);
    await click('[data-act="sub-enable"]'); await sleep(500);
    const subs = JSON.parse(fs.readFileSync(path.join(DATA, 'subscriptions.json'), 'utf8')).subscriptions;
    check('UI7 자동 받기 끄기가 저장됨', subs.length === 1 && subs[0].enabled === false, subs[0] && subs[0].enabled);
    await click('[data-act="sub-remove"]'); await clickBtnText('해제');
    check('UI7 [구독 해제] → 목록에서 제거', await until(async () => (await ev(`document.querySelectorAll('.sub').length`)) === 0, 10000, 300), null);
  }

  // ===== UI8: 설정 =====
  if (want('UI8')) {
    await click('#tabSettings'); await sleep(500);
    await until(async () => (await text('#appVer')) !== '', 30000, 300); // 엔진 버전은 yt-dlp 를 한 번 실행해 읽으므로 재기동 직후에는 몇 초 걸릴 수 있다
    const ver = await text('#engVer');
    check('UI8 설정 화면: yt-dlp 엔진 버전(날짜 형식)·앱 버전 표시', /^\d{4}\.\d{2}\.\d{2}/.test(ver) && /버전 1\.2\.1/.test(await text('#appVer')), [ver, await text('#appVer')]);
    await setVal('#set-conc', '5'); await sleep(500);
    check('UI8 동시 다운로드 수 변경 저장(5)', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).maxConcurrent === 5);
    await setVal('#set-conc', '99'); await sleep(500);
    check('UI8 범위 밖 값(99)은 6 으로 보정', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).maxConcurrent === 6);
    await setVal('#set-interval', '30'); await sleep(400);
    check('UI8 구독 확인 주기 변경 저장(30분)', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).subscriptionIntervalMin === 30);
    await click('#def-kind-audio'); await click('#def-afmt-m4a'); await sleep(400);
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults;
    check('UI8 다운로드 기본값(음성 M4A) 변경 저장', d.kind === 'audio' && d.audioFormat === 'm4a', d);
    check('UI8 엔진·앱 업데이트 확인 버튼, 라이선스·저작권 안내 버튼 존재', await ev(`['btnEngineCheck','btnAppCheck','btnNotice2','btnLicenses'].every(i=>!!document.getElementById(i))`));
    await click('#tabDownloads');
  }

  // ===== UI9: 클립보드 =====
  if (want('UI9')) {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -Value '복사한 링크: ${V.caminandes3} 입니다'`]);
    await setVal('#url', ''); await click('#btnPaste');
    await until(() => ev(`document.getElementById('url').value`), 5000, 150);
    check('UI9 [붙여넣기] 버튼 → 클립보드 글에서 링크만 입력창에 넣음', (await ev(`document.getElementById('url').value`)) === V.caminandes3, await ev(`document.getElementById('url').value`));
    await ev(`document.getElementById('url').value=''`);
    // ★클립보드에 링크를 넣어도 아무 일도 없어야 한다(감지 배너·자동 채움·다운로드 요청 모두 없음)
    await cdp.send('Page.bringToFront');
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `$w=New-Object -ComObject WScript.Shell; $null=$w.AppActivate('goodseedown'); Start-Sleep -Milliseconds 600`]);
    const jobsBefore = await ev(`window.gsd.listJobs().then(a=>a.length)`);
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -Value 'https://www.youtube.com/watch?v=WhWc3b3KhnY'`]);
    await sleep(6000);
    check('UI9 ★클립보드에 링크를 복사해도 감지 배너·입력칸 자동 채움 없음, 다운로드 요청 0건(작업 수 그대로·yt-dlp 실행 0)', !(await exists('#clipBanner')) && (await ev(`document.getElementById('url').value`)) === '' && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === jobsBefore && ytdlpProcs() === 0, { banner: await exists('#clipBanner'), url: await ev(`document.getElementById('url').value`), jobs: jobsBefore, procs: ytdlpProcs() });
    // [붙여넣기] 버튼을 눌러 입력칸에 넣기만 해서는 다운로드가 시작되지 않고, [분석]을 눌러도 옵션 창에서 [다운로드]를 누르기 전에는 0건
    await click('#btnPaste'); await until(() => ev(`document.getElementById('url').value`), 5000, 150);
    check('UI9 [붙여넣기]를 눌러 입력칸에 넣기만 한 상태: 다운로드 요청 0건', (await ev(`document.getElementById('url').value`)).includes('WhWc3b3KhnY') && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === jobsBefore && ytdlpProcs() === 0);
    await ev(`document.getElementById('url').value=''`);
  }

  // ===== UI10: MP3 전용 화면(1.1.0) =====
  if (want('UI10')) {
    const MP3DIR = path.join(W, 'mp3');
    const readSettings = () => JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
    const mp3probe = file => { const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }); if (r.status !== 0) return { error: r.stderr }; const j = JSON.parse(r.stdout); const a = j.streams.find(s => s.codec_type === 'audio'); const tags = Object.fromEntries(Object.entries(j.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v])); return { acodec: a && a.codec_name, bitrate: a && Number(a.bit_rate), duration: Number(j.format.duration), title: tags.title, artist: tags.artist, pics: j.streams.filter(s => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic === 1).length }; };
    const visibleCards = () => ev(`[...document.querySelectorAll('.job')].filter(j=>j.offsetParent!==null).length`);
    const metaOf = id => ev(`(document.querySelector('.job[data-id="${id}"] .meta')||{}).textContent||''`);
    await click('#btnClear'); await sleep(400);
    check('UI10-0 처음에는 [동영상] 화면 — MP3 입력 카드 숨김·기본 링크창 표시', (await ev(`document.body.dataset.mode`)) === 'video' && (await ev(`document.getElementById('mp3Card').hidden`)) === true && (await ev(`document.getElementById('urlForm').offsetParent!==null`)) === true, await ev(`document.body.dataset.mode`));

    // --- 화면 전환 + 클립보드 자동 감지 ---
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -Value '들어 보세요 ${V.caminandes3} 입니다'`]);
    await click('#modeMp3');
    await sleep(5000); const autoVal = await ev(`document.getElementById('mp3Url').value`);
    check('UI10-1 [MP3] 화면으로 전환: MP3 카드 표시·동영상용 링크창/구독 탭 숨김', (await ev(`document.body.dataset.mode`)) === 'mp3' && (await ev(`document.getElementById('mp3Card').offsetParent!==null`)) && (await ev(`document.getElementById('urlForm').offsetParent===null && document.getElementById('tabSubs').offsetParent===null `)), await ev(`document.body.dataset.mode`));
    check('UI10-2 ★클립보드에 링크가 있어도 MP3 입력칸은 비어 있고(자동 채움 없음) 다운로드 요청 0건', autoVal === '' && (await cards()).length === 0 && ytdlpProcs() === 0, { autoVal, procs: ytdlpProcs() });
    await click('#mp3Paste'); await until(() => ev(`document.getElementById('mp3Url').value`), 5000, 150);
    check('UI10-2b [붙여넣기] 버튼을 누르면 클립보드 글에서 링크만 입력칸에 들어감(그래도 받기를 누르기 전에는 0건)', (await ev(`document.getElementById('mp3Url').value`)) === V.caminandes3 && (await cards()).length === 0, await ev(`document.getElementById('mp3Url').value`));
    check('UI10-3 기본값: 음질 320 kbps 선택·ID3 켜짐·저장 폴더 표시', (await ev(`document.querySelector('input[name=mp3q]:checked').value`)) === '320' && (await ev(`document.getElementById('mp3Id3').checked`)) === true && (await text('#mp3Dir')) === MP3DIR, [await ev(`document.querySelector('input[name=mp3q]:checked').value`), await text('#mp3Dir')]);
    check('UI10-4 마지막 사용 화면(mp3)이 설정 파일에 저장됨', await until(() => readSettings().lastMode === 'mp3', 5000, 200), readSettings().lastMode);
    check('UI10-5 음질 선택지는 128/192/256/320 네 가지뿐', JSON.stringify(await ev(`[...document.querySelectorAll('input[name=mp3q]')].map(i=>i.value)`)) === JSON.stringify(['128', '192', '256', '320']));

    // --- 128 kbps 단일 영상(분석 창 없이 바로 대기열) ---
    await click('input[name=mp3q][value="128"]');
    check('UI10-6 음질을 128 로 바꾸면 설정에 저장됨', await until(() => readSettings().mp3 && readSettings().mp3.bitrate === 128, 5000, 200), readSettings().mp3);
    const t0 = Date.now(); await click('#mp3Go');
    const c128 = await waitCard(x => true, 20000); // 카드는 바로 생기지만 제목은 yt-dlp 가 정보를 읽은 뒤(수 초)에 URL 에서 영상 제목으로 바뀐다
    const tCard = Date.now() - t0;
    check('UI10-7 [MP3 받기] 한 번에 옵션 창 없이 바로 대기열에 들어감(링크 칸은 비워짐)', !!c128 && !(await exists('.dlg')) && tCard < 3000 && (await ev(`document.getElementById('mp3Url').value`)) === '', { ms: tCard });
    const d128 = await waitCard(x => x.id === c128.id && x.status === 'completed', 240000);
    check('UI10-8 카드에 "MP3 128kbps" 표시·완료', !!d128 && /MP3 128kbps/.test(await metaOf(c128.id)), await metaOf(c128.id));
    const f128 = filesIn(MP3DIR).filter(f => /Caminandes.*\.mp3$/.test(f)); const p128 = f128[0] && mp3probe(f128[0]);
    check('UI10-9 ffprobe: 128000 bps·150초·ID3 제목/아티스트·앨범아트 1장', f128.length === 1 && p128 && p128.acodec === 'mp3' && p128.bitrate === 128000 && Math.abs(p128.duration - 150) < 2 && p128.title === 'Caminandes 3: Llamigos' && p128.artist === 'Blender' && p128.pics === 1, p128);

    // --- 320 kbps 단일 영상(두 번째 영상) ---
    await click('input[name=mp3q][value="320"]'); await setVal('#mp3Url', V.spring); await click('#mp3Go');
    const c320 = await waitCard(x => /Spring/.test(x.title), 30000);
    const d320 = c320 && await waitCard(x => x.id === c320.id && x.status === 'completed', 300000);
    const f320 = filesIn(MP3DIR).filter(f => /Spring.*\.mp3$/.test(f)); const p320 = f320[0] && mp3probe(f320[0]);
    check('UI10-10 320kbps 단일 영상: 카드 "MP3 320kbps"·완료·ffprobe 320000 bps·길이 464초±3·ID3 제목·앨범아트', !!d320 && /MP3 320kbps/.test(await metaOf(c320.id)) && p320 && p320.bitrate === 320000 && Math.abs(p320.duration - 464) < 3 && !!p320.title && p320.pics === 1, p320);

    // --- 같은 영상을 다른 음질로 다시 ---
    await click('input[name=mp3q][value="192"]'); await setVal('#mp3Url', V.caminandes3); await click('#mp3Go');
    const cRe = await waitCard(x => /Caminandes/.test(x.title) && x.id !== c128.id, 30000);
    await waitCard(x => cRe && x.id === cRe.id && x.status === 'completed', 240000);
    const fRe = filesIn(MP3DIR).filter(f => /Caminandes.*\.mp3$/.test(f)); const pRe = fRe[0] && mp3probe(fRe[0]);
    check('UI10-11 같은 영상을 192 로 다시 받으면 파일이 192000 bps 로 바뀜(파일은 하나)', fRe.length === 1 && pRe && pRe.bitrate === 192000, pRe);

    // --- 입력 오류 ---
    await setVal('#mp3Url', ''); await click('#mp3Go');
    check('UI10-12 빈 칸에서 [MP3 받기] → "링크를 입력해 주세요." 안내·작업 추가 없음', await until(async () => (await toasts()).some(t => /링크를 입력해 주세요/.test(t)), 5000, 200));
    const nBefore = (await cards()).length; await setVal('#mp3Url', 'file:///c:/windows/win.ini 그리고 javascript:alert(1)'); await click('#mp3Go');
    check('UI10-13 http(s) 가 아닌 입력 → "올바른 http(s) 링크가 아닙니다." 안내·작업 추가 없음', await until(async () => (await toasts()).some(t => /올바른 http\(s\) 링크가 아닙니다/.test(t)), 5000, 200) && (await cards()).length === nBefore, (await cards()).length);

    // --- 영상+재생목록 주소: 선택창 → 취소 ---
    await setVal('#mp3Url', V.caminandes3 + '&list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz'); await click('#mp3Go');
    const dlg = await waitSel('#dlgChoice', 15000);
    await clickBtnText('취소'); await sleep(400);
    check('UI10-14 영상+재생목록 주소: "이 영상만 / 재생목록 전체" 선택창이 뜨고, 취소하면 아무것도 추가되지 않음', dlg && !(await exists('#dlgChoice')) && (await cards()).length === nBefore, (await cards()).length);
    await setVal('#mp3Url', '');

    // --- 재생목록 전체 MP3 일괄(192 kbps) ---
    await click('#btnClear'); await sleep(300);
    await setVal('#mp3Url', V.playlist); await click('#mp3Go');
    const all = await until(async () => { const cs = await cards(); return cs.length >= 18 ? cs : null; }, 120000, 600);
    check('UI10-15 재생목록 링크 → 분석 후 전체(18개)가 MP3 작업으로 대기열에 들어감', !!all && all.length === 18, all && all.length);
    const done = await until(async () => { const cs = await cards(); return cs.length === 18 && cs.every(c => c.status === 'completed') ? cs : null; }, 1500000, 3000);
    const sub = path.join(MP3DIR, 'Blender Open Movies'); const mp3s = fs.existsSync(sub) ? fs.readdirSync(sub).filter(f => /\.mp3$/.test(f)).sort() : [];
    check('UI10-16 18개 모두 완료·재생목록 이름의 하위 폴더에 번호가 붙은 .mp3 18개(001 - … ~ 018 - …)', !!done && mp3s.length === 18 && mp3s.every((f, i) => f.startsWith(String(i + 1).padStart(3, '0') + ' - ')), { n: mp3s.length, first: mp3s[0], last: mp3s[mp3s.length - 1], st: (await cards()).map(c => c.status).join().slice(0, 100) });
    const pls = mp3s.slice(0, 18).map(f => mp3probe(path.join(sub, f)));
    check('UI10-17 ffprobe(18개 전부): mp3 코덱·192000 bps·제목 태그·앨범아트', pls.length === 18 && pls.every(p => p.acodec === 'mp3' && p.bitrate === 192000 && !!p.title && p.pics === 1), pls.filter(p => !(p.acodec === 'mp3' && p.bitrate === 192000 && p.title && p.pics === 1)).slice(0, 3));
    check('UI10-18 카드에 "재생목록: Blender Open Movies"·"MP3 192kbps" 표시', await ev(`[...document.querySelectorAll('.job .meta')].every(m=>m.textContent.includes('재생목록: Blender Open Movies')&&m.textContent.includes('MP3 192kbps'))`));

    // --- 화면별 목록 필터 ---
    await click('#modeVideo'); await sleep(300);
    const nAll = await visibleCards(); const nTotal = (await cards()).length;
    check('UI10-19 [동영상] 화면으로 돌아오면 링크창이 다시 보이고 모든 작업이 보임', (await ev(`document.getElementById('urlForm').offsetParent!==null && document.getElementById('mp3Card').hidden`)) && nAll === nTotal, { nAll, nTotal });
    check('UI10-20 [동영상] 화면으로 바꾸면 마지막 화면(video)이 저장됨', await until(() => readSettings().lastMode === 'video', 5000, 200), readSettings().lastMode);
    await click('#modeMp3'); await sleep(300);
    check('UI10-21 다시 [MP3] 화면: 선택한 음질(192)이 그대로·MP3 작업만 보임', (await ev(`document.querySelector('input[name=mp3q]:checked').value`)) === '192' && (await visibleCards()) === (await cards()).length, await ev(`document.querySelector('input[name=mp3q]:checked').value`));
    await click('#btnClear'); await sleep(300);
    check('UI10-22 [MP3] 화면에서 작업이 없으면 MP3 전용 안내 표시', (await ev(`!document.getElementById('emptyMp3').hidden`)) === true, null);

    // --- 재기동: 마지막 화면·음질·ID3 기억 ---
    await click('#mp3Id3'); await sleep(400);
    check('UI10-23 ID3 체크 해제가 설정에 저장됨', readSettings().mp3.id3 === false, readSettings().mp3);
    await click('#mp3Id3'); await sleep(400);
    await restartApp({ GOODSEEDOWN_TEST_YTDLP_ARGS: JSON.stringify(['--limit-rate', '100K']) });
    const rs = readSettings();
    check('UI10-24 앱을 완전히 끄고 다시 켜면 [MP3] 화면으로 시작(마지막 화면 기억)', (await ev(`document.body.dataset.mode`)) === 'mp3' && (await ev(`document.getElementById('mp3Card').offsetParent!==null`)) && rs.lastMode === 'mp3', { mode: await ev(`document.body.dataset.mode`), lastMode: rs.lastMode });
    check('UI10-25 재기동 후에도 음질 192·ID3 켜짐·저장 폴더가 그대로', (await ev(`document.querySelector('input[name=mp3q]:checked').value`)) === '192' && (await ev(`document.getElementById('mp3Id3').checked`)) === true && (await text('#mp3Dir')) === MP3DIR, [await ev(`document.querySelector('input[name=mp3q]:checked').value`), await text('#mp3Dir')]);

    // --- 일시정지·이어받기·취소 (느리게 받도록 100KB/s 로 제한해 재기동한 앱) ---
    for (const f of filesIn(MP3DIR).filter(f => /Caminandes.*\.mp3$/.test(f) && path.dirname(f) === MP3DIR)) fs.rmSync(f, { force: true });
    await setVal('#mp3Url', V.caminandes3 + '&list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz'); await click('input[name=mp3q][value="320"]'); await click('#mp3Go');
    await waitSel('#dlgChoice', 15000); await click('#btnChoiceVideo');
    const run = await waitCard(x => x.status === 'downloading' && /\d+%/.test(x.p1) && parseInt(x.p1) >= 10 && x.acts.includes('pause'), 120000);
    check('UI10-26 "이 영상만" → 영상 1개만 대기열에 들어가 진행률·속도 표시(MP3 화면의 목록)', !!run && (await cards()).length === 1 && /\/s/.test(run.p2), run && { p1: run.p1, p2: run.p2 });
    await actClick(run.id, 'pause');
    const paused = await waitCard(x => x.id === run.id && x.status === 'paused', 30000);
    const pct1 = paused && parseInt(paused.p1); await sleep(2500); const again = await cardBy(x => x.id === run.id);
    check('UI10-27 [일시정지] → "일시정지"·[이어받기][취소]·진행률 멈춤', !!paused && paused.acts.join() === 'resume,cancel' && parseInt(again.p1) === pct1, paused && [paused.acts, pct1, again.p1]);
    await actClick(run.id, 'resume');
    const resumed = await waitCard(x => x.id === run.id && x.status === 'downloading' && parseInt(x.p1) >= pct1, 60000);
    check('UI10-28 [이어받기] → 다시 받는 중, 진행률이 되돌아가지 않음', !!resumed, resumed && [pct1, resumed.p1]);
    await actClick(run.id, 'pause'); await waitCard(x => x.id === run.id && x.status === 'paused', 30000);
    await actClick(run.id, 'cancel'); await waitSel('.dlg button.primary', 5000); await clickBtnText('취소하기');
    const canc = await waitCard(x => x.id === run.id && x.status === 'canceled', 30000);
    check('UI10-29 [취소] → 취소됨·임시 파일 삭제·MP3 파일 없음', !!canc && filesIn(MP3DIR).filter(f => f.includes('.goodseedown-tmp')).length === 0 && !filesIn(MP3DIR).some(f => /Caminandes.*\.mp3$/.test(f) && path.dirname(f) === MP3DIR), { acts: canc && canc.acts });
    await actClick(run.id, 'retry');
    const re = await waitCard(x => x.id === run.id && ['downloading', 'processing', 'completed'].includes(x.status), 60000);
    check('UI10-30 취소된 MP3 작업 [다시 시작] → 처음부터 다시 진행', !!re, re && re.status);
    await actClick(run.id, 'cancel').catch(() => { }); await sleep(300); if (await exists('.dlg button.primary')) await clickBtnText('취소하기');
    await sleep(1200);
    await click('#modeVideo'); await sleep(500);
    check('UI10-31 [동영상] 화면으로 돌려놓음(설정 저장)', readSettings().lastMode === 'video', readSettings().lastMode);
  }

  // ===== UI12: 정보창·저작자 표기(1.1.0) =====
  if (want('UI12')) {
    const URLA = 'https://ohkyoungkeun-namecard.vercel.app/';
    const OPENLOG = path.join(W, 'openExternal.log'); fs.rmSync(OPENLOG, { force: true });
    const vi = p => { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $v=(Get-Item -LiteralPath '${p.replace(/'/g, "''")}').VersionInfo; ConvertTo-Json -Compress @{legal=$v.LegalCopyright; company=$v.CompanyName; product=$v.ProductName; fileVer=$v.FileVersion}`], { encoding: 'utf8' }); try { return JSON.parse(r.stdout); } catch { return { raw: r.stdout, err: r.stderr }; } };
    if (mode === 'exe') {
      const inner = spawnSync('powershell.exe', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter "Name='goodseedown.exe'" | ? { $_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('${marker.toLowerCase()}') } | select -First 1).ExecutablePath`], { encoding: 'utf8' }).stdout.trim();
      const a = vi(exe), b = inner ? vi(inner) : {};
      check('UI12-1 배포 exe(런처) VersionInfo 실측: LegalCopyright = "Copyright (c) 2026 굿씨드AI연구소 오경근 박사"·CompanyName = "goodseed AI LAB"', a.legal === 'Copyright (c) 2026 굿씨드AI연구소 오경근 박사' && a.company === 'goodseed AI LAB', a);
      check('UI12-2 앱 본체(풀린 goodseedown.exe) VersionInfo 실측: 같은 LegalCopyright·CompanyName·ProductName goodseedown·버전 1.2.1', b.legal === 'Copyright (c) 2026 굿씨드AI연구소 오경근 박사' && b.company === 'goodseed AI LAB' && b.product === 'goodseedown' && /^1\.2\.1/.test(b.fileVer || ''), { inner, b });
    }
    await restartApp({ GOODSEEDOWN_TEST_OPEN_LOG: OPENLOG });
    await click('#btnAbout');
    const dlg = await waitSel('#dlgAbout', 10000);
    const t = await text('#dlgAbout');
    check('UI12-3 정보창: "굿씨드AI연구소(goodseed AI LAB) 오경근 박사"·Copyright 줄 표시', dlg && /굿씨드AI연구소\(goodseed AI LAB\) 오경근 박사/.test(t) && /Copyright \(c\) 2026 굿씨드AI연구소 오경근 박사/.test(t) && /1\.2\.1/.test(t), t.replace(/\n/g, ' ').slice(0, 200));
    check('UI12-4 "오경근 박사"는 링크(a)이고 주소는 https://ohkyoungkeun-namecard.vercel.app/', (await ev(`document.getElementById('aboutAuthor').tagName`)) === 'A' && (await ev(`document.getElementById('aboutAuthor').getAttribute('href')`)) === URLA && (await text('#aboutAuthor')) === '오경근 박사', await ev(`document.getElementById('aboutAuthor').getAttribute('href')`));
    const pageUrl0 = await ev(`location.href`); const nPages0 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(x => x.type === 'page').length;
    check('UI12-5 링크를 누르기 전에는 openExternal 호출 0건', !fs.existsSync(OPENLOG), null);
    await click('#aboutAuthor');
    const logged = await until(() => fs.existsSync(OPENLOG) && fs.readFileSync(OPENLOG, 'utf8'), 8000, 200);
    await sleep(800);
    const pages1 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(x => x.type === 'page');
    check('UI12-6 ★링크 클릭 → 메인 프로세스가 shell.openExternal(https://ohkyoungkeun-namecard.vercel.app/) 를 정확히 1번 호출', logged && logged.trim() === 'shell.openExternal ' + URLA, logged);
    check('UI12-7 앱 안에서는 이동하지 않음(앱 화면 주소 그대로·새 창 없음)', (await ev(`location.href`)) === pageUrl0 && pages1.length === nPages0 && /index\.html$/.test(pages1[0].url), { before: pageUrl0, after: await ev(`location.href`), pages: pages1.length });
    await click('#btnAboutClose'); await sleep(300);
    await click('#tabSettings'); await sleep(500);
    check('UI12-8 설정 화면의 [goodseedown 정보] 버튼으로도 정보창이 열림', (await exists('#btnAbout2')) && (await (async () => { await click('#btnAbout2'); return waitSel('#dlgAbout', 5000); })()), null);
    await click('#btnAboutClose'); await click('#tabDownloads');
  }
} catch (e) { check('시험 진행 중 예외', false, e.stack || String(e)); }

cdp.close(); await sleep(500);
// 종료는 앱의 정상 종료 경로(창 닫기)로 시도하고, 남으면 정리한다.
try { child.kill(); } catch { } killMine(); await sleep(1500);
const left = mine();
check('시험 후 시험이 띄운 프로세스 정리', left.length === 0, left);
const report = { when: new Date().toISOString(), mode, total: results.length, passed: results.filter(r => r.ok && !r.limited).length, limited: results.filter(r => r.limited).length, failed: results.filter(r => !r.ok).length, results };
fs.writeFileSync(path.join(B, `verification_ui-${label}.json`), JSON.stringify(report, null, 1));
console.log(`\n=== ${report.passed}/${report.total} 통과${report.failed ? ' — 실패: ' + results.filter(r => !r.ok).map(f => f.name).join(' | ') : ''} ===`);
process.exit(report.failed ? 1 : 0);
