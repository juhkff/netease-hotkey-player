// 测 playingList/jump2Track 的方向语义：flag=-1 / +1 分别跳到哪。
// 当前场景：正在放「起风了(伴奏)」，队列里它的前一首应该是上一轮播的「稻香」。
import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));

const cur = () => c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore().getState();
  const pl = st.playingList.curPlayingList || [];
  const id = String(st.playing.onlineResourceId || st.playing.resourceTrackId);
  const i = pl.findIndex(x => String((x && x.resourceId) || (x && x.track && x.track.id)) === id);
  return JSON.stringify({ id, name: st.playing.curTrack && st.playing.curTrack.name,
    idx: i, len: pl.length, state: st.playing.playingState,
    prev: i > 0 ? String(pl[i-1].resourceId) : null, next: i >= 0 && i < pl.length-1 ? String(pl[i+1].resourceId) : null });
})()`).then(JSON.parse);

const jump = f => c.evaluate(`(() => { window.__ncm.ensureStore().dispatch({type:'playingList/jump2Track', payload:{flag:${f}, type:'call', triggerScene:0}}); return true; })()`);

console.log('start   ' + JSON.stringify(await cur()));
await jump(-1); await new Promise(r => setTimeout(r, 2500));
console.log('flag=-1 ' + JSON.stringify(await cur()));
await jump(1);  await new Promise(r => setTimeout(r, 2500));
console.log('flag=+1 ' + JSON.stringify(await cur()));
c.close(); process.exit(0);
