// 第三十轮：走 app 自己的 UI 路径播放一首歌，验证「真实加载 + 位置前进」。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const KEYWORD = process.argv[3] || '稻香 周杰伦';
const show = (t, s) => console.log(`  ${t} songId=${s.songId} name=${s.name} playing=${s.playing} state=${s.playingState} pos=${s.seconds} pct=${s.percentStr} dur=${s.duration}`);

let s = await c.readState(); show('搜索前', s);

// 1) 聚焦搜索框
console.log('  聚焦: ' + await c.evaluate(String.raw`(() => {
  const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
  if (!inp) return 'no input';
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return { cls: String(inp.className).slice(0, 60), ph: inp.placeholder };
})()`));

// 2) 输入关键字 + 回车
await c.send('Input.insertText', { text: KEYWORD });
await sleep(300);
for (const type of ['keyDown', 'char', 'keyUp']) {
  await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
}
await sleep(3000);
console.log('  结果页: ' + await c.evaluate(String.raw`(() => {
  const kw = document.querySelector('.keyword');
  return JSON.stringify({ hasResultPage: !!document.querySelector('[id="page_pc_search_result"]'), keyword: kw ? kw.textContent.trim() : null });
})()`));

// 3) 点「单曲」tab
console.log('  点单曲 tab: ' + await c.evaluate(String.raw`(() => {
  const t = document.querySelector('#cmdTab1') || document.querySelector('[data-testid="tid_btn_pc_search_tab_song"]');
  if (!t) return 'no tab';
  t.click();
  return String(t.textContent || t.id).slice(0, 30);
})()`));
await sleep(3500);

// 4) 列出行（含 fiber 里的真实 trackId）
const rows = await c.evaluate(String.raw`(() => {
  const out = [];
  const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let f = null;
    for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
    let node = f, data = null;
    for (let d = 0; d < 14 && node; d++) {
      const p = node.memoizedProps;
      if (p && p.data && p.data.id) { data = p.data; break; }
      if (p && p.track && p.track.id) { data = p.track; break; }
      node = node.return;
    }
    const ti = el.querySelector('.title');
    out.push({ idx: i, id: String(data ? data.id : ''), nm: String(data ? data.name : ''), dur: Number(data ? data.duration : 0),
               ui: ti ? String(ti.textContent).trim() : '',
               x: Math.round(r.x + r.width * 0.35), y: Math.round(r.y + r.height / 2) });
  }
  return JSON.stringify(out);
})()`);
const list = JSON.parse(rows || '[]');
console.log(`  可见歌曲行 ${list.length} 条:`);
for (const r of list.slice(0, 8)) console.log(`    [$'{'}${r.idx}] id=${r.id} dur=${r.dur} ui="${r.ui}"`);

// 5) 双击第一行（若与当前歌曲不同）
const target = list.find(r => r.id && String(r.id) !== String(s.songId));
if (!target) { console.log('  没有可双击的新行'); c.close(); process.exit(0); }
console.log(`  双击 idx=${target.idx} id=${target.id} "${target.ui}"`);
for (const clickCount of [1, 2]) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none', buttons: 0 });
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount });
  await sleep(40);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount });
  await sleep(60);
}

// 6) 观察位置是否前进
for (let i = 1; i <= 7; i++) { await sleep(1000); s = await c.readState(); show(`+${i}s`, s); }
c.close();
