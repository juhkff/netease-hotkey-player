// 第六轮：区分两个播放条、拿到当前歌曲 ID、点可见播放按钮。含跳转/播放测试。
const PORT = Number(process.argv[2] || 9229);

const PROBE = `(() => {
  const cls = e => (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '');
  const rct = e => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = {};

  // 全局有多少个同名播放按钮
  const all = [...document.querySelectorAll('#btn_pc_minibar_play')];
  out.playBtnTotal = all.length;
  out.playBtns = all.map((b, i) => ({
    i, rect: rct(b), vis: b.getClientRects().length > 0,
    inBar: (b.closest('.default-bar-wrapper') ? 'default' : b.closest('.vinyl-page-bar-wrapper') ? 'vinyl' : 'other'),
    iconCls: (b.querySelector('.cmd-icon') ? String(b.querySelector('.cmd-icon').className).slice(0, 60) : null)
  }));

  const bar = document.querySelector('.default-bar-wrapper');
  out.bar = bar ? rct(bar) : null;
  out.idsInBar = bar ? [...bar.querySelectorAll('[id]')].map(e => e.id).slice(0, 30) : [];
  out.btnIdsInBar = bar ? [...bar.querySelectorAll('[id^="btn_"]')].map(e => ({ id: e.id, r: rct(e) })) : [];

  const pb = bar ? bar.querySelector('#btn_pc_minibar_play, [data-testid="tid_playbar_play_btn"]') : null;
  out.visiblePlayBtn = pb ? { rect: rct(pb), iconCls: String((pb.querySelector('.cmd-icon') || {}).className || '').slice(0, 70),
                              html: pb.outerHTML.slice(0, 220) } : null;

  // 时长所在 fiber 层级的全部原始 props
  const s = document.querySelector('.slider-default');
  out.fiberLayers = [];
  if (s) {
    const k = Object.keys(s).find(x => x.startsWith('__reactInternalInstance$') || x.startsWith('__reactFiber$'));
    let f = k ? s[k] : null;
    for (let i = 0; f && i < 24; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      const prim = {};
      for (const kk of Object.keys(p)) {
        const v = p[kk];
        if (['string','number','boolean'].includes(typeof v) && String(v).length < 70) prim[kk] = v;
      }
      if (Object.keys(prim).length) out.fiberLayers.push({ lvl: i, type: (f.type && (f.type.name || f.type.displayName)) || typeof f.type, prim });
    }
  }
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; const timer = setTimeout(() => { pending.delete(id); res({ timedOut: true }); }, 10000);
  pending.set(id, m => { clearTimeout(timer); res(m); }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

const r = await ev(PROBE);
console.log('playBtnTotal =', r.playBtnTotal);
console.log('playBtns =', JSON.stringify(r.playBtns, null, 1));
console.log('bar =', JSON.stringify(r.bar));
console.log('btnIdsInBar =', JSON.stringify(r.btnIdsInBar));
console.log('visiblePlayBtn =', JSON.stringify(r.visiblePlayBtn, null, 1));
console.log('\n=== slider fiber 各层原始 props（只列含 resource/play/state 字样的） ===');
for (const L of r.fiberLayers) {
  const keys = Object.keys(L.prim);
  const interesting = keys.filter(k => /resource|song|track|play|state|duration|id|name|type|mode|rate|level/i.test(k));
  if (interesting.length) {
    const o = {}; for (const k of interesting) o[k] = L.prim[k];
    console.log(`L${L.lvl} <${L.type}>`, JSON.stringify(o));
  }
}

// 点可见播放按钮
const pb = r.visiblePlayBtn;
if (pb && pb.rect.w > 0) {
  const cx = pb.rect.x + Math.round(pb.rect.w / 2), cy = pb.rect.y + Math.round(pb.rect.h / 2);
  console.log(`\n=== 点击可见播放按钮 @ (${cx}, ${cy}) ===`);
  await clickAt(cx, cy);
  await sleep(2500);
  const a = await ev(`(document.querySelector('.slider-default')||{style:{getPropertyValue:()=>null}}).style.getPropertyValue('--track-precent')`);
  const picon = await ev(`(document.querySelector('.default-bar-wrapper #btn_pc_minibar_play .cmd-icon')||{}).className || null`);
  await sleep(2000);
  const b = await ev(`(document.querySelector('.slider-default')||{style:{getPropertyValue:()=>null}}).style.getPropertyValue('--track-precent')`);
  console.log(`点击后播放图标 = ${picon}`);
  console.log(`${a} → 2s 后 ${b}  =>  ${a !== b ? '✅ 正在播放' : '❌ 未推进'}`);
} else {
  console.log('\n未找到可见播放按钮');
}
ws.close();
