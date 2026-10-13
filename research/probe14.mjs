// 第十四轮：实测「搜索 → 结果页」流程，并确认结果行里能否读到歌曲 ID。
// 用法: node probe14.mjs <port> <query>
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const query = process.argv[3] || '晴天';

const c = await connect(port);
console.log('已连接:', c.target.url);

// 1. 聚焦搜索框并清空
console.log('\n[1] 聚焦搜索框');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const inputs = [...document.querySelectorAll('[class*="SearchWrapper_"] input, input.cmd-input')];
  const vis = inputs.filter(e => e.getClientRects().length);
  if (!vis.length) return { err: 'no search input', found: inputs.length };
  const input = vis[0];
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, cls: input.className, ph: input.placeholder, focused: document.activeElement === input };
})()`)));

// 2. 输入文字（真实 Input.insertText）
console.log('\n[2] 输入:', query);
await c.send('Input.insertText', { text: query });
await sleep(1200);
console.log(JSON.stringify(await c.evaluate(`(() => {
  const inputs = [...document.querySelectorAll('[class*="SearchWrapper_"] input, input.cmd-input')].filter(e => e.getClientRects().length);
  const input = inputs[0];
  const drop = document.querySelector('[class*="SearchSuggest"], [class*="suggest"], [class*="SearchPanel"]');
  return { value: input ? input.value : null,
           dropText: drop ? drop.textContent.replace(/\\s+/g,' ').slice(0, 300) : null,
           dropRows: drop ? drop.querySelectorAll('[data-log]').length : 0 };
})()`)));

// 3. 回车
console.log('\n[3] 按 Enter');
await c.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r' });
await sleep(80);
await c.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
await sleep(2500);

// 4. 结果页结构
console.log('\n[4] 结果页');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no result page', href: location.href };
  const kw = root.querySelector('.keyword');
  const rows = [...root.querySelectorAll('[data-log*="cell_pc_songlist_song"]')];
  const sample = rows.slice(0, 4).map(r => {
    let log = null; try { log = JSON.parse(r.getAttribute('data-log') || 'null'); } catch (e) { log = r.getAttribute('data-log'); }
    let keys = null; try { keys = Object.keys(r).filter(k => k.startsWith('__react')).map(k => k.slice(0, 24)); } catch (e) {}
    return {
      text: r.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90),
      num: r.querySelector('.td-num') ? r.querySelector('.td-num').textContent.trim() : null,
      title: r.querySelector('.title') ? r.querySelector('.title').textContent.trim() : null,
      dataLog: log,
      attrs: [...r.attributes].map(a => a.name + '=' + String(a.value).slice(0, 80)),
      reactKeys: keys,
    };
  });
  return { keyword: kw ? kw.textContent.trim() : null, rowCount: rows.length, sample };
})()`, null, 1)));

c.close();
