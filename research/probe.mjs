// 探测网易云客户端 CEF 页面结构，找出可驱动的进度条 / 音频元素。
// 只读，不修改任何东西。
const PORT = Number(process.argv[2] || 9229);
const base = `http://127.0.0.1:${PORT}`;

const PAGE_PROBE = `(() => {
  const vis = e => e && e.getClientRects().length > 0;
  const cls = e => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '');
  const out = { url: location.href, title: document.title };

  out.hasMinibarPlay = !!document.querySelector('[id="btn_pc_minibar_play"]');
  const wrapper = document.querySelector('.default-bar-wrapper, .vinyl-page-bar-wrapper');
  out.barWrapperFound = !!wrapper;

  out.media = [...document.querySelectorAll('audio,video')].map(m => ({
    tag: m.tagName,
    src: String(m.currentSrc || m.src || '').slice(0, 90),
    duration: m.duration,
    currentTime: m.currentTime,
    paused: m.paused,
    readyState: m.readyState
  }));

  const root = document.querySelector('#root') || document.body;
  out.reactKeysOnRoot = Object.keys(root).filter(k => k.startsWith('__react'));
  if (wrapper) out.reactKeysOnBar = Object.keys(wrapper).filter(k => k.startsWith('__react'));

  const cands = [...document.querySelectorAll('[class],[role],[id]')]
    .filter(e => /progress|slider|seek|process/i.test(cls(e) + ' ' + (e.id || '') + ' ' + (e.getAttribute('role') || '')))
    .filter(vis).slice(0, 30)
    .map(e => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, id: e.id || null, cls: cls(e).slice(0, 80),
               role: e.getAttribute('role'), w: Math.round(r.width), h: Math.round(r.height),
               x: Math.round(r.x), y: Math.round(r.y) };
    });
  out.seekCandidates = cands;

  if (wrapper) {
    const r = wrapper.getBoundingClientRect();
    out.barRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    // 百分比宽度的元素通常是进度填充
    out.pctWidth = [...wrapper.querySelectorAll('*')]
      .filter(e => /%$/.test(e.style && e.style.width || ''))
      .slice(0, 15)
      .map(e => { const b = e.getBoundingClientRect();
        return { cls: cls(e).slice(0, 70), width: e.style.width,
                 w: Math.round(b.width), x: Math.round(b.x), y: Math.round(b.y) }; });
    out.barHtml = wrapper.outerHTML.slice(0, 2500);
  }
  return out;
})()`;

const listRes = await fetch(`${base}/json/list`, { redirect: 'error' });
const targets = await listRes.json();
console.log('=== /json/list ===');
for (const t of targets) {
  console.log(`  [${t.type}] ${JSON.stringify(t.title)} ${String(t.url || '').slice(0, 110)}`);
}

const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
console.log(`\n=== probing ${pages.length} page target(s) ===\n`);

for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  try {
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
  } catch (e) {
    console.log(`--- ${t.title}: CONNECT FAILED`);
    continue;
  }
  const msg = await new Promise(res => {
    const timer = setTimeout(() => res({ timedOut: true }), 8000);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(timer); res(m); }
    });
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: PAGE_PROBE, returnByValue: true, awaitPromise: true },
    }));
  });
  console.log(`--- page: ${t.title}`);
  if (msg.timedOut) { console.log('  TIMEOUT'); ws.close(); continue; }
  if (msg.result?.exceptionDetails) {
    console.log('  EXCEPTION:', msg.result.exceptionDetails.exception?.description?.slice(0, 400));
  }
  console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));
  console.log();
  ws.close();
}
