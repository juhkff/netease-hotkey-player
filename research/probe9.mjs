// 第九轮：内省 app 暴露的全局对象，找"播放指定歌曲"的入口。只读（不调用任何修改性方法）。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const describe = (name, v) => {
    const r = { name, type: typeof v };
    if (v === null || v === undefined) return r;
    let keys;
    try { keys = Object.getOwnPropertyNames(v); } catch (e) { r.err = String(e).slice(0, 120); return r; }
    r.keyCount = keys.length;
    r.keys = {};
    for (const k of keys.slice(0, 70)) {
      let val;
      try { val = v[k]; } catch (e) { r.keys[k] = '<getter throws>'; continue; }
      const t = typeof val;
      if (t === 'function') r.keys[k] = 'fn/' + val.length;
      else if (t === 'object' && val) {
        let ik = []; try { ik = Object.keys(val); } catch (e) {}
        r.keys[k] = 'obj{' + ik.slice(0, 7).join(',') + '}';
      } else r.keys[k] = t + ':' + String(val).slice(0, 35);
    }
    return r;
  };
  const out = {};
  for (const n of ['api','hotkeys','legacyNativeCmder','MNB','__mnb_globals__','puzzle','dbg','corona','MusicCorona','WM','Watchman','APP_CONF']) {
    try { out[n] = describe(n, window[n]); } catch (e) { out[n] = { name: n, err: String(e).slice(0, 120) }; }
  }
  // api 的第二层
  try {
    const a = window.api;
    if (a) {
      const d2 = {};
      for (const k of Object.keys(a).slice(0, 60)) {
        let val; try { val = a[k]; } catch (e) { d2[k] = '<throw>'; continue; }
        if (typeof val === 'function') d2[k] = 'fn/' + val.length;
        else if (val && typeof val === 'object') {
          let ik = []; try { ik = Object.keys(val); } catch (e) {}
          d2[k] = 'obj{' + ik.slice(0, 10).join(',') + '}';
        } else d2[k] = typeof val;
      }
      out.apiLevel2 = d2;
    }
  } catch (e) { out.apiLevel2 = String(e).slice(0, 150); }
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
for (const k of Object.keys(r)) {
  if (k === 'apiLevel2') continue;
  console.log('=== ' + k + ' ===', JSON.stringify(r[k]));
}
console.log('\n=== api 第二层 ===');
console.log(JSON.stringify(r.apiLevel2, null, 1));
ws.close();
