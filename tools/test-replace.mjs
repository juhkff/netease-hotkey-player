// 试探 playingList/replaceCurPlayingList：拿当前队列原样回灌一遍，看会不会把播放搞乱。
import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));

const snap = () => c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore().getState();
  const pl = st.playingList.curPlayingList || [];
  return JSON.stringify({ cur: String(st.playing.onlineResourceId||st.playing.resourceTrackId),
    name: st.playing.curTrack && st.playing.curTrack.name, state: st.playing.playingState,
    ids: pl.map(x => String((x && x.resourceId) || (x && x.track && x.track.id))) });
})()`).then(JSON.parse);

const before = await snap();
console.log('BEFORE  cur=' + before.name + ' state=' + before.state + ' len=' + before.ids.length);

// 把队列原样回灌
await c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore().getState();
  const list = st.playingList.curPlayingList;
  window.__ncm.ensureStore().dispatch({ type:'playingList/replaceCurPlayingList', payload:{ list: list } });
  return true;
})()`);
await new Promise(r => setTimeout(r, 3000));

const after = await snap();
console.log('AFTER   cur=' + after.name + ' state=' + after.state + ' len=' + after.ids.length);
console.log('  同序=' + (JSON.stringify(before.ids) === JSON.stringify(after.ids)) +
            '  同曲=' + (before.cur === after.cur));
const s = await c.readState();
console.log('  位置=' + s.seconds + 's playing=' + s.playing);
c.close(); process.exit(0);
