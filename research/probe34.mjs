// 第三十四轮：逐层 dump 搜索结果行的 fiber props，找出真正的 track 对象挂在哪一层；
// 同时直接问官方搜索接口，看目标 id 到底有没有被搜出来。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const KEYWORD = process.argv[3] || '晴天 周杰伦';
const WANT = process.argv[4] || '186016';

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

console.log('=== 前 4 行的 fiber 逐层结构 ===');
const dump = await c.evaluate(String.raw`(() => {
  const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
  const out = [];
  for (let i = 0; i < Math.min(4, els.length); i++) {
    const el = els[i];
    const title = String((el.querySelector('.title') || {}).textContent || '').trim();
    const artists = String((el.querySelector('.artists') || {}).textContent || '').trim();
    const levels = [];
    let f = null;
    for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
    let node = f;
    for (let d = 0; d < 9 && node; d++) {
      const p = node.memoizedProps;
      let note = '';
      if (p && typeof p === 'object') {
        const keys = Object.keys(p).slice(0, 10).join(',');
        const cand = p.data || p.track || p.song;
        if (cand && typeof cand === 'object') {
          note = ' HIT id=' + String(cand.id) + ' name=' + String(cand.name) + ' dur=' + String(cand.duration) + ' keys=' + Object.keys(cand).slice(0, 8).join('/');
        } else {
          note = ' keys=' + keys;
        }
      }
      levels.push('    L' + d + ' ' + (node.type && (node.type.name || node.type)) + note);
      node = node.return;
    }
    out.push('  #' + i + ' DOM标题="' + title + '" 歌手="' + artists + '"\n' + levels.join('\n'));
  }
  return out.join('\n');
})()`);
console.log(dump);

console.log('\n=== 官方搜索接口返回的前 20 首（type=1 单曲）===');
const api = await c.evaluate(`(async () => {
  const r = await fetch('https://music.163.com/api/search/get/web?csrf_token=&s=' + encodeURIComponent(${JSON.stringify(KEYWORD)}) + '&type=1&offset=0&limit=30', { credentials: 'include' });
  const j = await r.json();
  const songs = (j.result && j.result.songs) || [];
  return JSON.stringify({ total: j.result && j.result.songCount, n: songs.length,
    list: songs.map(s => s.id + ' | ' + s.name + ' | ' + (s.artists || []).map(a => a.name).join('/') + ' | ' + Math.round((s.duration || 0) / 1000) + 's') });
})()`);
const aj = JSON.parse(api || '{}');
console.log('  total=' + aj.total + ' 返回=' + aj.n + ' 目标' + WANT + '命中=' + ((aj.list || []).some(x => x.startsWith(WANT + ' |')) ? '★ 是' : '否'));
for (const x of (aj.list || []).slice(0, 20)) console.log('    ' + x);
c.close();
