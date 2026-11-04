'use strict';
// goodseedown 자동 업데이트 (GitHub Releases · 공개 저장소)
// 흐름: 릴리스 조회 → semver 비교 → 한국어 확인(수동 확인=대화상자 / 시작 시 자동 확인=화면 상단 배너) → 다운로드(진행률·취소) → SHA256SUMS.txt 검증
//       → (앱 종료 후) 보조 스크립트가 포터블 exe 를 교체·재실행 · 실패하면 기존 exe 복원.
// 차등 업데이트: 릴리스에 PATCHES.json(이전 버전 exe 의 SHA-256 → 패치 파일)이 있고 지금 실행 중인 exe 의 해시가
//       기준 해시와 같으면 패치만 받아 번들된 hpatchz.exe(HDiffPatch, MIT)로 새 exe 를 만든 뒤 SHA256SUMS.txt 의
//       전체 exe 해시와 대조한다. 기준 불일치·패치 손상·적용 실패·해시 불일치면 전체 exe 다운로드로 자동 폴백한다.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

// ★ 배포 저장소 설정 — 이 상수 한 곳만 고치면 된다. 형식은 'owner/repo'.
//   아래처럼 <owner> 가 그대로 남아 있으면 '미설정' 으로 보고 업데이트 확인을 조용히 건너뛴다.
const UPDATE_REPO = 'soultech-oh-ux/goodseedown'; // 오너 확정 2026-11-01: 소스·릴리스를 같은 공개 저장소에서 운영

const API_TEMPLATE = 'https://api.github.com/repos/%REPO%/releases/latest';
const SUMS_NAME = 'SHA256SUMS.txt';
const PATCHES_NAME = 'PATCHES.json';
const exeAssetName = v => `goodseedown-${v}-Windows-x64.exe`;
const AUTO_CHECK_DELAY_MS = 6000;
const API_TIMEOUT_MS = 8000;
const NET_IDLE_TIMEOUT_MS = 30000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SUMS_BYTES = 256 * 1024;
const MAX_PATCH_MANIFEST_BYTES = 256 * 1024;
const PATCH_APPLY_TIMEOUT_MS = 10 * 60 * 1000;
const PATCH_WORTH_RATIO = 0.9; // 패치가 전체 크기의 90% 이상이면 이득이 없으므로 전체를 받는다

class UpdateError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// ---------- 순수 함수 (Electron 없이 시험 가능) ----------
const isRepoValid = r => typeof r === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r);

function parseSemver(text) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

const isLoopback = h => h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';

// 설정: GOODSEEDOWN_UPDATE_API 환경변수(시험용)가 있으면 그 주소를 쓰고, 그 주소가 루프백(127.0.0.1 등)일 때만
// 해당 host:port 로의 접근(http 포함)을 추가 허용한다. 그 밖의 호스트는 github.com 계열만 허용한다.
function getConfig(env = process.env, repoConst = UPDATE_REPO) {
  const override = String(env.GOODSEEDOWN_UPDATE_API || '').trim();
  const repo = String(env.GOODSEEDOWN_UPDATE_REPO || repoConst || '').trim();
  let apiUrl = '', testHost = null;
  if (override) {
    apiUrl = override;
    try { const u = new URL(override); if (isLoopback(u.hostname)) testHost = u.host; } catch { apiUrl = ''; }
  } else if (isRepoValid(repo)) {
    apiUrl = API_TEMPLATE.replace('%REPO%', repo);
  }
  const configured = !!apiUrl;
  const policy = {
    check(u) {
      if (testHost && u.host === testHost && (u.protocol === 'http:' || u.protocol === 'https:')) return null;
      if (u.protocol !== 'https:') return `https 가 아닌 주소는 허용하지 않습니다: ${u.protocol}`;
      if (u.port && u.port !== '443') return `허용하지 않는 포트입니다: ${u.port}`;
      const h = u.hostname.toLowerCase();
      if (h === 'github.com' || h.endsWith('.github.com') || h.endsWith('.githubusercontent.com')) return null;
      return `허용하지 않는 호스트입니다: ${h}`;
    },
  };
  return { configured, repo, apiUrl, policy, testHost };
}

// SHA256SUMS.txt (sha256sum 형식: "<64hex>  <파일명>" 또는 "<64hex> *<파일명>") 에서 파일의 해시를 찾는다.
function parseSums(text, fileName) {
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(raw);
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

function openStream(url, { headers = {}, timeoutMs = NET_IDLE_TIMEOUT_MS, signal, policy, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const go = u => {
      let parsed;
      try { parsed = new URL(u); } catch { return reject(new UpdateError('bad-url', '잘못된 주소입니다.')); }
      const blocked = policy.check(parsed);
      if (blocked) return reject(new UpdateError('blocked-host', blocked, { url: parsed.href }));
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(parsed, { headers, timeout: timeoutMs }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (++hops > maxRedirects) return reject(new UpdateError('redirects', '리다이렉트가 너무 많습니다.'));
          const loc = res.headers.location;
          if (!loc) return reject(new UpdateError('redirects', '리다이렉트 위치가 없습니다.'));
          return go(new URL(loc, parsed).href);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new UpdateError('http', `서버 응답 오류(HTTP ${res.statusCode})`, { status: res.statusCode })); }
        resolve({ res, req, finalUrl: parsed.href });
      });
      req.on('timeout', () => req.destroy(new UpdateError('timeout', '응답 시간이 초과되었습니다.')));
      req.on('error', e => reject(e instanceof UpdateError ? e : new UpdateError('network', e.message)));
      if (signal) {
        if (signal.aborted) { req.destroy(); return reject(new UpdateError('aborted', '취소되었습니다.')); }
        signal.addEventListener('abort', () => req.destroy(new UpdateError('aborted', '취소되었습니다.')), { once: true });
      }
    };
    go(url);
  });
}

