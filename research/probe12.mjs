// 第十二轮：把 app 的 JS bundle 全部抓下来，抠出原生命令全集 + 深链接处理痕迹。只读。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(async () => {
  const out = {};
  const urls = new Set();
  for (const r of performance.getEntriesByType('resource')) { if (/\\.js(\\?|$)/.test(r.name)) urls.add(r.name); }
  for (const s of document.querySelectorAll('script[src]')) urls.add(s.src);
  out.jsUrls = Array.from(urls);
  out.jsCount = out.jsUrls.length;

  const texts = [];
  for (const u of out.jsUrls) {
    try { const t = await (await fetch(u)).text(); texts.push([u, t]); } catch (e) { out['err_' + u.slice(-30)] = String(e).slice(0, 80); }
  }
  out.fetched = texts.length;
  out.totalChars = texts.reduce((a, b) => a + b[1].length, 0);
  const all = texts.map(t => t[1]).join('\\n');

  const cmdRe = /["'\\\`]((?:player|winhelper|app|storage|musiclibrary|lyric|playlist|cloud|download|native|ne|bridge|desktop|ncm)[a-zA-Z0-9_]*\\.[a-zA-Z0-9_]{2,40})["'\\\`]/g;
  const cmds = new Set(); let mm;
  while ((mm = cmdRe.exec(all))) cmds.add(mm[1]);
  out.commands = Array.from(cmds).sort();
  out.commandCount = out.commands.length;

  // 深链接 / webcmd 痕迹
  const dl = new Set();
  const dlRe = /["'\\\`][^"'\\\`\\n]{0,60}(?:webcmd|orpheus:\\/\\/)[^"'\\\`\\n]{0,80}["'\\\`]/g;
  while ((mm = dlRe.exec(all))) dl.add(mm[0].slice(1, -1));
  out.deepLinkHits = Array.from(dl).slice(0, 60);

  // 找 song/ 路径解析
  const songHits = new Set();
  const songRe = /["'\\\`][^"'\\\`\\n]{0,50}song\\/[a-zA-Z0-9_:{}$]{0,30}[^"'\\\`\\n]{0,50}["'\\\`]/g;
  while ((mm = songRe.exec(all))) songHits.add(mm[0].slice(1, -1));
  out.songHits = Array.from(songHits).slice(0, 60);
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evaluate = expr => new Promise(res => {
  const id = ++seq; const to = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 90000);
  pending.set(id, m => { clearTimeout(to); res(m.result?.result?.value ?? m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

const r = await evaluate(PROBE);
console.log('jsCount=' + r.jsCount + ' fetched=' + r.fetched + ' totalChars=' + r.totalChars);
console.log('\n### JS 列表 ###\n' + JSON.stringify(r.jsUrls, null, 1));
console.log('\n### 原生命令全集 (' + r.commandCount + ') ###\n' + JSON.stringify(r.commands, null, 1));
console.log('\n### 深链接痕迹 ###\n' + JSON.stringify(r.deepLinkHits, null, 1));
console.log('\n### song/ 痕迹 ###\n' + JSON.stringify(r.songHits, null, 1));
ws.close();
