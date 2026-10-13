// 第七轮：找搜索入口、路由格式、webpack 可达性。只读。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const cls = e => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '');
  const rct = e => { const r = e.getBoundingClientRect();
    return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); };
  const vis = e => e && e.getClientRects().length > 0;
  const out = {};
  out.href = location.href;
  out.hash = location.hash;
  out.title = document.title;
  out.viewport = innerWidth + 'x' + innerHeight;

  const sel = 'input, textarea, [contenteditable="true"], [role="searchbox"], [id*="search" i], [class*="search" i]';
  out.searchish = [...document.querySelectorAll(sel)].filter(vis).slice(0, 22).map(e => ({
    tag: e.tagName, id: e.id || null, cls: cls(e).slice(0, 55),
    ph: e.getAttribute('placeholder'), r: rct(e), t: (e.textContent || '').trim().slice(0, 25)
  }));

  const nav = document.querySelector('[class*="Nav" i], [class*="nav" i], [class*="sidebar" i]');
  out.navCls = nav ? cls(nav).slice(0, 70) : null;
  out.navItems = nav ? [...nav.querySelectorAll('a, li, [class*="item" i], [id]')].slice(0, 35).map(e => ({
    tag: e.tagName, id: e.id || null, cls: cls(e).slice(0, 45),
    t: (e.textContent || '').trim().slice(0, 14), r: rct(e)
  })) : [];

  out.pageIds = [...document.querySelectorAll('[id^="page_pc"]')].map(e => e.id).slice(0, 40);
  out.windowKeys = Object.keys(window).slice(0, 150);
  out.webpackJsonpType = typeof window.webpackJsonp;
  out.webpackJsonpIsArray = Array.isArray(window.webpackJsonp);
  out.devtoolsHook = typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    try { out.renderers = [...window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.keys()]; } catch (e) { out.renderers = 'err'; }
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
  const id = ++seq; const to = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 10000);
  pending.set(id, m => { clearTimeout(to); res(m.result?.result?.value ?? m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

const r = await evaluate(PROBE);
console.log('href =', r.href, ' hash =', JSON.stringify(r.hash), ' viewport =', r.viewport);
console.log('\n=== 搜索类元素 ===');
console.log(JSON.stringify(r.searchish, null, 1));
console.log('\n=== 导航 (' + r.navCls + ') ===');
console.log(JSON.stringify(r.navItems, null, 1));
console.log('\npageIds =', JSON.stringify(r.pageIds));
console.log('webpackJsonp =', r.webpackJsonpType, 'isArray =', r.webpackJsonpIsArray, ' devtoolsHook =', r.devtoolsHook, ' renderers =', JSON.stringify(r.renderers));
console.log('\nwindowKeys =', JSON.stringify(r.windowKeys));
ws.close();
