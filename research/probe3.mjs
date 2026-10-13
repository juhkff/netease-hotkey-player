// 第三轮：读取播放状态 + 用 CDP 真实鼠标事件测试"点击进度条跳转"。
// 用法: node probe3.mjs [port] [目标比例0-1]
const PORT = Number(process.argv[2] || 9229);
const RATIO = Number(process.argv[3] || 0.5);

const READ = `(() => {
  const s = document.querySelector('.slider-default');
  const g = n => s ? (s.style.getPropertyValue(n) || getComputedStyle(s).getPropertyValue(n) || '').trim() : null;
  const rct = e => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const leaf = [...document.querySelectorAll('span,div')]
    .filter(e => e.children.length === 0 && /^\\s*\\d{1,2}:\\d{2}\\s*$/.test(e.textContent || ''));
  const info = document.querySelector('[class*="songPlayInfo_"]');
  const track = s && s.querySelector('.track');
  const slRect = s ? rct(s) : null;
  return {
    trackPercent: g('--track-precent'),
    cachePercent: g('--cache-percent'),
    trackWidth: track ? Math.round(track.getBoundingClientRect().width) : null,
    sliderRect: slRect,
    times: leaf.map(e => ({ t: (e.textContent || '').trim(), cls: String(e.className).slice(0, 45), r: rct(e) })),
    song: info ? (info.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100) : null,
    playBtnTitle: (document.querySelector('[id="btn_pc_minibar_play"]') || {}).title || null,
    globalStores: Object.keys(window).filter(k => /player|store|redux|orpheus|nm_|nmI|webpack/i.test(k)).slice(0, 40)
  };
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) { console.log('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); res({ timedOut: true, method }); }, 10000);
  pending.set(id, m => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expr => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) return { err: m.result.exceptionDetails.exception?.description?.slice(0, 300) };
  return m.result?.result?.value;
};

console.log('=== 跳转前 ===');
const before = await evaluate(READ);
console.log(JSON.stringify(before, null, 2));

const rect = before.sliderRect;
const x = Math.round(rect.x + rect.w * RATIO);
const y = Math.round(rect.y + Math.max(1, Math.floor(rect.h / 2)));
console.log(`\n=== 注入鼠标点击 @ (${x}, ${y}) = ${(RATIO * 100).toFixed(1)}% ===`);

const mouse = (type, extra) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0,
  clickCount: 1, ...extra,
});
console.log('mouseMoved  :', JSON.stringify(await mouse('mouseMoved')));
await new Promise(r => setTimeout(r, 150));
console.log('mousePressed:', JSON.stringify(await mouse('mousePressed')));
await new Promise(r => setTimeout(r, 60));
console.log('mouseReleased:', JSON.stringify(await mouse('mouseReleased')));

await new Promise(r => setTimeout(r, 1200));
console.log('\n=== 跳转后 (1.2s) ===');
const after = await evaluate(READ);
console.log(JSON.stringify(after, null, 2));
console.log('\n跳转前 trackPercent =', before.trackPercent, ' → 跳转后 =', after.trackPercent);

// 再等 2s 看是否在推进（确认真的在播）
await new Promise(r => setTimeout(r, 2000));
const later = await evaluate(READ);
console.log('再过 2s trackPercent =', later.trackPercent);

ws.close();
