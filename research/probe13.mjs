// 第十三轮：把 app 的 JS bundle 逐个抓下来落到 WSL 磁盘，方便本地 grep。
// 用法: node probe13.mjs <port> <windows-out-dir>
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || 9229);
const OUT = process.argv[3];
if (!OUT) { console.error('need out dir'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const LIST = `(() => {
  const urls = new Set();
  for (const r of performance.getEntriesByType('resource')) { if (/\\.js(\\?|$)/.test(r.name)) urls.add(r.name); }
  for (const s of document.querySelectorAll('script[src]')) urls.add(s.src);
  return Array.from(urls);
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (id, expr, timeout) => new Promise(res => {
  const to = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, timeout);
  pending.set(id, m => { clearTimeout(to); res(m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});
const evaluate = (expr, t = 30000) => send(++seq, expr, t).then(m => m.result?.result?.value ?? m);

const urls = await evaluate(LIST);
console.log('js urls =', urls.length);
const map = [];
let total = 0;
for (const u of urls) {
  const name = u.replace(/^[a-z]+:\/\//i, '').replace(/[^A-Za-z0-9._@~%-]/g, '_').slice(-140);
  const r = await evaluate(`fetch(${JSON.stringify(u)}).then(r=>r.text())`, 60000);
  if (typeof r !== 'string') { console.log('SKIP', u, JSON.stringify(r).slice(0, 100)); continue; }
  fs.writeFileSync(path.join(OUT, name), r);
  map.push({ url: u, file: name, chars: r.length });
  total += r.length;
  console.log('ok', r.length, name);
}
fs.writeFileSync(path.join(OUT, '_map.json'), JSON.stringify(map, null, 1));
console.log('\ntotal chars =', total, ' files =', map.length);
console.log('out =', OUT);
ws.close();
