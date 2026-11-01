// 시험용 가짜 yt-dlp 릴리스 서버 (127.0.0.1 전용) — GitHub API releases/latest 와 yt-dlp.exe·SHA2-256SUMS 다운로드를 흉내 낸다.
import http from 'node:http';
import crypto from 'node:crypto';

export async function createFakeEngineServer(initial = {}) {
  const cfg = {
    tag: '2026.10.26', exe: Buffer.from('MZ' + 'x'.repeat(2048)),
    sums: 'ok',        // ok | bad(해시 틀림) | missing(SHA2-256SUMS 자산 없음) | noentry(yt-dlp.exe 항목 없음)
    tamper: false,     // true: 해시 목록은 원본 기준, 실제로 내려주는 파일은 한 바이트 바꾼 것
    redirect: 'none',  // none | evil(허용 안 되는 호스트)
    assets: 'both',    // both | noexe
    apiStatus: 200, prerelease: false, bytesPerSec: 0,
    ...initial,
  };
  const hits = [];
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/repos/x/releases/latest') {
      if (cfg.apiStatus !== 200) { res.writeHead(cfg.apiStatus, { 'content-type': 'application/json' }); return res.end('{"message":"err"}'); }
      const assets = [];
      if (cfg.assets !== 'noexe') assets.push({ name: 'yt-dlp.exe', browser_download_url: `${base}/dl/yt-dlp.exe`, size: cfg.exe.length });
      if (cfg.sums !== 'missing') assets.push({ name: 'SHA2-256SUMS', browser_download_url: `${base}/dl/SHA2-256SUMS`, size: 200 });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ tag_name: cfg.tag, draft: false, prerelease: cfg.prerelease, assets }));
    }
    if (req.url === '/dl/SHA2-256SUMS') {
      let h = sha(cfg.exe); if (cfg.sums === 'bad') h = sha(Buffer.from('다른 파일'));
      const lines = [`${sha(Buffer.from('other'))} *yt-dlp_linux`]; if (cfg.sums !== 'noentry') lines.push(`${h} *yt-dlp.exe`);
      res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(lines.join('\n') + '\n');
    }
    if (req.url === '/dl/yt-dlp.exe') {
      if (cfg.redirect === 'evil') { res.writeHead(302, { location: 'https://evil.example.com/yt-dlp.exe' }); return res.end(); }
      let body = cfg.exe; if (cfg.tamper) { body = Buffer.from(cfg.exe); body[body.length - 5] ^= 0xff; }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
      if (!cfg.bytesPerSec) return res.end(body);
      let off = 0; const step = Math.max(1, Math.floor(cfg.bytesPerSec / 10));
      const t = setInterval(() => { if (res.destroyed) return clearInterval(t); const end = Math.min(body.length, off + step); res.write(body.subarray(off, end)); off = end; if (off >= body.length) { clearInterval(t); res.end(); } }, 100);
      return res.on('close', () => clearInterval(t));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { cfg, hits, port, apiUrl: `http://127.0.0.1:${port}/repos/x/releases/latest`, sha, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
