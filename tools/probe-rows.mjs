import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const out = await c.evaluate(String.raw`(() => {
  const rows = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')].filter(e => e.getClientRects().length);
  const res = [];
  for (const el of rows) {
    let f = null;
    for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
    let node = f, data = null, depth = -1;
    for (let d = 0; d < 14 && node; d++) {
      const p = node.memoizedProps;
      if (p && p.data && p.data.id) { data = p.data; depth = d; break; }
      if (p && p.track && p.track.id) { data = p.track; depth = d; break; }
      node = node.return;
    }
    res.push({ id: data ? String(data.id) : null, name: data ? data.name : null, depth,
               text: el.innerText.replace(/\n/g,'|').slice(0,45) });
  }
  return JSON.stringify(res);
})()`);
console.log(out);
c.close(); process.exit(0);
