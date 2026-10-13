// 第十轮：深挖原生命令桥（dbg.Command / legacyNativeCmder._envAdapter / MNB / api / puzzle）。只读。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const out = {};
  const fnInfo = v => { try { return { len: v.length, src: String(v).replace(/\\s+/g, ' ').slice(0, 260) }; } catch (e) { return 'err'; } };
  const shallow = (o, max) => {
    const r = {};
    let ks; try { ks = Object.getOwnPropertyNames(o); } catch (e) { return 'ERR ' + e; }
    for (const k of ks.slice(0, max || 60)) {
      let v; try { v = o[k]; } catch (e) { r[k] = '<throw>'; continue; }
      r[k] = (typeof v === 'function') ? fnInfo(v) : (v && typeof v === 'object' ? 'obj{' + Object.keys(v).slice(0, 12).join(',') + '}' : typeof v + ':' + String(v).slice(0, 40));
    }
    return r;
  };

  // 1. api 到底是什么
  const a = window.api;
  out.api = {
    type: typeof a, str: String(a).slice(0, 120),
    ctor: a && a.constructor && a.constructor.name,
    protoKeys: a ? Object.getOwnPropertyNames(Object.getPrototypeOf(a) || {}).slice(0, 60) : null,
    ownNames: a ? Object.getOwnPropertyNames(a).slice(0, 60) : null,
  };
  try { out.apiProbe = shallow(a, 40); } catch (e) { out.apiProbe = 'ERR ' + e; }

  // 2. dbg.Command 全部函数源码
  try { out.dbgCommand = shallow(window.dbg && window.dbg.Command, 40); } catch (e) { out.dbgCommand = 'ERR ' + e; }

  // 3. legacyNativeCmder._envAdapter
  try {
    const ad = window.legacyNativeCmder && window.legacyNativeCmder._envAdapter;
    out.envAdapterKeys = ad ? Object.getOwnPropertyNames(ad) : null;
    out.registerCallMap = ad ? Object.keys(ad.registerCallMap || {}) : null;
    out.registerCallMapN = ad && ad.registerCallMap ? Object.keys(ad.registerCallMap).length : null;
    out.registerCallStubs = ad && ad.registerCallStubs ? (Array.isArray(ad.registerCallStubs) ? ad.registerCallStubs.slice(0, 60) : Object.keys(ad.registerCallStubs).slice(0, 60)) : null;
    out.queue = ad && ad._registerCallQueue ? String(ad._registerCallQueue).slice(0, 200) : null;
  } catch (e) { out.envAdapter = 'ERR ' + e; }

  // 4. puzzle 模块表
  try {
    const mods = window.puzzle && window.puzzle.instance && window.puzzle.instance.modules;
    out.puzzleModuleKeys = mods ? Object.keys(mods).slice(0, 80) : null;
    out.puzzleModuleN = mods ? Object.keys(mods).length : null;
  } catch (e) { out.puzzle = 'ERR ' + e; }

  // 5. MNB 桥
  try { out.mnbExtension = shallow(window.MNB && window.MNB.extension, 20); } catch (e) {}
  try { out.mnbPostMessage = fnInfo(window.MNB._postMessage); } catch (e) {}
  try { out.mnbAddMethod = fnInfo(window.MNB.addMethod); } catch (e) {}

  // 6. APP_CONF 热键相关
  try {
    out.confKey = JSON.stringify(window.APP_CONF.key).slice(0, 600);
    out.confHotkey = JSON.stringify(window.APP_CONF.hotkey).slice(0, 600);
    out.confInvalidCode = JSON.stringify(window.APP_CONF.invalidCode).slice(0, 400);
    out.confUrls = JSON.stringify(window.APP_CONF.urls).slice(0, 400);
  } catch (e) { out.conf = 'ERR ' + e; }
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
for (const k of Object.keys(r)) console.log('=== ' + k + ' ===\n' + JSON.stringify(r[k], null, 1) + '\n');
ws.close();
