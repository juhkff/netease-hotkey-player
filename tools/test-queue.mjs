// 关键实验：双击搜索结果切歌，会不会把「待播放列表」(playingList.curPlayingList) 冲掉？
import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const songId = String(process.argv[3] || '3441643322');

const q = () => c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore().getState();
  const pl = st.playingList.curPlayingList || [];
  return JSON.stringify({
    ids: pl.map(x => String((x && x.resourceId) || (x && x.track && x.track.id))),
    cur: String(st.playing.onlineResourceId || st.playing.resourceTrackId),
    mode: st.playing.playingMode, state: st.playing.playingState,
    playId: st.playing.playId, pure: st.playingList.isPurePlayingList
  });
})()`).then(JSON.parse);

const before = await q();
console.log('BEFORE len=' + before.ids.length + ' cur=' + before.cur + ' mode=' + before.mode);
console.log('  ids=' + before.ids.join(','));

const r = await c.playFrom(songId, 30);
console.log('PLAYED ' + r.song.name + ' @' + r.seeked + 's err=' + r.error);

const after = await q();
console.log('AFTER  len=' + after.ids.length + ' cur=' + after.cur + ' mode=' + after.mode + ' pure=' + after.pure);
console.log('  ids=' + after.ids.join(','));
const sb = new Set(before.ids), sa = new Set(after.ids);
console.log('  lost=' + before.ids.filter(x => !sa.has(x)).join(',') + '  |  gained=' + after.ids.filter(x => !sb.has(x)).join(','));
c.close(); process.exit(0);
