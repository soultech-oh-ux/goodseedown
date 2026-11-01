'use strict';
// yt-dlp 엔진 자체 업데이트 — 사용자가 확인한 뒤에만 새 엔진을 받는다.
// 흐름: GitHub 최신 릴리스 조회 → 날짜 버전 비교 → (호출한 쪽이 사용자에게 확인) → yt-dlp.exe 와 SHA2-256SUMS 다운로드 → 해시 검증
//       → 실행 시험(--version) → 사용자 폴더(engine\yt-dlp-<버전>.exe)에 저장하고 engine.json 에 기록.
// 설치된 번들 엔진은 건드리지 않는다(앱 업데이트로 번들이 바뀌어도 더 새로운 쪽을 쓴다). 실행 중인 작업은 옛 파일을 계속 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { readJson, writeJsonAtomic, rmQuiet } = require('./util.cjs');
const { openStream, getConfig, parseSums } = require('../desktop/updater.cjs');

const ENGINE_REPO = 'yt-dlp/yt-dlp';
const EXE_NAME = 'yt-dlp.exe';
const SUMS_NAME = 'SHA2-256SUMS';
const MAX_JSON = 2 * 1024 * 1024;
const VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

const parseVer = v => { const m = VERSION_RE.exec(String(v || '').trim()); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0)] : null; };
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b); if (!x || !y) return NaN;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

