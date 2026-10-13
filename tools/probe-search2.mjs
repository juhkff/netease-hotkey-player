// 排查「搜索结果页一行都没有」：看各页容器是否可见、行选择器命中情况。
import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const expr = `(() => {
  const vis = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
             display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility }; };
  const out = { href: location.href };
  out.pages = {};
  for (const id of ['page_pc_search_result','page_pc_search_song','page_pc_songplay','page_pc_home','page_pc_main_tab'])
    out.pages[id] = vis(document.getElementById(id));
  out.counts = {
    songlistRow: document.querySelectorAll('[data-log*="cell_pc_songlist_song"]').length,
    tdNum: document.querySelectorAll('.td-num').length,
    songlistAny: document.querySelectorAll('[data-log*="songlist"]').length,
    dataLogTotal: document.querySelectorAll('[id="page_pc_search_result"] [data-log]').length,
    oids: (() => { const m = {}; document.querySelectorAll('[id="page_pc_search_result"] [data-log]').forEach(e => {
      try { const p = JSON.parse(e.getAttribute('data-log')); m[p.oid] = (m[p.oid]||0)+1; } catch(_){} }); return m; })()
  };
  const root = document.getElementById('page_pc_search_result');
  out.searchResultVisible = !!(root && root.getBoundingClientRect().height > 50);
  out.tabActive = (() => { const t = document.querySelector('.cmd-tabs-tab-active'); return t ? t.textContent.trim() : null; })();
  return JSON.stringify(out);
})()`;
console.log(await c.evaluate(expr));
c.close(); process.exit(0);
