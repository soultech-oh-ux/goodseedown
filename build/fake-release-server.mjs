// 시험용 가짜 GitHub 릴리스 서버 (127.0.0.1 전용). GitHub API releases/latest 응답과 자산 다운로드를 흉내 낸다.
import http from 'node:http';
import crypto from 'node:crypto';

export async function createFakeServer(initial = {}) {
  const cfg = {
    tag: 'v1.0.1', notes: '시험용 릴리스 노트\n- 항목 1\n- 항목 2', exe: Buffer.from('MZ' + 'x'.repeat(4096)),
    sums: 'ok',            // ok | bad(해시 틀림) | missing(SHA256SUMS 자산 없음) | noentry(파일 항목 없음) | crlf(윈도 줄바꿈)
    redirect: 'none',      // none | evil(허용 안 되는 호스트) | otherport(같은 IP 다른 포트) | self(자기 서버 안에서 정상 리다이렉트)
    bytesPerSec: 0,        // 0 = 무제한
    assets: 'both',        // both | noexe | nosums
    patches: [],           // 차등 업데이트: [{ name, buf, fromSha256, manifestSha(선택: 매니페스트에 적을 해시 덮어쓰기), manifestSize(선택) }]
    manifest: 'ok',        // ok | missing(PATCHES.json 자산 없음) | badjson | wrongversion
    patchBytesPerSec: 0,
    apiStatus: 200, apiHang: false, prerelease: false, draft: false, nameOverride: '',
    ...initial,
  };
  const hits = [];
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const base = `http://127.0.0.1:${server.address().port}`;
    const ver = cfg.tag.replace(/^v/, '');
    const exeName = cfg.nameOverride || `goodseedown-${ver}-Windows-x64.exe`;
    if (req.url === '/repos/x/releases/latest') {
      if (cfg.apiHang) return; // 응답하지 않음(타임아웃 시험)
      if (cfg.apiStatus !== 200) { res.writeHead(cfg.apiStatus, { 'content-type': 'application/json' }); return res.end('{"message":"err"}'); }
      const assets = [];
      if (cfg.assets !== 'noexe') assets.push({ name: exeName, browser_download_url: `${base}/dl/${exeName}`, size: cfg.exe.length });
      if (cfg.assets !== 'nosums' && cfg.sums !== 'missing') assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}/dl/SHA256SUMS.txt`, size: 100 });
      if (cfg.patches.length && cfg.manifest !== 'missing') assets.push({ name: 'PATCHES.json', browser_download_url: `${base}/dl/PATCHES.json`, size: 300 });
      for (const pt of cfg.patches) assets.push({ name: pt.name, browser_download_url: `${base}/dl/${pt.name}`, size: pt.manifestSize ?? pt.buf.length });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tag_name: cfg.tag, name: cfg.tag, body: cfg.notes, draft: cfg.draft, prerelease: cfg.prerelease, html_url: `${base}/release`, assets }));
    }
    if (req.url === '/dl/PATCHES.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (cfg.manifest === 'badjson') return res.end('{ not json');
      return res.end(JSON.stringify({ schema: 1, version: cfg.manifest === 'wrongversion' ? '9.9.9' : ver, patches: cfg.patches.map(pt => ({ from: pt.from || '1.0.0', fromSha256: pt.fromSha256, name: pt.name, size: pt.manifestSize ?? pt.buf.length, sha256: pt.manifestSha || sha(pt.buf) })) }));
    }
    const pHit = cfg.patches.find(pt => req.url === `/dl/${pt.name}`);
    if (pHit) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': pHit.buf.length });
      if (!cfg.patchBytesPerSec) return res.end(pHit.buf);
      let off = 0; const step = Math.max(1, Math.floor(cfg.patchBytesPerSec / 10));
      const t = setInterval(() => { if (res.destroyed) return clearInterval(t); const end = Math.min(pHit.buf.length, off + step); res.write(pHit.buf.subarray(off, end)); off = end; if (off >= pHit.buf.length) { clearInterval(t); res.end(); } }, 100);
      return res.on('close', () => clearInterval(t));
    }
    if (req.url === '/dl/SHA256SUMS.txt') {
      const eol = cfg.sums === 'crlf' ? '\r\n' : '\n';
      let h = sha(cfg.exe);
      if (cfg.sums === 'bad') h = sha(Buffer.from('다른 파일'));
      const lines = [`${sha(Buffer.from('other'))}  other-file.zip`];
      if (cfg.sums !== 'noentry') lines.push(`${h}  ${exeName}`);
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(lines.join(eol) + eol);
    }
    if (req.url === `/dl/${exeName}`) {
      if (cfg.redirect === 'evil') { res.writeHead(302, { location: 'https://evil.example.com/steal.exe' }); return res.end(); }
      if (cfg.redirect === 'otherport') { res.writeHead(302, { location: `http://127.0.0.1:${server.address().port + 1}/x.exe` }); return res.end(); }
      if (cfg.redirect === 'self') { res.writeHead(302, { location: `${base}/blob/${exeName}` }); return res.end(); }
      return sendBlob(res);
    }
    if (req.url === `/blob/${exeName}`) return sendBlob(res);
    res.writeHead(404); res.end();
  });
  function sendBlob(res) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': cfg.exe.length });
    if (!cfg.bytesPerSec) return res.end(cfg.exe);
    let off = 0; const step = Math.max(1, Math.floor(cfg.bytesPerSec / 10));
    const t = setInterval(() => { if (res.destroyed) return clearInterval(t); const end = Math.min(cfg.exe.length, off + step); res.write(cfg.exe.subarray(off, end)); off = end; if (off >= cfg.exe.length) { clearInterval(t); res.end(); } }, 100);
    res.on('close', () => clearInterval(t));
  }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { cfg, hits, port, apiUrl: `http://127.0.0.1:${port}/repos/x/releases/latest`, sha, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
