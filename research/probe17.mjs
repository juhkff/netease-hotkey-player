// 第十七轮：单曲 tab 下溯源歌曲 ID，并端到端验证「双击行 → 播放目标歌曲」。
// 用法: node probe17.mjs <port> [targetSongId]
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const targetId = process.argv[3] ? String(process.argv[3]) : null;

const c = await connect(port);
await sleep(500);

// 确保在「单曲」tab
await c.evaluate(`(() => { const t = document.querySelector('[id="cmdTab1"]'); if (t) t.click(); return true; })()`);
await sleep(2000);

const SCAN = `(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no page' };
  const vis = e => e && e.getClientRects().length > 0;
  const rows = [...root.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(vis);
  const info = rows.map((r, i) => {
    let log = null; try { log = JSON.parse(r.getAttribute('data-log')); } catch (e) {}
    const fk = Object.keys(r).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
    let trackId = null, trackName = null, found = null;
    let f = fk ? r[fk] : null;
    for (let d = 0; f && d < 40; d++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      for (const k of ['track', 'data', 'record', 'item', 'song', 'info']) {
        const v = p[k];
        if (v && typeof v === 'object' && v.id != null && (v.name != null || v.artists != null)) {
          if (!found) { found = { prop: k, depth: d, id: v.id, name: v.name, keys: Object.keys(v).slice(0, 22) }; trackId = v.id; trackName = v.name; }
        }
      }
      if (trackId == null && p.id != null && typeof p.id !== 'object' && /^\\d+$/.test(String(p.id)) && d > 3) {
        if (!found) { found = { prop: 'id@' + d, id: p.id }; trackId = p.id; }
      }
    }
    return {
      i, num: r.querySelector('.td-num') ? r.querySelector('.td-num').textContent.trim() : null,
      title: r.querySelector('.title') ? r.querySelector('.title').textContent.trim() : null,
      artists: r.querySelector('.artists') ? (r.querySelector('.artists').getAttribute('title') || r.querySelector('.artists').textContent.trim()) : null,
      trackId, trackName, found, logParams: log && log.params && { s_cid: log.params.s_cid, s_position: log.params.s_position, s_ctype: log.params.s_ctype },
    };
  });
  return { count: rows.length, rows: info };
})()`;

const scan = await c.evaluate(SCAN);
console.log('### 单曲 tab 行扫描: ' + scan.count + ' 行 ###');
for (const r of (scan.rows || []).slice(0, 6)) {
  console.log(JSON.stringify({ num: r.num, title: r.title, artists: r.artists, trackId: r.trackId, found: r.found && { prop: r.found.prop, depth: r.found.depth, keys: r.found.keys } }));
}
console.log('\n第一行完整 found:', JSON.stringify(scan.rows && scan.rows[0] && scan.rows[0].found));

// 选目标
const pick = targetId ? (scan.rows || []).find(r => String(r.trackId) === targetId) : (scan.rows || [])[0];
if (!pick) { console.log('\n没找到目标歌曲，ID=' + targetId); c.close(); process.exit(0); }
console.log('\n### 选中: ' + JSON.stringify({ num: pick.num, title: pick.title, trackId: pick.trackId }));

const before = await c.readState();
console.log('双击前 songId=' + before.songId + ' name=' + before.name);

// 双击该行
await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  const vis = e => e && e.getClientRects().length > 0;
  const rows = [...root.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(vis);
  const r = rows[${pick.i}];
  if (!r) return { err: 'row gone' };
  r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return { ok: true };
})()`);
await sleep(3000);

const after = await c.readState();
console.log('双击后 songId=' + after.songId + ' name=' + after.name + ' playing=' + after.playing + ' dur=' + after.duration + ' sec=' + after.seconds);
console.log('\n结果: ' + (String(after.songId) === String(pick.trackId) ? '✅ 成功播放目标歌曲' : '❌ 没播目标 (期望 ' + pick.trackId + ')'));

c.close();
