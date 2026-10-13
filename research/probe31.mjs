// 第三十一轮：用合成 dblclick 事件播放搜索结果行。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const KEYWORD = process.argv[3] || '稻香 周杰伦';
const show = (t, s) => console.log(`  ${t} songId=${s.songId} name=${s.name} playing=${s.playing} state=${s.playingState} pos=${s.seconds} pct=${s.percentStr} dur=${s.duration}`);

let s = await c.readState(); show('前', s);

await c.evaluate(String.raw`(() => {
  const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await c.send('Input.insertText', { text: KEYWORD });
await sleep(300);
for (const type of ['keyDown', 'char', 'keyUp']) {
  await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
}
await sleep(3000);
await c.evaluate(String.raw`(() => { const t = document.querySelector('#cmdTab1'); if (t) t.click(); })()`);
await sleep(3500);

const r = await c.evaluate(String.raw`(() => {
  const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
  if (!els.length) return 'no rows';
  const el = els[0];
  let f = null; for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
  let node = f, data = null;
  for (let d = 0; d < 14 && node; d++) { const p = node.memoizedProps; if (p && p.data && p.data.id) { data = p.data; break; } if (p && p.track && p.track.id) { data = p.track; break; } node = node.return; }
  const before = window.__ncm.read();
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return JSON.stringify({ id: data ? String(data.id) : null, ui: String((el.querySelector('.title') || {}).textContent || ''), beforeSong: before.songId });
})()`);
console.log('  合成 dblclick -> ' + r);
for (let i = 1; i <= 8; i++) { await sleep(1000); s = await c.readState(); show(`+${i}s`, s); }
c.close();
