// 第三十七轮：186016 双击后完全没反应 —— 查它是不是「不可播放」。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));

const cmp = async ids => {
  const r = await c.evaluate(`(async () => {
    const out = [];
    for (const id of ${JSON.stringify(ids)}) {
      const r = await fetch('https://music.163.com/api/song/detail?ids=%5B' + id + '%5D', { credentials: 'include' });
      const j = await r.json();
      const t = (j.songs || [])[0] || {};
      out.push({ id, name: t.name, fee: t.fee, st: t.st, noCopyrightRcmd: t.noCopyrightRcmd,
                 duration: t.duration });
    }
    return JSON.stringify(out);
  })()`);
  return JSON.parse(r || '[]');
};

console.log('=== 歌曲可播性对比（/api/song/detail）===');
for (const x of await cmp(['186016', '1330348068', '35447132'])) {
  console.log('  ' + JSON.stringify(x));
}

console.log('\n=== privilege 对比（/api/song/enhance/privilege）===');
const priv = await c.evaluate(`(async () => {
  const r = await fetch('https://music.163.com/api/song/enhance/privilege?ids=%5B186016,1330348068%5D', { credentials: 'include' });
  const j = await r.json();
  return JSON.stringify((j.data || []).map(p => ({ id: p.id, fee: p.fee, st: p.st, pl: p.pl, plLevel: p.plLevel,
    maxBrLevel: p.maxBrLevel, downloadMaxBrLevel: p.downloadMaxBrLevel })));
})()`);
console.log(priv);

console.log('\n=== 搜索并 dump 186016 那一行 ===');
await c.evaluate(String.raw`(() => {
  const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
  inp.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await c.send('Input.insertText', { text: '晴天 周杰伦 叶惠美' });
await sleep(250);
for (const type of ['keyDown', 'char', 'keyUp']) {
  await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
}
await sleep(3000);
await c.evaluate(String.raw`(() => { const t = document.querySelector('#cmdTab1'); if (t) t.click(); return true; })()`);
await sleep(3500);

const rowDump = await c.evaluate(String.raw`(() => {
  const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
  for (const el of els) {
    let f = null;
    for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
    let node = f, data = null;
    for (let d = 0; d < 14 && node; d++) {
      const p = node.memoizedProps;
      if (p && p.data && p.data.id) { data = p.data; break; }
      if (p && p.track && p.track.id) { data = p.track; break; }
      node = node.return;
    }
    if (!data || String(data.id) !== '186016') continue;
    const cls = String(el.className);
    const kids = [...el.querySelectorAll('*')].map(k => String(k.className)).filter(c => /disab|vip|unable|grey|gray|cannot/i.test(c));
    return JSON.stringify({
      title: String((el.querySelector('.title') || {}).textContent || '').trim(),
      rowCls: cls.slice(0, 200),
      可疑子元素: kids.slice(0, 8),
      dataKeys: Object.keys(data).slice(0, 40),
      fee: data.fee, st: data.st, privilege: data.privilege ? {
        st: data.privilege.st, fee: data.privilege.fee, pl: data.privilege.pl, plLevel: data.privilege.plLevel } : null,
      noCopyrightRcmd: data.noCopyrightRcmd, duration: data.duration
    });
  }
  return '没找到 186016 行';
})()`);
console.log(rowDump);
c.close();
