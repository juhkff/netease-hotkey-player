// 第十六轮：检查搜索结果里「歌曲行」的真实结构，重点找歌曲 ID 藏在哪。
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);
await sleep(800);

const ROW = `(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no page' };
  const rows = [...root.querySelectorAll('[data-log*="cell_pc_common_songlist"]')];
  const rows2 = [...root.querySelectorAll('[data-log*="cell_pc_common_songcard"]')];
  const dump = r => {
    let log = null; try { log = JSON.parse(r.getAttribute('data-log')); } catch (e) { log = r.getAttribute('data-log'); }
    // 沿 fiber 往上找带 id / name / artists 的 props
    const fk = Object.keys(r).find(k => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$'));
    const props = {};
    let f = fk ? r[fk] : null;
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      for (const k of Object.keys(p)) {
        if (/^(id|track|trackId|resourceId|data|item|song|songId|record|info)$/i.test(k) && props[k] === undefined) {
          const v = p[k];
          if (v === null || ['string','number','boolean'].includes(typeof v)) props[k] = v;
          else if (typeof v === 'object') props[k] = 'obj{' + Object.keys(v).slice(0, 18).join(',') + '}';
        }
        if (/^(id|trackId|songId|resourceId)$/i.test(k) && typeof p[k] !== 'object' && props['#' + k] === undefined) props['#' + k] = p[k];
      }
    }
    // 直接找 fiber props 里的 track 对象 id
    let trackId = null;
    f = fk ? r[fk] : null;
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && p.track && typeof p.track === 'object' && p.track.id) { trackId = p.track.id; break; }
      if (p && p.data && typeof p.data === 'object' && p.data.id && (p.data.name || p.data.artists)) { trackId = p.data.id; break; }
    }
    return {
      text: r.textContent.replace(/\\s+/g, ' ').trim().slice(0, 100),
      attrs: [...r.attributes].map(a => a.name + '=' + String(a.value).slice(0, 120)),
      logOid: log && log.oid, logParams: log && log.params,
      props, trackId,
      innerIds: [...r.querySelectorAll('[data-id],[id]')].slice(0, 6).map(e => e.tagName + '#' + e.id + '|' + (e.getAttribute('data-id') || '')),
    };
  };
  return { songlistCount: rows.length, songcardCount: rows2.length, first: rows[0] ? dump(rows[0]) : null, second: rows[1] ? dump(rows[1]) : null };
})()`;

console.log('### songlist 行（综合 tab）###');
console.log(JSON.stringify(await c.evaluate(ROW), null, 1));

// 切到「单曲」tab
console.log('\n### 点击「单曲」tab (cmdTab1) ###');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const t = document.querySelector('[id="cmdTab1"]');
  if (!t) return { err: 'no cmdTab1' };
  t.click();
  return { clicked: true, text: t.textContent.trim() };
})()`)));
await sleep(2500);

const ROW2 = ROW.replace('[id="page_pc_search_result"]', '[id="page_pc_search_result"]');
console.log('\n### 单曲 tab 后的行 ###');
console.log(JSON.stringify(await c.evaluate(`(() => {
  const root = document.querySelector('[id="page_pc_search_result"]');
  if (!root) return { err: 'no page' };
  const v = e => e && e.getClientRects().length > 0;
  const all = [...root.querySelectorAll('[data-log]')];
  const oids = {};
  all.forEach(e => { let l = {}; try { l = JSON.parse(e.getAttribute('data-log')); } catch (x) {} oids[l.oid || '?'] = (oids[l.oid || '?'] || 0) + 1; });
  const rows = all.filter(e => /cell_pc_common_songlist|cell_pc_songlist/.test(e.getAttribute('data-log') || '') && v(e));
  return { oids, visibleSongRows: rows.length, sample: rows.slice(0,2).map(r => r.textContent.replace(/\\s+/g,' ').trim().slice(0,110)) };
})()`, null, 1)));

console.log('\n### 单曲 tab 第一行的 ID 溯源 ###');
console.log(JSON.stringify(await c.evaluate(ROW), null, 1));

c.close();
