// 第二十八轮：拿到「真实播放一首歌」时 app 自己 dispatch 的完整 action 序列。
// 做法：包装 store.dispatch 记录日志 → 点播放条的「下一首」按钮（这是真实播放路径）
//      → 对比我们注入 setPlaying 时缺了哪些 action。
import { connect, sleep } from '../lib/ncm.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);

console.log('包装 dispatch: ' + await c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore();
  if (window.__logPatched) { window.__log = []; return '已包装(清空日志)'; }
  window.__log = [];
  const orig = st.dispatch;
  const wrapped = function (a) {
    try {
      window.__log.push({ type: a && a.type,
        payload: (a && a.payload !== undefined) ? JSON.stringify(a.payload).slice(0, 500) : null });
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  st.dispatch = wrapped;
  window.__logPatched = true;
  return 'ok';
})()`));

const before = await c.readState();
console.log('点击前: ' + JSON.stringify({ songId: before.songId, name: before.name, pos: before.seconds }));

// 找「下一首」按钮
const rect = await c.evaluate(String.raw`(() => {
  const bar = document.querySelector('.default-bar-wrapper');
  if (!bar) return { err: 'no bar' };
  const el = bar.querySelector('.cmd-icon-next');
  if (!el) return { err: 'no next icon' };
  const btn = el.closest('button') || el.closest('[role="button"]') || el.parentElement;
  const r = btn.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
           tag: btn.tagName, cls: String(btn.className).slice(0, 90) };
})()`);
console.log('下一首按钮: ' + JSON.stringify(rect));

if (rect && rect.w) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
  await sleep(60);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
}

for (let i = 1; i <= 6; i++) {
  await sleep(1000);
  const s = await c.readState();
  console.log(`  +${i}s songId=${s.songId} name=${s.name} pos=${s.seconds} playing=${s.playing}`);
}

const log = await c.evaluate('JSON.stringify(window.__log || [])');
console.log('\n--- app 自己 dispatch 的 action 序列（共 ' + JSON.parse(log || '[]').length + ' 条）---');
for (const e of JSON.parse(log || '[]')) {
  console.log('  ' + e.type + (e.payload ? '   ' + e.payload : ''));
}
c.close();
