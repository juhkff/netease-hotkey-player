// 侦察：播放列表（待播放队列）在 store 里长什么样，双击切歌会不会把它冲掉。
import { connect } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));

const snap = await c.evaluate(String.raw`(() => {
  const S = window.__ncm.ensureStore();
  const st = S.getState();
  const shape = {};
  for (const k of Object.keys(st)) {
    const v = st[k];
    shape[k] = Array.isArray(v) ? ('array(' + v.length + ')')
      : (v && typeof v === 'object') ? Object.keys(v).slice(0, 30)
      : typeof v;
  }
  const pl = st.playingList;
  const out = { topKeys: Object.keys(st), shape };
  if (pl && typeof pl === 'object') {
    out.playingListKeys = Object.keys(pl);
    for (const k of Object.keys(pl)) {
      const v = pl[k];
      out['pl_' + k + '_type'] = Array.isArray(v) ? ('array(' + v.length + ')') : typeof v;
    }
  }
  return JSON.stringify(out);
})()`);
console.log(snap);
c.close();
process.exit(0);
