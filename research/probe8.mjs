// 第八轮：找出 app 的自定义全局对象 + 尝试取出 webpack 的 __webpack_require__。只读（webpack 探针只加一个空 chunk）。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const out = {};

  // 用空 iframe 建立"标准 window 属性"基线，差集即应用自定义全局
  const ifr = document.createElement('iframe');
  ifr.style.display = 'none';
  document.body.appendChild(ifr);
  let baseline = new Set();
  try { baseline = new Set(Object.getOwnPropertyNames(ifr.contentWindow)); } catch (e) {}
  ifr.remove();
  out.customGlobals = Object.getOwnPropertyNames(window)
    .filter(k => !baseline.has(k) && !/^(on|webkit|moz|ms|__react)/.test(k))
    .slice(0, 150);

  // 取 __webpack_require__（webpack 4 jsonp 标准技巧：push 一个空 chunk 带 runtime 回调）
  let req = null;
  try {
    window.webpackJsonp.push([[987654321], {}, r => { req = r; }]);
    out.pushOk = true;
  } catch (e) { out.pushErr = String(e && e.message || e).slice(0, 300); }
  out.reqType = typeof req;
  if (typeof req === 'function') {
    out.reqKeys = Object.keys(req).slice(0, 30);
    let mods = {};
    try { mods = req.c || {}; } catch (e) { out.cErr = String(e).slice(0, 120); }
    const ids = Object.keys(mods);
    out.moduleCount = ids.length;
    const hits = [];
    for (const id of ids) {
      let m;
      try { m = mods[id] && mods[id].exports; } catch (e) { continue; }
      if (!m || typeof m !== 'object') continue;
      let keys;
      try { keys = Object.keys(m); } catch (e) { continue; }
      for (const k of keys) {
        let v; try { v = m[k]; } catch (e) { continue; }
        if (typeof v === 'function' && /^(play|setPlay|seek|jump|dispatch|next|prev)/i.test(k)) {
          hits.push({ id, key: k, src: String(v).slice(0, 100) });
          if (hits.length > 30) break;
        }
      }
      if (hits.length > 30) break;
    }
    out.playFnHits = hits;
  }
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evaluate = expr => new Promise(res => {
  const id = ++seq; const to = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 20000);
  pending.set(id, m => { clearTimeout(to); res(m.result?.result?.value ?? m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

const r = await evaluate(PROBE);
console.log('customGlobals =', JSON.stringify(r.customGlobals, null, 1));
console.log('\npushOk =', r.pushOk, ' pushErr =', r.pushErr, ' reqType =', r.reqType);
console.log('reqKeys =', JSON.stringify(r.reqKeys));
console.log('moduleCount =', r.moduleCount);
console.log('\nplayFnHits =', JSON.stringify(r.playFnHits, null, 1));
ws.close();