async function readBody(res, limit) {
  const chunks = []; let n = 0;
  for await (const c of res) { n += c.length; if (n > limit) { res.destroy(); throw new Error('응답이 너무 큽니다.'); } chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

function runVersion(exe, timeoutMs = 30000) {
  return new Promise(resolve => {
    let out = '', done = false;
    const fin = v => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    let child;
    try { child = spawn(exe, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); } catch { return resolve(null); }
    const t = setTimeout(() => { try { child.kill(); } catch { } fin(null); }, timeoutMs);
    child.stdout.on('data', c => { out += c.toString('utf8'); });
    child.on('error', () => fin(null));
    child.on('close', code => fin(code === 0 && VERSION_RE.test(out.trim()) ? out.trim() : null));
  });
}

const sha256File = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', c => h.update(c)).on('error', rej).on('end', () => res(h.digest('hex'))); });

class EngineManager {
  // opts: { dataDir, bundledPath, env? }
  constructor(opts) {
    this.dir = path.join(opts.dataDir, 'engine');
    this.stateFile = path.join(this.dir, 'engine.json');
    this.bundled = opts.bundledPath;
    this.env = opts.env || process.env;
    this._bundledVersion = null;
    this._activeCache = null;
  }
  _state() { return readJson(this.stateFile, null); }

  // 지금 쓸 yt-dlp 경로(동기). engine.json 이 가리키는 파일이 있고 크기가 기록과 같으면 그것, 아니면 번들.
  activePath() {
    const st = this._state();
    if (st && typeof st.file === 'string' && /^yt-dlp-[0-9.]+\.exe$/.test(st.file)) {
      const p = path.join(this.dir, st.file);
      try { if (fs.statSync(p).size === st.size) return p; } catch { }
    }
    return this.bundled;
  }
  async bundledVersion() { if (!this._bundledVersion) this._bundledVersion = await runVersion(this.bundled); return this._bundledVersion; }
  async currentVersion() {
    const p = this.activePath();
    if (p === this.bundled) return this.bundledVersion();
    const st = this._state(); return st && st.version || null;
  }
  info() { const st = this._state(); return { active: this.activePath(), usingBundled: this.activePath() === this.bundled, state: st }; }

  async check({ signal } = {}) {
    const override = String(this.env.GOODSEEDOWN_ENGINE_API || '').trim();
    const cfg = getConfig({ GOODSEEDOWN_UPDATE_API: override }, ENGINE_REPO);
    if (!cfg.configured) throw Object.assign(new Error('엔진 업데이트 주소를 만들 수 없습니다.'), { code: 'config' });
    const { res } = await openStream(cfg.apiUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'goodseedown-engine' }, timeoutMs: 10000, signal, policy: cfg.policy });
    let j; try { j = JSON.parse(await readBody(res, MAX_JSON)); } catch (e) { throw Object.assign(new Error('엔진 릴리스 정보를 해석하지 못했습니다.'), { code: 'bad-json' }); }
    const tag = String(j && j.tag_name || '');
    if (!parseVer(tag) || j.draft || j.prerelease) throw Object.assign(new Error('사용할 수 있는 엔진 릴리스를 찾지 못했습니다.'), { code: 'no-release' });
    const assets = Array.isArray(j.assets) ? j.assets.map(a => ({ name: String(a && a.name || ''), url: String(a && a.browser_download_url || ''), size: Number.isFinite(a && a.size) ? a.size : null })) : [];
    const exe = assets.find(a => a.name === EXE_NAME), sums = assets.find(a => a.name === SUMS_NAME);
    const current = await this.currentVersion();
    const cmp = current ? cmpVer(tag, current) : 1;
    return { current, latest: tag, updateAvailable: cmp > 0, hasAssets: !!(exe && sums), exe, sums, policy: cfg.policy, size: exe ? exe.size : null };
  }

  // 새 엔진을 받아 검증·설치한다. 실패하면 아무것도 바꾸지 않는다.
  async update({ signal, onProgress, checked } = {}) {
    const c = checked || await this.check({ signal });
    if (!c.updateAvailable) return { updated: false, version: c.current, reason: 'up-to-date' };
    if (!c.hasAssets) throw Object.assign(new Error('릴리스에 엔진 파일 또는 해시 목록이 없습니다.'), { code: 'assets' });
    fs.mkdirSync(this.dir, { recursive: true });
    const sumsRes = await openStream(c.sums.url, { headers: { 'User-Agent': 'goodseedown-engine' }, signal, policy: c.policy });
    const expected = parseSums(await readBody(sumsRes.res, 256 * 1024), EXE_NAME);
    if (!expected) throw Object.assign(new Error('해시 목록에 yt-dlp.exe 가 없어 검증할 수 없습니다.'), { code: 'no-hash' });
    const part = path.join(this.dir, `download-${process.pid}.part`);
    rmQuiet(part);
    try {
      const dl = await openStream(c.exe.url, { headers: { 'User-Agent': 'goodseedown-engine', Accept: 'application/octet-stream' }, signal, policy: c.policy });
      const total = Number(dl.res.headers['content-length']) || c.exe.size || 0;
      const hash = crypto.createHash('sha256'); let got = 0, last = 0;
      const meter = new Transform({ transform(chunk, _e, cb) { hash.update(chunk); got += chunk.length; const t = Date.now(); if (onProgress && t - last > 150) { last = t; onProgress(got, total); } cb(null, chunk); } });
      await pipeline(dl.res, meter, fs.createWriteStream(part));
      onProgress?.(got, total);
      if (total && got !== total) throw Object.assign(new Error(`다운로드 크기가 맞지 않습니다(${got}/${total}).`), { code: 'size' });
      if (hash.digest('hex') !== expected) throw Object.assign(new Error('내려받은 엔진의 SHA-256 해시가 해시 목록과 다릅니다.'), { code: 'hash-mismatch' });
      const mz = Buffer.alloc(2); const fd = fs.openSync(part, 'r'); try { fs.readSync(fd, mz, 0, 2, 0); } finally { fs.closeSync(fd); }
      if (mz.toString('latin1') !== 'MZ') throw Object.assign(new Error('내려받은 파일이 실행 파일 형식이 아닙니다.'), { code: 'not-exe' });
      // 실행 시험: 엔진이 스스로 버전을 말해야 설치한다.
      const testExe = part + '.exe'; fs.renameSync(part, testExe);
      const ver = await runVersion(testExe);
      if (!ver) { rmQuiet(testExe); throw Object.assign(new Error('새 엔진이 실행되지 않아 설치하지 않았습니다.'), { code: 'not-runnable' }); }
      const finalName = `yt-dlp-${ver}.exe`; const finalPath = path.join(this.dir, finalName);
      rmQuiet(finalPath);
      fs.renameSync(testExe, finalPath);
      const prev = this._state();
      writeJsonAtomic(this.stateFile, { version: ver, tag: c.latest, file: finalName, size: fs.statSync(finalPath).size, sha256: expected, installedAt: new Date().toISOString(), previous: prev && prev.file || null });
      // 이전 엔진 파일 정리(실행 중이면 지워지지 않으므로 무시)
      for (const f of fs.readdirSync(this.dir)) if (/^yt-dlp-[0-9.]+\.exe$/.test(f) && f !== finalName && f !== (prev && prev.file)) rmQuiet(path.join(this.dir, f));
      if (prev && prev.file && prev.file !== finalName) rmQuiet(path.join(this.dir, prev.file));
      return { updated: true, version: ver, from: c.current };
    } catch (e) {
      rmQuiet(part, part + '.exe');
      if (signal && signal.aborted) throw Object.assign(new Error('취소되었습니다.'), { code: 'aborted' });
      throw e;
    }
  }

  // 번들 엔진으로 되돌린다(업데이트한 엔진에 문제가 있을 때).
  reset() { try { fs.rmSync(this.stateFile, { force: true }); } catch { } for (const f of fs.existsSync(this.dir) ? fs.readdirSync(this.dir) : []) if (/^yt-dlp-[0-9.]+\.exe$/.test(f)) rmQuiet(path.join(this.dir, f)); }
}

module.exports = { EngineManager, cmpVer, parseVer, runVersion };
