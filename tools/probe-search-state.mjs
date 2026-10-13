// 诊断：当前客户端页面处于什么状态、搜索结果页有没有行。
import { connect } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));

const info = await c.evaluate(String.raw`(() => {
  const rows = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')];
  const vis  = rows.filter(e => e.getClientRects().length);
  const kw = document.querySelector('.keyword');
  const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
  const tabs = ['cmdTab0','cmdTab1','cmdTab2'].map(id => {
    const e = document.getElementById(id);
    return id + '=' + (e ? (e.className || '').slice(0, 40) : 'null');
  });
  const cur = document.querySelector('[class*="TabWrapper"] [class*="selected"], [class*="cmd-tabs"] [class*="active"]');
  return JSON.stringify({
    hash: location.hash,
    keywordText: kw ? String(kw.textContent).trim() : null,
    searchInput: inp ? inp.value : null,
    rowTotal: rows.length,
    rowVisible: vis.length,
    firstRowText: vis.length ? vis[0].innerText.replace(/\n/g, '|').slice(0, 60) : null,
    tabs,
    selectedTab: cur ? cur.textContent : null,
    resultPageIds: ['page_pc_search_result','page_pc_search_song','page_pc_home','page_pc_songplay']
      .filter(id => document.getElementById(id))
  });
})()`);
console.log(info);
c.close();
process.exit(0);
