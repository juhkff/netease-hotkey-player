// 第十一轮：拉全 dbg.Command 的原生命令白名单 + window.channel。只读（不调用任何命令）。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const out = {};
  try { out.execSrc = String(window.dbg.Command.exec); } catch (e) { out.execSrc = 'ERR ' + e; }
  try { out.doSrc = String(window.dbg.Command.do); } catch (e) {}
  try { out.callSrc = String(window.dbg.Command.call); } catch (e) {}
  try {
    const ch = window.channel;
    out.channelType = typeof ch;
    out.channelKeys = ch ? Object.keys(ch).slice(0, 200) : null;
    out.channelN = ch ? Object.keys(ch).length : null;
  } catch (e) { out.channel = 'ERR ' + e; }
  try { out.bridgeKeys = window.dbg ? Object.keys(window.dbg) : null; } catch (e) {}
  // 从 exec 里正则抠出所有形如 a.b 的命令名
  try {
    const m = out.execSrc.match(/"[a-zA-Z_]+\\.[a-zA-Z_]+"/g) || [];
    out.cmdNames = Array.from(new Set(m.map(s => s.slice(1, -1))));
  } catch (e) { out.cmdNames = 'ERR ' + e; }
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evaluate = expr => new Promise(res => {
  const id = ++seq; const to = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 25000);
  pending.set(id, m => { clearTimeout(to); res(m.result?.result?.value ?? m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

const r = await evaluate(PROBE);
console.log('### exec 完整源码 ###\n' + r.execSrc + '\n');
console.log('### 抠出的命令名 (' + (r.cmdNames || []).length + ') ###\n' + JSON.stringify(r.cmdNames, null, 1) + '\n');
console.log('### window.channel ###  type=' + r.channelType + ' n=' + r.channelN);
console.log(JSON.stringify(r.channelKeys, null, 1));
console.log('\n### dbg keys ###', JSON.stringify(r.bridgeKeys));
ws.close();
