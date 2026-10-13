// 第三十三轮：搜索结果行全量列表 + 滚动加载更多，确认目标 id 能否被搜到。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const KEYWORD = process.argv[3] || '晴天 周杰伦';
const WANT = process.argv[4] || '186016';

const dump = async tag => {
  const r = await c.evaluate(String.raw`(() => {
    const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
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
      out.push(String(data ? data.id : '?') + ' | ' + String(ti ? ti.textContent : '').trim());
    }
    // 找可滚动容器
    const sc = [...document.querySelectorAll('[id="page_pc_search_result"] *')]
      .filter(e => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 100);
    return JSON.stringify({ n: els.length, rows: out,
      scrollers: sc.slice(0, 4).map(e => ({ cls: String(e.className).slice(0, 50), sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop })) });
  })()`);
  const j = JSON.parse(r || '{}');
  console.log(`  [${tag}] 行数=${j.n} 目标命中=${(j.rows || []).some(x => x.startsWith(WANT + ' |')) ? '★ 是' : '否'}`);
  for (const x of j.rows || []) console.log('      ' + x);
  if (tag === '初始') console.log('  可滚动容器: ' + JSON.stringify(j.scrollers));
  return j;
};

// 搜索 + 单曲 tab
await c.evaluate(String.raw`(() => {
  const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await c.send('Input.insertText', { text: KEYWORD });
await sleep(250);
for (const type of ['keyDown', 'char', 'keyUp']) {
  await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
}
await sleep(3000);
await c.evaluate(String.raw`(() => { const t = document.querySelector('#cmdTab1'); if (t) t.click(); return true; })()`);
await sleep(3500);

await dump('初始');

// 滚动列表找更多
const box = await c.evaluate(String.raw`(() => {
  const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
  if (!els.length) return '0,0';
  const r = els[0].getBoundingClientRect();
  return Math.round(r.x + 300) + ',' + Math.round(r.y + 200);
})()`);
const [bx, by] = String(box).split(',').map(Number);
for (let k = 1; k <= 4; k++) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bx, y: by, deltaX: 0, deltaY: 900, button: 'none', buttons: 0 });
  await sleep(1600);
  await dump(`滚动${k}`);
}
c.close();
