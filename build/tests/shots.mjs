// 새 메인 화면 스크린샷(배너 없음/있음/다운로드 목록 있음/MP3 형식) — 실제 앱(exe)을 띄워 CDP 로 캡처한다. 가짜 릴리스 서버(127.0.0.1)만 쓴다.
// 사용: node tests/shots.mjs [--mode exe|dev] [--out <폴더>]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
import { createFakeServer } from '../fake-release-server.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const B = path.resolve(here, '..');
const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const mode = arg('--mode', 'exe'); const OUTDIR = arg('--out', path.join(B, '..', '_evidence', '1.2.1'));
const PORT = 9412; const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 60000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; };
const exe = path.join(B, '..', 'dist', 'goodseedown-1.2.1-Windows-x64.exe');
const W = path.join(B, 'work', 'shots'); fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true }); fs.mkdirSync(OUTDIR, { recursive: true });
const DATA = path.join(W, 'data'); fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ schema: 1, saveDir: path.join(W, 'out'), copyrightAcknowledged: true, engineAutoCheck: false }));
const marker = mode === 'exe' ? '\\goodseedown\\bin\\' : path.join(B, 'electron-base').toLowerCase();
function mine() { const m = marker.replace(/'/g, "''").toLowerCase(); const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name='goodseedown.exe' OR Name='electron.exe'" | ? { $_.ExecutablePath -and $_.ExecutablePath.ToLower().Contains('${m}') } | % { $_.ProcessId }) -join ','`], { encoding: 'utf8' }); return r.stdout.trim().split(',').filter(Boolean).map(Number); }
const killMine = () => { for (const p of mine()) { try { process.kill(p); } catch { } } };
const srv = await createFakeServer({ exe: Buffer.from('MZ' + 'x'.repeat(8192)), tag: 'v1.2.2', notes: ['■ 바뀐 점', '- 새 기능 A(시험용 릴리스 노트)', '- 오류 수정 B'].join(String.fromCharCode(10)) });
let child, cdp;
async function launch(api) {
  const env = { ...process.env, GOODSEEDOWN_UPDATE_API: api, GOODSEEDOWN_ENGINE_API: 'http://127.0.0.1:9/none', GOODSEEDOWN_DATA_ROOT: DATA, GOODSEEDOWN_DEBUG_PORT: String(PORT), GOODSEEDOWN_TEST_YTDLP_ARGS: JSON.stringify(['--limit-rate', '300K']) };
  if (mode === 'dev') env.GOODSEEDOWN_TOOLS_DIR = path.join(B, 'bundle', 'resources', 'tools');
  child = mode === 'exe' ? spawn(exe, [], { env, stdio: 'ignore' }) : spawn(path.join(B, 'electron-base', 'electron.exe'), [path.join(B, 'src')], { env, stdio: 'ignore' });
  cdp = await until(async () => { try { return await connect(PORT, t => t.type === 'page' && /goodseedown/.test(t.title)); } catch { return null; } }, 120000, 800);
  if (!cdp) throw new Error('앱을 띄우지 못했습니다');
  await until(() => cdp.ev(`document.readyState==='complete'&&!!document.getElementById('updBanner')`), 30000, 300);
}
async function stop() { try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { } try { cdp.close(); } catch { } await until(() => mine().length === 0, 60000, 500); killMine(); await sleep(1200); }
const shot = async name => { await cdp.send('Page.bringToFront'); const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.result.data, 'base64')); console.log('저장', name); };
const out = [];
try {
  killMine(); await sleep(1500);
  // 1) 최신(배너 없음) — 새 메인 화면
  srv.cfg.tag = 'v1.2.1'; await launch(srv.apiUrl); await sleep(9000);
  await shot('main-1-no-banner.png'); out.push(['배너 없음(최신)', await cdp.ev(`!document.getElementById('updBanner').hidden`)]);
  await stop();
  // 2) 새 버전 있음 — 배너
  srv.cfg.tag = 'v1.2.2'; await launch(srv.apiUrl);
  await until(() => cdp.ev(`!document.getElementById('updBanner').hidden`), 40000, 400); await sleep(600);
  await shot('main-2-banner.png'); out.push(['배너 있음(1.2.2)', await cdp.ev(`document.getElementById('updText').innerText + ' / ' + document.getElementById('updHow').innerText`)]);
  // 방법 안내 창
  await cdp.ev(`document.getElementById('btnUpdGuide').click()`); await until(() => cdp.ev(`!!document.getElementById('dlgUpdate')`), 5000, 200); await sleep(500);
  await shot('main-3-guide-dialog.png');
  await cdp.ev(`document.getElementById('btnUpdGuideClose').click()`); await sleep(300);
  // [나중에] 뒤 다운로드 탭으로 돌아오면 작은 재알림
  await cdp.ev(`document.getElementById('btnUpdLater').click()`); await sleep(300);
  await cdp.ev(`document.getElementById('tabSettings').click()`); await sleep(400); await cdp.ev(`document.getElementById('tabDownloads').click()`); await sleep(700);
  await shot('main-4-later-then-reminder.png'); out.push(['재알림', await cdp.ev(`(document.getElementById('updNag')||{}).innerText||''`)]);
  // 다운로드 목록이 있는 화면(받는 중) — 입력줄 너비 확인용
  await cdp.ev(`(()=>{const u=document.getElementById('url');u.value='https://www.youtube.com/watch?v=SkVqJ1SGeL0';document.getElementById('btnGo').click();return true})()`);
  await until(() => cdp.ev(`window.gsd.listJobs().then(j=>j[0]&&j[0].status==='downloading'&&j[0].progress.percent>=3)`), 90000, 500); await sleep(800);
  await cdp.ev(`document.querySelectorAll('#updNag').forEach(n=>n.remove())`);
  await shot('main-5-downloading-wide-input.png');
  const jobs = await cdp.ev(`window.gsd.listJobs()`); for (const j of jobs) await cdp.ev(`window.gsd.job('cancel', ${JSON.stringify(j.id)})`);
  await sleep(1500);
  await stop();
  // 업데이트 직후 첫 실행 안내(업데이터가 남기는 표시 파일을 만들어 두고 서버 없이 실행)
  const nf = path.join(DATA, 'updates', 'updated-notice.json'); fs.mkdirSync(path.dirname(nf), { recursive: true }); fs.writeFileSync(nf, JSON.stringify({ from: '1.2.0', to: '1.2.1' }));
  await launch('http://127.0.0.1:9/none'); await until(() => cdp.ev(`!!document.getElementById('dlgUpdated')`), 15000, 200); await sleep(500);
  await shot('main-6-updated-notice.png'); out.push(['완료 안내', await cdp.ev(`(document.getElementById('dlgUpdated')||{}).innerText||''`)]);
  await cdp.ev(`document.getElementById('btnUpdatedOk').click()`); await sleep(300);
  // 입력줄 최소 창 너비(880px)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  await shot('main-7-min-width-880.png');
} catch (e) { console.log('오류', e.stack || e); process.exitCode = 1; }
await stop().catch(() => { }); await srv.close(); killMine();
console.log(JSON.stringify(out));
