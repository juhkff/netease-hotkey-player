// 第二轮探测：滑块结构、React 事件、时长来源。只读。
const PORT = Number(process.argv[2] || 9229);
const base = `http://127.0.0.1:${PORT}`;

const PAGE_PROBE = `(() => {
  const vis = e => e && e.getClientRects().length > 0;
  const cls = e => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '');
  const rct = e => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = {};

  // 1. 所有播放条容器
  out.bars = [...document.querySelectorAll('[class*="bar-wrapper"], [class*="BarWrapper"]')].map(e => ({
    cls: cls(e).slice(0, 70), visible: vis(e), rect: rct(e)
  }));

  // 2. 所有滑块
  const sliders = [...document.querySelectorAll('.slider-default, [class*="SliderContainer"]')];
  out.sliderCount = sliders.length;
  out.sliders = sliders.map(s => {
    const kids = [...s.querySelectorAll('*')].slice(0, 12).map(k => ({
      cls: cls(k).slice(0, 60), style: (k.getAttribute('style') || '').slice(0, 120), rect: rct(k)
    }));
    const handlers = {};
    for (const key of Object.keys(s)) {
      if (!key.startsWith('__reactEventHandlers')) continue;
      const props = s[key] || {};
      for (const p of Object.keys(props)) {
        const v = props[p];
        if (typeof v === 'function') handlers[p] = 'fn/' + (v.name || 'anon');
        else if (v === null || ['string','number','boolean'].includes(typeof v)) handlers[p] = v;
      }
    }
    return { cls: cls(s).slice(0, 70), visible: vis(s), rect: rct(s),
             styleWidth: (s.getAttribute('style') || '').slice(0, 200),
             html: s.outerHTML.slice(0, 900), children: kids, reactProps: handlers };
  });

  // 3. 时间文本（mm:ss）
  out.timeTexts = [...document.querySelectorAll('span,div')]
    .filter(e => vis(e) && e.children.length === 0 && /^\\s*\\d{1,2}:\\d{2}\\s*$/.test(e.textContent || ''))
    .slice(0, 12)
    .map(e => ({ cls: cls(e).slice(0, 60), text: (e.textContent || '').trim(), rect: rct(e) }));

  // 4. 媒体元素详查
  out.mediaDetail = [...document.querySelectorAll('audio,video')].map(m => ({
    tag: m.tagName, src: String(m.src || '').slice(0, 60), currentSrc: String(m.currentSrc || '').slice(0, 60),
    srcObject: m.srcObject ? 'yes' : 'no', paused: m.paused, duration: m.duration,
    currentTime: m.currentTime, readyState: m.readyState, networkState: m.networkState,
    visible: vis(m), rect: rct(m)
  }));

  // 5. 当前曲目
  const info = document.querySelector('[class*="songPlayInfo_"]');
  out.song = info ? (info.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null;
  const playBtn = document.querySelector('[id="btn_pc_minibar_play"]');
  out.playBtnExists = !!playBtn;
  out.playBtnTitle = playBtn ? playBtn.getAttribute('title') : null;

  return out;
})()`;

const targets = await (await fetch(`${base}/json/list`, { redirect: 'error' })).json();
const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
for (const t of pages) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const msg = await new Promise(res => {
    const timer = setTimeout(() => res({ timedOut: true }), 8000);
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) { clearTimeout(timer); res(m); }
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
      params: { expression: PAGE_PROBE, returnByValue: true, awaitPromise: true } }));
  });
  if (msg.result?.exceptionDetails) {
    console.log('EXCEPTION:', msg.result.exceptionDetails.exception?.description?.slice(0, 500));
  }
  console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));
  ws.close();
}
