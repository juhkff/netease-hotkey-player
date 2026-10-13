// 第十五轮：当前已在搜索结果页，直接 dump 真实结构找出正确的行选择器。
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);
await sleep(1500);

console.log('### 结果页 data-log 元素 ###');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no page' };
  const withLog = [...root.querySelectorAll('[data-log]')];
  const oids = {};
  withLog.forEach(e => {
    let log = {}; try { log = JSON.parse(e.getAttribute('data-log')); } catch (x) {}
    const k = log.oid || '?';
    oids[k] = (oids[k] || 0) + 1;
  });
  return { total: withLog.length, oids };
})()`, null, 1)));

console.log('\n### 包含 songlist/cell/row/song 的 class 名 ###');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no page' };
  const names = new Set();
  for (const e of root.querySelectorAll('*')) {
    const cn = typeof e.className === 'string' ? e.className : '';
    for (const part of cn.split(/\\s+/)) if (/song|cell|row|list|track|item|result/i.test(part)) names.add(part);
  }
  return [...names].sort();
})()`, null, 1)));

console.log('\n### 结果页 innerHTML 前 5000 字符 ###');
const html = await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  return root ? root.innerHTML : 'NO PAGE';
})()`);
console.log(typeof html === 'string' ? html.slice(0, 5000) : JSON.stringify(html));

c.close();