async function readBody(res, limit) {
  const chunks = []; let n = 0;
  for await (const c of res) { n += c.length; if (n > limit) { res.destroy(); throw new UpdateError('too-large', '응답이 너무 큽니다.'); } chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchLatestRelease(cfg, { signal, userAgent = 'goodseedown' } = {}) {
  const { res } = await openStream(cfg.apiUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent }, timeoutMs: API_TIMEOUT_MS, signal, policy: cfg.policy });
  let j;
  try { j = JSON.parse(await readBody(res, MAX_JSON_BYTES)); } catch (e) { if (e instanceof UpdateError) throw e; throw new UpdateError('bad-json', '릴리스 정보를 해석하지 못했습니다.'); }
  if (!j || typeof j !== 'object' || j.draft || j.prerelease) return null;
  const sv = parseSemver(j.tag_name);
  if (!sv) return null;
  return {
    tag: String(j.tag_name),
    version: sv.join('.'),
    notes: String(j.body || ''),
    htmlUrl: typeof j.html_url === 'string' ? j.html_url : '',
    assets: Array.isArray(j.assets) ? j.assets.map(a => ({ name: String(a?.name || ''), url: String(a?.browser_download_url || ''), size: Number.isFinite(a?.size) ? a.size : null })) : [],
  };
}

const sha256File = file => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});
const rmQuiet = (...ps) => { for (const p of ps) { try { fs.rmSync(p, { force: true }); } catch { } } };
const hasMzHeader = file => { const fd = fs.openSync(file, 'r'); try { const m = Buffer.alloc(2); fs.readSync(fd, m, 0, 2, 0); return m.toString('latin1') === 'MZ'; } finally { fs.closeSync(fd); } };

// SHA256SUMS.txt 에서 전체 exe 의 기대 해시를 읽는다.
async function fetchExpectedHash(cfg, release, name, { signal, userAgent }) {
  const sumsAsset = release.assets.find(a => a.name === SUMS_NAME);
  if (!sumsAsset) throw new UpdateError('assets', `릴리스에 ${SUMS_NAME} 파일이 없습니다.`);
  const sums = await openStream(sumsAsset.url, { headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' }, signal, policy: cfg.policy });
  const expected = parseSums(await readBody(sums.res, MAX_SUMS_BYTES), name);
  if (!expected) throw new UpdateError('no-hash', `${SUMS_NAME} 에 ${name} 의 해시가 없어 검증할 수 없습니다.`);
  return expected;
}

// asset 하나를 part 파일로 받아 크기·SHA-256 을 검증한다. 실패·취소 시 part 를 지우고 오류를 던진다(성공하면 part 를 남긴다).
async function downloadToFile(cfg, asset, part, { signal, onProgress, userAgent, expectedSha, expectedSize }) {
  rmQuiet(part);
  const dl = await openStream(asset.url, { headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' }, signal, policy: cfg.policy });
  const total = Number(dl.res.headers['content-length']) || asset.size || 0;
  const hash = crypto.createHash('sha256');
  let received = 0, lastReport = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk); received += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastReport > 100) { lastReport = now; onProgress(received, total); }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(dl.res, meter, fs.createWriteStream(part));
  } catch (e) {
    rmQuiet(part);
    if (signal?.aborted) throw new UpdateError('aborted', '취소되었습니다.');
    throw e instanceof UpdateError ? e : new UpdateError('network', e.message || '다운로드 중 오류가 발생했습니다.');
  }
  if (onProgress) onProgress(received, total);
  const actual = hash.digest('hex');
  const bad = (code, msg) => { rmQuiet(part); return new UpdateError(code, msg); };
  if (total && received !== total) throw bad('size', `다운로드 크기가 맞지 않습니다(${received}/${total}바이트).`);
  if (expectedSize && received !== expectedSize) throw bad('size', `파일 크기가 릴리스 정보와 다릅니다(${received}/${expectedSize}바이트).`);
  if (actual !== expectedSha) throw bad('hash-mismatch', '다운로드한 파일의 SHA-256 해시가 SHA256SUMS.txt 와 다릅니다.');
  return { sha256: actual, size: received };
}

// 새 exe 와 SHA256SUMS.txt 를 받아 해시를 검증한다. 검증 실패·취소·오류 시 .part/최종 파일을 모두 지운다.
async function downloadVerified(cfg, release, destDir, { signal, onProgress, userAgent = 'goodseedown' } = {}) {
  const name = exeAssetName(release.version);
  const exeAsset = release.assets.find(a => a.name === name);
  if (!exeAsset || !release.assets.some(a => a.name === SUMS_NAME)) throw new UpdateError('assets', `릴리스에 ${!exeAsset ? name : SUMS_NAME} 파일이 없습니다.`);
  fs.mkdirSync(destDir, { recursive: true });
  const expected = await fetchExpectedHash(cfg, release, name, { signal, userAgent });
  const finalPath = path.join(destDir, name), part = finalPath + '.part';
  rmQuiet(part, finalPath);
  const r = await downloadToFile(cfg, exeAsset, part, { signal, onProgress, userAgent, expectedSha: expected });
  if (!hasMzHeader(part)) { rmQuiet(part); throw new UpdateError('not-exe', '다운로드한 파일이 실행 파일 형식이 아닙니다.'); }
  fs.renameSync(part, finalPath);
  return { path: finalPath, sha256: r.sha256, size: r.size, mode: 'full', downloadedBytes: r.size };
}

// ---------- 차등 업데이트(패치) ----------
// PATCHES.json 형식: { schema: 1, version: "1.2.1", patches: [{ from: "1.2.0", fromSha256: "<64hex>", name: "<자산 이름>", size: <바이트>, sha256: "<64hex>" }] }
function parsePatchManifest(text, version) {
  let j; try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return null; }
  if (!j || j.schema !== 1 || j.version !== version || !Array.isArray(j.patches)) return null;
  const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
  return j.patches.filter(p => p && typeof p.name === 'string' && /^[A-Za-z0-9._-]+$/.test(p.name) && hex(p.fromSha256) && hex(p.sha256) && Number.isInteger(p.size) && p.size > 0)
    .map(p => ({ from: String(p.from || ''), fromSha256: p.fromSha256.toLowerCase(), name: p.name, size: p.size, sha256: p.sha256.toLowerCase() }));
}

