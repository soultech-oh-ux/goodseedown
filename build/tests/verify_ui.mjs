// goodseedown 화면(UI) 종단 시험 — 실제 앱(Electron)을 띄우고 원격 디버깅(CDP)으로 실제 클릭·입력을 하며 결과 파일을 ffprobe 로 확인한다.
//   --mode exe : 빌드한 포터블 exe(dist\goodseedown-1.1.0-Windows-x64.exe) / --mode dev : electron-base + src (빠른 반복)
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
const exe = path.join(B, '..', 'dist', 'goodseedown-1.1.0-Windows-x64.exe');
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

  // ===== UI2: 단일 영상 — 분석 → 옵션 → 다운로드 =====
  if (want('UI2')) {
    await submitUrl(V.caminandes3);
    check('UI2 링크 분석 후 옵션 창 표시(제목·업로더·길이·라이선스)', await waitSel('#dlgVideo', 60000) && /Caminandes 3/.test(await text('#dlgVideo')) && /2:30/.test(await text('#dlgVideo')) && /Creative Commons/.test(await text('#dlgVideo')), (await text('#dlgVideo')).slice(0, 120).replace(/\n/g, ' '));
    const q = await ev(`[...document.querySelectorAll('#opt-quality option')].map(o=>o.textContent)`);
    check('UI2 화질 선택지에 8K·4K·1080p·720p 포함', ['8K (4320p)', '4K (2160p)', '1080p (Full HD)', '720p (HD)'].every(x => q.includes(x)) && (await ev(`!!document.getElementById('opt-vfmt-mp4')&&!!document.getElementById('opt-vfmt-mkv')&&!!document.getElementById('opt-afmt-mp3')&&!!document.getElementById('opt-afmt-m4a')&&!!document.getElementById('opt-afmt-ogg')`)), q);
    await setVal('#opt-quality', '1080'); await click('#opt-vfmt-mp4'); await click('#opt-save-default');
    await click('#btnOptStart');
    const c = await waitCard(x => x.status === 'completed' && /Caminandes/.test(x.title), 240000);
    check('UI2 목록에 카드가 생기고 진행 후 "완료" 표시', !!c && c.chip === '완료', c && { chip: c.chip, p1: c.p1 });
    const mp4 = filesIn(OUT).find(f => /\.mp4$/.test(f)); const p = mp4 && probe(mp4);
    check('UI2 결과 파일 ffprobe: 1080p H.264 MP4·150초', p && p.height === 1080 && p.vcodec === 'h264' && Math.abs(p.duration - 150) < 2, p);
    const st = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));
    check('UI2 "기본값으로 저장" 체크 → 설정에 기본값 저장(MP4·1080)', st.defaults && st.defaults.quality === '1080' && st.defaults.videoFormat === 'mp4', st.defaults);
    check('UI2 완료 카드에 열기·폴더에서 보기·삭제 버튼', JSON.stringify(c.acts) === JSON.stringify(['open', 'folder', 'remove']), c.acts);
    check('UI2 정리: 탭 배지 등 화면 오류 없음(빈 화면 안내 숨김)', !(await ev(`!document.getElementById('emptyJobs').hidden`)));
  }

  // ===== UI3: 일시정지·이어받기·취소·다시 시작 =====
  if (want('UI3')) {
    await submitUrl(V.caminandes3); await waitSel('#dlgVideo', 60000);
    await click('#opt-kind-video'); await setVal('#opt-quality', '1080'); await click('#opt-vfmt-mkv');
    await click('#btnOptStart');
    const run = await waitCard(x => x.status === 'downloading' && /\d+%/.test(x.p1) && parseInt(x.p1) >= 8 && x.acts.includes('pause'), 90000);
    check('UI3 진행 중 카드: 퍼센트·속도·남은 시간 표시 + [일시정지][취소] 버튼', !!run && /\d+%/.test(run.p1) && /\/s/.test(run.p2) && /남은 시간/.test(run.p2) && run.acts.join() === 'pause,cancel', run && { p1: run.p1, p2: run.p2 });
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
    check('UI3 [다시 시작] → 완료·ffprobe 1080p MKV', !!done && p && /matroska/.test(p.format) && p.height === 1080, p);
  }

  // ===== UI4: 재생목록 일괄 =====
  if (want('UI4')) {
    await click('#btnClear');
    await submitUrl(V.playlist);
    check('UI4 재생목록 분석 → 목록 18개·제목 표시', await waitSel('#dlgPlaylist', 90000) && /Blender Open Movies/.test(await text('#dlgPlaylist')) && (await ev(`document.querySelectorAll('#plist input').length`)) === 18, (await text('#dlgPlaylist')).slice(0, 60).replace(/\n/g, ' '));
    await setVal('#plFirstN', '3'); await click('#plFirstBtn');
    check('UI4 "앞에서 3개만 선택" → 3개 선택 표시', /3개 선택/.test(await text('#plCount')), await text('#plCount'));
    await click('#opt-kind-audio'); await click('#opt-afmt-mp3'); await click('#opt-prefix');
    await click('#btnOptStart');
    const three = await until(async () => { const cs = await cards(); return cs.length === 3 && cs.every(c => c.status === 'completed') ? cs : null; }, 300000, 800);
    const sub = path.join(OUT, 'Blender Open Movies'); const mp3 = fs.existsSync(sub) ? fs.readdirSync(sub).filter(f => /\.mp3$/.test(f)) : [];
    check('UI4 3개 카드 모두 완료·재생목록 이름 하위 폴더·번호 접두(001 - …)', !!three && mp3.length === 3 && ['001 - ', '002 - ', '003 - '].every(pf => mp3.some(f => f.startsWith(pf))), mp3);
    check('UI4 카드에 "재생목록: Blender Open Movies" 출처 표시', await ev(`[...document.querySelectorAll('.job .meta')].every(m=>m.textContent.includes('재생목록: Blender Open Movies'))`));
  }

  // ===== UI5: 자막 =====
  if (want('UI5')) {
    await click('#btnClear');
    await submitUrl(V.sintel);
    await waitSel('#dlgVideo', 90000);
    check('UI5 영상의 수동 자막 언어 목록이 칩으로 표시(영어·프랑스어 등)', await ev(`document.querySelectorAll('#opt-subs-chips input').length`) >= 29, await ev(`document.querySelectorAll('#opt-subs-chips input').length`));
    await click('#opt-kind-subs');
    check('UI5 "자막만" 선택 시 영상 옵션 숨김·자막 옵션 표시', (await ev(`document.querySelector('[data-for="video"]').hidden`)) === true && (await ev(`!document.querySelector('#opt-subs-area .subs-body').hidden`)), null);
    await ev(`(()=>{for(const v of ['en']){const i=document.querySelector('#opt-subs-chips input[value="'+v+'"]'); i.click();} const k=[...document.querySelectorAll('#opt-subs-chips input')].find(i=>/^ko/.test(i.value)); return !!k})()`);
    await setVal('#opt-subs-extra', 'ko,en');
    await click('#btnOptStart');
    const c = await waitCard(x => /Sintel/.test(x.title) && ['completed', 'failed'].includes(x.status), 180000);
    const srts = filesIn(OUT).filter(f => /Sintel.*\.srt$/.test(f));
    check('UI5 자막만 받기 → SRT 파일 생성(영어는 존재, 영상에 없는 한국어는 건너뜀)', !!c && c.status === 'completed' && srts.some(f => /\.en\.srt$/.test(f)), { status: c && c.status, msg: c && c.msg, files: srts.map(f => path.basename(f)) });
    const t = srts[0] && fs.readFileSync(srts[0], 'utf8');
    check('UI5 SRT 내용 형식(번호·시간표)', t && /^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> /.test(t), t && t.slice(0, 60));
    // 영상에 합치기
    await click('#btnClear');
    await submitUrl(V.spring); await waitSel('#dlgVideo', 90000);
    await click('#opt-kind-video'); await setVal('#opt-quality', '360'); await click('#opt-vfmt-mp4');
    await click('#opt-subs-on'); await ev(`document.querySelector('#opt-subs-chips input[value="en"]').click()`); await click('#opt-submode-embed');
    await click('#btnOptStart');
    const c2 = await waitCard(x => /Spring/.test(x.title) && ['completed', 'failed'].includes(x.status), 400000);
    const mp4 = filesIn(OUT).find(f => /Spring.*\.mp4$/.test(f)); const p = mp4 && probe(mp4);
    check('UI5 영상에 합치기(소프트 자막) → MP4 안에 자막 트랙 1개(ffprobe)·"자막을 찾지 못했다"는 잘못된 안내 없음', !!c2 && c2.status === 'completed' && p && p.subs === 1 && p.height >= 358 && !/찾지 못/.test(c2.msg), { status: c2 && c2.status, msg: c2 && c2.msg, p });
  }

  // ===== UI6: 스마트 모드 =====
  if (want('UI6')) {
    await click('#btnClear');
    await click('#smartToggle'); await sleep(500);
    check('UI6 스마트 모드 켜면 버튼이 "바로 받기"로 바뀜·설정 저장', (await text('#btnGo')) === '바로 받기' && JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).smartMode === true, await text('#btnGo'));
    const t0 = Date.now(); await submitUrl(V.caminandes3 + '&list=PLav47HAVZMjnTFVZL-aImCQIC0uLZtNCz');
    const c = await waitCard(x => /Caminandes|youtube/.test(x.title) || true, 20000);
    const dt = Date.now() - t0;
    check('UI6 링크 붙여넣고 한 번(Enter/버튼)만 눌렀는데 옵션 창 없이 바로 대기열에 들어감', !!c && !(await exists('.dlg')) && dt < 5000, { ms: dt, title: c && c.title });
    const done = await waitCard(x => x.status === 'completed', 240000);
    const files = filesIn(OUT).filter(f => /Caminandes 3.*\.mp4$/.test(f)).length;
    check('UI6 저장된 기본값(MP4 1080p)대로 받음·영상+재생목록 주소는 영상 한 개만', !!done && (await cards()).length === 1 && files >= 1 && probe(filesIn(OUT).filter(f => /Caminandes 3.*\.mp4$/.test(f)).pop()).height === 1080, (await cards()).length);
    await click('#smartToggle'); await sleep(300);
    check('UI6 스마트 모드 끄면 다시 "분석"', (await text('#btnGo')) === '분석', await text('#btnGo'));
  }

  // ===== UI7: 구독 =====
  if (want('UI7')) {
    await click('#btnClear');
    await submitUrl(V.playlist); await waitSel('#dlgPlaylist', 90000);
    await click('#btnSubscribe');
    await until(() => ev(`document.querySelectorAll('.sub').length`), 30000, 300);
    check('UI7 [구독하기] → 구독 탭에 재생목록 구독 등록(본 영상 18개)', (await ev(`document.querySelectorAll('.sub').length`)) === 1 && /Blender Open Movies/.test(await text('.sub')) && /본 영상 18개/.test(await text('.sub')), (await text('.sub')).replace(/\n/g, ' ').slice(0, 140));
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
    check('UI8 설정 화면: yt-dlp 엔진 버전(날짜 형식)·앱 버전 표시', /^\d{4}\.\d{2}\.\d{2}/.test(ver) && /버전 1\.1\.0/.test(await text('#appVer')), [ver, await text('#appVer')]);
    await setVal('#set-conc', '5'); await sleep(500);
    check('UI8 동시 다운로드 수 변경 저장(5)', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).maxConcurrent === 5);
    await setVal('#set-conc', '99'); await sleep(500);
    check('UI8 범위 밖 값(99)은 6 으로 보정', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).maxConcurrent === 6);
    await setVal('#set-interval', '30'); await sleep(400);
    check('UI8 구독 확인 주기 변경 저장(30분)', JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).subscriptionIntervalMin === 30);
    await click('#def-kind-audio'); await click('#def-afmt-m4a'); await sleep(400);
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')).defaults;
    check('UI8 스마트 모드 기본값(음성 M4A) 변경 저장', d.kind === 'audio' && d.audioFormat === 'm4a', d);
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
    await click('#smartToggle'); await sleep(400);
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Set-Clipboard -Value 'https://www.youtube.com/watch?v=eRsGyueVLvQ'`]);
    await sleep(5000);
    check('UI9 ★스마트 모드를 켜 두고 클립보드에 링크를 복사해도 다운로드 요청 0건(스마트 모드는 붙여넣은 링크를 제출했을 때만)', (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === jobsBefore && ytdlpProcs() === 0 && (await ev(`document.getElementById('url').value`)) === '', { procs: ytdlpProcs() });
    await click('#smartToggle'); await sleep(300);
    // [붙여넣기] 버튼을 눌러 입력칸에 넣기만 해서는 다운로드가 시작되지 않고, [분석]을 눌러도 옵션 창에서 [다운로드]를 누르기 전에는 0건
    await click('#btnPaste'); await until(() => ev(`document.getElementById('url').value`), 5000, 150);
    check('UI9 [붙여넣기]를 눌러 입력칸에 넣기만 한 상태: 다운로드 요청 0건', (await ev(`document.getElementById('url').value`)).includes('eRsGyueVLvQ') && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === jobsBefore && ytdlpProcs() === 0);
    await click('#btnGo'); const od = await waitSel('#dlgVideo', 90000); await sleep(1500);
    check('UI9 [분석] 후 옵션 창이 떠 있는 동안에도 다운로드 요청 0건(옵션 창의 [다운로드]를 눌러야 시작)', od && (await ev(`window.gsd.listJobs().then(a=>a.length)`)) === jobsBefore, null);
    await click('#btnOptCancel'); await sleep(500); await ev(`document.getElementById('url').value=''`);
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
    check('UI10-1 [MP3] 화면으로 전환: MP3 카드 표시·동영상용 링크창/스마트 스위치/구독 탭 숨김', (await ev(`document.body.dataset.mode`)) === 'mp3' && (await ev(`document.getElementById('mp3Card').offsetParent!==null`)) && (await ev(`document.getElementById('urlForm').offsetParent===null && document.getElementById('tabSubs').offsetParent===null && document.querySelector('.smart').offsetParent===null`)), await ev(`document.body.dataset.mode`));
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
    const dlg = await waitSel('#dlgMp3Choice', 15000);
    await clickBtnText('취소'); await sleep(400);
    check('UI10-14 영상+재생목록 주소: "이 영상만 / 재생목록 전체" 선택창이 뜨고, 취소하면 아무것도 추가되지 않음', dlg && !(await exists('#dlgMp3Choice')) && (await cards()).length === nBefore, (await cards()).length);
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
    await waitSel('#dlgMp3Choice', 15000); await click('#btnMp3ChoiceVideo');
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
      check('UI12-2 앱 본체(풀린 goodseedown.exe) VersionInfo 실측: 같은 LegalCopyright·CompanyName·ProductName goodseedown·버전 1.1.0', b.legal === 'Copyright (c) 2026 굿씨드AI연구소 오경근 박사' && b.company === 'goodseed AI LAB' && b.product === 'goodseedown' && /^1\.1\.0/.test(b.fileVer || ''), { inner, b });
    }
    await restartApp({ GOODSEEDOWN_TEST_OPEN_LOG: OPENLOG });
    await click('#btnAbout');
    const dlg = await waitSel('#dlgAbout', 10000);
    const t = await text('#dlgAbout');
    check('UI12-3 정보창: "굿씨드AI연구소(goodseed AI LAB) 오경근 박사"·Copyright 줄 표시', dlg && /굿씨드AI연구소\(goodseed AI LAB\) 오경근 박사/.test(t) && /Copyright \(c\) 2026 굿씨드AI연구소 오경근 박사/.test(t) && /1\.1\.0/.test(t), t.replace(/\n/g, ' ').slice(0, 200));
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
