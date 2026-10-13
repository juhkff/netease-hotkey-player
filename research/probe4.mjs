// 第四轮：找总时长 + 确认播放状态 + 导出播放条 DOM 树。只读。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const cls = e => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '');
  const rct = e => { const r = e.getBoundingClientRect();
    return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); };
  const out = {};
  out.viewport = { w: innerWidth, h: innerHeight };
  out.dpr = devicePixelRatio;
  out.scrollY = Math.round(scrollY);

  const bar = document.querySelector('.default-bar-wrapper');
  out.barExists = !!bar;

  // 1. 播放条 DOM 树（限深限量）
  const lines = [];
  const walk = (e, d) => {
    if (lines.length > 190 || d > 9) return;
    const t = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    lines.push('  '.repeat(d) + e.tagName.toLowerCase() + '.' + cls(e).slice(0, 46)
      + ' [' + rct(e) + ']' + (t ? ' "' + t.slice(0, 40) + '"' : '')
      + (e.getAttribute && e.getAttribute('aria-label') ? ' @' + e.getAttribute('aria-label') : ''));
    for (const c of e.children) walk(c, d + 1);
  };
  if (bar) walk(bar, 0);
  out.barTree = lines;

  // 2. 页面里所有 mm:ss 文本，带上是否在可视区
  const timeRe = /^\\s*\\d{1,2}:\\d{2}\\s*$/;
  const all = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && timeRe.test(e.textContent || ''));
  out.timeInBar = all.filter(e => bar && bar.contains(e)).map(e => ({ t: e.textContent.trim(), cls: cls(e).slice(0, 40), r: rct(e) }));
  out.timeNearBottom = all.filter(e => { const r = e.getBoundingClientRect(); return r.y > innerHeight - 200 && r.y < innerHeight + 50; })
    .map(e => ({ t: e.textContent.trim(), cls: cls(e).slice(0, 40), r: rct(e) }));

  // 3. 合并格式 "01:23 / 04:52"
  out.combined = [...document.querySelectorAll('*')].filter(e => e.children.length === 0
      && /\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}/.test(e.textContent || ''))
    .slice(0, 8).map(e => ({ t: (e.textContent || '').trim().slice(0, 60), cls: cls(e).slice(0, 40), r: rct(e) }));

  // 4. 滑块 React 侧数据（沿 fiber 往上找带 duration/currentTime 的 props）
  const s = document.querySelector('.slider-default');
  const found = [];
  if (s) {
    const fkey = Object.keys(s).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
    let f = fkey ? s[fkey] : null;
    for (let i = 0; f && i < 30; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      const hit = {};
      for (const k of Object.keys(p)) {
        const v = p[k];
        if (/duration|currentTime|progress|percent|time|seek|position|slider/i.test(k)
            && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) hit[k] = v;
      }
      if (Object.keys(hit).length) found.push({ lvl: i, type: (f.type && (f.type.name || f.type.displayName)) || typeof f.type, props: hit });
    }
  }
  out.fiberHits = found;

  out.trackPercent = s ? (s.style.getPropertyValue('--track-precent') || '').trim() : null;
  const pb = document.querySelector('[id="btn_pc_minibar_play"]');
  out.playBtn = pb ? { title: pb.getAttribute('title'), cls: cls(pb).slice(0, 60), html: pb.outerHTML.slice(0, 400) } : null;
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const evaluate = expr => new Promise(res => {
  const id = ++seq; const timer = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 10000);
  pending.set(id, m => { clearTimeout(timer); res(m.result?.result?.value ?? m); });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
});

const r = await evaluate(PROBE);
if (r.err || r.exceptionDetails) console.log('EXC:', JSON.stringify(r).slice(0, 400));
console.log(JSON.stringify({ viewport: r.viewport, dpr: r.dpr, scrollY: r.scrollY, barExists: r.barExists }, null, 1));
console.log('\n=== 播放条 DOM 树 ===');
console.log((r.barTree || []).join('\n'));
console.log('\n=== 条内 mm:ss ===', JSON.stringify(r.timeInBar));
console.log('=== 底部附近 mm:ss ===', JSON.stringify(r.timeNearBottom));
console.log('=== 合并格式 ===', JSON.stringify(r.combined));
console.log('\n=== fiber 命中 ===');
console.log(JSON.stringify(r.fiberHits, null, 1));
console.log('\n=== playBtn ===', JSON.stringify(r.playBtn, null, 1));

// 播放状态：3 秒内 percent 是否推进
const a = r.trackPercent;
await new Promise(res => setTimeout(res, 3000));
const b = await evaluate(`(document.querySelector('.slider-default')||{style:{getPropertyValue:()=>null}}).style.getPropertyValue('--track-precent')`);
console.log(`\n=== 播放状态检测: 3s 前 ${a} → 现在 ${b} ===`, a === b ? '未推进（暂停或已停止）' : '推进中（正在播放）');
ws.close();