// 지금 실행 중인 exe 에 적용할 수 있는 패치가 릴리스에 있는지 찾는다. 없거나 이득이 없으면 null(=전체 다운로드).
// 오류는 모두 삼켜서 null 로 돌려준다(차등은 최적화일 뿐이므로 확인창이 막히면 안 된다).
async function planPatch(cfg, release, { currentExe, hpatchz, signal, userAgent = 'goodseedown', log = () => { } } = {}) {
  try {
    const pa = release.assets.find(a => a.name === PATCHES_NAME);
    if (!pa || !hpatchz || !fs.existsSync(hpatchz) || !currentExe || !fs.existsSync(currentExe)) return null;
    const res = await openStream(pa.url, { headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' }, timeoutMs: API_TIMEOUT_MS, signal, policy: cfg.policy });
    const entries = parsePatchManifest(await readBody(res.res, MAX_PATCH_MANIFEST_BYTES), release.version);
    if (!entries || !entries.length) { log('patch manifest unusable'); return null; }
    const usable = entries.filter(e => release.assets.some(a => a.name === e.name));
    if (!usable.length) return null;
    const curSha = await sha256File(currentExe);
    const entry = usable.find(e => e.fromSha256 === curSha);
    if (!entry) { log(`no patch for current exe sha=${curSha.slice(0, 12)}`); return null; }
    const asset = release.assets.find(a => a.name === entry.name);
    const full = release.assets.find(a => a.name === exeAssetName(release.version))?.size || 0;
    if (full && entry.size >= full * PATCH_WORTH_RATIO) { log('patch not smaller enough; using full download'); return null; }
    return { asset, entry, patchBytes: entry.size, fullBytes: full, currentExe, hpatchz, baseSha256: curSha };
  } catch (e) { log(`plan patch failed: ${e.code || ''} ${e.message}`); return null; }
}

function runHpatchz(hpatchz, oldFile, patchFile, outFile, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(hpatchz, ['-f', oldFile, patchFile, outFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = c => { tail = (tail + c.toString('utf8')).slice(-1500); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const kill = () => { try { child.kill(); } catch { } };
    const timer = setTimeout(() => { kill(); reject(new UpdateError('patch-timeout', '패치 적용 시간이 초과되었습니다.')); }, PATCH_APPLY_TIMEOUT_MS);
    const onAbort = () => { kill(); clearTimeout(timer); reject(new UpdateError('aborted', '취소되었습니다.')); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    child.on('error', e => { clearTimeout(timer); reject(new UpdateError('patch-failed', `패치 프로그램을 실행하지 못했습니다: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve(); else reject(new UpdateError('patch-failed', `패치 적용에 실패했습니다(종료 코드 ${code}). ${tail.trim().split(/\r?\n/).slice(-2).join(' ')}`));
    });
  });
}

// 패치만 받아 새 exe 를 만든다. 패치 다운로드·적용·결과 검증 중 하나라도 실패하면(취소 제외) 전체 exe 를 받는 경로로 폴백한다.
async function downloadPatched(cfg, release, plan, destDir, { signal, onProgress, onStatus, userAgent = 'goodseedown' } = {}) {
  const name = exeAssetName(release.version);
  fs.mkdirSync(destDir, { recursive: true });
  const expected = await fetchExpectedHash(cfg, release, name, { signal, userAgent }); // 실패하면 전체 경로도 같은 이유로 실패하므로 폴백하지 않는다
  const finalPath = path.join(destDir, name), part = finalPath + '.part', patchPart = path.join(destDir, plan.entry.name + '.part');
  rmQuiet(part, finalPath, patchPart);
  try {
    await downloadToFile(cfg, plan.asset, patchPart, { signal, onProgress, userAgent, expectedSha: plan.entry.sha256, expectedSize: plan.entry.size });
    onStatus?.('변경된 부분을 적용해 새 버전을 만드는 중…');
    await runHpatchz(plan.hpatchz, plan.currentExe, patchPart, part, { signal });
    if (!fs.existsSync(part)) throw new UpdateError('patch-failed', '패치를 적용했지만 결과 파일이 없습니다.');
    const size = fs.statSync(part).size;
    const actual = await sha256File(part);
    if (actual !== expected) throw new UpdateError('patch-result-mismatch', '패치를 적용한 결과의 SHA-256 해시가 SHA256SUMS.txt 와 다릅니다.');
    if (!hasMzHeader(part)) throw new UpdateError('not-exe', '패치 결과가 실행 파일 형식이 아닙니다.');
    fs.renameSync(part, finalPath);
    return { path: finalPath, sha256: actual, size, mode: 'patch', downloadedBytes: plan.entry.size };
  } catch (e) {
    rmQuiet(part, finalPath);
    if (e?.code === 'aborted' || signal?.aborted) throw new UpdateError('aborted', '취소되었습니다.');
    onStatus?.('차등 업데이트를 적용하지 못해 전체 파일을 내려받습니다…');
    const full = await downloadVerified(cfg, release, destDir, { signal, onProgress, userAgent });
    return { ...full, mode: 'full-fallback', patchError: `${e.code || ''} ${e.message}`.trim(), downloadedBytes: full.size + plan.entry.size };
  } finally { rmQuiet(patchPart); }
}

// ---------- 교체 보조 스크립트 ----------
const HELPER_PS1 = `param([Parameter(Mandatory = $true)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
# 매개변수는 명령줄이 아니라 JSON 파일로 받는다(경로에 공백·특수문자가 있어도 안전).
$cfg = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
[int]$ParentPid = $cfg.ParentPid; [string]$Target = $cfg.Target; [string]$NewExe = $cfg.NewExe; [string]$Backup = $cfg.Backup
[string]$StateDir = $cfg.StateDir; [string]$ExpectedSha = $cfg.ExpectedSha; [string]$ToVersion = $cfg.ToVersion; [string]$FromVersion = $cfg.FromVersion
[int]$OkWaitSec = $cfg.OkWaitSec
$log = Join-Path $StateDir 'update-helper.log'
function Log([string]$m) { for ($i = 0; $i -lt 8; $i++) { try { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format 's'), $m) -Encoding UTF8 -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 150 } } }
function Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
function Fail([string]$msg) {
  Log ('FAILED: ' + $msg)
  try { (@{ message = $msg; from = $FromVersion; to = $ToVersion; at = (Get-Date -Format 'o') } | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $StateDir 'update-failed.json') -Encoding UTF8 } catch {}
}
function Relaunch() {
  try { Remove-Item -LiteralPath (Join-Path $StateDir 'pending-update.json') -Force -ErrorAction SilentlyContinue } catch {}
  try { Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target) } catch { Log ('relaunch error: ' + $_.Exception.Message) }
}
function Rollback() {
  # 기존 exe 복원: 백업이 있으면 현재 Target(새 파일/부분 파일)을 지우고 백업을 되돌린다.
  try {
    if (Test-Path -LiteralPath $Backup) {
      if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
      Move-Item -LiteralPath $Backup -Destination $Target -Force
      Log 'rollback: old exe restored'
    }
  } catch { Log ('rollback error: ' + $_.Exception.Message) }
}
Log ("start parent=$ParentPid target=$Target from=$FromVersion to=$ToVersion")
try {
  # 1) 앱 종료 대기
  # 종료된 프로세스도 핸들이 남아 있으면 Get-Process 에 보이므로 HasExited 로 판정한다.
  $alive = $false
  $pr = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if ($pr) { Log "waiting for parent pid $ParentPid"; [void]$pr.WaitForExit(60000); $alive = -not $pr.HasExited }
  Log "parent wait done alive=$alive"
  if ($alive) { Fail 'app did not exit in time; update not applied'; exit 1 }
  Start-Sleep -Milliseconds 1500
  # 2) 새 파일 재검증
  Log 'verifying downloaded file'
  if (-not (Test-Path -LiteralPath $NewExe)) { Fail 'downloaded file missing'; Relaunch; exit 1 }
  if ((Sha $NewExe) -ne $ExpectedSha.ToLower()) { Fail 'downloaded file hash changed before apply'; Relaunch; exit 1 }
  if (-not (Test-Path -LiteralPath $Target)) { Fail 'current exe path no longer exists'; Relaunch; exit 1 }
  # 3) 교체(재시도) — 기존 exe 는 Backup 으로 이동해 두고, 실패하면 되돌린다.
  $done = $false; $lastErr = ''
  for ($try = 1; $try -le 20 -and -not $done; $try++) {
    try {
      if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }
      Move-Item -LiteralPath $Target -Destination $Backup -Force
      Copy-Item -LiteralPath $NewExe -Destination $Target -Force
      if ((Sha $Target) -ne $ExpectedSha.ToLower()) { throw 'copied exe hash mismatch' }
      $done = $true
    } catch {
      $lastErr = $_.Exception.Message
      Log ("replace attempt $try failed: " + $lastErr)
      Rollback
      Start-Sleep -Seconds 1
    }
  }
  if (-not $done) { Rollback; Fail ('could not replace exe: ' + $lastErr); Relaunch; exit 1 }
  Log 'exe replaced'
  # 4) 재실행 + 새 버전의 시작 확인(update-ok.json) 대기
  Remove-Item -LiteralPath (Join-Path $StateDir 'update-ok.json') -Force -ErrorAction SilentlyContinue
  (@{ to = $ToVersion; from = $FromVersion } | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $StateDir 'pending-update.json') -Encoding UTF8
  Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target)
  $ok = $false
  for ($i = 0; $i -lt ($OkWaitSec * 2) -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 500
    $okFile = Join-Path $StateDir 'update-ok.json'
    if (Test-Path -LiteralPath $okFile) { try { $j = Get-Content -LiteralPath $okFile -Raw | ConvertFrom-Json; if ($j.to -eq $ToVersion) { $ok = $true } } catch {} }
  }
  if ($ok) {
    Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $NewExe -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $StateDir 'update-ok.json') -Force -ErrorAction SilentlyContinue
    Log 'update complete'
  } else {
    Remove-Item -LiteralPath (Join-Path $StateDir 'pending-update.json') -Force -ErrorAction SilentlyContinue
    Rollback; Fail 'new version did not report a successful start; old exe restored'; Relaunch
  }
} catch {
  Rollback; Fail ('unexpected error: ' + $_.Exception.Message); Relaunch
}
`;

function writeHelper(updatesDir) {
  fs.mkdirSync(updatesDir, { recursive: true });
  const p = path.join(updatesDir, 'apply-update.ps1');
  fs.writeFileSync(p, '﻿' + HELPER_PS1.replace(/\r?\n/g, '\r\n'), 'utf8');
  return p;
}

// 새 버전에 넘기지 않을 환경변수.
const STRIP_ENV = ['ELECTRON_RUN_AS_NODE'];
function spawnApplyHelper({ updatesDir, targetExe, newExe, expectedSha, toVersion, fromVersion, parentPid, env = process.env }) {
  const script = writeHelper(updatesDir);
  const childEnv = { ...env };
  for (const k of STRIP_ENV) delete childEnv[k];
  const cfgFile = path.join(updatesDir, 'apply-update.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    ParentPid: parentPid, Target: targetExe, NewExe: newExe, Backup: targetExe + '.old-' + fromVersion, StateDir: updatesDir,
    ExpectedSha: expectedSha, ToVersion: toVersion, FromVersion: fromVersion,
    OkWaitSec: Math.max(5, Math.min(1800, Number(env.GOODSEEDOWN_UPDATE_OKWAIT_SEC) || 300)),
  }), 'utf8');
  // 주의(실측): node/Electron 이 일반 자식 프로세스로 띄우면(libuv 작업 개체) 앱이 종료될 때 보조 프로세스도 함께 죽고,
  // detached:true 로 직접 띄우면 콘솔이 없어 PowerShell 이 시작되지 못한다. 그래서 cmd /c start 로 한 단계 거쳐 작업 개체 밖에서 띄운다.
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-ConfigFile', cfgFile];
  const child = spawn('cmd.exe', ['/c', 'start', '""', '/min', 'powershell.exe', ...psArgs], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv });
  child.on('error', e => { try { fs.appendFileSync(path.join(updatesDir, 'updater.log'), `${new Date().toISOString()} helper spawn error: ${e.message}
`); } catch { } });
  child.unref();
  return child.pid;
}

function canWriteDir(dir) {
  const probe = path.join(dir, '.goodseed-write-test-' + process.pid);
  try { fs.writeFileSync(probe, 'x'); fs.rmSync(probe, { force: true }); return true; } catch { return false; }
}

// PowerShell 이 쓴 JSON 은 BOM 이 붙을 수 있어 제거하고 읽는다.
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const writeJson = (p, o) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); } catch { } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForHelperStart(logFile, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (fs.readFileSync(logFile, 'utf8').includes('start parent=')) return true; } catch { }
    await sleep(200);
  }
  return false;
}

// ---------- Electron 연동 ----------
// deps: {app, dialog, BrowserWindow, ipcMain, shell, getMainWindow, base, isBusy, env}
function createUpdater(deps) {
  const { app, dialog, BrowserWindow, ipcMain, shell, getMainWindow, base, isBusy = () => false } = deps;
  const env = deps.env || process.env;
  // 번들된 패치 적용 프로그램(HDiffPatch hpatchz). 없으면 차등 업데이트 없이 전체를 받는다.
  const hpatchz = deps.hpatchz !== undefined ? deps.hpatchz : (process.resourcesPath ? path.join(process.resourcesPath, 'tools', 'hpatchz.exe') : null);
  const current = app.getVersion();
  const updatesDir = path.join(base, 'updates');
  const statePath = path.join(base, 'update-state.json');
  const logPath = path.join(updatesDir, 'updater.log');
  const noticePath = path.join(updatesDir, 'updated-notice.json'); // 업데이트 직후 첫 실행에 한 번 보여 줄 '업데이트되었습니다' 안내용
  let running = false, timer = null;
  const log = m => { try { fs.mkdirSync(updatesDir, { recursive: true }); fs.appendFileSync(logPath, `${new Date().toISOString()} ${m}\n`); } catch { } };
  const win = () => { const w = getMainWindow?.(); return w && !w.isDestroyed() ? w : undefined; };
  const box = opts => dialog.showMessageBox(win() || undefined, { title: 'goodseedown 업데이트', noLink: true, ...opts });
  const userAgent = `goodseedown/${current}`;

  // 진행 중인 다운로드가 있으면 알리고, 일시 정지한 뒤 업데이트할지 묻는다(일시 정지한 작업은 새 버전에서 [이어받기]로 계속된다).
  async function confirmSavedAndIdle() {
    if (!isBusy()) return true;
    const r = await box({ type: 'warning', message: '진행 중인 다운로드가 있습니다.', detail: '업데이트하려면 앱을 다시 시작해야 합니다. 진행 중인 다운로드는 일시 정지로 저장되며, 새 버전을 열고 [이어받기]를 누르면 이어서 받습니다.', buttons: ['일시 정지하고 업데이트', '취소'], defaultId: 1, cancelId: 1 });
    if (r.response !== 0) return false;
    try { await deps.pauseAll?.(); } catch { }
    return true;
  }

  function openProgressWindow(parent, version, onCancel) {
    const w = new BrowserWindow({
      width: 460, height: 190, parent, modal: !!parent, show: false, resizable: false, minimizable: false, maximizable: false, closable: true,
      title: 'goodseedown 업데이트 다운로드', autoHideMenuBar: true, backgroundColor: '#1b1d20',
      webPreferences: { preload: path.join(__dirname, 'update-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    w.removeMenu?.();
    const html = `<!doctype html><meta charset="utf-8"><title>업데이트 다운로드</title><body style="margin:0;font:13px 'Malgun Gothic',sans-serif;background:#1b1d20;color:#eff1f2;padding:22px">
<div id="t" style="font-size:15px;margin-bottom:14px">새 버전 ${version} 을(를) 내려받는 중…</div>
<div style="background:#2b2c2f;border-radius:6px;height:14px;overflow:hidden"><div id="b" style="height:14px;width:0;background:#40e0ce"></div></div>
<div id="s" style="margin:10px 0 18px;color:#a9afb5">준비 중…</div>
<button id="c" style="padding:8px 22px;background:#34383a;color:#eff1f2;border:1px solid #5a5f63;border-radius:6px;cursor:pointer">취소</button>
<script>document.getElementById('c').onclick=()=>window.gsUpdate&&window.gsUpdate.cancel();
window.setProgress=(txt,pct)=>{document.getElementById('s').textContent=txt;document.getElementById('b').style.width=pct+'%';};
window.setStatus=t=>{document.getElementById('t').textContent=t;};</script>`;
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    w.once('ready-to-show', () => w.show());
    const handler = e => { if (e.sender === w.webContents) onCancel(); };
    ipcMain.on('gs-update-cancel', handler);
    let programmatic = false;
    w.on('close', () => { if (!programmatic) onCancel(); });
    return {
      setProgress(rec, tot) {
        if (w.isDestroyed()) return;
        const mb = n => (n / 1048576).toFixed(1);
        const pct = tot ? Math.min(100, Math.floor(rec * 100 / tot)) : 0;
        w.webContents.executeJavaScript(`window.setProgress(${JSON.stringify(tot ? `${mb(rec)} MB / ${mb(tot)} MB (${pct}%)` : `${mb(rec)} MB`)},${pct})`).catch(() => { });
        parent?.setProgressBar?.(tot ? rec / tot : 2);
      },
      status(text) { if (!w.isDestroyed()) w.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => { }); },
      close() { ipcMain.removeListener('gs-update-cancel', handler); parent?.setProgressBar?.(-1); programmatic = true; if (!w.isDestroyed()) w.close(); },
    };
  }

  const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  async function startUpdate(cfg, rel, plan) {
    const launcherExe = String(env.GOODSEEDOWN_LAUNCHER_EXE || '').trim();
    if (!launcherExe || !fs.existsSync(launcherExe)) {
      let canOpen = false;
      try { canOpen = !!rel.htmlUrl && cfg.policy.check(new URL(rel.htmlUrl)) === null; } catch { }
      const r = await box({ type: 'info', message: '이 실행 방식에서는 자동 교체를 할 수 없습니다.', detail: `포터블 실행 파일(goodseedown-*.exe)로 실행했을 때만 자동 교체가 가능합니다.
새 버전 ${rel.version} 은 릴리스 페이지에서 직접 받아주세요.`, buttons: canOpen ? ['릴리스 페이지 열기', '닫기'] : ['닫기'] });
      if (r.response === 0 && canOpen) shell?.openExternal(rel.htmlUrl);
      return;
    }
    if (!canWriteDir(path.dirname(launcherExe))) {
      await box({ type: 'error', message: '실행 파일이 있는 폴더에 쓸 수 없어 자동 업데이트를 할 수 없습니다.', detail: `${path.dirname(launcherExe)}\n폴더 쓰기 권한을 확인하거나 실행 파일을 다른 폴더로 옮겨 주세요.`, buttons: ['확인'] });
      return;
    }
    if (!(await confirmSavedAndIdle())) return;

    const ac = new AbortController();
    const parent = win();
    const pw = openProgressWindow(parent, rel.version, () => ac.abort());
    let result;
    try {
      const opts = { signal: ac.signal, onProgress: (r, t) => pw.setProgress(r, t), onStatus: t => pw.status(t), userAgent };
      if (plan) { pw.status(`새 버전 ${rel.version} 의 변경된 부분(${fmtSize(plan.patchBytes)})을 내려받는 중…`); result = await downloadPatched(cfg, rel, plan, updatesDir, opts); }
      else result = await downloadVerified(cfg, rel, updatesDir, opts);
    } catch (e) {
      pw.close();
      log(`download failed: ${e.code || ''} ${e.message}`);
      if (e.code === 'aborted') return;
      const hash = e.code === 'hash-mismatch' || e.code === 'size' || e.code === 'not-exe' || e.code === 'no-hash';
      await box({ type: 'error', message: hash ? '다운로드한 파일을 검증하지 못해 업데이트를 중단했습니다.' : '업데이트를 내려받지 못했습니다.', detail: `${e.message}\n\n${hash ? '내려받은 파일은 삭제했고 ' : ''}현재 버전(${current})을 그대로 사용합니다.`, buttons: ['확인'] });
      return;
    }
    pw.close();
    log(`downloaded+verified ${result.path} sha256=${result.sha256} mode=${result.mode} downloadedBytes=${result.downloadedBytes}${result.patchError ? ' patchError=' + result.patchError : ''}`);
    if (!(await confirmSavedAndIdle())) { try { fs.rmSync(result.path, { force: true }); } catch { } return; }
    try {
      try { fs.rmSync(path.join(updatesDir, 'update-helper.log'), { force: true }); } catch { }
      const pid = spawnApplyHelper({ updatesDir, targetExe: launcherExe, newExe: result.path, expectedSha: result.sha256, toVersion: rel.version, fromVersion: current, parentPid: process.pid, env });
      log(`helper spawned pid=${pid} target=${launcherExe}`);
      // 보조 스크립트가 실제로 시작(로그 첫 줄 기록)한 것을 확인한 뒤에만 앱을 종료한다 — 시작 전에 앱이 먼저 죽는 경쟁을 막는다.
      const started = await waitForHelperStart(path.join(updatesDir, 'update-helper.log'), 15000);
      if (!started) throw new Error('보조 프로그램이 15초 안에 시작되지 않았습니다.');
    } catch (e) {
      log(`helper spawn failed: ${e.message}`);
      await box({ type: 'error', message: '업데이트 적용 프로그램을 시작하지 못했습니다.', detail: `${e.message}\n현재 버전(${current})을 그대로 사용합니다.`, buttons: ['확인'] });
      return;
    }
    app.quit();
  }

  // 새 버전이 있는지 조회한다. 있으면 {cfg, rel, plan, sizeLine, fullBytes}, 없거나 확인에 실패하면 null.
  // manual 일 때만(사용자가 메뉴·설정에서 직접 확인) 결과를 대화상자로 알린다. 자동 확인은 조용히 null 을 돌려준다.
  async function lookup({ manual }) {
    const cfg = getConfig(env);
    if (!cfg.configured) {
      log('update repo not configured; skipped');
      if (manual) await box({ type: 'info', message: '업데이트 저장소가 아직 설정되지 않았습니다.', detail: '이 버전에는 업데이트 배포처가 지정되어 있지 않아 업데이트를 확인할 수 없습니다.', buttons: ['확인'] });
      return null;
    }
    const ac = new AbortController(); const guard = setTimeout(() => ac.abort(), API_TIMEOUT_MS + 2000);
    let rel;
    try { rel = await fetchLatestRelease(cfg, { signal: ac.signal, userAgent }); }
    catch (e) {
      log(`check failed: ${e.code || ''} ${e.message}`);
      if (manual) await box({ type: 'warning', message: '업데이트 정보를 가져오지 못했습니다.', detail: `인터넷 연결을 확인한 뒤 다시 시도해주세요.
(${e.message})`, buttons: ['확인'] });
      return null;
    } finally { clearTimeout(guard); }
    if (!rel) { log('no usable release'); if (manual) await box({ type: 'info', message: '확인할 수 있는 릴리스가 없습니다.', buttons: ['확인'] }); return null; }
    const cmp = compareSemver(rel.version, current);
    if (!(cmp > 0)) {
      log(`no update: latest=${rel.version} current=${current}`);
      if (manual) await box({ type: 'info', message: '현재 최신 버전을 사용하고 있습니다.', detail: `현재 버전: ${current}
최신 릴리스: ${rel.version}`, buttons: ['확인'] });
      return null;
    }
    const hasAssets = rel.assets.some(a => a.name === exeAssetName(rel.version)) && rel.assets.some(a => a.name === SUMS_NAME);
    if (!hasAssets) {
      log(`release ${rel.version} lacks assets`);
      if (manual) await box({ type: 'warning', message: `새 버전 ${rel.version} 의 배포 파일이 아직 준비되지 않았습니다.`, detail: `${exeAssetName(rel.version)} 와 ${SUMS_NAME} 이 모두 올라온 뒤 다시 확인해주세요.`, buttons: ['확인'] });
      return null;
    }
    const launcherForPlan = String(env.GOODSEEDOWN_LAUNCHER_EXE || '').trim();
    const plan = launcherForPlan ? await planPatch(cfg, rel, { currentExe: launcherForPlan, hpatchz, userAgent, log }) : null;
    const fullBytes = rel.assets.find(a => a.name === exeAssetName(rel.version))?.size || 0;
    const sizeLine = plan ? `받을 용량: 약 ${fmtSize(plan.patchBytes)} (변경된 부분만 · 전체 ${fmtSize(plan.fullBytes || fullBytes)})` : (fullBytes ? `받을 용량: 약 ${fmtSize(fullBytes)} (전체 파일)` : '');
    log(`update available ${rel.version}; ${plan ? `patch ${plan.entry.name} ${plan.patchBytes}B` : `full ${fullBytes}B`}`);
    return { cfg, rel, plan, sizeLine, fullBytes };
  }

  // 수동 확인(메뉴 [도움말 > 업데이트 확인]·설정의 [앱 업데이트 확인]): 결과를 대화상자로 알리고, 있으면 릴리스 노트와 함께 묻는다.
  async function check({ manual = true } = {}) {
    if (running) { if (manual) await box({ type: 'info', message: '이미 업데이트를 확인하거나 진행하는 중입니다.', buttons: ['확인'] }); return; }
    running = true;
    try {
      const f = await lookup({ manual });
      if (!f) return;
      const { cfg, rel, plan, sizeLine } = f;
      const notes = rel.notes.trim() ? (rel.notes.length > 1500 ? rel.notes.slice(0, 1500) + `
…(이하 생략)` : rel.notes) : '(릴리스 노트가 없습니다)';
      const r = await box({ type: 'question', message: `새 버전 ${rel.version} 이(가) 있습니다.`, detail: `현재 버전: ${current}
새 버전: ${rel.version}${sizeLine ? `
${sizeLine}` : ''}

릴리스 노트:
${notes}`, buttons: ['지금 업데이트', '나중에'], defaultId: 0, cancelId: 1 });
      if (r.response !== 0) { log('user chose later'); return; }
      await startUpdate(cfg, rel, plan);
    } catch (e) {
      log(`unexpected: ${e.stack || e}`);
      if (manual) { try { await box({ type: 'error', message: '업데이트 확인 중 오류가 발생했습니다.', detail: String(e.message || e), buttons: ['확인'] }); } catch { } }
    } finally { running = false; }
  }

  // ---------- 새 버전 배너(시작 시 자동 확인) ----------
  // 시작 후 자동 확인은 대화상자를 띄우지 않는다. 새 버전이 있으면 정보만 보관하고 화면 맨 위 배너로 알린다.
  // 설치는 사용자가 배너의 [업그레이드]를 눌렀을 때만 시작한다(자동 설치 없음). 최신이거나 확인 실패·오프라인이면 아무 일도 없다.
  let found = null; // lookup() 결과 + 배너에 보낼 info
  const bannerInfo = () => found && { version: found.rel.version, current, sizeLine: found.sizeLine, patch: !!found.plan, notes: found.rel.notes.length > 1200 ? found.rel.notes.slice(0, 1200) : found.rel.notes };
  async function checkForBanner() {
    if (running) return null;
    running = true;
    try {
      const f = await lookup({ manual: false });
      found = f;
      const info = bannerInfo();
      if (info) { const w = win(); try { w && w.webContents.send('gsd:app-update-available', info); } catch { } }
      return info;
    } catch (e) { log(`banner check failed: ${e.stack || e}`); return null; } finally { running = false; }
  }
  // 배너의 [업그레이드]: 확인창 없이(버튼 클릭이 확인) 바로 다운로드·검증·교체 흐름으로 들어간다. 진행 중 다운로드 경고·진행창·취소·해시 검증·전체 폴백은 그대로.
  async function upgrade() {
    if (running) return { busy: true };
    if (!found) return { none: true };
    running = true;
    try { await startUpdate(found.cfg, found.rel, found.plan); return { started: true }; }
    catch (e) { log(`upgrade failed: ${e.stack || e}`); try { await box({ type: 'error', message: '업데이트를 시작하지 못했습니다.', detail: String(e.message || e), buttons: ['확인'] }); } catch { } return { error: String(e.message || e) }; }
    finally { running = false; }
  }

  // 새 버전이 처음 뜬 직후(창 표시 뒤) 호출: 교체 결과 표시·마커 기록·자동 확인 예약.
  function onAppReady({ autoCheck = true } = {}) {
    try { for (const f of fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : []) if (f.endsWith('.part')) fs.rmSync(path.join(updatesDir, f), { force: true }); } catch { }
    const pendingPath = path.join(updatesDir, 'pending-update.json');
    const pend = readJson(pendingPath);
    if (pend) {
      if (pend.to === current) { writeJson(path.join(updatesDir, 'update-ok.json'), { to: current, at: new Date().toISOString() }); writeJson(noticePath, { from: String(pend.from || ''), to: current }); log(`update to ${current} confirmed`); }
      try { fs.rmSync(pendingPath, { force: true }); } catch { }
    }
    const failedPath = path.join(updatesDir, 'update-failed.json');
    const failed = readJson(failedPath);
    if (failed) {
      try { fs.rmSync(failedPath, { force: true }); } catch { }
      box({ type: 'warning', message: `직전 업데이트(${failed.to || '?'})를 적용하지 못해 기존 버전으로 복원했습니다.`, detail: `사유: ${failed.message || '알 수 없음'}\n현재 버전: ${current}`, buttons: ['확인'] }).catch(() => { });
    }
    if (autoCheck) { clearTimeout(timer); timer = setTimeout(() => { checkForBanner(); }, deps.autoDelayMs ?? AUTO_CHECK_DELAY_MS); timer.unref?.(); }
  }

  // 업데이트 직후 첫 실행 안내: 한 번 돌려주고 파일을 지운다(현재 버전과 맞을 때만).
  function takeUpdatedNotice() {
    const n = readJson(noticePath);
    try { fs.rmSync(noticePath, { force: true }); } catch { }
    return n && n.to === current ? { from: n.from, to: n.to } : null;
  }

  return { check, onAppReady, checkForBanner, upgrade, getAvailable: bannerInfo, takeUpdatedNotice, currentVersion: current };
}

module.exports = { createUpdater, UPDATE_REPO, PATCHES_NAME, UpdateError, sha256File, parsePatchManifest, planPatch, downloadPatched, runHpatchz, parseSemver, compareSemver, getConfig, parseSums, fetchLatestRelease, downloadVerified, openStream, exeAssetName, SUMS_NAME, isRepoValid, spawnApplyHelper, writeHelper, HELPER_PS1, canWriteDir };
