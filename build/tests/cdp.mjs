// CDP(원격 디버깅) 도우미 — 시험용. 페이지 대상 하나에 접속해 식을 평가한다.
export async function targets(port) { return (await fetch(`http://127.0.0.1:${port}/json`)).json(); }
export async function connect(port, pick = t => t.type === 'page') {
  const t = (await targets(port)).find(pick); if (!t) throw new Error('CDP 대상 없음');
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error('eval 오류: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
  return { ev, send, close: () => ws.close(), title: t.title, url: t.url };
}
